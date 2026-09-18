//! HTTP proxy listener: `CONNECT` tunnels (the common case, e.g. browsers
//! tunnelling HTTPS) and plain forward HTTP requests in absolute-form
//! (`GET http://host/path HTTP/1.1`) or origin-form with a `Host` header.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use tokio::io::{AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use crate::engine::matcher::{MatchRequest, resolve_process};
use crate::engine::snapshot::ConfigSnapshot;
use crate::engine::upstream::{DialError, Target};
use crate::engine::{ConnectOutcome, Engine, RelayParams};
use crate::models::connection::ConnectionStatus;

use super::{Prefixed, read_head};

const HEADER_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HEAD_LEN: usize = 16 * 1024;

/// Accept loop for one HTTP listener. Runs until `cancel` fires; each
/// connection is handled on its own task so one slow/misbehaving client
/// never blocks new ones.
pub async fn run(engine: Arc<Engine>, tcp: TcpListener, listener_id: String, cancel: CancellationToken) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            accepted = tcp.accept() => {
                match accepted {
                    Ok((stream, peer_addr)) => {
                        let engine = engine.clone();
                        let listener_id = listener_id.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle(engine, stream, peer_addr, listener_id).await {
                                tracing::debug!("http connection error: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        tracing::warn!("http listener accept error: {e}");
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                }
            }
        }
    }
}

async fn handle(engine: Arc<Engine>, mut stream: TcpStream, peer_addr: SocketAddr, listener_id: String) -> anyhow::Result<()> {
    let snapshot = engine.snapshot();
    let Some(listener) = snapshot.listener(&listener_id) else {
        return Ok(());
    };

    let (head, leftover) = tokio::time::timeout(HEADER_TIMEOUT, read_head(&mut stream, MAX_HEAD_LEN))
        .await
        .map_err(|_| anyhow::anyhow!("timed out reading request head"))??;
    let head_str = String::from_utf8_lossy(&head).into_owned();
    let mut lines = head_str.split("\r\n");
    let request_line = lines.next().unwrap_or("").to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();

    let headers: Vec<(String, String)> = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())))
        .collect();

    if listener.auth.enabled {
        let ok = headers
            .iter()
            .find(|(k, _)| k == "proxy-authorization")
            .and_then(|(_, v)| check_basic_auth(v, &listener.auth.username, &listener.auth.password))
            .unwrap_or(false);
        if !ok {
            let resp = b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"routex\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(resp).await;
            return Ok(());
        }
    }

    if method.eq_ignore_ascii_case("CONNECT") {
        handle_connect(engine, stream, peer_addr, listener_id, &snapshot, &target, leftover).await
    } else {
        handle_forward(engine, stream, peer_addr, listener_id, &snapshot, &method, &target, &headers, &head_str, leftover).await
    }
}

