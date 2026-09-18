use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpstreamScheme {
    Http,
    Socks5,
}

impl UpstreamScheme {
    pub fn as_str(&self) -> &'static str {
        match self {
            UpstreamScheme::Http => "http",
            UpstreamScheme::Socks5 => "socks5",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "http" => UpstreamScheme::Http,
            "socks5" => UpstreamScheme::Socks5,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpstreamHealth {
    Healthy,
    Degraded,
    Unreachable,
}

impl UpstreamHealth {
    pub fn as_str(&self) -> &'static str {
        match self {
            UpstreamHealth::Healthy => "healthy",
            UpstreamHealth::Degraded => "degraded",
            UpstreamHealth::Unreachable => "unreachable",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "healthy" => UpstreamHealth::Healthy,
            "degraded" => UpstreamHealth::Degraded,
            "unreachable" => UpstreamHealth::Unreachable,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    pub id: String,
    pub name: String,
    pub scheme: UpstreamScheme,
    pub host: String,
    pub port: i64,
    pub has_auth: bool,
    pub health: UpstreamHealth,
    pub latency_ms: Option<i64>,
}

/// `auth_username`/`auth_password` back the engine's real dial credentials
/// (see the `upstreams` schema comment) — never surfaced on `Upstream`
/// itself. `engine::snapshot` reads them with its own query instead of
/// this row type, so they're never read back out of `UpstreamRow`; kept
/// here only so routes that `SELECT` the full column list can decode into
/// one struct.
#[derive(Debug, FromRow)]
pub struct UpstreamRow {
    pub id: String,
    pub name: String,
    pub scheme: String,
    pub host: String,
    pub port: i64,
    pub has_auth: bool,
    pub health: String,
    pub latency_ms: Option<i64>,
    #[allow(dead_code)]
    pub auth_username: String,
    #[allow(dead_code)]
    pub auth_password: String,
}

impl UpstreamRow {
    pub fn into_model(self) -> Upstream {
        Upstream {
            id: self.id,
            name: self.name,
            scheme: UpstreamScheme::from_str_opt(&self.scheme).unwrap_or(UpstreamScheme::Http),
            host: self.host,
            port: self.port,
            has_auth: self.has_auth,
            health: UpstreamHealth::from_str_opt(&self.health).unwrap_or(UpstreamHealth::Unreachable),
            latency_ms: self.latency_ms,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamInput {
    pub name: String,
    pub scheme: UpstreamScheme,
    pub host: String,
    pub port: i64,
    pub has_auth: bool,
    pub health: UpstreamHealth,
    pub latency_ms: Option<i64>,
    /// Write-only; omitted entirely from `Upstream` responses so the UI's
    /// existing JSON contract doesn't change. `None` on an update leaves
    /// the stored credential untouched.
    #[serde(default)]
    pub auth_username: Option<String>,
    #[serde(default)]
    pub auth_password: Option<String>,
}
