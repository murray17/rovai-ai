//! Native questions stay in Runtime memory. Only their existing channel delivery
//! carrier gains a distinct kind; no question or answer table is introduced.
use super::*;

const OLD_BOUND: &str = "delivery_kind IN ('agent_output', 'agent_attachment')";
const NEW_BOUND: &str =
    "delivery_kind IN ('agent_output', 'agent_attachment', 'native_interaction')";

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    let sql: String = c.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_delivery'",
        [],
        |r| r.get(0),
    )?;
    Ok(sql.contains(NEW_BOUND) && sql.matches("'native_interaction'").count() == 2)
}

fn rewrite(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    let old: String = tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_delivery'",
        [],
        |r| r.get(0),
    )?;
    let next = if reverse {
        old.replace("'attention', 'native_interaction'", "'attention'")
            .replace(NEW_BOUND, OLD_BOUND)
    } else {
        anyhow::ensure!(
            old.contains(OLD_BOUND) && old.matches("'attention'").count() == 1,
            "Unsupported channel delivery schema"
        );
        old.replace("'attention'", "'attention', 'native_interaction'")
            .replace(OLD_BOUND, NEW_BOUND)
    };
    let next = replacement_table_schema_v171(next, "channel_delivery");
    rebuild_table_v171(tx, "channel_delivery", &next, &[], &[])?;
    Ok(())
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
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 169),
            "Native channel cards require schema 169"
        );
        rewrite(&tx, false)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(220,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=170,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(&tx, &["channel_delivery"])?;
        anyhow::ensure!(
            schema_matches(&tx)?,
            "Native channel delivery admission failed"
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
    super::downgrade_chat_extensions_for_test(c);
    // Retire both additive reference receipts before rebuilding the older source.
    c.execute_batch("DELETE FROM schema_migration WHERE version IN (221,222); UPDATE rovai_data_contract SET projection_schema_version=170 WHERE projection_schema_version IN (171,172);").unwrap();
    let applied = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=220)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    tx.execute(
        "DELETE FROM channel_delivery WHERE delivery_kind='native_interaction'",
        [],
    )
    .unwrap();
    rewrite(&tx, true).unwrap();
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version=220;
        UPDATE rovai_data_contract SET projection_schema_version=169 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
pub(super) fn assert_upgrade(database: &mut Database) {
    downgrade_for_test(database.connection());
    let snapshot = |c: &Connection| {
        let mut statement = c
            .prepare("SELECT * FROM channel_delivery ORDER BY id")
            .unwrap();
        statement
            .query_map([], |row| {
                (0..row.as_ref().column_count())
                    .map(|index| row.get::<_, rusqlite::types::Value>(index))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let indexes = |c: &Connection| {
        let mut statement = c.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='channel_delivery' ORDER BY name").unwrap();
        statement
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let before = snapshot(database.connection());
    assert!(
        !before.is_empty(),
        "reuse the populated channel admission fixture"
    );
    let before_indexes = indexes(database.connection());
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_native_channel_marker BEFORE UPDATE ON rovai_data_contract
        WHEN NEW.projection_schema_version=170 BEGIN SELECT RAISE(ABORT,'native channel rollback'); END;").unwrap();
    assert!(
        migrate(database)
            .unwrap_err()
            .to_string()
            .contains("native channel rollback")
    );
    assert!(!schema_matches(database.connection()).unwrap());
    assert_eq!(snapshot(database.connection()), before);
    assert_eq!(indexes(database.connection()), before_indexes);
    assert!(
        database
            .connection()
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, bool>(0))
            .unwrap()
    );
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_native_channel_marker")
        .unwrap();
    migrate(database).unwrap();
    assert_eq!(snapshot(database.connection()), before);
    assert_eq!(indexes(database.connection()), before_indexes);
    database.migrate_project_file_references().unwrap();
    database.migrate_project_directory_references().unwrap();
    database.migrate(false).unwrap();
    assert!(matches!(
        classify_startup_contract(database.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
}
