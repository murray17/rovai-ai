//! Admit compact Single Chat facts without rewriting already frozen input.
use super::*;

const FACT41: &str = "(context_manifest_version = 41 AND formatter_version = 41 AND run_facts_schema_version = 12 AND";
const FACT42: &str = "(context_manifest_version = 42 AND formatter_version = 42 AND run_facts_schema_version = 13 AND";
const ADMISSION: &str = "(NEW.source_delivery_id IS NULL AND NEW.context_manifest_version = 42 AND NEW.formatter_version = 42 AND NEW.run_facts_schema_version = 13 AND NEW.context_delivery_profile_version = 16 AND EXISTS(SELECT 1 FROM agent_run r WHERE r.id=NEW.agent_run_id AND r.invocation_kind<>'batch')) OR ";
const PROFILE: &str =
    "(NEW.context_manifest_version=42 AND NEW.context_delivery_profile_version=16) OR ";

fn schema(c: &Connection, kind: &str, name: &str) -> rusqlite::Result<String> {
    c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(task_capability::schema_matches(c)?
        && schema(c, "table", "context_manifest").is_ok_and(|sql| sql.contains(FACT42))
        && schema(c, "trigger", "context_manifest_v40_only_insert")
            .is_ok_and(|sql| sql.contains(ADMISSION))
        && schema(c, "trigger", "context_manifest_quote_profile_insert")
            .is_ok_and(|sql| sql.contains(PROFILE)))
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 157),
            "Single Chat facts require schema 157"
        );
        let old = schema(&tx, "table", "context_manifest")?;
        let start = old.find(FACT41).context("Missing non-batch facts clause")?;
        let end = start
            + old[start..]
                .find("\n OR\n")
                .context("Missing facts clause boundary")?;
        let retained = &old[start..end];
        let manifest = replacement_table_schema_v171(old.clone(), "context_manifest")
            .replace("38, 39, 40, 41)", "38, 39, 40, 41, 42)")
            .replace("9, 10, 11, 12)", "9, 10, 11, 12, 13)")
            .replace(
                retained,
                &format!("{}\n OR\n {retained}", retained.replace(FACT41, FACT42)),
            );
        let guard = schema(&tx, "trigger", "context_manifest_v40_only_insert")?.replacen(
            "WHEN NOT (",
            &format!("WHEN NOT ({ADMISSION}"),
            1,
        );
        let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")?.replacen(
            "WHEN NOT (",
            &format!("WHEN NOT ({PROFILE}"),
            1,
        );
        let attachment = schema(
            &tx,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )?
        .replace("38, 39, 40, 41)", "38, 39, 40, 41, 42)");
        rebuild_table_v171(
            &tx,
            "context_manifest",
            &manifest,
            &[],
            &[
                "context_manifest_v40_only_insert",
                "context_manifest_quote_profile_insert",
            ],
        )?;
        tx.execute_batch(&guard)?;
        tx.execute_batch(&profile)?;
        tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
        tx.execute_batch(&attachment)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(208,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=158,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(&tx, &["context_manifest", "runtime_input_delivery"])?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.projection_schema_version == 158
            ),
            "Single Chat facts admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Only synthetic migration fixtures downgrade; product input always stays frozen.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    notification_interruption::downgrade_for_test(c);
    let applied: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=208)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    let immutable = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable;
        UPDATE context_manifest SET context_manifest_version=41,formatter_version=41,run_facts_schema_version=12 WHERE context_manifest_version=42;").unwrap();
    tx.execute_batch(&immutable).unwrap();
    let mut manifest = schema(&tx, "table", "context_manifest").unwrap();
    let start = manifest.find(FACT42).unwrap();
    let end = start + manifest[start..].find("\n OR\n ").unwrap() + "\n OR\n ".len();
    manifest.replace_range(start..end, "");
    let manifest = replacement_table_schema_v171(manifest, "context_manifest")
        .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41)")
        .replace("9, 10, 11, 12, 13)", "9, 10, 11, 12)");
    let guard = schema(&tx, "trigger", "context_manifest_v40_only_insert")
        .unwrap()
        .replace(ADMISSION, "");
    let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")
        .unwrap()
        .replace(PROFILE, "");
    let attachment = schema(
        &tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )
    .unwrap()
    .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41)");
    rebuild_table_v171(
        &tx,
        "context_manifest",
        &manifest,
        &[],
        &[
            "context_manifest_v40_only_insert",
            "context_manifest_quote_profile_insert",
        ],
    )
    .unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch(&profile).unwrap();
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")
        .unwrap();
    tx.execute_batch(&attachment).unwrap();
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version=208;
        UPDATE rovai_data_contract SET projection_schema_version=157 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(db: &mut Database) {
    // The existing Single Chat materialization owner supplies a real v42 row.
    // BEFORE INSERT guards must reject mismatched evidence before any uniqueness check.
    let columns = table_columns(db.connection(), "context_manifest").unwrap();
    for (formatter, facts, profile) in [(41, 13, 16), (42, 12, 16), (42, 13, 15)] {
        let projection = columns
            .iter()
            .map(|column| match column.as_str() {
                "id" => "'invalid-single-chat-facts-pair'".to_owned(),
                "formatter_version" => formatter.to_string(),
                "run_facts_schema_version" => facts.to_string(),
                "context_delivery_profile_version" => profile.to_string(),
                _ => format!("\"{column}\""),
            })
            .collect::<Vec<_>>()
            .join(",");
        let error = db.connection().execute(
            &format!("INSERT INTO context_manifest SELECT {projection} FROM context_manifest WHERE context_manifest_version=42 LIMIT 1"), []
        ).unwrap_err();
        assert!(
            matches!(error, rusqlite::Error::SqliteFailure(ref cause, _) if cause.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_TRIGGER),
            "{error}"
        );
    }
    downgrade_for_test(db.connection());
    let evidence = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_single_chat_facts_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=208 BEGIN SELECT RAISE(ABORT,'single chat facts rollback'); END;").unwrap();
    assert!(
        migrate(db)
            .unwrap_err()
            .to_string()
            .contains("single chat facts rollback")
    );
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(
        matches!(classify_database_contract(db.connection()).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 157)
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_single_chat_facts_receipt;")
        .unwrap();
    migrate(db).unwrap();
    notification_interruption::migrate(db).unwrap();
    notification_interruption::migrate_exit_attention(db).unwrap();
    shared_environment::migrate(db).unwrap();
    web_pasted_text::migrate(db).unwrap();
    teams::migrate(db).unwrap();
    db.migrate(false).unwrap();
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
}
