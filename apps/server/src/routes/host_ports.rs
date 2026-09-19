use axum::routing::get;
use axum::{Json, Router};
#[cfg(target_os = "linux")]
use std::collections::HashMap;
#[cfg(target_os = "linux")]
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

/// Best-effort, per-OS: on Linux this parses `/proc/net/tcp[6]` for
/// LISTEN-state sockets and maps the inode back to a process name via
/// `/proc/*/fd`; on Windows it queries `GetExtendedTcpTable` for the same
/// LISTEN-state rows and resolves the owning PID's exe name via a toolhelp
/// snapshot. macOS (and any other OS) has no implementation here and always
/// reports every candidate port as free. Any lookup failure (missing
/// /proc, permission denied, a WinAPI error) just yields fewer results —
/// never panics.
async fn list() -> Json<Vec<HostPort>> {
    Json(tokio::task::spawn_blocking(scan).await.unwrap_or_default())
}

#[cfg(target_os = "linux")]
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
#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
fn process_name(pid: u32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
}

/// Windows implementation: `GetExtendedTcpTable` gives us the LISTEN-state
/// rows (with owning PIDs) that `/proc/net/tcp[6]` gives us on Linux, and a
/// toolhelp snapshot gives us PID -> exe name in place of `/proc/{pid}/comm`.
#[cfg(windows)]
fn scan() -> Vec<HostPort> {
    let mut listening = windows_ffi::tcp_listen_ports_v4();
    listening.extend(windows_ffi::tcp_listen_ports_v6());

    CANDIDATE_PORTS
        .iter()
        .map(|&port| match listening.get(&port) {
            Some(&pid) => HostPort {
                port,
                in_use: true,
                process: windows_ffi::process_name(pid),
            },
            None => HostPort {
                port,
                in_use: false,
                process: None,
            },
        })
        .collect()
}

