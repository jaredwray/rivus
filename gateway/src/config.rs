use std::collections::BTreeMap;

use http::{HeaderName, HeaderValue, StatusCode};
use serde::Deserialize;

use crate::error::GwError;
use crate::routing::CompiledPattern;

// ---------- Operator config (loaded at process start) ----------

#[derive(Debug, Deserialize, Clone)]
pub struct OperatorConfig {
    pub listeners: ListenersConfig,
    pub storage: StorageConfig,
    #[serde(default)]
    pub pointer_cache: PointerCacheConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ListenersConfig {
    pub public: ListenerSpec,
    pub ops: ListenerSpec,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ListenerSpec {
    pub addr: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StorageConfig {
    pub primary: BackendSpec,
    pub secondary: BackendSpec,
    #[serde(default)]
    pub failover: FailoverConfig,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BackendSpec {
    Fs {
        root: String,
    },
    Memory,
    S3 {
        bucket: String,
        region: String,
        #[serde(default)]
        endpoint: Option<String>,
        #[serde(default)]
        access_key_id: Option<String>,
        #[serde(default)]
        secret_access_key: Option<String>,
    },
    Gcs {
        bucket: String,
        #[serde(default)]
        credential_path: Option<String>,
    },
    Azblob {
        container: String,
        account_name: String,
        #[serde(default)]
        account_key: Option<String>,
    },
}

#[derive(Debug, Deserialize, Clone)]
pub struct FailoverConfig {
    #[serde(default = "default_primary_timeout_ms")]
    pub primary_attempt_timeout_ms: u64,
    #[serde(default = "default_primary_retries")]
    pub primary_retry_count: u32,
    #[serde(default = "default_fallthrough_on_404")]
    pub fallthrough_on_404: bool,
}

impl Default for FailoverConfig {
    fn default() -> Self {
        Self {
            primary_attempt_timeout_ms: default_primary_timeout_ms(),
            primary_retry_count: default_primary_retries(),
            fallthrough_on_404: default_fallthrough_on_404(),
        }
    }
}

fn default_primary_timeout_ms() -> u64 {
    800
}
fn default_primary_retries() -> u32 {
    1
}
fn default_fallthrough_on_404() -> bool {
    true
}

#[derive(Debug, Deserialize, Clone)]
pub struct PointerCacheConfig {
    #[serde(default = "default_pointer_ttl_ms")]
    pub ttl_ms: u64,
}

impl Default for PointerCacheConfig {
    fn default() -> Self {
        Self {
            ttl_ms: default_pointer_ttl_ms(),
        }
    }
}

fn default_pointer_ttl_ms() -> u64 {
    30_000
}

// ---------- Pointer file ----------

/// `current.json` — the deploy pointer the gateway reads to find the active release.
#[derive(Debug, Deserialize, Clone)]
pub struct CurrentJson {
    pub schema_version: u32,
    pub release: String,
    pub deployed_at: String,
    #[serde(default)]
    pub ttl_hint: Option<u64>,
}

// ---------- Per-domain config (lives in each release folder) ----------

/// Compiled per-domain `app.config.json`. Pattern strings have been
/// converted to regexes, header names/values to `http` types, redirect
/// statuses to `StatusCode`. Built once per `(host, release)` via
/// [`AppConfig::from_json`] and cached by the resolver.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub schema_version: u32,
    pub default_index: String,
    pub not_found_page: Option<String>,
    pub spa_fallback: bool,
    pub redirects: Vec<Redirect>,
    pub rewrites: Vec<Rewrite>,
    pub headers: Vec<HeaderRule>,
}

#[derive(Debug, Clone)]
pub struct Redirect {
    pub pattern: CompiledPattern,
    pub to: String,
    pub status: StatusCode,
}

#[derive(Debug, Clone)]
pub struct Rewrite {
    pub pattern: CompiledPattern,
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct HeaderRule {
    pub pattern: CompiledPattern,
    pub set: Vec<(HeaderName, HeaderValue)>,
}

impl AppConfig {
    /// Parse + compile from on-disk JSON. The returned value is ready
    /// to drive matching at request time.
    pub fn from_json(raw: &[u8]) -> Result<Self, GwError> {
        let raw: AppConfigRaw = serde_json::from_slice(raw)
            .map_err(|e| GwError::Storage(format!("app.config.json parse: {e}")))?;
        Self::try_from(raw)
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            default_index: default_index(),
            not_found_page: None,
            spa_fallback: false,
            redirects: Vec::new(),
            rewrites: Vec::new(),
            headers: Vec::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    1
}
fn default_index() -> String {
    "index.html".to_string()
}
fn default_redirect_status() -> u16 {
    301
}

// ---------- Raw (on-disk JSON) shape ----------

#[derive(Debug, Deserialize)]
struct AppConfigRaw {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default = "default_index")]
    default_index: String,
    #[serde(default)]
    not_found_page: Option<String>,
    #[serde(default)]
    spa_fallback: bool,
    #[serde(default)]
    redirects: Vec<RedirectRaw>,
    #[serde(default)]
    rewrites: Vec<RewriteRaw>,
    #[serde(default)]
    headers: Vec<HeaderRuleRaw>,
}

#[derive(Debug, Deserialize)]
struct RedirectRaw {
    from: String,
    to: String,
    #[serde(default = "default_redirect_status")]
    status: u16,
}

#[derive(Debug, Deserialize)]
struct RewriteRaw {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct HeaderRuleRaw {
    path: String,
    #[serde(default)]
    set: BTreeMap<String, String>,
}

impl TryFrom<AppConfigRaw> for AppConfig {
    type Error = GwError;

    fn try_from(r: AppConfigRaw) -> Result<Self, Self::Error> {
        let redirects = r
            .redirects
            .into_iter()
            .map(|raw| {
                let pattern = CompiledPattern::new(&raw.from)
                    .map_err(|e| GwError::Storage(format!("redirect from `{}`: {e}", raw.from)))?;
                let status = StatusCode::from_u16(raw.status).map_err(|_| {
                    GwError::Storage(format!("redirect status `{}` is not valid", raw.status))
                })?;
                if !status.is_redirection() {
                    return Err(GwError::Storage(format!(
                        "redirect status `{}` is not a 3xx code",
                        raw.status
                    )));
                }
                Ok(Redirect {
                    pattern,
                    to: raw.to,
                    status,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let rewrites = r
            .rewrites
            .into_iter()
            .map(|raw| {
                let pattern = CompiledPattern::new(&raw.from)
                    .map_err(|e| GwError::Storage(format!("rewrite from `{}`: {e}", raw.from)))?;
                Ok(Rewrite {
                    pattern,
                    to: raw.to,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let headers = r
            .headers
            .into_iter()
            .map(|raw| {
                let pattern = CompiledPattern::new(&raw.path)
                    .map_err(|e| GwError::Storage(format!("header rule `{}`: {e}", raw.path)))?;
                let set = raw
                    .set
                    .into_iter()
                    .map(|(name, value)| {
                        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| {
                            GwError::Storage(format!("header name `{name}`: {e}"))
                        })?;
                        let value = HeaderValue::from_str(&value).map_err(|e| {
                            GwError::Storage(format!("header value `{value}`: {e}"))
                        })?;
                        Ok::<_, GwError>((name, value))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(HeaderRule { pattern, set })
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(AppConfig {
            schema_version: r.schema_version,
            default_index: r.default_index,
            not_found_page: r.not_found_page,
            spa_fallback: r.spa_fallback,
            redirects,
            rewrites,
            headers,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_object_parses_to_defaults() {
        let cfg = AppConfig::from_json(b"{}").unwrap();
        assert_eq!(cfg.schema_version, 1);
        assert_eq!(cfg.default_index, "index.html");
        assert_eq!(cfg.not_found_page, None);
        assert!(!cfg.spa_fallback);
        assert!(cfg.redirects.is_empty());
        assert!(cfg.rewrites.is_empty());
        assert!(cfg.headers.is_empty());
    }

    #[test]
    fn full_config_parses_and_compiles() {
        let cfg = AppConfig::from_json(
            br#"{
                "schema_version": 1,
                "default_index": "index.html",
                "not_found_page": "404.html",
                "spa_fallback": true,
                "redirects": [
                    { "from": "/old/*", "to": "/new/$1", "status": 308 }
                ],
                "rewrites": [
                    { "from": "/api/*", "to": "/handlers/api/$1" }
                ],
                "headers": [
                    { "path": "/*", "set": { "X-Frame-Options": "DENY" } },
                    { "path": "/assets/*", "set": { "Cache-Control": "public, max-age=31536000" } }
                ]
            }"#,
        )
        .unwrap();

        assert!(cfg.spa_fallback);
        assert_eq!(cfg.redirects.len(), 1);
        assert_eq!(cfg.redirects[0].status, StatusCode::PERMANENT_REDIRECT);
        assert_eq!(cfg.rewrites.len(), 1);
        assert_eq!(cfg.headers.len(), 2);
        assert_eq!(cfg.headers[0].set[0].0, http::header::X_FRAME_OPTIONS);
    }

    #[test]
    fn non_3xx_redirect_status_is_rejected() {
        let err = AppConfig::from_json(
            br#"{ "redirects": [{"from":"/a","to":"/b","status":200}] }"#,
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("3xx"), "got: {msg}");
    }

    #[test]
    fn invalid_header_name_is_rejected() {
        let err = AppConfig::from_json(
            br#"{ "headers": [{"path":"/*","set":{"bad header":"x"}}] }"#,
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("bad header"), "got: {msg}");
    }
}
