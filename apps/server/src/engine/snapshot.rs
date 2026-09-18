//! Immutable configuration snapshot loaded wholesale from SQLite.
//!
//! The connection hot path never touches the DB directly — it reads
//! whatever `ConfigSnapshot` is currently swapped into the engine's
//! `ArcSwap`. On `Apply`, a brand new snapshot is built and swapped in
//! atomically; nothing ever patches an existing snapshot in place.

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::models::listener::{Listener, ListenerRow};
use crate::models::route_entry::{RouteEntry, RouteEntryRow, RouteTargetKind};
use crate::models::rule_group::RuleGroup;
use crate::models::rule_template::{RuleTemplate, RuleTemplateRow};
use crate::models::settings::Settings;

/// Upstream fields the engine needs to actually dial through it. Kept
/// separate from `models::upstream::Upstream` (the UI-facing struct) so the
/// stored credentials never leak into a JSON response.
#[derive(Debug, Clone)]
pub struct UpstreamTarget {
    pub id: String,
    pub name: String,
    pub scheme: crate::models::upstream::UpstreamScheme,
    pub host: String,
    pub port: i64,
    pub has_auth: bool,
    pub auth_username: String,
    pub auth_password: String,
}

/// A whole point-in-time view of the routing configuration, ready for the
/// engine to match connections against without any further DB access.
pub struct ConfigSnapshot {
    pub listeners: Vec<Listener>,
    /// Route entries, already in `position` order (first match wins).
    pub route_entries: Vec<RouteEntry>,
    /// Rule templates, ordered by `position` *within* their bucket
    /// (group, or the ungrouped bucket) — matches the ordering
    /// `rule_templates.rs` uses for its own listing.
    pub templates: Vec<RuleTemplate>,
    pub groups: Vec<RuleGroup>,
    pub upstreams: Vec<UpstreamTarget>,
    pub settings: Settings,

    pub listeners_by_id: HashMap<String, usize>,
    pub templates_by_id: HashMap<String, usize>,
    pub groups_by_id: HashMap<String, usize>,
    pub upstreams_by_id: HashMap<String, usize>,
    /// Templates belonging to a group, already ordered by position.
    pub templates_by_group: HashMap<String, Vec<usize>>,
}

impl ConfigSnapshot {
    pub fn listener(&self, id: &str) -> Option<&Listener> {
        self.listeners_by_id.get(id).map(|&i| &self.listeners[i])
    }

    pub fn template(&self, id: &str) -> Option<&RuleTemplate> {
        self.templates_by_id.get(id).map(|&i| &self.templates[i])
    }

    pub fn group(&self, id: &str) -> Option<&RuleGroup> {
        self.groups_by_id.get(id).map(|&i| &self.groups[i])
    }

    pub fn upstream(&self, id: &str) -> Option<&UpstreamTarget> {
        self.upstreams_by_id.get(id).map(|&i| &self.upstreams[i])
    }

    /// Templates in `group_id`, in match-priority order, skipping disabled
    /// ones (a disabled template never matches, regardless of the group's
    /// own enabled state).
    pub fn enabled_templates_in_group(&self, group_id: &str) -> impl Iterator<Item = &RuleTemplate> {
        self.templates_by_group
            .get(group_id)
            .into_iter()
            .flatten()
            .map(move |&i| &self.templates[i])
            .filter(|t| t.enabled)
    }

    /// Resolves a route entry's target down to whatever templates it could
    /// possibly match against, or an empty iterator when the entry's target
    /// (or the group it belongs to) is disabled/missing.
    pub fn target_templates<'a>(&'a self, entry: &'a RouteEntry) -> Vec<&'a RuleTemplate> {
        match entry.target_kind {
            RouteTargetKind::Template => match self.template(&entry.target_id) {
                Some(t) if t.enabled => vec![t],
                _ => vec![],
            },
            RouteTargetKind::Group => match self.group(&entry.target_id) {
                Some(g) if g.enabled => self.enabled_templates_in_group(&entry.target_id).collect(),
                _ => vec![],
            },
        }
    }
}

