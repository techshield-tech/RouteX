//! Live counters and ring buffers backing `/api/metrics` and
//! `/api/connections`. Hot per-connection counters are atomics; the ring
//! buffers (recent traffic points, recent connections, active connection
//! table) sit behind small mutexes since they're only touched a couple of
//! times per connection, not per byte.
//!
//! The traffic history is a real 15-minute window made of 90 buckets of 10
//! seconds each. `tick()` is still driven once a second by the engine's
//! ticker, but instead of pushing a per-second point it accumulates each
//! second's delta bytes into the current 10-second bucket (keyed by
//! `epoch_secs / 10 * 10`). When the epoch second rolls into a new bucket,
//! the previous bucket is closed out — averaged into bytes-per-second over
//! however many seconds it actually covered — and pushed onto the ring
//! (capped at 90 points = 15 minutes); a fresh bucket is then opened. The
//! bucket currently being filled is not yet in the ring, so snapshots
//! append it on the fly as the "now" point, averaged over the seconds
//! elapsed in it so far.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use chrono::Utc;
use uuid::Uuid;

use crate::models::connection::{Connection, ConnectionStatus};
use crate::models::metrics::{Metrics, TopRule, TrafficPoint};
use crate::models::route_entry::RouteAction;

/// Width of one traffic bucket, in seconds.
const TRAFFIC_BUCKET_SECS: i64 = 10;
/// 90 buckets * 10s = 15 minutes of history.
const TRAFFIC_RING_CAP: usize = 90;
const RECENT_CLOSED_CAP: usize = 200;

/// How long persisted `traffic_samples` rows are kept before being pruned
/// (see `Engine`'s hourly prune in `engine/mod.rs`). Bounds the table to at
/// most 90 * 1440 = 129,600 one-minute rows no matter how long the process
/// has been running.
pub const TRAFFIC_RETENTION_SECS: i64 = 90 * 86_400;

/// A connection currently in flight. Its byte counters are shared with the
/// `CountingStream` wrapping the client socket, so they update live as
/// data flows through `tokio::io::copy_bidirectional`.
pub struct ActiveConn {
    pub id: String,
    pub started_at: String,
    pub client: String,
    pub target: String,
    pub matched_rule: String,
    pub route: RouteAction,
    pub listener_id: String,
    pub route_entry_id: Option<String>,
    pub bytes_up: Arc<AtomicU64>,
    pub bytes_down: Arc<AtomicU64>,
    pub start: Instant,
}

impl ActiveConn {
    fn to_connection(&self) -> Connection {
        Connection {
            id: self.id.clone(),
            time: self.started_at.clone(),
            client: self.client.clone(),
            target: self.target.clone(),
            matched_rule: self.matched_rule.clone(),
            route: self.route,
            bytes_up: self.bytes_up.load(Ordering::Relaxed) as i64,
            bytes_down: self.bytes_down.load(Ordering::Relaxed) as i64,
            duration_ms: self.start.elapsed().as_millis() as i64,
            status: ConnectionStatus::Active,
            listener_id: self.listener_id.clone(),
        }
    }
}

/// Cumulative byte totals as of the previous `tick()`, used to derive
/// per-second deltas (traffic points, throughput bps) without a full
/// history buffer.
#[derive(Default, Clone, Copy)]
struct TickTotals {
    up: u64,
    down: u64,
    proxied: u64,
    direct: u64,
}

/// The in-progress 10-second traffic bucket. Each `tick()` adds that
/// second's delta bytes and bumps `seconds`; once the epoch second moves
/// into a new bucket, this is closed into an averaged `TrafficPoint` and
/// pushed onto the ring.
#[derive(Default, Clone, Copy)]
struct TrafficBucket {
    /// Epoch seconds of the bucket's start (`epoch_secs / 10 * 10`).
    key: i64,
    proxied_sum: f64,
    direct_sum: f64,
    /// Number of one-second ticks accumulated into this bucket so far.
    seconds: u32,
}

impl TrafficBucket {
    fn to_point(self) -> TrafficPoint {
        let seconds = self.seconds.max(1) as f64;
        TrafficPoint {
            t: self.key,
            proxied: self.proxied_sum / seconds,
            direct: self.direct_sum / seconds,
        }
    }
}

/// A just-closed 10-second bucket, handed back by `tick()` so the engine can
/// persist it to `traffic_samples` outside of `MetricsState`'s lock. Carries
/// raw summed bytes (not yet averaged) — `to_point()` on `TrafficBucket` does
/// that for the in-memory ring, but the DB stores cumulative sums instead so
/// upserts across restarts stay exact.
pub struct ClosedTrafficBucket {
    pub key: i64,
    pub proxied_bytes: i64,
    pub direct_bytes: i64,
    pub seconds: i64,
}

