use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::listener::{Listener, ListenerInput, ListenerRow};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
}

fn validate_port(port: i64) -> AppResult<()> {
    if !(1..=65535).contains(&port) {
        return Err(AppError::Validation("port_out_of_range".to_string()));
    }
    Ok(())
}

async fn bind_port_collision(
    pool: &sqlx::SqlitePool,
    bind: &str,
    port: i64,
    exclude_id: Option<&str>,
) -> AppResult<bool> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM listeners WHERE bind = ? AND port = ? AND id != ? LIMIT 1",
    )
    .bind(bind)
    .bind(port)
    .bind(exclude_id.unwrap_or(""))
    .fetch_optional(pool)
    .await?;
    Ok(existing.is_some())
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Listener>>> {
    let rows = sqlx::query_as::<_, ListenerRow>(
        "SELECT id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections
         FROM listeners ORDER BY rowid",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(ListenerRow::into_model).collect()))
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Listener>> {
    let row = sqlx::query_as::<_, ListenerRow>(
        "SELECT id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections
         FROM listeners WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;
    Ok(Json(row.into_model()))
}

async fn create(State(state): State<AppState>, Json(input): Json<ListenerInput>) -> AppResult<Json<Listener>> {
    validate_port(input.port)?;
    if bind_port_collision(&state.pool, &input.bind, input.port, None).await? {
        return Err(AppError::Conflict("listener_bind_conflict".to_string()));
    }
    let id = format!("lst-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO listeners (id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(input.protocol.as_str())
    .bind(&input.bind)
    .bind(input.port)
    .bind(input.enabled)
    .bind(input.default_action.as_str())
    .bind(input.auth.enabled)
    .bind(&input.auth.username)
    .bind(&input.auth.password)
    .bind(input.status.as_str())
    .bind(input.connections)
    .execute(&state.pool)
    .await?;
    Ok(Json(Listener {
        id,
        name: input.name,
        protocol: input.protocol,
        bind: input.bind,
        port: input.port,
        enabled: input.enabled,
        default_action: input.default_action,
        auth: input.auth,
        status: input.status,
        connections: input.connections,
    }))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<ListenerInput>,
) -> AppResult<Json<Listener>> {
    validate_port(input.port)?;
    if bind_port_collision(&state.pool, &input.bind, input.port, Some(&id)).await? {
        return Err(AppError::Conflict("listener_bind_conflict".to_string()));
    }
    let result = sqlx::query(
        "UPDATE listeners SET name = ?, protocol = ?, bind = ?, port = ?, enabled = ?, default_action = ?,
         auth_enabled = ?, auth_username = ?, auth_password = ?, status = ?, connections = ?
         WHERE id = ?",
    )
    .bind(&input.name)
    .bind(input.protocol.as_str())
    .bind(&input.bind)
    .bind(input.port)
    .bind(input.enabled)
    .bind(input.default_action.as_str())
    .bind(input.auth.enabled)
    .bind(&input.auth.username)
    .bind(&input.auth.password)
    .bind(input.status.as_str())
    .bind(input.connections)
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("not_found".to_string()));
    }
    Ok(Json(Listener {
        id,
        name: input.name,
        protocol: input.protocol,
        bind: input.bind,
        port: input.port,
        enabled: input.enabled,
        default_action: input.default_action,
        auth: input.auth,
        status: input.status,
        connections: input.connections,
    }))
}

/// Cascade: this listener id drops out of every route entry's listener
/// list; an entry left with none is deleted outright (mirrors
/// `removeListener` in `useConfigStore.tsx`).
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;

    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM listeners WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("not_found".to_string()));
    }

    // Entries that reference this listener and would end up with zero
    // listeners once it's removed.
    let affected_entries: Vec<String> =
        sqlx::query_scalar("SELECT route_entry_id FROM route_entry_listeners WHERE listener_id = ?")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await?;

    sqlx::query("DELETE FROM route_entry_listeners WHERE listener_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    for entry_id in affected_entries {
        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM route_entry_listeners WHERE route_entry_id = ?",
        )
        .bind(&entry_id)
        .fetch_one(&mut *tx)
        .await?;
        if remaining == 0 {
            sqlx::query("DELETE FROM route_entries WHERE id = ?")
                .bind(&entry_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    sqlx::query("DELETE FROM listeners WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
