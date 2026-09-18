use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::error::AppResult;
use crate::models::metrics::{Metrics, TrafficRange, TrafficSeries};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_metrics)).route("/traffic", get(get_traffic))
}

async fn get_metrics(State(state): State<AppState>) -> AppResult<Json<Metrics>> {
    let metrics = state.engine.metrics_payload().await?;
    Ok(Json(metrics))
}

#[derive(Deserialize)]
struct TrafficParams {
    range: Option<TrafficRange>,
}

/// `range` is optional and defaults to `15m` when absent. A value that is
/// present but isn't one of the four `TrafficRange` variants is rejected by
/// the `Query` extractor with a 400 — only omission falls back.
async fn get_traffic(State(state): State<AppState>, Query(params): Query<TrafficParams>) -> AppResult<Json<TrafficSeries>> {
    let range = params.range.unwrap_or(TrafficRange::FifteenMin);
    let series = state.engine.traffic_series(range).await?;
    Ok(Json(series))
}
