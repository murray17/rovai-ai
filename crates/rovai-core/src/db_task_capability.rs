//! Capability settings and new input formats; retained rows and payload bytes stay unchanged.
use super::*;

fn schema(c: &Connection, kind: &str, name: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )?)
}
fn clause(sql: &str, prefix: &str) -> Result<String> {
    let start = sql
        .find(prefix)
        .context("Missing Task capability migration clause")?;
    let end = start
        + sql[start..]
            .find("\n OR\n")
            .context("Missing migration clause boundary")?;
    Ok(sql[start..end].to_owned())
}
fn new_fact(base: &str, version: i64, facts: i64) -> String {
    base.replace("= 36", &format!("= {version}"))
        .replace("schema_version = 9", &format!("schema_version = {facts}"))
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    matches_columns(c, &["singleton", "enabled", "heads_up_after_sequence"])
}

pub(super) fn legacy_schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    matches_columns(c, &["singleton", "enabled"])
}

fn matches_columns(c: &Connection, expected: &[&str]) -> rusqlite::Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_preference')",
        [],
        |r| r.get::<_, bool>(0),
    )? && steer::retained_schema_matches(c)
        && table_columns(c, "task_preference").is_ok_and(|columns| columns == expected)
        && schema(c, "trigger", "context_manifest_v40_only_insert")
            .is_ok_and(|sql| sql.contains("NEW.context_manifest_version = 40"))
        && schema(c, "trigger", "agent_run_input_v40_only_insert")
            .is_ok_and(|sql| sql.contains("IS NOT 40") || sql.contains("IS NOT 43")))
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
            matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 155),
            "Task capability requires schema 155"
        );
        let old = schema(&tx, "table", "context_manifest")?;
        let base = clause(
            &old,
            "(context_manifest_version = 36 AND formatter_version = 36 AND run_facts_schema_version = 9 AND",
        )?;
        let manifest = replacement_table_schema_v171(old, "context_manifest")
            .replace(
                "29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39)",
                "29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41)",
            )
            .replace(
                "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
                "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)",
            )
            .replace(
                "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)",
                "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)",
            )
            .replace(
                &base,
                &format!(
                    "{}\n OR\n {}\n OR\n {base}",
                    new_fact(&base, 40, 11),
                    new_fact(&base, 41, 12)
                ),
            );
        let old_guard = schema(&tx, "trigger", "context_manifest_v39_only_insert")?;
        let admission = clause(&old_guard, "(NEW.context_manifest_version = 36")?;
        let batch = new_fact(&admission, 40, 11)
            .replace("IS NOT 36", "IS NOT 40")
            .replace("profile_version = 13", "profile_version = 15");
        let steer_start = old_guard
            .find("(NEW.source_delivery_id IS NOT NULL")
            .context("Missing Steer guard")?;
        let steer_end = old_guard[steer_start..]
            .find(" OR (NEW.source_delivery_id IS NULL")
            .context("Missing Steer boundary")?
            + steer_start;
        let steer = old_guard[steer_start..steer_end]
            .replace("IN (37,39)", "= 40")
            .replace("schema_version=10", "schema_version=11")
            .replace("profile_version=14", "profile_version=15");
        let additions = format!(
            "{steer} OR (NEW.source_delivery_id IS NULL AND ({batch} OR (NEW.context_manifest_version = 41 AND NEW.formatter_version = 41 AND NEW.run_facts_schema_version = 12 AND NEW.context_delivery_profile_version = 16 AND EXISTS(SELECT 1 FROM agent_run r WHERE r.id=NEW.agent_run_id AND r.invocation_kind<>'batch')))) OR "
        );
        let guard = old_guard
            .replacen("WHEN NOT (", &format!("WHEN NOT ({additions}"), 1)
            .replace(
                "context_manifest_v39_only_insert",
                "context_manifest_v40_only_insert",
            );
        let profile = schema(&tx,"trigger","context_manifest_quote_profile_insert")?
            .replacen("WHEN NOT (", "WHEN NOT ((NEW.context_manifest_version=40 AND NEW.context_delivery_profile_version=15) OR (NEW.context_manifest_version=41 AND NEW.context_delivery_profile_version=16) OR ",1);
        let input = replacement_table_schema_v171(
            schema(&tx, "table", "agent_run_input")?,
            "agent_run_input",
        )
        .replace(
            "29, 30, 31, 32, 33, 34, 36, 37, 38, 39)",
            "29, 30, 31, 32, 33, 34, 36, 37, 38, 39, 40)",
        );
        let attachment = schema(
            &tx,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )?
        .replace(
            "29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39)",
            "29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41)",
        );
        rebuild_table_v171(
            &tx,
            "context_manifest",
            &manifest,
            &[],
            &[
                "context_manifest_v39_only_insert",
                "context_manifest_quote_profile_insert",
            ],
        )?;
        rebuild_table_v171(
            &tx,
            "agent_run_input",
            &input,
            &[],
            &["agent_run_input_v39_only_insert"],
        )?;
        tx.execute_batch(&guard)?;
        tx.execute_batch(&profile)?;
        tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
        tx.execute_batch(&attachment)?;
        tx.execute_batch("CREATE TRIGGER agent_run_input_v40_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 40 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v40'); END;
            CREATE TABLE task_preference(singleton INTEGER PRIMARY KEY CHECK(singleton=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
            INSERT INTO schema_migration VALUES(206,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=156,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
            ],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 156
            ),
            "Task capability admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

/// Capture one durable boundary; polling and preference reads never move it.
pub(super) fn migrate_notification_boundary(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 156),
        "Task notification boundary requires schema 156"
    );
    tx.execute_batch("ALTER TABLE task_preference ADD COLUMN heads_up_after_sequence INTEGER NOT NULL DEFAULT 0 CHECK(heads_up_after_sequence>=0);
        UPDATE task_preference SET heads_up_after_sequence=(SELECT current_sequence FROM notification_change_clock WHERE singleton=1);
        INSERT INTO schema_migration VALUES(207,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=157,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 157
        ),
        "Task notification boundary admission failed"
    );
    tx.commit()?;
    Ok(())
}

