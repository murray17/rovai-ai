use super::*;

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT (SELECT count(*) FROM pragma_table_info('camp')
            WHERE name IN ('archived_at','archived_through_global_sequence','archive_revision')) = 3
            AND (SELECT count(*) FROM sqlite_master
            WHERE (type='index' AND name='camp_archive_list_idx')
              OR (type='trigger' AND name IN ('event_sequence_explicit_insert',
                'event_sequence_explicit_update','camp_archive_publication_insert',
                'camp_archive_publication_sequence'))) = 5",
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
            if marker.projection_schema_version == 176),
        "Thread archive requires schema 176"
    );
    tx.execute_batch(include_str!("db_thread_archive.sql"))?;
    tx.execute_batch(
        "INSERT INTO schema_migration VALUES(227,datetime('now'));
         UPDATE rovai_data_contract SET projection_schema_version=177, updated_at=datetime('now')
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
    if !schema_matches(connection).unwrap() {
        return;
    }
    connection
        .execute_batch(
            "DROP TRIGGER camp_archive_publication_insert;
         DROP TRIGGER camp_archive_publication_sequence;
         DROP TRIGGER event_sequence_explicit_insert;
         DROP TRIGGER event_sequence_explicit_update;
         DROP INDEX camp_archive_list_idx;
         ALTER TABLE camp DROP COLUMN archive_revision;
         ALTER TABLE camp DROP COLUMN archived_through_global_sequence;
         ALTER TABLE camp DROP COLUMN archived_at;
         DELETE FROM schema_migration WHERE version=227;
         UPDATE rovai_data_contract SET projection_schema_version=176
         WHERE singleton=1 AND projection_schema_version=177;",
        )
        .unwrap();
}
