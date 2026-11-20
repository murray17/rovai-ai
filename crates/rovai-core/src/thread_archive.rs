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

pub(crate) fn is_archived(
    connection: &rusqlite::Connection,
    thread_id: &str,
) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM camp WHERE id=?1 AND archived_at IS NOT NULL)",
        [thread_id],
        |row| row.get(0),
    )
}

pub(crate) fn change<const ARCHIVE: bool>(
    database: &mut Database,
    envelope: &CommandEnvelope<ChangeArchiveCommand<ARCHIVE>>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |transaction| {
        if !matches!(envelope.actor, ActorRef::User { .. }) {
            return Ok(CommandHandlerResult::rejected(
                "camp.archive_user_required",
                json!({}),
            ));
        }
        let id = &envelope.payload.camp_id;
        let row = transaction
            .query_row(
                "SELECT activation_state, archived_at FROM camp WHERE id = ?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        let Some((activation, mut archived_at)) = row else {
            return Ok(CommandHandlerResult::rejected(
                "camp.not_found",
                json!({"threadId": id}),
            ));
        };
        if activation != "active" {
            return Ok(CommandHandlerResult::rejected(
                "camp.archive_requires_active",
                json!({"threadId": id}),
            ));
        }
        let changed = ARCHIVE != archived_at.is_some();
        if changed {
            let now = chrono::Utc::now().to_rfc3339();
            // Also close any unpublished channel input left by an older Core
            // before reopening this Thread.
            crate::channel::stop_pending_inbound(transaction, id, &now)?;
            archived_at = ARCHIVE.then_some(now);
            transaction.execute(
                "UPDATE camp SET archived_at = ?2 WHERE id = ?1",
                params![id, archived_at],
            )?;
            if ARCHIVE {
                crate::runtime::ExecutionRuntimeService::cancel_camp_work_in_transaction(
                    transaction,
                    id,
                    &envelope.command_id,
                    &envelope.actor,
                    "user_requested_agent_run_stop",
                )?;
            }
            append_domain_event(
                transaction,
                if ARCHIVE {
                    "camp.archived"
                } else {
                    "camp.unarchived"
                },
                Some(id),
                Some(("camp", id)),
                &envelope.actor,
                None,
                &json!({}),
            )?;
        }
        Ok(CommandHandlerResult::applied(
            if ARCHIVE {
                "camp.archived"
            } else {
                "camp.unarchived"
            },
            json!({"threadId": id, "archivedAt": archived_at, "changed": changed}),
            Some(EntityReference {
                entity_type: "camp".into(),
                entity_id: id.clone(),
            }),
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_attachment::insert_test_camp,
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

    #[test]
    fn manual_archive_is_idempotent_and_pages_by_thread_id() {
        let (mut db, directory) = crate::test_support::seeded_runtime_database_fast();
        let a = crate::camp_id::ThreadId::new().to_string();
        let b = crate::camp_id::ThreadId::new().to_string();
        let c = crate::camp_id::ThreadId::new().to_string();
        let archive = |id: &str| envelope(id, ArchiveThreadCommand { camp_id: id.into() });
        let restore = |id: &str| envelope(id, UnarchiveThreadCommand { camp_id: id.into() });
        let original = archive(&a);
        for id in [&a, &b, &c] {
            insert_test_camp(&db, id);
        }
        for id in [&b, &c] {
            db.connection().execute("UPDATE camp SET project_binding_kind='directory',project_path='/fixtures/project' WHERE id=?1", [id]).unwrap();
        }
        assert_eq!(
            change(&mut db, &original).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(
            change(&mut db, &archive(&a)).unwrap().result.payload["changed"],
            false
        );
        for (i, id) in [&b, &c].into_iter().enumerate() {
            change(&mut db, &archive(id)).unwrap();
            let msg = format!("archived-{i}");
            message(db.connection(), id, &msg, 1);
            publish(db.connection(), id, &msg, "camp_message.sent", None);
            publish(
                db.connection(),
                id,
                &msg,
                "camp_message.public_a2a_sent",
                None,
            );
        }
        db.connection().execute("UPDATE camp SET history_activity_initialized=0, history_activity_at=NULL, history_activity_message_id=NULL WHERE id=?1", [&b]).unwrap();
        let page = |db: &mut Database, cursor: Option<&str>, limit: i64| {
            let query = serde_json::from_value(json!({"cursor":cursor,"limit":limit})).unwrap();
            serde_json::to_value(archive::list(db, query).unwrap()).unwrap()
        };
        let mut ids = [&a, &b, &c];
        ids.sort();
        let mut cursor = None;
        for (index, id) in ids.iter().enumerate() {
            let page = page(&mut db, cursor, 0);
            assert_eq!(page.as_object().unwrap().len(), 2);
            assert_eq!(page["items"].as_array().unwrap().len(), 1);
            let item = &page["items"][0];
            assert_eq!(item.as_object().unwrap().len(), 5);
            assert_eq!(item["threadId"], id.as_str());
            if *id == &a {
                assert!(item["lastMessageAt"].is_null());
            } else {
                assert_eq!(item["projectKey"], "directory:/fixtures/project");
                assert_eq!(item["lastMessageAt"], "2026-11-18T10:00:00Z");
            }
            cursor = (index + 1 < ids.len()).then_some(id.as_str());
            assert_eq!(page["nextCursor"].as_str(), cursor);
        }
        assert!(page(&mut db, None, 600)["nextCursor"].is_null());
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut db)
                .unwrap()
                .quick_chat
                .total_count,
            0
        );
        assert!(
            ReadModelService
                .navigation_camps(&mut db, &[a.clone()], &Default::default())
                .unwrap()
                .camps[0]
                .archived_at
                .is_some()
        );
        assert_eq!(
            change(&mut db, &restore(&a)).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(
            change(&mut db, &restore(&a)).unwrap().result.payload["changed"],
            false
        );
        assert!(change(&mut db, &original).unwrap().replayed);
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut db)
                .unwrap()
                .quick_chat
                .total_count,
            1
        );
        drop(db);
        std::fs::remove_dir_all(directory).unwrap();
    }

    // Only the archive command exercises the transaction shared by the flag, multiple Run
    // cancellations, waiting deliveries and runtime cleanup. The scheduler owns subsequent ACKs.
    #[test]
    fn archive_cancels_only_this_threads_work_at_commit() {
        use crate::collaboration::{
            CollaborationService, CreateThreadCommand, ExecutionRequest, TestThreadMessageAddress,
            TestThreadMessageCommand,
        };
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let service = CollaborationService::default();
        let start_work = |db: &mut crate::test_support::OwnedTestDatabase, name: &str| {
            let path = db.directory().join(name);
            std::fs::create_dir_all(&path).unwrap();
            let mut create = envelope(
                "",
                CreateThreadCommand::for_test_with_members(
                    path.to_string_lossy().into_owned(),
                    &["agent_1", "agent_2"],
                    "agent_1",
                ),
            );
            create.camp_id = None;
            let thread = service.create_camp(db, &create).unwrap().result.payload["threadId"]
                .as_str()
                .unwrap()
                .to_owned();
            let send = envelope(
                &thread,
                TestThreadMessageCommand {
                    camp_id: thread.clone(),
                    draft_revision: None,
                    body: "parallel work".into(),
                    prepared_attachment_ids: vec![],
                    address: TestThreadMessageAddress::Explicit {
                        agent_ids: vec!["agent_1".into(), "agent_2".into()],
                    },
                    reply_to_camp_message_id: None,
                    execution: Some(ExecutionRequest {
                        task_id: None,
                        purpose: "work".into(),
                        completion_role: "required".into(),
                        budget: None,
                    }),
                },
            );
            let sent = service
                .send_test_camp_message(db, &send)
                .unwrap()
                .result
                .payload;
            let runs: Vec<String> = serde_json::from_value(sent["agentRunIds"].clone()).unwrap();
            assert_eq!(runs.len(), 2);
            (
                thread,
                runs,
                sent["threadMessageId"].as_str().unwrap().to_owned(),
            )
        };
        let (target, runs, message_id) = start_work(&mut db, "target");
        let (other, _, _) = start_work(&mut db, "other");
        let now = chrono::Utc::now().to_rfc3339();
        db.connection()
            .execute(
                "UPDATE agent_run SET status='running', started_at=?2 WHERE id=?1",
                params![runs[0], now],
            )
            .unwrap();
        let tx = db.connection_mut().transaction().unwrap();
        let pending = crate::delivery_queue::enqueue_message_deliveries(
            &tx,
            &target,
            &message_id,
            &["agent_1".into()],
            &now,
        )
        .unwrap();
        tx.commit().unwrap();
        let archive = envelope(
            &target,
            ArchiveThreadCommand {
                camp_id: target.clone(),
            },
        );
        db.connection()
            .execute_batch(
                "CREATE TEMP TRIGGER fail_archive_receipt BEFORE INSERT ON event_log
            WHEN NEW.command_type='camp.archive' BEGIN SELECT RAISE(ABORT,'archive failure'); END;",
            )
            .unwrap();
        assert!(change(&mut db, &archive).is_err());
        assert!(!is_archived(db.connection(), &target).unwrap());
        let active = |db: &Database, thread: &str| {
            db.connection().query_row("SELECT COUNT(*) FROM agent_run WHERE camp_id=?1 AND status IN ('queued','running','waiting')",[thread],|r|r.get::<_,i64>(0)).unwrap()
        };
        assert_eq!(active(&db, &target), 2);
        db.connection()
            .execute_batch("DROP TRIGGER fail_archive_receipt")
            .unwrap();
        assert_eq!(
            change(&mut db, &archive).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(active(&db, &target), 0);
        assert_eq!(active(&db, &other), 2);
        let stopped:i64=db.connection().query_row("SELECT COUNT(*) FROM agent_run WHERE camp_id=?1 AND status='cancelled' AND cancel_requested_at IS NOT NULL",[&target],|r|r.get(0)).unwrap();
        assert_eq!(stopped, 2);
        let cleanup = crate::runtime::ExecutionRuntimeService::default()
            .list_cancellation_candidates(&db, 10)
            .unwrap();
        assert!(cleanup.iter().any(|c| c.agent_run_id == runs[0]));
        let pending_status: String = db
            .connection()
            .query_row(
                "SELECT status FROM camp_message_delivery WHERE id=?1",
                [&pending[0].delivery_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending_status, "cancelled");
        change(
            &mut db,
            &envelope(
                &target,
                UnarchiveThreadCommand {
                    camp_id: target.clone(),
                },
            ),
        )
        .unwrap();
        assert!(
            crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 100)
                .unwrap()
                .is_empty()
        );
        assert_eq!(active(&db, &target), 0);
    }
}
