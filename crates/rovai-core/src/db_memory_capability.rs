//! Additive instance setting. No Memory or frozen input rows are rewritten.
use super::*;

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_preference')",
        [], |r| r.get::<_, bool>(0))?
        && table_columns(c, "memory_preference").is_ok_and(|columns|
            columns == ["singleton", "enabled", "heads_up_after_global_sequence"]))
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 173),
        "Memory capability requires schema 173"
    );
    tx.execute_batch("CREATE TABLE memory_preference (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        heads_up_after_global_sequence INTEGER NOT NULL CHECK(heads_up_after_global_sequence>=0)
    );
    INSERT INTO memory_preference
        SELECT 1,1,COALESCE(MAX(global_sequence),0) FROM event_log;
    INSERT INTO schema_migration VALUES(224,datetime('now'));
    UPDATE rovai_data_contract SET projection_schema_version=174,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
        ),
        "Memory capability failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    c.execute_batch("DROP TABLE IF EXISTS memory_preference;
        DELETE FROM schema_migration WHERE version=224;
        UPDATE rovai_data_contract SET projection_schema_version=173 WHERE singleton=1 AND projection_schema_version=174;").unwrap();
}

#[cfg(test)]
pub(crate) fn assert_upgrade(database: &mut Database) {
    let evidence = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
    downgrade_for_test(database.connection());
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_memory_capability BEFORE INSERT ON schema_migration WHEN NEW.version=224 BEGIN SELECT RAISE(ABORT,'memory rollback'); END;").unwrap();
    assert!(
        migrate(database)
            .unwrap_err()
            .to_string()
            .contains("memory rollback")
    );
    assert!(!schema_matches(database.connection()).unwrap());
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_memory_capability;")
        .unwrap();
    migrate(database).unwrap();
    assert!(crate::memory_capability::enabled(database.connection()).unwrap());
    let tx = database.connection_mut().transaction().unwrap();
    crate::memory_capability::set(&tx, false).unwrap();
    tx.commit().unwrap();
    database.migrate(false).unwrap();
    assert!(!crate::memory_capability::enabled(database.connection()).unwrap());
    let saved = crate::memory_capability::snapshot(database.connection()).unwrap();
    database
        .connection()
        .execute("DELETE FROM memory_preference WHERE singleton=1", [])
        .unwrap();
    assert!(crate::memory_capability::snapshot(database.connection()).is_err());
    assert!(crate::memory_capability::enabled(database.connection()).is_err());
    database
        .connection()
        .execute(
            "INSERT INTO memory_preference VALUES(1,0,?1)",
            [saved.heads_up_after_global_sequence],
        )
        .unwrap();
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
    );
}
