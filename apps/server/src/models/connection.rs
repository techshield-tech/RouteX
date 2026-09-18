use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Active,
    Closed,
    Failed,
}

impl ConnectionStatus {
    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "active" => ConnectionStatus::Active,
            "closed" => ConnectionStatus::Closed,
            "failed" => ConnectionStatus::Failed,
            _ => return None,
        })
    }
}

use super::route_entry::RouteAction;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub time: String,
    pub client: String,
    pub target: String,
    pub matched_rule: String,
    pub route: RouteAction,
    pub bytes_up: i64,
    pub bytes_down: i64,
    pub duration_ms: i64,
    pub status: ConnectionStatus,
    pub listener_id: String,
}

/// Row shape for the `connections` table — empty in stage 1 (no engine yet
/// to fill it), kept so stage 2 has somewhere to write live connection rows.
#[derive(Debug, FromRow)]
pub struct ConnectionRow {
    pub id: String,
    pub time: String,
    pub client: String,
    pub target: String,
    pub matched_rule: String,
    pub route: String,
    pub bytes_up: i64,
    pub bytes_down: i64,
    pub duration_ms: i64,
    pub status: String,
    pub listener_id: String,
}

impl ConnectionRow {
    pub fn into_model(self) -> Connection {
        Connection {
            id: self.id,
            time: self.time,
            client: self.client,
            target: self.target,
            matched_rule: self.matched_rule,
            route: RouteAction::from_str_opt(&self.route).unwrap_or(RouteAction::Direct),
            bytes_up: self.bytes_up,
            bytes_down: self.bytes_down,
            duration_ms: self.duration_ms,
            status: ConnectionStatus::from_str_opt(&self.status).unwrap_or(ConnectionStatus::Closed),
            listener_id: self.listener_id,
        }
    }
}
