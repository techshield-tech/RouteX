//! Walks route entries for one listener and picks the first match.

use crate::models::route_entry::RouteAction;

use super::matcher::{self, MatchRequest};
use super::snapshot::ConfigSnapshot;

#[derive(Debug, Clone)]
pub struct RouteDecision {
    pub action: RouteAction,
    pub upstream_id: Option<String>,
    /// Name of the rule template that matched, or the listener's own name
    /// with a "default" marker when nothing matched.
    pub matched_rule: String,
    /// `None` when the decision came from the listener's `defaultAction`
    /// rather than an actual route entry (so there's nothing to bump
    /// `hits` on).
    pub route_entry_id: Option<String>,
}

/// Routes one connection attempt on `listener_id` through `snapshot`'s
/// route entries, in `position` order — first match wins. Falls back to
/// the listener's `defaultAction` when nothing matches (or the listener
/// itself is unknown, which shouldn't happen in practice).
pub fn route(snapshot: &ConfigSnapshot, listener_id: &str, req: &MatchRequest) -> RouteDecision {
    for entry in &snapshot.route_entries {
        if !entry.enabled {
            continue;
        }
        if !entry.listener_ids.iter().any(|id| id == listener_id) {
            continue;
        }
        let templates = snapshot.target_templates(entry);
        if let Some(t) = templates.into_iter().find(|t| matcher::matches(t, req)) {
            return RouteDecision {
                action: entry.action,
                upstream_id: entry.upstream_id.clone(),
                matched_rule: t.name.clone(),
                route_entry_id: Some(entry.id.clone()),
            };
        }
    }

    let default_action = snapshot
        .listener(listener_id)
        .map(|l| match l.default_action {
            crate::models::listener::DefaultAction::Direct => RouteAction::Direct,
            crate::models::listener::DefaultAction::Block => RouteAction::Block,
        })
        .unwrap_or(RouteAction::Block);

    RouteDecision {
        action: default_action,
        upstream_id: None,
        matched_rule: "default".to_string(),
        route_entry_id: None,
    }
}
