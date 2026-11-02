//! Extend notification facts at admission; never backfill historical terminal Runs.
use super::*;

#[cfg(test)]
static PREVIOUS_SCHEMA: std::sync::OnceLock<Vec<(String, String)>> = std::sync::OnceLock::new();

fn schema(c: &Connection, name: &str) -> rusqlite::Result<String> {
    c.query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| {
        r.get(0)
    })
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(single_chat_facts::schema_matches(c)?
        && schema(c, "notification_occurrence")
            .is_ok_and(|s| s.contains("interruption_kind") && s.contains("'run_stopped'"))
        && schema(c, "notification_interruption_thread_idx").is_ok()
        && schema(c, "notification_single_chat_failure")
            .is_ok_and(|s| s.contains("interruption_kind") && s.contains("OLD.status NOT IN"))
        && schema(c, "notification_agent_run_terminal_update")
            .is_ok_and(|s| s.contains("interruption_kind") && s.contains("OLD.status NOT IN"))
        && schema(c, "notification_agent_run_terminal_insert")
            .is_ok_and(|s| s.contains("interruption_kind")))
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
            matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 158),
            "Interruption notifications require schema 158"
        );
        #[cfg(test)]
        PREVIOUS_SCHEMA.get_or_init(|| {
            tx.prepare(
                "SELECT name,sql FROM sqlite_master WHERE name IN (
                'notification_occurrence','notification_change_journal',
                'notification_agent_run_terminal_insert','notification_agent_run_terminal_update',
                'notification_single_chat_failure')",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
        });
        for table in ["notification_occurrence", "notification_change_journal"] {
            let mut target = replacement_table_schema_v171(schema(&tx, table)?, table)
                .replace("'turn_incomplete'", "'turn_incomplete', 'run_stopped'");
            if table == "notification_occurrence" {
                target = target.replace("occurred_at TEXT NOT NULL,",
                    "occurred_at TEXT NOT NULL,\n interruption_kind TEXT CHECK(
                        (semantic<>'run_stopped' OR interruption_kind IS NOT NULL)
                        AND (interruption_kind IS NULL OR (interruption_kind IN ('user_stop','app_shutdown','execution_lost')
                          AND source_type='agent_run' AND semantic IN ('run_stopped','turn_failed','turn_incomplete')))),\n");
            }
            rebuild_table_v171(&tx, table, &target, &[], &[])?;
        }
        tx.execute_batch(
            "CREATE INDEX notification_interruption_thread_idx
            ON notification_occurrence(recipient_user_id,camp_id,admitted_change_sequence)
            WHERE interruption_kind IS NOT NULL;
            DROP TRIGGER notification_agent_run_terminal_insert;
            DROP TRIGGER notification_agent_run_terminal_update;
            DROP TRIGGER notification_single_chat_failure;",
        )?;
        tx.execute_batch(&terminal_trigger(false, false, true))?;
        tx.execute_batch(&terminal_trigger(true, false, true))?;
        tx.execute_batch(&terminal_trigger(true, true, true))?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(209,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=159,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &["notification_occurrence", "notification_change_journal"],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 159
            ),
            "Interruption notification schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

/// Only the producer changes. Historical notifications and their read audit are
/// retained; legacy user_stop occurrences no longer qualify for the sidebar.
pub(super) fn exit_schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    if !schema_matches(c)? {
        return Ok(false);
    }
    for name in [
        "notification_agent_run_terminal_insert",
        "notification_agent_run_terminal_update",
        "notification_single_chat_failure",
    ] {
        if schema(c, name)?.contains("THEN 'user_stop'") {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn migrate_exit_attention(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 159),
        "App-exit attention requires schema 159"
    );
    tx.execute_batch(
        "DROP TRIGGER notification_agent_run_terminal_insert;
        DROP TRIGGER notification_agent_run_terminal_update;
        DROP TRIGGER notification_single_chat_failure;",
    )?;
    tx.execute_batch(&terminal_trigger(false, false, false))?;
    tx.execute_batch(&terminal_trigger(true, false, false))?;
    tx.execute_batch(&terminal_trigger(true, true, false))?;
    tx.execute_batch("INSERT INTO schema_migration VALUES(210,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=160,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 160
        ),
        "App-exit attention schema admission failed"
    );
    tx.commit()?;
    Ok(())
}

