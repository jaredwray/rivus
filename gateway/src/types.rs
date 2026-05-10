use std::fmt;
use std::net::IpAddr;
use std::time::Instant;

use bytes::Bytes;
use futures::stream::BoxStream;
use http::{HeaderMap, Method, StatusCode, Uri};

use crate::error::GwError;

pub struct GwRequest {
    pub method: Method,
    pub uri: Uri,
    pub host: String,
    pub headers: HeaderMap,
    pub body: GwBody,
    pub peer: PeerInfo,
}

#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub client_ip: IpAddr,
    pub country: Option<String>,
    pub cf_ray: Option<String>,
}

pub struct GwCtx {
    pub request_id: String,
    pub received_at: Instant,
    pub deadline: Option<Instant>,
    pub span: tracing::Span,
    pub log: AccessLog,
}

impl GwCtx {
    pub fn new(request_id: String) -> Self {
        Self {
            request_id,
            received_at: Instant::now(),
            deadline: None,
            span: tracing::Span::current(),
            log: AccessLog::default(),
        }
    }
}

#[derive(Debug, Default)]
pub struct AccessLog {
    pub matched_domain: Option<String>,
    pub matched_route: Option<String>,
    pub release_sha: Option<String>,
    pub cache_state: Option<CacheState>,
    pub origin_used: Option<OriginTier>,
    pub upstream_ms: Option<u32>,
    pub status: Option<StatusCode>,
    pub bytes_out: Option<u64>,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum CacheState {
    Hit,
    Miss,
    StaleHit,
    Bypass,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum OriginTier {
    Primary,
    Secondary,
    StaleCache,
    None,
}

pub enum GwBody {
    Empty,
    Bytes(Bytes),
    Stream(BoxStream<'static, Result<Bytes, GwError>>),
}

impl fmt::Debug for GwBody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GwBody::Empty => f.write_str("GwBody::Empty"),
            GwBody::Bytes(b) => f.debug_tuple("GwBody::Bytes").field(&b.len()).finish(),
            GwBody::Stream(_) => f.write_str("GwBody::Stream(<stream>)"),
        }
    }
}

pub struct GwResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: GwBody,
}

impl GwResponse {
    pub fn empty(status: StatusCode) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: GwBody::Empty,
        }
    }

    pub fn from_bytes(status: StatusCode, body: impl Into<Bytes>) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: GwBody::Bytes(body.into()),
        }
    }

    pub fn not_found() -> Self {
        Self::empty(StatusCode::NOT_FOUND)
    }

    pub fn service_unavailable() -> Self {
        let mut resp = Self::empty(StatusCode::SERVICE_UNAVAILABLE);
        resp.headers
            .insert(http::header::RETRY_AFTER, http::HeaderValue::from_static("5"));
        resp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_response_has_correct_status() {
        let r = GwResponse::not_found();
        assert_eq!(r.status, StatusCode::NOT_FOUND);
        assert!(matches!(r.body, GwBody::Empty));
    }

    #[test]
    fn service_unavailable_sets_retry_after() {
        let r = GwResponse::service_unavailable();
        assert_eq!(r.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(r.headers[http::header::RETRY_AFTER], "5");
    }

    #[test]
    fn from_bytes_response_holds_payload() {
        let r = GwResponse::from_bytes(StatusCode::OK, "hello");
        if let GwBody::Bytes(b) = r.body {
            assert_eq!(&b[..], b"hello");
        } else {
            panic!("expected Bytes body");
        }
    }
}
