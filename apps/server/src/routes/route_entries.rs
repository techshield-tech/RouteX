use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use sqlx::SqlitePool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::route_entry::{ReorderRouteEntriesRequest, RouteEntry, RouteEntryInput, RouteEntryRow};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/reorder", axum::routing::put(reorder))
        .route("/{id}", get(get_one).put(update).delete(remove))
}

async fn listener_ids_by_entry(pool: &SqlitePool) -> AppResult<HashMap<String, Vec<String>>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT route_entry_id, listener_id FROM route_entry_listeners")
            .fetch_all(pool)
            .await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (entry_id, listener_id) in rows {
        map.entry(entry_id).or_default().push(listener_id);
    }
    Ok(map)
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<RouteEntry>>> {
    let rows = sqlx::query_as::<_, RouteEntryRow>(
        "SELECT id, name, enabled, target_kind, target_id, action, upstream_id, note, hits, position
         FROM route_entries ORDER BY position",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut listeners = listener_ids_by_entry(&state.pool).await?;
    let entries = rows
        .into_iter()
        .map(|r| {
            let ids = listeners.remove(&r.id).unwrap_or_default();
            r.into_model(ids)
        })
        .collect();
    Ok(Json(entries))
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<RouteEntry>> {
    let row = sqlx::query_as::<_, RouteEntryRow>(
        "SELECT id, name, enabled, target_kind, target_id, action, upstream_id, note, hits, position
         FROM route_entries WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;
    let listener_ids: Vec<String> =
        sqlx::query_scalar("SELECT listener_id FROM route_entry_listeners WHERE route_entry_id = ?")
            .bind(&id)
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(row.into_model(listener_ids)))
}

async fn set_listeners(tx: &mut sqlx::SqliteConnection, entry_id: &str, listener_ids: &[String]) -> AppResult<()> {
    sqlx::query("DELETE FROM route_entry_listeners WHERE route_entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;
    for listener_id in listener_ids {
        sqlx::query("INSERT INTO route_entry_listeners (route_entry_id, listener_id) VALUES (?, ?)")
            .bind(entry_id)
            .bind(listener_id)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

async fn create(State(state): State<AppState>, Json(input): Json<RouteEntryInput>) -> AppResult<Json<RouteEntry>> {
    let id = format!("entry-{}", Uuid::new_v4());
    let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM route_entries")
        .fetch_one(&state.pool)
        .await?;

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO route_entries (id, name, enabled, target_kind, target_id, action, upstream_id, note, hits, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(input.enabled)
    .bind(input.target_kind.as_str())
    .bind(&input.target_id)
    .bind(input.action.as_str())
    .bind(&input.upstream_id)
    .bind(&input.note)
    .bind(input.hits)
    .bind(position)
    .execute(&mut *tx)
    .await?;
    set_listeners(&mut tx, &id, &input.listener_ids).await?;
    tx.commit().await?;

    Ok(Json(RouteEntry {
        id,
        name: input.name,
        enabled: input.enabled,
        listener_ids: input.listener_ids,
        target_kind: input.target_kind,
        target_id: input.target_id,
        action: input.action,
        upstream_id: input.upstream_id,
        note: input.note,
        hits: input.hits,
    }))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<RouteEntryInput>,
) -> AppResult<Json<RouteEntry>> {
    let mut tx = state.pool.begin().await?;

    let result = sqlx::query(
        "UPDATE route_entries SET name = ?, enabled = ?, target_kind = ?, target_id = ?, action = ?, upstream_id = ?, note = ?, hits = ?
         WHERE id = ?",
    )
    .bind(&input.name)
    .bind(input.enabled)
    .bind(input.target_kind.as_str())
    .bind(&input.target_id)
    .bind(input.action.as_str())
    .bind(&input.upstream_id)
    .bind(&input.note)
    .bind(input.hits)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("not_found".to_string()));
    }
    set_listeners(&mut tx, &id, &input.listener_ids).await?;
    tx.commit().await?;

    Ok(Json(RouteEntry {
        id,
        name: input.name,
        enabled: input.enabled,
        listener_ids: input.listener_ids,
        target_kind: input.target_kind,
        target_id: input.target_id,
        action: input.action,
        upstream_id: input.upstream_id,
        note: input.note,
        hits: input.hits,
    }))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM route_entries WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("not_found".to_string()));
    }
    sqlx::query("DELETE FROM route_entry_listeners WHERE route_entry_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM route_entries WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Global priority reorder — first match wins, so order is the whole list.
async fn reorder(
    State(state): State<AppState>,
    Json(body): Json<ReorderRouteEntriesRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;
    for (position, id) in body.ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE route_entries SET position = ? WHERE id = ?")
            .bind(position as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
