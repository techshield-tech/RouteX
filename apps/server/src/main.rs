mod config;
mod db;
mod engine;
mod error;
mod models;
mod routes;
mod state;
mod validate;

use std::path::PathBuf;

use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use config::Config;
use engine::Engine;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env();
    let pool = db::init(&config.db_path).await?;

    let engine = Engine::new(pool.clone()).await?;
    for failure in engine.start().await {
        tracing::warn!("listener {} failed to start: {}", failure.listener_id, failure.message);
    }

    let state = AppState { pool, engine, session_ttl_hours: config.session_ttl_hours };

    // This is an admin API meant for local/dev use behind the Vite dev
    // server (any port on localhost), not a public-facing service, so
    // permissive CORS is simpler than maintaining an origin allowlist that
    // breaks every time the dev server's port changes.
    let mut app = routes::build(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    // `/api/*` is nested inside `routes::build`, so it's matched before the
    // outer router ever consults this fallback — safe to serve the built UI
    // (and its client-side routes) for everything else.
    let ui_dir = PathBuf::from(&config.ui_dir);
    if ui_dir.is_dir() {
        let serve_ui = ServeDir::new(&ui_dir).fallback(ServeFile::new(ui_dir.join("index.html")));
        app = app.fallback_service(serve_ui);
    } else {
        tracing::warn!("UI directory {} not found, serving API only", ui_dir.display());
    }

    let listener = tokio::net::TcpListener::bind(&config.api_addr).await?;
    tracing::info!("listening on {}", config.api_addr);
    axum::serve(listener, app).await?;

    Ok(())
}
