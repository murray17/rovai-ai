use anyhow::Result;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    collaboration::append_domain_event,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChangeArchiveCommand<const ARCHIVE: bool> {
    #[serde(
        rename = "threadId",
        deserialize_with = "crate::camp_id::deserialize_camp_id_string"
    )]
    pub camp_id: String,
    pub expected_archive_revision: i64,
}

impl<const ARCHIVE: bool> sealed::Sealed for ChangeArchiveCommand<ARCHIVE> {}
impl<const ARCHIVE: bool> DomainCommand for ChangeArchiveCommand<ARCHIVE> {
    const TYPE: &'static str = if ARCHIVE {
        "camp.archive"
    } else {
        "camp.unarchive"
    };
}

pub(crate) type ArchiveThreadCommand = ChangeArchiveCommand<true>;
pub(crate) type UnarchiveThreadCommand = ChangeArchiveCommand<false>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveGuard {
    pub expected_archive_revision: i64,
}

pub(crate) fn change<const ARCHIVE: bool>(
    database: &mut Database,
    envelope: &CommandEnvelope<ChangeArchiveCommand<ARCHIVE>>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |transaction| {
        if !matches!(envelope.actor, ActorRef::User { .. }) {
            return Ok(CommandHandlerResult::rejected("camp.archive_user_required", json!({})));
        }
        let id = &envelope.payload.camp_id;
        let row = transaction.query_row(
            "SELECT activation_state, archived_at, archive_revision FROM camp WHERE id = ?1",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?)),
        ).optional()?;
        let Some((activation, mut archived_at, mut revision)) = row else {
            return Ok(CommandHandlerResult::rejected("camp.not_found", json!({"threadId": id})));
        };
        if activation != "active" {
            return Ok(CommandHandlerResult::rejected("camp.archive_requires_active", json!({"threadId": id})));
        }
        if revision != envelope.payload.expected_archive_revision {
            return Ok(conflict(id, archived_at.as_deref(), revision));
        }
        let changed = ARCHIVE != archived_at.is_some();
        if changed {
            archived_at = ARCHIVE.then(|| chrono::Utc::now().to_rfc3339());
            revision += 1;
            transaction.execute(
                "UPDATE camp SET archived_at = ?2, archive_revision = ?3,
                    archived_through_global_sequence = CASE WHEN ?2 IS NOT NULL THEN
                        (SELECT last_sequence FROM event_sequence WHERE singleton = 1) END
                 WHERE id = ?1",
                params![id, archived_at, revision],
            )?;
            append_domain_event(
                transaction,
                if ARCHIVE { "camp.archived" } else { "camp.unarchived" },
                Some(id),
                Some(("camp", id)),
                &envelope.actor,
                None,
                &json!({"archiveRevision": revision}),
            )?;
        }
        Ok(CommandHandlerResult::applied(
            if ARCHIVE { "camp.archived" } else { "camp.unarchived" },
            json!({"threadId": id, "archivedAt": archived_at, "archiveRevision": revision, "changed": changed}),
            Some(EntityReference { entity_type: "camp".into(), entity_id: id.clone() }),
        ))
    })
}

