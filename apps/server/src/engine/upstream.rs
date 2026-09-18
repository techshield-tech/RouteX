//! Opens the outbound leg of a connection: direct dial, block, or relay
//! through a configured upstream (HTTP `CONNECT` or a SOCKS5 client
//! handshake).

use std::io;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::models::settings::DnsResolveMode;
use crate::models::upstream::UpstreamScheme;

use super::snapshot::UpstreamTarget;

const DIAL_TIMEOUT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Destination of the connection being proxied, as asked for by the
/// client (SOCKS5 address, HTTP CONNECT host, or absolute-form request).
#[derive(Debug, Clone)]
pub struct Target {
    pub host: String,
    pub port: u16,
}

#[derive(Debug)]
pub enum DialError {
    /// The destination is a hostname but `dnsResolveMode` is `off`.
    DnsResolutionDisabled,
    /// Local resolution (system mode, or direct/off fallback) failed.
    ResolutionFailed,
    /// TCP connect (or the whole operation) timed out.
    Timeout,
    /// TCP connect was refused or otherwise failed at the OS level.
    ConnectionRefused,
    /// Upstream proxy handshake failed (bad greeting, auth rejected, etc).
    UpstreamHandshakeFailed(String),
    /// Upstream id referenced by the route entry doesn't exist in the
    /// current snapshot (e.g. deleted after the entry was created).
    UpstreamNotFound,
}

impl DialError {
    /// Health this outcome should record against the upstream that was
    /// dialed through, when applicable.
    pub fn upstream_health(&self) -> crate::models::upstream::UpstreamHealth {
        use crate::models::upstream::UpstreamHealth;
        match self {
            DialError::Timeout => UpstreamHealth::Degraded,
            _ => UpstreamHealth::Unreachable,
        }
    }
}

/// Resolves `target` per `dns_mode`, returning either a concrete socket
/// address to dial directly, or (when delegating resolution to an
/// upstream in `remote` mode) the original host/port pair unresolved.
pub enum Resolved {
    Addr(SocketAddr),
    Hostname(String, u16),
}

async fn resolve_direct(target: &Target, dns_mode: DnsResolveMode) -> Result<Resolved, DialError> {
    if let Ok(ip) = target.host.parse::<IpAddr>() {
        return Ok(Resolved::Addr(SocketAddr::new(ip, target.port)));
    }
    match dns_mode {
        DnsResolveMode::Off => Err(DialError::DnsResolutionDisabled),
        // `remote` only makes sense when an upstream is actually doing the
        // resolving; a direct dial has nobody to delegate to, so it falls
        // back to resolving locally, same as `system`.
        DnsResolveMode::System | DnsResolveMode::Remote => {
            let addr = format!("{}:{}", target.host, target.port);
            match timeout(DIAL_TIMEOUT, tokio::net::lookup_host(&addr)).await {
                Ok(Ok(mut addrs)) => addrs.next().map(Resolved::Addr).ok_or(DialError::ResolutionFailed),
                Ok(Err(_)) => Err(DialError::ResolutionFailed),
                Err(_) => Err(DialError::Timeout),
            }
        }
    }
}

/// Resolves `target` for a `proxy` action: in `remote` mode the hostname
/// is handed to the upstream unresolved; `system` resolves locally first
/// (so the upstream only ever sees an IP); `off` requires an IP literal.
async fn resolve_for_proxy(target: &Target, dns_mode: DnsResolveMode) -> Result<Resolved, DialError> {
    if let Ok(ip) = target.host.parse::<IpAddr>() {
        return Ok(Resolved::Addr(SocketAddr::new(ip, target.port)));
    }
    match dns_mode {
        DnsResolveMode::Off => Err(DialError::DnsResolutionDisabled),
        DnsResolveMode::Remote => Ok(Resolved::Hostname(target.host.clone(), target.port)),
        DnsResolveMode::System => {
            let addr = format!("{}:{}", target.host, target.port);
            match timeout(DIAL_TIMEOUT, tokio::net::lookup_host(&addr)).await {
                Ok(Ok(mut addrs)) => addrs.next().map(Resolved::Addr).ok_or(DialError::ResolutionFailed),
                Ok(Err(_)) => Err(DialError::ResolutionFailed),
                Err(_) => Err(DialError::Timeout),
            }
        }
    }
}

