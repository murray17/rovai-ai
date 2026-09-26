//! Mission definition revisions, stable numbers, and delivered-version watermarks.
use super::*;

fn has_column(connection: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info('{table}')"))?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|name| name == column))
}

fn contains_schema(
    connection: &Connection,
    name: &str,
    fragments: &[&str],
) -> rusqlite::Result<bool> {
    let sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name=?1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(sql.is_some_and(|sql| fragments.iter().all(|fragment| sql.contains(fragment))))
}

pub(super) fn apply_schema(connection: &Connection) -> Result<()> {
    if has_column(connection, "mission", "source_branch")? {
        connection.execute_batch("ALTER TABLE mission DROP COLUMN source_branch;")?;
    }
    if !has_column(connection, "mission", "details_version")? {
        connection.execute_batch(
            "ALTER TABLE mission ADD COLUMN details_version INTEGER NOT NULL DEFAULT 1 CHECK(details_version >= 1);",
        )?;
    }
    if !has_column(connection, "mission_workspace", "base_branch")? {
        connection.execute_batch("ALTER TABLE mission_workspace ADD COLUMN base_branch TEXT;")?;
    }
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS mission_details_read (
            conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
            mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
            baseline_details_version INTEGER NOT NULL CHECK(baseline_details_version >= 1),
            last_read_details_version INTEGER CHECK(last_read_details_version IS NULL OR last_read_details_version >= 1),
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS mission_details_read_mission_idx
            ON mission_details_read(mission_id, conversation_id);",
    )?;
    Ok(())
}

pub(super) fn v159_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(!has_column(connection, "mission", "source_branch")?
        && contains_schema(
            connection,
            "mission",
            &[
                "details_version INTEGER NOT NULL DEFAULT 1",
                "details_version >= 1",
            ],
        )?
        && contains_schema(connection, "mission_workspace", &["base_branch TEXT"])?
        && contains_schema(
            connection,
            "mission_details_read",
            &[
                "conversation_id TEXT PRIMARY KEY NOT NULL",
                "baseline_details_version INTEGER NOT NULL",
                "last_read_details_version INTEGER",
                "REFERENCES conversation(id) ON DELETE CASCADE",
                "REFERENCES mission(id) ON DELETE CASCADE",
            ],
        )?
        && contains_schema(
            connection,
            "mission_details_read_mission_idx",
            &["mission_id", "conversation_id"],
        )?)
}

fn object_exists(connection: &Connection, name: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",
        [name],
        |row| row.get(0),
    )
}

