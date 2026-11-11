use super::*;
use crate::{
    collaboration::{
        CollaborationService, CreateThreadCommand, ProjectBindingKind,
        SendUserThreadMessageCommand, ThreadActivationState, ThreadCollaborationMode,
    },
    command::CommandResultStatus,
    test_support::{OwnedTestDatabase, fresh_schema_database_fast_owned},
};

fn envelope<T>(id: &str, payload: T) -> CommandEnvelope<T> {
    CommandEnvelope {
        command_id: id.into(),
        actor: ActorRef::User {
            user_id: "local_user".into(),
        },
        camp_id: None,
        expected_versions: vec![],
        execution_epoch: None,
        payload,
    }
}

fn fixture() -> (OwnedTestDatabase, String) {
    let mut db = fresh_schema_database_fast_owned();
    let path = db.directory().join("quick-chat");
    std::fs::create_dir_all(&path).unwrap();
    let created = CollaborationService::default()
        .create_camp(
            &mut db,
            &envelope(
                "source-create",
                CreateThreadCommand {
                    team: None,
                    name: Some("😀".repeat(80)),
                    project_binding_kind: ProjectBindingKind::QuickChat,
                    project_path: path.canonicalize().unwrap().to_string_lossy().into_owned(),
                    member_agent_ids: vec!["agent_1".into(), "agent_2".into()],
                    default_lead_agent_id: "agent_1".into(),
                    collaboration_mode: ThreadCollaborationMode::Peer,
                    activation_state: ThreadActivationState::Active,
                },
            ),
        )
        .unwrap();
    (
        db,
        created.result.payload["threadId"].as_str().unwrap().into(),
    )
}

fn request(source: &str, anchor: Option<&str>) -> ForkThreadCommand {
    ForkThreadCommand {
        source_thread_id: source.into(),
        source_message_id: anchor.map(str::to_string),
    }
}

fn fork(
    db: &mut Database,
    data_dir: &Path,
    command_id: &str,
    source: &str,
    anchor: Option<&str>,
) -> CommandExecution {
    fork_thread(db, &envelope(command_id, request(source, anchor)), data_dir).unwrap()
}

fn message(db: &mut Database, source: &str, seq: i64, author: &str, publish: bool) -> String {
    let id = Uuid::new_v4().to_string();
    let text = format!("history {seq}");
    let content = json!([{"kind":"text","text":text}]).to_string();
    let tx = db.connection_mut().transaction().unwrap();
    tx.execute("INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,structured_content_json,
        content_digest,address_mode,addressed_agent_ids_json,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,'digest','default','[]','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')",
        params![id,source,seq,if author=="local_user" {"user"} else {"agent"},author,text,content]).unwrap();
    if publish {
        append_domain_event(
            &tx,
            "camp_message.sent",
            Some(source),
            Some(("camp_message", &id)),
            &ActorRef::User {
                user_id: "local_user".into(),
            },
            None,
            &json!({"sequence":seq}),
        )
        .unwrap();
    }
    tx.execute(
        "UPDATE camp SET last_message_sequence=MAX(last_message_sequence,?2) WHERE id=?1",
        params![source, seq],
    )
    .unwrap();
    tx.commit().unwrap();
    id
}

