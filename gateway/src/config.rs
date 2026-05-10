use serde::Deserialize;

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

/// `current.json` — the deploy pointer the gateway reads to find the active release.
#[derive(Debug, Deserialize, Clone)]
pub struct CurrentJson {
    pub schema_version: u32,
    pub release: String,
    pub deployed_at: String,
    #[serde(default)]
    pub ttl_hint: Option<u64>,
}

/// `app.config.json` — per-domain config, lives inside each release folder.
///
/// v0.1 supports only the bare-minimum fields. Redirects, custom headers,
/// SPA fallback, security-header injection, etc. land in subsequent commits.
#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_index")]
    pub default_index: String,
    #[serde(default)]
    pub not_found_page: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            default_index: default_index(),
            not_found_page: None,
        }
    }
}

fn default_schema_version() -> u32 {
    1
}
fn default_index() -> String {
    "index.html".to_string()
}