// Synthetic upgrade fixtures only. Product code never rewrites frozen input.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    super::single_chat_facts::downgrade_for_test(c);
    if !schema_matches(c).unwrap() {
        return;
    }
    c.execute_batch(
        "ALTER TABLE task_preference DROP COLUMN heads_up_after_sequence;
        DELETE FROM schema_migration WHERE version=207;
        UPDATE rovai_data_contract SET projection_schema_version=156 WHERE singleton=1;",
    )
    .unwrap();
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    let immutable = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let input_immutable = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;
        UPDATE context_manifest SET context_manifest_version=39,formatter_version=39,context_delivery_profile_version=14,run_facts_schema_version=10 WHERE context_manifest_version=40;
        UPDATE context_manifest SET context_manifest_version=37,formatter_version=37,context_delivery_profile_version=12,run_facts_schema_version=6 WHERE context_manifest_version=41;
        UPDATE agent_run_input SET context_manifest_version=39 WHERE context_manifest_version=40;").unwrap();
    tx.execute_batch(&immutable).unwrap();
    tx.execute_batch(&input_immutable).unwrap();
    let mut manifest = schema(&tx, "table", "context_manifest").unwrap();
    for (version, facts) in [(40, 11), (41, 12)] {
        let branch = clause(&manifest,&format!("(context_manifest_version = {version} AND formatter_version = {version} AND run_facts_schema_version = {facts} AND")).unwrap();
        manifest = manifest.replace(&format!("{branch}\n OR\n "), "");
    }
    manifest = replacement_table_schema_v171(manifest, "context_manifest")
        .replace("38, 39, 40, 41)", "38, 39)")
        .replace("8, 9, 10, 11, 12)", "8, 9, 10)")
        .replace("13, 14, 15, 16)", "13, 14)");
    let mut guard = schema(&tx, "trigger", "context_manifest_v40_only_insert").unwrap();
    let start = guard.find("WHEN NOT (").unwrap() + "WHEN NOT (".len();
    let retained = guard
        .match_indices("(NEW.source_delivery_id IS NOT NULL")
        .nth(1)
        .unwrap()
        .0;
    guard.replace_range(start..retained, "");
    guard = guard.replace(
        "context_manifest_v40_only_insert",
        "context_manifest_v39_only_insert",
    );
    let profile=schema(&tx,"trigger","context_manifest_quote_profile_insert").unwrap().replace("(NEW.context_manifest_version=40 AND NEW.context_delivery_profile_version=15) OR (NEW.context_manifest_version=41 AND NEW.context_delivery_profile_version=16) OR ","");
    let input = replacement_table_schema_v171(
        schema(&tx, "table", "agent_run_input").unwrap(),
        "agent_run_input",
    )
    .replace("38, 39, 40)", "38, 39)");
    let attachment = schema(
        &tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )
    .unwrap()
    .replace("38, 39, 40, 41)", "38, 39)");
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
    rebuild_table_v171(
        &tx,
        "agent_run_input",
        &input,
        &[],
        &["agent_run_input_v40_only_insert"],
    )
    .unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch(&profile).unwrap();
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")
        .unwrap();
    tx.execute_batch(&attachment).unwrap();
    tx.execute_batch("CREATE TRIGGER agent_run_input_v39_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 39 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v39'); END;
    DROP TABLE task_preference; DELETE FROM schema_migration WHERE version=206; UPDATE rovai_data_contract SET projection_schema_version=155 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(db: &mut Database) {
    downgrade_for_test(db.connection());
    let evidence = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_task_capability_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=206 BEGIN SELECT RAISE(ABORT,'task capability rollback'); END;").unwrap();
    let error = migrate(db).unwrap_err();
    assert!(
        error.to_string().contains("task capability rollback"),
        "{error:#}"
    );
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(!schema_matches(db.connection()).unwrap());
    db.connection()
        .execute_batch("DROP TRIGGER reject_task_capability_receipt;")
        .unwrap();
    migrate(db).unwrap();
    // The additive migration must preserve data and roll back its column and receipt together.
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_task_boundary_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=207 BEGIN SELECT RAISE(ABORT,'task boundary rollback'); END;").unwrap();
    assert!(
        migrate_notification_boundary(db)
            .unwrap_err()
            .to_string()
            .contains("task boundary rollback")
    );
    assert!(legacy_schema_matches(db.connection()).unwrap());
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_task_boundary_receipt;")
        .unwrap();
    migrate_notification_boundary(db).unwrap();
    super::single_chat_facts::migrate(db).unwrap();
    db.migrate(false).unwrap();
    assert!(!crate::task_capability::enabled(db.connection()).unwrap());
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
}
