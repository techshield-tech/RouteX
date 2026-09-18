mod auth;
mod config_apply;
mod connections;
mod host_ports;
mod listeners;
mod metrics;
mod route_entries;
mod rule_groups;
mod rule_templates;
mod settings;
mod upstreams;

use axum::Router;
use axum::middleware::from_fn_with_state;

use crate::state::AppState;

pub fn build(state: AppState) -> Router {
    // Everything except `/auth/status`, `/auth/setup` and `/auth/login`
    // requires a valid session — enforced once here via `route_layer`
    // rather than per-handler.
    let protected = Router::new()
        .nest("/rule-templates", rule_templates::router())
        .nest("/rule-groups", rule_groups::router())
        .nest("/route-entries", route_entries::router())
        .nest("/upstreams", upstreams::router())
        .nest("/listeners", listeners::router())
        .nest("/settings", settings::router())
        .nest("/metrics", metrics::router())
        .nest("/connections", connections::router())
        .nest("/host-ports", host_ports::router())
        .nest("/config/apply", config_apply::router())
        .nest("/auth", auth::protected_router())
        .route_layer(from_fn_with_state(state.clone(), auth::require_auth));

    let api = Router::new().nest("/auth", auth::public_router()).merge(protected);

    Router::new().nest("/api", api).with_state(state)
}
