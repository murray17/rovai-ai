//! Extend public input admission without rewriting retained payloads or authorization.
use super::*;

const FACT40: &str = "(context_manifest_version = 40 AND formatter_version = 40 AND run_facts_schema_version = 11 AND";
const FACT43: &str = "(context_manifest_version = 43 AND formatter_version = 43 AND run_facts_schema_version = 11 AND";
const PROFILE: &str =
    "(NEW.context_manifest_version=43 AND NEW.context_delivery_profile_version=15) OR ";

fn schema(c: &Connection, kind: &str, name: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )?)
}

pub(super) fn legacy_schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(single_chat_facts::schema_matches(c)?
        && schema(c, "table", "context_manifest").is_ok_and(|sql| {
            sql.contains(FACT43)
                && sql.contains("40, 41, 42, 43)")
                && !sql.contains("formatter_version = 44")
        })
        && schema(c, "table", "agent_run_input").is_ok_and(|sql| sql.contains("38, 39, 40, 43)"))
        && schema(c, "trigger", "agent_run_input_v43_only_insert")
            .is_ok_and(|sql| sql.contains("IS NOT 43") && !sql.contains("IS NOT 44"))
        && schema(c, "trigger", "context_manifest_v40_only_insert").is_ok_and(|sql| {
            sql.contains("NEW.context_manifest_version = 43")
                && sql.contains("input.context_manifest_version IS NOT 43")
        })
        && schema(c, "trigger", "context_manifest_quote_profile_insert")
            .is_ok_and(|sql| sql.contains(PROFILE))
        && schema(
            c,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )
        .is_ok_and(|sql| sql.contains("40, 41, 42, 43)")))
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(single_chat_facts::schema_matches(c)?
        && schema(c, "table", "context_manifest")
            .is_ok_and(|s| s.contains(FACT43) && s.contains("40, 41, 42, 43"))
        && schema(c, "table", "agent_run_input").is_ok_and(|s| s.contains("38, 39, 40, 43)"))
        && schema(c, "trigger", "agent_run_input_v43_only_insert")
            .is_ok_and(|s| s.contains("IS NOT 43") && s.contains("IS NOT 44"))
        && schema(c, "trigger", "context_manifest_v40_only_insert").is_ok_and(|s| {
            s.contains("NEW.context_manifest_version = 43")
                && s.contains("input.context_manifest_version IS NOT 43")
        })
        && schema(c, "trigger", "context_manifest_quote_profile_insert")
            .is_ok_and(|s| s.contains(PROFILE))
        && schema(
            c,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )
        .is_ok_and(|s| s.contains("40, 41, 42, 43")))
}

