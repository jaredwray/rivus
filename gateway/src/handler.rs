use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use http::{header, HeaderMap, HeaderValue, StatusCode};
use idna::domain_to_ascii;
use tracing::warn;

use crate::config::AppConfig;
use crate::error::GwError;
use crate::gateway::Gateway;
use crate::resolver::ReleaseResolver;
use crate::routing::expand_template;
use crate::types::{GwBody, GwCtx, GwRequest, GwResponse};

/// Default Phase-1 implementation of [`Gateway`].
///
/// Per-request flow:
///   1. Normalize Host (idna → lowercase punycode)
///   2. Read pointer (`current.json`) for the host
///   3. Load compiled `app.config.json` for the release
///   4. Check redirects → if any match, return 3xx with `Location`
///   5. Apply rewrites → mutate the path that will be looked up
///   6. If the resolved path ends with `/`, append `default_index`
///   7. Read the blob; on 404 either serve the SPA fallback, the
///      configured `not_found_page`, or a plain 404
///   8. Apply per-path header rules to the final response (uses the
///      *original* request path so customer-facing URLs drive headers)
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

        let original_path = req.uri.path().to_string();

        if let Some(resp) = apply_redirect(&app_config, &original_path, ctx) {
            return finalize(resp, &app_config, &original_path);
        }

        let effective_path = apply_rewrite(&app_config, &original_path);
        let resolved_path = if effective_path.ends_with('/') {
            format!("{effective_path}{}", app_config.default_index)
        } else {
            effective_path
        };

        let resp = match self
            .resolver
            .read_blob(&host, &pointer.release, &resolved_path)
            .await
        {
            Ok((bytes, blob_tier)) => {
                ctx.log.origin_used = Some(blob_tier);
                ok_response(&resolved_path, bytes, ctx)
            }
            Err(GwError::NotFound) => {
                if app_config.spa_fallback {
                    let index_path = ensure_leading_slash(&app_config.default_index);
                    if let Ok((bytes, blob_tier)) = self
                        .resolver
                        .read_blob(&host, &pointer.release, &index_path)
                        .await
                    {
                        ctx.log.origin_used = Some(blob_tier);
                        ok_response(&index_path, bytes, ctx)
                    } else {
                        serve_404(self.resolver.as_ref(), &host, &pointer.release, &app_config, ctx)
                            .await
                    }
                } else {
                    serve_404(self.resolver.as_ref(), &host, &pointer.release, &app_config, ctx)
                        .await
                }
            }
            Err(e) => {
                warn!(host = %host, path = %resolved_path, error = %e, "blob read failed");
                ctx.log.status = Some(StatusCode::SERVICE_UNAVAILABLE);
                GwResponse::service_unavailable()
            }
        };

        finalize(resp, &app_config, &original_path)
    }
}

fn ensure_leading_slash(p: &str) -> String {
    if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    }
}

fn apply_redirect(
    cfg: &AppConfig,
    path: &str,
    ctx: &mut GwCtx,
) -> Option<GwResponse> {
    for r in &cfg.redirects {
        if let Some(caps) = r.pattern.match_path(path) {
            let target = expand_template(&r.to, &caps);
            let location = match HeaderValue::from_str(&target) {
                Ok(v) => v,
                Err(_) => {
                    warn!(target = %target, "redirect target has invalid header bytes");
                    return None;
                }
            };
            let mut resp = GwResponse::empty(r.status);
            resp.headers.insert(header::LOCATION, location);
            ctx.log.matched_route = Some(format!("redirect:{}", r.to));
            ctx.log.status = Some(r.status);
            return Some(resp);
        }
    }
    None
}

fn apply_rewrite(cfg: &AppConfig, path: &str) -> String {
    for r in &cfg.rewrites {
        if let Some(caps) = r.pattern.match_path(path) {
            return expand_template(&r.to, &caps);
        }
    }
    path.to_string()
}

fn finalize(mut resp: GwResponse, cfg: &AppConfig, original_path: &str) -> GwResponse {
    apply_headers(&mut resp.headers, &cfg.headers, original_path);
    resp
}

fn apply_headers(target: &mut HeaderMap, rules: &[crate::config::HeaderRule], path: &str) {
    for rule in rules {
        if rule.pattern.match_path(path).is_some() {
            for (name, value) in &rule.set {
                target.insert(name.clone(), value.clone());
            }
        }
    }
}

