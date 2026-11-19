use super::*;

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('camp') WHERE name='archived_at')
        AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='camp_archive_list_idx')
        AND NOT EXISTS(SELECT 1 FROM pragma_table_info('camp') WHERE name IN ('archive_revision','archived_through_global_sequence'))", [], |row| row.get(0))
}

pub(super) fn preview_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
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
    // The published archive preview and main's message editing both used receipt 227.
    // Upgrade that exact shape through the regular message migration, preserving archived_at.
    if preview_schema_matches(database.connection())?
        && !message_mutations::schema_matches(database.connection())?
    {
        message_mutations::migrate(database)?;
    }
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.projection_schema_version == 177),
        "Thread archive requires schema 177"
    );
    if preview_schema_matches(&tx)? {
        tx.execute_batch(
            "DROP INDEX camp_archive_list_idx;
            DROP TRIGGER camp_archive_publication_insert;
            DROP TRIGGER camp_archive_publication_sequence;
            DROP TRIGGER event_sequence_explicit_insert;
            DROP TRIGGER event_sequence_explicit_update;
            ALTER TABLE camp DROP COLUMN archive_revision;
            ALTER TABLE camp DROP COLUMN archived_through_global_sequence;",
        )?;
        let archived_ids = tx.prepare("SELECT id FROM camp WHERE archived_at IS NOT NULL AND deletion_operation_id IS NULL")?
            .query_map([], |row| row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for id in archived_ids {
            crate::runtime::ExecutionRuntimeService::cancel_camp_work_in_transaction(
                &tx,
                &id,
                "archive-migration-228",
                &crate::command::ActorRef::System {
                    component_id: "migration".into(),
                },
                "user_requested_agent_run_stop",
            )?;
        }
    } else {
        tx.execute_batch("ALTER TABLE camp ADD COLUMN archived_at TEXT;")?;
    }
    tx.execute_batch(include_str!("db_thread_archive.sql"))?;
    tx.execute_batch(
        "INSERT INTO schema_migration VALUES(228,datetime('now'));
         UPDATE rovai_data_contract SET projection_schema_version=178, updated_at=datetime('now')
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
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=228)",
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
         DELETE FROM schema_migration WHERE version=228;
         UPDATE rovai_data_contract SET projection_schema_version=177
         WHERE singleton=1 AND projection_schema_version=178;",
        )
        .unwrap();
}
