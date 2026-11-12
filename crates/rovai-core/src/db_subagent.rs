//! New operations use activity-v5. Existing projections and evidence are not
//! rewritten; in-flight operations continue to reduce with their original version.
use super::*;

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.projection_schema_version == 168 && marker.classifier_version == V147_CLASSIFIER_VERSION),
        "Subagent display classification requires schema 168/activity-v4"
    );
    tx.execute_batch(
        "INSERT INTO schema_migration VALUES(219,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=169,
            classifier_version='activity-v5',updated_at=datetime('now') WHERE singleton=1;",
    )?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 169),
        "Subagent display classifier admission failed"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    super::channel_native::downgrade_for_test(connection);
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=219)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch(
            "DELETE FROM schema_migration WHERE version=219;
        UPDATE rovai_data_contract SET projection_schema_version=168,
            classifier_version='activity-v4' WHERE singleton=1;",
        )
        .unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(database: &mut Database) {
    downgrade_for_test(database.connection());
    let snapshot = |c: &Connection| -> Vec<String> {
        c.prepare("SELECT json_array(operation_id,classifier_version,phase,outcome,revision,created_at,updated_at)
            FROM canonical_runtime_activity
            UNION ALL SELECT json_array(id,activity_meta_json,sequence,revision,input_preview_json,result_preview_json)
            FROM agent_run_execution_evidence ORDER BY 1").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    let before = snapshot(database.connection());
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_subagent_classifier_marker BEFORE UPDATE ON rovai_data_contract
        WHEN NEW.classifier_version='activity-v5' BEGIN SELECT RAISE(ABORT,'classifier marker rollback'); END;").unwrap();
    assert!(
        migrate(database)
            .unwrap_err()
            .to_string()
            .contains("classifier marker rollback")
    );
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.classifier_version == "activity-v4")
    );
    assert_eq!(snapshot(database.connection()), before);
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_subagent_classifier_marker;")
        .unwrap();
    migrate(database).unwrap();
    super::channel_native::migrate(database).unwrap();
    // The next reader-admission marker has no data rewrite; a failed marker update must roll back.
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_file_reference_marker BEFORE UPDATE ON rovai_data_contract WHEN NEW.projection_schema_version=171 BEGIN SELECT RAISE(ABORT,'file reference marker rollback'); END;").unwrap();
    assert!(
        database
            .migrate_project_file_references()
            .unwrap_err()
            .to_string()
            .contains("file reference marker rollback")
    );
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 170)
    );
    assert!(!database.schema_migration_applied(221).unwrap());
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_file_reference_marker;")
        .unwrap();
    database.migrate_project_file_references().unwrap();
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_directory_reference_marker BEFORE UPDATE ON rovai_data_contract WHEN NEW.projection_schema_version=172 BEGIN SELECT RAISE(ABORT,'directory reference marker rollback'); END;").unwrap();
    assert!(
        database
            .migrate_project_directory_references()
            .unwrap_err()
            .to_string()
            .contains("directory reference marker rollback")
    );
    assert!(!database.schema_migration_applied(222).unwrap());
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 171)
    );
    assert_eq!(snapshot(database.connection()), before);
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_directory_reference_marker;")
        .unwrap();
    database.migrate_project_directory_references().unwrap();
    super::kilo::migrate(database).unwrap();
    super::memory_capability::migrate(database).unwrap();
    assert_eq!(snapshot(database.connection()), before);
    assert!(matches!(
        classify_startup_contract(database.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
}
