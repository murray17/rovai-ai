use super::*;
use crate::camp_content::{
    StructuredThreadMessageSegment as Segment, composer_document_from_content,
};
use crate::command::CommandResultStatus;
use crate::pending_thread_draft::{self, SetPendingDraftPresence};

fn envelope<T>(id: &str, camp: Option<&str>, payload: T) -> CommandEnvelope<T> {
    CommandEnvelope {
        command_id: id.into(),
        actor: ActorRef::User {
            user_id: "local_user".into(),
        },
        camp_id: camp.map(str::to_owned),
        expected_versions: vec![],
        execution_epoch: None,
        payload,
    }
}

fn domain_state(database: &Database, camp_id: &str) -> Value {
    let camp: String = database.connection().query_row(
        "SELECT json_array(activation_state,version,membership_generation,last_message_sequence,default_lead_agent_id)
         FROM camp WHERE id=?1", [camp_id], |r| r.get(0),
    ).unwrap();
    let counts: Vec<i64> = [
        "camp_member",
        "camp_message",
        "camp_message_delivery",
        "conversation",
        "pending_camp_draft_presence",
    ]
    .iter()
    .map(|table| {
        database
            .connection()
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE camp_id=?1"),
                [camp_id],
                |r| r.get(0),
            )
            .unwrap()
    })
    .collect();
    let events: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM event_log WHERE camp_id=?1 AND event_type<>'command.result'",
            [camp_id],
            |r| r.get(0),
        )
        .unwrap();
    json!([camp, counts, events])
}

fn message(camp: &str, ids: &[&str], broadcast: bool) -> SendUserThreadMessageCommand {
    let mut content: Vec<_> = ids
        .iter()
        .map(|id| Segment::MemberMention {
            agent_id: (*id).into(),
        })
        .collect();
    if broadcast {
        content.push(Segment::AllMembersMention);
    }
    content.push(Segment::Text {
        text: " 请检查这个实现".into(),
    });
    SendUserThreadMessageCommand {
        delivery_mode: Default::default(),
        steer_targets: None,
        camp_id: camp.into(),
        content: composer_document_from_content(&content).unwrap(),
        source_attachments: vec![],
        quotes: vec![],
        reply_to_camp_message_id: None,
        execution: Some(ExecutionRequest {
            task_id: None,
            purpose: "Pending invitation regression".into(),
            completion_role: "required".into(),
            budget: None,
        }),
    }
}

