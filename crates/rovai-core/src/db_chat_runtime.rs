//! Extend the existing manifest, cleanup journal, and member-creation receipts with private owners.
use super::*;

const MANIFEST: &[(&str, &str)] = &[
    ("14, 15, 16))", "14, 15, 16, 17))"),
    ("42, 43, 44, 45))", "42, 43, 44, 45, 46))"),
    ("12, 13, 14))", "12, 13, 14, 15))"),
    (
        "(context_manifest_version = 44 AND formatter_version = 44",
        "(context_manifest_version = 46 AND formatter_version = 46 AND run_facts_schema_version = 15 AND context_delivery_profile_version = 17 AND camp_attachment_view_receipt_version IS NULL) OR (context_manifest_version = 44 AND formatter_version = 44",
    ),
];
const JOURNAL: &[(&str, &str)] = &[
    ("camp_id TEXT NOT NULL,", "camp_id TEXT, chat_id TEXT,"),
    (
        "'controlled_rebuild','camp_delete_cleanup'",
        "'controlled_rebuild','camp_delete_cleanup','chat_delete_cleanup'",
    ),
    (
        "(kind = 'camp_delete_cleanup'",
        "(kind='chat_delete_cleanup' AND camp_id IS NULL AND chat_id IS NOT NULL AND cleanup_root_relative_path IS NOT NULL AND previous_view_state IS NULL) OR (kind = 'camp_delete_cleanup' AND camp_id IS NOT NULL AND chat_id IS NULL",
    ),
    (
        "(kind <> 'camp_delete_cleanup'",
        "(kind NOT IN ('camp_delete_cleanup','chat_delete_cleanup') AND camp_id IS NOT NULL AND chat_id IS NULL",
    ),
];
const MEMBER: &[(&str, &str)] = &[
    (
        "camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,",
        "camp_id TEXT REFERENCES camp(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,",
    ),
    (
        "created_at TEXT NOT NULL",
        "created_at TEXT NOT NULL, CHECK ((camp_id IS NULL) <> (conversation_id IS NULL))",
    ),
];

const TASK: &[(&str, &str)] = &[
    (
        "source_agent_run_id TEXT REFERENCES agent_run(id),",
        "source_agent_run_id TEXT REFERENCES agent_run(id), chat_source_deleted INTEGER NOT NULL DEFAULT 0 CHECK(chat_source_deleted IN (0,1)),",
    ),
    (
        "closed_by_agent_run_id TEXT REFERENCES agent_run(id),",
        "closed_by_agent_run_id TEXT REFERENCES agent_run(id), chat_closer_deleted INTEGER NOT NULL DEFAULT 0 CHECK(chat_closer_deleted IN (0,1)),",
    ),
    (
        "created_by_type = 'agent' AND source_agent_run_id IS NOT NULL",
        "created_by_type = 'agent' AND ((source_agent_run_id IS NOT NULL AND chat_source_deleted=0) OR (source_agent_run_id IS NULL AND chat_source_deleted=1))",
    ),
    (
        "closed_by_type = 'agent' AND closed_by_agent_run_id IS NOT NULL",
        "closed_by_type = 'agent' AND ((closed_by_agent_run_id IS NOT NULL AND chat_closer_deleted=0) OR (closed_by_agent_run_id IS NULL AND chat_closer_deleted=1))",
    ),
];

fn rewrite(
    tx: &Transaction<'_>,
    kind: &str,
    name: &str,
    replacements: &[(&str, &str)],
    up: bool,
) -> Result<String> {
    let mut sql: String = tx.query_row(
        "SELECT sql FROM sqlite_schema WHERE type=?1 AND name=?2",
        [kind, name],
        |r| r.get(0),
    )?;
    for &(old, new) in replacements {
        let (from, to) = if up { (old, new) } else { (new, old) };
        anyhow::ensure!(
            sql.contains(from),
            "Unexpected {kind} {name} before private-chat migration: {from}"
        );
        sql = sql.replace(from, to);
    }
    Ok(sql)
}

