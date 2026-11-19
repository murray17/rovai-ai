use super::*;

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('camp') WHERE name='archived_at')
            AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='camp_archive_list_idx')",
        [],
        |row| row.get(0),
    )
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.projection_schema_version == 178),
        "Thread archive requires schema 178"
    );
    tx.execute_batch(include_str!("db_thread_archive.sql"))?;
    tx.execute_batch(
        "INSERT INTO schema_migration VALUES(229,datetime('now'));
         UPDATE rovai_data_contract SET projection_schema_version=179, updated_at=datetime('now')
         WHERE singleton=1;",
    )?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
        ),
        "Thread archive failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=229)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch(
            "DROP INDEX camp_archive_list_idx;
         ALTER TABLE camp DROP COLUMN archived_at;
         DELETE FROM schema_migration WHERE version=229;
         UPDATE rovai_data_contract SET projection_schema_version=178
         WHERE singleton=1 AND projection_schema_version=179;",
        )
        .unwrap();
}
