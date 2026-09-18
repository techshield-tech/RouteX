//! The proxy engine: holds the live configuration snapshot, live metrics,
//! and the listener supervisor. `AppState` holds one `Arc<Engine>` shared
//! with every accepted connection and every API handler.

pub mod listener;
pub mod matcher;
pub mod metrics;
pub mod router;
pub mod snapshot;
pub mod supervisor;
pub mod upstream;

use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use arc_swap::ArcSwap;
use chrono::Utc;
use sqlx::SqlitePool;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::broadcast;

use crate::models::connection::{Connection, ConnectionStatus};
use crate::models::metrics::{Metrics, TopRule, TrafficPoint, TrafficRange, TrafficSeries};
use crate::models::route_entry::RouteAction;
use crate::models::settings::LogLevel;

use matcher::MatchRequest;
use metrics::{ClosedTrafficBucket, MetricsState, TRAFFIC_RETENTION_SECS};
use router::RouteDecision;
use snapshot::ConfigSnapshot;

/// How often the `traffic_samples` retention prune is allowed to run, in
/// seconds — pruning is a `DELETE` scan, so it's throttled well below the
/// once-a-minute rate `persist_traffic_bucket` writes at.
const TRAFFIC_PRUNE_INTERVAL_SECS: i64 = 3_600;

/// Upper bound on rows a single `traffic_series` query can return, so a huge
/// `range` can never hand the UI (or blow up response size on) an unbounded
/// array — every range in `TrafficRange` already groups well under this, it's
/// a defensive ceiling only.
const TRAFFIC_SERIES_ROW_LIMIT: i64 = 1000;

/// Ring buffer size for the connection-events broadcast channel: lagging
/// subscribers just miss the oldest events (`RecvError::Lagged`), which the
/// SSE route treats as fine to skip past rather than an error.
const CONN_EVENTS_CAPACITY: usize = 256;

pub struct Engine {
    pool: SqlitePool,
    snapshot: ArcSwap<ConfigSnapshot>,
    metrics: MetricsState,
    supervisor: supervisor::Supervisor,
    started_at: Instant,
    /// Broadcasts every connection state change (started, then closed or
    /// failed) for `/api/connections/stream` to relay over SSE.
    conn_events: broadcast::Sender<Connection>,
    /// Epoch seconds the `traffic_samples` retention prune last ran. Zero at
    /// startup so the very first tick is allowed to prune (in case the
    /// process was down long enough that stale rows piled up).
    last_prune_at: AtomicI64,
}

/// Outcome of trying to reach a connection's destination: either a ready
/// stream to relay through, or (for `block`, or a dial that failed) no
/// stream at all plus the reason why.
pub struct ConnectOutcome {
    pub stream: Option<tokio::net::TcpStream>,
    pub decision: RouteDecision,
    pub error: Option<upstream::DialError>,
}

/// Per-connection context for [`Engine::relay`], grouped so the function
/// doesn't need one parameter per field.
pub struct RelayParams<'a> {
    pub client_addr: String,
    pub target: String,
    pub decision: RouteDecision,
    pub listener_id: String,
    pub snapshot: &'a ConfigSnapshot,
}

impl Engine {
    pub async fn new(pool: SqlitePool) -> anyhow::Result<Arc<Engine>> {
        let snap = snapshot::load(&pool).await?;
        let (conn_events, _) = broadcast::channel(CONN_EVENTS_CAPACITY);
        let engine = Arc::new(Engine {
            pool,
            snapshot: ArcSwap::from_pointee(snap),
            metrics: MetricsState::new(),
            supervisor: supervisor::Supervisor::new(),
            started_at: Instant::now(),
            conn_events,
            last_prune_at: AtomicI64::new(0),
        });
        Engine::start_ticker(engine.clone());
        Ok(engine)
    }

