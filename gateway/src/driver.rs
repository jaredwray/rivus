use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, StatusCode};
use pingora::http::ResponseHeader;
use pingora::Result as PingoraResult;
use pingora_proxy::{ProxyHttp, Session};
use uuid::Uuid;

use crate::gateway::Gateway;
use crate::types::{GwBody, GwCtx, GwRequest, GwResponse, PeerInfo};

/// Pingora adapter for any [`Gateway`] impl. Maps `pingora::Session`
/// onto our framework-agnostic [`GwRequest`]/[`GwResponse`] types,
/// then writes the response back and emits the access log from
/// [`GwCtx::log`].
pub struct PingoraDriver<G: Gateway> {
    gateway: Arc<G>,
}

impl<G: Gateway> PingoraDriver<G> {
    pub fn new(gateway: Arc<G>) -> Self {
        Self { gateway }
    }
}

#[async_trait]
impl<G: Gateway> ProxyHttp for PingoraDriver<G> {
    type CTX = ();
    fn new_ctx(&self) -> Self::CTX {}

    async fn request_filter(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> PingoraResult<bool> {
        let req = build_gw_request(session);
        let request_id = req
            .peer
            .cf_ray
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
        let mut gw_ctx = GwCtx::new(request_id);

        let response = self.gateway.handle(req, &mut gw_ctx).await;

        write_response(session, response).await?;
        emit_access_log(&gw_ctx);
        // We've fully written the response; tell Pingora to skip the proxy path.
        Ok(true)
    }

    async fn upstream_peer(
        &self,
        _session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> PingoraResult<Box<pingora::upstreams::peer::HttpPeer>> {
        // Should never be reached because request_filter returns Ok(true),
        // but the trait method is required.
        Err(pingora::Error::new_str("rivus-gateway has no upstream"))
    }
}

fn build_gw_request(session: &Session) -> GwRequest {
    let req_header = session.req_header();
    let method = req_header.method.clone();
    let uri = req_header.uri.clone();
    let headers = req_header.headers.clone();

    let host = headers
        .get(http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let client_ip = extract_cf_connecting_ip(&headers)
        .or_else(|| {
            session
                .client_addr()
                .and_then(|a| a.as_inet())
                .map(|i| i.ip())
        })
        .unwrap_or_else(|| "0.0.0.0".parse().unwrap());

    let country = headers
        .get("cf-ipcountry")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let cf_ray = headers
        .get("cf-ray")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    GwRequest {
        method,
        uri,
        host,
        headers,
        // Phase-1 static serving doesn't read request bodies.
        body: GwBody::Empty,
        peer: PeerInfo {
            client_ip,
            country,
            cf_ray,
        },
    }
}

fn extract_cf_connecting_ip(headers: &HeaderMap) -> Option<std::net::IpAddr> {
    headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

async fn write_response(session: &mut Session, resp: GwResponse) -> PingoraResult<()> {
    let mut header = ResponseHeader::build(resp.status, Some(resp.headers.len()))
        .map_err(|_| pingora::Error::new_str("response header build failed"))?;
    for (name, value) in resp.headers.iter() {
        header
            .insert_header(name.clone(), value.clone())
            .map_err(|_| pingora::Error::new_str("header insert failed"))?;
    }

    match resp.body {
        GwBody::Empty => {
            session.write_response_header(Box::new(header), true).await?;
        }
        GwBody::Bytes(b) => {
            session.write_response_header(Box::new(header), false).await?;
            session.write_response_body(Some(b), true).await?;
        }
        GwBody::Stream(_) => {
            // v0.1 handlers only emit GwBody::Bytes; streaming is plumbed
            // through the response type and will be wired here when the
            // resolver starts streaming object-store reads.
            return Err(pingora::Error::new_str(
                "streaming response bodies not yet implemented",
            ));
        }
    }
    Ok(())
}

fn emit_access_log(ctx: &GwCtx) {
    let log = &ctx.log;
    let line = serde_json::json!({
        "request_id": ctx.request_id,
        "matched_domain": log.matched_domain,
        "matched_route": log.matched_route,
        "release_sha": log.release_sha,
        "cache_state": log.cache_state.map(|s| format!("{s:?}")),
        "origin_used": log.origin_used.map(|t| format!("{t:?}")),
        "status": log.status.map(|s| s.as_u16()),
        "bytes_out": log.bytes_out,
        "elapsed_ms": ctx.received_at.elapsed().as_millis(),
    });
    println!("{line}");
}

/// Tiny ops listener exposing `/healthz` and `/readyz`. Returns 200/OK
/// for both today; later commits make `/readyz` reflect storage
/// reachability via the active health probe.
pub struct OpsDriver;

impl OpsDriver {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OpsDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ProxyHttp for OpsDriver {
    type CTX = ();
    fn new_ctx(&self) -> Self::CTX {}

    async fn request_filter(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> PingoraResult<bool> {
        let path = session.req_header().uri.path().to_string();
        let (status, body) = match path.as_str() {
            "/healthz" => (StatusCode::OK, "ok"),
            "/readyz" => (StatusCode::OK, "ready"),
            _ => (StatusCode::NOT_FOUND, "not found"),
        };

        let mut header = ResponseHeader::build(status, Some(2))
            .map_err(|_| pingora::Error::new_str("response header build failed"))?;
        header
            .insert_header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .map_err(|_| pingora::Error::new_str("header insert failed"))?;
        header
            .insert_header(http::header::CONTENT_LENGTH, body.len().to_string())
            .map_err(|_| pingora::Error::new_str("header insert failed"))?;

        session
            .write_response_header(Box::new(header), false)
            .await?;
        session
            .write_response_body(Some(Bytes::from_static(body.as_bytes())), true)
            .await?;
        Ok(true)
    }

    async fn upstream_peer(
        &self,
        _session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> PingoraResult<Box<pingora::upstreams::peer::HttpPeer>> {
        Err(pingora::Error::new_str("ops listener has no upstream"))
    }
}
