pub mod http;
pub mod socks5;

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// A stream that first replays `prefix` (bytes already read off the wire
/// while parsing a protocol header) before continuing to read from
/// `inner`. Writes pass straight through. Lets the header-parsing code use
/// a plain growable buffer instead of a `BufReader` that can't also do
/// `AsyncWrite`.
pub struct Prefixed<S> {
    prefix: Vec<u8>,
    prefix_pos: usize,
    inner: S,
}

impl<S> Prefixed<S> {
    pub fn new(prefix: Vec<u8>, inner: S) -> Self {
        Self { prefix, prefix_pos: 0, inner }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Prefixed<S> {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.prefix_pos < this.prefix.len() {
            let remaining = &this.prefix[this.prefix_pos..];
            let n = remaining.len().min(buf.remaining());
            buf.put_slice(&remaining[..n]);
            this.prefix_pos += n;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Prefixed<S> {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

/// Reads from `stream` until the buffer contains a blank-line-terminated
/// header block (`\r\n\r\n`), or `max_len` is exceeded. Returns the header
/// block (including the trailing blank line) split from whatever extra
/// bytes were already read past it (e.g. the start of a request body).
pub async fn read_head<S: AsyncRead + Unpin>(stream: &mut S, max_len: usize) -> io::Result<(Vec<u8>, Vec<u8>)> {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            let head = buf[..pos + 4].to_vec();
            let leftover = buf[pos + 4..].to_vec();
            return Ok((head, leftover));
        }
        if buf.len() > max_len {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "header block too large"));
        }
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "connection closed while reading headers"));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
