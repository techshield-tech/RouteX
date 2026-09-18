//! Listener lifecycle: binds/starts listeners from a snapshot, and on
//! reload diffs old vs new so only listeners whose bind/port/protocol/auth
//! actually changed get stopped and restarted. Untouched listeners keep
//! every connection they currently have open.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::net::TcpListener as TokioTcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::models::listener::{Listener, ListenerAuth, ListenerProtocol};

use super::Engine;
use super::snapshot::ConfigSnapshot;

use super::listener as proto;

/// One (listener_id, machine-readable error) pair, surfaced back through
/// `POST /api/config/apply` so the UI can point at exactly which
/// listener(s) failed to bind.
pub struct ListenerFailure {
    pub listener_id: String,
    pub code: &'static str,
    pub message: String,
}

/// The subset of a `Listener` that determines whether the actual bound
/// socket needs to change. Anything else (name, default action, status
/// display, hit counters...) can change without touching the running
/// task — routing itself is read fresh from the snapshot on every new
/// connection, not captured here.
#[derive(Clone, PartialEq, Eq)]
struct ListenerSpec {
    protocol: ListenerProtocol,
    bind: String,
    port: i64,
    enabled: bool,
    auth: (bool, String, String),
}

impl ListenerSpec {
    fn from(listener: &Listener) -> Self {
        Self {
            protocol: listener.protocol,
            bind: listener.bind.clone(),
            port: listener.port,
            enabled: listener.enabled,
            auth: auth_key(&listener.auth),
        }
    }
}

fn auth_key(auth: &ListenerAuth) -> (bool, String, String) {
    (auth.enabled, auth.username.clone(), auth.password.clone())
}

struct RunningListener {
    spec: ListenerSpec,
    cancel: CancellationToken,
    handle: JoinHandle<()>,
}

pub struct Supervisor {
    running: Mutex<HashMap<String, RunningListener>>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self { running: Mutex::new(HashMap::new()) }
    }

    /// Starts every enabled listener in `snapshot`. Used once at boot.
    pub async fn start_all(&self, engine: &Arc<Engine>, snapshot: &ConfigSnapshot) -> Vec<ListenerFailure> {
        let mut failures = Vec::new();
        let mut running = self.running.lock().await;
        for listener in &snapshot.listeners {
            if !listener.enabled {
                continue;
            }
            match Self::bind_and_spawn(engine, listener).await {
                Ok(entry) => {
                    running.insert(listener.id.clone(), entry);
                }
                Err(f) => failures.push(f),
            }
        }
        failures
    }

    /// Diffs `new_snapshot`'s listeners against whatever is currently
    /// running and reconciles: unchanged listeners are left alone, changed
    /// ones are cancelled and rebound, removed/disabled ones are cancelled,
    /// new ones are started. Returns every bind failure encountered.
    pub async fn reconcile(&self, engine: &Arc<Engine>, new_snapshot: &Arc<ConfigSnapshot>) -> Vec<ListenerFailure> {
        let mut failures = Vec::new();
        let mut running = self.running.lock().await;

        let desired: HashMap<&str, &Listener> = new_snapshot
            .listeners
            .iter()
            .filter(|l| l.enabled)
            .map(|l| (l.id.as_str(), l))
            .collect();

        // Stop anything removed, disabled, or whose bind spec changed.
        let stale_ids: Vec<String> = running
            .iter()
            .filter(|(id, entry)| match desired.get(id.as_str()) {
                None => true,
                Some(listener) => ListenerSpec::from(listener) != entry.spec,
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &stale_ids {
            if let Some(entry) = running.remove(id) {
                entry.cancel.cancel();
                // Best-effort: don't block reload on a slow-to-drain
                // listener task, but do give it a moment to release the
                // socket before we potentially rebind the same port.
                let _ = tokio::time::timeout(std::time::Duration::from_secs(2), entry.handle).await;
                Self::set_status(engine, id, "down").await;
            }
        }

        // Start anything desired that isn't already running with a
        // matching spec (new listeners, and the ones just cancelled above).
        for (id, listener) in &desired {
            if running.contains_key(*id) {
                continue;
            }
            match Self::bind_and_spawn(engine, listener).await {
                Ok(entry) => {
                    running.insert((*id).to_string(), entry);
                }
                Err(f) => failures.push(f),
            }
        }

        failures
    }

    async fn bind_and_spawn(engine: &Arc<Engine>, listener: &Listener) -> Result<RunningListener, ListenerFailure> {
        let addr = format!("{}:{}", listener.bind, listener.port);
        let tcp = match TokioTcpListener::bind(&addr).await {
            Ok(tcp) => tcp,
            Err(e) => {
                Self::set_status(engine, &listener.id, "down").await;
                return Err(ListenerFailure {
                    listener_id: listener.id.clone(),
                    code: bind_error_code(&e),
                    message: format!("failed to bind {addr}: {e}"),
                });
            }
        };
        Self::set_status(engine, &listener.id, "up").await;

        let cancel = CancellationToken::new();
        let engine = engine.clone();
        let listener_id = listener.id.clone();
        let protocol = listener.protocol;
        let task_cancel = cancel.clone();
        let handle = tokio::spawn(async move {
            match protocol {
                ListenerProtocol::Http => proto::http::run(engine, tcp, listener_id, task_cancel).await,
                ListenerProtocol::Socks5 => proto::socks5::run(engine, tcp, listener_id, task_cancel).await,
            }
        });

        Ok(RunningListener { spec: ListenerSpec::from(listener), cancel, handle })
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Supervisor {
    /// Reflects the listener's real, observed bind state back into the DB
    /// row — `status` is documented (`apps/ui/src/types.ts`) as "observed
    /// runtime state, not something a form edits directly", so it should
    /// track whether the listener is actually bound and running, not just
    /// whatever it was last set to by a config edit.
    async fn set_status(engine: &Arc<Engine>, listener_id: &str, status: &str) {
        if let Err(e) = sqlx::query("UPDATE listeners SET status = ? WHERE id = ?")
            .bind(status)
            .bind(listener_id)
            .execute(&engine.pool)
            .await
        {
            tracing::debug!("failed to update listener {listener_id} status: {e}");
        }
    }
}

fn bind_error_code(e: &std::io::Error) -> &'static str {
    match e.kind() {
        std::io::ErrorKind::AddrInUse => "listener_port_in_use",
        std::io::ErrorKind::PermissionDenied => "listener_permission_denied",
        _ => "listener_bind_failed",
    }
}