pub struct MetricsState {
    active_count: AtomicI64,
    bytes_up_total: AtomicU64,
    bytes_down_total: AtomicU64,
    bytes_proxied_total: AtomicU64,
    bytes_direct_total: AtomicU64,
    last_tick: Mutex<TickTotals>,
    last_bps: Mutex<(f64, f64)>, // (up, down) bytes/sec as of the last tick
    traffic: Mutex<VecDeque<TrafficPoint>>,
    current_bucket: Mutex<Option<TrafficBucket>>,
    active: Mutex<HashMap<String, ActiveConn>>,
    recent_closed: Mutex<VecDeque<Connection>>,
}

impl MetricsState {
    pub fn new() -> Self {
        Self {
            active_count: AtomicI64::new(0),
            bytes_up_total: AtomicU64::new(0),
            bytes_down_total: AtomicU64::new(0),
            bytes_proxied_total: AtomicU64::new(0),
            bytes_direct_total: AtomicU64::new(0),
            last_tick: Mutex::new(TickTotals::default()),
            last_bps: Mutex::new((0.0, 0.0)),
            traffic: Mutex::new(VecDeque::with_capacity(TRAFFIC_RING_CAP)),
            current_bucket: Mutex::new(None),
            active: Mutex::new(HashMap::new()),
            recent_closed: Mutex::new(VecDeque::with_capacity(RECENT_CLOSED_CAP)),
        }
    }

    /// Registers a new in-flight connection and hands back the id assigned
    /// to it plus the byte counters the caller should wrap its client
    /// stream with (see `engine::CountingStream`).
    pub fn connection_started(
        &self,
        client: String,
        target: String,
        matched_rule: String,
        route: RouteAction,
        listener_id: String,
        route_entry_id: Option<String>,
    ) -> (String, Arc<AtomicU64>, Arc<AtomicU64>) {
        let id = Uuid::new_v4().to_string();
        let bytes_up = Arc::new(AtomicU64::new(0));
        let bytes_down = Arc::new(AtomicU64::new(0));
        self.active_count.fetch_add(1, Ordering::Relaxed);
        self.active.lock().unwrap().insert(
            id.clone(),
            ActiveConn {
                id: id.clone(),
                started_at: Utc::now().to_rfc3339(),
                client,
                target,
                matched_rule,
                route,
                listener_id,
                route_entry_id,
                bytes_up: bytes_up.clone(),
                bytes_down: bytes_down.clone(),
                start: Instant::now(),
            },
        );
        (id, bytes_up, bytes_down)
    }

    /// Marks a connection finished, moves it into the recent-closed ring
    /// and returns the final record (for the caller to persist to the DB)
    /// plus the matched route entry id (to bump its `hits`), if any.
    pub fn connection_finished(&self, id: &str, status: ConnectionStatus) -> Option<(Connection, Option<String>)> {
        let active = self.active.lock().unwrap().remove(id)?;
        self.active_count.fetch_sub(1, Ordering::Relaxed);

        let bytes_up = active.bytes_up.load(Ordering::Relaxed);
        let bytes_down = active.bytes_down.load(Ordering::Relaxed);
        self.bytes_up_total.fetch_add(bytes_up, Ordering::Relaxed);
        self.bytes_down_total.fetch_add(bytes_down, Ordering::Relaxed);
        let total = bytes_up + bytes_down;
        match active.route {
            RouteAction::Proxy => {
                self.bytes_proxied_total.fetch_add(total, Ordering::Relaxed);
            }
            RouteAction::Direct => {
                self.bytes_direct_total.fetch_add(total, Ordering::Relaxed);
            }
            RouteAction::Block => {}
        }

        let route_entry_id = active.route_entry_id.clone();
        let conn = Connection {
            id: active.id.clone(),
            time: active.started_at.clone(),
            client: active.client.clone(),
            target: active.target.clone(),
            matched_rule: active.matched_rule.clone(),
            route: active.route,
            bytes_up: bytes_up as i64,
            bytes_down: bytes_down as i64,
            duration_ms: active.start.elapsed().as_millis() as i64,
            status,
            listener_id: active.listener_id.clone(),
        };

        let mut recent = self.recent_closed.lock().unwrap();
        if recent.len() >= RECENT_CLOSED_CAP {
            recent.pop_front();
        }
        recent.push_back(conn.clone());

        Some((conn, route_entry_id))
    }