    /// Subscribes to live connection events (one on start, one on finish)
    /// for the SSE route. Each subscriber gets its own receiver; a slow
    /// consumer just misses the oldest buffered events.
    pub fn subscribe_connections(&self) -> broadcast::Receiver<Connection> {
        self.conn_events.subscribe()
    }

    pub fn snapshot(&self) -> Arc<ConfigSnapshot> {
        self.snapshot.load_full()
    }

    /// Starts every enabled listener from the current snapshot. Called once
    /// at boot, before the API starts serving. Returns a failure entry for
    /// any listener that couldn't bind — those simply stay down, the rest
    /// of the engine keeps going.
    pub async fn start(self: &Arc<Self>) -> Vec<supervisor::ListenerFailure> {
        let snap = self.snapshot();
        self.supervisor.start_all(self, &snap).await
    }

    /// Rebuilds the snapshot from the DB and swaps it in atomically, then
    /// reconciles running listeners against it: only listeners whose
    /// bind/port/protocol/auth/enabled actually changed are stopped and
    /// restarted (or started/stopped outright); everything else keeps its
    /// active connections untouched. Returns a failure entry for any
    /// listener that couldn't (re)bind.
    pub async fn reload(self: &Arc<Self>) -> anyhow::Result<Vec<supervisor::ListenerFailure>> {
        let new_snapshot = Arc::new(snapshot::load(&self.pool).await?);
        self.snapshot.store(new_snapshot.clone());
        let failures = self.supervisor.reconcile(self, &new_snapshot).await;
        Ok(failures)
    }