pub(super) fn apply_delivery_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS mission_number_sequence (
            number INTEGER PRIMARY KEY AUTOINCREMENT
        );",
    )?;
    if !has_column(connection, "mission", "number")? {
        connection.execute_batch(
            "CREATE TABLE mission_v160 (
                id TEXT PRIMARY KEY NOT NULL,
                number INTEGER NOT NULL UNIQUE CHECK(number >= 1),
                camp_id TEXT NOT NULL UNIQUE REFERENCES camp(id) ON DELETE CASCADE,
                title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
                description TEXT NOT NULL CHECK(length(description) <= 12000),
                status TEXT NOT NULL CHECK(status IN ('needs_you','not_started','in_progress','completed')),
                source_message_id TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
                details_version INTEGER NOT NULL DEFAULT 1 CHECK(details_version >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            WITH ranked AS (
                SELECT id,ROW_NUMBER() OVER (ORDER BY created_at,id) AS number,camp_id,title,description,status,
                       source_message_id,tags_json,details_version,created_at,updated_at
                FROM mission
            )
            INSERT INTO mission_v160(id,number,camp_id,title,description,status,source_message_id,tags_json,details_version,created_at,updated_at)
            SELECT id,number,camp_id,title,description,status,source_message_id,tags_json,details_version,created_at,updated_at FROM ranked;
            DROP TABLE mission;
            ALTER TABLE mission_v160 RENAME TO mission;
            CREATE INDEX mission_updated_idx ON mission(updated_at DESC,id DESC);",
        )?;
    }
    connection.execute_batch(
        "INSERT OR IGNORE INTO mission_number_sequence(number) SELECT number FROM mission;",
    )?;
    if has_column(connection, "mission_start", "title")?
        || has_column(connection, "mission_start", "description")?
    {
        connection.execute_batch(
            "CREATE TABLE mission_start_v160 (
                message_id TEXT PRIMARY KEY NOT NULL REFERENCES camp_message(id) ON DELETE CASCADE,
                mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
                camp_turn_id TEXT NOT NULL UNIQUE REFERENCES camp_turn(id) ON DELETE CASCADE,
                command_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO mission_start_v160(message_id,mission_id,camp_turn_id,command_id,created_at)
            SELECT message_id,mission_id,camp_turn_id,command_id,created_at FROM mission_start;
            DROP TABLE mission_start;
            ALTER TABLE mission_start_v160 RENAME TO mission_start;",
        )?;
    }
    if !has_column(
        connection,
        "conversation",
        "mission_details_delivered_version",
    )? {
        connection.execute_batch(
            "ALTER TABLE conversation ADD COLUMN mission_details_delivered_version INTEGER
             CHECK(mission_details_delivered_version IS NULL OR mission_details_delivered_version >= 1);",
        )?;
    }
    if !has_column(connection, "context_manifest", "mission_details_version")? {
        connection.execute_batch(
            "ALTER TABLE context_manifest ADD COLUMN mission_details_version INTEGER
             CHECK(mission_details_version IS NULL OR mission_details_version >= 1);",
        )?;
    }
    connection.execute_batch(
        "UPDATE mission_activity
         SET changes_json=json_set(json_remove(changes_json,'$.title'),'$.titleChanged',json('true'))
         WHERE json_type(changes_json,'$.title') IS NOT NULL;
         UPDATE mission_activity
         SET changes_json=json_set(json_remove(changes_json,'$.description'),'$.descriptionChanged',json('true'))
         WHERE json_type(changes_json,'$.description') IS NOT NULL;
         UPDATE event_log
         SET payload_json=json_set(json_remove(payload_json,'$.changes.title'),'$.changes.titleChanged',json('true'))
         WHERE event_type='mission.updated' AND json_type(payload_json,'$.changes.title') IS NOT NULL;
         UPDATE event_log
         SET payload_json=json_set(json_remove(payload_json,'$.changes.description'),'$.changes.descriptionChanged',json('true'))
         WHERE event_type='mission.updated' AND json_type(payload_json,'$.changes.description') IS NOT NULL;
         DROP INDEX IF EXISTS mission_details_read_mission_idx;
         DROP TABLE IF EXISTS mission_details_read;",
    )?;
    Ok(())
}

pub(super) fn v160_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(contains_schema(
        connection,
        "mission",
        &["number INTEGER NOT NULL UNIQUE", "number >= 1"],
    )? && contains_schema(
        connection,
        "mission_number_sequence",
        &["number INTEGER PRIMARY KEY AUTOINCREMENT"],
    )? && !has_column(connection, "mission_start", "title")?
        && !has_column(connection, "mission_start", "description")?
        && contains_schema(
            connection,
            "conversation",
            &["mission_details_delivered_version INTEGER"],
        )?
        && contains_schema(
            connection,
            "context_manifest",
            &["mission_details_version INTEGER"],
        )?
        && !object_exists(connection, "mission_details_read")?)
}

pub(super) fn v161_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(v160_schema_matches(connection)?
        && contains_schema(
            connection,
            "mission",
            &[
                "source_attachments_json TEXT NOT NULL DEFAULT '[]'",
                "json_valid(source_attachments_json)",
                "json_type(source_attachments_json)='array'",
            ],
        )?)
}

