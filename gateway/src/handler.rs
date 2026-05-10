use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use http::{header, HeaderValue, StatusCode};
use idna::domain_to_ascii;
use tracing::warn;

use crate::config::AppConfig;
use crate::error::GwError;
use crate::gateway::Gateway;
use crate::resolver::ReleaseResolver;
use crate::types::{GwBody, GwCtx, GwRequest, GwResponse};

/// Default Phase-1 implementation of [`Gateway`]: read the deploy
/// pointer, resolve the request path inside the active release, serve
/// the blob, fall back to the configured 404 page when missing.
///
/// Redirects, custom headers, SPA fallback, range/conditional GETs and
/// compression are deferred to subsequent commits.
pub struct DefaultGateway<R: ReleaseResolver> {
    resolver: Arc<R>,
}

impl<R: ReleaseResolver> DefaultGateway<R> {
    pub fn new(resolver: Arc<R>) -> Self {
        Self { resolver }
    }
}

#[async_trait]
impl<R: ReleaseResolver> Gateway for DefaultGateway<R> {
    async fn handle(&self, req: GwRequest, ctx: &mut GwCtx) -> GwResponse {
        let host = match normalize_host(&req.host) {
            Ok(h) => h,
            Err(_) => {
                ctx.log.status = Some(StatusCode::BAD_REQUEST);
                return GwResponse::empty(StatusCode::BAD_REQUEST);
            }
        };
        ctx.log.matched_domain = Some(host.clone());

        let (pointer, pointer_tier) = match self.resolver.current_release(&host).await {
            Ok(r) => r,
            Err(GwError::NotFound) => {
                ctx.log.status = Some(StatusCode::NOT_FOUND);
                return GwResponse::not_found();
            }
            Err(e) => {
                warn!(host = %host, error = %e, "current.json read failed");
                ctx.log.status = Some(StatusCode::SERVICE_UNAVAILABLE);
                return GwResponse::service_unavailable();
            }
        };
        ctx.log.release_sha = Some(pointer.release.clone());
        ctx.log.origin_used = Some(pointer_tier);

        let app_config = self
            .resolver
            .app_config(&host, &pointer.release)
            .await
            .unwrap_or_else(|e| {
                warn!(host = %host, error = %e, "app.config.json read failed; using defaults");
                Arc::new(AppConfig::default())
            });

        let path = req.uri.path();
        let resolved_path = if path.ends_with('/') {
            format!("{path}{}", app_config.default_index)
        } else {
            path.to_string()
        };

        match self
            .resolver
            .read_blob(&host, &pointer.release, &resolved_path)
            .await
        {
            Ok((bytes, blob_tier)) => {
                ctx.log.origin_used = Some(blob_tier);
                ok_response(&resolved_path, bytes, ctx)
            }
            Err(GwError::NotFound) => {
                serve_404(self.resolver.as_ref(), &host, &pointer.release, &app_config, ctx).await
            }
            Err(e) => {
                warn!(host = %host, path = %resolved_path, error = %e, "blob read failed");
                ctx.log.status = Some(StatusCode::SERVICE_UNAVAILABLE);
                GwResponse::service_unavailable()
            }
        }
    }
}

fn ok_response(path: &str, bytes: Bytes, ctx: &mut GwCtx) -> GwResponse {
    let mut resp = GwResponse {
        status: StatusCode::OK,
        headers: http::HeaderMap::new(),
        body: GwBody::Bytes(bytes.clone()),
    };
    if let Some(ct) = guess_content_type(path) {
        resp.headers.insert(header::CONTENT_TYPE, ct);
    }
    resp.headers
        .insert(header::CONTENT_LENGTH, HeaderValue::from(bytes.len()));
    ctx.log.status = Some(StatusCode::OK);
    ctx.log.bytes_out = Some(bytes.len() as u64);
    resp
}

async fn serve_404<R: ReleaseResolver>(
    resolver: &R,
    host: &str,
    release: &str,
    app_config: &AppConfig,
    ctx: &mut GwCtx,
) -> GwResponse {
    if let Some(nf_page) = &app_config.not_found_page {
        if let Ok((bytes, _)) = resolver.read_blob(host, release, nf_page).await {
            let mut resp = GwResponse {
                status: StatusCode::NOT_FOUND,
                headers: http::HeaderMap::new(),
                body: GwBody::Bytes(bytes.clone()),
            };
            if let Some(ct) = guess_content_type(nf_page) {
                resp.headers.insert(header::CONTENT_TYPE, ct);
            }
            resp.headers
                .insert(header::CONTENT_LENGTH, HeaderValue::from(bytes.len()));
            ctx.log.status = Some(StatusCode::NOT_FOUND);
            ctx.log.bytes_out = Some(bytes.len() as u64);
            return resp;
        }
    }
    ctx.log.status = Some(StatusCode::NOT_FOUND);
    GwResponse::not_found()
}

