use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListenerProtocol {
    Http,
    Socks5,
}

impl ListenerProtocol {
    pub fn as_str(&self) -> &'static str {
        match self {
            ListenerProtocol::Http => "http",
            ListenerProtocol::Socks5 => "socks5",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "http" => ListenerProtocol::Http,
            "socks5" => ListenerProtocol::Socks5,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefaultAction {
    Direct,
    Block,
}

impl DefaultAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            DefaultAction::Direct => "direct",
            DefaultAction::Block => "block",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "direct" => DefaultAction::Direct,
            "block" => DefaultAction::Block,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListenerStatus {
    Up,
    Down,
}

impl ListenerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ListenerStatus::Up => "up",
            ListenerStatus::Down => "down",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "up" => ListenerStatus::Up,
            "down" => ListenerStatus::Down,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerAuth {
    pub enabled: bool,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub id: String,
    pub name: String,
    pub protocol: ListenerProtocol,
    pub bind: String,
    pub port: i64,
    pub enabled: bool,
    pub default_action: DefaultAction,
    pub auth: ListenerAuth,
    pub status: ListenerStatus,
    pub connections: i64,
}

#[derive(Debug, FromRow)]
pub struct ListenerRow {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub bind: String,
    pub port: i64,
    pub enabled: bool,
    pub default_action: String,
    pub auth_enabled: bool,
    pub auth_username: String,
    pub auth_password: String,
    pub status: String,
    pub connections: i64,
}

impl ListenerRow {
    pub fn into_model(self) -> Listener {
        Listener {
            id: self.id,
            name: self.name,
            protocol: ListenerProtocol::from_str_opt(&self.protocol).unwrap_or(ListenerProtocol::Http),
            bind: self.bind,
            port: self.port,
            enabled: self.enabled,
            default_action: DefaultAction::from_str_opt(&self.default_action).unwrap_or(DefaultAction::Direct),
            auth: ListenerAuth {
                enabled: self.auth_enabled,
                username: self.auth_username,
                password: self.auth_password,
            },
            status: ListenerStatus::from_str_opt(&self.status).unwrap_or(ListenerStatus::Down),
            connections: self.connections,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerInput {
    pub name: String,
    pub protocol: ListenerProtocol,
    pub bind: String,
    pub port: i64,
    pub enabled: bool,
    pub default_action: DefaultAction,
    pub auth: ListenerAuth,
    #[serde(default = "default_status")]
    pub status: ListenerStatus,
    #[serde(default)]
    pub connections: i64,
}

fn default_status() -> ListenerStatus {
    ListenerStatus::Down
}
