use std::time::Duration;

use bytes::Bytes;
use opendal::{ErrorKind, Operator};
use tokio::time::timeout;
use tracing::debug;

use crate::config::{BackendSpec, FailoverConfig, StorageConfig};
use crate::error::GwError;
use crate::types::OriginTier;

/// One configured object-storage backend (primary or secondary).
pub struct Tier {
    pub name: &'static str,
    pub op: Operator,
}

/// Primary + secondary pair with the failover semantics from the
/// "Atomic Deploys" contract: try primary with a deadline, fall through
/// to secondary on transport errors / timeouts / 5xx / 429 / (optionally)
/// 404. Auth errors do NOT fall through — surfaced so misconfiguration
/// is visible.
pub struct TieredStore {
    primary: Tier,
    secondary: Tier,
    failover: FailoverConfig,
}

impl TieredStore {
    pub fn new(primary: Tier, secondary: Tier, failover: FailoverConfig) -> Self {
        Self {
            primary,
            secondary,
            failover,
        }
    }

    pub fn from_config(cfg: &StorageConfig) -> Result<Self, GwError> {
        let primary = build_operator(&cfg.primary)
            .map_err(|e| GwError::Storage(format!("primary: {e}")))?;
        let secondary = build_operator(&cfg.secondary)
            .map_err(|e| GwError::Storage(format!("secondary: {e}")))?;
        Ok(Self {
            primary: Tier {
                name: "primary",
                op: primary,
            },
            secondary: Tier {
                name: "secondary",
                op: secondary,
            },
            failover: cfg.failover.clone(),
        })
    }

    /// Read a key, returning the bytes plus which tier served them.
    pub async fn get_with_tier(&self, key: &str) -> Result<(Bytes, OriginTier), GwError> {
        let primary_attempt = timeout(
            Duration::from_millis(self.failover.primary_attempt_timeout_ms),
            self.primary.op.read(key),
        )
        .await;

        match primary_attempt {
            Ok(Ok(buf)) => return Ok((buf.to_bytes(), OriginTier::Primary)),
            Ok(Err(e)) if !self.should_fall_through(&e) => {
                return Err(map_opendal_error(e));
            }
            Ok(Err(e)) => debug!(error = %e, "primary read failed, trying secondary"),
            Err(_) => debug!("primary timed out, trying secondary"),
        }

        match self.secondary.op.read(key).await {
            Ok(buf) => Ok((buf.to_bytes(), OriginTier::Secondary)),
            Err(e) => Err(map_opendal_error(e)),
        }
    }

    fn should_fall_through(&self, e: &opendal::Error) -> bool {
        match e.kind() {
            ErrorKind::NotFound => self.failover.fallthrough_on_404,
            ErrorKind::PermissionDenied => false,
            _ => true,
        }
    }
}

fn build_operator(spec: &BackendSpec) -> Result<Operator, opendal::Error> {
    use opendal::services;
    let op = match spec {
        BackendSpec::Fs { root } => {
            let builder = services::Fs::default().root(root);
            Operator::new(builder)?.finish()
        }
        BackendSpec::Memory => {
            let builder = services::Memory::default();
            Operator::new(builder)?.finish()
        }
        BackendSpec::S3 {
            bucket,
            region,
            endpoint,
            access_key_id,
            secret_access_key,
        } => {
            let mut builder = services::S3::default().bucket(bucket).region(region);
            if let Some(e) = endpoint {
                builder = builder.endpoint(e);
            }
            if let Some(k) = access_key_id {
                builder = builder.access_key_id(k);
            }
            if let Some(s) = secret_access_key {
                builder = builder.secret_access_key(s);
            }
            Operator::new(builder)?.finish()
        }
        BackendSpec::Gcs {
            bucket,
            credential_path,
        } => {
            let mut builder = services::Gcs::default().bucket(bucket);
            if let Some(p) = credential_path {
                builder = builder.credential_path(p);
            }
            Operator::new(builder)?.finish()
        }
        BackendSpec::Azblob {
            container,
            account_name,
            account_key,
        } => {
            let mut builder = services::Azblob::default()
                .container(container)
                .account_name(account_name);
            if let Some(k) = account_key {
                builder = builder.account_key(k);
            }
            Operator::new(builder)?.finish()
        }
    };
    Ok(op)
}

fn map_opendal_error(e: opendal::Error) -> GwError {
    match e.kind() {
        ErrorKind::NotFound => GwError::NotFound,
        ErrorKind::PermissionDenied => {
            GwError::UpstreamError(format!("permission denied: {e}"))
        }
        _ => GwError::Storage(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opendal::services;

    fn memory_op() -> Operator {
        Operator::new(services::Memory::default()).unwrap().finish()
    }

    fn store_with(primary: Operator, secondary: Operator) -> TieredStore {
        TieredStore {
            primary: Tier {
                name: "primary",
                op: primary,
            },
            secondary: Tier {
                name: "secondary",
                op: secondary,
            },
            failover: FailoverConfig::default(),
        }
    }

    #[tokio::test]
    async fn primary_serves_when_present() {
        let primary = memory_op();
        primary.write("k", "primary-value").await.unwrap();
        let store = store_with(primary, memory_op());

        let (data, tier) = store.get_with_tier("k").await.unwrap();
        assert_eq!(&data[..], b"primary-value");
        assert_eq!(tier, OriginTier::Primary);
    }

    #[tokio::test]
    async fn falls_through_to_secondary_on_404() {
        let secondary = memory_op();
        secondary.write("k", "secondary-value").await.unwrap();
        let store = store_with(memory_op(), secondary);

        let (data, tier) = store.get_with_tier("k").await.unwrap();
        assert_eq!(&data[..], b"secondary-value");
        assert_eq!(tier, OriginTier::Secondary);
    }

    #[tokio::test]
    async fn returns_not_found_when_neither_has_key() {
        let store = store_with(memory_op(), memory_op());
        let err = store.get_with_tier("nope").await.unwrap_err();
        assert!(matches!(err, GwError::NotFound));
    }

    #[tokio::test]
    async fn fallthrough_on_404_disabled_returns_not_found_directly() {
        let secondary = memory_op();
        secondary.write("k", "secondary-value").await.unwrap();
        let mut failover = FailoverConfig::default();
        failover.fallthrough_on_404 = false;

        let store = TieredStore {
            primary: Tier {
                name: "primary",
                op: memory_op(),
            },
            secondary: Tier {
                name: "secondary",
                op: secondary,
            },
            failover,
        };
        let err = store.get_with_tier("k").await.unwrap_err();
        assert!(matches!(err, GwError::NotFound));
    }
}
