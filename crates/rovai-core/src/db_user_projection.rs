//! Extend the audience constraint; retain every frozen row and evidence byte.
use super::*;

const LEGACY_CHECK: &str = "CHECK(message_projection_audience = 'agent_v1')";
const CURRENT_CHECK: &str = "CHECK(message_projection_audience IN ('agent_v1', 'agent_v2'))";

fn manifest_schema(connection: &Connection) -> rusqlite::Result<String> {
    connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='context_manifest'",
        [],
        |row| row.get(0),
    )
}

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(manifest_schema(connection)?.contains(CURRENT_CHECK))
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
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.72" && marker.projection_schema_version == 130),
            "User projection migration requires v1.72/schema 130"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        let source = manifest_schema(&tx)?;
        anyhow::ensure!(
            source.contains(LEGACY_CHECK),
            "User projection audience constraint is missing"
        );
        let target = replacement_table_schema_v171(source, "context_manifest")
            .replace(LEGACY_CHECK, CURRENT_CHECK);
        rebuild_table_v171(&tx, "context_manifest", &target, &[], &[])?;
        tx.execute_batch("INSERT INTO schema_migration VALUES (181, datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=131, updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            before == public_history_claim_preserved_evidence_digest(&tx)?,
            "User projection migration changed frozen evidence"
        );
        validate_migration_foreign_keys(&tx, &["context_manifest"])?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 131
            ),
            "User projection migration failed schema admission"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Synthetic migration fixtures only; the product never downgrades an audience.
#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    super::member_creation::downgrade_for_test(connection);
    if !schema_matches(connection).unwrap() {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    // Synthetic legacy fixtures must satisfy the old audience constraint before rebuilding.
    tx.execute(
        "UPDATE context_manifest SET message_projection_audience='agent_v1' WHERE message_projection_audience='agent_v2'",
        [],
    ).unwrap();
    let target = replacement_table_schema_v171(manifest_schema(&tx).unwrap(), "context_manifest")
        .replace(CURRENT_CHECK, LEGACY_CHECK);
    rebuild_table_v171(&tx, "context_manifest", &target, &[], &[]).unwrap();
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version=181;
        UPDATE rovai_data_contract SET projection_schema_version=130 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    #[test]
    fn user_projection_upgrade_preserves_evidence_and_rolls_back_on_receipt_failure() {
        let directory = std::env::temp_dir().join(format!("rovai-user-upgrade-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
        downgrade_for_test(database.connection());
        let before = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
        database.connection().execute_batch("CREATE TEMP TRIGGER reject_user_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=181 BEGIN SELECT RAISE(ABORT,'user receipt failure'); END;").unwrap();
        assert!(
            migrate(&mut database)
                .unwrap_err()
                .to_string()
                .contains("user receipt failure")
        );
        assert!(!schema_matches(database.connection()).unwrap());
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
        );
        assert!(
            matches!(classify_database_contract(database.connection()).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 130)
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_user_receipt;")
            .unwrap();
        migrate(&mut database).unwrap();
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
        );
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 131
        ));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
