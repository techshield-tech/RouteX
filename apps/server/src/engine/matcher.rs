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

/// Best-effort process-name resolution for `MatchType::Process`, supported
/// on Linux and Windows (macOS and any other OS always returns `None`).
///
/// There is no portable, race-free way for a proxy to learn which local
/// process owns an inbound TCP connection: on Linux this walks
/// `/proc/net/tcp[6]` for a socket matching the connection's local
/// (client-side) address and port, maps its inode to a PID via every
/// `/proc/<pid>/fd/*` symlink, and reads `/proc/<pid>/comm`; on Windows it
/// queries `GetExtendedTcpTable` for the row matching that address and port
/// and resolves the owning PID's exe name via a toolhelp snapshot. On any
/// failure (unsupported host, permission denied, socket already gone, PID
/// owned by another user) this simply returns `None` — process rules never
/// match rather than ever failing or blocking a connection because the
/// lookup didn't pan out.
pub mod process {
    use std::net::SocketAddr;

    /// `local_addr` is the *client's* address as seen by our listener
    /// (i.e. the peer address of the accepted socket) — that's the process
    /// we're trying to identify, not the destination.
    #[cfg(target_os = "linux")]
    pub fn resolve(local_addr: SocketAddr) -> Option<String> {
        let path = if local_addr.is_ipv4() { "/proc/net/tcp" } else { "/proc/net/tcp6" };
        let inode = find_inode(path, local_addr)?;
        let pid = find_pid_for_inode(inode)?;
        process_name(pid)
    }

