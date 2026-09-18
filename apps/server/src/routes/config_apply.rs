use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::Serialize;

use crate::error::AppError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(apply))
}

#[derive(Serialize)]
struct ApplyResult {
    ok: bool,
    #[serde(rename = "appliedAt")]
    applied_at: String,
    /// Listeners that failed to (re)bind during this apply, if any.
    /// Listeners that bound fine keep running regardless of these.
    #[serde(rename = "failedListeners", skip_serializing_if = "Vec::is_empty")]
    failed_listeners: Vec<FailedListener>,
}

#[derive(Serialize)]
struct FailedListener {
    #[serde(rename = "listenerId")]
    listener_id: String,
    code: String,
    message: String,
}

/// Reloads the routing configuration from the DB and reconciles the
/// engine's running listeners against it. Listeners that bind fine keep
/// running (and untouched listeners never drop their connections); any
/// that fail to bind are reported back — with a non-2xx status, so the
/// caller can't mistake a partial failure for a clean apply — naming
/// exactly which listener(s) need attention.
async fn apply(state: axum::extract::State<AppState>) -> Result<Response, AppError> {
    let failures = state
        .engine
        .reload()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let failed_listeners: Vec<FailedListener> = failures
        .into_iter()
        .map(|f| FailedListener { listener_id: f.listener_id, code: f.code.to_string(), message: f.message })
        .collect();

    let body = ApplyResult {
        ok: failed_listeners.is_empty(),
        applied_at: Utc::now().to_rfc3339(),
        failed_listeners,
    };

    let status = if body.failed_listeners.is_empty() { StatusCode::OK } else { StatusCode::CONFLICT };
    Ok((status, Json(body)).into_response())
}
