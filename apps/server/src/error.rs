use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// Unified error type for the API. `code` is machine-readable (the UI owns
/// display text), `message` is a short technical note for logs/debugging.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound(code) => (StatusCode::NOT_FOUND, code.clone(), self.to_string()),
            AppError::Validation(code) => (StatusCode::BAD_REQUEST, code.clone(), self.to_string()),
            AppError::Conflict(code) => (StatusCode::CONFLICT, code.clone(), self.to_string()),
            AppError::Unauthorized(code) => (StatusCode::UNAUTHORIZED, code.clone(), self.to_string()),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal".to_string(),
                self.to_string(),
            ),
        };
        (status, Json(ErrorBody { error: code, message })).into_response()
    }
}

// Lets route handlers use `?` on sqlx results directly.
impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Internal(anyhow::anyhow!(err))
    }
}

pub type AppResult<T> = Result<T, AppError>;
