//! Private member configuration; retire historical launch environments without decrypting them.
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

pub(super) fn schema_matches(connection: &Connection, retired: bool) -> rusqlite::Result<bool> {
    for (name, sql) in OBJECTS {
        if retired && *name == "runtime_environment_plan" {
            continue;
        }
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
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 141
        ),
        "Member environment schema admission failed"
    );
    tx.commit()?;
    Ok(())
}

const SESSION_SQL: &str = "CREATE TABLE conversation_runtime_environment (
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    runtime_kind TEXT NOT NULL,
    plan_id TEXT NOT NULL REFERENCES runtime_environment_plan(id),
    revision INTEGER NOT NULL CHECK(revision>=0),
    PRIMARY KEY(conversation_id,runtime_kind)
)";

pub(super) fn session_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    let sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='conversation_runtime_environment'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let normalize = |s: &str| s.split_whitespace().collect::<String>();
    Ok(sql.as_deref().map(normalize) == Some(normalize(SESSION_SQL)))
}

pub(super) fn migrate_sessions(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.contract_version == "v1.72" && marker.projection_schema_version == 141),
        "Session environment migration requires v1.72/schema 141"
    );
    tx.execute_batch(SESSION_SQL)?;
    tx.execute_batch("INSERT INTO schema_migration VALUES(192,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=142,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 142
        ),
        "Session environment schema admission failed"
    );
    tx.commit()?;
    Ok(())
}

pub(super) fn retired_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row("SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name IN ('conversation_runtime_environment','runtime_environment_plan'))", [], |r| r.get(0))
}

pub(super) fn retire_snapshots(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.contract_version == "v1.72" && marker.projection_schema_version == 142),
        "Retiring environment snapshots requires v1.72/schema 142"
    );
    // Neither keys nor ciphertext are read. Saved member configuration, native
    // bindings, messages and historical Run identities remain untouched.
    tx.execute_batch("DROP TABLE conversation_runtime_environment;
        DROP TABLE runtime_environment_plan;
        INSERT INTO schema_migration VALUES(193,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=143,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 143
        ),
        "Environment snapshot retirement admission failed"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    super::downgrade_run_bootstrap_for_test(connection);
    connection.execute_batch("DROP TABLE IF EXISTS conversation_runtime_environment;
        DELETE FROM schema_migration WHERE version IN (192,193,194);
        UPDATE rovai_data_contract SET projection_schema_version=141 WHERE singleton=1 AND projection_schema_version IN (142,143,144);").unwrap();
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
         DROP TABLE IF EXISTS runtime_environment_plan;
         DROP TABLE runtime_environment_legacy;
         DELETE FROM schema_migration WHERE version=191;
         UPDATE rovai_data_contract SET projection_schema_version=140 WHERE singleton=1;",
        )
        .unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns the schema-142 upgrade boundary: corrupt/absent snapshots and a
    // temporarily unavailable key cannot block retirement or erase user data.
    #[test]
    fn retirement_needs_no_old_ciphertext_or_key_and_preserves_member_configuration() {
        let (mut database, root) = crate::test_support::seeded_runtime_database_fast();
        let kind = crate::agent_profile::AdapterKind::CodexCli;
        crate::member_environment::prepare(
            database.connection(),
            "agent_1",
            kind,
            &crate::agent_profile::ModelSelection::RuntimeDefault,
            crate::member_environment::EnvironmentEdit {
                inherit_common: None,
                expected_revision: 0,
                json: r#"{"API_KEY":"fixture-secret"}"#.into(),
            },
        )
        .unwrap()
        .commit(database.connection())
        .unwrap();
        super::super::downgrade_run_bootstrap_for_test(database.connection());
        let connection = database.connection();
        connection.execute_batch("INSERT INTO camp(id,title,project_binding_kind,project_path,last_message_sequence,version,created_at,updated_at)
            VALUES('environment-upgrade','Keep history','directory','/tmp',1,1,datetime('now'),datetime('now'));
            INSERT INTO conversation(id,camp_id,agent_id,native_session_id,version,created_at,updated_at)
            VALUES('with-broken-snapshot','environment-upgrade','agent_1','native-a',1,datetime('now'),datetime('now')),
                  ('without-snapshot','environment-upgrade','agent_2','native-b',1,datetime('now'),datetime('now'));
            INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,structured_content_json,content_digest,address_mode,
                addressed_agent_ids_json,effective_recipient_ids_json,recipient_presentation_json,origin_kind,recall_state,version,created_at,updated_at)
            VALUES('history','environment-upgrade',1,'user','local_user','Keep this message','[{\"kind\":\"text\",\"text\":\"Keep this message\"}]','fixture','explicit',
                '[\"agent_1\"]','[\"agent_1\"]','{}','local_composer','recallable',1,datetime('now'),datetime('now'));").unwrap();
        connection.execute_batch(OBJECTS[1].1).unwrap();
        connection.execute_batch(SESSION_SQL).unwrap();
        connection
            .execute_batch(
                "DELETE FROM schema_migration WHERE version>=193;
            UPDATE rovai_data_contract SET projection_schema_version=142 WHERE singleton=1;
            INSERT INTO runtime_environment_plan VALUES('broken','broken',x'00');
            INSERT INTO conversation_runtime_environment VALUES('with-broken-snapshot','codex-cli','broken',1);",
            )
            .unwrap();
        let conversations: i64 = connection
            .query_row("SELECT COUNT(*) FROM conversation", [], |r| r.get(0))
            .unwrap();
        let key_path = root.join("member-environment/key");
        let key = std::fs::read(&key_path).unwrap();
        std::fs::remove_file(&key_path).unwrap();
        retire_snapshots(&mut database).unwrap();
        assert!(retired_schema_matches(database.connection()).unwrap());
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM conversation", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            conversations
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT body FROM camp_message WHERE id='history'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Keep this message"
        );
        assert_eq!(database.connection().query_row("SELECT COUNT(*) FROM conversation WHERE native_session_id IN ('native-a','native-b')", [], |r|r.get::<_,i64>(0)).unwrap(), 2);
        let mut file =
            crate::platform::private_storage::create_private_new_file(&key_path).unwrap();
        std::io::Write::write_all(&mut file, &key).unwrap();
        drop(file);
        database.migrate(false).unwrap();
        assert_eq!(
            crate::member_environment::get(database.connection(), "agent_1", kind).unwrap()["environment"]
                ["API_KEY"],
            "fixture-secret"
        );
        drop(database);
        std::fs::remove_dir_all(root).unwrap();
    }
}