fn count(db: &Database, table: &str) -> i64 {
    db.connection()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn ordinary_send(db: &mut Database, target: &str, command_id: &str) -> CommandExecution {
    let mut send = envelope(
        command_id,
        SendUserThreadMessageCommand {
            delivery_mode: Default::default(),
            steer_targets: None,
            camp_id: target.into(),
            content: crate::camp_content::composer_document_from_content(&vec![
                crate::camp_content::StructuredThreadMessageSegment::Text {
                    text: "continue".into(),
                },
            ])
            .unwrap(),
            source_attachments: vec![],
            quotes: vec![],
            reply_to_camp_message_id: None,
            execution: Some(crate::collaboration::ExecutionRequest {
                task_id: None,
                purpose: "continue copy".into(),
                completion_role: "required".into(),
                budget: None,
            }),
        },
    );
    send.camp_id = Some(target.into());
    CollaborationService::default()
        .send_user_camp_message(db, &send)
        .unwrap()
}

// New transaction owner: ordinary send/create tests cannot prove bulk history
// copying without side effects, publication deduplication or reply remapping.
#[test]
fn fork_copies_published_snapshot_and_ordinary_sends_continue_its_history() {
    let (mut db, source) = fixture();
    let root = db.directory().to_path_buf();
    let first = message(&mut db, &source, 1, "local_user", true);
    let former = message(&mut db, &source, 2, "agent_2", true);
    let anchor = message(&mut db, &source, 3, "agent_1", true);
    let unpublished = message(&mut db, &source, 4, "agent_1", false);
    let withdrawn = message(&mut db, &source, 5, "local_user", true);
    let deleted = message(&mut db, &source, 6, "agent_1", true);
    let outside = message(&mut db, &source, 7, "local_user", true);
    for seq in 8..=110 {
        message(&mut db, &source, seq, "local_user", true);
    }
    db.connection().execute("UPDATE camp_member SET status='left',left_at='2020-02-01' WHERE camp_id=?1 AND agent_id='agent_2'",[&source]).unwrap();
    crate::agent_profile::configure_test_runtime(&db, &["agent_1"]);
    ordinary_send(&mut db, &source, "source-live");
    let source_run = crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 10)
        .unwrap()
        .remove(0);
    let mut claim = envelope(
        "claim-source",
        crate::runtime::ClaimAgentRunCommand {
            agent_run_id: source_run.clone(),
            expected_version: 1,
            lease_owner: "fixture-scheduler".into(),
            lease_seconds: 60,
            workspace: None,
            starting_git_observation: None,
        },
    );
    claim.actor = ActorRef::System {
        component_id: "agent-run-scheduler".into(),
    };
    claim.camp_id = Some(source.clone());
    let claimed = crate::runtime::ExecutionRuntimeService::default()
        .claim_agent_run(&mut db, &claim)
        .unwrap();
    assert_ne!(
        claimed.result.status,
        CommandResultStatus::Rejected,
        "{:?}",
        claimed.result
    );
    db.connection()
        .execute(
            "UPDATE camp_message SET source_agent_run_id=?2,agent_run_id=?2 WHERE id=?1",
            params![anchor, source_run],
        )
        .unwrap();
    db.connection()
        .execute(
            "UPDATE agent_profile SET profile_status='away' WHERE id='agent_1'",
            [],
        )
        .unwrap();
    let source_ref = json!([{"id":Uuid::new_v4().to_string(),"sourcePath":root.join("missing.txt"),"displayName":"missing.txt","kind":"file","mediaType":"text/plain","observedByteSize":12,"pastedTextPreview":"kept preview"}]).to_string();
    let content = json!([{"kind":"text","text":format!("[original]({first})")},{"kind":"current_user_mention","userId":"local_user"},{"kind":"member_mention","agentId":"agent_2"},{"kind":"thread_reference","threadId":source,"titleAtSend":"original"}]).to_string();
    db.connection().execute("UPDATE camp_message SET structured_content_json=?2,body='snapshot',source_attachments_json=?3,reply_to_camp_message_id=?4,presentation_json='{\"legacyDisplay\":true}',recipient_presentation_json='{\"inlineOrder\":[],\"inlineOccurrences\":[],\"explicitOrder\":[\"agent_2\"],\"footerRecipients\":[\"agent_3\"]}',source_operation_id='old-operation',addressed_agent_ids_json='[\"agent_2\"]',effective_recipient_ids_json='[\"agent_2\",\"agent_3\"]' WHERE id=?1",params![anchor,content,source_ref,first]).unwrap();
    db.connection()
        .execute(
            "UPDATE camp_message SET reply_to_camp_message_id=?2 WHERE id=?1",
            params![former, outside],
        )
        .unwrap();
    db.connection().execute("UPDATE camp_message SET recall_state='withdrawn',body='',structured_content_json='[]',addressed_agent_ids_json='[\"agent_2\"]',effective_recipient_ids_json='[\"agent_2\"]' WHERE id=?1",[&withdrawn]).unwrap();
    db.connection()
        .execute(
            "UPDATE camp_message SET tombstoned_at='2020-02-01' WHERE id=?1",
            [&deleted],
        )
        .unwrap();
    let excerpt = |text: &str, quote_source: serde_json::Value| {
        json!({
            "version":1,"quoteId":Uuid::new_v4().to_string(),
            "authorAtCapture":{"type":"agent","agentId":"agent_3","displayName":"历史作者"},
            "source":quote_source,"text":text,"format":"plain_text","capturedAt":"2020-01-01T00:00:00Z"
        })
    };
    let mut quote_value = json!([
        excerpt(
            "saved excerpt",
            json!({"scope":"camp","campId":source,"messageId":first})
        ),
        excerpt(
            "outside excerpt",
            json!({"scope":"camp","campId":source,"messageId":outside})
        ),
        excerpt(
            "withdrawn excerpt",
            json!({"scope":"camp","campId":source,"messageId":withdrawn})
        ),
        excerpt(
            "deleted excerpt",
            json!({"scope":"camp","campId":source,"messageId":deleted})
        ),
        excerpt(
            "unpublished excerpt",
            json!({"scope":"camp","campId":source,"messageId":unpublished})
        ),
        excerpt(
            "other Thread excerpt",
            json!({"scope":"camp","campId":ThreadId::new(),"messageId":first})
        ),
        excerpt(
            "private excerpt",
            json!({"scope":"single_chat","campId":source,"conversationId":Uuid::new_v4().to_string(),"messageId":first})
        )
    ]);
    quote_value[0]["sourceContentDigest"] = json!("retired-source-proof");
    quote_value[0]["snapshotDigest"] = json!("retired-snapshot-proof");
    quote_value[0]["locator"] = json!({"projectionVersion":1,"startScalar":0,"endScalar":3});
    let quote = quote_value.to_string();
    db.connection()
        .execute(
            "UPDATE camp_message SET quotes_json=?2 WHERE id=?1",
            params![anchor, quote],
        )
        .unwrap();
    db.connection().execute("INSERT INTO message_attachment(id,camp_id,camp_message_id,position,display_name,media_type,byte_size,content_digest,storage_path,preview_kind,created_by_type,created_by_id,created_at) VALUES(?1,?2,?3,0,'legacy.txt','text/plain',4,'digest',?4,'none','user','local_user','2020-01-01')",params![Uuid::new_v4().to_string(),source,anchor,root.join("legacy-missing.txt").to_string_lossy()]).unwrap();
    let attachment = Uuid::new_v4().to_string();
    db.connection().execute("INSERT INTO managed_attachment(camp_id,id,kind,root_relative_payload_path,media_type,byte_size,file_count,directory_count,node_count,content_digest,preview_kind,origin,state,available_revision,created_by_type,created_by_id,created_at) VALUES(?1,?2,'file',?3,'text/plain',5,1,0,1,'digest','none','composer','available',1,'user','local_user','2020-01-01')",params![source,attachment,format!("camps/{source}/attachments/.managed-v2/{attachment}/payload/managed.txt")]).unwrap();
    db.connection().execute("INSERT INTO camp_message_attachment_ref(camp_id,camp_message_id,ordinal,attachment_id,display_name_snapshot,created_at) VALUES(?1,?2,0,?3,'managed.txt','2020-01-01')",params![source,anchor,attachment]).unwrap();
    let tx = db.connection_mut().transaction().unwrap();
    tx.execute("INSERT INTO camp_message_reference(camp_message_id,kind,value) VALUES(?1,'issue','issue-42')",[&anchor]).unwrap();
    tx.execute(
        "INSERT INTO camp_message_mention(camp_message_id,agent_id) VALUES(?1,'agent_2')",
        [&anchor],
    )
    .unwrap();
    append_domain_event(
        &tx,
        "camp_message.public_a2a_sent",
        Some(&source),
        Some(("camp_message", &anchor)),
        &ActorRef::User {
            user_id: "local_user".into(),
        },
        None,
        &json!({}),
    )
    .unwrap();
    tx.commit().unwrap();
    let before = [
        "agent_run",
        "message_delivery",
        "camp_message_delivery",
        "notification_occurrence",
        "approval",
        "channel_delivery",
        "conversation",
    ]
    .map(|t| (t, count(&db, t)));
    let result = fork(&mut db, &root, "partial", &source, Some(&anchor));
    let target = result.result.payload["threadId"]
        .as_str()
        .unwrap()
        .to_string();
    let snapshot = crate::read_model::ReadModelService
        .camp_snapshot(&mut db, &target)
        .unwrap();
    assert_eq!(snapshot.messages.len(), 3);
    assert_eq!(
        snapshot
            .messages
            .iter()
            .map(|m| m.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    let copy = &snapshot.messages[2];
    assert_eq!(
        copy.reply_to_camp_message_id.as_deref(),
        Some(snapshot.messages[0].id.as_str())
    );
    assert!(snapshot.messages[1].reply_to_camp_message_id.is_none());
    assert_eq!(
        copy.content,
        serde_json::from_str::<StructuredThreadMessageContent>(&content).unwrap()
    );
    assert!(
        copy.source_agent_run_id.is_none()
            && copy.camp_turn_id.is_none()
            && copy.runtime_model.is_none()
    );
    assert_eq!(copy.created_at, "2020-01-01T00:00:00Z");
    assert_eq!(copy.attachments[0].display_name, "missing.txt");
    assert_eq!(
        copy.attachments
            .iter()
            .map(|a| a.display_name.as_str())
            .collect::<Vec<_>>(),
        vec!["missing.txt", "legacy.txt", "managed.txt"]
    );
    assert_eq!(copy.quotes[0].text, "saved excerpt");
    let quote_source = copy.quotes[0].source.as_ref().unwrap();
    assert_eq!(quote_source.camp_id, target);
    assert_eq!(quote_source.message_id, snapshot.messages[0].id);
    assert!(copy.quotes[1..].iter().all(|q| q.source.is_none()));
    assert_eq!(
        crate::message_quote::model_quotes(&copy.quotes),
        crate::message_quote::model_quotes(&crate::message_quote::parse_quotes(&quote).unwrap())
    );
    let stored: (Option<String>, String, String) = db.connection().query_row(
        "SELECT presentation_json,recipient_presentation_json,quotes_json FROM camp_message WHERE id=?1",
        [&copy.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))
    ).unwrap();
    assert_eq!((stored.0, stored.1), (None, "{}".into()));
    for retired in ["sourceContentDigest", "snapshotDigest", "locator"] {
        assert!(!stored.2.contains(retired));
    }
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT quotes_json FROM camp_message WHERE id=?1",
                [&anchor],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        quote
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT presentation_json FROM camp_message WHERE id=?1",
                [&anchor],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "{\"legacyDisplay\":true}"
    );
    let reference: (String, String) = db
        .connection()
        .query_row(
            "SELECT kind,value FROM camp_message_reference WHERE camp_message_id=?1",
            [&copy.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(reference, ("issue".into(), "issue-42".into()));
    let mention: String = db
        .connection()
        .query_row(
            "SELECT agent_id FROM camp_message_mention WHERE camp_message_id=?1",
            [&copy.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mention, "agent_2");
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT status FROM agent_run WHERE id=?1",
                [&source_run],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "running"
    );
    assert_eq!(
        copy.attachments[0].pasted_text_preview.as_deref(),
        Some("kept preview")
    );
    let title: String = db
        .connection()
        .query_row("SELECT title FROM camp WHERE id=?1", [&target], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title.chars().count(), 80);
    assert!(title.ends_with(" 副本"));
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT status FROM camp_member WHERE camp_id=?1 AND agent_id='agent_2'",
                [&target],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "left"
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT status FROM camp_member WHERE camp_id=?1 AND agent_id='agent_1'",
                [&target],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "active"
    );
    for (table, n) in before {
        assert_eq!(count(&db, table), n, "{table}");
    }
    assert_eq!(count(&db, "camp_message"), 114);
    assert!(
        db.connection()
            .query_row(
                "SELECT source_operation_id IS NULL FROM camp_message WHERE id=?1",
                [&copy.id],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
    let second = fork(&mut db, &root, "again", &target, Some(&copy.id));
    assert_eq!(second.result.status, CommandResultStatus::Applied);
    let second_id = second.result.payload["threadId"].as_str().unwrap();
    let second_snapshot = crate::read_model::ReadModelService
        .camp_snapshot(&mut db, second_id)
        .unwrap();
    let second_source = second_snapshot.messages[2].quotes[0]
        .source
        .as_ref()
        .unwrap();
    assert_eq!(second_source.camp_id, second_id);
    assert_eq!(second_source.message_id, second_snapshot.messages[0].id);
    // Agent 3 remains needed by frozen recipients above. Once it occurs only in
    // captured quote authors, its frozen name is sufficient without a Left row.
    db.connection()
        .execute(
            "UPDATE camp_message SET effective_recipient_ids_json='[\"agent_2\"]' WHERE id=?1",
            [&second_snapshot.messages[2].id],
        )
        .unwrap();
    let quote_only = fork(&mut db, &root, "quote-author-only", second_id, None);
    let quote_only_id = quote_only.result.payload["threadId"].as_str().unwrap();
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_member WHERE camp_id=?1 AND agent_id='agent_3'",
                [quote_only_id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    let quote_only_snapshot = crate::read_model::ReadModelService
        .camp_snapshot(&mut db, quote_only_id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&quote_only_snapshot.messages[2].quotes[0]).unwrap()["authorAtCapture"]
            ["displayName"],
        "历史作者"
    );
    let full = fork(&mut db, &root, "full", &source, None);
    let full_id = full.result.payload["threadId"].as_str().unwrap();
    let full_snapshot = crate::read_model::ReadModelService
        .camp_snapshot(&mut db, full_id)
        .unwrap();
    assert_eq!(full_snapshot.messages.len(), 109);
    assert!(full_snapshot.messages.iter().all(|m| m.id != unpublished));
    assert!(
        full_snapshot
            .messages
            .iter()
            .any(|m| m.withdrawn && m.body.is_empty())
    );
    let full_quote = &full_snapshot
        .messages
        .iter()
        .find(|m| m.sequence == 3)
        .unwrap()
        .quotes;
    let outside_copy = full_snapshot
        .messages
        .iter()
        .find(|m| m.sequence == 7)
        .unwrap();
    assert_eq!(
        full_quote[1].source.as_ref().unwrap().message_id,
        outside_copy.id
    );
    assert!(full_quote[2..].iter().all(|q| q.source.is_none()));
    let withdrawn_copy = full_snapshot.messages.iter().find(|m| m.withdrawn).unwrap();
    for id in [&withdrawn, &withdrawn_copy.id] {
        assert_eq!(db.connection().query_row("SELECT (SELECT COUNT(*) FROM camp_message_reference WHERE camp_message_id=?1)+(SELECT COUNT(*) FROM camp_message_mention WHERE camp_message_id=?1)",[id],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    assert!(db.connection().query_row("SELECT c.navigation_completion_sequence<=v.last_seen_global_sequence FROM camp c JOIN camp_view_state v ON v.camp_id=c.id WHERE c.id=?1",[&target],|r|r.get::<_,bool>(0)).unwrap());
    // The copy is immediately readable through the existing context/history SQL;
    // restore Presence, then use the ordinary one-shot public send and Delivery path.
    db.connection()
        .execute(
            "UPDATE agent_profile SET profile_status='present' WHERE id='agent_1'",
            [],
        )
        .unwrap();
    crate::agent_profile::configure_test_runtime(&db, &["agent_1"]);
    let sent = ordinary_send(&mut db, &target, "normal-send");
    assert_eq!(
        sent.result.payload["deliveryIds"].as_array().unwrap().len(),
        1
    );
    let runs = crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 10).unwrap();
    assert_eq!(runs.len(), 1);
    let frozen: String = db
        .connection()
        .query_row(
            "SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?1",
            [&runs[0]],
            |r| r.get(0),
        )
        .unwrap();
    let input: serde_json::Value = serde_json::from_str(&frozen).unwrap();
    assert_eq!(input["runInput"]["messages"][0]["senderType"], "user");
    let mut claim = envelope(
        "claim-copy",
        crate::runtime::ClaimAgentRunCommand {
            agent_run_id: runs[0].clone(),
            expected_version: 1,
            lease_owner: "fixture-scheduler".into(),
            lease_seconds: 60,
            workspace: None,
            starting_git_observation: None,
        },
    );
    claim.actor = ActorRef::System {
        component_id: "agent-run-scheduler".into(),
    };
    claim.camp_id = Some(target.clone());
    let claim = crate::runtime::ExecutionRuntimeService::default()
        .claim_agent_run(&mut db, &claim)
        .unwrap();
    let epoch = claim.result.payload["executionEpoch"].as_i64().unwrap();
    crate::team_tool::TeamToolService::default()
        .prepare_binding_credential(&mut db, &runs[0], epoch, false)
        .unwrap();
    let built = crate::context::ContextService
        .materialize(
            &mut db,
            &crate::managed_blob::ManagedBlobStore::new(&root),
            &crate::context::MaterializeContextRequest {
                agent_run_id: &runs[0],
                execution_epoch: epoch,
                charter_delivery_mode: crate::context::CharterDeliveryMode::NativeAppend,
                max_payload_bytes: 500_000,
            },
        )
        .unwrap();
    let crate::context::ContextMaterialization::Ready(context) = built else {
        panic!("ordinary context must be ready")
    };
    assert!(context.runtime_payload.contains("continue"));
    let history = crate::camp_history::ThreadHistoryService
        .read(
            &mut db,
            &crate::team_tool::AuthenticatedTeamToolRun {
                camp_id: target.clone(),
                agent_id: "agent_1".into(),
                agent_run_id: runs[0].clone(),
                execution_epoch: epoch,
            },
            &crate::camp_history::ThreadReadInput {
                camp_id: Some(target.clone()),
                message_id: Some(copy.id.clone()),
                thread: None,
                before: None,
                after: None,
                limit: None,
            },
        )
        .unwrap();
    assert!(
        serde_json::to_string(&history)
            .unwrap()
            .contains("saved excerpt")
    );
    // Frozen recipients are publication data. Reading copied history must not
    // reconstruct them from text, today's roster, or addressed recipients alone.
    let source_history = crate::camp_history::ThreadHistoryService
        .read(
            &mut db,
            &crate::team_tool::AuthenticatedTeamToolRun {
                camp_id: target.clone(),
                agent_id: "agent_1".into(),
                agent_run_id: runs[0].clone(),
                execution_epoch: epoch,
            },
            &crate::camp_history::ThreadReadInput {
                camp_id: Some(source.clone()),
                message_id: Some(anchor.clone()),
                thread: None,
                before: None,
                after: None,
                limit: None,
            },
        )
        .unwrap();
    let mentions = &source_history["items"][0]["mentions"];
    assert_eq!(
        mentions
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["agent_2", "agent_3", "user"]
    );
    assert_eq!(&history["items"][0]["mentions"], mentions);
    assert_ne!(
        sent.result.status,
        CommandResultStatus::Rejected,
        "{:?}",
        sent.result
    );
    assert_eq!(
        db.connection()
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id=?1",
                [&target],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );
}

// New admission owner: preserves null Leads/zero members while rejecting invalid
// anchors and source lifecycle states; ordinary creation intentionally stays strict.
#[test]
fn fork_admission_preserves_empty_membership_and_rejects_unavailable_anchors() {
    let (mut db, source) = fixture();
    let root = db.directory().to_path_buf();
    assert!(
        serde_json::from_value::<ForkThreadCommand>(
            json!({"sourceThreadId":Uuid::new_v4().to_string()})
        )
        .is_err(),
        "private Conversation IDs are not Thread sources"
    );
    db.connection().execute_batch("INSERT INTO channel_conversation(id,provider,tenant_key,chat_id,conversation_kind,display_name,last_sender_display_name,first_seen_at,last_seen_at) VALUES('fork-channel','feishu','fixture','fixture-chat','group','channel','Owner','2020-01-01','2020-01-01')").unwrap();
    db.connection().execute("INSERT INTO channel_conversation_binding(id,channel_conversation_id,execution_scope_kind,camp_id,status,generation,created_at,updated_at) VALUES('fork-binding','fork-channel','quick_chat',?1,'active',1,'2020-01-01','2020-01-01')",[&source]).unwrap();
    let no_history = fork(&mut db, &root, "empty-public", &source, None);
    assert_eq!(no_history.result.status, CommandResultStatus::Applied);
    assert!(
        !db.connection()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM channel_conversation_binding WHERE camp_id=?1)",
                [no_history.result.payload["threadId"].as_str().unwrap()],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
    // Scheduled instructions are visible, formally published system messages.
    // Both full and anchored copies must keep them and the reply edge, while
    // hidden event/legacy-approval rows remain outside public history.
    let scheduled = no_history.result.payload["threadId"].as_str().unwrap();
    let instruction = message(&mut db, scheduled, 1, "local_user", true);
    db.connection().execute("UPDATE camp_message SET author_type='system',author_id='scheduled-run',origin_kind='automation' WHERE id=?1", [&instruction]).unwrap();
    let mut hidden = Vec::new();
    for (seq, kind) in [(2, "a2a_event"), (3, "task_event")] {
        let id = message(&mut db, scheduled, seq, "agent_1", true);
        db.connection()
            .execute(
                "UPDATE camp_message SET presentation_json=?2 WHERE id=?1",
                params![id, json!({"kind":kind}).to_string()],
            )
            .unwrap();
        hidden.push(id);
    }
    let approval = message(&mut db, scheduled, 4, "local_user", true);
    db.connection()
        .execute(
            "UPDATE camp_message SET author_type='system',author_id='approval' WHERE id=?1",
            [&approval],
        )
        .unwrap();
    let answer = message(&mut db, scheduled, 5, "agent_1", true);
    db.connection()
        .execute(
            "UPDATE camp_message SET reply_to_camp_message_id=?2 WHERE id=?1",
            params![answer, instruction],
        )
        .unwrap();
    for (command_id, anchor) in [
        ("scheduled-full", None),
        ("scheduled-anchor", Some(answer.as_str())),
    ] {
        let copied = fork(&mut db, &root, command_id, scheduled, anchor);
        let snapshot = crate::read_model::ReadModelService
            .camp_snapshot(&mut db, copied.result.payload["threadId"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            snapshot
                .messages
                .iter()
                .map(|m| m.sequence)
                .collect::<Vec<_>>(),
            vec![1, 5]
        );
        assert_eq!(snapshot.messages[0].body, "history 1");
        assert_eq!(
            snapshot.messages[1].reply_to_camp_message_id.as_deref(),
            Some(snapshot.messages[0].id.as_str())
        );
    }
    for (i, id) in hidden.iter().chain([&instruction, &approval]).enumerate() {
        assert_eq!(
            fork(
                &mut db,
                &root,
                &format!("hidden-anchor-{i}"),
                scheduled,
                Some(id)
            )
            .result
            .code,
            "camp.fork_anchor_unavailable"
        );
    }
    db.connection().execute("INSERT INTO mission(id,number,camp_id,title,description,status,tags_json,source_attachments_json,details_version,created_at,updated_at) VALUES('mission-fixture',1,?1,'Mission','description','not_started','[]','[]',1,'2020-01-01','2020-01-01')",[&source]).unwrap();
    assert_eq!(
        fork(&mut db, &root, "reject-mission", &source, None)
            .result
            .code,
        "camp.fork_source_unavailable"
    );
    db.connection()
        .execute("DELETE FROM mission WHERE camp_id=?1", [&source])
        .unwrap();
    let user = message(&mut db, &source, 1, "local_user", true);
    let agent = message(&mut db, &source, 2, "agent_1", true);
    let unpublished = message(&mut db, &source, 3, "agent_1", false);
    for (i, id) in [&user, &unpublished, &Uuid::new_v4().to_string()]
        .into_iter()
        .enumerate()
    {
        assert_eq!(
            fork(&mut db, &root, &format!("bad-{i}"), &source, Some(id))
                .result
                .code,
            "camp.fork_anchor_unavailable"
        );
    }
    for column in ["recall_state='withdrawn'", "tombstoned_at='2020-01-01'"] {
        db.connection()
            .execute(
                &format!("UPDATE camp_message SET {column} WHERE id=?1"),
                [&agent],
            )
            .unwrap();
        assert_eq!(
            fork(&mut db, &root, column, &source, Some(&agent))
                .result
                .code,
            "camp.fork_anchor_unavailable"
        );
        db.connection()
            .execute(
                "UPDATE camp_message SET recall_state='ineligible',tombstoned_at=NULL WHERE id=?1",
                [&agent],
            )
            .unwrap();
    }
    db.connection().execute("UPDATE camp_member SET leave_requested_at='2020-01-01',leave_request_command_id='leaving' WHERE camp_id=?1 AND agent_id='agent_1'",[&source]).unwrap();
    assert_eq!(
        fork(&mut db, &root, "lead-left", &source, None).result.code,
        "camp.invalid_default_lead"
    );
    db.connection()
        .execute(
            "UPDATE camp SET default_lead_agent_id=NULL WHERE id=?1",
            [&source],
        )
        .unwrap();
    db.connection()
        .execute(
            "UPDATE camp_member SET status='left',left_at='2020-01-01' WHERE camp_id=?1",
            [&source],
        )
        .unwrap();
    let empty = fork(&mut db, &root, "zero", &source, None);
    assert_eq!(empty.result.status, CommandResultStatus::Applied);
    assert!(
        db.connection()
            .query_row(
                "SELECT default_lead_agent_id IS NULL FROM camp WHERE id=?1",
                [empty.result.payload["threadId"].as_str().unwrap()],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
    for (i, update) in [
        "activation_state='pending'",
        "activation_state='active',deletion_operation_id='deleting'",
    ]
    .into_iter()
    .enumerate()
    {
        db.connection()
            .execute(&format!("UPDATE camp SET {update} WHERE id=?1"), [&source])
            .unwrap();
        assert_eq!(
            fork(&mut db, &root, &format!("state-{i}"), &source, None)
                .result
                .code,
            "camp.fork_source_unavailable"
        );
    }
}

// New receipt owner: late SQL failure must roll back bulk data and the receipt;
// replay survives deletion and concurrent submissions return the single result.
#[test]
fn fork_rolls_back_late_failures_and_replays_after_both_threads_are_deleted() {
    let (mut db, source) = fixture();
    let root = db.directory().to_path_buf();
    message(&mut db, &source, 1, "agent_1", true);
    let original = count(&db, "camp");
    let original_messages = count(&db, "camp_message");
    db.connection().execute_batch("CREATE TEMP TRIGGER fail_fork_receipt BEFORE INSERT ON event_log WHEN NEW.event_type='command.result' AND NEW.command_type='camp.fork' BEGIN SELECT RAISE(ABORT,'late receipt failure'); END;").unwrap();
    let env = envelope("stable", request(&source, None));
    assert!(fork_thread(&mut db, &env, &root).is_err());
    assert_eq!(count(&db, "camp"), original);
    assert_eq!(count(&db, "camp_message"), original_messages);
    db.connection()
        .execute_batch("DROP TRIGGER fail_fork_receipt")
        .unwrap();
    // Two independently opened writers race on the same first submission. The
    // IMMEDIATE transaction's second receipt lookup must admit exactly one copy.
    let left_db = Database::open(&root).unwrap();
    let right_db = Database::open(&root).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let start = |mut database: Database| {
            let barrier = barrier.clone();
            let root = &root;
            let env = &env;
            scope.spawn(move || {
                barrier.wait();
                fork_thread(&mut database, env, root).unwrap()
            })
        };
        let left = start(left_db);
        let right = start(right_db);
        [left.join().unwrap(), right.join().unwrap()]
    });
    assert_eq!(results[0].result, results[1].result);
    assert_ne!(results[0].replayed, results[1].replayed);
    assert_eq!(count(&db, "camp"), original + 1);
    let successful = results[0].clone();
    let target = successful.result.payload["threadId"]
        .as_str()
        .unwrap()
        .to_string();
    let tx = db.connection_mut().transaction().unwrap();
    crate::collaboration::delete_camp_aggregate(&tx, &source).unwrap();
    crate::collaboration::delete_camp_aggregate(&tx, &target).unwrap();
    tx.commit().unwrap();
    std::fs::remove_dir_all(root.join("quick-chat")).unwrap();
    let replay = fork_thread(&mut db, &env, &root).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.result, successful.result);
    assert_eq!(count(&db, "camp"), original - 1);
}
