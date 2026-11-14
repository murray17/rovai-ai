//! Add the Kilo catalog entries without changing existing Run/Session data.
use super::*;

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    runtime_catalog_schema_contains(c, "'kilo-cli'", "'kilo'")
}

pub(super) fn rewrite(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    rewrite_runtime_catalog_closed_sets(
        tx,
        ("'hermes-cli'", "'hermes-cli', 'kilo-cli'"),
        ("'hermes'", "'hermes', 'kilo'"),
        reverse,
    )
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
                if marker.contract_version == "v1.72" && marker.projection_schema_version == 172),
            "Kilo catalog migration requires v1.72/schema 172"
        );
        let tables: Vec<_> = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .collect();
        rewrite(&tx, false)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(223,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=173,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(ref marker) | DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 173
            ),
            "Kilo catalog migration failed schema admission"
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
pub(super) fn downgrade_for_test(c: &Connection) {
    super::goose::downgrade_for_test(c);
    let applied: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=223)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    rewrite(&tx, true).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=223; UPDATE rovai_data_contract SET projection_schema_version=172 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}