pub(super) fn apply_workspace_lifecycle_schema(connection: &Connection) -> Result<()> {
    for (column, definition) in [
        (
            "preparation_kind",
            "TEXT NOT NULL DEFAULT 'create' CHECK(preparation_kind IN ('create','restore'))",
        ),
        (
            "generation",
            "INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1)",
        ),
        ("cleanup_command_id", "TEXT"),
        ("cleanup_expected_branch_oid", "TEXT"),
        (
            "cleanup_worktree_removed",
            "INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_worktree_removed IN (0,1))",
        ),
        (
            "cleanup_branch_removed",
            "INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_branch_removed IN (0,1))",
        ),
    ] {
        if !has_column(connection, "mission_workspace", column)? {
            connection.execute_batch(&format!(
                "ALTER TABLE mission_workspace ADD COLUMN {column} {definition};"
            ))?;
        }
    }
    connection.execute_batch("DROP TRIGGER IF EXISTS mission_camp_delete_cleanup;")?;
    Ok(())
}

pub(super) fn v162_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(v161_schema_matches(connection)?
        && contains_schema(
            connection,
            "mission_workspace",
            &[
                "generation INTEGER NOT NULL DEFAULT 1",
                "preparation_kind TEXT NOT NULL DEFAULT 'create'",
                "cleanup_command_id TEXT",
                "cleanup_expected_branch_oid TEXT",
                "cleanup_worktree_removed INTEGER NOT NULL DEFAULT 0",
                "cleanup_branch_removed INTEGER NOT NULL DEFAULT 0",
            ],
        )?
        && !object_exists(connection, "mission_camp_delete_cleanup")?)
}

