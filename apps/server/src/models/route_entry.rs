use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteAction {
    Proxy,
    Direct,
    Block,
}

impl RouteAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            RouteAction::Proxy => "proxy",
            RouteAction::Direct => "direct",
            RouteAction::Block => "block",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "proxy" => RouteAction::Proxy,
            "direct" => RouteAction::Direct,
            "block" => RouteAction::Block,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteTargetKind {
    Template,
    Group,
}

impl RouteTargetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            RouteTargetKind::Template => "template",
            RouteTargetKind::Group => "group",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "template" => RouteTargetKind::Template,
            "group" => RouteTargetKind::Group,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntry {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub listener_ids: Vec<String>,
    pub target_kind: RouteTargetKind,
    pub target_id: String,
    pub action: RouteAction,
    pub upstream_id: Option<String>,
    pub note: String,
    pub hits: i64,
}

/// The `route_entries` row alone, without the joined listener ids — those
/// are fetched separately from `route_entry_listeners` and stitched on.
#[derive(Debug, FromRow)]
pub struct RouteEntryRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub target_kind: String,
    pub target_id: String,
    pub action: String,
    pub upstream_id: Option<String>,
    pub note: String,
    pub hits: i64,
    // Needed so `FromRow` matches the SELECT column list; ordering itself
    // is handled by `ORDER BY position` in the query, not read back here.
    #[allow(dead_code)]
    pub position: i64,
}

impl RouteEntryRow {
    pub fn into_model(self, listener_ids: Vec<String>) -> RouteEntry {
        RouteEntry {
            id: self.id,
            name: self.name,
            enabled: self.enabled,
            listener_ids,
            target_kind: RouteTargetKind::from_str_opt(&self.target_kind).unwrap_or(RouteTargetKind::Template),
            target_id: self.target_id,
            action: RouteAction::from_str_opt(&self.action).unwrap_or(RouteAction::Direct),
            upstream_id: self.upstream_id,
            note: self.note,
            hits: self.hits,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntryInput {
    pub name: String,
    pub enabled: bool,
    pub listener_ids: Vec<String>,
    pub target_kind: RouteTargetKind,
    pub target_id: String,
    pub action: RouteAction,
    pub upstream_id: Option<String>,
    pub note: String,
    #[serde(default)]
    pub hits: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderRouteEntriesRequest {
    pub ordered_ids: Vec<String>,
}
