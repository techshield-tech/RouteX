/// Schema is plain `CREATE TABLE IF NOT EXISTS` run at startup — no
/// `DATABASE_URL` or live DB needed at compile time, and idempotent across
/// restarts. Split into one statement per table so each can run through the
/// runtime query API individually (sqlite doesn't like multi-statement
/// strings through the bound-query path).
pub const STATEMENTS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS rule_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1
    )"#,
    r#"CREATE TABLE IF NOT EXISTS rule_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        group_id TEXT REFERENCES rule_groups(id),
        position INTEGER NOT NULL DEFAULT 0
    )"#,
    r#"CREATE TABLE IF NOT EXISTS upstreams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scheme TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        has_auth INTEGER NOT NULL DEFAULT 0,
        health TEXT NOT NULL DEFAULT 'unreachable',
        latency_ms INTEGER,
        -- Real credentials the engine dials with when `has_auth` is set.
        -- Stage 1 only stored the boolean flag; the UI's JSON contract for
        -- `Upstream` is unchanged (these never appear in that struct), they
        -- are only readable/writable through the two new optional fields on
        -- create/update input. See engine/upstream.rs.
        auth_username TEXT NOT NULL DEFAULT '',
        auth_password TEXT NOT NULL DEFAULT ''
    )"#,
    r#"CREATE TABLE IF NOT EXISTS listeners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        bind TEXT NOT NULL,
        port INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        default_action TEXT NOT NULL,
        auth_enabled INTEGER NOT NULL DEFAULT 0,
        auth_username TEXT NOT NULL DEFAULT '',
        auth_password TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'down',
        connections INTEGER NOT NULL DEFAULT 0
    )"#,
    r#"CREATE TABLE IF NOT EXISTS route_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        upstream_id TEXT REFERENCES upstreams(id),
        note TEXT NOT NULL DEFAULT '',
        hits INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
    )"#,
    r#"CREATE TABLE IF NOT EXISTS route_entry_listeners (
        route_entry_id TEXT NOT NULL REFERENCES route_entries(id),
        listener_id TEXT NOT NULL REFERENCES listeners(id),
        PRIMARY KEY (route_entry_id, listener_id)
    )"#,
    r#"CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dns_resolve_mode TEXT NOT NULL DEFAULT 'system',
        log_level TEXT NOT NULL DEFAULT 'info',
        access_log INTEGER NOT NULL DEFAULT 1
    )"#,
    // Empty in stage 1 — no engine yet to populate it. Kept so stage 2's
    // proxy engine has a table to write live connection rows into.
    r#"CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        time TEXT NOT NULL,
        client TEXT NOT NULL,
        target TEXT NOT NULL,
        matched_rule TEXT NOT NULL,
        route TEXT NOT NULL,
        bytes_up INTEGER NOT NULL DEFAULT 0,
        bytes_down INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        listener_id TEXT NOT NULL
    )"#,
    // Exactly one row (id = 1): the single admin account, created via the
    // setup endpoint on first run. Left empty by seed.rs on purpose.
    r#"CREATE TABLE IF NOT EXISTS admin_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )"#,
    // Persisted traffic history backing the 1h/7d/30d ranges of the Overview
    // traffic chart (the 15m range stays served from the in-memory ring in
    // `engine::metrics`). One row per minute:
    //   - `t INTEGER PRIMARY KEY` makes `t` the rowid alias, so both the
    //     range scans this table is read with and the retention prune below
    //     use the built-in rowid index for free — no secondary index needed.
    //   - 1-minute resolution * 90-day retention caps this table at
    //     90 * 1440 = 129,600 rows, a fixed upper bound (a few MB), so it can
    //     never grow unbounded regardless of uptime.
    //   - Bytes are stored as INTEGER (not a float bps average) so repeated
    //     upserts never accumulate float drift; i64 has no realistic
    //     overflow risk for bytes transferred in one minute.
    r#"CREATE TABLE IF NOT EXISTS traffic_samples (
        t INTEGER PRIMARY KEY,
        proxied_bytes INTEGER NOT NULL DEFAULT 0,
        direct_bytes INTEGER NOT NULL DEFAULT 0,
        seconds INTEGER NOT NULL DEFAULT 0
    )"#,
];