fn extend_legacy_reply_schema(tx: &Transaction<'_>) -> Result<()> {
    let old = schema(tx, "table", "context_manifest")?;
    let start = old.find(FACT40).context("Missing public facts clause")?;
    let end = start
        + old[start..]
            .find("\n OR\n")
            .context("Missing public facts boundary")?;
    let retained = &old[start..end];
    let manifest = replacement_table_schema_v171(old.clone(), "context_manifest")
        .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41, 42, 43)")
        .replace(
            retained,
            &format!("{}\n OR\n {retained}", retained.replace(FACT40, FACT43)),
        );
    let old_guard = schema(tx, "trigger", "context_manifest_v40_only_insert")?;
    let start = old_guard
        .find("(NEW.source_delivery_id IS NOT NULL AND NEW.context_manifest_version = 40")
        .context("Missing public admission")?;
    let end = start
        + old_guard[start..]
            .find(" OR (NEW.source_delivery_id IS NOT NULL")
            .context("Missing retained admission boundary")?;
    let addition = old_guard[start..end]
        .replace("= 40", "= 43")
        .replace("IS NOT 40", "IS NOT 43");
    let guard = old_guard.replacen("WHEN NOT (", &format!("WHEN NOT ({addition} OR "), 1);
    let profile = schema(tx, "trigger", "context_manifest_quote_profile_insert")?.replacen(
        "WHEN NOT (",
        &format!("WHEN NOT ({PROFILE}"),
        1,
    );
    let input =
        replacement_table_schema_v171(schema(tx, "table", "agent_run_input")?, "agent_run_input")
            .replace("38, 39, 40)", "38, 39, 40, 43)");
    let attachment = schema(
        tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )?
    .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41, 42, 43)");
    rebuild_table_v171(
        tx,
        "context_manifest",
        &manifest,
        &[],
        &[
            "context_manifest_v40_only_insert",
            "context_manifest_quote_profile_insert",
        ],
    )?;
    rebuild_table_v171(
        tx,
        "agent_run_input",
        &input,
        &[],
        &["agent_run_input_v40_only_insert"],
    )?;
    tx.execute_batch(&guard)?;
    tx.execute_batch(&profile)?;
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
    tx.execute_batch(&attachment)?;
    Ok(())
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let marker = match classify_database_contract(&tx)? {
            DatabaseContractClassification::SupportedMigrationSource(m)
                if m.projection_schema_version == 176 =>
            {
                m
            }
            _ => anyhow::bail!("Chat reply context requires complete schema 176"),
        };
        anyhow::ensure!(
            matches!(
                classify_chat_schema(&tx, marker)?,
                DatabaseContractClassification::Current(_)
            ),
            "Chat reply context requires complete chat migrations"
        );
        let legacy = !schema(&tx, "table", "context_manifest")?.contains(FACT43);
        if legacy {
            extend_legacy_reply_schema(&tx)?;
        }
        tx.execute_batch("DROP TRIGGER IF EXISTS agent_run_input_v43_only_insert; CREATE TRIGGER agent_run_input_v43_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 43 AND NEW.context_manifest_version IS NOT 44 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v43/v44'); END;")?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(227,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=177,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
            ],
        )?;
        anyhow::ensure!(
            schema_matches(&tx)?
                && matches!(
                    classify_database_contract(&tx)?,
                    DatabaseContractClassification::Current(_)
                ),
            "Chat reply context admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Synthetic historical layouts only; production never downgrades frozen input.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=227)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    // The reply receipt is the only durable difference this migration adds on a
    // ContextManifest v44 database; the fence trigger is recreated by migrate.
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS agent_run_input_v43_only_insert;
         DELETE FROM schema_migration WHERE version=227;
         UPDATE rovai_data_contract SET projection_schema_version=176 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(test)]
