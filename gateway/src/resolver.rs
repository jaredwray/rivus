use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;

use crate::cache::PointerCache;
use crate::config::{AppConfig, CurrentJson};
use crate::error::GwError;
use crate::storage::TieredStore;
use crate::types::OriginTier;

/// How the gateway turns a `(host, request_path)` into a concrete blob
/// in object storage.
///
/// Today only Layout A (per-release file tree) is implemented. Layout B
/// (manifest + content-addressed blobs) plugs in here without changing
/// any caller.
#[async_trait]
pub trait ReleaseResolver: Send + Sync + 'static {
    async fn current_release(&self, host: &str) -> Result<(CurrentJson, OriginTier), GwError>;

    async fn read_blob(
        &self,
        host: &str,
        release: &str,
        path: &str,
    ) -> Result<(Bytes, OriginTier), GwError>;

    async fn app_config(&self, host: &str, release: &str) -> Result<Arc<AppConfig>, GwError>;
}

/// Layout A: every release ships its own complete file tree under
/// `domains/<host>/releases/<sha>/...`.
pub struct LayoutAResolver {
    store: Arc<TieredStore>,
    pointer_cache: PointerCache,
    app_config_cache: moka::future::Cache<(String, String), Arc<AppConfig>>,
}

impl LayoutAResolver {
    pub fn new(store: Arc<TieredStore>, pointer_cache: PointerCache) -> Self {
        Self {
            store,
            pointer_cache,
            app_config_cache: moka::future::Cache::builder()
                .max_capacity(10_000)
                .build(),
        }
    }

    fn pointer_key(host: &str) -> String {
        format!("domains/{host}/current.json")
    }

    fn app_config_key(host: &str, release: &str) -> String {
        format!("domains/{host}/releases/{release}/app.config.json")
    }

    fn blob_key(host: &str, release: &str, path: &str) -> String {
        let path = path.trim_start_matches('/');
        format!("domains/{host}/releases/{release}/{path}")
    }
}

#[async_trait]
impl ReleaseResolver for LayoutAResolver {
    async fn current_release(&self, host: &str) -> Result<(CurrentJson, OriginTier), GwError> {
        let key = Self::pointer_key(host);
        let store = self.store.clone();
        let key_for_loader = key.clone();
        let (raw, tier) = self
            .pointer_cache
            .get_or_load(key, move || async move {
                store.get_with_tier(&key_for_loader).await
            })
            .await?;

        let pointer: CurrentJson = serde_json::from_slice(&raw)
            .map_err(|e| GwError::Storage(format!("current.json parse: {e}")))?;
        Ok((pointer, tier))
    }

    async fn read_blob(
        &self,
        host: &str,
        release: &str,
        path: &str,
    ) -> Result<(Bytes, OriginTier), GwError> {
        let key = Self::blob_key(host, release, path);
        self.store.get_with_tier(&key).await
    }

    async fn app_config(&self, host: &str, release: &str) -> Result<Arc<AppConfig>, GwError> {
        let cache_key = (host.to_string(), release.to_string());
        if let Some(cfg) = self.app_config_cache.get(&cache_key).await {
            return Ok(cfg);
        }
        let key = Self::app_config_key(host, release);
        let cfg = match self.store.get_with_tier(&key).await {
            Ok((raw, _)) => Arc::new(AppConfig::from_json(&raw)?),
            // Missing app.config.json is allowed — fall back to defaults.
            Err(GwError::NotFound) => Arc::new(AppConfig::default()),
            Err(e) => return Err(e),
        };
        self.app_config_cache.insert(cache_key, cfg.clone()).await;
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::FailoverConfig;
    use crate::storage::Tier;
    use opendal::services;
    use opendal::Operator;

    fn memory_op() -> Operator {
        Operator::new(services::Memory::default()).unwrap().finish()
    }

    fn store_with(primary: Operator, secondary: Operator) -> Arc<TieredStore> {
        Arc::new(TieredStore::new(
            Tier {
                name: "primary",
                op: primary,
            },
            Tier {
                name: "secondary",
                op: secondary,
            },
            FailoverConfig::default(),
        ))
    }

    #[tokio::test]
    async fn resolves_pointer_then_blob() {
        let primary = memory_op();
        primary
            .write(
                "domains/example.com/current.json",
                r#"{"schema_version":1,"release":"abc","deployed_at":"now"}"#,
            )
            .await
            .unwrap();
        primary
            .write("domains/example.com/releases/abc/index.html", "hello")
            .await
            .unwrap();
        let store = store_with(primary.clone(), memory_op());

        let resolver = LayoutAResolver::new(store, PointerCache::new(60_000));

        let (pointer, tier) = resolver.current_release("example.com").await.unwrap();
        assert_eq!(pointer.release, "abc");
        assert_eq!(tier, OriginTier::Primary);

        let (body, _) = resolver
            .read_blob("example.com", "abc", "/index.html")
            .await
            .unwrap();
        assert_eq!(&body[..], b"hello");
    }

    #[tokio::test]
    async fn missing_app_config_returns_defaults() {
        let store = store_with(memory_op(), memory_op());
        let resolver = LayoutAResolver::new(store, PointerCache::new(60_000));

        let cfg = resolver.app_config("example.com", "abc").await.unwrap();
        assert_eq!(cfg.default_index, "index.html");
    }
}
