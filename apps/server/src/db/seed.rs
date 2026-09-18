use sqlx::SqlitePool;

/// Seed data transcribed verbatim from the UI's mock fixtures
/// (`apps/ui/src/mock/*.ts`) so a fresh DB looks the same as the old mock
/// layer did. Each table seeds independently, only when empty, so a partial
/// DB (e.g. one resource cleared by hand) doesn't get re-seeded elsewhere.
pub async fn seed_if_empty(pool: &SqlitePool) -> anyhow::Result<()> {
    seed_rule_groups_and_templates(pool).await?;
    seed_upstreams(pool).await?;
    seed_listeners(pool).await?;
    seed_route_entries(pool).await?;
    seed_settings(pool).await?;
    Ok(())
}

async fn is_empty(pool: &SqlitePool, table: &str) -> anyhow::Result<bool> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    let count: i64 = sqlx::query_scalar(&sql).fetch_one(pool).await?;
    Ok(count == 0)
}

async fn seed_rule_groups_and_templates(pool: &SqlitePool) -> anyhow::Result<()> {
    if is_empty(pool, "rule_groups").await? {
        let groups = [
            ("grp-lan", "Mạng nội bộ", "Dải mạng riêng và loopback — không cần rời khỏi máy.", true),
            (
                "grp-ai",
                "AI APIs",
                "API của các nhà cung cấp mô hình AI, thường cần proxy ra ngoài.",
                true,
            ),
            (
                "grp-devcdn",
                "Dev & CDN",
                "Registry gói phần mềm và CDN tải file cho công việc dev hằng ngày.",
                true,
            ),
            (
                "grp-ads",
                "Chặn quảng cáo",
                "Domain quảng cáo và tracking, luôn chặn bất kể listener nào.",
                true,
            ),
        ];
        for (id, name, note, enabled) in groups {
            sqlx::query("INSERT INTO rule_groups (id, name, note, enabled) VALUES (?, ?, ?, ?)")
                .bind(id)
                .bind(name)
                .bind(note)
                .bind(enabled)
                .execute(pool)
                .await?;
        }
    }

    if is_empty(pool, "rule_templates").await? {
        // (id, name, match_type, pattern, note, group_id)
        type RuleTemplateSeedRow<'a> = (&'a str, &'a str, &'a str, &'a str, &'a str, Option<&'a str>);
        let templates: &[RuleTemplateSeedRow] = &[
            ("tpl-lan-private", "LAN, private range", "cidr", "192.168.0.0/16", "Giữ traffic mạng nội bộ ngoài proxy.", Some("grp-lan")),
            ("tpl-rfc1918", "RFC1918 private range", "cidr", "10.0.0.0/8", "", Some("grp-lan")),
            ("tpl-loopback", "Loopback", "cidr", "127.0.0.0/8", "", Some("grp-lan")),
            ("tpl-ssh", "SSH, cổng 22", "port", "22", "Giữ truy cập quản trị ngoài đường proxy.", Some("grp-lan")),
            ("tpl-openai", "OpenAI API", "domain", "api.openai.com", "", Some("grp-ai")),
            ("tpl-anthropic", "Anthropic API", "domain", "api.anthropic.com", "", Some("grp-ai")),
            ("tpl-googleai", "Google AI Studio", "domain-suffix", "generativelanguage.googleapis.com", "", Some("grp-ai")),
            ("tpl-ghcdn", "GitHub raw + release assets", "domain-suffix", "githubusercontent.com", "Release binaries và raw file downloads.", Some("grp-devcdn")),
            ("tpl-npm", "npm registry", "domain", "registry.npmjs.org", "", Some("grp-devcdn")),
            ("tpl-dockerhub", "Docker Hub", "domain-suffix", "docker.io", "", Some("grp-devcdn")),
            ("tpl-doubleclick", "Ad trackers", "domain-keyword", "doubleclick", "", Some("grp-ads")),
            ("tpl-analytics", "Analytics beacons", "domain-keyword", "google-analytics", "", Some("grp-ads")),
            ("tpl-adservice", "Ad servers", "domain-keyword", "adservice", "", Some("grp-ads")),
            ("tpl-cn-domains", "China mainland domains", "domain-suffix", "cn", "", None),
            ("tpl-tor-process", "Tor client process", "process", "tor", "", None),
            (
                "tpl-streaming",
                "Streaming, HK library",
                "domain-suffix",
                "netflix.com",
                "Chỉ nên bật khi cần kiểm thử — mục định tuyến dùng template này đang tắt theo mặc định.",
                None,
            ),
            (
                "tpl-internal-admin",
                "Admin panel, nội bộ",
                "domain-suffix",
                "admin.internal",
                "Công cụ quản trị nội bộ, không được rời khỏi LAN.",
                None,
            ),
        ];

        // Position is per-bucket (group_id, including the ungrouped bucket),
        // matching declaration order within each bucket above.
        let mut next_pos: std::collections::HashMap<Option<&str>, i64> = std::collections::HashMap::new();
        for (id, name, match_type, pattern, note, group_id) in templates {
            let pos = next_pos.entry(*group_id).or_insert(0);
            sqlx::query(
                "INSERT INTO rule_templates (id, name, enabled, match_type, pattern, note, group_id, position)
                 VALUES (?, ?, 1, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(name)
            .bind(match_type)
            .bind(pattern)
            .bind(note)
            .bind(group_id)
            .bind(*pos)
            .execute(pool)
            .await?;
            *pos += 1;
        }
    }

    Ok(())
}

async fn seed_upstreams(pool: &SqlitePool) -> anyhow::Result<()> {
    if !is_empty(pool, "upstreams").await? {
        return Ok(());
    }
    // (id, name, scheme, host, port, has_auth, health, latency_ms)
    type UpstreamSeedRow<'a> = (&'a str, &'a str, &'a str, &'a str, i64, bool, &'a str, Option<i64>);
    let rows: &[UpstreamSeedRow] = &[
        ("up-sg-dc-01", "sg-dc-01", "http", "sg-dc-01.internal.routex", 8443, true, "healthy", Some(42)),
        ("up-hk-residential", "hk-residential", "http", "hk-res.provider.net", 8080, true, "degraded", Some(210)),
        ("up-local-tor", "local-tor", "socks5", "127.0.0.1", 9050, false, "healthy", Some(18)),
        ("up-jp-dc-02", "jp-dc-02", "socks5", "jp-dc-02.internal.routex", 1080, true, "unreachable", None),
    ];
    for (id, name, scheme, host, port, has_auth, health, latency_ms) in rows {
        sqlx::query(
            "INSERT INTO upstreams (id, name, scheme, host, port, has_auth, health, latency_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(scheme)
        .bind(host)
        .bind(port)
        .bind(has_auth)
        .bind(health)
        .bind(latency_ms)
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn seed_listeners(pool: &SqlitePool) -> anyhow::Result<()> {
    if !is_empty(pool, "listeners").await? {
        return Ok(());
    }
    // (id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections)
    type ListenerSeedRow<'a> =
        (&'a str, &'a str, &'a str, &'a str, i64, bool, &'a str, bool, &'a str, &'a str, &'a str, i64);
    let rows: &[ListenerSeedRow] = &[
        (
            "lst-http-main", "HTTP chính", "http", "0.0.0.0", 8080, true, "direct",
            true, "routex", "r0uteX!mock", "up", 34,
        ),
        (
            "lst-socks5-lan", "SOCKS5 LAN", "socks5", "10.0.0.5", 1080, true, "direct",
            true, "lan-user", "lanP@ss2026", "up", 11,
        ),
        (
            "lst-http-internal", "HTTP nội bộ", "http", "127.0.0.1", 8081, false, "block",
            false, "", "", "down", 0,
        ),
    ];
    for (id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections) in rows {
        sqlx::query(
            "INSERT INTO listeners (id, name, protocol, bind, port, enabled, default_action, auth_enabled, auth_username, auth_password, status, connections)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(protocol)
        .bind(bind)
        .bind(port)
        .bind(enabled)
        .bind(default_action)
        .bind(auth_enabled)
        .bind(auth_username)
        .bind(auth_password)
        .bind(status)
        .bind(connections)
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn seed_route_entries(pool: &SqlitePool) -> anyhow::Result<()> {
    if !is_empty(pool, "route_entries").await? {
        return Ok(());
    }
    // (id, name, enabled, listener_ids, target_kind, target_id, action, upstream_id, note, hits)
    type RouteEntrySeedRow<'a> =
        (&'a str, &'a str, bool, &'a [&'a str], &'a str, &'a str, &'a str, Option<&'a str>, &'a str, i64);
    let rows: &[RouteEntrySeedRow] = &[
        (
            "entry-lan", "Mạng nội bộ, đi thẳng", true,
            &["lst-http-main", "lst-socks5-lan"], "group", "grp-lan", "direct", None,
            "LAN, RFC1918, loopback và SSH quản trị — không cần qua proxy.", 24571,
        ),
        (
            "entry-openai", "OpenAI API, qua SG", true,
            &["lst-http-main"], "template", "tpl-openai", "proxy", Some("up-sg-dc-01"),
            "", 5321,
        ),
        (
            "entry-devcdn", "Dev & CDN, qua SG", true,
            &["lst-http-main"], "group", "grp-devcdn", "proxy", Some("up-sg-dc-01"),
            "Registry gói và CDN tải file release.", 3120,
        ),
        (
            "entry-ads", "Chặn quảng cáo & tracking", true,
            &["lst-http-main", "lst-socks5-lan"], "group", "grp-ads", "block", None,
            "", 17957,
        ),
        (
            "entry-streaming", "Streaming, thư viện HK", false,
            &["lst-http-main"], "template", "tpl-streaming", "proxy", Some("up-hk-residential"),
            "Tắt theo mặc định, chỉ bật khi cần kiểm thử.", 1774,
        ),
        (
            "entry-tor", "Tor client, qua Tor cục bộ", true,
            &["lst-socks5-lan"], "template", "tpl-tor-process", "proxy", Some("up-local-tor"),
            "", 402,
        ),
        (
            "entry-cn", "Domain Trung Quốc đại lục", true,
            &["lst-http-main"], "template", "tpl-cn-domains", "direct", None,
            "", 942,
        ),
        (
            "entry-internal", "Admin panel, chặn ra ngoài", true,
            &["lst-http-internal"], "template", "tpl-internal-admin", "block", None,
            "Công cụ quản trị nội bộ không được rời khỏi LAN.", 0,
        ),
    ];

    for (pos, (id, name, enabled, listener_ids, target_kind, target_id, action, upstream_id, note, hits)) in
        rows.iter().enumerate()
    {
        sqlx::query(
            "INSERT INTO route_entries (id, name, enabled, target_kind, target_id, action, upstream_id, note, hits, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(enabled)
        .bind(target_kind)
        .bind(target_id)
        .bind(action)
        .bind(upstream_id)
        .bind(note)
        .bind(hits)
        .bind(pos as i64)
        .execute(pool)
        .await?;

        for listener_id in *listener_ids {
            sqlx::query("INSERT INTO route_entry_listeners (route_entry_id, listener_id) VALUES (?, ?)")
                .bind(id)
                .bind(listener_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

async fn seed_settings(pool: &SqlitePool) -> anyhow::Result<()> {
    if !is_empty(pool, "settings").await? {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO settings (id, dns_resolve_mode, log_level, access_log) VALUES (1, 'system', 'info', 1)",
    )
    .execute(pool)
    .await?;
    Ok(())
}