// Existing migration owners downgrade only synthetic fixtures. Capture the real
// schema-158 producer definitions once when the process builds its fresh template.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    shared_environment::downgrade_for_test(c);
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=209)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    assert_eq!(c.query_row("SELECT count(*) FROM notification_occurrence WHERE interruption_kind IS NOT NULL OR semantic='run_stopped'", [], |r| r.get::<_, i64>(0)).unwrap(), 0,
        "a legacy fixture cannot discard interruption facts");
    c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP INDEX notification_interruption_thread_idx;
        DROP TRIGGER notification_agent_run_terminal_insert;
        DROP TRIGGER notification_agent_run_terminal_update;
        DROP TRIGGER notification_single_chat_failure;",
    )
    .unwrap();
    let previous = PREVIOUS_SCHEMA
        .get()
        .expect("fresh database template captures the actual schema-158 source");
    for (name, sql) in previous.iter().filter(|(name, _)| {
        name == "notification_occurrence" || name == "notification_change_journal"
    }) {
        rebuild_table_v171(
            &tx,
            name,
            &replacement_table_schema_v171(sql.clone(), name),
            &["interruption_kind"],
            &[],
        )
        .unwrap();
    }
    for (name, sql) in previous {
        if name != "notification_occurrence" && name != "notification_change_journal" {
            tx.execute_batch(sql).unwrap();
        }
    }
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version IN (209,210);
        UPDATE rovai_data_contract SET projection_schema_version=158 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
}

#[cfg(all(test, feature = "slow-tests"))]
pub(super) fn assert_upgrade(db: &mut Database) {
    downgrade_for_test(db.connection());
    let before = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_interruption_receipt BEFORE INSERT ON schema_migration
        WHEN NEW.version=209 BEGIN SELECT RAISE(ABORT,'interruption receipt rollback'); END;",
        )
        .unwrap();
    assert!(
        migrate(db)
            .unwrap_err()
            .to_string()
            .contains("interruption receipt rollback")
    );
    assert!(
        !table_columns(db.connection(), "notification_occurrence")
            .unwrap()
            .contains(&"interruption_kind".into())
    );
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.connection()
        .execute_batch("DROP TRIGGER fail_interruption_receipt")
        .unwrap();
    migrate(db).unwrap();
    migrate_exit_attention(db).unwrap();
    shared_environment::migrate(db).unwrap();
    web_pasted_text::migrate(db).unwrap();
    teams::migrate(db).unwrap();
    teams::migrate_guidance_limit(db).unwrap();
    db.migrate(false).unwrap();
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
}

