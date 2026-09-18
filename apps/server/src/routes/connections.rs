use std::convert::Infallible;

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use crate::error::AppResult;
use crate::models::connection::{Connection, ConnectionRow};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list)).route("/stream", get(stream))
}

#[derive(Deserialize)]
struct ListParams {
    limit: Option<i64>,
}

/// Connections currently in flight (from the engine, not yet persisted —
/// they only get written to the DB once they close) overlaid on top of the
/// most recent closed/failed rows from the `connections` table, newest
/// first.
async fn list(State(state): State<AppState>, Query(params): Query<ListParams>) -> AppResult<Json<Vec<Connection>>> {
    let limit = params.limit.unwrap_or(40).max(0) as usize;

    let mut active = state.engine.active_connections();
    active.sort_by(|a, b| b.time.cmp(&a.time));
    if active.len() > limit {
        active.truncate(limit);
    }
    let remaining = limit.saturating_sub(active.len());

    let mut connections = active;
    if remaining > 0 {
        let rows = sqlx::query_as::<_, ConnectionRow>(
            "SELECT id, time, client, target, matched_rule, route, bytes_up, bytes_down, duration_ms, status, listener_id
             FROM connections ORDER BY time DESC LIMIT ?",
        )
        .bind(remaining as i64)
        .fetch_all(&state.pool)
        .await?;
        connections.extend(rows.into_iter().map(ConnectionRow::into_model));
    }

    Ok(Json(connections))
}

/// Live feed of connection state changes (one event when a connection
/// starts, another when it closes or fails) — the UI's Connections page
/// uses this in place of polling. `GET /api/connections` above still
/// serves the initial seed on page load.
async fn stream(State(state): State<AppState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.engine.subscribe_connections();
    let events = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(conn) => Event::default().json_data(&conn).ok().map(Ok),
        // A slow subscriber missed some events; just skip past the gap
        // instead of tearing down the stream.
        Err(_) => None,
    });
    Sse::new(events).keep_alive(KeepAlive::default())
}
