//! RunCard projection and the native full-call checkpoint. No history reads.
use super::*;

fn projection_exists(c: &Connection, table: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |r| r.get(0),
    )
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    // Optional metering projections never become Core availability prerequisites.
    for (table, column) in [
        ("runtime_usage_run_summary", "display_total_tokens"),
        ("runtime_usage_checkpoint", "native_total_baseline"),
    ] {
        if projection_exists(c, table)?
            && !table_columns(c, table).is_ok_and(|columns| columns.contains(&column.into()))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 175),
        "RunCard Usage requires schema 175"
    );
    if projection_exists(&tx, "runtime_usage_run_summary")? {
        tx.execute_batch("ALTER TABLE runtime_usage_run_summary ADD COLUMN display_total_tokens INTEGER
            CHECK(display_total_tokens IS NULL OR (typeof(display_total_tokens)='integer' AND display_total_tokens>=0));
            UPDATE runtime_usage_run_summary SET display_total_tokens = CASE
                WHEN prompt_input_total_tokens IS NOT NULL OR uncached_input_tokens IS NOT NULL
                  OR cache_read_tokens IS NOT NULL OR cache_write_tokens IS NOT NULL
                  OR output_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL
                THEN (CASE WHEN input_semantics='exclusive_buckets'
                    THEN COALESCE(uncached_input_tokens,0)+COALESCE(cache_read_tokens,0)+COALESCE(cache_write_tokens,0)
                    ELSE COALESCE(prompt_input_total_tokens,COALESCE(uncached_input_tokens,0)+COALESCE(cache_read_tokens,0)+COALESCE(cache_write_tokens,0)) END)
                  + COALESCE(output_tokens,reasoning_output_tokens,0)
                ELSE NULL END;")?;
    }
    if projection_exists(&tx, "runtime_usage_checkpoint")? {
        tx.execute_batch(
            "ALTER TABLE runtime_usage_checkpoint ADD COLUMN native_total_baseline INTEGER;",
        )?;
    }
    tx.execute_batch("INSERT INTO schema_migration VALUES(226,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=176,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 176
        ),
        "RunCard Usage failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    super::message_mutations::downgrade_for_test(c);
    for (table, column) in [
        ("runtime_usage_run_summary", "display_total_tokens"),
        ("runtime_usage_checkpoint", "native_total_baseline"),
    ] {
        if projection_exists(c, table).unwrap()
            && table_columns(c, table).unwrap().contains(&column.into())
        {
            c.execute_batch(&format!("ALTER TABLE {table} DROP COLUMN {column};"))
                .unwrap();
        }
    }
    c.execute_batch("DELETE FROM schema_migration WHERE version=226;
        UPDATE rovai_data_contract SET projection_schema_version=175 WHERE singleton=1 AND projection_schema_version=176;").unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(database: &mut Database) {
    downgrade_for_test(database.connection());
    for (id, semantics, input, uncached, read, output, expected) in [
        (
            "legacy-inclusive",
            "cache_inclusive_total",
            Some(50000),
            None,
            Some(40000),
            Some(5000),
            Some(55000),
        ),
        (
            "legacy-exclusive",
            "exclusive_buckets",
            None,
            Some(10000),
            Some(40000),
            Some(5000),
            Some(55000),
        ),
        (
            "legacy-zero",
            "cache_inclusive_total",
            Some(0),
            None,
            None,
            Some(0),
            Some(0),
        ),
        ("legacy-unknown", "unknown", None, None, None, None, None),
    ] {
        database.connection().execute("INSERT INTO runtime_usage_run_summary(collection_epoch,agent_run_id,runtime_kind,parser_version,eligible_mask,input_semantics,enrolled_at,prompt_input_total_tokens,uncached_input_tokens,cache_read_tokens,output_tokens)
            SELECT collection_epoch,?1,'codex-cli',5,0,?2,datetime('now'),?3,?4,?5,?6 FROM runtime_usage_collection_state",
            params![id,semantics,input,uncached,read,output]).unwrap();
        // Keep expectations local to the migration owner; no native history is consulted.
        let _ = expected;
    }
    database
        .connection()
        .execute_batch(
            "CREATE TEMP TRIGGER reject_runcard_usage BEFORE INSERT ON schema_migration
        WHEN NEW.version=226 BEGIN SELECT RAISE(ABORT,'runcard rollback'); END;",
        )
        .unwrap();
    assert!(
        migrate(database)
            .unwrap_err()
            .to_string()
            .contains("runcard rollback")
    );
    assert!(!schema_matches(database.connection()).unwrap());
    assert!(!database.schema_migration_applied(226).unwrap());
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==175)
    );
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_runcard_usage;")
        .unwrap();
    migrate(database).unwrap();
    assert!(schema_matches(database.connection()).unwrap());
    for (id, expected) in [
        ("legacy-inclusive", Some(55000)),
        ("legacy-exclusive", Some(55000)),
        ("legacy-zero", Some(0)),
        ("legacy-unknown", None),
    ] {
        assert_eq!(database.connection().query_row("SELECT display_total_tokens FROM runtime_usage_run_summary WHERE agent_run_id=?1",[id],|r|r.get::<_,Option<i64>>(0)).unwrap(),expected);
    }
    database.connection().execute_batch("SAVEPOINT damaged_runcard; ALTER TABLE runtime_usage_checkpoint DROP COLUMN native_total_baseline;").unwrap();
    assert!(matches!(
        classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::Unknown(_)
    ));
    database
        .connection()
        .execute_batch("ROLLBACK TO damaged_runcard; RELEASE damaged_runcard;")
        .unwrap();
}

#[cfg(test)]
pub(super) fn assert_optional_upgrade(database: &mut Database) {
    downgrade_for_test(database.connection());
    database
        .connection()
        .execute_batch("DROP TABLE runtime_usage_run_summary;")
        .unwrap();
    migrate(database).unwrap();
    assert!(!projection_exists(database.connection(), "runtime_usage_run_summary").unwrap());
    super::message_mutations::migrate(database).unwrap();
    database.retire_message_fts().unwrap();
    assert!(connection_has_current_data_contract(database.connection()).unwrap());
}