/// Loads the whole configuration from the DB into one fresh, immutable
/// snapshot. Mirrors the same queries stage 1's routes already use for
/// listing, so ordering/semantics match the REST API exactly.
pub async fn load(pool: &SqlitePool) -> anyhow::Result<ConfigSnapshot> {
    let listener_rows = sqlx::query_as::<_, ListenerRow>(
        "SELECT id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections
         FROM listeners ORDER BY rowid",
    )
    .fetch_all(pool)
    .await?;
    let listeners: Vec<Listener> = listener_rows.into_iter().map(ListenerRow::into_model).collect();

    let template_rows = sqlx::query_as::<_, RuleTemplateRow>(
        "SELECT id, name, enabled, match_type, pattern, note, group_id, position FROM rule_templates
         ORDER BY group_id IS NOT NULL, group_id, position",
    )
    .fetch_all(pool)
    .await?;
    let templates: Vec<RuleTemplate> = template_rows.into_iter().map(RuleTemplateRow::into_model).collect();

    let groups: Vec<RuleGroup> =
        sqlx::query_as::<_, RuleGroup>("SELECT id, name, note, enabled FROM rule_groups ORDER BY rowid")
            .fetch_all(pool)
            .await?;

    // (id, name, scheme, host, port, has_auth, auth_username, auth_password)
    type UpstreamRow = (String, String, String, String, i64, bool, String, String);
    let upstream_rows: Vec<UpstreamRow> = sqlx::query_as(
        "SELECT id, name, scheme, host, port, has_auth, auth_username, auth_password FROM upstreams ORDER BY rowid",
    )
    .fetch_all(pool)
    .await?;
    let upstreams: Vec<UpstreamTarget> = upstream_rows
        .into_iter()
        .map(|(id, name, scheme, host, port, has_auth, auth_username, auth_password)| UpstreamTarget {
            id,
            name,
            scheme: crate::models::upstream::UpstreamScheme::from_str_opt(&scheme)
                .unwrap_or(crate::models::upstream::UpstreamScheme::Http),
            host,
            port,
            has_auth,
            auth_username,
            auth_password,
        })
        .collect();

    let entry_rows = sqlx::query_as::<_, RouteEntryRow>(
        "SELECT id, name, enabled, target_kind, target_id, action, upstream_id, note, hits, position
         FROM route_entries ORDER BY position",
    )
    .fetch_all(pool)
    .await?;
    let listener_link_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT route_entry_id, listener_id FROM route_entry_listeners")
            .fetch_all(pool)
            .await?;
    let mut listener_ids_by_entry: HashMap<String, Vec<String>> = HashMap::new();
    for (entry_id, listener_id) in listener_link_rows {
        listener_ids_by_entry.entry(entry_id).or_default().push(listener_id);
    }
    let route_entries: Vec<RouteEntry> = entry_rows
        .into_iter()
        .map(|r| {
            let ids = listener_ids_by_entry.remove(&r.id).unwrap_or_default();
            r.into_model(ids)
        })
        .collect();

    let settings_row: (String, String, bool) =
        sqlx::query_as("SELECT dns_resolve_mode, log_level, access_log FROM settings WHERE id = 1")
            .fetch_one(pool)
            .await?;
    let settings = Settings {
        routing: crate::models::settings::RoutingSettings {
            dns_resolve_mode: crate::models::settings::DnsResolveMode::from_str_opt(&settings_row.0)
                .unwrap_or(crate::models::settings::DnsResolveMode::System),
        },
        logging: crate::models::settings::LoggingSettings {
            level: crate::models::settings::LogLevel::from_str_opt(&settings_row.1)
                .unwrap_or(crate::models::settings::LogLevel::Info),
            access_log: settings_row.2,
        },
    };

    let listeners_by_id = listeners.iter().enumerate().map(|(i, l)| (l.id.clone(), i)).collect();
    let templates_by_id = templates.iter().enumerate().map(|(i, t)| (t.id.clone(), i)).collect();
    let groups_by_id = groups.iter().enumerate().map(|(i, g)| (g.id.clone(), i)).collect();
    let upstreams_by_id = upstreams.iter().enumerate().map(|(i, u)| (u.id.clone(), i)).collect();

    // `templates` was fetched ordered by (group_id, position), so indices
    // pushed here in iteration order are already in position order.
    let mut templates_by_group: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, t) in templates.iter().enumerate() {
        if let Some(group_id) = &t.group_id {
            templates_by_group.entry(group_id.clone()).or_default().push(i);
        }
    }

    Ok(ConfigSnapshot {
        listeners,
        route_entries,
        templates,
        groups,
        upstreams,
        settings,
        listeners_by_id,
        templates_by_id,
        groups_by_id,
        upstreams_by_id,
        templates_by_group,
    })
}