/// Thin wrappers around the `IpHelper`/`ToolHelp` Win32 APIs used to answer
/// the same "who's listening on this port" question `/proc` answers on
/// Linux. Kept in its own module since `GetExtendedTcpTable`'s two-call,
/// variably-sized-buffer convention is verbose.
#[cfg(windows)]
mod windows_ffi {
    use std::collections::HashMap;
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, HANDLE, INVALID_HANDLE_VALUE, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP_STATE_LISTEN, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };

    /// Bound on retries of the size-then-fill dance below; the table can
    /// only grow between our two calls if sockets are opening at a
    /// pathological rate, so this is generous rather than tight.
    const MAX_ATTEMPTS: usize = 8;

    pub fn tcp_listen_ports_v4() -> HashMap<u16, u32> {
        let mut map = HashMap::new();
        let Some(buf) = fetch_table(AF_INET as u32) else {
            return map;
        };
        // SAFETY: `buf` was allocated to the size `GetExtendedTcpTable`
        // asked for and then filled by that same call, so its header is a
        // valid `MIB_TCPTABLE_OWNER_PID`.
        let header = unsafe { &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID) };
        let num_entries = header.dwNumEntries as usize;
        // `table` is the struct's trailing flexible array; the API
        // guarantees `dwNumEntries` rows follow it inside `buf`, and every
        // index used below is `< num_entries`, so each row stays in bounds.
        let rows = std::ptr::addr_of!(header.table) as *const MIB_TCPROW_OWNER_PID;
        for i in 0..num_entries {
            // SAFETY: see the bounds reasoning above `rows`.
            let row = unsafe { &*rows.add(i) };
            if row.dwState == MIB_TCP_STATE_LISTEN as u32 {
                // `dwLocalPort` carries the port in network byte order in
                // its low 16 bits.
                let port = u16::from_be(row.dwLocalPort as u16);
                map.insert(port, row.dwOwningPid);
            }
        }
        map
    }

    pub fn tcp_listen_ports_v6() -> HashMap<u16, u32> {
        let mut map = HashMap::new();
        let Some(buf) = fetch_table(AF_INET6 as u32) else {
            return map;
        };
        // SAFETY: same reasoning as `tcp_listen_ports_v4`, for the IPv6
        // table type.
        let header = unsafe { &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID) };
        let num_entries = header.dwNumEntries as usize;
        // See `tcp_listen_ports_v4` — same flexible-array layout, same
        // `index < num_entries` bound.
        let rows = std::ptr::addr_of!(header.table) as *const MIB_TCP6ROW_OWNER_PID;
        for i in 0..num_entries {
            // SAFETY: see the bounds reasoning above `rows`.
            let row = unsafe { &*rows.add(i) };
            if row.dwState == MIB_TCP_STATE_LISTEN as u32 {
                // Network byte order, low 16 bits — same as the v4 row.
                let port = u16::from_be(row.dwLocalPort as u16);
                map.insert(port, row.dwOwningPid);
            }
        }
        map
    }

    /// Runs `GetExtendedTcpTable`'s two-call convention: first ask for the
    /// required buffer size (expecting `ERROR_INSUFFICIENT_BUFFER`), then
    /// allocate and fill it, retrying if the table grew in between calls.
    /// Returns `None` on any error — callers just see no listeners.
    fn fetch_table(family: u32) -> Option<Vec<u8>> {
        let mut size: u32 = 0;
        // SAFETY: a null table pointer with a valid `size` out-pointer is
        // the documented way to query the required buffer size; nothing is
        // written through `ptcptable`.
        let query = unsafe { GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0) };
        if query != ERROR_INSUFFICIENT_BUFFER {
            return None;
        }

        for _ in 0..MAX_ATTEMPTS {
            let mut buf = vec![0u8; size as usize];
            // SAFETY: `buf` is exactly `size` bytes, the size this same API
            // just reported as required, satisfying the buffer-size
            // contract for the fill call.
            let result = unsafe {
                GetExtendedTcpTable(buf.as_mut_ptr() as *mut c_void, &mut size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0)
            };
            if result == ERROR_INSUFFICIENT_BUFFER {
                // The table grew between the two calls; `size` was updated
                // in place, so retry with the new size.
                continue;
            }
            if result != NO_ERROR {
                return None;
            }
            return Some(buf);
        }
        None
    }

    /// Resolves a PID to its executable name via a toolhelp snapshot, which
    /// needs no special privileges (unlike `OpenProcess` +
    /// `QueryFullProcessImageNameW`).
    pub fn process_name(pid: u32) -> Option<String> {
        // SAFETY: `TH32CS_SNAPPROCESS` with a 0 pid snapshots every process
        // in the system; failure is signalled by `INVALID_HANDLE_VALUE`,
        // checked immediately below before the handle is used.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let name = find_process_name(snapshot, pid);
        // SAFETY: `snapshot` was just checked to be a valid handle created
        // above, and isn't used again after this.
        unsafe {
            CloseHandle(snapshot);
        }
        name
    }

    fn find_process_name(snapshot: HANDLE, pid: u32) -> Option<String> {
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        // SAFETY: `entry` is zeroed with `dwSize` set as the API requires
        // before the first call, and `snapshot` is a valid handle from the
        // caller.
        let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
        while ok != 0 {
            if entry.th32ProcessID == pid {
                return Some(exe_file_name(&entry.szExeFile));
            }
            // SAFETY: `entry` is still the validly-sized `PROCESSENTRY32W`
            // from the previous call, and `snapshot` is unchanged.
            ok = unsafe { Process32NextW(snapshot, &mut entry) };
        }
        None
    }

    fn exe_file_name(raw: &[u16; 260]) -> String {
        let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
        String::from_utf16_lossy(&raw[..len])
    }
}

/// No portable listener-scanning API on this OS (e.g. macOS) — every
/// candidate port is just reported as free rather than guessing.
#[cfg(not(any(target_os = "linux", windows)))]
fn scan() -> Vec<HostPort> {
    CANDIDATE_PORTS
        .iter()
        .map(|&port| HostPort {
            port,
            in_use: false,
            process: None,
        })
        .collect()
}
