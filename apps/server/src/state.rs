use sqlx::SqlitePool;
use std::sync::Arc;

use crate::engine::Engine;

/// Shared handler state. `SqlitePool` clones cheaply (it's an `Arc` under
/// the hood), so `AppState` itself can just be `Clone`. Uptime and other
/// runtime-derived numbers now live on `Engine` itself (`started_at` there
/// backs `/api/metrics`), so `AppState` doesn't need its own copy.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub engine: Arc<Engine>,
    pub session_ttl_hours: i64,
}
