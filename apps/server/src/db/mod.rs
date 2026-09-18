mod schema;
mod seed;

use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;

/// Opens (creating if missing) the sqlite file, runs schema + seed, and
/// hands back a ready-to-use pool.
pub async fn init(db_path: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    for statement in schema::STATEMENTS {
        sqlx::query(statement).execute(&pool).await?;
    }

    migrate(&pool).await?;
    seed::seed_if_empty(&pool).await?;

    Ok(pool)
}

/// Additive column migrations for DBs created before a column existed.
/// `CREATE TABLE IF NOT EXISTS` above already covers a fresh DB; this only
/// matters for one created by an older build of the server. Sqlite has no
/// `ADD COLUMN IF NOT EXISTS`, so each column is guarded by a
/// `pragma_table_info` lookup first.
async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    add_column_if_missing(pool, "upstreams", "auth_username", "TEXT NOT NULL DEFAULT ''").await?;
    add_column_if_missing(pool, "upstreams", "auth_password", "TEXT NOT NULL DEFAULT ''").await?;
    Ok(())
}

async fn add_column_if_missing(pool: &SqlitePool, table: &str, column: &str, ddl: &str) -> anyhow::Result<()> {
    let exists: bool = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = ?"
    ))
    .bind(column)
    .fetch_one(pool)
    .await?;
    if !exists {
        sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            .execute(pool)
            .await?;
    }
    Ok(())
}
