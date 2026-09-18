use serde::Serialize;
use sqlx::FromRow;

/// Response shape shared by setup/login/password-change — a fresh bearer
/// token plus the account username and when the token expires.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub token: String,
    pub username: String,
    pub expires_at: String,
}

/// Row shape for the single `admin_account` record.
#[derive(Debug, FromRow)]
pub struct AdminAccountRow {
    pub username: String,
    pub password_hash: String,
}
