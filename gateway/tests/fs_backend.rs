use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;

use http::{HeaderMap, Method, StatusCode, Uri};
use rivus_gateway::{
    BackendSpec, DefaultGateway, FailoverConfig, Gateway, GwBody, GwCtx, GwRequest, LayoutAResolver,
    PeerInfo, PointerCache, StorageConfig, TieredStore,
};

/// End-to-end through the gateway against a real local-filesystem
/// backend. Exercises the full path: hostname normalization →
/// pointer read (primary) → app.config lookup (missing → default) →
/// blob read → response. The Pingora driver is exercised by hand
/// during dev; this test isolates the gateway logic.
#[tokio::test]
async fn serves_static_site_from_fs_backend() {
    let tmp = tempfile::tempdir().unwrap();
    let primary_root = tmp.path().join("primary");
    let secondary_root = tmp.path().join("secondary");

    let release_dir = primary_root.join("domains/example.com/releases/abc");
    std::fs::create_dir_all(&release_dir).unwrap();
    std::fs::write(release_dir.join("index.html"), "<h1>hello</h1>").unwrap();
    std::fs::write(
        primary_root.join("domains/example.com/current.json"),
        r#"{"schema_version":1,"release":"abc","deployed_at":"2026-05-10T00:00:00Z"}"#,
    )
    .unwrap();
    std::fs::create_dir_all(&secondary_root).unwrap();

    let cfg = StorageConfig {
        primary: BackendSpec::Fs {
            root: primary_root.to_string_lossy().into_owned(),
        },
        secondary: BackendSpec::Fs {
            root: secondary_root.to_string_lossy().into_owned(),
        },
        failover: FailoverConfig::default(),
    };
    let store = Arc::new(TieredStore::from_config(&cfg).unwrap());
    let resolver = Arc::new(LayoutAResolver::new(store, PointerCache::new(60_000)));
    let gw = DefaultGateway::new(resolver);

    let req = GwRequest {
        method: Method::GET,
        uri: Uri::from_str("/").unwrap(),
        host: "example.com".into(),
        headers: HeaderMap::new(),
        body: GwBody::Empty,
        peer: PeerInfo {
            client_ip: IpAddr::from([127, 0, 0, 1]),
            country: None,
            cf_ray: None,
        },
    };
    let mut ctx = GwCtx::new("rid".into());

    let resp = gw.handle(req, &mut ctx).await;
    assert_eq!(resp.status, StatusCode::OK);
    if let GwBody::Bytes(b) = resp.body {
        assert_eq!(&b[..], b"<h1>hello</h1>");
    } else {
        panic!("expected Bytes body");
    }
    assert_eq!(ctx.log.matched_domain.as_deref(), Some("example.com"));
    assert_eq!(ctx.log.release_sha.as_deref(), Some("abc"));
}

#[tokio::test]
async fn falls_through_to_secondary_when_primary_missing_path() {
    let tmp = tempfile::tempdir().unwrap();
    let primary_root = tmp.path().join("primary");
    let secondary_root = tmp.path().join("secondary");

    // Both tiers carry the same release shape, but only secondary has the asset.
    let p_release = primary_root.join("domains/example.com/releases/abc");
    let s_release = secondary_root.join("domains/example.com/releases/abc");
    std::fs::create_dir_all(&p_release).unwrap();
    std::fs::create_dir_all(&s_release).unwrap();
    std::fs::write(
        primary_root.join("domains/example.com/current.json"),
        r#"{"schema_version":1,"release":"abc","deployed_at":"2026-05-10T00:00:00Z"}"#,
    )
    .unwrap();
    std::fs::write(s_release.join("page.html"), "from-secondary").unwrap();

    let cfg = StorageConfig {
        primary: BackendSpec::Fs {
            root: primary_root.to_string_lossy().into_owned(),
        },
        secondary: BackendSpec::Fs {
            root: secondary_root.to_string_lossy().into_owned(),
        },
        failover: FailoverConfig::default(),
    };
    let store = Arc::new(TieredStore::from_config(&cfg).unwrap());
    let resolver = Arc::new(LayoutAResolver::new(store, PointerCache::new(60_000)));
    let gw = DefaultGateway::new(resolver);

    let req = GwRequest {
        method: Method::GET,
        uri: Uri::from_str("/page.html").unwrap(),
        host: "example.com".into(),
        headers: HeaderMap::new(),
        body: GwBody::Empty,
        peer: PeerInfo {
            client_ip: IpAddr::from([127, 0, 0, 1]),
            country: None,
            cf_ray: None,
        },
    };
    let mut ctx = GwCtx::new("rid".into());

    let resp = gw.handle(req, &mut ctx).await;
    assert_eq!(resp.status, StatusCode::OK);
    if let GwBody::Bytes(b) = resp.body {
        assert_eq!(&b[..], b"from-secondary");
    } else {
        panic!("expected Bytes body");
    }
}