// Owns the new membership + first-publication transaction. Existing legacy Draft
// activation tests cannot submit outsider atoms through the current inline command.
// A real isolated SQLite transaction is required to prove rejected-receipt and SQL
// rollback, retention-trigger restoration, command replay and serialized first sends.
#[test]
fn pending_invitations_commit_with_first_message_and_roll_back_every_failure() {
    let mut database = crate::test_support::seeded_runtime_database_owned();
    let service = CollaborationService::default();
    for broadcast in [false, true] {
        let mut create = CreateThreadCommand::for_test(
            database
                .directory()
                .join("workspace")
                .to_string_lossy()
                .into(),
        );
        create.activation_state = ThreadActivationState::Pending;
        let created = service
            .create_camp(
                &mut database,
                &envelope(&format!("create-{broadcast}"), None, create),
            )
            .unwrap();
        let camp = created.result.payload["threadId"]
            .as_str()
            .unwrap()
            .to_owned();
        pending_thread_draft::set_presence(
            &mut database,
            &DraftClient::default(),
            &SetPendingDraftPresence {
                thread_id: ThreadId::parse(&camp).unwrap(),
                present: true,
            },
        )
        .unwrap();
        let source = service
            .create_camp(
                &mut database,
                &envelope(
                    &format!("source-{broadcast}"),
                    None,
                    CreateThreadCommand::for_test(crate::test_support::absolute_test_path(
                        "/reference-project",
                    )),
                ),
            )
            .unwrap();
        let source_id = source.result.payload["threadId"]
            .as_str()
            .unwrap()
            .to_owned();
        let initial = domain_state(&database, &camp);
        let mut send = message(&camp, &["agent_2", "agent_2"], broadcast);
        // A retired Task association must not block first publication or invitations.
        send.execution.as_mut().unwrap().task_id = Some("missing-task".into());

        // References never invite source members. Pending membership changes roll back
        // with an unavailable target, while the rejection itself remains replayable.
        for id in [&camp, &source_id] {
            if id == &source_id {
                database
                    .connection()
                    .execute(
                        "UPDATE camp SET activation_state='pending' WHERE id=?1",
                        [&source_id],
                    )
                    .unwrap();
            }
            let mut invalid = send.clone();
            invalid
                .content
                .segments
                .push(crate::camp_content::ComposerSegment::Atom {
                    atom: crate::camp_content::ComposerAtom::ThreadReference {
                        thread_id: id.clone(),
                        label_fallback: Some("伪造标题".into()),
                    },
                });
            let command = envelope(
                &format!("reference-rejection-{broadcast}-{id}"),
                Some(&camp),
                invalid,
            );
            let rejected = service
                .send_user_camp_message(&mut database, &command)
                .unwrap();
            assert_eq!(rejected.result.code, "reference_unavailable");
            assert_eq!(domain_state(&database, &camp), initial);
            database
                .connection()
                .execute(
                    "UPDATE camp SET activation_state='active' WHERE id=?1",
                    [&source_id],
                )
                .unwrap();
            let replay = service
                .send_user_camp_message(&mut database, &command)
                .unwrap();
            assert!(replay.replayed);
            assert_eq!(replay.result, rejected.result);
        }
        // A small input can expand beyond the content limit when Core captures titles.
        // Reject inside the same transaction and replay the rejection after a rename.
        database
            .connection()
            .execute(
                "UPDATE camp SET title=?1 WHERE id=?2",
                params!["登".repeat(80), source_id],
            )
            .unwrap();
        let mut oversized = send.clone();
        oversized
            .content
            .segments
            .push(crate::camp_content::ComposerSegment::Text {
                text: "x".repeat(650_000),
            });
        oversized.content.segments.extend((0..2_000).map(|_| {
            crate::camp_content::ComposerSegment::Atom {
                atom: crate::camp_content::ComposerAtom::ThreadReference {
                    thread_id: source_id.clone(),
                    label_fallback: None,
                },
            }
        }));
        let oversized_command = envelope(
            &format!("reference-size-{broadcast}"),
            Some(&camp),
            oversized,
        );
        let rejected = service
            .send_user_camp_message(&mut database, &oversized_command)
            .unwrap();
        assert_eq!(rejected.result.code, "camp_message.invalid_content");
        assert_eq!(domain_state(&database, &camp), initial);
        database
            .connection()
            .execute("UPDATE camp SET title='短标题' WHERE id=?1", [&source_id])
            .unwrap();
        let replay = service
            .send_user_camp_message(&mut database, &oversized_command)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, rejected.result);

        for label in ["旧标题", "伪造另一标题"] {
            send.content
                .segments
                .push(crate::camp_content::ComposerSegment::Atom {
                    atom: crate::camp_content::ComposerAtom::ThreadReference {
                        thread_id: source_id.clone(),
                        label_fallback: Some(label.into()),
                    },
                });
        }
        database
            .connection()
            .execute(
                "UPDATE camp SET title='真实标题 [登录]' WHERE id=?1",
                [&source_id],
            )
            .unwrap();

        // Standalone additions still cannot mutate a Pending Thread.
        let add = service
            .add_camp_member(
                &mut database,
                &envelope(
                    &format!("standalone-{broadcast}"),
                    Some(&camp),
                    AddThreadMemberCommand {
                        camp_id: camp.clone(),
                        agent_id: "agent_2".into(),
                        expected_membership_generation: 1,
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(add.result.code, "camp.pending_activation_required");
        assert_eq!(domain_state(&database, &camp), initial);

        // A non-User transport cannot obtain implicit invitation authority.
        let mut system = envelope(&format!("system-{broadcast}"), Some(&camp), send.clone());
        system.actor = ActorRef::System {
            component_id: "test".into(),
        };
        assert_eq!(
            service
                .send_user_camp_message(&mut database, &system)
                .unwrap()
                .result
                .code,
            "mention_target_unavailable"
        );
        assert_eq!(domain_state(&database, &camp), initial);

        // All identities must pass, even if another mentioned identity is valid.
        for unavailable in ["missing-agent", "agent_3"] {
            database
                .connection()
                .execute(
                    "UPDATE agent_profile SET profile_status='away' WHERE id='agent_3'",
                    [],
                )
                .unwrap();
            let input = envelope(
                &format!("unavailable-{broadcast}-{unavailable}"),
                Some(&camp),
                message(&camp, &["agent_2", unavailable], broadcast),
            );
            assert_eq!(
                service
                    .send_user_camp_message(&mut database, &input)
                    .unwrap()
                    .result
                    .code,
                "mention_target_unavailable"
            );
            assert_eq!(domain_state(&database, &camp), initial);
        }
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status='present' WHERE id='agent_3'",
                [],
            )
            .unwrap();

        // An invalid reply rejects after tentative membership writes.
        let mut bad_reply = send.clone();
        bad_reply.reply_to_camp_message_id = Some("missing-message".into());
        let command = envelope(&format!("reject-{broadcast}-reply"), Some(&camp), bad_reply);
        let rejected = service
            .send_user_camp_message(&mut database, &command)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(domain_state(&database, &camp), initial);
        let replay = service
            .send_user_camp_message(&mut database, &command)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, rejected.result);

        // Failure after activation must restore both membership and client presence.
        database
            .connection()
            .execute_batch(
                "CREATE TEMP TRIGGER fail_first_publication BEFORE INSERT ON camp_message
             BEGIN SELECT RAISE(ABORT, 'fixture publication failure'); END",
            )
            .unwrap();
        let command = envelope(&format!("accept-{broadcast}"), Some(&camp), send);
        assert!(
            service
                .send_user_camp_message(&mut database, &command)
                .is_err()
        );
        assert_eq!(domain_state(&database, &camp), initial);
        database
            .connection()
            .execute_batch("DROP TRIGGER fail_first_publication")
            .unwrap();

        let accepted = service
            .send_user_camp_message(&mut database, &command)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        let task_link: Option<String> = database
            .connection()
            .query_row(
                "SELECT json_type(payload_json, '$.taskId') FROM event_log
                 WHERE camp_id=?1 AND event_type='camp_message.sent'",
                [&camp],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_link, None);
        assert_eq!(
            accepted.result.payload["deliveryIds"]
                .as_array()
                .unwrap()
                .len(),
            if broadcast { 2 } else { 1 }
        );
        assert_eq!(database.connection().query_row(
            "SELECT activation_state='active' AND membership_generation=2 AND default_lead_agent_id='agent_1'
             FROM camp WHERE id=?1", [&camp], |r| r.get::<_, bool>(0)
        ).unwrap(), true);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM pending_camp_draft_presence WHERE camp_id=?1",
                    [&camp],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let content: String = database
            .connection()
            .query_row(
                "SELECT structured_content_json FROM camp_message WHERE camp_id=?1",
                [&camp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            content.matches("agent_2").count(),
            2,
            "both mention atoms survive"
        );
        assert_eq!(database.connection().query_row(
            "SELECT COUNT(*) FROM event_log WHERE camp_id=?1 AND event_type='camp.member_added'",
            [&camp], |r| r.get::<_, i64>(0)
        ).unwrap(), 1);
        assert_eq!(content.matches("真实标题 [登录]").count(), 2);
        assert!(!content.contains("旧标题") && !content.contains("伪造"));
        let projected = crate::camp_content::render_agent_plain_text(
            database.connection(),
            &serde_json::from_str::<Vec<Segment>>(&content).unwrap(),
        )
        .unwrap();
        assert_eq!(
            projected
                .matches(&format!("rovai://thread/{source_id}"))
                .count(),
            2
        );
        let source_version = database
            .connection()
            .query_row("SELECT version FROM camp WHERE id=?1", [&source_id], |r| {
                r.get(0)
            })
            .unwrap();
        let deleted = service
            .delete_camp(
                &mut database,
                &envelope(
                    &format!("delete-source-{broadcast}"),
                    Some(&source_id),
                    DeleteThreadCommand {
                        camp_id: source_id.clone(),
                        expected_version: source_version,
                        force: false,
                        workspace_disposition: MissionWorkspaceDisposition::Retain,
                    },
                ),
            )
            .unwrap();
        assert_eq!(deleted.result.code, "camp.deleted");
        assert_eq!(
            crate::camp_content::render_agent_plain_text(
                database.connection(),
                &serde_json::from_str::<Vec<Segment>>(&content).unwrap()
            )
            .unwrap(),
            projected
        );
        let committed = domain_state(&database, &camp);
        let replay = service
            .send_user_camp_message(&mut database, &command)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, accepted.result);
        assert_eq!(domain_state(&database, &camp), committed);

        // The next serialized first-send contender now sees Active. It cannot
        // silently invite a different outsider, nor reuse the receipt for new text.
        let stale = envelope(
            &format!("stale-{broadcast}"),
            Some(&camp),
            message(&camp, &["agent_3"], false),
        );
        assert_eq!(
            service
                .send_user_camp_message(&mut database, &stale)
                .unwrap()
                .result
                .code,
            "mention_target_unavailable"
        );
        assert_eq!(domain_state(&database, &camp), committed);
        let mut conflict = command.clone();
        conflict.payload = message(&camp, &["agent_3"], false);
        let replay = service
            .send_user_camp_message(&mut database, &conflict)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, accepted.result);
        assert_eq!(domain_state(&database, &camp), committed);
    }
    // Same transaction owner: file-only first input, atomic refusal, frozen projection and replay.
    for target_kind in [
        crate::camp_content::ProjectFileTargetKind::File,
        crate::camp_content::ProjectFileTargetKind::Directory,
    ] {
        let directory = target_kind == crate::camp_content::ProjectFileTargetKind::Directory;
        use crate::camp_content::{ComposerAtom, ComposerDocument, ComposerSegment};
        use crate::project_file_reference::Preflight;
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        let workspace = database.directory().join(if directory {
            "directory-reference-workspace"
        } else {
            "file-reference-workspace"
        });
        std::fs::create_dir_all(&workspace).unwrap();
        let file = workspace.join("input #1.log");
        if directory {
            std::fs::create_dir(&file).unwrap();
        } else {
            std::fs::write(&file, "nonce-before").unwrap();
        }
        let mut create = CreateThreadCommand::for_test(workspace.to_str().unwrap().into());
        create.activation_state = ThreadActivationState::Pending;
        let created = service
            .create_camp(
                &mut database,
                &envelope(&format!("files-create-{directory}"), None, create),
            )
            .unwrap();
        let camp = created.result.payload["threadId"]
            .as_str()
            .unwrap()
            .to_owned();
        let binding = crate::project_files::binding(&database, &camp).unwrap();
        let (_, identity) = crate::project_files::root(&binding).unwrap();
        let raw = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(identity, "input #1.log")).unwrap());
        let atom = ComposerSegment::Atom {
            atom: ComposerAtom::ProjectFileReference {
                thread_id: camp.clone(),
                raw_reference: raw.clone(),
                label_fallback: "untrusted display only".into(),
                target_kind,
            },
        };
        let mut send = message(&camp, &["agent_2"], false);
        send.content = ComposerDocument {
            version: 2,
            segments: vec![
                ComposerSegment::Atom {
                    atom: ComposerAtom::Member {
                        agent_id: "agent_2".into(),
                        label_fallback: None,
                    },
                },
                atom.clone(),
                atom,
            ],
        };
        let command = envelope(&format!("files-first-{directory}"), Some(&camp), send);
        let initial = domain_state(&database, &camp);
        if directory {
            std::fs::remove_dir(&file).unwrap();
        } else {
            std::fs::remove_file(&file).unwrap();
        }
        let missing = Preflight::prepare(
            camp.clone(),
            &command.payload.content,
            Some(binding.clone()),
        );
        let refused = service
            .send_user_camp_message_with_files(&mut database, &command, Some(&missing))
            .unwrap();
        assert_eq!(refused.result.code, "project_file_reference_unavailable");
        assert_eq!(refused.result.payload["segmentIndex"], 1);
        assert_eq!(refused.result.payload["reason"], "file_missing");
        assert_eq!(domain_state(&database, &camp), initial);
        if directory {
            std::fs::create_dir(&file).unwrap();
        } else {
            std::fs::write(&file, "nonce-restored").unwrap();
        }
        let valid = Preflight::prepare(
            camp.clone(),
            &command.payload.content,
            Some(binding.clone()),
        );
        let replay = service
            .send_user_camp_message_with_files(&mut database, &command, Some(&valid))
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, refused.result);
        let mut fresh = command.clone();
        fresh.command_id = format!("files-new-command-{directory}");
        let accepted = service
            .send_user_camp_message_with_files(&mut database, &fresh, Some(&valid))
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        let message_id = accepted.result.payload["threadMessageId"].as_str().unwrap();
        let (body, json): (String, String) = database
            .connection()
            .query_row(
                "SELECT body, structured_content_json FROM camp_message WHERE id=?1",
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(body.matches("input%20%231.log").count(), 2);
        assert!(!body.contains("untrusted"));
        let published: Vec<Segment> = serde_json::from_str(&json).unwrap();
        assert_eq!(
            published
                .iter()
                .filter(|s| matches!(s, Segment::ProjectFileReference { .. }))
                .count(),
            2
        );
        if directory {
            std::fs::remove_dir(&file).unwrap();
        } else {
            std::fs::remove_file(&file).unwrap();
        }
        let committed = domain_state(&database, &camp);
        let replay = service
            .send_user_camp_message(&mut database, &fresh)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, accepted.result);
        assert_eq!(domain_state(&database, &camp), committed);
        assert_eq!(
            crate::camp_content::render_agent_plain_text(database.connection(), &published)
                .unwrap(),
            body
        );
        // A binding mutation after preflight is rejected inside the transaction, before any publication.
        database
            .connection()
            .execute(
                "UPDATE camp SET project_path=?1 WHERE id=?2",
                params![workspace.join("different-root").to_str(), camp],
            )
            .unwrap();
        let before = domain_state(&database, &camp);
        fresh.command_id = format!("files-rebound-{directory}");
        let refused = service
            .send_user_camp_message_with_files(&mut database, &fresh, Some(&valid))
            .unwrap();
        assert_eq!(refused.result.payload["reason"], "root_changed");
        assert_eq!(domain_state(&database, &camp), before);
    }
}
