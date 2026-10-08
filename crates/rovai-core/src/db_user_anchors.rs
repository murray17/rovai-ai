//! Direct-reply lookup needs equality on Thread/reply before reading sequence order.
use super::*;

const INDEX: &str = "CREATE INDEX camp_message_direct_reply_idx ON camp_message(camp_id, reply_to_camp_message_id, sequence, id) WHERE reply_to_camp_message_id IS NOT NULL";

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    let sql: Option<String> = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='camp_message_direct_reply_idx'",
        [], |row| row.get(0)).optional()?;
    Ok(sql.as_deref() == Some(INDEX))
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
        if marker.contract_version == "v1.72" && marker.projection_schema_version == 137),
            "Direct reply convergence requires v1.72/schema 137"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        // Main/136 already owns the index but has no Preview catalog. Preview/137
        // owns the catalog but not this index. Never replace either receipt 186.
        if !cline_runtime_v184_schema_matches(&tx)? {
            rewrite_cline_runtime_closed_sets(&tx, false)?;
        }
        if !command_code_runtime_v185_schema_matches(&tx)? {
            rewrite_command_code_runtime_closed_sets(&tx, false)?;
        }
        if !schema_matches(&tx)? {
            tx.execute_batch(INDEX)?;
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(188,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=138,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            before == public_history_claim_preserved_evidence_digest(&tx)?,
            "Direct reply convergence changed existing evidence"
        );
        let tables = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .chain(["camp_message"])
            .collect::<Vec<_>>();
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(_)
            ),
            "Direct reply index admission failed"
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
    connection.execute_batch("DROP INDEX IF EXISTS camp_message_direct_reply_idx;
        DELETE FROM schema_migration WHERE version=188;
        UPDATE rovai_data_contract SET projection_schema_version=137 WHERE singleton=1 AND projection_schema_version=138;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns schema 137 -> 138 admission/DDL atomicity; query tests cannot
    // prove an installed database survives a failed receipt and an exact reopen.
    #[test]
    fn direct_reply_index_migration_is_atomic() {
        for main_source in [false, true] {
            let (mut database, directory) = crate::test_support::seeded_runtime_database();
            downgrade_for_test(database.connection());
            if main_source {
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=OFF")
                    .unwrap();
                let tx = database.connection().unchecked_transaction().unwrap();
                rewrite_command_code_runtime_closed_sets(&tx, true).unwrap();
                rewrite_cline_runtime_closed_sets(&tx, true).unwrap();
                tx.execute_batch(INDEX).unwrap();
                tx.execute_batch(
                    "DELETE FROM schema_migration WHERE version=187;
                UPDATE rovai_data_contract SET projection_schema_version=136 WHERE singleton=1;",
                )
                .unwrap();
                tx.commit().unwrap();
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=ON")
                    .unwrap();
                assert!(
                    matches!(classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 136)
                );
                database
                    .connection()
                    .execute_batch(
                        "SAVEPOINT damaged_main; DROP INDEX camp_message_direct_reply_idx",
                    )
                    .unwrap();
                assert!(!matches!(
                    classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(_)
                ));
                database
                    .connection()
                    .execute_batch("ROLLBACK TO damaged_main; RELEASE damaged_main")
                    .unwrap();
                mission_description::migrate(&mut database).unwrap();
            }
            let before =
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
            database
                .connection()
                .execute_batch(
                    "CREATE TRIGGER reject_anchor_receipt BEFORE INSERT ON schema_migration
            WHEN NEW.version=188 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
                )
                .unwrap();
            assert!(migrate(&mut database).is_err());
            assert_eq!(schema_matches(database.connection()).unwrap(), main_source);
            assert_eq!(
                command_code_runtime_v185_schema_matches(database.connection()).unwrap(),
                !main_source
            );
            assert!(!database.schema_migration_applied(188).unwrap());
            assert!(
                matches!(classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 137)
            );
            database
                .connection()
                .execute_batch("DROP TRIGGER reject_anchor_receipt")
                .unwrap();
            migrate(&mut database).unwrap();
            assert_eq!(
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
                before
            );
            drop(database);
            let database = Database::open(&directory).unwrap();
            assert!(schema_matches(database.connection()).unwrap());
            assert!(command_code_runtime_v185_schema_matches(database.connection()).unwrap());
            assert!(matches!(
                classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            drop(database);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
}
