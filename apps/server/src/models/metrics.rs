use serde::{Deserialize, Serialize};

use super::connection::Connection;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPoint {
    pub t: i64,
    pub proxied: f64,
    pub direct: f64,
}

/// Selectable windows for the Overview traffic chart. `15m` is served from
/// the in-memory ring (`MetricsState`); the others are grouped queries over
/// the persisted `traffic_samples` table.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum TrafficRange {
    #[serde(rename = "15m")]
    FifteenMin,
    #[serde(rename = "1h")]
    OneHour,
    #[serde(rename = "7d")]
    SevenDays,
    #[serde(rename = "30d")]
    ThirtyDays,
}

impl TrafficRange {
    /// How far back this range looks, in seconds.
    pub fn window_secs(self) -> i64 {
        match self {
            TrafficRange::FifteenMin => 900,
            TrafficRange::OneHour => 3_600,
            TrafficRange::SevenDays => 604_800,
            TrafficRange::ThirtyDays => 2_592_000,
        }
    }

    /// Width of one bucket this range groups samples into, in seconds. Chosen
    /// so each range renders a bounded number of points (~60-180) regardless
    /// of how much history is behind it.
    pub fn bucket_secs(self) -> i64 {
        match self {
            TrafficRange::FifteenMin => 10,
            TrafficRange::OneHour => 60,
            TrafficRange::SevenDays => 3_600,
            TrafficRange::ThirtyDays => 14_400,
        }
    }
}

/// `/api/metrics/traffic` payload: the requested range's points, plus the
/// bucket width so the UI can pick the right x-axis tick unit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficSeries {
    pub range: TrafficRange,
    pub bucket_seconds: i64,
    pub points: Vec<TrafficPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopRule {
    pub name: String,
    pub hits: i64,
    pub share: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub active_connections: i64,
    pub throughput_up_bps: f64,
    pub throughput_down_bps: f64,
    pub proxied_share_pct: f64,
    pub direct_share_pct: f64,
    pub rules_enabled: i64,
    pub rules_total: i64,
    pub uptime_seconds: i64,
    pub traffic: Vec<TrafficPoint>,
    pub top_rules: Vec<TopRule>,
    pub recent_connections: Vec<Connection>,
}