impl Database {
    pub(super) fn migrate_mission_details_v159(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 108),
                "Mission details migration requires an admitted v1.59/schema 108 source"
            );
            apply_schema(&tx)?;
            tx.execute_batch(
                "INSERT INTO schema_migration VALUES(159,datetime('now'));
                 UPDATE rovai_data_contract SET projection_schema_version=109,updated_at=datetime('now') WHERE singleton=1;",
            )?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 109),
                "Mission details migration failed source admission"
            );
            validate_migration_foreign_keys(
                &tx,
                &["mission", "mission_workspace", "mission_details_read"],
            )?;
            tx.commit()?;
            Ok(())
        })();
        let restore = self.connection.execute_batch("PRAGMA foreign_keys=ON;");
        result?;
        restore?;
        Ok(())
    }

    pub(super) fn migrate_mission_delivery_v160(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 109),
                "Mission delivery migration requires an admitted v1.59/schema 109 source"
            );
            let dsh_present = dsh_runtime_v157_schema_matches(&tx)?;
            if !dsh_present {
                anyhow::ensure!(
                    v160_schema_matches(&tx)?,
                    "Mission/DSH convergence requires the deployed Mission preview schema"
                );
                apply_dsh_runtime_schema_v157(&tx)?;
            }
            apply_delivery_schema(&tx)?;
            tx.execute_batch(
                "INSERT INTO schema_migration VALUES(160,datetime('now'));
                 UPDATE rovai_data_contract SET projection_schema_version=110,updated_at=datetime('now') WHERE singleton=1;",
            )?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 110),
                "Mission delivery migration failed schema admission"
            );
            let mut tables = vec![
                "mission",
                "mission_start",
                "mission_activity",
                "mission_workspace",
            ];
            tables.extend(DSH_RUNTIME_TABLES);
            tables.extend(DSH_SKILL_TABLES);
            validate_migration_foreign_keys(&tx, &tables)?;
            tx.commit()?;
            Ok(())
        })();
        let restore = self.connection.execute_batch("PRAGMA foreign_keys=ON;");
        result?;
        restore?;
        Ok(())
    }

    pub(super) fn migrate_mission_attachments_v161(&mut self) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.59" && marker.projection_schema_version == 110),
            "Mission attachment migration requires an admitted v1.59/schema 110 source"
        );
        if !has_column(&tx, "mission", "source_attachments_json")? {
            tx.execute_batch(
                "ALTER TABLE mission ADD COLUMN source_attachments_json TEXT NOT NULL DEFAULT '[]'
                 CHECK(json_valid(source_attachments_json) AND json_type(source_attachments_json)='array');",
            )?;
        }
        tx.execute_batch(
            "INSERT INTO schema_migration VALUES(161,datetime('now'));
             UPDATE rovai_data_contract SET projection_schema_version=111,updated_at=datetime('now') WHERE singleton=1;",
        )?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.59" && marker.projection_schema_version == 111),
            "Mission attachment migration failed schema admission"
        );
        validate_migration_foreign_keys(&tx, &["mission"])?;
        tx.commit()?;
        Ok(())
    }

    pub(super) fn migrate_mission_workspace_lifecycle_v162(&mut self) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.59" && marker.projection_schema_version == 111),
            "Mission workspace lifecycle migration requires an admitted v1.59/schema 111 source"
        );
        apply_workspace_lifecycle_schema(&tx)?;
        tx.execute_batch(
            "INSERT INTO schema_migration VALUES(162,datetime('now'));
             UPDATE rovai_data_contract SET projection_schema_version=112,updated_at=datetime('now') WHERE singleton=1;",
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59"
                        && marker.projection_schema_version == 112
            ),
            "Mission workspace lifecycle migration failed schema admission"
        );
        validate_migration_foreign_keys(&tx, &["mission_workspace"])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use crate::command::{ActorRef, CommandEnvelope};
    use uuid::Uuid;

    #[test]
    fn workspace_lifecycle_migration_is_atomic_preserves_rows_and_removes_delete_trigger() {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let project_path = database.directory().to_string_lossy().into_owned();
        let created = crate::mission::MissionService::default()
            .create(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "local_user".into(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: crate::mission::CreateMissionCommand {
                        title: "workspace lifecycle".into(),
                        description: String::new(),
                        project_path,
                        project_binding_kind: crate::collaboration::ProjectBindingKind::Directory,
                        member_agent_ids: vec!["agent_1".into()],
                        default_lead_agent_id: "agent_1".into(),
                        tags: vec![],
                        source_attachments: vec![],
                    },
                },
            )
            .unwrap();
        let mission_id = created.result.payload["missionId"].as_str().unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let host: String = database
            .connection()
            .query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database.connection().execute(
            "INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,state,created_at,updated_at) VALUES('workspace-row',?1,?2,?3,'/repo','/repo','/repo/.git','/worktree','/worktree','main','rovai/mission/001','base','owner','ready','created','updated')",
            params![mission_id, camp_id, host],
        ).unwrap();
        crate::db::downgrade_current_schema_to_v161_source_for_test(database.connection());
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.projection_schema_version == 111
        ));

        database
            .connection()
            .execute_batch(
                "CREATE TEMP TRIGGER reject_workspace_lifecycle_receipt
             BEFORE INSERT ON schema_migration WHEN NEW.version=162
             BEGIN SELECT RAISE(ABORT,'workspace lifecycle receipt failure'); END;",
            )
            .unwrap();
        assert!(
            database
                .migrate_mission_workspace_lifecycle_v162()
                .unwrap_err()
                .to_string()
                .contains("workspace lifecycle receipt failure")
        );
        assert!(!has_column(database.connection(), "mission_workspace", "generation").unwrap());
        assert!(object_exists(database.connection(), "mission_camp_delete_cleanup").unwrap());

        database
            .connection()
            .execute_batch("DROP TRIGGER reject_workspace_lifecycle_receipt;")
            .unwrap();
        database.migrate_mission_workspace_lifecycle_v162().unwrap();
        assert!(v162_schema_matches(database.connection()).unwrap());
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.59"
                    && marker.projection_schema_version == 112
        ));
        let retained: (String, i64, String, bool, bool) = database
            .connection()
            .query_row(
                "SELECT state,generation,preparation_kind,cleanup_worktree_removed,cleanup_branch_removed FROM mission_workspace WHERE id='workspace-row'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap();
        assert_eq!(retained, ("ready".into(), 1, "create".into(), false, false));
        database.migrate_camp_message_agent_run_v163().unwrap();
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.60"
                    && marker.projection_schema_version == 113
        ));
        database.migrate_agent_run_notification_v164().unwrap();
        database
            .migrate_single_chat_operation_policy_v165()
            .unwrap();
        database.migrate_default_recipient_mention_v166().unwrap();
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.61"
                    && marker.projection_schema_version == 116
        ));
        crate::collaboration::delete_camp_aggregate(database.connection(), camp_id).unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT state FROM mission_workspace WHERE id='workspace-row'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "ready"
        );
    }
}