const CONTEXT_GUARD: &str = "WHEN NOT ((NEW.source_chat_input_id IS NULL AND NOT EXISTS(SELECT 1 FROM agent_run WHERE id=NEW.agent_run_id AND invocation_kind='chat')) OR
    (NEW.context_manifest_version=46 AND NEW.source_delivery_id IS NULL AND EXISTS(
        SELECT 1 FROM agent_run r JOIN chat_topic t ON t.conversation_id=r.conversation_id
        WHERE r.id=NEW.agent_run_id AND r.invocation_kind='chat' AND r.status IN ('running','waiting')
          AND r.cancel_requested_at IS NULL AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL
          AND (NEW.source_chat_input_id IS NULL OR EXISTS(SELECT 1 FROM single_chat_pending_input p
              WHERE p.id=NEW.source_chat_input_id AND p.conversation_id=r.conversation_id AND p.target_run_id=r.id
                AND p.target_execution_epoch=r.execution_epoch AND p.requested_mode='steer' AND p.state='queued')))))
    OR (NEW.context_manifest_version<>46 AND NOT (";
const DELIVERY_GUARD: &str = "OR (m.source_chat_input_id IS NOT NULL AND NEW.input_kind='steer' AND NEW.input_sequence>0 AND EXISTS(
    SELECT 1 FROM single_chat_pending_input p WHERE p.id=m.source_chat_input_id AND p.target_run_id=NEW.agent_run_id
      AND p.target_execution_epoch=NEW.execution_epoch AND p.requested_mode='steer' AND p.state='queued'))
    OR (m.source_delivery_id IS NOT NULL AND NEW.input_kind='steer'";

fn schema(tx: &Transaction<'_>, up: bool) -> Result<()> {
    // Restore dependent triggers before dropping the private source column on test downgrades.
    if up {
        tx.execute_batch("ALTER TABLE context_manifest ADD COLUMN source_chat_input_id TEXT REFERENCES single_chat_pending_input(id);
            CREATE UNIQUE INDEX context_manifest_chat_input ON context_manifest(source_chat_input_id) WHERE source_chat_input_id IS NOT NULL;")?;
    }
    if !up {
        tx.execute_batch("DROP TRIGGER chat_memory_revision_source; DROP TRIGGER chat_hearth_review_item_source; DROP TRIGGER chat_memory_access_source; DROP TRIGGER chat_task_source_insert; DROP TRIGGER chat_task_creator_delete; DROP TRIGGER chat_task_closer_delete;")?;
    }
    for (name, fields, extra) in [
        (
            "memory_access_evidence",
            &[("camp_id TEXT NOT NULL,", "camp_id TEXT,")][..],
            &[][..],
        ),
        (
            "hearth_review_item",
            &[("source_camp_id TEXT NOT NULL,", "source_camp_id TEXT,")][..],
            &[][..],
        ),
        (
            "memory_revision",
            &[(
                "AND source_camp_id IS NOT NULL",
                "AND (source_camp_id IS NULL OR length(source_camp_id)>0)",
            )][..],
            &[][..],
        ),
        (
            "task",
            TASK,
            &["chat_source_deleted", "chat_closer_deleted"][..],
        ),
        ("context_manifest", MANIFEST, &[][..]),
        ("camp_attachment_view_operation", JOURNAL, &["chat_id"][..]),
        ("member_creation", MEMBER, &["conversation_id"][..]),
    ] {
        let ddl = rewrite(tx, "table", name, fields, up)?;
        rebuild_table_v171(
            tx,
            name,
            &replacement_table_schema_v171(ddl, name),
            if up { &[] } else { extra },
            &[],
        )?;
    }
    for (kind, name, fields) in [
        (
            "INDEX",
            "context_manifest_initial_run",
            &[(
                "WHERE source_delivery_id IS NULL",
                "WHERE source_delivery_id IS NULL AND source_chat_input_id IS NULL",
            )][..],
        ),
        (
            "TRIGGER",
            "context_manifest_source_immutable",
            &[(
                "UPDATE OF source_delivery_id",
                "UPDATE OF source_delivery_id, source_chat_input_id",
            )][..],
        ),
        (
            "TRIGGER",
            "context_manifest_v40_only_insert",
            &[
                ("WHEN NOT (", CONTEXT_GUARD),
                (")) BEGIN SELECT RAISE", "))) BEGIN SELECT RAISE"),
            ][..],
        ),
        (
            "TRIGGER",
            "context_manifest_quote_profile_insert",
            &[(
                "WHEN NOT (",
                "WHEN NOT ((NEW.context_manifest_version=46 AND NEW.context_delivery_profile_version=17) OR ",
            )][..],
        ),
        (
            "TRIGGER",
            "runtime_input_delivery_attachment_auth_insert",
            &[("43, 44, 45)", "43, 44, 45, 46)")][..],
        ),
        (
            "TRIGGER",
            "runtime_input_source_insert",
            &[
                (
                    "m.source_delivery_id IS NULL AND NEW.input_kind='start'",
                    "m.source_delivery_id IS NULL AND m.source_chat_input_id IS NULL AND NEW.input_kind='start'",
                ),
                (
                    "OR (m.source_delivery_id IS NOT NULL AND NEW.input_kind='steer'",
                    DELIVERY_GUARD,
                ),
            ][..],
        ),
    ] {
        let ddl = rewrite(tx, &kind.to_ascii_lowercase(), name, fields, up)?;
        tx.execute_batch(&format!("DROP {kind} {name}; {ddl};"))?;
    }
    if up {
        tx.execute_batch("CREATE TRIGGER chat_task_source_insert BEFORE INSERT ON task WHEN NEW.chat_source_deleted<>0 OR NEW.chat_closer_deleted<>0 BEGIN SELECT RAISE(ABORT,'a new task requires a live source'); END;")?;
        install_memory_source_guards(tx)?;
        tx.execute_batch("CREATE TRIGGER chat_memory_access_source BEFORE INSERT ON memory_access_evidence
            WHEN NEW.camp_id IS NULL AND NOT EXISTS(SELECT 1 FROM conversation c JOIN chat_topic t ON t.conversation_id=c.id
                WHERE c.agent_id=NEW.agent_id AND c.native_binding_id=NEW.native_binding_id AND c.native_binding_generation=NEW.native_binding_generation)
            BEGIN SELECT RAISE(ABORT,'private memory access requires the acting chat binding'); END;")?;
        for (label, column, flag) in [
            ("creator", "source_agent_run_id", "chat_source_deleted"),
            ("closer", "closed_by_agent_run_id", "chat_closer_deleted"),
        ] {
            tx.execute_batch(&format!("CREATE TRIGGER chat_task_{label}_delete BEFORE UPDATE OF {flag},{column} ON task
              WHEN OLD.{flag}<>NEW.{flag} AND NOT(OLD.{flag}=0 AND NEW.{flag}=1 AND NEW.{column} IS NULL
               AND EXISTS(SELECT 1 FROM agent_run r JOIN chat_topic t ON t.conversation_id=r.conversation_id WHERE r.id=OLD.{column} AND r.invocation_kind='chat' AND t.deletion_operation_id IS NOT NULL))
              BEGIN SELECT RAISE(ABORT,'only chat deletion may detach a task source'); END;"))?;
        }
    }
    if !up {
        tx.execute_batch("DROP INDEX context_manifest_chat_input; ALTER TABLE context_manifest DROP COLUMN source_chat_input_id;")?;
    }
    Ok(())
}

fn install_memory_source_guards(tx: &Transaction<'_>) -> Result<()> {
    for (table, actor, applies) in [
        ("memory_revision", "actor_id", "NEW.actor_kind='agent'"),
        ("hearth_review_item", "source_agent_id", "1"),
    ] {
        tx.execute_batch(&format!(
            "DROP TRIGGER IF EXISTS chat_{table}_source;
            CREATE TRIGGER chat_{table}_source BEFORE INSERT ON {table}
            WHEN {applies} AND NEW.source_camp_id IS NULL AND NOT EXISTS(
                SELECT 1 FROM agent_run r JOIN conversation c ON c.id=r.conversation_id
                WHERE r.id=NEW.source_agent_run_id AND c.agent_id=NEW.{actor}
                  AND r.invocation_kind='chat' AND r.execution_epoch=NEW.source_execution_epoch)
            BEGIN SELECT RAISE(ABORT,'private memory requires the acting chat run'); END;"
        ))?;
    }
    Ok(())
}

pub(super) fn repair_chat_runtime(db: &mut Database) -> Result<()> {
    let tx = db
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    install_memory_source_guards(&tx)?;
    // 235 could cancel a still-unsent supplement on restart or leave it attached to a finished turn.
    tx.execute("UPDATE single_chat_pending_input SET state='queued' WHERE requested_mode='steer' AND state='cancelled'
        AND target_run_id IN (SELECT r.id FROM agent_run r JOIN chat_topic t ON t.conversation_id=r.conversation_id
            WHERE r.status='cancelled' AND r.cancel_reason_code='core_restarted' AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL)", [])?;
    let runs = tx.prepare("SELECT DISTINCT r.id,r.status FROM single_chat_pending_input p JOIN agent_run r ON r.id=p.target_run_id
        WHERE p.requested_mode='steer' AND p.state='queued' AND (r.status='succeeded' OR (r.status='cancelled' AND r.cancel_reason_code='core_restarted'))")?
        .query_map([], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let now = chrono::Utc::now().to_rfc3339();
    for (run, status) in runs {
        crate::steer::settle_execution(&tx, &run, &status, &now)?;
    }
    tx.execute_batch("INSERT INTO schema_migration VALUES(236,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=186,updated_at=datetime('now') WHERE singleton=1;")?;
    tx.commit()?;
    Ok(())
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='context_manifest_chat_input') AND
        EXISTS(SELECT 1 FROM pragma_table_info('camp_attachment_view_operation') WHERE name='chat_id')",[],|r| r.get(0))
}

pub(super) fn migrate(db: &mut Database) -> Result<()> {
    db.connection.execute_batch("PRAGMA foreign_keys=OFF")?;
    let result = (|| -> Result<()> {
        let tx = db
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        schema(&tx, true)?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "camp_attachment_view_operation",
                "member_creation",
                "task",
                "memory_revision",
                "hearth_review_item",
                "memory_access_evidence",
            ],
        )?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(235,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=185,updated_at=datetime('now') WHERE singleton=1;")?;
        tx.commit()?;
        Ok(())
    })();
    let restored = db.connection.execute_batch("PRAGMA foreign_keys=ON");
    result?;
    restored?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    if !schema_matches(c).unwrap() {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    schema(&tx, false).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version IN (235,236); UPDATE rovai_data_contract SET projection_schema_version=184 WHERE projection_schema_version IN (185,186);").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
}