async fn tcp_connect(addr: SocketAddr) -> Result<TcpStream, DialError> {
    match timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(_)) => Err(DialError::ConnectionRefused),
        Err(_) => Err(DialError::Timeout),
    }
}

/// Dials straight to `target`, resolving per `dns_mode`.
pub async fn dial_direct(target: &Target, dns_mode: DnsResolveMode) -> Result<TcpStream, DialError> {
    match resolve_direct(target, dns_mode).await? {
        Resolved::Addr(addr) => tcp_connect(addr).await,
        // `resolve_direct` never returns `Hostname`.
        Resolved::Hostname(..) => unreachable!(),
    }
}

/// Dials `target` through `upstream`, resolving per `dns_mode`, and
/// returns a ready-to-relay TCP stream to the upstream proxy (the CONNECT
/// / SOCKS5 handshake has already completed).
pub async fn dial_via_upstream(
    target: &Target,
    upstream: &UpstreamTarget,
    dns_mode: DnsResolveMode,
) -> Result<TcpStream, DialError> {
    let resolved = resolve_for_proxy(target, dns_mode).await?;

    let upstream_addr = match upstream.host.parse::<IpAddr>() {
        Ok(ip) => SocketAddr::new(ip, upstream.port as u16),
        Err(_) => {
            let addr = format!("{}:{}", upstream.host, upstream.port);
            match timeout(DIAL_TIMEOUT, tokio::net::lookup_host(&addr)).await {
                Ok(Ok(mut addrs)) => addrs.next().ok_or(DialError::ResolutionFailed)?,
                Ok(Err(_)) => return Err(DialError::ResolutionFailed),
                Err(_) => return Err(DialError::Timeout),
            }
        }
    };
    let mut stream = tcp_connect(upstream_addr).await?;

    match upstream.scheme {
        UpstreamScheme::Http => http_connect_handshake(&mut stream, &resolved, upstream).await?,
        UpstreamScheme::Socks5 => socks5_client_handshake(&mut stream, &resolved, upstream).await?,
    }

    Ok(stream)
}

fn target_host_port(resolved: &Resolved) -> (String, u16) {
    match resolved {
        Resolved::Addr(addr) => (addr.ip().to_string(), addr.port()),
        Resolved::Hostname(host, port) => (host.clone(), *port),
    }
}

async fn http_connect_handshake(
    stream: &mut TcpStream,
    target: &Resolved,
    upstream: &UpstreamTarget,
) -> Result<(), DialError> {
    let (host, port) = target_host_port(target);
    let mut request = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n");
    if upstream.has_auth {
        let creds = format!("{}:{}", upstream.auth_username, upstream.auth_password);
        let encoded = base64::engine::general_purpose::STANDARD.encode(creds);
        request.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    request.push_str("Proxy-Connection: Keep-Alive\r\n\r\n");

    timeout(HANDSHAKE_TIMEOUT, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_| DialError::Timeout)?
        .map_err(|e| DialError::UpstreamHandshakeFailed(e.to_string()))?;

    // Read just enough of the response to see the status line and consume
    // the header block up to the blank line — we don't need the headers.
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(DialError::Timeout);
        }
        let n = timeout(HANDSHAKE_TIMEOUT, stream.read(&mut byte))
            .await
            .map_err(|_| DialError::Timeout)?
            .map_err(|e| DialError::UpstreamHandshakeFailed(e.to_string()))?;
        if n == 0 {
            return Err(DialError::UpstreamHandshakeFailed("connection closed during handshake".to_string()));
        }
        buf.push(byte[0]);
        if buf.len() > 8192 {
            return Err(DialError::UpstreamHandshakeFailed("response too large".to_string()));
        }
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }

    let status_line = buf.split(|&b| b == b'\n').next().unwrap_or(&[]);
    let status_line = String::from_utf8_lossy(status_line);
    if !status_line.contains(" 200") {
        return Err(DialError::UpstreamHandshakeFailed(format!("unexpected CONNECT response: {}", status_line.trim())));
    }
    Ok(())
}

// --- SOCKS5 client (dialing out through an upstream SOCKS5 proxy) ---

