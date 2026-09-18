//! SOCKS5 listener per RFC 1928 (framing) and RFC 1929 (username/password
//! sub-negotiation). Only `CONNECT` is implemented — `BIND` and `UDP
//! ASSOCIATE` both reply "command not supported", as they have no
//! meaningful implementation for a plain forward proxy like this one.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use crate::engine::matcher::{resolve_process, MatchRequest};
use crate::engine::upstream::{DialError, Target};
use crate::engine::{ConnectOutcome, Engine, RelayParams};
use crate::models::connection::ConnectionStatus;

const IO_TIMEOUT: Duration = Duration::from_secs(15);

// SOCKS5 reply codes (RFC 1928 section 6).
const REP_SUCCEEDED: u8 = 0x00;
const REP_GENERAL_FAILURE: u8 = 0x01;
const REP_NOT_ALLOWED: u8 = 0x02;
const REP_HOST_UNREACHABLE: u8 = 0x04;
const REP_CONNECTION_REFUSED: u8 = 0x05;
const REP_TTL_EXPIRED: u8 = 0x06;
const REP_COMMAND_NOT_SUPPORTED: u8 = 0x07;
const REP_ADDR_TYPE_NOT_SUPPORTED: u8 = 0x08;

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
                                tracing::debug!("socks5 connection error: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        tracing::warn!("socks5 listener accept error: {e}");
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                }
            }
        }
    }
}

async fn read_exact(stream: &mut TcpStream, buf: &mut [u8]) -> anyhow::Result<()> {
    timeout(IO_TIMEOUT, stream.read_exact(buf)).await??;
    Ok(())
}

async fn write_all(stream: &mut TcpStream, buf: &[u8]) -> anyhow::Result<()> {
    timeout(IO_TIMEOUT, stream.write_all(buf)).await??;
    Ok(())
}

async fn send_reply(stream: &mut TcpStream, code: u8) -> anyhow::Result<()> {
    // BND.ADDR/BND.PORT are always reported as 0.0.0.0:0 — this is a
    // forward proxy, not a real bind, and RFC 1928 doesn't require the
    // value to be meaningful for CONNECT replies in practice.
    let reply = [0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
    write_all(stream, &reply).await
}

async fn handle(engine: Arc<Engine>, mut stream: TcpStream, peer_addr: SocketAddr, listener_id: String) -> anyhow::Result<()> {
    let snapshot = engine.snapshot();
    let Some(listener) = snapshot.listener(&listener_id) else {
        return Ok(());
    };

    // --- Greeting / method negotiation ---
    let mut header = [0u8; 2];
    read_exact(&mut stream, &mut header).await?;
    if header[0] != 0x05 {
        return Ok(()); // not a SOCKS5 client, drop silently
    }
    let mut methods = vec![0u8; header[1] as usize];
    read_exact(&mut stream, &mut methods).await?;

    let wants_auth = listener.auth.enabled;
    let chosen: u8 = if wants_auth && methods.contains(&0x02) {
        0x02
    } else if !wants_auth && methods.contains(&0x00) {
        0x00
    } else {
        0xFF
    };
    write_all(&mut stream, &[0x05, chosen]).await?;
    if chosen == 0xFF {
        return Ok(());
    }

    if chosen == 0x02 {
        let mut sub_header = [0u8; 2];
        read_exact(&mut stream, &mut sub_header).await?; // [version, ulen]
        let mut uname = vec![0u8; sub_header[1] as usize];
        read_exact(&mut stream, &mut uname).await?;
        let mut plen = [0u8; 1];
        read_exact(&mut stream, &mut plen).await?;
        let mut passwd = vec![0u8; plen[0] as usize];
        read_exact(&mut stream, &mut passwd).await?;

        let username = String::from_utf8_lossy(&uname);
        let password = String::from_utf8_lossy(&passwd);
        let ok = username == listener.auth.username && password == listener.auth.password;
        write_all(&mut stream, &[0x01, if ok { 0x00 } else { 0x01 }]).await?;
        if !ok {
            return Ok(());
        }
    }

    // --- Request ---
    let mut req_head = [0u8; 4];
    read_exact(&mut stream, &mut req_head).await?;
    if req_head[0] != 0x05 {
        return Ok(());
    }
    let cmd = req_head[1];
    let atyp = req_head[3];

    let host = match atyp {
        0x01 => {
            let mut b = [0u8; 4];
            read_exact(&mut stream, &mut b).await?;
            IpAddr::V4(Ipv4Addr::from(b)).to_string()
        }
        0x04 => {
            let mut b = [0u8; 16];
            read_exact(&mut stream, &mut b).await?;
            IpAddr::V6(Ipv6Addr::from(b)).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            read_exact(&mut stream, &mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            read_exact(&mut stream, &mut domain).await?;
            String::from_utf8_lossy(&domain).to_string()
        }
        _ => {
            send_reply(&mut stream, REP_ADDR_TYPE_NOT_SUPPORTED).await?;
            return Ok(());
        }
    };
    let mut port_buf = [0u8; 2];
    read_exact(&mut stream, &mut port_buf).await?;
    let port = u16::from_be_bytes(port_buf);

    if cmd != 0x01 {
        // BIND (0x02) and UDP ASSOCIATE (0x03) are not implemented.
        send_reply(&mut stream, REP_COMMAND_NOT_SUPPORTED).await?;
        return Ok(());
    }

    let process = resolve_process(peer_addr).await;
    let req = MatchRequest { host: Some(host.clone()), ip: host.parse().ok(), port, process };
    let target_display = format!("{host}:{port}");
    let outcome = engine.connect_target(&snapshot, &listener_id, &req, Target { host: host.clone(), port }).await;

    match outcome.stream {
        Some(upstream_stream) => {
            send_reply(&mut stream, REP_SUCCEEDED).await?;
            engine
                .relay(
                    stream,
                    upstream_stream,
                    RelayParams {
                        client_addr: peer_addr.to_string(),
                        target: target_display,
                        decision: outcome.decision,
                        listener_id,
                        snapshot: &snapshot,
                    },
                )
                .await;
        }
        None => {
            let code = reply_code_for(&outcome);
            send_reply(&mut stream, code).await?;
            engine
                .record_immediate(peer_addr.to_string(), target_display, outcome.decision, listener_id, ConnectionStatus::Failed, &snapshot)
                .await;
        }
    }
    Ok(())
}

fn reply_code_for(outcome: &ConnectOutcome) -> u8 {
    match &outcome.error {
        None => REP_NOT_ALLOWED, // blocked by a rule or the listener's default action
        Some(DialError::DnsResolutionDisabled) => REP_HOST_UNREACHABLE,
        Some(DialError::ResolutionFailed) => REP_HOST_UNREACHABLE,
        Some(DialError::Timeout) => REP_TTL_EXPIRED,
        Some(DialError::ConnectionRefused) => REP_CONNECTION_REFUSED,
        Some(DialError::UpstreamHandshakeFailed(_)) => REP_GENERAL_FAILURE,
        Some(DialError::UpstreamNotFound) => REP_GENERAL_FAILURE,
    }
}
