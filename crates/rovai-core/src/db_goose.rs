//! Add the Goose catalog entries without changing existing Run/Session data.
use super::*;

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    runtime_catalog_schema_contains(c, "'goose-cli'", "'goose'")
}

pub(super) fn rewrite(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    rewrite_runtime_catalog_closed_sets(
        tx,
        ("'kilo-cli'", "'kilo-cli', 'goose-cli'"),
        ("'kilo'", "'kilo', 'goose'"),
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
                if marker.contract_version == "v1.72" && marker.projection_schema_version == 173),
            "Goose catalog migration requires v1.72/schema 173"
        );
        let tables: Vec<_> = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .collect();
        rewrite(&tx, false)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(224,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=174,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(ref marker) if marker.projection_schema_version == 174
            ),
            "Goose catalog migration failed schema admission"
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
    let applied: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=224)",
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
    tx.execute_batch("DELETE FROM schema_migration WHERE version=224; UPDATE rovai_data_contract SET projection_schema_version=173 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}
