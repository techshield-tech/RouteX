use std::env;

/// Process-wide config, read once from env at startup.
pub struct Config {
    pub db_path: String,
    pub api_addr: String,
    pub session_ttl_hours: i64,
    pub ui_dir: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            db_path: env::var("ROUTEX_DB").unwrap_or_else(|_| "routex.db".to_string()),
            api_addr: env::var("ROUTEX_API_ADDR").unwrap_or_else(|_| "127.0.0.1:8090".to_string()),
            session_ttl_hours: env::var("ROUTEX_SESSION_TTL_HOURS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(24),
            ui_dir: env::var("ROUTEX_UI_DIR").unwrap_or_else(|_| default_ui_dir()),
        }
    }
}

/// Packaged installs ship `ui/` next to the binary, so default to that
/// rather than the cwd (which for a systemd service is the data dir).
fn default_ui_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("ui")))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ui".to_string())
}