async fn socks5_client_handshake(
    stream: &mut TcpStream,
    target: &Resolved,
    upstream: &UpstreamTarget,
) -> Result<(), DialError> {
    let methods: &[u8] = if upstream.has_auth { &[0x00, 0x02] } else { &[0x00] };
    let mut greeting = vec![0x05u8, methods.len() as u8];
    greeting.extend_from_slice(methods);
    write_all_timeout(stream, &greeting).await?;

    let mut resp = [0u8; 2];
    read_exact_timeout(stream, &mut resp).await?;
    if resp[0] != 0x05 {
        return Err(DialError::UpstreamHandshakeFailed("not a SOCKS5 upstream".to_string()));
    }
    match resp[1] {
        0x00 => {}
        0x02 => {
            if !upstream.has_auth {
                return Err(DialError::UpstreamHandshakeFailed("upstream requires auth we don't have".to_string()));
            }
            let mut req = vec![0x01u8, upstream.auth_username.len() as u8];
            req.extend_from_slice(upstream.auth_username.as_bytes());
            req.push(upstream.auth_password.len() as u8);
            req.extend_from_slice(upstream.auth_password.as_bytes());
            write_all_timeout(stream, &req).await?;
            let mut auth_resp = [0u8; 2];
            read_exact_timeout(stream, &mut auth_resp).await?;
            if auth_resp[1] != 0x00 {
                return Err(DialError::UpstreamHandshakeFailed("upstream rejected credentials".to_string()));
            }
        }
        0xFF => return Err(DialError::UpstreamHandshakeFailed("no acceptable auth method".to_string())),
        other => return Err(DialError::UpstreamHandshakeFailed(format!("unexpected method {other:#x}"))),
    }

    let (host, port) = target_host_port(target);
    let mut req = vec![0x05u8, 0x01, 0x00];
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                req.push(0x01);
                req.extend_from_slice(&v4.octets());
            }
            IpAddr::V6(v6) => {
                req.push(0x04);
                req.extend_from_slice(&v6.octets());
            }
        }
    } else {
        req.push(0x03);
        req.push(host.len() as u8);
        req.extend_from_slice(host.as_bytes());
    }
    req.extend_from_slice(&port.to_be_bytes());
    write_all_timeout(stream, &req).await?;

    let mut header = [0u8; 4];
    read_exact_timeout(stream, &mut header).await?;
    if header[0] != 0x05 {
        return Err(DialError::UpstreamHandshakeFailed("malformed SOCKS5 reply".to_string()));
    }
    if header[1] != 0x00 {
        return Err(DialError::UpstreamHandshakeFailed(format!("upstream refused CONNECT (reply code {})", header[1])));
    }
    // Consume the bound address the reply carries, per the address type.
    match header[3] {
        0x01 => {
            let mut rest = [0u8; 6];
            read_exact_timeout(stream, &mut rest).await?;
        }
        0x04 => {
            let mut rest = [0u8; 18];
            read_exact_timeout(stream, &mut rest).await?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            read_exact_timeout(stream, &mut len).await?;
            let mut rest = vec![0u8; len[0] as usize + 2];
            read_exact_timeout(stream, &mut rest).await?;
        }
        _ => return Err(DialError::UpstreamHandshakeFailed("unknown address type in reply".to_string())),
    }

    Ok(())
}

async fn write_all_timeout(stream: &mut TcpStream, buf: &[u8]) -> Result<(), DialError> {
    timeout(HANDSHAKE_TIMEOUT, stream.write_all(buf))
        .await
        .map_err(|_| DialError::Timeout)?
        .map_err(|e| DialError::UpstreamHandshakeFailed(e.to_string()))
}

async fn read_exact_timeout(stream: &mut TcpStream, buf: &mut [u8]) -> Result<(), DialError> {
    match timeout(HANDSHAKE_TIMEOUT, stream.read_exact(buf)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) if e.kind() == io::ErrorKind::UnexpectedEof => {
            Err(DialError::UpstreamHandshakeFailed("connection closed during handshake".to_string()))
        }
        Ok(Err(e)) => Err(DialError::UpstreamHandshakeFailed(e.to_string())),
        Err(_) => Err(DialError::Timeout),
    }
}
