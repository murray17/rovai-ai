//! Extend the existing frozen Run format constraints; historical rows stay byte-for-byte intact.
use super::*;

fn schema(connection: &Connection, kind: &str, name: &str) -> Result<String> {
    Ok(connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |row| row.get(0),
    )?)
}

const FACT32: &str = "(context_manifest_version = 32 AND formatter_version = 32 AND run_facts_schema_version = 9 AND ((camp_attachment_view_receipt_version IS NULL AND camp_attachment_view_receipt_json IS NULL AND camp_attachment_view_receipt_digest IS NULL) OR (camp_attachment_view_receipt_version = 2 AND camp_attachment_view_receipt_json IS NOT NULL AND camp_attachment_view_receipt_digest IS NOT NULL)))";

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row("SELECT
        EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='context_manifest_v33_only_insert'
          AND instr(sql, 'input.context_manifest_version IS NOT 33') > 0)
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='agent_run_input_v33_only_insert'
          AND instr(sql, 'NEW.context_manifest_version IS NOT 33') > 0)
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_manifest'
          AND instr(sql, 'context_manifest_version = 33 AND formatter_version = 33 AND run_facts_schema_version = 9') > 0)",
        [], |row| row.get(0))
}

// Receipt 187 is shared by main's Mention v33 and Preview's descriptions.
// Both complete formats are valid sources; a partially installed v33 is not.
pub(super) fn source_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    if schema_matches(connection)? {
        return Ok(true);
    }
    connection.query_row("SELECT
        NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name IN ('context_manifest_v33_only_insert','agent_run_input_v33_only_insert'))
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='context_manifest_v32_only_insert'
          AND instr(sql, 'input.context_manifest_version IS NOT 32') > 0)
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='agent_run_input_v32_only_insert'
          AND instr(sql, 'NEW.context_manifest_version IS NOT 32') > 0)
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_manifest'
          AND instr(sql, 'context_manifest_version = 32 AND formatter_version = 32 AND run_facts_schema_version = 9') > 0
          AND instr(sql, 'context_manifest_version = 33') = 0)",
        [], |row| row.get(0))
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
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.contract_version == "v1.72" && marker.projection_schema_version == 138),
            "Message Mention migration requires v1.72/schema 138"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        // Main/137 already installed v33 with receipt 187. Preserve its DDL and
        // frozen rows; Preview/138 needs the format expansion exactly once.
        if !schema_matches(&tx)? {
            let original = schema(&tx, "table", "context_manifest")?;
            anyhow::ensure!(original.contains(FACT32), "Missing frozen v32 constraints");
            let fact33 = FACT32.replace("= 32", "= 33");
            let manifest = replacement_table_schema_v171(original, "context_manifest")
                .replace("29, 30, 31, 32)", "29, 30, 31, 32, 33)")
                .replace(FACT32, &format!("{fact33}\n OR\n {FACT32}"));
            let input = replacement_table_schema_v171(
                schema(&tx, "table", "agent_run_input")?,
                "agent_run_input",
            )
            .replace("29, 30, 31, 32)", "29, 30, 31, 32, 33)");
            let old_guard = schema(&tx, "trigger", "context_manifest_v32_only_insert")?;
            let first = old_guard
                .find("(NEW.context_manifest_version = 32")
                .context("Missing v32 admission")?;
            let end = first
                + old_guard[first..]
                    .find("\n OR\n")
                    .context("Missing v32 admission boundary")?;
            let branch = old_guard[first..end]
                .replace("= 32", "= 33")
                .replace("IS NOT 32", "IS NOT 33");
            let guard = old_guard
                .replace(
                    "context_manifest_v32_only_insert",
                    "context_manifest_v33_only_insert",
                )
                .replacen("WHEN NOT (", &format!("WHEN NOT ({branch}\n OR\n"), 1);
            let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")?
                .replacen("WHEN NOT (", "WHEN NOT ((NEW.context_manifest_version = 33 AND NEW.context_delivery_profile_version = 10) OR ", 1);
            let attachment = schema(
                &tx,
                "trigger",
                "runtime_input_delivery_attachment_auth_insert",
            )?
            .replace("29, 30, 31, 32)", "29, 30, 31, 32, 33)");
            rebuild_table_v171(
                &tx,
                "context_manifest",
                &manifest,
                &[],
                &[
                    "context_manifest_v32_only_insert",
                    "context_manifest_quote_profile_insert",
                ],
            )?;
            rebuild_table_v171(
                &tx,
                "agent_run_input",
                &input,
                &[],
                &["agent_run_input_v32_only_insert"],
            )?;
            tx.execute_batch(&guard)?;
            tx.execute_batch(&profile)?;
            tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
            tx.execute_batch(&attachment)?;
            tx.execute_batch("CREATE TRIGGER agent_run_input_v33_only_insert BEFORE INSERT ON agent_run_input
                WHEN NEW.context_manifest_version IS NOT 33
                BEGIN SELECT RAISE(ABORT, 'new public Thread AgentRunInput must use ContextManifest v33'); END;")?;
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(189,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=139,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            public_history_claim_preserved_evidence_digest(&tx)? == before,
            "Message Mention migration changed frozen evidence"
        );
        validate_migration_foreign_keys(&tx, &["context_manifest", "agent_run_input"])?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.projection_schema_version == 139
            ),
            "Message Mention schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=ON;")?;
    result
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    run_continuation::downgrade_requests_for_test(connection);
    let applied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=189)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    let immutable_manifest = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let immutable_input = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable;
        DROP TRIGGER agent_run_input_context_projection_immutable;
        UPDATE context_manifest SET context_manifest_version=32,formatter_version=32 WHERE context_manifest_version=33;
        UPDATE agent_run_input SET context_manifest_version=32 WHERE context_manifest_version=33;").unwrap();
    tx.execute_batch(&immutable_manifest).unwrap();
    tx.execute_batch(&immutable_input).unwrap();
    let fact33 = FACT32.replace("= 32", "= 33");
    let manifest = replacement_table_schema_v171(
        schema(&tx, "table", "context_manifest").unwrap(),
        "context_manifest",
    )
    .replace("29, 30, 31, 32, 33)", "29, 30, 31, 32)")
    .replace(&format!("{fact33}\n OR\n "), "");
    let input = replacement_table_schema_v171(
        schema(&tx, "table", "agent_run_input").unwrap(),
        "agent_run_input",
    )
    .replace("29, 30, 31, 32, 33)", "29, 30, 31, 32)");
    let old_guard = schema(&tx, "trigger", "context_manifest_v33_only_insert").unwrap();
    let first = old_guard
        .find("(NEW.context_manifest_version = 33")
        .unwrap();
    let end = first + old_guard[first..].find("\n OR\n").unwrap() + "\n OR\n".len();
    let guard = format!("{}{}", &old_guard[..first], &old_guard[end..]).replace(
        "context_manifest_v33_only_insert",
        "context_manifest_v32_only_insert",
    );
    let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")
        .unwrap()
        .replace(
            "(NEW.context_manifest_version = 33 AND NEW.context_delivery_profile_version = 10) OR ",
            "",
        );
    let attachment = schema(
        &tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )
    .unwrap()
    .replace("29, 30, 31, 32, 33)", "29, 30, 31, 32)");
    rebuild_table_v171(
        &tx,
        "context_manifest",
        &manifest,
        &[],
        &[
            "context_manifest_v33_only_insert",
            "context_manifest_quote_profile_insert",
        ],
    )
    .unwrap();
    rebuild_table_v171(
        &tx,
        "agent_run_input",
        &input,
        &[],
        &["agent_run_input_v33_only_insert"],
    )
    .unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch(&profile).unwrap();
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")
        .unwrap();
    tx.execute_batch(&attachment).unwrap();
    tx.execute_batch("CREATE TRIGGER agent_run_input_v32_only_insert BEFORE INSERT ON agent_run_input
        WHEN NEW.context_manifest_version IS NOT 32 BEGIN SELECT RAISE(ABORT, 'new public Thread AgentRunInput must use ContextManifest v32'); END;
        DELETE FROM schema_migration WHERE version=189;
        UPDATE rovai_data_contract SET projection_schema_version=138 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns both deployed 187 lineages, atomic receipt/DDL, and frozen-row preservation.
    #[test]
    fn mention_format_upgrade_preserves_frozen_rows_and_is_atomic() {
        for main_source in [false, true] {
            let (mut database, directory) = crate::test_support::seeded_runtime_database();
            database.connection().execute_batch(
                "UPDATE schema_migration SET applied_at='2026-10-01T00:00:00Z' WHERE version=187;").unwrap();
            let receipt: String = database
                .connection()
                .query_row(
                    "SELECT applied_at FROM schema_migration WHERE version=187",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            run_continuation::downgrade_requests_for_test(database.connection());
            if main_source {
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=OFF")
                    .unwrap();
                let tx = database.connection().unchecked_transaction().unwrap();
                rewrite_command_code_runtime_closed_sets(&tx, true).unwrap();
                rewrite_cline_runtime_closed_sets(&tx, true).unwrap();
                tx.execute_batch("DELETE FROM schema_migration WHERE version IN (188,189);
                    UPDATE rovai_data_contract SET projection_schema_version=137 WHERE singleton=1;").unwrap();
                tx.commit().unwrap();
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=ON")
                    .unwrap();
                assert!(
                    matches!(classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 137)
                );
                database
                    .connection()
                    .execute_batch(
                        "SAVEPOINT partial_mention;
                    DROP TRIGGER agent_run_input_v33_only_insert;",
                    )
                    .unwrap();
                assert!(!matches!(
                    classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(_)
                ));
                database
                    .connection()
                    .execute_batch("ROLLBACK TO partial_mention; RELEASE partial_mention")
                    .unwrap();
                let before =
                    public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
                user_anchors::migrate(&mut database).unwrap();
                assert_eq!(
                    before,
                    public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
                );
            } else {
                downgrade_for_test(database.connection());
            }
            let before =
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
            database
                .connection()
                .execute_batch(
                    "CREATE TRIGGER reject_mentions_receipt BEFORE INSERT ON schema_migration
                WHEN NEW.version=189 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
                )
                .unwrap();
            assert!(migrate(&mut database).is_err());
            assert_eq!(schema_matches(database.connection()).unwrap(), main_source);
            assert!(!database.schema_migration_applied(189).unwrap());
            assert!(
                matches!(classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 138)
            );
            assert_eq!(
                before,
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
            );
            database
                .connection()
                .execute_batch("DROP TRIGGER reject_mentions_receipt;")
                .unwrap();
            migrate(&mut database).unwrap();
            assert_eq!(
                before,
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
            );
            assert!(schema_matches(database.connection()).unwrap());
            assert!(command_code_runtime_v185_schema_matches(database.connection()).unwrap());
            let after: String = database
                .connection()
                .query_row(
                    "SELECT applied_at FROM schema_migration WHERE version=187",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(after, receipt);
            drop(database);
            let database = Database::open(&directory).unwrap();
            assert!(matches!(
                classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            drop(database);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
}