fn normalize_host(host: &str) -> Result<String, GwError> {
    let host = host.split(':').next().unwrap_or(host).trim_end_matches('.');
    if host.is_empty() {
        return Err(GwError::InvalidRequest("empty host".into()));
    }
    if host.contains('/') || host.contains("..") {
        return Err(GwError::InvalidRequest("invalid host".into()));
    }
    domain_to_ascii(host)
        .map(|s| s.to_lowercase())
        .map_err(|e| GwError::InvalidRequest(format!("idna: {e}")))
}

fn guess_content_type(path: &str) -> Option<HeaderValue> {
    let ext = path.rsplit('.').next()?;
    let mime = match ext.to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        _ => return None,
    };
    Some(HeaderValue::from_static(mime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::PointerCache;
    use crate::config::FailoverConfig;
    use crate::resolver::LayoutAResolver;
    use crate::storage::{Tier, TieredStore};
    use crate::types::PeerInfo;
    use http::{HeaderMap, Method, Uri};
    use opendal::services;
    use opendal::Operator;
    use std::net::IpAddr;
    use std::str::FromStr;

    fn memory_op() -> Operator {
        Operator::new(services::Memory::default()).unwrap().finish()
    }

    fn make_request(host: &str, path: &str) -> GwRequest {
        GwRequest {
            method: Method::GET,
            uri: Uri::from_str(path).unwrap(),
            host: host.to_string(),
            headers: HeaderMap::new(),
            body: GwBody::Empty,
            peer: PeerInfo {
                client_ip: IpAddr::from([127, 0, 0, 1]),
                country: None,
                cf_ray: None,
            },
        }
    }

    async fn build_gateway(
        primary: Operator,
        secondary: Operator,
    ) -> DefaultGateway<LayoutAResolver> {
        let store = Arc::new(TieredStore::new(
            Tier {
                name: "primary",
                op: primary,
            },
            Tier {
                name: "secondary",
                op: secondary,
            },
            FailoverConfig::default(),
        ));
        let resolver = Arc::new(LayoutAResolver::new(store, PointerCache::new(60_000)));
        DefaultGateway::new(resolver)
    }

    #[tokio::test]
    async fn serves_index_html_for_root_path() {
        let primary = memory_op();
        primary
            .write(
                "domains/example.com/current.json",
                r#"{"schema_version":1,"release":"abc","deployed_at":"now"}"#,
            )
            .await
            .unwrap();
        primary
            .write(
                "domains/example.com/releases/abc/index.html",
                "<h1>hi</h1>",
            )
            .await
            .unwrap();

        let gw = build_gateway(primary, memory_op()).await;
        let req = make_request("example.com", "/");
        let mut ctx = GwCtx::new("test-1".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::OK);
        assert_eq!(
            resp.headers[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        assert_eq!(ctx.log.matched_domain.as_deref(), Some("example.com"));
        assert_eq!(ctx.log.release_sha.as_deref(), Some("abc"));
        assert_eq!(ctx.log.status, Some(StatusCode::OK));
    }

    #[tokio::test]
    async fn returns_404_when_path_missing_and_no_404_page() {
        let primary = memory_op();
        primary
            .write(
                "domains/example.com/current.json",
                r#"{"schema_version":1,"release":"abc","deployed_at":"now"}"#,
            )
            .await
            .unwrap();

        let gw = build_gateway(primary, memory_op()).await;
        let req = make_request("example.com", "/missing.html");
        let mut ctx = GwCtx::new("test-2".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::NOT_FOUND);
        assert!(matches!(resp.body, GwBody::Empty));
    }

    #[tokio::test]
    async fn serves_configured_404_page_when_missing() {
        let primary = memory_op();
        primary
            .write(
                "domains/example.com/current.json",
                r#"{"schema_version":1,"release":"abc","deployed_at":"now"}"#,
            )
            .await
            .unwrap();
        primary
            .write(
                "domains/example.com/releases/abc/app.config.json",
                r#"{"schema_version":1,"default_index":"index.html","not_found_page":"404.html"}"#,
            )
            .await
            .unwrap();
        primary
            .write("domains/example.com/releases/abc/404.html", "missing")
            .await
            .unwrap();

        let gw = build_gateway(primary, memory_op()).await;
        let req = make_request("example.com", "/missing.html");
        let mut ctx = GwCtx::new("test-3".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::NOT_FOUND);
        if let GwBody::Bytes(b) = resp.body {
            assert_eq!(&b[..], b"missing");
        } else {
            panic!("expected Bytes body");
        }
    }

    #[tokio::test]
    async fn unknown_domain_returns_404() {
        let gw = build_gateway(memory_op(), memory_op()).await;
        let req = make_request("nope.example.com", "/");
        let mut ctx = GwCtx::new("test-4".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::NOT_FOUND);
    }
}