pub(crate) fn conflict(id: &str, archived_at: Option<&str>, revision: i64) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "camp.archive_conflict",
        json!({"threadId": id, "archivedAt": archived_at, "archiveRevision": revision}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_attachment::insert_test_camp,
        camp_deletion::ThreadDeletionService,
        collaboration::DeleteThreadCommand,
        command::CommandResultStatus,
        message_changes::{MessageChanges, observe_archive_changes},
        read_model::{ReadModelService, archive},
    };

    fn envelope<P>(camp_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: uuid::Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: Some(camp_id.into()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn message(connection: &rusqlite::Connection, camp_id: &str, id: &str, sequence: i64) {
        connection.execute(
            "INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,structured_content_json,
                content_digest,address_mode,addressed_agent_ids_json,version,created_at,updated_at)
             VALUES(?1,?2,?3,'user','local_user','body','[]','digest','default','[]',1,
                '2026-11-18T10:00:00Z','2026-11-18T10:00:00Z')",
            params![id, camp_id, sequence],
        ).unwrap();
    }

    fn publish(
        connection: &rusqlite::Connection,
        camp_id: &str,
        message_id: &str,
        event_type: &str,
        sequence: Option<i64>,
    ) {
        connection.execute(
            "INSERT INTO event_log(event_id,event_type,payload_json,camp_id,entity_type,entity_id,actor_type,actor_id,created_at,global_sequence)
             VALUES(?1,?2,'{}',?3,'camp_message',?4,'user','local_user','2026-11-18T10:00:00Z',?5)",
            params![uuid::Uuid::new_v4().to_string(), event_type, camp_id, message_id, sequence],
        ).unwrap();
    }

    // A migrated SQLite fixture is necessary to exercise both publication triggers,
    // receipt CAS and guarded deletion against the same committed Thread.
    #[test]
    fn archive_uses_first_publication_and_rejects_stale_deletion() {
        let directory =
            std::env::temp_dir().join(format!("rovai-thread-archive-{}", uuid::Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = crate::camp_id::ThreadId::new().to_string();
        insert_test_camp(&database, &camp_id);
        let base: i64 = database
            .connection()
            .query_row("SELECT last_sequence FROM event_sequence", [], |row| {
                row.get(0)
            })
            .unwrap();
        let (output, mut inbox) = tokio::sync::mpsc::unbounded_channel();
        observe_archive_changes(database.connection()).unwrap();
        database.message_changes = Some(output.clone());
        message(database.connection(), &camp_id, "old-message", 1);
        publish(
            database.connection(),
            &camp_id,
            "old-message",
            "camp_message.sent",
            Some(base + 50),
        );
        let archive_command = |revision| {
            envelope(
                &camp_id,
                ArchiveThreadCommand {
                    camp_id: camp_id.clone(),
                    expected_archive_revision: revision,
                },
            )
        };
        let original = archive_command(0);
        let result = change(&mut database, &original).unwrap();
        assert_eq!(result.result.payload["archiveRevision"], 1);
        assert_eq!(
            inbox
                .try_recv()
                .map(|event| {
                    serde_json::from_str::<serde_json::Value>(&event).unwrap()["params"]["scope"]
                        .clone()
                })
                .unwrap(),
            "group"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT archived_through_global_sequence FROM camp WHERE id=?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            base + 50
        );
        publish(
            database.connection(),
            &camp_id,
            "old-message",
            "camp_message.public_a2a_sent",
            None,
        );
        let current_archive_revision = |db: &Database| {
            db.connection()
                .query_row(
                    "SELECT archive_revision FROM camp WHERE id=?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
        };
        assert_eq!(current_archive_revision(&database), 1);
        database
            .connection()
            .execute(
                "UPDATE camp SET history_activity_initialized=0, history_activity_at=NULL,
                    history_activity_message_id=NULL WHERE id=?1",
                [&camp_id],
            )
            .unwrap();
        let list = archive::list(
            &mut database,
            serde_json::from_value(json!({
                "kind": "chat", "query": "ＤＲＡＦＴ", "projectKeys": ["quick-chat"], "limit": 1
            }))
            .unwrap(),
        )
        .unwrap();
        let list = serde_json::to_value(list).unwrap();
        assert_eq!(list["matchingCounts"], json!({"chat":1,"mission":0}));
        assert_eq!(list["items"][0]["threadId"], camp_id);
        assert_eq!(list["items"][0]["lastMessageAt"], "2026-11-18T10:00:00Z");
        assert_eq!(list["hasMore"], false);
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut database)
                .unwrap()
                .quick_chat
                .total_count,
            0
        );
        assert_eq!(
            ReadModelService
                .navigation_camps(&mut database, &[camp_id.clone()], &Default::default())
                .unwrap()
                .camps[0]
                .archive_revision,
            1
        );

        let delete = envelope(
            &camp_id,
            DeleteThreadCommand {
                camp_id: camp_id.clone(),
                expected_version: 1,
                force: true,
                workspace_disposition: Default::default(),
                archive_guard: Some(ArchiveGuard {
                    expected_archive_revision: 1,
                }),
            },
        );
        let tx = database.connection_mut().transaction().unwrap();
        let changes = MessageChanges::begin(&tx, Some(output));
        message(&tx, &camp_id, "new-message", 2);
        publish(&tx, &camp_id, "new-message", "camp_message.sent", None);
        assert!(inbox.try_recv().is_err());
        changes.commit(tx).unwrap();
        assert!(
            inbox
                .try_recv()
                .unwrap()
                .contains("threads.archive_changed")
        );
        assert_eq!(current_archive_revision(&database), 2);
        let stale = ThreadDeletionService::default()
            .accept(&mut database, &delete)
            .unwrap();
        assert_eq!(stale.result.status, CommandResultStatus::Rejected);
        assert_eq!(stale.result.code, "camp.archive_conflict");
        assert!(change(&mut database, &original).unwrap().replayed);
        assert_eq!(current_archive_revision(&database), 2);

        change(&mut database, &archive_command(2)).unwrap();
        message(database.connection(), &camp_id, "explicit-message", 3);
        let next: i64 = database
            .connection()
            .query_row("SELECT last_sequence + 1 FROM event_sequence", [], |row| {
                row.get(0)
            })
            .unwrap();
        publish(
            database.connection(),
            &camp_id,
            "explicit-message",
            "camp_message.sent",
            Some(next),
        );
        assert_eq!(current_archive_revision(&database), 4);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
