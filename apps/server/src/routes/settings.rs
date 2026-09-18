use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use sqlx::FromRow;

use crate::error::AppResult;
use crate::models::settings::{DnsResolveMode, LogLevel, LoggingSettings, RoutingSettings, Settings};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_settings).put(update_settings))
}

#[derive(FromRow)]
struct SettingsRow {
    dns_resolve_mode: String,
    log_level: String,
    access_log: bool,
}

impl SettingsRow {
    fn into_model(self) -> Settings {
        Settings {
            routing: RoutingSettings {
                dns_resolve_mode: DnsResolveMode::from_str_opt(&self.dns_resolve_mode).unwrap_or(DnsResolveMode::System),
            },
            logging: LoggingSettings {
                level: LogLevel::from_str_opt(&self.log_level).unwrap_or(LogLevel::Info),
                access_log: self.access_log,
            },
        }
    }
}

async fn get_settings(State(state): State<AppState>) -> AppResult<Json<Settings>> {
    let row = sqlx::query_as::<_, SettingsRow>(
        "SELECT dns_resolve_mode, log_level, access_log FROM settings WHERE id = 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row.into_model()))
}

async fn update_settings(State(state): State<AppState>, Json(input): Json<Settings>) -> AppResult<Json<Settings>> {
    sqlx::query("UPDATE settings SET dns_resolve_mode = ?, log_level = ?, access_log = ? WHERE id = 1")
        .bind(input.routing.dns_resolve_mode.as_str())
        .bind(input.logging.level.as_str())
        .bind(input.logging.access_log)
        .execute(&state.pool)
        .await?;
    Ok(Json(input))
}
