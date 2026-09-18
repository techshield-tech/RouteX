use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::rule_group::{RuleGroup, RuleGroupInput};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<RuleGroup>>> {
    let rows = sqlx::query_as::<_, RuleGroup>("SELECT id, name, note, enabled FROM rule_groups ORDER BY rowid")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<RuleGroup>> {
    let row = sqlx::query_as::<_, RuleGroup>("SELECT id, name, note, enabled FROM rule_groups WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;
    Ok(Json(row))
}

async fn create(State(state): State<AppState>, Json(input): Json<RuleGroupInput>) -> AppResult<Json<RuleGroup>> {
    let id = format!("grp-{}", Uuid::new_v4());
    sqlx::query("INSERT INTO rule_groups (id, name, note, enabled) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&input.name)
        .bind(&input.note)
        .bind(input.enabled)
        .execute(&state.pool)
        .await?;
    Ok(Json(RuleGroup {
        id,
        name: input.name,
        note: input.note,
        enabled: input.enabled,
    }))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<RuleGroupInput>,
) -> AppResult<Json<RuleGroup>> {
    let result = sqlx::query("UPDATE rule_groups SET name = ?, note = ?, enabled = ? WHERE id = ?")
        .bind(&input.name)
        .bind(&input.note)
        .bind(input.enabled)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("not_found".to_string()));
    }
    Ok(Json(RuleGroup {
        id,
        name: input.name,
        note: input.note,
        enabled: input.enabled,
    }))
}

/// Cascade: templates in the group become standalone (never deleted), and
/// route entries that target the group directly are deleted with it —
/// mirrors `removeRuleGroup` in `useConfigStore.tsx`.
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;

    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM rule_groups WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("not_found".to_string()));
    }

    sqlx::query("UPDATE rule_templates SET group_id = NULL WHERE group_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    let orphan_entries: Vec<String> =
        sqlx::query_scalar("SELECT id FROM route_entries WHERE target_kind = 'group' AND target_id = ?")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await?;
    for entry_id in &orphan_entries {
        sqlx::query("DELETE FROM route_entry_listeners WHERE route_entry_id = ?")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM route_entries WHERE target_kind = 'group' AND target_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM rule_groups WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
