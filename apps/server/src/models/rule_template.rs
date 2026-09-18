use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchType {
    Domain,
    DomainSuffix,
    DomainKeyword,
    Ip,
    Cidr,
    Port,
    Process,
}

impl MatchType {
    /// String form stored in the DB and used by validation — matches the
    /// wire format exactly, so this doubles as the serde tag.
    pub fn as_str(&self) -> &'static str {
        match self {
            MatchType::Domain => "domain",
            MatchType::DomainSuffix => "domain-suffix",
            MatchType::DomainKeyword => "domain-keyword",
            MatchType::Ip => "ip",
            MatchType::Cidr => "cidr",
            MatchType::Port => "port",
            MatchType::Process => "process",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Some(match s {
            "domain" => MatchType::Domain,
            "domain-suffix" => MatchType::DomainSuffix,
            "domain-keyword" => MatchType::DomainKeyword,
            "ip" => MatchType::Ip,
            "cidr" => MatchType::Cidr,
            "port" => MatchType::Port,
            "process" => MatchType::Process,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleTemplate {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub match_type: MatchType,
    pub pattern: String,
    pub note: String,
    pub group_id: Option<String>,
}

/// Raw row as sqlx sees it — plain strings/ints, no enum decoding, so we
/// stay on the runtime query API without a `Type` impl per enum.
#[derive(Debug, FromRow)]
pub struct RuleTemplateRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub match_type: String,
    pub pattern: String,
    pub note: String,
    pub group_id: Option<String>,
    // Needed so `FromRow` matches the SELECT column list; ordering itself
    // is handled by `ORDER BY position` in the query, not read back here.
    #[allow(dead_code)]
    pub position: i64,
}

impl RuleTemplateRow {
    pub fn into_model(self) -> RuleTemplate {
        RuleTemplate {
            id: self.id,
            name: self.name,
            enabled: self.enabled,
            match_type: MatchType::from_str_opt(&self.match_type).unwrap_or(MatchType::Domain),
            pattern: self.pattern,
            note: self.note,
            group_id: self.group_id,
        }
    }
}

/// Body for create/update requests — same shape minus server-assigned id.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleTemplateInput {
    pub name: String,
    pub enabled: bool,
    pub match_type: MatchType,
    pub pattern: String,
    pub note: String,
    pub group_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTemplatesRequest {
    pub group_id: Option<String>,
    pub ordered_ids: Vec<String>,
}
