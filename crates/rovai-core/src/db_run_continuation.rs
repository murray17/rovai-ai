//! A continuation is an authorized input source on the existing Delivery, not a second queue.
use super::*;

const OBJECTS: &[(&str, &str)] = &[
    ("camp_run_continuation", "CREATE TABLE camp_run_continuation (
        delivery_id TEXT PRIMARY KEY REFERENCES camp_message_delivery(id) ON DELETE CASCADE,
        source_agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
        use_new_session INTEGER NOT NULL CHECK(use_new_session IN (0,1))
    )"),
    ("camp_run_continuation_immutable", "CREATE TRIGGER camp_run_continuation_immutable
        BEFORE UPDATE ON camp_run_continuation BEGIN SELECT RAISE(ABORT, 'continuation authorization is immutable'); END"),
    ("agent_run_input_delivery_idx", "CREATE INDEX agent_run_input_delivery_idx ON agent_run_input(delivery_id)"),
    ("agent_run_input_delivery_owner", "CREATE TRIGGER agent_run_input_delivery_owner
        BEFORE INSERT ON agent_run_input WHEN EXISTS (
            SELECT 1 FROM agent_run_input AS prior WHERE prior.delivery_id=NEW.delivery_id
              AND (prior.agent_run_id<>NEW.agent_run_id OR NOT EXISTS (
                  SELECT 1 FROM camp_run_continuation WHERE delivery_id=NEW.delivery_id))
        ) BEGIN SELECT RAISE(ABORT, 'Delivery input belongs to one authorized Run'); END"),
];

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    for (name, expected) in OBJECTS {
        let actual: Option<String> = connection
            .query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| {
                r.get(0)
            })
            .optional()?;
        let normalize = |sql: &str| sql.split_whitespace().collect::<String>();
        if actual.as_deref().map(normalize) != Some(normalize(expected)) {
            return Ok(false);
        }
    }
    let input: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
        [],
        |r| r.get(0),
    )?;
    Ok(!input.contains("delivery_id TEXT NOT NULL UNIQUE"))
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
            matches!(classify_database_contract(&tx)?,DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.contract_version=="v1.72" && marker.projection_schema_version==135),
            "Run continuation requires v1.72/schema 135"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        // Main/135 owns structured Mission descriptions instead of the Preview
        // catalog. Converge both catalog entries without touching those rows.
        if !cline_runtime_v184_schema_matches(&tx)? {
            rewrite_cline_runtime_closed_sets(&tx, false)?;
        }
        if !command_code_runtime_v185_schema_matches(&tx)? {
            rewrite_command_code_runtime_closed_sets(&tx, false)?;
        }
        // The main/134 branch already owns this exact schema. Preserve it;
        // Preview/135 adds it here. Both advance with one transactional receipt.
        if !schema_matches(&tx)? {
            let source: String = tx.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
                [],
                |r| r.get(0),
            )?;
            anyhow::ensure!(
                source.contains("delivery_id TEXT NOT NULL UNIQUE"),
                "Missing original Delivery uniqueness constraint"
            );
            let target = replacement_table_schema_v171(source, "agent_run_input").replace(
                "delivery_id TEXT NOT NULL UNIQUE",
                "delivery_id TEXT NOT NULL",
            );
            rebuild_table_v171(&tx, "agent_run_input", &target, &[], &[])?;
            for (_, sql) in OBJECTS {
                tx.execute_batch(sql)?;
            }
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(186,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=136,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            before == public_history_claim_preserved_evidence_digest(&tx)?,
            "Continuation migration changed existing model evidence"
        );
        let tables = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .chain(["agent_run_input", "camp_run_continuation"])
            .collect::<Vec<_>>();
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version==136
            ),
            "Continuation schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    mission_description::downgrade_for_test(connection);
    if !connection
        .table_exists(None, "camp_run_continuation")
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER camp_run_continuation_immutable; DROP TRIGGER agent_run_input_delivery_owner;
        DROP INDEX agent_run_input_delivery_idx; DROP TABLE camp_run_continuation;",
    )
    .unwrap();
    let source: String = tx
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let target = replacement_table_schema_v171(source, "agent_run_input").replace(
        "delivery_id TEXT NOT NULL",
        "delivery_id TEXT NOT NULL UNIQUE",
    );
    rebuild_table_v171(&tx, "agent_run_input", &target, &[], &[]).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=186; UPDATE rovai_data_contract SET projection_schema_version=135 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns schema 135 -> 136: the input constraint changes, so a failure after
    // rebuilding the table must restore both evidence and schema atomically.
    #[test]
    fn continuation_migration_rolls_back_and_preserves_frozen_evidence() {
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        downgrade_for_test(database.connection());
        let before = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
        let schema: String = database
            .connection()
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='agent_run_input'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        database.connection().execute_batch("CREATE TRIGGER reject_continuation_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=186 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        assert!(migrate(&mut database).is_err());
        assert!(!database.schema_migration_applied(186).unwrap());
        assert!(
            !database
                .connection()
                .table_exists(None, "camp_run_continuation")
                .unwrap()
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name='agent_run_input'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            schema
        );
        assert_eq!(
            database
                .connection()
                .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
            before
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_continuation_receipt")
            .unwrap();
        migrate(&mut database).unwrap();
        assert!(schema_matches(database.connection()).unwrap());
        drop(database);
        let database = Database::open(&directory).unwrap();
        assert_eq!(
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
            before
        );
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
