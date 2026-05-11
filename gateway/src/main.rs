use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use pingora::server::Server;
use pingora_proxy::http_proxy_service;
use rivus_gateway::{
    DefaultGateway, LayoutAResolver, OperatorConfig, OpsDriver, PingoraDriver, PointerCache,
    TieredStore,
};
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

fn main() -> Result<()> {
    init_tracing();

    let cfg = load_config().context("loading operator config")?;
    info!(
        public = %cfg.listeners.public.addr,
        ops = %cfg.listeners.ops.addr,
        "rivus-gateway starting"
    );

    let store = Arc::new(
        TieredStore::from_config(&cfg.storage)
            .context("constructing tiered storage")?,
    );
    let pointer_cache = PointerCache::new(cfg.pointer_cache.ttl_ms);
    let resolver = Arc::new(LayoutAResolver::new(store, pointer_cache));
    let gateway = Arc::new(DefaultGateway::new(resolver));

    let mut server = Server::new(None).map_err(|e| anyhow::anyhow!("pingora server: {e}"))?;
    server.bootstrap();

    let mut public = http_proxy_service(&server.configuration, PingoraDriver::new(gateway));
    public.add_tcp(&cfg.listeners.public.addr);
    server.add_service(public);

    let mut ops = http_proxy_service(&server.configuration, OpsDriver::new());
    ops.add_tcp(&cfg.listeners.ops.addr);
    server.add_service(ops);

    server.run_forever();
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let registry = tracing_subscriber::registry().with(filter);
    if env::var("RIVUS_LOG_FORMAT").as_deref() == Ok("json") {
        registry.with(fmt::layer().json()).init();
    } else {
        registry.with(fmt::layer()).init();
    }
    // Bridge log!() calls (used by Pingora and friends) into tracing.
    let _ = tracing_log::LogTracer::init();
}

fn load_config() -> Result<OperatorConfig> {
    let path = env::var("RIVUS_CONFIG").unwrap_or_else(|_| "config.json".to_string());
    let path = PathBuf::from(path);
    let raw = std::fs::read(&path)
        .with_context(|| format!("reading config from {}", path.display()))?;
    let cfg: OperatorConfig =
        serde_json::from_slice(&raw).context("parsing config as JSON")?;
    Ok(cfg)
}
