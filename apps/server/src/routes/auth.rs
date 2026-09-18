use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::auth::{AdminAccountRow, AuthSession};
use crate::state::AppState;

/// Public: reachable without a token. Protected sub-routes (logout,
/// password change) live in `protected_router` so `routes/mod.rs` can apply
/// the auth guard to only those.
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/setup", post(setup))
        .route("/login", post(login))
}

pub fn protected_router() -> Router<AppState> {
    Router::new().route("/logout", post(logout)).route("/password", post(change_password))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    needs_setup: bool,
    authenticated: bool,
    username: Option<String>,
}

#[derive(Deserialize)]
struct SetupInput {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginInput {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordInput {
    current_password: String,
    new_password: String,
}

async fn status(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<StatusResponse>> {
    let account = fetch_account(&state.pool).await?;
    let needs_setup = account.is_none();
    let username = account.map(|a| a.username);
    let authenticated = match extract_token(&headers) {
        Some(token) => session_valid(&state.pool, &token).await?,
        None => false,
    };
    Ok(Json(StatusResponse { needs_setup, authenticated, username }))
}

async fn setup(State(state): State<AppState>, Json(input): Json<SetupInput>) -> AppResult<Json<AuthSession>> {
    if fetch_account(&state.pool).await?.is_some() {
        return Err(AppError::Conflict("already_initialized".to_string()));
    }
    validate_username(&input.username)?;
    validate_password(&input.password)?;

    let hash = hash_password(&input.password)?;
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO admin_account (id, username, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
    )
    .bind(&input.username)
    .bind(&hash)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    let session = create_session(&state.pool, state.session_ttl_hours, input.username).await?;
    Ok(Json(session))
}

async fn login(State(state): State<AppState>, Json(input): Json<LoginInput>) -> AppResult<Json<AuthSession>> {
    let account = fetch_account(&state.pool).await?.ok_or_else(|| AppError::Conflict("needs_setup".to_string()))?;

    // Same error for wrong username and wrong password, so responses don't
    // leak whether a username exists.
    let matches_username = account.username == input.username;
    let matches_password = verify_password(&input.password, &account.password_hash)?;
    if !matches_username || !matches_password {
        return Err(AppError::Unauthorized("invalid_credentials".to_string()));
    }

    let session = create_session(&state.pool, state.session_ttl_hours, account.username).await?;
    Ok(Json(session))
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> AppResult<axum::http::StatusCode> {
    if let Some(token) = extract_token(&headers) {
        sqlx::query("DELETE FROM auth_sessions WHERE token = ?").bind(token).execute(&state.pool).await?;
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn change_password(State(state): State<AppState>, Json(input): Json<PasswordInput>) -> AppResult<Json<AuthSession>> {
    // The guard already confirmed an account exists to reach this handler.
    let account = fetch_account(&state.pool).await?.ok_or_else(|| AppError::Unauthorized("needs_setup".to_string()))?;
    if !verify_password(&input.current_password, &account.password_hash)? {
        return Err(AppError::Unauthorized("invalid_credentials".to_string()));
    }
    validate_password(&input.new_password)?;

    let hash = hash_password(&input.new_password)?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE admin_account SET password_hash = ?, updated_at = ? WHERE id = 1")
        .bind(&hash)
        .bind(&now)
        .execute(&state.pool)
        .await?;
    // Changing the password invalidates every other logged-in session,
    // including the one used to make this request.
    sqlx::query("DELETE FROM auth_sessions").execute(&state.pool).await?;

    let session = create_session(&state.pool, state.session_ttl_hours, account.username).await?;
    Ok(Json(session))
}

/// Guard applied to every other `/api/*` route via `route_layer`. Checks
/// account existence before token validity so the UI can distinguish
/// "needs setup" from "needs login".
pub async fn require_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    match account_exists(&state.pool).await {
        Ok(true) => {}
        Ok(false) => return AppError::Unauthorized("needs_setup".to_string()).into_response(),
        Err(err) => return err.into_response(),
    }

    // `EventSource` (used by the UI's connections stream) can't set the
    // `Authorization` header, so fall back to a `?token=` query param when
    // there's no header. Fine for a localhost-bound admin API; every other
    // route still only ever sends/reads the token as a header.
    let token = match extract_token(req.headers()).or_else(|| extract_token_from_query(req.uri().query())) {
        Some(token) => token,
        None => return AppError::Unauthorized("unauthorized".to_string()).into_response(),
    };

    match session_valid(&state.pool, &token).await {
        Ok(true) => next.run(req).await,
        Ok(false) => AppError::Unauthorized("unauthorized".to_string()).into_response(),
        Err(err) => err.into_response(),
    }
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// `EventSource` (used by the UI's connections stream) can't set custom
/// headers, so the guard also accepts the token as a `?token=` query param.
/// Fine for a localhost-bound admin API; not used anywhere tokens are
/// normally sent as headers (login, logout, etc. still require the header).
fn extract_token_from_query(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "token" && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

async fn account_exists(pool: &SqlitePool) -> AppResult<bool> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_account WHERE id = 1").fetch_one(pool).await?;
    Ok(count > 0)
}

async fn fetch_account(pool: &SqlitePool) -> AppResult<Option<AdminAccountRow>> {
    let row = sqlx::query_as::<_, AdminAccountRow>("SELECT username, password_hash FROM admin_account WHERE id = 1")
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

/// Prunes expired sessions, then reports whether `token` still resolves to
/// a live one.
async fn session_valid(pool: &SqlitePool, token: &str) -> AppResult<bool> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at < ?").bind(&now).execute(pool).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_sessions WHERE token = ?")
        .bind(token)
        .fetch_one(pool)
        .await?;
    Ok(count > 0)
}

async fn create_session(pool: &SqlitePool, ttl_hours: i64, username: String) -> AppResult<AuthSession> {
    let token = generate_token();
    let now = Utc::now();
    let expires_at = (now + Duration::hours(ttl_hours)).to_rfc3339();
    sqlx::query("INSERT INTO auth_sessions (token, created_at, expires_at) VALUES (?, ?, ?)")
        .bind(&token)
        .bind(now.to_rfc3339())
        .bind(&expires_at)
        .execute(pool)
        .await?;
    Ok(AuthSession { token, username, expires_at })
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| AppError::Internal(anyhow::anyhow!("password hash failed: {err}")))
}

fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash).map_err(|err| AppError::Internal(anyhow::anyhow!("password hash parse failed: {err}")))?;
    Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
}

fn validate_username(username: &str) -> AppResult<()> {
    if username.trim().is_empty() {
        return Err(AppError::Validation("username_required".to_string()));
    }
    if username.chars().count() > 64 {
        return Err(AppError::Validation("username_too_long".to_string()));
    }
    Ok(())
}

fn validate_password(password: &str) -> AppResult<()> {
    let len = password.chars().count();
    if len < 8 {
        return Err(AppError::Validation("password_too_short".to_string()));
    }
    if len > 128 {
        return Err(AppError::Validation("password_too_long".to_string()));
    }
    Ok(())
}
