//! Presentation receipts and the last successful helper; never model context.
use super::*;

const OBJECTS: &[(&str, &str)] = &[
    (
        "member_creation",
        "CREATE TABLE member_creation (
        creation_id TEXT PRIMARY KEY NOT NULL,
        camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
        created_at TEXT NOT NULL
    )",
    ),
    (
        "member_creation_camp_idx",
        "CREATE INDEX member_creation_camp_idx ON member_creation(camp_id, created_at, creation_id)",
    ),
    (
        "member_creation_preference",
        "CREATE TABLE member_creation_preference (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        helper_agent_id TEXT NOT NULL
    )",
    ),
];

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    for (name, expected) in OBJECTS {
        let actual: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        let normalize = |sql: &str| sql.split_whitespace().collect::<String>();
        if actual.as_deref().map(normalize) != Some(normalize(expected)) {
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
        DatabaseContractClassification::SupportedMigrationSource(ref marker)
        if marker.contract_version == "v1.72" && marker.projection_schema_version == 131),
        "Member creation receipts require v1.72/schema 131"
    );
    for (_, sql) in OBJECTS {
        tx.execute_batch(sql)?;
    }
    tx.execute_batch("INSERT INTO schema_migration VALUES (182, datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=132, updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        schema_matches(&tx)?,
        "Member creation receipt schema is incomplete"
    );
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
                | DatabaseContractClassification::SupportedMigrationSource(_)
        ),
        "Member creation migration failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    pending_draft::downgrade_for_test(connection);
    let applied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=182)",
            [],
            |row| row.get(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    connection
        .execute_batch(
            "DROP TABLE member_creation;
        DROP TABLE member_creation_preference;
        DELETE FROM schema_migration WHERE version=182;
        UPDATE rovai_data_contract SET projection_schema_version=131 WHERE singleton=1;",
        )
        .unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns the additive 131 -> 132 boundary, rollback, and schema admission.
    #[test]
    fn member_receipt_migration_is_atomic_and_preserves_profiles() {
        let directory =
            std::env::temp_dir().join(format!("rovai-member-migration-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        downgrade_for_test(database.connection());
        let count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM agent_profile", [], |row| row.get(0))
            .unwrap();
        database
            .connection
            .execute_batch("CREATE TABLE member_creation_preference(block INTEGER)")
            .unwrap();
        assert!(migrate(&mut database).is_err());
        assert!(!database.schema_migration_applied(182).unwrap());
        assert!(
            !database
                .connection()
                .table_exists(None, "member_creation")
                .unwrap()
        );
        database
            .connection
            .execute_batch("DROP TABLE member_creation_preference")
            .unwrap();
        migrate(&mut database).unwrap();
        assert!(schema_matches(database.connection()).unwrap());
        assert_eq!(
            database
                .connection
                .query_row("SELECT COUNT(*) FROM agent_profile", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            count
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
