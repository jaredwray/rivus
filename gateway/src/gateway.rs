use async_trait::async_trait;

use crate::types::{GwCtx, GwRequest, GwResponse};

/// Driver-agnostic entry point that all gateway behaviour is implemented behind.
///
/// The driver layer (Pingora today, hyper+tower or anything else tomorrow)
/// builds a [`GwRequest`] + [`GwCtx`] from its native types, calls
/// [`Gateway::handle`], then writes the resulting [`GwResponse`] back to
/// the wire and emits the access log from `ctx.log`.
#[async_trait]
pub trait Gateway: Send + Sync + 'static {
    async fn handle(&self, req: GwRequest, ctx: &mut GwCtx) -> GwResponse;
}