    /// Same address, resolved via `GetExtendedTcpTable` instead of `/proc`
    /// — see the module doc comment for why this can't be unified further.
    #[cfg(windows)]
    pub fn resolve(local_addr: SocketAddr) -> Option<String> {
        windows_ffi::resolve(local_addr)
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    pub fn resolve(_local_addr: SocketAddr) -> Option<String> {
        None
    }

    #[cfg(target_os = "linux")]
    use std::collections::HashMap;
    #[cfg(target_os = "linux")]
    use std::fs;

    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "linux")]
    fn process_name(pid: u32) -> Option<String> {
        fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim().to_string())
    }

    /// Small cache-free helper kept separate so callers can build a fresh
    /// map once per connection burst if they want to avoid rescanning
    /// `/proc` per-connection; unused today but documents the shape a
    /// batched lookup would take.
    #[cfg(target_os = "linux")]
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

    /// Windows implementation: `GetExtendedTcpTable` with `_ALL` (not
    /// `_LISTENER`) since `local_addr` here is the *peer* socket's local
    /// port, which is typically `ESTABLISHED`, not `LISTEN` — we need to
    /// match any row, not just listening ones.
    #[cfg(windows)]
    mod windows_ffi {
        use std::ffi::c_void;
        use std::net::SocketAddr;

        use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, HANDLE, INVALID_HANDLE_VALUE, NO_ERROR};
        use windows_sys::Win32::NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
            TCP_TABLE_OWNER_PID_ALL,
        };
        use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
        };

        const MAX_ATTEMPTS: usize = 8;

        pub(super) fn resolve(local_addr: SocketAddr) -> Option<String> {
            let pid = if local_addr.is_ipv4() {
                find_owning_pid_v4(local_addr.port())
            } else {
                find_owning_pid_v6(local_addr.port())
            }?;
            process_name(pid)
        }

        fn find_owning_pid_v4(want_port: u16) -> Option<u32> {
            let buf = fetch_table(AF_INET as u32)?;
            // SAFETY: `buf` was allocated to the size `GetExtendedTcpTable`
            // reported and then filled by that same call, so its header is
            // a valid `MIB_TCPTABLE_OWNER_PID`.
            let header = unsafe { &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID) };
            let num_entries = header.dwNumEntries as usize;
            // `table` is the struct's trailing flexible array; the API
            // guarantees `dwNumEntries` rows follow it inside `buf`, and
            // every index used below is `< num_entries`.
            let rows = std::ptr::addr_of!(header.table) as *const MIB_TCPROW_OWNER_PID;
            for i in 0..num_entries {
                // SAFETY: see the bounds reasoning above `rows`.
                let row = unsafe { &*rows.add(i) };
                // `dwLocalPort` carries the port in network byte order in
                // its low 16 bits.
                if u16::from_be(row.dwLocalPort as u16) == want_port {
                    return Some(row.dwOwningPid);
                }
            }
            None
        }

        fn find_owning_pid_v6(want_port: u16) -> Option<u32> {
            let buf = fetch_table(AF_INET6 as u32)?;
            // SAFETY: same reasoning as `find_owning_pid_v4`, for the IPv6
            // table type.
            let header = unsafe { &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID) };
            let num_entries = header.dwNumEntries as usize;
            // See `find_owning_pid_v4` — same flexible-array layout, same
            // `index < num_entries` bound.
            let rows = std::ptr::addr_of!(header.table) as *const MIB_TCP6ROW_OWNER_PID;
            for i in 0..num_entries {
                // SAFETY: see the bounds reasoning above `rows`.
                let row = unsafe { &*rows.add(i) };
                if u16::from_be(row.dwLocalPort as u16) == want_port {
                    return Some(row.dwOwningPid);
                }
            }
            None
        }

        /// Runs `GetExtendedTcpTable`'s two-call convention: first ask for
        /// the required buffer size (expecting `ERROR_INSUFFICIENT_BUFFER`),
        /// then allocate and fill it, retrying if the table grew between
        /// calls. `None` on any error — callers just get no match.
        fn fetch_table(family: u32) -> Option<Vec<u8>> {
            let mut size: u32 = 0;
            // SAFETY: a null table pointer with a valid `size` out-pointer
            // is the documented way to query the required buffer size;
            // nothing is written through `ptcptable`.
            let query = unsafe { GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, family, TCP_TABLE_OWNER_PID_ALL, 0) };
            if query != ERROR_INSUFFICIENT_BUFFER {
                return None;
            }

            for _ in 0..MAX_ATTEMPTS {
                let mut buf = vec![0u8; size as usize];
                // SAFETY: `buf` is exactly `size` bytes, the size this same
                // API just reported as required, satisfying the
                // buffer-size contract for the fill call.
                let result =
                    unsafe { GetExtendedTcpTable(buf.as_mut_ptr() as *mut c_void, &mut size, 0, family, TCP_TABLE_OWNER_PID_ALL, 0) };
                if result == ERROR_INSUFFICIENT_BUFFER {
                    // The table grew between the two calls; `size` was
                    // updated in place, so retry with the new size.
                    continue;
                }
                if result != NO_ERROR {
                    return None;
                }
                return Some(buf);
            }
            None
        }

        /// Resolves a PID to its executable name via a toolhelp snapshot,
        /// which needs no special privileges (unlike `OpenProcess` +
        /// `QueryFullProcessImageNameW`).
        fn process_name(pid: u32) -> Option<String> {
            // SAFETY: `TH32CS_SNAPPROCESS` with a 0 pid snapshots every
            // process in the system; failure is signalled by
            // `INVALID_HANDLE_VALUE`, checked immediately below before the
            // handle is used.
            let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
            if snapshot == INVALID_HANDLE_VALUE {
                return None;
            }
            let name = find_process_name(snapshot, pid);
            // SAFETY: `snapshot` was just checked to be a valid handle
            // created above, and isn't used again after this.
            unsafe {
                CloseHandle(snapshot);
            }
            name
        }

        fn find_process_name(snapshot: HANDLE, pid: u32) -> Option<String> {
            let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            // SAFETY: `entry` is zeroed with `dwSize` set as the API
            // requires before the first call, and `snapshot` is a valid
            // handle from the caller.
            let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
            while ok != 0 {
                if entry.th32ProcessID == pid {
                    return Some(exe_file_name(&entry.szExeFile));
                }
                // SAFETY: `entry` is still the validly-sized
                // `PROCESSENTRY32W` from the previous call, and `snapshot`
                // is unchanged.
                ok = unsafe { Process32NextW(snapshot, &mut entry) };
            }
            None
        }

        fn exe_file_name(raw: &[u16; 260]) -> String {
            let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
            String::from_utf16_lossy(&raw[..len])
        }
    }
}
