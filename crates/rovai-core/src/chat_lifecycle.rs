use super::*;
use crate::{
    camp_attachment_view::{directory_identity_digest, reject_existing_symlink_components},
    runtime::settle_abortive_agent_run_in_tx,
    storage_layout::chat_directory,
};
use anyhow::Context;
use serde_json::Value;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetArchived {
    pub chat_id: String,
    pub archived: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteChat {
    pub chat_id: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopChat {
    pub chat_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub expected_version: i64,
}

macro_rules! chat_command {
    ($ty:ty,$name:literal) => {
        impl sealed::Sealed for $ty {}
        impl DomainCommand for $ty {
            const TYPE: &'static str = $name;
            fn matches_replay(&self, stored: &Value) -> Result<bool> {
                Ok(stored["request"] == serde_json::to_value(self)?)
            }
        }
    };
}
chat_command!(SetArchived, "chat.set_archived");
chat_command!(DeleteChat, "chat.delete");
chat_command!(StopChat, "chat.stop");

fn topic(tx: &Transaction<'_>, id: &str, actor: &ActorRef) -> Result<(bool, Option<String>)> {
    ensure!(
        matches!(actor, ActorRef::User { user_id } if user_id == CURRENT_USER_ID),
        "chat.user_required"
    );
    tx.query_row(
        "SELECT archived_at IS NOT NULL, deletion_operation_id FROM chat_topic
         WHERE conversation_id = ?1 AND owner_user_id = ?2",
        params![id, CURRENT_USER_ID],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()?
    .context("chat.unavailable")
}

pub(crate) fn stop(
    db: &mut Database,
    envelope: &CommandEnvelope<StopChat>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(db, envelope, |tx| {
        let command = &envelope.payload;
        let (archived, deletion) = topic(tx, &command.chat_id, &envelope.actor)?;
        ensure!(!archived && deletion.is_none(), "chat.unavailable");
        let current: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_run WHERE id = ?1 AND conversation_id = ?2
               AND invocation_kind = 'chat' AND execution_epoch = ?3 AND version = ?4
               AND status IN ('queued','running','waiting'))",
            params![
                command.agent_run_id,
                command.chat_id,
                command.execution_epoch,
                command.expected_version
            ],
            |row| row.get(0),
        )?;
        ensure!(current, "chat.execution_changed");
        settle_abortive_agent_run_in_tx(
            tx,
            &command.agent_run_id,
            "user_cancelled",
            &envelope.actor,
            &chrono::Utc::now().to_rfc3339(),
        )?;
        Ok(CommandHandlerResult::applied(
            "chat.stopped",
            json!({"chatId":command.chat_id,"request":command}),
            None,
        ))
    })
}

fn cancel_active_run(
    tx: &Transaction<'_>,
    chat_id: &str,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    let run: Option<String> = tx
        .query_row(
            "SELECT id FROM agent_run WHERE conversation_id = ?1
             AND status IN ('queued','running','waiting')",
            [chat_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(run) = run {
        settle_abortive_agent_run_in_tx(tx, &run, "chat_archived", actor, now)?;
    }
    Ok(())
}

pub(crate) fn set_archived(
    db: &mut Database,
    envelope: &CommandEnvelope<SetArchived>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(db, envelope, |tx| {
        let command = &envelope.payload;
        let (archived, deletion) = topic(tx, &command.chat_id, &envelope.actor)?;
        ensure!(deletion.is_none(), "chat.unavailable");
        if archived != command.archived {
            let now = chrono::Utc::now().to_rfc3339();
            if command.archived {
                cancel_active_run(tx, &command.chat_id, &envelope.actor, &now)?;
            }
            tx.execute(
                "UPDATE chat_topic SET archived_at = ?2, version = version+1 WHERE conversation_id = ?1",
                params![command.chat_id, command.archived.then_some(&now)],
            )?;
        }
        Ok(CommandHandlerResult::applied("chat.archive_changed", json!({"chatId":command.chat_id,"request":command}), None))
    })
}

pub(crate) fn request_delete(
    db: &mut Database,
    e: &CommandEnvelope<DeleteChat>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(db, e, |tx| {
        let c = &e.payload;
        let (archived, existing) = topic(tx, &c.chat_id, &e.actor)?;
        let now = chrono::Utc::now().to_rfc3339();
        if !archived {
            cancel_active_run(tx, &c.chat_id, &e.actor, &now)?;
        }
        let op = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        tx.execute(
            "UPDATE chat_topic SET deletion_operation_id=?2, archived_at=coalesce(archived_at,?3),
                version=version+1 WHERE conversation_id=?1 AND deletion_operation_id IS NULL",
            params![c.chat_id, op, now],
        )?;
        Ok(CommandHandlerResult::applied(
            "chat.deletion_accepted",
            json!({"chatId":c.chat_id,"operationId":op,"request":c}),
            None,
        ))
    })
}

pub(crate) struct ChatDirectoryCleanup {
    pub operation_id: String,
    root: std::path::PathBuf,
    chat_id: String,
    relative: String,
    identity: Option<String>,
}

pub(crate) fn prepare_deletions(db: &mut Database) -> Result<Vec<ChatDirectoryCleanup>> {
    let root = db.runtime_camp_files_root().to_owned();
    let ready = db.connection().prepare_cached(
        "SELECT conversation_id, deletion_operation_id FROM chat_topic
         WHERE deletion_operation_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM agent_run r WHERE r.conversation_id = chat_topic.conversation_id
             AND (r.status IN ('queued','running','waiting') OR
                  (r.execution_epoch > 0 AND r.cancel_requested_at IS NOT NULL AND r.cancel_acknowledged_at IS NULL)))"
    )?.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    for (chat, op) in ready {
        if let Err(error) = delete_rows(db, &root, &chat, &op) {
            eprintln!("chat deletion {op} remains pending: {error:#}");
        }
    }
    let mut statement = db.connection().prepare_cached(
        "SELECT id, chat_id, cleanup_root_relative_path, cleanup_root_identity_digest
         FROM camp_attachment_view_operation WHERE kind = 'chat_delete_cleanup' AND status = 'committed'"
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok(ChatDirectoryCleanup {
                operation_id: row.get(0)?,
                root: root.clone(),
                chat_id: row.get(1)?,
                relative: row.get(2)?,
                identity: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
}

fn delete_rows(db: &mut Database, root: &std::path::Path, chat: &str, op: &str) -> Result<()> {
    let dir = chat_directory(root, chat)?;
    reject_existing_symlink_components(&dir)?;
    let identity = match std::fs::symlink_metadata(&dir) {
        Ok(meta) => {
            ensure!(meta.is_dir(), "chat.directory_changed");
            Some(directory_identity_digest(&dir)?)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let tx = db
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_topic WHERE conversation_id=?1 AND deletion_operation_id=?2)",params![chat,op],|r|r.get::<_,bool>(0))? {return Ok(());}
    tx.execute_batch("PRAGMA defer_foreign_keys=ON")?;
    tx.execute("INSERT INTO camp_attachment_view_operation(id,kind,chat_id,status,command_id,reserved_bytes,cleanup_root_relative_path,cleanup_root_identity_digest,created_at,updated_at) VALUES(?1,'chat_delete_cleanup',?2,'committed',?1,0,?2,?3,datetime('now'),datetime('now'))",params![op,chat,identity])?;
    let now = chrono::Utc::now().to_rfc3339();
    for id in crate::managed_blob::chat_blob_references(&tx, &chat)? {
        crate::managed_blob::detach_gc_candidate(
            &tx,
            &id,
            crate::managed_blob::GC_OWNER_EXECUTION_LIFECYCLE,
            &now,
        )?;
    }
    // Keep only the replay key and digest of consumed sends. A delayed retry cannot resurrect a deleted draft.
    tx.execute("UPDATE event_log SET result_status='rejected',result_code='chat.deleted',
            result_payload_json=json_object('inputDigest',json_extract(result_payload_json,'$.inputDigest'),'deleted',json('true')),
            payload_json='{}' WHERE command_type IN ('chat.send','chat.pending_input_edit') AND result_entity_type='chat' AND result_entity_id=?1",[&chat])?;
    tx.execute("DELETE FROM event_log WHERE camp_id IS NULL AND coalesce(command_type,'') NOT IN ('chat.send','chat.pending_input_edit','chat.delete')
          AND (entity_id=?1 OR result_entity_id=?1 OR json_extract(result_payload_json,'$.chatId')=?1
            OR source_agent_run_id IN (SELECT id FROM agent_run WHERE conversation_id=?1)
            OR json_extract(result_payload_json,'$.chatComposer')='chat:'||?1
            OR entity_id IN (SELECT a.id FROM approval a JOIN action_execution e ON e.id=a.action_id JOIN agent_run r ON r.id=e.agent_run_id WHERE r.conversation_id=?1)
            OR entity_id IN (SELECT e.id FROM action_execution e JOIN agent_run r ON r.id=e.agent_run_id WHERE r.conversation_id=?1)
            OR entity_id IN (SELECT id FROM agent_run WHERE conversation_id=?1)
            OR result_entity_id IN (SELECT id FROM agent_run WHERE conversation_id=?1))",[&chat])?;
    tx.execute("DELETE FROM memory_access_evidence WHERE native_binding_id IN
            (SELECT native_binding_id FROM conversation WHERE id=?1 UNION SELECT native_binding_id FROM native_session_bootstrap_evidence WHERE conversation_id=?1)",[&chat])?;
    tx.execute("DELETE FROM approval WHERE action_id IN (SELECT id FROM action_execution WHERE agent_run_id IN (SELECT id FROM agent_run WHERE conversation_id=?1))",[chat])?;
    tx.execute("DELETE FROM action_attempt WHERE action_id IN (SELECT id FROM action_execution WHERE agent_run_id IN (SELECT id FROM agent_run WHERE conversation_id=?1))",[&chat])?;
    for (column, flag) in [
        ("source_agent_run_id", "chat_source_deleted"),
        ("closed_by_agent_run_id", "chat_closer_deleted"),
    ] {
        tx.execute(&format!("UPDATE task SET {flag}=1,{column}=NULL WHERE {column} IN (SELECT id FROM agent_run WHERE conversation_id=?1)"),[&chat])?;
    }
    for table in [
        "agent_run_execution_evidence",
        "action_execution",
        "runtime_delivery_checkpoint",
        "runtime_input_delivery",
        "context_manifest",
    ] {
        tx.execute(&format!("DELETE FROM {table} WHERE agent_run_id IN (SELECT id FROM agent_run WHERE conversation_id=?1)"),[&chat])?;
    }
    tx.execute("DELETE FROM message_attachment WHERE conversation_message_id IN (SELECT id FROM conversation_message WHERE conversation_id=?1)",[&chat])?;
    for table in [
        "single_chat_pending_input",
        "conversation_message",
        "native_session_bootstrap_evidence",
        "agent_run",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE conversation_id=?1"),
            [&chat],
        )?;
    }
    tx.execute("DELETE FROM conversation WHERE id=?1", [&chat])?;
    tx.commit()?;
    Ok(())
}

impl ChatDirectoryCleanup {
    pub(crate) fn remove_directory(&self) -> Result<()> {
        ensure!(self.relative == self.chat_id, "chat.directory_changed");
        let path = chat_directory(&self.root, &self.chat_id)?;
        reject_existing_symlink_components(&path)?;
        match std::fs::symlink_metadata(&path) {
            Ok(_) => {
                ensure!(
                    self.identity.as_deref() == Some(directory_identity_digest(&path)?.as_str()),
                    "chat.directory_changed"
                );
                std::fs::remove_dir_all(&path)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }
}

pub(crate) fn complete_directory_cleanup(db: &Database, operation_id: &str) -> Result<()> {
    db.connection().execute("UPDATE camp_attachment_view_operation SET status='completed',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?1 AND kind='chat_delete_cleanup' AND status='committed'",[operation_id])?;
    Ok(())
}
