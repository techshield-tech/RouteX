//! Matches a connection's request against a single `RuleTemplate`.
//!
//! Pattern *syntax* is validated at write time by `validate.rs` (mirroring
//! `apps/ui/src/lib/validateRule.ts`); this module implements the runtime
//! matching *semantics* for each `MatchType` against a live connection.

use std::net::{IpAddr, SocketAddr};

use ipnet::IpNet;

use crate::models::rule_template::{MatchType, RuleTemplate};

/// Everything about a connection attempt that a rule might match on. Any
/// field can be missing — e.g. `ip` is only known once a hostname has been
/// resolved, and `process` is only ever known best-effort on Linux.
#[derive(Debug, Clone, Default)]
pub struct MatchRequest {
    pub host: Option<String>,
    pub ip: Option<IpAddr>,
    pub port: u16,
    pub process: Option<String>,
}

/// Returns whether `template` matches `req`. A template that needs
/// information the request doesn't have (e.g. a `domain` rule when only an
/// IP-literal destination is known) simply never matches — it never errors
/// or fails the connection.
pub fn matches(template: &RuleTemplate, req: &MatchRequest) -> bool {
    match template.match_type {
        MatchType::Domain => req
            .host
            .as_deref()
            .is_some_and(|h| h.eq_ignore_ascii_case(&template.pattern)),
        MatchType::DomainSuffix => req.host.as_deref().is_some_and(|h| domain_suffix_match(h, &template.pattern)),
        MatchType::DomainKeyword => req
            .host
            .as_deref()
            .is_some_and(|h| h.to_ascii_lowercase().contains(&template.pattern.to_ascii_lowercase())),
        MatchType::Ip => req.ip.is_some_and(|ip| match template.pattern.parse::<IpAddr>() {
            Ok(pat_ip) => pat_ip == ip,
            Err(_) => false,
        }),
        MatchType::Cidr => req.ip.is_some_and(|ip| match template.pattern.parse::<IpNet>() {
            Ok(net) => net.contains(&ip),
            Err(_) => false,
        }),
        MatchType::Port => match template.pattern.parse::<u16>() {
            Ok(p) => p == req.port,
            Err(_) => false,
        },
        MatchType::Process => req
            .process
            .as_deref()
            .is_some_and(|p| p.eq_ignore_ascii_case(&template.pattern)),
    }
}

/// Runs the best-effort `/proc` process lookup on a blocking thread (it
/// does a handful of synchronous filesystem reads) and hands back the
/// process name, or `None` on any failure — never fails the connection.
pub async fn resolve_process(peer_addr: SocketAddr) -> Option<String> {
    tokio::task::spawn_blocking(move || process::resolve(peer_addr)).await.ok().flatten()
}

/// Suffix match on label boundaries: `example.com` matches `example.com`
/// itself and `a.example.com`, but NOT `notexample.com` — the match must
/// land exactly on a `.`-separated label boundary, never mid-label.
fn domain_suffix_match(host: &str, pattern: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let pattern = pattern.to_ascii_lowercase();
    host == pattern || host.ends_with(&format!(".{pattern}"))
}

/// Best-effort process-name resolution for `MatchType::Process`, Linux only.
///
/// There is no portable, race-free way for a proxy to learn which local
/// process owns an inbound TCP connection; this walks `/proc/net/tcp[6]`
/// for a socket matching the connection's local (client-side) address and
/// port, maps its inode to a PID via every `/proc/<pid>/fd/*` symlink, and
/// reads `/proc/<pid>/comm`. On any failure (non-Linux host, permission
/// denied, socket already gone, PID owned by another user) this simply
/// returns `None` — process rules never match rather than ever failing or
/// blocking a connection because the lookup didn't pan out.
pub mod process {
    use std::collections::HashMap;
    use std::fs;
    use std::net::SocketAddr;

    /// `local_addr` is the *client's* address as seen by our listener
    /// (i.e. the peer address of the accepted socket) — that's the process
    /// we're trying to identify, not the destination.
    pub fn resolve(local_addr: SocketAddr) -> Option<String> {
        let path = if local_addr.is_ipv4() { "/proc/net/tcp" } else { "/proc/net/tcp6" };
        let inode = find_inode(path, local_addr)?;
        let pid = find_pid_for_inode(inode)?;
        process_name(pid)
    }

    fn find_inode(path: &str, addr: SocketAddr) -> Option<u64> {
        let content = fs::read_to_string(path).ok()?;
        let want_port = addr.port();
        for line in content.lines().skip(1) {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 10 {
                continue;
            }
            // Column 1 is `local_address` as `HEXIP:HEXPORT`.
            let mut parts = fields[1].split(':');
            let (Some(_ip_hex), Some(port_hex)) = (parts.next(), parts.next()) else {
                continue;
            };
            let Ok(port) = u16::from_str_radix(port_hex, 16) else {
                continue;
            };
            if port != want_port {
                continue;
            }
            if let Ok(inode) = fields[9].parse::<u64>() {
                return Some(inode);
            }
        }
        None
    }

    fn find_pid_for_inode(inode: u64) -> Option<u32> {
        let entries = fs::read_dir("/proc").ok()?;
        for entry in entries.flatten() {
            let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            let Ok(fds) = fs::read_dir(entry.path().join("fd")) else {
                continue;
            };
            for fd in fds.flatten() {
                let Ok(link) = fs::read_link(fd.path()) else {
                    continue;
                };
                let link = link.to_string_lossy();
                if let Some(inode_str) = link.strip_prefix("socket:[").and_then(|s| s.strip_suffix(']'))
                    && inode_str.parse::<u64>() == Ok(inode)
                {
                    return Some(pid);
                }
            }
        }
        None
    }

    fn process_name(pid: u32) -> Option<String> {
        fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim().to_string())
    }

    /// Small cache-free helper kept separate so callers can build a fresh
    /// map once per connection burst if they want to avoid rescanning
    /// `/proc` per-connection; unused today but documents the shape a
    /// batched lookup would take.
    #[allow(dead_code)]
    pub fn build_inode_pid_map() -> HashMap<u64, u32> {
        let mut map = HashMap::new();
        let Ok(entries) = fs::read_dir("/proc") else {
            return map;
        };
        for entry in entries.flatten() {
            let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            let Ok(fds) = fs::read_dir(entry.path().join("fd")) else {
                continue;
            };
            for fd in fds.flatten() {
                let Ok(link) = fs::read_link(fd.path()) else {
                    continue;
                };
                let link = link.to_string_lossy();
                if let Some(inode_str) = link.strip_prefix("socket:[").and_then(|s| s.strip_suffix(']'))
                    && let Ok(inode) = inode_str.parse::<u64>()
                {
                    map.entry(inode).or_insert(pid);
                }
            }
        }
        map
    }
}