fn ok_response(path: &str, bytes: Bytes, ctx: &mut GwCtx) -> GwResponse {
    let mut resp = GwResponse {
        status: StatusCode::OK,
        headers: HeaderMap::new(),
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
        let path = ensure_leading_slash(nf_page);
        if let Ok((bytes, _)) = resolver.read_blob(host, release, &path).await {
            let mut resp = GwResponse {
                status: StatusCode::NOT_FOUND,
                headers: HeaderMap::new(),
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

    async fn seed(op: &Operator, files: &[(&str, &str)]) {
        for (key, value) in files {
            op.write(key, value.to_string()).await.unwrap();
        }
    }

    fn build_gateway(primary: Operator, secondary: Operator) -> DefaultGateway<LayoutAResolver> {
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
    async fn redirect_returns_3xx_with_location() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{"redirects":[{"from":"/old/*","to":"/new/$1","status":308}]}"#,
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/old/about.html");
        let mut ctx = GwCtx::new("r1".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::PERMANENT_REDIRECT);
        assert_eq!(resp.headers[header::LOCATION], "/new/about.html");
        assert_eq!(ctx.log.status, Some(StatusCode::PERMANENT_REDIRECT));
    }

    #[tokio::test]
    async fn rewrite_serves_aliased_blob() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{"rewrites":[{"from":"/api/*","to":"/handlers/api/$1"}]}"#,
                ),
                (
                    "domains/example.com/releases/abc/handlers/api/data.json",
                    "{\"ok\":true}",
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/api/data.json");
        let mut ctx = GwCtx::new("r2".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::OK);
        if let GwBody::Bytes(b) = resp.body {
            assert_eq!(&b[..], b"{\"ok\":true}");
        } else {
            panic!("expected Bytes body");
        }
    }

    #[tokio::test]
    async fn spa_fallback_serves_index_on_404() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{"spa_fallback":true}"#,
                ),
                (
                    "domains/example.com/releases/abc/index.html",
                    "<div id='root'></div>",
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/dashboard/anything");
        let mut ctx = GwCtx::new("r3".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::OK);
        assert_eq!(
            resp.headers[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        if let GwBody::Bytes(b) = resp.body {
            assert_eq!(&b[..], b"<div id='root'></div>");
        } else {
            panic!("expected Bytes body");
        }
    }

    #[tokio::test]
    async fn header_rules_are_applied_to_response() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{
                        "headers": [
                            {"path":"/*","set":{"X-Frame-Options":"DENY"}},
                            {"path":"/assets/*","set":{"Cache-Control":"public, max-age=31536000"}}
                        ]
                    }"#,
                ),
                (
                    "domains/example.com/releases/abc/assets/main.css",
                    "body{}",
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/assets/main.css");
        let mut ctx = GwCtx::new("r4".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::OK);
        assert_eq!(resp.headers[header::X_FRAME_OPTIONS], "DENY");
        assert_eq!(
            resp.headers[header::CACHE_CONTROL],
            "public, max-age=31536000"
        );
    }

    #[tokio::test]
    async fn headers_apply_to_redirects_too() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{
                        "redirects": [{"from":"/old","to":"/new","status":301}],
                        "headers": [{"path":"/*","set":{"X-Frame-Options":"DENY"}}]
                    }"#,
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/old");
        let mut ctx = GwCtx::new("r5".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::MOVED_PERMANENTLY);
        assert_eq!(resp.headers[header::LOCATION], "/new");
        assert_eq!(resp.headers[header::X_FRAME_OPTIONS], "DENY");
    }

    #[tokio::test]
    async fn returns_404_when_path_missing_and_no_404_page() {
        let primary = memory_op();
        seed(
            &primary,
            &[(
                "domains/example.com/current.json",
                r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
            )],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/missing.html");
        let mut ctx = GwCtx::new("r6".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serves_configured_404_page_when_missing() {
        let primary = memory_op();
        seed(
            &primary,
            &[
                (
                    "domains/example.com/current.json",
                    r#"{"schema_version":1,"release":"abc","deployed_at":"t"}"#,
                ),
                (
                    "domains/example.com/releases/abc/app.config.json",
                    r#"{"not_found_page":"404.html"}"#,
                ),
                (
                    "domains/example.com/releases/abc/404.html",
                    "missing",
                ),
            ],
        )
        .await;

        let gw = build_gateway(primary, memory_op());
        let req = make_request("example.com", "/missing.html");
        let mut ctx = GwCtx::new("r7".into());
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
        let gw = build_gateway(memory_op(), memory_op());
        let req = make_request("nope.example.com", "/");
        let mut ctx = GwCtx::new("r8".into());
        let resp = gw.handle(req, &mut ctx).await;

        assert_eq!(resp.status, StatusCode::NOT_FOUND);
    }
}
