//! Notification-only projection. Its graph never participates in scheduling or budgets.
use super::*;

const NEW_SEMANTICS: &str = "'round_completed', 'single_chat_reply', 'mission_needs_you', 'mission_status_changed', 'task_status_changed'";

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.contract_version == "v1.70" && marker.projection_schema_version == 124),
            "Notification model requires the exact v1.70/schema 124 source"
        );
        for table in [
            "notification_episode",
            "notification_occurrence",
            "notification_change_journal",
        ] {
            let original: String = tx.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )?;
            let mut schema = replacement_table_schema_v171(original, table);
            if table == "notification_episode" {
                schema = schema.replace("'collaboration', 'message', 'approval'", "'collaboration', 'message', 'approval', 'round', 'mission', 'task', 'single_chat'");
                let at = schema
                    .rfind("CHECK (")
                    .context("missing episode identity constraint")?;
                let old = schema[at..].to_string();
                schema.truncate(at);
                schema = schema.replace(
                    "updated_at TEXT NOT NULL,",
                    "updated_at TEXT NOT NULL, subject_id TEXT,",
                );
                let end = old.rfind(')').context("missing episode table closure")?;
                let check_end = old[..end]
                    .rfind(')')
                    .context("missing episode check closure")?;
                schema.push_str(&old[..check_end]);
                schema.push_str(" OR (kind IN ('round','mission','task','single_chat') AND subject_id IS NOT NULL)\n))");
            } else if table == "notification_occurrence" {
                let at = schema
                    .rfind("CHECK (")
                    .context("missing occurrence identity constraint")?;
                let old = schema[at..].to_string();
                schema.truncate(at);
                schema = schema.replace(
                    "'turn_incomplete'",
                    &format!("'turn_incomplete', {NEW_SEMANTICS}"),
                );
                schema = schema.replace(
                    "'camp_turn', 'agent_run'",
                    "'camp_turn', 'agent_run', 'round', 'mission', 'task', 'single_chat_message'",
                );
                schema = schema.replace(
                    "occurred_at TEXT NOT NULL,",
                    "occurred_at TEXT NOT NULL, business_status TEXT,",
                );
                let end = old.rfind(')').context("missing occurrence table closure")?;
                let check_end = old[..end]
                    .rfind(')')
                    .context("missing occurrence check closure")?;
                schema.push_str(&old[..check_end]);
                schema.push_str(" OR (semantic='round_completed' AND source_type='round' AND agent_run_id IS NOT NULL) OR (semantic='single_chat_reply' AND source_type='single_chat_message' AND agent_run_id IS NOT NULL) OR (semantic IN ('mission_needs_you','mission_status_changed') AND source_type='mission' AND business_status IS NOT NULL AND ((semantic='mission_needs_you' AND business_status='needs_you') OR (semantic='mission_status_changed' AND business_status IN ('not_started','in_progress','completed')))) OR (semantic='task_status_changed' AND source_type='task' AND business_status IS NOT NULL AND business_status IN ('pending','in_progress','blocked','completed','cancelled'))\n))");
            } else {
                schema = schema.replace(
                    "'turn_incomplete'",
                    &format!("'turn_incomplete', {NEW_SEMANTICS}"),
                );
            }
            rebuild_table_v171(&tx, table, &schema, &[], &[])?;
        }
        tx.execute_batch(include_str!("notification_model_schema.sql"))?;
        // Historical occurrences stay readable; these producers no longer emit per-Turn successes.
        tx.execute_batch("DROP TRIGGER notification_camp_turn_terminal_insert; DROP TRIGGER notification_camp_turn_terminal_update;")?;
        for name in [
            "notification_agent_run_terminal_insert",
            "notification_agent_run_terminal_update",
        ] {
            let sql: String = tx.query_row(
                "SELECT sql FROM sqlite_master WHERE name=?1",
                [name],
                |row| row.get(0),
            )?;
            tx.execute_batch(&format!("DROP TRIGGER {name};"))?;
            tx.execute_batch(&sql.replace(
                "NEW.status IN ('succeeded', 'failed', 'cancelled')",
                "NEW.status IN ('failed', 'cancelled')",
            ))?;
        }
        let ended: String = tx.query_row(
            "SELECT sql FROM sqlite_master WHERE name='notification_single_chat_source_ended'",
            [],
            |r| r.get(0),
        )?;
        tx.execute_batch("DROP TRIGGER notification_single_chat_source_ended")?;
        tx.execute_batch(&ended.replace("OR agent_run.id = action_execution.agent_run_id", "OR agent_run.id = action_execution.agent_run_id OR agent_run.id = occurrence.agent_run_id"))?;
        tx.execute_batch(&admit_trigger(
            "notification_round_completed",
            "notification_round",
            "'round'",
            "'round_completed'",
            "'round'",
            "NEW.id",
            "1",
            "NEW.camp_id",
            "NULL",
            "NEW.last_agent_run_id",
            "NEW.source_message_id",
            "NULL",
            "NEW.created_at",
            "1",
        ))?;
        tx.execute_batch(&admit_trigger("notification_single_chat_reply", "agent_run", "'single_chat'", "'single_chat_reply'", "'single_chat_message'", "NEW.final_conversation_message_id", "1", "(SELECT camp_id FROM conversation WHERE id=NEW.destination_conversation_id)", "NEW.camp_turn_id", "NEW.id", "NULL", "NULL", "NEW.ended_at", "NEW.invocation_kind='single_chat' AND NEW.status='succeeded' AND NEW.final_conversation_message_id IS NOT NULL" ).replace("AFTER INSERT ON agent_run", "AFTER UPDATE OF status, final_conversation_message_id ON agent_run"))?;
        let private_failure = admit_trigger(
            "notification_single_chat_failure",
            "agent_run",
            "'single_chat'",
            "CASE WHEN NEW.status='failed' THEN 'turn_failed' ELSE 'turn_incomplete' END",
            "'agent_run'",
            "NEW.id",
            "1",
            "(SELECT camp_id FROM conversation WHERE id=NEW.destination_conversation_id)",
            "NULL",
            "NEW.id",
            "NULL",
            "NULL",
            "NEW.updated_at",
            "NEW.invocation_kind='single_chat' AND NEW.status IN ('failed','cancelled') AND NEW.cancel_requested_at IS NULL",
        );
        tx.execute_batch(&private_failure.replace(
            "AFTER INSERT ON agent_run",
            "AFTER UPDATE OF status ON agent_run",
        ))?;
        tx.execute_batch("INSERT INTO schema_migration(version,applied_at) VALUES(175,datetime('now')); UPDATE rovai_data_contract SET contract_version='v1.71',projection_schema_version=125,reset_reason=NULL,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            schema_matches(&tx)?,
            "Notification model schema is incomplete"
        );
        validate_migration_foreign_keys(
            &tx,
            &[
                "notification_episode",
                "notification_occurrence",
                "notification_round",
            ],
        )?;
        tx.commit()?;
        Ok(())
    })();
    let foreign_keys = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    foreign_keys?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn admit_trigger(
    name: &str,
    table: &str,
    kind: &str,
    semantic: &str,
    source_type: &str,
    source_id: &str,
    revision: &str,
    camp: &str,
    turn: &str,
    run: &str,
    message: &str,
    status: &str,
    now: &str,
    condition: &str,
) -> String {
    format!(
        r#"CREATE TRIGGER {name} AFTER INSERT ON {table}
    WHEN ({condition}) AND NOT EXISTS(SELECT 1 FROM notification_occurrence WHERE semantic={semantic} AND source_type={source_type} AND source_id={source_id} AND source_revision={revision})
    BEGIN
      UPDATE notification_change_clock SET current_sequence=current_sequence+1 WHERE singleton=1;
      INSERT INTO notification_episode(id,aggregation_key,recipient_user_id,kind,camp_id,subject_id,version,attention_revision,created_change_sequence,last_change_sequence,sort_at,created_at,updated_at)
      SELECT lower(hex(randomblob(16))), {kind}||':local_user:'||{source_id},'local_user',{kind},{camp},{source_id},0,0,current_sequence,current_sequence,{now},{now},{now} FROM notification_change_clock WHERE singleton=1
      ON CONFLICT(aggregation_key) DO NOTHING;
      INSERT INTO notification_occurrence(id,episode_id,recipient_user_id,semantic,source_type,source_id,source_revision,camp_id,camp_turn_id,agent_run_id,source_message_id,business_status,admitted_episode_version,admitted_attention_revision,admitted_change_sequence,occurred_at)
      SELECT lower(hex(randomblob(16))),e.id,'local_user',{semantic},{source_type},{source_id},{revision},{camp},{turn},{run},{message},{status},e.version+1,e.attention_revision+1,c.current_sequence,{now}
      FROM notification_episode e JOIN notification_change_clock c ON c.singleton=1 WHERE e.aggregation_key={kind}||':local_user:'||{source_id};
    END;"#
    )
}

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    let columns: i64 = connection.query_row("SELECT
        (SELECT count(*) FROM pragma_table_info('notification_preference') WHERE name IN ('single_chat_heads_up_enabled','mission_needs_you_heads_up_enabled','mission_status_heads_up_enabled','task_status_heads_up_enabled','mission_statuses_json','task_statuses_json'))
        + (SELECT count(*) FROM pragma_table_info('notification_episode') WHERE name='subject_id')
        + (SELECT count(*) FROM pragma_table_info('notification_occurrence') WHERE name='business_status')", [], |r| r.get(0))?;
    if columns != 8 {
        return Ok(false);
    }
    for (name, fragments) in [
        (
            "notification_round_check",
            vec![
                "WITH RECURSIVE component",
                "agent_run_input",
                "d.status<>'settled'",
                "status<>'succeeded'",
            ],
        ),
        (
            "notification_round_completed",
            vec!["round_completed", "NEW.last_agent_run_id"],
        ),
        (
            "notification_single_chat_reply",
            vec!["single_chat_reply", "NEW.final_conversation_message_id"],
        ),
        (
            "notification_single_chat_failure",
            vec!["NEW.cancel_requested_at IS NULL", "turn_failed"],
        ),
        (
            "notification_round_run_terminal",
            vec!["NEW.status='succeeded'"],
        ),
        (
            "notification_round_delivery_terminal",
            vec!["NEW.status='settled'"],
        ),
        (
            "notification_round_publication",
            vec!["camp_message.public_a2a_sent"],
        ),
        (
            "notification_agent_run_terminal_update",
            vec!["NEW.status IN ('failed', 'cancelled')"],
        ),
        (
            "notification_agent_run_terminal_insert",
            vec!["NEW.status IN ('failed', 'cancelled')"],
        ),
        (
            "notification_occurrence",
            vec![
                "mission_status_changed",
                "business_status IS NOT NULL",
                "single_chat_message",
            ],
        ),
        (
            "notification_episode",
            vec!["'single_chat'", "subject_id IS NOT NULL"],
        ),
        (
            "notification_change_journal",
            vec!["mission_needs_you", "round_completed"],
        ),
    ] {
        let sql: Option<String> = connection
            .query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| {
                r.get(0)
            })
            .optional()?;
        if !sql.is_some_and(|sql| fragments.iter().all(|fragment| sql.contains(fragment))) {
            return Ok(false);
        }
    }
    connection.query_row("SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name IN ('notification_camp_turn_terminal_insert','notification_camp_turn_terminal_update')) AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='notification_round')", [], |r| r.get(0))
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    #[test]
    fn notification_model_upgrade_preserves_attention_and_preferences_without_backfill() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-notification-migration-{}",
            uuid::Uuid::new_v4()
        ));
        let mut db = STOP_BEFORE_NOTIFICATION_MODEL_FOR_TEST.with(|flag| {
            flag.set(true);
            let result = Database::open(&directory);
            flag.set(false);
            result.unwrap()
        });
        db.connection.execute_batch("INSERT INTO camp(id,title,name_origin,collaboration_mode,project_binding_kind,project_path,last_message_sequence,version,created_at,updated_at)
          VALUES('camp','migration','user','peer','quick_chat','/quick-chat',0,1,datetime('now'),datetime('now'));
          INSERT INTO camp_turn(id,camp_id,trigger_type,trigger_id,status,version,created_at,updated_at,ended_at)
          VALUES('turn','camp','system_event','test','completed',1,datetime('now'),datetime('now'),datetime('now'));
          UPDATE notification_preference SET heads_up_enabled=0,turn_completed_heads_up_enabled=0,version=7;
          UPDATE notification_occurrence_disposition SET acknowledged_at=datetime('now'),updated_at=datetime('now');").unwrap();
        let before: String = db.connection.query_row("SELECT json_group_array(json_array(o.id,o.semantic,o.source_id,o.admitted_change_sequence,d.acknowledged_at,d.satisfied_at,d.resolved_at)) FROM notification_occurrence o JOIN notification_occurrence_disposition d ON d.occurrence_id=o.id",[],|r|r.get(0)).unwrap();
        let clock: i64 = db
            .connection
            .query_row(
                "SELECT current_sequence FROM notification_change_clock",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(clock > 0);
        db.connection.execute_batch("CREATE TEMP TRIGGER fail_notification_migration BEFORE INSERT ON schema_migration WHEN NEW.version=175 BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;").unwrap();
        assert!(
            migrate(&mut db)
                .unwrap_err()
                .to_string()
                .contains("injected receipt failure")
        );
        assert!(
            db.connection
                .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
                .unwrap()
        );
        assert!(
            matches!(classify_database_contract(&db.connection).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version==124)
        );
        db.connection
            .execute_batch("DROP TRIGGER fail_notification_migration")
            .unwrap();
        migrate(&mut db).unwrap();
        let after: String = db.connection.query_row("SELECT json_group_array(json_array(o.id,o.semantic,o.source_id,o.admitted_change_sequence,d.acknowledged_at,d.satisfied_at,d.resolved_at)) FROM notification_occurrence o JOIN notification_occurrence_disposition d ON d.occurrence_id=o.id",[],|r|r.get(0)).unwrap();
        assert_eq!(before, after);
        assert_eq!(
            clock,
            db.connection
                .query_row(
                    "SELECT current_sequence FROM notification_change_clock",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap()
        );
        assert_eq!(db.connection.query_row("SELECT json_array(heads_up_enabled,turn_completed_heads_up_enabled,version,task_status_heads_up_enabled,mission_statuses_json) FROM notification_preference",[],|r|r.get::<_,String>(0)).unwrap(), "[0,0,7,0,\"[\\\"completed\\\"]\"]");
        assert!(matches!(
            classify_database_contract(&db.connection).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        drop(db);
        let reopened = Database::open(&directory).unwrap();
        assert_eq!(
            clock,
            reopened
                .connection
                .query_row(
                    "SELECT current_sequence FROM notification_change_clock",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap()
        );
        reopened
            .connection
            .execute_batch("DROP TRIGGER notification_round_publication")
            .unwrap();
        assert!(matches!(
            classify_database_contract(&reopened.connection).unwrap(),
            DatabaseContractClassification::Unknown(_)
        ));
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

// Historical fixture builders use the real pre-175 schema. Production never downgrades.
#[cfg(all(test, feature = "extended-tests"))]
fn legacy_schema_for_test() -> &'static Vec<(String, String, String)> {
    static SCHEMA: std::sync::OnceLock<Vec<(String, String, String)>> = std::sync::OnceLock::new();
    SCHEMA.get_or_init(|| {
        let path = std::env::temp_dir().join(format!("rovai-notification-source-{}", uuid::Uuid::new_v4()));
        let db = STOP_BEFORE_NOTIFICATION_MODEL_FOR_TEST.with(|flag| {
            flag.set(true); let result = Database::open(&path); flag.set(false); result.unwrap()
        });
        let rows = db.connection.prepare("SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'notification_%' AND sql IS NOT NULL").unwrap()
            .query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
        drop(db); std::fs::remove_dir_all(path).unwrap(); rows
    })
}

#[cfg(all(test, feature = "extended-tests"))]
pub(super) fn downgrade_for_test(connection: &Connection) {
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=175)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    assert_eq!(connection.query_row("SELECT count(*) FROM notification_episode WHERE kind IN ('round','single_chat','mission','task')",[],|r|r.get::<_,i64>(0)).unwrap(),0,"legacy fixture cannot discard new business attention");
    connection.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    let triggers = tx
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'notification_%'",
        )
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for name in triggers {
        tx.execute_batch(&format!("DROP TRIGGER {name}")).unwrap();
    }
    for (name, kind, sql) in legacy_schema_for_test() {
        if kind != "table"
            || ![
                "notification_episode",
                "notification_occurrence",
                "notification_change_journal",
                "notification_preference",
            ]
            .contains(&name.as_str())
        {
            continue;
        }
        rebuild_table_v171(
            &tx,
            name,
            &replacement_table_schema_v171(sql.clone(), name),
            &[
                "subject_id",
                "business_status",
                "single_chat_heads_up_enabled",
                "mission_needs_you_heads_up_enabled",
                "mission_status_heads_up_enabled",
                "task_status_heads_up_enabled",
                "mission_statuses_json",
                "task_statuses_json",
            ],
            &[],
        )
        .unwrap();
    }
    tx.execute_batch("DROP TABLE notification_round_probe; DROP TABLE notification_round; DELETE FROM schema_migration WHERE version=175; UPDATE rovai_data_contract SET contract_version='v1.70',projection_schema_version=124").unwrap();
    for (_, kind, sql) in legacy_schema_for_test() {
        if kind == "trigger" {
            tx.execute_batch(sql).unwrap();
        }
    }
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
}

#[cfg(all(test, feature = "slow-tests"))]
pub(crate) fn install_historical_fact_fixture(connection: &Connection) {
    // These tests own old fact hydration/ack/retention, not retired CampTurn admission.
    // Renamed adapters generate v8 historical facts without changing current producers.
    for (name, _, sql) in legacy_schema_for_test() {
        if name.starts_with("notification_camp_turn_terminal_") {
            connection
                .execute_batch(&sql.replacen(name, &format!("historical_fixture_{name}"), 1))
                .unwrap();
        }
    }
}