#[cfg(all(test, feature = "slow-tests"))]
pub(super) fn assert_exit_upgrade(db: &mut Database, run_id: &str) {
    shared_environment::downgrade_for_test(db.connection());
    let c = db.connection();
    c.execute_batch(
        "DROP TRIGGER notification_agent_run_terminal_insert;
        DROP TRIGGER notification_agent_run_terminal_update;
        DROP TRIGGER notification_single_chat_failure;",
    )
    .unwrap();
    for (update, private) in [(false, false), (true, false), (true, true)] {
        c.execute_batch(&terminal_trigger(update, private, true))
            .unwrap();
    }
    c.execute_batch(
        "DELETE FROM schema_migration WHERE version=210;
        UPDATE rovai_data_contract SET projection_schema_version=159 WHERE singleton=1;",
    )
    .unwrap();
    c.execute(
        "UPDATE agent_run SET status='cancelled',cancel_requested_at=datetime('now'),
        cancel_reason_code='user_requested_agent_run_stop',ended_at=datetime('now') WHERE id=?1",
        [run_id],
    )
    .unwrap();
    let occurrence: String = c.query_row("SELECT id FROM notification_occurrence WHERE agent_run_id=?1 AND interruption_kind='user_stop'", [run_id], |r|r.get(0)).unwrap();
    let before: i64 = c
        .query_row(
            "SELECT current_sequence FROM notification_change_clock",
            [],
            |r| r.get(0),
        )
        .unwrap();
    c.execute_batch(
        "CREATE TEMP TRIGGER fail_exit_attention BEFORE INSERT ON schema_migration
        WHEN NEW.version=210 BEGIN SELECT RAISE(ABORT,'exit attention rollback'); END;",
    )
    .unwrap();
    assert!(
        migrate_exit_attention(db)
            .unwrap_err()
            .to_string()
            .contains("exit attention rollback")
    );
    assert!(
        matches!(classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==159)
    );
    db.connection()
        .execute_batch("DROP TRIGGER fail_exit_attention")
        .unwrap();
    migrate_exit_attention(db).unwrap();
    shared_environment::migrate(db).unwrap();
    web_pasted_text::migrate(db).unwrap();
    teams::migrate(db).unwrap();
    teams::migrate_guidance_limit(db).unwrap();
    assert!(db.connection().query_row("SELECT acknowledged_at IS NULL FROM notification_occurrence_disposition WHERE occurrence_id=?1", [&occurrence], |r|r.get::<_,bool>(0)).unwrap());
    assert_eq!(
        before,
        db.connection()
            .query_row(
                "SELECT current_sequence FROM notification_change_clock",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        "upgrade must not manufacture acknowledgements or new notifications"
    );
}

// Both public and private failures retain their existing semantic. Only confirmed
// cancellation introduces run_stopped; cleanup/version changes cannot re-admit it.
fn terminal_trigger(update: bool, private: bool, legacy_user_stop: bool) -> String {
    let event = if update { "UPDATE OF status" } else { "INSERT" };
    let suffix = if update { "update" } else { "insert" };
    let name = if private {
        "notification_single_chat_failure".to_owned()
    } else {
        format!("notification_agent_run_terminal_{suffix}")
    };
    let host = if private {
        "AND NEW.invocation_kind='single_chat'"
    } else if update {
        "AND NEW.invocation_kind<>'single_chat'"
    } else {
        ""
    };
    let transition = if update {
        "AND OLD.status NOT IN ('succeeded','failed','cancelled')"
    } else {
        ""
    };
    let thread = "COALESCE(NEW.camp_id,(SELECT camp_id FROM camp_turn WHERE id=NEW.camp_turn_id),(SELECT camp_id FROM conversation WHERE id=NEW.destination_conversation_id))";
    let classification = "CASE
        WHEN NEW.cancel_reason_code IN ('app_shutdown_cancel_all','planned_shutdown_cancelled')
          OR NEW.terminal_reason_code='planned_shutdown_cancelled' THEN 'app_shutdown'
        WHEN NEW.cancel_reason_code = 'core_restarted' OR NEW.last_error_code = 'accepted_input_outcome_unknown' THEN 'execution_lost'
        WHEN NEW.status='cancelled' AND NEW.cancel_reason_code IN ('user_requested_agent_run_stop','camp_turn_cancelled') THEN 'user_stop'
        ELSE NULL END";
    let classification = if legacy_user_stop {
        classification.to_owned()
    } else {
        classification.replace("        WHEN NEW.status='cancelled' AND NEW.cancel_reason_code IN ('user_requested_agent_run_stop','camp_turn_cancelled') THEN 'user_stop'\n", "")
    };
    let semantic = "CASE WHEN NEW.status='failed' THEN 'turn_failed'
        WHEN NEW.cancel_requested_at IS NOT NULL THEN 'run_stopped' ELSE 'turn_incomplete' END";
    let key = "CASE WHEN NEW.invocation_kind='single_chat' THEN 'single_chat:local_user:' ELSE 'agent-run:local_user:' END || NEW.id";
    format!(
        r#"CREATE TRIGGER {name}
        AFTER {event} ON agent_run
        WHEN NEW.status IN ('failed', 'cancelled') {transition} {host}
          AND {thread} IS NOT NULL
          AND ((NEW.invocation_kind='batch' AND NEW.camp_turn_id IS NULL)
            OR NEW.invocation_kind='single_chat' OR ({classification}) IS NOT NULL)
          AND (NEW.status='failed' OR NEW.cancel_requested_at IS NULL OR ({classification}) IS NOT NULL)
          AND (NEW.invocation_kind<>'single_chat' OR NEW.cancel_requested_at IS NULL OR ({classification}) IS NOT NULL)
          AND NOT EXISTS(SELECT 1 FROM notification_occurrence
            WHERE source_type='agent_run' AND source_id=NEW.id
              AND semantic IN ('turn_failed','turn_incomplete','run_stopped'))
        BEGIN
          UPDATE notification_change_clock SET current_sequence=current_sequence+1 WHERE singleton=1;
          INSERT INTO notification_episode(id,aggregation_key,recipient_user_id,kind,camp_id,
            agent_run_id,subject_id,version,attention_revision,created_change_sequence,last_change_sequence,sort_at,created_at,updated_at)
          SELECT lower(hex(randomblob(16))),{key},'local_user',
            CASE WHEN NEW.invocation_kind='single_chat' THEN 'single_chat' ELSE 'collaboration' END,
            {thread},NEW.id,CASE WHEN NEW.invocation_kind='single_chat' THEN NEW.id ELSE NULL END,
            0,0,current_sequence,current_sequence,COALESCE(NEW.ended_at,NEW.updated_at),
            COALESCE(NEW.ended_at,NEW.updated_at),COALESCE(NEW.ended_at,NEW.updated_at)
          FROM notification_change_clock WHERE singleton=1 ON CONFLICT(aggregation_key) DO NOTHING;
          INSERT INTO notification_occurrence(id,episode_id,recipient_user_id,semantic,
            source_type,source_id,source_revision,camp_id,agent_run_id,interruption_kind,
            admitted_episode_version,admitted_attention_revision,admitted_change_sequence,occurred_at)
          SELECT lower(hex(randomblob(16))),e.id,'local_user',{semantic},'agent_run',NEW.id,1,
            {thread},NEW.id,{classification},e.version+1,e.attention_revision+1,c.current_sequence,
            COALESCE(NEW.ended_at,NEW.updated_at)
          FROM notification_episode e JOIN notification_change_clock c ON c.singleton=1
          WHERE e.aggregation_key={key};
        END;"#
    )
}
