use thiserror::Error;

#[derive(Debug, Error)]
pub enum GwError {
    #[error("not found")]
    NotFound,

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("upstream timeout")]
    UpstreamTimeout,

    #[error("upstream error: {0}")]
    UpstreamError(String),

    #[error("internal error: {0}")]
    Internal(String),
}
