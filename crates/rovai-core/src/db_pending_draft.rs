//! Additive retention marker for client-local Pending Thread drafts.
use super::*;

const OBJECTS: &[(&str, &str)] = &[
    (
        "pending_camp_draft_presence",
        "CREATE TABLE pending_camp_draft_presence (
        camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        PRIMARY KEY(camp_id, client_id)
    )",
    ),
    (
        "pending_camp_draft_activated",
        "CREATE TRIGGER pending_camp_draft_activated
        AFTER UPDATE OF activation_state ON camp WHEN NEW.activation_state = 'active'
        BEGIN DELETE FROM pending_camp_draft_presence WHERE camp_id=NEW.id; END",
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
        if marker.contract_version == "v1.72" && marker.projection_schema_version == 132),
        "Pending draft retention requires v1.72/schema 132"
    );
    for (_, sql) in OBJECTS {
        tx.execute_batch(sql)?;
    }
    tx.execute_batch("INSERT INTO schema_migration VALUES (183, datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=133, updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        schema_matches(&tx)?,
        "Pending draft retention schema is incomplete"
    );
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.72" && marker.projection_schema_version == 133
        ),
        "Pending draft retention migration failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    downgrade_cline_catalog_for_test(connection);
    if !connection
        .table_exists(None, "pending_camp_draft_presence")
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch(
            "DROP TRIGGER pending_camp_draft_activated;
        DROP TABLE pending_camp_draft_presence;
        DELETE FROM schema_migration WHERE version=183;
        UPDATE rovai_data_contract SET projection_schema_version=132 WHERE singleton=1;",
        )
        .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns the additive upgrade/rollback boundary; a real database is required to
    // prove that marker admission and its activation trigger commit together.
    #[test]
    fn pending_draft_migration_rolls_back_and_reopens_without_losing_profiles() {
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        downgrade_for_test(database.connection());
        let count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_profile", [], |r| r.get(0))
            .unwrap();
        database.connection().execute_batch("CREATE TRIGGER pending_camp_draft_activated AFTER UPDATE ON camp BEGIN SELECT 1; END").unwrap();
        assert!(migrate(&mut database).is_err());
        assert!(
            !database
                .connection()
                .table_exists(None, "pending_camp_draft_presence")
                .unwrap()
        );
        assert!(!database.schema_migration_applied(183).unwrap());
        database
            .connection()
            .execute_batch("DROP TRIGGER pending_camp_draft_activated")
            .unwrap();
        migrate(&mut database).unwrap();
        assert!(schema_matches(database.connection()).unwrap());
        drop(database);
        let database = Database::open(&directory).unwrap();
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM agent_profile", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            count
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
