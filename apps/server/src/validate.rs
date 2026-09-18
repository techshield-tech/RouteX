//! Pattern validation per `MatchType`, mirroring `apps/ui/src/lib/validateRule.ts`.
//! Error codes are machine-readable only — the UI supplies its own wording.

use crate::error::AppError;
use crate::models::rule_template::MatchType;

fn valid_octet(s: &str) -> bool {
    if s.is_empty() || s.len() > 3 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if s.len() > 1 && s.starts_with('0') {
        return false; // no leading zeros, matches the JS octet regex
    }
    matches!(s.parse::<u32>(), Ok(n) if n <= 255)
}

fn valid_ipv4(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| valid_octet(p))
}

fn valid_cidr_prefix(s: &str) -> bool {
    if s.is_empty() || s.len() > 2 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if s.len() > 1 && s.starts_with('0') {
        return false;
    }
    matches!(s.parse::<u32>(), Ok(n) if n <= 32)
}

fn valid_cidr(value: &str) -> bool {
    match value.split_once('/') {
        Some((ip, prefix)) => valid_ipv4(ip) && valid_cidr_prefix(prefix),
        None => false,
    }
}

fn valid_domain_label(label: &str) -> bool {
    let chars: Vec<char> = label.chars().collect();
    if chars.is_empty() {
        return false;
    }
    let first_ok = |c: char| c.is_ascii_alphanumeric() || c == '*';
    if !first_ok(chars[0]) {
        return false;
    }
    if chars.len() == 1 {
        return true;
    }
    let last = chars[chars.len() - 1];
    if !last.is_ascii_alphanumeric() {
        return false;
    }
    chars[1..chars.len() - 1]
        .iter()
        .all(|c| c.is_ascii_alphanumeric() || *c == '-')
}

fn valid_domain_pattern(value: &str) -> bool {
    !value.is_empty() && value.split('.').all(valid_domain_label)
}

fn valid_port(value: &str) -> bool {
    match value.parse::<i64>() {
        Ok(n) => (1..=65535).contains(&n),
        Err(_) => false,
    }
}

/// Returns `Ok(())` when `pattern` is valid for `match_type`, or a
/// `Validation` error carrying a machine-readable code otherwise.
pub fn validate_pattern(match_type: MatchType, pattern: &str) -> Result<(), AppError> {
    let value = pattern.trim();
    if value.is_empty() {
        return Err(AppError::Validation("pattern_empty".to_string()));
    }
    let ok = match match_type {
        MatchType::Ip => valid_ipv4(value),
        MatchType::Cidr => valid_cidr(value),
        MatchType::Port => valid_port(value),
        MatchType::Domain | MatchType::DomainSuffix => valid_domain_pattern(value),
        MatchType::DomainKeyword | MatchType::Process => true,
    };
    if ok {
        Ok(())
    } else {
        let code = match match_type {
            MatchType::Ip => "pattern_invalid_ip",
            MatchType::Cidr => "pattern_invalid_cidr",
            MatchType::Port => "pattern_invalid_port",
            MatchType::Domain | MatchType::DomainSuffix => "pattern_invalid_domain",
            MatchType::DomainKeyword | MatchType::Process => "pattern_invalid",
        };
        Err(AppError::Validation(code.to_string()))
    }
}