    fn start_ticker(engine: Arc<Engine>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                if let Some(bucket) = engine.metrics.tick() {
                    engine.persist_traffic_bucket(&bucket).await;
                }
            }
        });
    }

    /// Cumulatively upserts one just-closed 10-second bucket into
    /// `traffic_samples` (6 buckets per minute row, so a restart mid-minute
    /// neither loses nor double-counts data — no accumulated state lives in
    /// `Engine` itself), then, throttled to once an hour, prunes rows older
    /// than the 90-day retention window. Errors here are never fatal to the
    /// ticker: traffic persistence is best-effort, the in-memory ring
    /// (`MetricsState`) remains the source of truth for the live `15m` view.
    async fn persist_traffic_bucket(&self, bucket: &ClosedTrafficBucket) {
        let minute_key = bucket.key / 60 * 60;
        if let Err(e) = sqlx::query(
            "INSERT INTO traffic_samples (t, proxied_bytes, direct_bytes, seconds) VALUES (?, ?, ?, ?)
             ON CONFLICT(t) DO UPDATE SET
               proxied_bytes = proxied_bytes + excluded.proxied_bytes,
               direct_bytes  = direct_bytes  + excluded.direct_bytes,
               seconds       = seconds       + excluded.seconds",
        )
        .bind(minute_key)
        .bind(bucket.proxied_bytes)
        .bind(bucket.direct_bytes)
        .bind(bucket.seconds)
        .execute(&self.pool)
        .await
        {
            tracing::debug!("failed to persist traffic bucket: {e}");
        }

        let now = Utc::now().timestamp();
        let last_prune = self.last_prune_at.load(Ordering::Relaxed);
        if now - last_prune < TRAFFIC_PRUNE_INTERVAL_SECS {
            return;
        }
        self.last_prune_at.store(now, Ordering::Relaxed);
        let cutoff = now - TRAFFIC_RETENTION_SECS;
        if let Err(e) = sqlx::query("DELETE FROM traffic_samples WHERE t < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await
        {
            tracing::debug!("failed to prune traffic_samples: {e}");
        }
    }

    /// Builds the `/api/metrics/traffic?range=...` payload. `15m` reads the
    /// live in-memory ring (same data `/api/metrics` seeds its chart with);
    /// the longer ranges run one grouped query over the persisted
    /// `traffic_samples` table, bucketed so the point count stays bounded
    /// regardless of the window (a `LIMIT` on top is a defensive ceiling on
    /// that, not something any real range should hit).
    pub async fn traffic_series(&self, range: TrafficRange) -> anyhow::Result<TrafficSeries> {
        let bucket_seconds = range.bucket_secs();
        if range == TrafficRange::FifteenMin {
            return Ok(TrafficSeries { range, bucket_seconds, points: self.metrics.traffic_points() });
        }

        let since = Utc::now().timestamp() - range.window_secs();
        let rows: Vec<(i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT (t / ?) * ? AS bucket, SUM(proxied_bytes), SUM(direct_bytes), SUM(seconds)
             FROM traffic_samples WHERE t >= ?
             GROUP BY bucket ORDER BY bucket LIMIT ?",
        )
        .bind(bucket_seconds)
        .bind(bucket_seconds)
        .bind(since)
        .bind(TRAFFIC_SERIES_ROW_LIMIT)
        .fetch_all(&self.pool)
        .await?;

        // `proxied`/`direct` are average bytes/sec, same unit as the live
        // ring's points (the UI formats both with `fmt.rate`).
        let points = rows
            .into_iter()
            .map(|(t, proxied_bytes, direct_bytes, seconds)| {
                let seconds = seconds.max(1) as f64;
                TrafficPoint { t, proxied: proxied_bytes as f64 / seconds, direct: direct_bytes as f64 / seconds }
            })
            .collect();

        Ok(TrafficSeries { range, bucket_seconds, points })
    }

    /// Builds the full `/api/metrics` payload from live counters plus the
    /// DB's authoritative rule-hit counts.
    pub async fn metrics_payload(&self) -> anyhow::Result<Metrics> {
        let (rules_total, rules_enabled): (i64, i64) =
            sqlx::query_as("SELECT COUNT(*), COALESCE(SUM(enabled), 0) FROM route_entries")
                .fetch_one(&self.pool)
                .await?;
        let top_rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT name, hits FROM route_entries WHERE hits > 0 ORDER BY hits DESC LIMIT 5")
                .fetch_all(&self.pool)
                .await?;
        let total_hits: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(hits), 0) FROM route_entries")
            .fetch_one(&self.pool)
            .await?;
        let top_rules: Vec<TopRule> = top_rows
            .into_iter()
            .map(|(name, hits)| TopRule {
                name,
                hits,
                share: if total_hits > 0 { hits as f64 / total_hits as f64 * 100.0 } else { 0.0 },
            })
            .collect();
        let uptime_seconds = self.started_at.elapsed().as_secs() as i64;
        Ok(self.metrics.snapshot(rules_total, rules_enabled, uptime_seconds, top_rules))
    }

    /// Connections currently in flight, for `/api/connections` to overlay
    /// on top of the persisted (closed) rows.
    pub fn active_connections(&self) -> Vec<Connection> {
        self.metrics.active_connections_list()
    }

    /// Attempts to reach `target` per the routing decision for
    /// `listener_id`. Never panics; every failure mode comes back as
    /// `ConnectOutcome::error` for the caller to translate into the right
    /// protocol-level response.
    pub async fn connect_target(
        &self,
        snapshot: &ConfigSnapshot,
        listener_id: &str,
        req: &MatchRequest,
        target: upstream::Target,
    ) -> ConnectOutcome {
        let decision = router::route(snapshot, listener_id, req);
        match decision.action {
            RouteAction::Block => ConnectOutcome { stream: None, decision, error: None },
            RouteAction::Direct => match upstream::dial_direct(&target, snapshot.settings.routing.dns_resolve_mode).await {
                Ok(stream) => ConnectOutcome { stream: Some(stream), decision, error: None },
                Err(e) => ConnectOutcome { stream: None, decision, error: Some(e) },
            },
            RouteAction::Proxy => self.connect_via_proxy(snapshot, decision, target).await,
        }
    }

    async fn connect_via_proxy(
        &self,
        snapshot: &ConfigSnapshot,
        decision: RouteDecision,
        target: upstream::Target,
    ) -> ConnectOutcome {
        let Some(upstream_id) = decision.upstream_id.clone() else {
            return ConnectOutcome { stream: None, decision, error: Some(upstream::DialError::UpstreamNotFound) };
        };
        let Some(up) = snapshot.upstream(&upstream_id) else {
            return ConnectOutcome { stream: None, decision, error: Some(upstream::DialError::UpstreamNotFound) };
        };

        let start = Instant::now();
        let result = upstream::dial_via_upstream(&target, up, snapshot.settings.routing.dns_resolve_mode).await;
        let (health, latency_ms): (crate::models::upstream::UpstreamHealth, Option<i64>) = match &result {
            Ok(_) => (crate::models::upstream::UpstreamHealth::Healthy, Some(start.elapsed().as_millis() as i64)),
            Err(e) => {
                if let upstream::DialError::UpstreamHandshakeFailed(msg) = e {
                    tracing::debug!("upstream '{}' handshake failed: {msg}", up.name);
                } else {
                    tracing::debug!("upstream '{}' dial failed: {e:?}", up.name);
                }
                (e.upstream_health(), None)
            }
        };
        if let Err(e) = sqlx::query("UPDATE upstreams SET health = ?, latency_ms = ? WHERE id = ?")
            .bind(health.as_str())
            .bind(latency_ms)
            .bind(&upstream_id)
            .execute(&self.pool)
            .await
        {
            tracing::debug!("failed to record upstream health for {upstream_id}: {e}");
        }

        match result {
            Ok(stream) => ConnectOutcome { stream: Some(stream), decision, error: None },
            Err(e) => ConnectOutcome { stream: None, decision, error: Some(e) },
        }
    }

    /// Relays `client` <-> `upstream` until either side closes, tracking
    /// live byte counts on the connection the whole time. Records the
    /// finished connection once the copy ends, in every case (success or
    /// I/O error) — a single connection's failure never propagates past
    /// this function.
    pub async fn relay<C>(self: &Arc<Self>, client: C, mut upstream_stream: tokio::net::TcpStream, params: RelayParams<'_>)
    where
        C: AsyncRead + AsyncWrite + Unpin,
    {
        let RelayParams { client_addr, target, decision, listener_id, snapshot } = params;

        self.log_access(snapshot, &format!(
            "connection accepted: client={client_addr} target={target} action={:?} rule={}",
            decision.action, decision.matched_rule
        ));

        let action = decision.action;
        let (id, bytes_up, bytes_down) =
            self.metrics
                .connection_started(client_addr, target, decision.matched_rule.clone(), action, listener_id, decision.route_entry_id.clone());
        self.broadcast_connection_started(&id);

        let mut counting = CountingStream::new(client, bytes_up, bytes_down);
        let result = tokio::io::copy_bidirectional(&mut counting, &mut upstream_stream).await;
        let status = match result {
            Ok(_) => ConnectionStatus::Closed,
            Err(_) => ConnectionStatus::Failed,
        };
        self.finish_connection(&id, status, snapshot).await;
    }

    /// Records a connection that never got a data-relay phase at all —
    /// blocked outright, or the dial itself failed.
    pub async fn record_immediate(
        self: &Arc<Self>,
        client_addr: String,
        target: String,
        decision: RouteDecision,
        listener_id: String,
        status: ConnectionStatus,
        snapshot: &ConfigSnapshot,
    ) {
        self.log_access(snapshot, &format!(
            "connection {status:?}: client={client_addr} target={target} action={:?} rule={}",
            decision.action, decision.matched_rule
        ));
        let (id, _bytes_up, _bytes_down) = self.metrics.connection_started(
            client_addr,
            target,
            decision.matched_rule.clone(),
            decision.action,
            listener_id,
            decision.route_entry_id.clone(),
        );
        self.broadcast_connection_started(&id);
        self.finish_connection(&id, status, snapshot).await;
    }

    /// Sends the just-registered connection's current (active) state to
    /// `/api/connections/stream` subscribers. Silently does nothing if
    /// nobody is subscribed.
    fn broadcast_connection_started(&self, id: &str) {
        if let Some(conn) = self.metrics.active_connection(id) {
            let _ = self.conn_events.send(conn);
        }
    }

    async fn finish_connection(&self, id: &str, status: ConnectionStatus, snapshot: &ConfigSnapshot) {
        let Some((conn, route_entry_id)) = self.metrics.connection_finished(id, status) else {
            return;
        };
        let _ = self.conn_events.send(conn.clone());
        if let Err(e) = self.persist_connection(&conn, route_entry_id.as_deref()).await {
            self.log_access(snapshot, &format!("failed to persist connection record: {e}"));
        }
    }

    async fn persist_connection(&self, conn: &Connection, route_entry_id: Option<&str>) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO connections (id, time, client, target, matched_rule, route, bytes_up, bytes_down, duration_ms, status, listener_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&conn.id)
        .bind(&conn.time)
        .bind(&conn.client)
        .bind(&conn.target)
        .bind(&conn.matched_rule)
        .bind(conn.route.as_str())
        .bind(conn.bytes_up)
        .bind(conn.bytes_down)
        .bind(conn.duration_ms)
        .bind(match conn.status {
            ConnectionStatus::Active => "active",
            ConnectionStatus::Closed => "closed",
            ConnectionStatus::Failed => "failed",
        })
        .bind(&conn.listener_id)
        .execute(&self.pool)
        .await?;

        // Keep only the most recent ~1000 rows.
        sqlx::query(
            "DELETE FROM connections WHERE id NOT IN (SELECT id FROM connections ORDER BY time DESC LIMIT 1000)",
        )
        .execute(&self.pool)
        .await?;

        if let Some(entry_id) = route_entry_id {
            sqlx::query("UPDATE route_entries SET hits = hits + 1 WHERE id = ?")
                .bind(entry_id)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    fn log_access(&self, snapshot: &ConfigSnapshot, message: &str) {
        if !snapshot.settings.logging.access_log {
            return;
        }
        match snapshot.settings.logging.level {
            LogLevel::Error => tracing::error!(target: "routex::access", "{message}"),
            LogLevel::Warn => tracing::warn!(target: "routex::access", "{message}"),
            LogLevel::Info => tracing::info!(target: "routex::access", "{message}"),
            LogLevel::Debug => tracing::debug!(target: "routex::access", "{message}"),
        }
    }
}

/// Wraps a stream, mirroring every byte read/written into shared atomic
/// counters. Used to give live per-connection byte counts to the metrics
/// engine while still relaying with a plain `tokio::io::copy_bidirectional`
/// call — reads count as "up" (client -> upstream), writes as "down"
/// (upstream -> client).
pub struct CountingStream<S> {
    inner: S,
    read_counter: Arc<AtomicU64>,
    write_counter: Arc<AtomicU64>,
}

impl<S> CountingStream<S> {
    pub fn new(inner: S, read_counter: Arc<AtomicU64>, write_counter: Arc<AtomicU64>) -> Self {
        Self { inner, read_counter, write_counter }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for CountingStream<S> {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let this = self.get_mut();
        let poll = Pin::new(&mut this.inner).poll_read(cx, buf);
        if poll.is_ready() {
            let after = buf.filled().len();
            if after > before {
                this.read_counter.fetch_add((after - before) as u64, Ordering::Relaxed);
            }
        }
        poll
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for CountingStream<S> {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let poll = Pin::new(&mut this.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = &poll {
            this.write_counter.fetch_add(*n as u64, Ordering::Relaxed);
        }
        poll
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}
