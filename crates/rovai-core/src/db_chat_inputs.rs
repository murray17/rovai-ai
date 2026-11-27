use super::*;

const RUN_SCOPE: &[(&str, &str)] = &[
    ("'gather_completion', 'single_chat', 'batch')", "'gather_completion', 'single_chat', 'batch', 'chat')"),
    ("operation_policy IN ('camp_member_v1', 'single_chat_v1')", "operation_policy IN ('camp_member_v1', 'single_chat_v1', 'chat_v1')"),
    ("(invocation_kind <> 'single_chat'\n", "(invocation_kind = 'chat' AND camp_id IS NULL AND camp_turn_id IS NULL
                        AND trigger_conversation_message_id IS NOT NULL AND response_delivery = 'conversation_message'
                        AND destination_conversation_id IS NOT NULL AND destination_conversation_id = conversation_id
                        AND operation_policy = 'chat_v1' AND operation_policy_version = 1)
                    OR
                    (invocation_kind NOT IN ('single_chat', 'chat')\n"),
];
const QUEUE_SCOPE: &[(&str, &str)] = &[(
    "CHECK((state = 'published') = (published_camp_turn_id IS NOT NULL))",
    "CHECK(published_camp_turn_id IS NULL OR state = 'published')",
)];
const SCOPE_TRIGGERS: &[(&str, &str, &str)] = &[
    (
        "single_chat_pending_input_scope_insert",
        "conversation.kind = 'single_chat'",
        "(conversation.kind = 'single_chat' OR (conversation.kind = 'chat' AND EXISTS (SELECT 1 FROM chat_topic t WHERE t.conversation_id=conversation.id AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL)))",
    ),
    (
        "conversation_message_single_chat_attachment_insert_guard",
        "conversation.kind = 'single_chat'",
        "conversation.kind IN ('single_chat','chat')",
    ),
    (
        "conversation_message_single_chat_attachment_update_guard",
        "conversation.kind = 'single_chat'",
        "conversation.kind IN ('single_chat','chat')",
    ),
    (
        "agent_run_single_chat_route_update_guard",
        "(OLD.invocation_kind = 'single_chat' OR NEW.invocation_kind = 'single_chat')",
        "(OLD.invocation_kind IN ('single_chat','chat') OR NEW.invocation_kind IN ('single_chat','chat'))",
    ),
];

fn change_sql(sql: &mut String, old: &str, new: &str, upgrade: bool) -> Result<()> {
    let (from, to) = if upgrade { (old, new) } else { (new, old) };
    anyhow::ensure!(
        sql.matches(from).count() == 1,
        "Unexpected chat migration source: {from}"
    );
    *sql = sql.replacen(from, to, 1);
    Ok(())
}

fn rebuild_scope(tx: &Transaction<'_>, upgrade: bool) -> Result<()> {
    for (table, replacements) in [
        ("agent_run", RUN_SCOPE),
        ("single_chat_pending_input", QUEUE_SCOPE),
    ] {
        let mut ddl: String = tx.query_row(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
            [table],
            |r| r.get(0),
        )?;
        for &(old, new) in replacements {
            change_sql(&mut ddl, old, new, upgrade)?;
        }
        rebuild_table_v171(
            tx,
            table,
            &replacement_table_schema_v171(ddl, table),
            &[],
            &[],
        )?;
    }
    for &(name, old, new) in SCOPE_TRIGGERS {
        let mut ddl: String = tx.query_row(
            "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?1",
            [name],
            |r| r.get(0),
        )?;
        change_sql(&mut ddl, old, new, upgrade)?;
        tx.execute_batch(&format!("DROP TRIGGER {name}; {ddl};"))?;
    }
    Ok(())
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='chat_active_run') AND
        EXISTS(SELECT 1 FROM pragma_table_info('single_chat_pending_input') WHERE name='target_execution_epoch') AND
        EXISTS(SELECT 1 FROM sqlite_schema WHERE name='chat_queue_scope_update')",[],|r|r.get(0))
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?,DatabaseContractClassification::SupportedMigrationSource(m) if m.projection_schema_version == 183),
            "Chat inputs require schema 183"
        );
        rebuild_scope(&tx, true)?;
        tx.execute_batch("ALTER TABLE conversation_message ADD COLUMN chat_skills_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(chat_skills_json) AND json_type(chat_skills_json)='array');
          ALTER TABLE single_chat_pending_input ADD COLUMN chat_skills_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(chat_skills_json) AND json_type(chat_skills_json)='array');
          ALTER TABLE single_chat_pending_input ADD COLUMN requested_mode TEXT NOT NULL DEFAULT 'start' CHECK(requested_mode IN ('start','steer'));
          ALTER TABLE single_chat_pending_input ADD COLUMN target_run_id TEXT REFERENCES agent_run(id);
          ALTER TABLE single_chat_pending_input ADD COLUMN target_execution_epoch INTEGER;
          CREATE UNIQUE INDEX chat_active_run ON agent_run(conversation_id) WHERE invocation_kind='chat' AND status IN ('queued','running','waiting');
          CREATE TRIGGER chat_run_scope_insert BEFORE INSERT ON agent_run
            WHEN (NEW.invocation_kind='chat') <> EXISTS(SELECT 1 FROM conversation c WHERE c.id=NEW.conversation_id AND c.kind='chat')
            BEGIN SELECT RAISE(ABORT,'chat Run requires its own chat Conversation'); END;")?;
        for (name, event) in [
            ("chat_queue_scope_insert", "INSERT"),
            ("chat_queue_scope_update", "UPDATE"),
        ] {
            tx.execute_batch(&format!("CREATE TRIGGER {name} BEFORE {event} ON single_chat_pending_input WHEN
                (NEW.target_run_id IS NULL) <> (NEW.target_execution_epoch IS NULL)
                OR (NEW.requested_mode='steer' AND NEW.target_run_id IS NULL)
                OR (NEW.target_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_run r WHERE r.id=NEW.target_run_id AND r.conversation_id=NEW.conversation_id AND r.invocation_kind='chat' AND NEW.target_execution_epoch>=1))
                OR (NEW.state='published' AND NOT EXISTS(SELECT 1 FROM conversation c
                  JOIN conversation_message m ON m.id=NEW.published_conversation_message_id AND m.conversation_id=c.id
                  JOIN agent_run r ON r.id=NEW.published_agent_run_id AND r.conversation_id=c.id
                  WHERE c.id=NEW.conversation_id AND ((c.kind='single_chat' AND NEW.published_camp_turn_id IS NOT NULL AND r.camp_turn_id=NEW.published_camp_turn_id)
                    OR (c.kind='chat' AND NEW.published_camp_turn_id IS NULL AND r.camp_turn_id IS NULL AND r.invocation_kind='chat'))))
                BEGIN SELECT RAISE(ABORT,'pending input source or publication does not match its Conversation'); END;"))?;
        }
        validate_migration_foreign_keys(
            &tx,
            &[
                "agent_run",
                "conversation_message",
                "single_chat_pending_input",
            ],
        )?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(234,datetime('now'));
          UPDATE rovai_data_contract SET projection_schema_version=184,updated_at=datetime('now') WHERE singleton=1;")?;
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON");
    result?;
    restored?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    super::chat_runtime::downgrade_for_test(c);
    if !schema_matches(c).unwrap() {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER chat_queue_scope_update; DROP TRIGGER chat_queue_scope_insert;
      DROP TRIGGER chat_run_scope_insert; DROP INDEX chat_active_run;
      ALTER TABLE single_chat_pending_input DROP COLUMN target_execution_epoch;
      ALTER TABLE single_chat_pending_input DROP COLUMN target_run_id;
      ALTER TABLE single_chat_pending_input DROP COLUMN requested_mode;
      ALTER TABLE single_chat_pending_input DROP COLUMN chat_skills_json;
      ALTER TABLE conversation_message DROP COLUMN chat_skills_json;",
    )
    .unwrap();
    rebuild_scope(&tx, false).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=234;
        UPDATE rovai_data_contract SET projection_schema_version=183 WHERE projection_schema_version=184;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
}