pub(crate) fn assert_legacy_chat_upgrade_sources() {
    for source_version in [158, 159] {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        notification_interruption::downgrade_for_test(database.connection());
        crate::channel_chat::migrate(&mut database).unwrap();
        database.migrate_chat_bot_member_reuse().unwrap();
        crate::channel_chat_tools::migrate(&mut database).unwrap();
        database.migrate_chat_bot_navigation().unwrap();
        let tx = database.connection_mut().transaction().unwrap();
        extend_legacy_reply_schema(&tx).unwrap();
        tx.execute_batch("CREATE TRIGGER agent_run_input_v43_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 43 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v43'); END;
        INSERT INTO schema_migration VALUES(227,'legacy-reply-time');
        UPDATE schema_migration SET version=version-14 WHERE version BETWEEN 223 AND 227;
        UPDATE rovai_data_contract SET projection_schema_version=159 WHERE singleton=1;").unwrap();
        tx.commit().unwrap();
        database
            .connection()
            .execute(
                "UPDATE rovai_data_contract SET projection_schema_version=?1",
                [source_version],
            )
            .unwrap();
        database.connection().execute_batch("INSERT INTO channel_chat_credential VALUES('feishu','synthetic-app','synthetic-secret',123);
        INSERT INTO channel_chat_message(id,provider,app_id,chat_id,conversation_kind,author_external_id,author_name,body,external_message_id,dedupe_key,received_at)
        VALUES('retained-message','feishu','synthetic-app','synthetic-chat','group','synthetic-author','retained author','retained body','synthetic-external','synthetic-dedupe',123);").unwrap();
        let before: (String,String) = database.connection().query_row(
        "SELECT (SELECT api_key FROM channel_chat_credential),(SELECT body FROM channel_chat_message WHERE id='retained-message')",
        [], |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
        assert!(legacy_schema_matches(database.connection()).unwrap());
        database.connection().execute_batch("ALTER TABLE channel_chat_target_grant RENAME COLUMN department TO broken_department;").unwrap();
        assert!(matches!(
            classify_startup_contract(database.connection()).unwrap(),
            DatabaseContractClassification::Unknown(_)
        ));
        database.connection().execute_batch("ALTER TABLE channel_chat_target_grant RENAME COLUMN broken_department TO department;").unwrap();
        assert!(
            matches!(classify_startup_contract(database.connection()).unwrap(),
        DatabaseContractClassification::SupportedMigrationSource(ref source) if source.projection_schema_version==source_version)
        );
        database.connection().execute_batch("CREATE TEMP TRIGGER reject_legacy_receipt BEFORE UPDATE OF version ON schema_migration WHEN OLD.version=211 BEGIN SELECT RAISE(ABORT,'legacy receipt rollback'); END;").unwrap();
        assert!(
            database
                .reconcile_legacy_chat_migration_numbers()
                .unwrap_err()
                .to_string()
                .contains("legacy receipt rollback")
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM schema_migration WHERE version BETWEEN 209 AND 213",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            5
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_legacy_receipt")
            .unwrap();
        database.migrate(false).unwrap();
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        assert!(matches!(
            classify_startup_contract(database.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        let after: (String,String) = database.connection().query_row(
        "SELECT (SELECT api_key FROM channel_chat_credential),(SELECT body FROM channel_chat_message WHERE id='retained-message')",
        [], |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
        assert_eq!(before, after);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT applied_at FROM schema_migration WHERE version=227",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "legacy-reply-time"
        );
        let schema_before: String = database.connection().query_row("SELECT group_concat(version) FROM (SELECT version FROM schema_migration ORDER BY version)",[],|row|row.get(0)).unwrap();
        database.migrate(false).unwrap();
        let schema_after: String = database.connection().query_row("SELECT group_concat(version) FROM (SELECT version FROM schema_migration ORDER BY version)",[],|row|row.get(0)).unwrap();
        assert_eq!(schema_before, schema_after);
    }
    for (source_version, first_receipt, last_receipt) in [
        (158, 209, 209),
        (158, 209, 210),
        (158, 209, 211),
        (158, 209, 212),
        (169, 219, 219),
        (170, 219, 220),
        (171, 219, 221),
        (172, 219, 222),
        (173, 219, 223),
        (170, 220, 220),
        (171, 220, 221),
        (172, 220, 222),
        (173, 220, 223),
        (174, 220, 224),
    ] {
        let mut historical = crate::test_support::seeded_runtime_database_owned();
        if first_receipt >= 219 {
            subagent::downgrade_for_test(historical.connection());
        } else {
            notification_interruption::downgrade_for_test(historical.connection());
        }
        if first_receipt == 220 {
            subagent::migrate(&mut historical).unwrap();
        }
        crate::channel_chat::migrate(&mut historical).unwrap();
        let step = last_receipt - first_receipt;
        if step >= 1 {
            historical.migrate_chat_bot_member_reuse().unwrap();
        }
        if step >= 2 {
            crate::channel_chat_tools::migrate(&mut historical).unwrap();
        }
        if step >= 3 {
            historical.migrate_chat_bot_navigation().unwrap();
        }
        if step >= 4 {
            // The old branch already carried the current quote schema, but not activity-v5.
            historical.connection().execute_batch("CREATE TRIGGER agent_run_input_v43_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 43 AND NEW.context_manifest_version IS NOT 44 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v43/v44'); END; INSERT INTO schema_migration VALUES(227,'retained-reply-time');").unwrap();
        }
        let delta = 223 - first_receipt;
        let classifier = if first_receipt == 220 {
            "activity-v5"
        } else {
            "activity-v4"
        };
        historical.connection().execute_batch(&format!("UPDATE schema_migration SET version=version-{delta} WHERE version BETWEEN 223 AND 227;
            UPDATE rovai_data_contract SET projection_schema_version={source_version},classifier_version='{classifier}' WHERE singleton=1;")).unwrap();
        historical.connection().execute_batch("INSERT INTO channel_chat_credential VALUES('feishu','prefix-app','prefix-secret',123);").unwrap();
        assert!(
            matches!(classify_startup_contract(historical.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref source) if source.projection_schema_version==source_version),
            "receipt {last_receipt}"
        );
        // A false completion receipt or partial layout is not a repairable prefix.
        let false_receipt = first_receipt + 4;
        if step < 4 {
            historical
                .connection()
                .execute(
                    "INSERT INTO schema_migration VALUES(?1,'false-completion')",
                    [false_receipt],
                )
                .unwrap();
            assert!(
                matches!(
                    classify_startup_contract(historical.connection()).unwrap(),
                    DatabaseContractClassification::Unknown(_)
                ),
                "false completion {last_receipt}"
            );
            historical
                .connection()
                .execute(
                    "DELETE FROM schema_migration WHERE version=?1",
                    [false_receipt],
                )
                .unwrap();
        }
        historical
            .connection()
            .execute_batch("ALTER TABLE channel_chat_message RENAME COLUMN body TO broken_body;")
            .unwrap();
        assert!(
            matches!(
                classify_startup_contract(historical.connection()).unwrap(),
                DatabaseContractClassification::Unknown(_)
            ),
            "partial layout {last_receipt}"
        );
        historical
            .connection()
            .execute_batch("ALTER TABLE channel_chat_message RENAME COLUMN broken_body TO body;")
            .unwrap();
        let receipts = |db: &Database| -> Vec<(i64, String)> {
            db.connection()
                .prepare("SELECT version,applied_at FROM schema_migration ORDER BY version")
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let before = receipts(&historical);
        historical.connection().execute_batch(&format!("CREATE TEMP TRIGGER reject_prefix_shift BEFORE UPDATE OF version ON schema_migration WHEN OLD.version={last_receipt} BEGIN SELECT RAISE(ABORT,'prefix rollback'); END;")).unwrap();
        assert!(
            historical
                .reconcile_legacy_chat_migration_numbers()
                .unwrap_err()
                .to_string()
                .contains("prefix rollback")
        );
        assert_eq!(receipts(&historical), before);
        historical
            .connection()
            .execute_batch("DROP TRIGGER reject_prefix_shift;")
            .unwrap();
        historical.migrate(false).unwrap();
        assert!(
            matches!(classify_startup_contract(historical.connection()).unwrap(),DatabaseContractClassification::Current(ref marker) if marker.classifier_version==crate::canonical_activity::CLASSIFIER_VERSION),
            "upgraded receipt {last_receipt}"
        );
        assert_eq!(
            historical
                .connection()
                .query_row(
                    "SELECT api_key FROM channel_chat_credential WHERE app_id='prefix-app'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "prefix-secret"
        );
        for (version, at) in before.into_iter().filter(|(v, _)| *v >= first_receipt) {
            assert_eq!(
                historical
                    .connection()
                    .query_row(
                        "SELECT applied_at FROM schema_migration WHERE version=?1",
                        [version + delta],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                at
            );
        }
        let complete = receipts(&historical);
        historical.migrate(false).unwrap();
        assert_eq!(receipts(&historical), complete);
    }
}

#[cfg(test)]
pub(super) fn assert_upgrade(db: &mut Database) {
    downgrade_for_test(db.connection());
    let before = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_chat_reply_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=227 BEGIN SELECT RAISE(ABORT,'chat reply rollback'); END;").unwrap();
    let error = migrate(db).unwrap_err();
    assert!(
        error.to_string().contains("chat reply rollback"),
        "{error:#}"
    );
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(
        matches!(classify_database_contract(db.connection()).unwrap(),DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==176)
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_chat_reply_receipt;")
        .unwrap();
    migrate(db).unwrap();
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
    assert!(schema_matches(db.connection()).unwrap());
}