async fn handle_connect(
    engine: Arc<Engine>,
    mut stream: TcpStream,
    peer_addr: SocketAddr,
    listener_id: String,
    snapshot: &ConfigSnapshot,
    target: &str,
    leftover: Vec<u8>,
) -> anyhow::Result<()> {
    let Some((host, port)) = split_host_port(target, None) else {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        return Ok(());
    };

    let process = resolve_process(peer_addr).await;
    let req = MatchRequest { host: Some(host.clone()), ip: host.parse().ok(), port, process };
    let target_display = format!("{host}:{port}");
    let outcome = engine.connect_target(snapshot, &listener_id, &req, Target { host: host.clone(), port }).await;

    match outcome.stream {
        Some(upstream_stream) => {
            stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await?;
            let client = Prefixed::new(leftover, stream);
            engine
                .relay(
                    client,
                    upstream_stream,
                    RelayParams {
                        client_addr: peer_addr.to_string(),
                        target: target_display,
                        decision: outcome.decision,
                        listener_id,
                        snapshot,
                    },
                )
                .await;
        }
        None => {
            let (response, status) = response_for_outcome(&outcome);
            let _ = stream.write_all(response.as_bytes()).await;
            engine
                .record_immediate(peer_addr.to_string(), target_display, outcome.decision, listener_id, status, snapshot)
                .await;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn handle_forward(
    engine: Arc<Engine>,
    mut stream: TcpStream,
    peer_addr: SocketAddr,
    listener_id: String,
    snapshot: &ConfigSnapshot,
    method: &str,
    target: &str,
    headers: &[(String, String)],
    head_str: &str,
    leftover: Vec<u8>,
) -> anyhow::Result<()> {
    let (host, port, path) = if let Some(rest) = target.strip_prefix("http://") {
        let (hostport, path) = match rest.find('/') {
            Some(i) => (&rest[..i], rest[i..].to_string()),
            None => (rest, "/".to_string()),
        };
        match split_host_port(hostport, Some(80)) {
            Some((h, p)) => (h, p, path),
            None => (String::new(), 0, path),
        }
    } else {
        let host_header = headers.iter().find(|(k, _)| k == "host").map(|(_, v)| v.clone()).unwrap_or_default();
        match split_host_port(&host_header, Some(80)) {
            Some((h, p)) => (h, p, target.to_string()),
            None => (String::new(), 0, target.to_string()),
        }
    };

    if host.is_empty() {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        return Ok(());
    }

    let process = resolve_process(peer_addr).await;
    let req = MatchRequest { host: Some(host.clone()), ip: host.parse().ok(), port, process };
    let target_display = format!("{host}:{port}");
    let outcome = engine.connect_target(snapshot, &listener_id, &req, Target { host: host.clone(), port }).await;

    match outcome.stream {
        Some(mut upstream_stream) => {
            let version = head_str.split_whitespace().nth(2).unwrap_or("HTTP/1.1");
            let mut out = format!("{method} {path} {version}\r\n");
            for (k, v) in headers {
                if k == "proxy-authorization" || k == "proxy-connection" {
                    continue;
                }
                out.push_str(k);
                out.push_str(": ");
                out.push_str(v);
                out.push_str("\r\n");
            }
            out.push_str("\r\n");
            upstream_stream.write_all(out.as_bytes()).await?;
            if !leftover.is_empty() {
                upstream_stream.write_all(&leftover).await?;
            }
            engine
                .relay(
                    stream,
                    upstream_stream,
                    RelayParams {
                        client_addr: peer_addr.to_string(),
                        target: target_display,
                        decision: outcome.decision,
                        listener_id,
                        snapshot,
                    },
                )
                .await;
        }
        None => {
            let (response, status) = response_for_outcome(&outcome);
            let _ = stream.write_all(response.as_bytes()).await;
            engine
                .record_immediate(peer_addr.to_string(), target_display, outcome.decision, listener_id, status, snapshot)
                .await;
        }
    }
    Ok(())
}

fn response_for_outcome(outcome: &ConnectOutcome) -> (String, ConnectionStatus) {
    let status_line = match &outcome.error {
        None => "403 Forbidden", // blocked by a rule / default action
        Some(DialError::DnsResolutionDisabled) => "502 Bad Gateway",
        Some(DialError::ResolutionFailed) => "502 Bad Gateway",
        Some(DialError::Timeout) => "504 Gateway Timeout",
        Some(DialError::ConnectionRefused) => "502 Bad Gateway",
        Some(DialError::UpstreamHandshakeFailed(_)) => "502 Bad Gateway",
        Some(DialError::UpstreamNotFound) => "502 Bad Gateway",
    };
    let response = format!("HTTP/1.1 {status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    (response, ConnectionStatus::Failed)
}

fn check_basic_auth(header_value: &str, username: &str, password: &str) -> Option<bool> {
    let encoded = header_value.strip_prefix("Basic ")?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (u, p) = decoded.split_once(':')?;
    Some(u == username && p == password)
}

/// Splits `host:port`, or `host` alone with `default_port`. Returns `None`
/// when there's no port and no default (used for `CONNECT`, where a port
/// is mandatory per RFC 7231).
fn split_host_port(value: &str, default_port: Option<u16>) -> Option<(String, u16)> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    match value.rsplit_once(':') {
        Some((host, port_str)) if port_str.chars().all(|c| c.is_ascii_digit()) && !port_str.is_empty() => {
            port_str.parse::<u16>().ok().map(|port| (host.trim_matches(['[', ']']).to_string(), port))
        }
        _ => default_port.map(|port| (value.trim_matches(['[', ']']).to_string(), port)),
    }
}