    /// Called roughly once a second by the engine's background ticker to
    /// derive per-second deltas from the cumulative counters. Returns the
    /// bucket just closed (if the epoch second rolled into a new one this
    /// tick), for the caller to persist to `traffic_samples`.
    pub fn tick(&self) -> Option<ClosedTrafficBucket> {
        let now = TickTotals {
            up: self.bytes_up_total.load(Ordering::Relaxed),
            down: self.bytes_down_total.load(Ordering::Relaxed),
            proxied: self.bytes_proxied_total.load(Ordering::Relaxed),
            direct: self.bytes_direct_total.load(Ordering::Relaxed),
        };
        let mut last = self.last_tick.lock().unwrap();
        let up_delta = now.up.saturating_sub(last.up);
        let down_delta = now.down.saturating_sub(last.down);
        let proxied_delta = now.proxied.saturating_sub(last.proxied);
        let direct_delta = now.direct.saturating_sub(last.direct);
        *last = now;
        drop(last);

        *self.last_bps.lock().unwrap() = (up_delta as f64, down_delta as f64);

        let now_secs = Utc::now().timestamp();
        let bucket_key = now_secs / TRAFFIC_BUCKET_SECS * TRAFFIC_BUCKET_SECS;

        let mut current = self.current_bucket.lock().unwrap();
        let needs_close = matches!(&*current, Some(bucket) if bucket.key != bucket_key);
        let mut closed_bucket = None;
        if needs_close
            && let Some(closed) = current.take()
        {
            closed_bucket = Some(ClosedTrafficBucket {
                key: closed.key,
                proxied_bytes: closed.proxied_sum as i64,
                direct_bytes: closed.direct_sum as i64,
                seconds: closed.seconds as i64,
            });
            let mut traffic = self.traffic.lock().unwrap();
            if traffic.len() >= TRAFFIC_RING_CAP {
                traffic.pop_front();
            }
            traffic.push_back(closed.to_point());
        }

        match current.as_mut() {
            Some(bucket) => {
                bucket.proxied_sum += proxied_delta as f64;
                bucket.direct_sum += direct_delta as f64;
                bucket.seconds += 1;
            }
            None => {
                *current = Some(TrafficBucket {
                    key: bucket_key,
                    proxied_sum: proxied_delta as f64,
                    direct_sum: direct_delta as f64,
                    seconds: 1,
                });
            }
        }

        closed_bucket
    }

    pub fn active_connections_list(&self) -> Vec<Connection> {
        self.active.lock().unwrap().values().map(ActiveConn::to_connection).collect()
    }

    /// Looks up one in-flight connection by id, for broadcasting its
    /// just-started state to `/api/connections/stream` subscribers.
    pub fn active_connection(&self, id: &str) -> Option<Connection> {
        self.active.lock().unwrap().get(id).map(ActiveConn::to_connection)
    }

    pub fn recent_closed_list(&self, limit: usize) -> Vec<Connection> {
        let recent = self.recent_closed.lock().unwrap();
        recent.iter().rev().take(limit).cloned().collect()
    }

    /// The in-memory 15-minute traffic ring plus the still-filling current
    /// bucket appended as the "now" point. Backs both `/api/metrics`'s
    /// `traffic` field and the `15m` range of `/api/metrics/traffic`.
    pub fn traffic_points(&self) -> Vec<TrafficPoint> {
        let mut traffic: Vec<TrafficPoint> = self.traffic.lock().unwrap().iter().cloned().collect();
        if let Some(bucket) = *self.current_bucket.lock().unwrap() {
            traffic.push(bucket.to_point());
        }
        traffic
    }

    /// Builds the full `/api/metrics` payload. `rules_total`/`rules_enabled`
    /// and `top_rules` come from the DB (route entry `hits` is the
    /// authoritative counter, already persisted there).
    pub fn snapshot(&self, rules_total: i64, rules_enabled: i64, uptime_seconds: i64, top_rules: Vec<TopRule>) -> Metrics {
        let traffic = self.traffic_points();
        let (up_bps, down_bps) = *self.last_bps.lock().unwrap();

        let proxied_total = self.bytes_proxied_total.load(Ordering::Relaxed) as f64;
        let direct_total = self.bytes_direct_total.load(Ordering::Relaxed) as f64;
        let grand_total = proxied_total + direct_total;
        let (proxied_share_pct, direct_share_pct) = if grand_total > 0.0 {
            (proxied_total / grand_total * 100.0, direct_total / grand_total * 100.0)
        } else {
            (0.0, 0.0)
        };

        let mut recent_connections = self.active_connections_list();
        recent_connections.extend(self.recent_closed_list(40));
        recent_connections.sort_by(|a, b| b.time.cmp(&a.time));
        recent_connections.truncate(40);

        Metrics {
            active_connections: self.active_count.load(Ordering::Relaxed),
            throughput_up_bps: up_bps,
            throughput_down_bps: down_bps,
            proxied_share_pct,
            direct_share_pct,
            rules_enabled,
            rules_total,
            uptime_seconds,
            traffic,
            top_rules,
            recent_connections,
        }
    }
}

impl Default for MetricsState {
    fn default() -> Self {
        Self::new()
    }
}
