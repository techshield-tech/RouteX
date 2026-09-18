use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::rule_template::{ReorderTemplatesRequest, RuleTemplate, RuleTemplateInput, RuleTemplateRow};
use crate::state::AppState;
use crate::validate::validate_pattern;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/reorder", axum::routing::put(reorder))
        .route("/{id}", get(get_one).put(update).delete(remove))
}

async fn list(State(state): State<AppState>) -> AppResult<Json<Vec<RuleTemplate>>> {
    let rows = sqlx::query_as::<_, RuleTemplateRow>(
        "SELECT id, name, enabled, match_type, pattern, note, group_id, position FROM rule_templates
         ORDER BY group_id IS NOT NULL, group_id, position",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(RuleTemplateRow::into_model).collect()))
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<RuleTemplate>> {
    let row = sqlx::query_as::<_, RuleTemplateRow>(
        "SELECT id, name, enabled, match_type, pattern, note, group_id, position FROM rule_templates WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;
    Ok(Json(row.into_model()))
}

async fn next_position(pool: &sqlx::SqlitePool, group_id: &Option<String>) -> AppResult<i64> {
    let sql = "SELECT COALESCE(MAX(position), -1) + 1 FROM rule_templates WHERE group_id IS ?";
    let pos: i64 = sqlx::query_scalar(sql).bind(group_id).fetch_one(pool).await?;
    Ok(pos)
}

async fn create(State(state): State<AppState>, Json(input): Json<RuleTemplateInput>) -> AppResult<Json<RuleTemplate>> {
    validate_pattern(input.match_type, &input.pattern)?;
    let id = format!("tpl-{}", Uuid::new_v4());
    let position = next_position(&state.pool, &input.group_id).await?;
    sqlx::query(
        "INSERT INTO rule_templates (id, name, enabled, match_type, pattern, note, group_id, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(input.enabled)
    .bind(input.match_type.as_str())
    .bind(&input.pattern)
    .bind(&input.note)
    .bind(&input.group_id)
    .bind(position)
    .execute(&state.pool)
    .await?;
    Ok(Json(RuleTemplate {
        id,
        name: input.name,
        enabled: input.enabled,
        match_type: input.match_type,
        pattern: input.pattern,
        note: input.note,
        group_id: input.group_id,
    }))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<RuleTemplateInput>,
) -> AppResult<Json<RuleTemplate>> {
    validate_pattern(input.match_type, &input.pattern)?;

    let existing_group: Option<String> = sqlx::query_scalar("SELECT group_id FROM rule_templates WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("not_found".to_string()))?;

    // Moving to a different bucket (group) gets a fresh position at the end
    // of that bucket; staying in the same bucket keeps its current spot.
    let position = if existing_group == input.group_id {
        sqlx::query_scalar::<_, i64>("SELECT position FROM rule_templates WHERE id = ?")
            .bind(&id)
            .fetch_one(&state.pool)
            .await?
    } else {
        next_position(&state.pool, &input.group_id).await?
    };

    sqlx::query(
        "UPDATE rule_templates SET name = ?, enabled = ?, match_type = ?, pattern = ?, note = ?, group_id = ?, position = ?
         WHERE id = ?",
    )
    .bind(&input.name)
    .bind(input.enabled)
    .bind(input.match_type.as_str())
    .bind(&input.pattern)
    .bind(&input.note)
    .bind(&input.group_id)
    .bind(position)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    Ok(Json(RuleTemplate {
        id,
        name: input.name,
        enabled: input.enabled,
        match_type: input.match_type,
        pattern: input.pattern,
        note: input.note,
        group_id: input.group_id,
    }))
}

/// Cascade: any route entry pointing straight at this template has nothing
/// left to match, so it's deleted with it (mirrors `removeRuleTemplate`).
async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;

    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM rule_templates WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("not_found".to_string()));
    }

    let orphan_entries: Vec<String> =
        sqlx::query_scalar("SELECT id FROM route_entries WHERE target_kind = 'template' AND target_id = ?")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await?;
    for entry_id in &orphan_entries {
        sqlx::query("DELETE FROM route_entry_listeners WHERE route_entry_id = ?")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM route_entries WHERE target_kind = 'template' AND target_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM rule_templates WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Reorders templates within one bucket (a group, or the ungrouped bucket
/// when `groupId` is null) — order is only meaningful inside a bucket.
async fn reorder(
    State(state): State<AppState>,
    Json(body): Json<ReorderTemplatesRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.pool.begin().await?;
    for (position, id) in body.ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE rule_templates SET position = ?, group_id = ? WHERE id = ?")
            .bind(position as i64)
            .bind(&body.group_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
