//! Private member overlays and immutable Run environments; no values in roster projections.
use super::*;

const OBJECTS: &[(&str, &str)] = &[
    (
        "member_runtime_environment",
        "CREATE TABLE member_runtime_environment (
        member_id TEXT NOT NULL REFERENCES agent_profile(id),
        runtime_kind TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision>0),
        ciphertext BLOB NOT NULL,
        PRIMARY KEY(member_id,runtime_kind,revision)
    )",
    ),
    (
        "runtime_environment_plan",
        "CREATE TABLE runtime_environment_plan (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL UNIQUE,
        ciphertext BLOB NOT NULL
    )",
    ),
    (
        "runtime_environment_legacy",
        "CREATE TABLE runtime_environment_legacy (
        runtime_kind TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        variable_count INTEGER NOT NULL CHECK(variable_count>0),
        acknowledged_identity TEXT
    )",
    ),
];

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    for (name, sql) in OBJECTS {
        let actual: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .optional()?;
        let normalize = |s: &str| s.split_whitespace().collect::<String>();
        if actual.as_deref().map(normalize) != Some(normalize(sql)) {
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
        if marker.contract_version=="v1.72" && marker.projection_schema_version==140),
        "Member environment migration requires v1.72/schema 140"
    );
    for (_, sql) in OBJECTS {
        tx.execute_batch(sql)?;
    }
    crate::member_environment::archive_legacy(&tx)?;
    tx.execute_batch("INSERT INTO schema_migration VALUES(191,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=141,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
        ),
        "Member environment schema admission failed"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=191)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch(
            "DROP TABLE member_runtime_environment;
         DROP TABLE runtime_environment_plan;
         DROP TABLE runtime_environment_legacy;
         DELETE FROM schema_migration WHERE version=191;
         UPDATE rovai_data_contract SET projection_schema_version=140 WHERE singleton=1;",
        )
        .unwrap();
}
