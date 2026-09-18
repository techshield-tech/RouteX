use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::{Instant, timeout};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::upstream::{Upstream, UpstreamHealth, UpstreamInput, UpstreamRow};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
        .route("/{id}/test", axum::routing::post(test_connection))
}

const UPSTREAM_COLUMNS: &str =
    "id, name, scheme, host, port, has_auth, health, latency_ms, auth_username, auth_password";

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<Upstream>>> {
    let rows = sqlx::query_as::<_, UpstreamRow>(&format!(
        "SELECT {UPSTREAM_COLUMNS} FROM upstreams ORDER BY rowid"
    ))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(UpstreamRow::into_model).collect()))
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Upstream>> {
    let row = sqlx::query_as::<_, UpstreamRow>(&format!(
        "SELECT {UPSTREAM_COLUMNS} FROM upstreams WHERE id = ?"
    ))
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;
    Ok(Json(row.into_model()))
}

async fn create(State(state): State<AppState>, Json(input): Json<UpstreamInput>) -> AppResult<Json<Upstream>> {
    let id = format!("up-{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO upstreams (id, name, scheme, host, port, has_auth, health, latency_ms, auth_username, auth_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(input.scheme.as_str())
    .bind(&input.host)
    .bind(input.port)
    .bind(input.has_auth)
    .bind(input.health.as_str())
    .bind(input.latency_ms)
    .bind(input.auth_username.clone().unwrap_or_default())
    .bind(input.auth_password.clone().unwrap_or_default())
    .execute(&state.pool)
    .await?;
    Ok(Json(Upstream {
        id,
        name: input.name,
        scheme: input.scheme,
        host: input.host,
        port: input.port,
        has_auth: input.has_auth,
        health: input.health,
        latency_ms: input.latency_ms,
    }))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpstreamInput>,
) -> AppResult<Json<Upstream>> {
    let result = sqlx::query(
        "UPDATE upstreams SET name = ?, scheme = ?, host = ?, port = ?, has_auth = ?, health = ?, latency_ms = ?
         WHERE id = ?",
    )
    .bind(&input.name)
    .bind(input.scheme.as_str())
    .bind(&input.host)
    .bind(input.port)
    .bind(input.has_auth)
    .bind(input.health.as_str())
    .bind(input.latency_ms)
    .bind(&id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("not_found".to_string()));
    }
    // Credentials are only touched when the caller actually sends them —
    // omitted fields leave whatever is already stored in place.
    if let Some(username) = &input.auth_username {
        sqlx::query("UPDATE upstreams SET auth_username = ? WHERE id = ?")
            .bind(username)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(password) = &input.auth_password {
        sqlx::query("UPDATE upstreams SET auth_password = ? WHERE id = ?")
            .bind(password)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }
    Ok(Json(Upstream {
        id,
        name: input.name,
        scheme: input.scheme,
        host: input.host,
        port: input.port,
        has_auth: input.has_auth,
        health: input.health,
        latency_ms: input.latency_ms,
    }))
}

/// Rejects when a route entry still points at this upstream — nothing
/// cascades client-side for upstreams, so the server enforces it instead.
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM upstreams WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("not_found".to_string()));
    }

    let in_use: Option<String> = sqlx::query_scalar("SELECT id FROM route_entries WHERE upstream_id = ? LIMIT 1")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    if in_use.is_some() {
        return Err(AppError::Conflict("upstream_in_use".to_string()));
    }

    sqlx::query("DELETE FROM upstreams WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestConnectionResult {
    ok: bool,
    latency_ms: Option<i64>,
    health: UpstreamHealth,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

/// Real TCP connect probe against the upstream's host:port — the one place
/// in stage 1 that touches the network, since it's just a reachability
/// check, not the proxy engine itself.
async fn test_connection(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<TestConnectionResult>> {
    let row = sqlx::query_as::<_, UpstreamRow>(&format!(
        "SELECT {UPSTREAM_COLUMNS} FROM upstreams WHERE id = ?"
    ))
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;

    let addr = format!("{}:{}", row.host, row.port);
    let start = Instant::now();
    let outcome = timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await;

    let result = match outcome {
        Ok(Ok(_stream)) => {
            let latency_ms = start.elapsed().as_millis() as i64;
            TestConnectionResult {
                ok: true,
                latency_ms: Some(latency_ms),
                health: UpstreamHealth::Healthy,
                error: None,
            }
        }
        Ok(Err(_)) => TestConnectionResult {
            ok: false,
            latency_ms: None,
            health: UpstreamHealth::Unreachable,
            error: Some("refused"),
        },
        Err(_) => TestConnectionResult {
            ok: false,
            latency_ms: None,
            health: UpstreamHealth::Unreachable,
            error: Some("timeout"),
        },
    };

    sqlx::query("UPDATE upstreams SET health = ?, latency_ms = ? WHERE id = ?")
        .bind(result.health.as_str())
        .bind(result.latency_ms)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    Ok(Json(result))
}
