use std::future::Future;
use std::time::Duration;

use bytes::Bytes;
use moka::future::Cache;

use crate::error::GwError;
use crate::types::OriginTier;

/// In-process TTL cache for the deploy pointer (`current.json`).
///
/// v0.1 is plain TTL; v0.2 will add stale-while-revalidate (background
/// refresh while continuing to serve the cached value).
#[derive(Clone)]
pub struct PointerCache {
    inner: Cache<String, (Bytes, OriginTier)>,
}

impl PointerCache {
    pub fn new(ttl_ms: u64) -> Self {
        Self {
            inner: Cache::builder()
                .max_capacity(10_000)
                .time_to_live(Duration::from_millis(ttl_ms))
                .build(),
        }
    }

    /// Returns the cached value if fresh, otherwise calls `loader` and
    /// stores the result.
    pub async fn get_or_load<F, Fut>(
        &self,
        key: String,
        loader: F,
    ) -> Result<(Bytes, OriginTier), GwError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<(Bytes, OriginTier), GwError>>,
    {
        if let Some(v) = self.inner.get(&key).await {
            return Ok(v);
        }
        let v = loader().await?;
        self.inner.insert(key, v.clone()).await;
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn loads_on_miss_and_caches() {
        let cache = PointerCache::new(60_000);
        let calls = Arc::new(AtomicUsize::new(0));

        for _ in 0..3 {
            let calls = calls.clone();
            let v = cache
                .get_or_load("k".into(), || async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok((Bytes::from_static(b"v"), OriginTier::Primary))
                })
                .await
                .unwrap();
            assert_eq!(&v.0[..], b"v");
            assert_eq!(v.1, OriginTier::Primary);
        }

        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn loader_error_is_not_cached() {
        let cache = PointerCache::new(60_000);
        let res = cache
            .get_or_load("k".into(), || async {
                Err::<(Bytes, OriginTier), _>(GwError::NotFound)
            })
            .await;
        assert!(matches!(res, Err(GwError::NotFound)));

        let res = cache
            .get_or_load("k".into(), || async {
                Ok((Bytes::from_static(b"v"), OriginTier::Primary))
            })
            .await
            .unwrap();
        assert_eq!(&res.0[..], b"v");
    }
}
