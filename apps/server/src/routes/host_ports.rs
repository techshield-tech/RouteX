use axum::routing::get;
use axum::{Json, Router};
use std::collections::HashMap;
use std::fs;

use crate::models::host_port::HostPort;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list))
}

/// Reasonable candidate set for the listener form's "pick a free port"
/// panel — common service ports plus RouteX's own defaults, same list the
/// old UI mock used (`apps/ui/src/mock/ports.ts`).
const CANDIDATE_PORTS: &[u16] = &[
    22, 80, 443, 3306, 5432, 6379, 9000, 8080, 1080, 8081, 4000, 8000, 8888, 1081, 3128, 9050, 10800,
];

/// Linux-specific, best-effort: parses `/proc/net/tcp[6]` for LISTEN-state
/// sockets and maps the inode back to a process name via `/proc/*/fd`. Any
/// read failure (missing /proc, permission denied, non-Linux host) just
/// yields fewer results — never panics.
async fn list() -> Json<Vec<HostPort>> {
    Json(tokio::task::spawn_blocking(scan).await.unwrap_or_default())
}

fn scan() -> Vec<HostPort> {
    let mut listening = parse_listening_ports("/proc/net/tcp");
    listening.extend(parse_listening_ports("/proc/net/tcp6"));
    let inode_pid = build_inode_pid_map();

    CANDIDATE_PORTS
        .iter()
        .map(|&port| match listening.get(&port) {
            Some(inode) => HostPort {
                port,
                in_use: true,
                process: inode_pid.get(inode).and_then(|&pid| process_name(pid)),
            },
            None => HostPort {
                port,
                in_use: false,
                process: None,
            },
        })
        .collect()
}

/// `st` column `0A` is `TCP_LISTEN`. Column layout:
/// `sl local_address rem_address st tx:rx tr:tm retrnsmt uid timeout inode`.
fn parse_listening_ports(path: &str) -> HashMap<u16, u64> {
    let mut map = HashMap::new();
    let Ok(content) = fs::read_to_string(path) else {
        return map;
    };
    for line in content.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 10 || fields[3] != "0A" {
            continue;
        }
        let Some(port_hex) = fields[1].split(':').nth(1) else {
            continue;
        };
        let Ok(port) = u16::from_str_radix(port_hex, 16) else {
            continue;
        };
        let Ok(inode) = fields[9].parse::<u64>() else {
            continue;
        };
        map.insert(port, inode);
    }
    map
}

fn build_inode_pid_map() -> HashMap<u64, u32> {
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

fn process_name(pid: u32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
}
