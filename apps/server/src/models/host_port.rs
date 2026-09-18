use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPort {
    pub port: u16,
    pub in_use: bool,
    pub process: Option<String>,
}
