use super::*;
use crate::{
    collaboration::{
        CollaborationService, ProjectBindingKind, TestCampConversationCommand,
        TestCampMessageAddress,
    },
    command::{ActorRef, CommandEnvelope},
    test_support::{OwnedTestDatabase, seeded_runtime_database_fast_owned},
};
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use serde_json::json;
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
    },
    time::{Duration, Instant},
};

// These tests own the complete CampOpen SQL boundary. A pure query test cannot
// detect an event read introduced by message hydration or another nested loader.
fn business_fixture() -> (OwnedTestDatabase, String, String, String) {
    let mut database = seeded_runtime_database_fast_owned();
    let workspace = database.directory().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let created = CollaborationService::default()
        .create_test_camp_conversation(
            &mut database,
            &CommandEnvelope {
                command_id: "camp-open-business-fixture".to_string(),
                actor: ActorRef::User {
                    user_id: "local_user".to_string(),
                },
                camp_id: None,
                expected_versions: vec![],
                execution_epoch: None,
                payload: TestCampConversationCommand {
                    project_binding_kind: ProjectBindingKind::Directory,
                    project_path: workspace.to_string_lossy().to_string(),
                    body: "保留业务状态".to_string(),
                    address: TestCampMessageAddress::Explicit {
                        agent_ids: vec!["agent_1".to_string(), "agent_2".to_string()],
                    },
                    purpose: "CampOpen SQL isolation".to_string(),
                },
            },
        )
        .unwrap();
    let camp_id = created.result.payload["campId"]
        .as_str()
        .unwrap()
        .to_string();
    let completed_run = created.result.payload["agentRunIds"][0].as_str().unwrap();
    let active_run = created.result.payload["agentRunIds"][1].as_str().unwrap();
    let connection = database.connection();
    let now = "2026-08-31T00:00:00Z";
    connection.execute(
        "UPDATE agent_run SET execution_epoch = 1, status = 'succeeded', ended_at = ?2 WHERE id = ?1",
        params![completed_run, now],
    ).unwrap();
    connection.execute(
        "UPDATE agent_run SET execution_epoch = 1, status = 'running', started_at = ?2 WHERE id = ?1",
        params![active_run, now],
    ).unwrap();
    connection
        .execute(
            r#"INSERT INTO task (
            id, camp_id, title, description, acceptance_criteria_json, status,
            assignee_agent_id, created_by_type, created_by_id, created_at, updated_at
        ) VALUES ('open-task', ?1, '旧任务', '保留任务业务数据', '[]', 'pending',
                  'agent_2', 'user', 'local_user', ?2, ?2)"#,
            params![camp_id, now],
        )
        .unwrap();
    // Supported historical shape: the event has no direct Camp identity.
    connection
        .execute(
            r#"INSERT INTO event_log (
            event_id, task_id, sequence, event_type, camp_id, entity_type,
            entity_id, payload_json, created_at
        ) VALUES ('legacy-open-task-event', 'open-task', 1, 'task.created', NULL,
                  'task', 'open-task', '{}', ?1)"#,
            [now],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO agent_run_execution_evidence (
            id, agent_run_id, execution_epoch, sequence, event_type, kind, phase,
            payload_preview_json, content_byte_count, is_truncated, occurred_at
        ) VALUES ('open-evidence', ?1, 1, 1, 'agent.text.delta', 'narration', 'updated',
                  '{"delta":"仍在执行"}', 12, 0, ?2)"#,
            params![active_run, now],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO action_execution (
            id, agent_run_id, action_kind, action_schema_version, action_digest,
            digest_algorithm, canonicalization_version, canonical_input_json,
            input_completeness, action_summary, execution_authority, control_mode,
            policy_decision, policy_version, status, created_at, updated_at
        ) VALUES ('open-action', ?1, 'test.action', '1', 'sha256:open-action',
                  'sha256', 'canonical-json-v1', '{}', 'complete', '等待用户批准',
                  'core', 'mediated', 'ask', '1', 'prepared', ?2, ?2)"#,
            params![active_run, now],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO approval (
            id, action_id, action_kind, action_digest, digest_algorithm,
            canonicalization_version, action_summary, requested_for_user_id,
            request_policy_version, request_json, reason, status, requested_at, updated_at
        ) VALUES ('open-approval', 'open-action', 'test.action', 'sha256:open-action',
                  'sha256', 'canonical-json-v1', '等待用户批准', 'local_user', '1',
                  '{}', '确认操作', 'pending', ?1, ?1)"#,
            [now],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO managed_blob (
            id, sha256, byte_size, media_type, storage_relative_path, state,
            sensitivity, created_at, updated_at
        ) VALUES ('open-file-blob', 'sha256:open-file', 2, 'application/json',
                  'open-file.json', 'present', 'normal', ?1, ?1)"#,
            [now],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO agent_run_file_change_projection (
            agent_run_id, execution_epoch, schema_version, status, file_count,
            operation_count, files_summary_json, details_blob_id, source_evidence_ids_json,
            completed_at, created_at
        ) VALUES (?1, 1, 2, 'complete', 1, 1, ?2, 'open-file-blob', '[]', ?3, ?3)"#,
            params![
                completed_run,
                json!([{
                    "evidenceFileId": "open-file", "path": "src/fixture.rs", "changeKind": "update",
                    "presentationKind": "operation_history", "operationCount": 1
                }])
                .to_string(),
                now
            ],
        )
        .unwrap();
    let message_id: String = connection.query_row(
        "SELECT id FROM camp_message WHERE camp_id = ?1 AND author_type = 'user' ORDER BY sequence LIMIT 1",
        [&camp_id], |row| row.get(0),
    ).unwrap();
    connection
        .execute(
            r#"INSERT INTO camp_message (
            id, camp_id, sequence, author_type, author_id, source_agent_run_id,
            body, structured_content_json, content_digest, address_mode,
            addressed_agent_ids_json, camp_turn_id, version, created_at, updated_at
        ) SELECT 'open-agent-message', ?1,
                 (SELECT MAX(sequence) + 1 FROM camp_message WHERE camp_id = ?1),
                 'agent', source_conversation.agent_id, source_run.id, '交接',
                 '[{"kind":"text","text":"交接"}]', 'sha256:open-message', 'default',
                 json_array(target_conversation.agent_id), NULL, 1, ?4, ?4
          FROM agent_run AS source_run
          JOIN conversation AS source_conversation
            ON source_conversation.id = source_run.conversation_id
          JOIN agent_run AS target_run ON target_run.id = ?3
          JOIN conversation AS target_conversation
            ON target_conversation.id = target_run.conversation_id
          WHERE source_run.id = ?2"#,
            params![camp_id, completed_run, active_run, now],
        )
        .unwrap();
    // Exercise the current Delivery-first storage seam. Writing the retired
    // message_delivery table here would let Camp Open drift from publication
    // while this boundary test continued to pass.
    connection
        .execute(
            r#"INSERT INTO camp_message_delivery (
            id, camp_id, message_id, recipient_agent_id,
            recipient_membership_version_at_admission, queue_sequence,
            status, claimed_agent_run_id, failure_code, version,
            created_at, claimed_at, ended_at, updated_at
        ) SELECT 'open-delivery', ?1, 'open-agent-message', conversation.agent_id,
                 camp_member.version,
                 (SELECT sequence FROM camp_message WHERE id = 'open-agent-message'),
                 'claimed', ?2, NULL, 1, ?3, ?3, NULL, ?3
          FROM agent_run
          JOIN conversation ON conversation.id = agent_run.conversation_id
          JOIN camp_member
            ON camp_member.camp_id = ?1
           AND camp_member.agent_id = conversation.agent_id
          WHERE agent_run.id = ?2"#,
            params![camp_id, active_run, now],
        )
        .unwrap();
    let attachment_path = database.directory().join("open-attachment.txt");
    std::fs::write(&attachment_path, "attachment").unwrap();
    connection
        .execute(
            r#"INSERT INTO message_attachment (
            id, camp_id, camp_message_id, position, display_name, media_type, byte_size,
            content_digest, storage_path, preview_kind, created_by_type, created_by_id, created_at
        ) VALUES ('open-attachment', ?1, ?2, 0, 'attachment.txt', 'text/plain', 10,
                  'sha256:open-attachment', ?3, 'none', 'user', 'local_user', ?4)"#,
            params![camp_id, message_id, attachment_path.to_string_lossy(), now],
        )
        .unwrap();
    (
        database,
        camp_id,
        completed_run.to_string(),
        active_run.to_string(),
    )
}

fn deny_event_log(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Read {
            table_name: "event_log",
            ..
        } => Authorization::Deny,
        _ => Authorization::Allow,
    }
}

fn read_metered(database: &mut Database, camp_id: &str) -> (CampOpenProjection, usize, Duration) {
    let steps = Arc::new(AtomicUsize::new(0));
    let observed_steps = Arc::clone(&steps);
    database
        .connection()
        .authorizer(Some(deny_event_log))
        .unwrap();
    database
        .connection()
        .progress_handler(
            1,
            Some(move || {
                observed_steps.fetch_add(1, AtomicOrdering::Relaxed);
                false
            }),
        )
        .unwrap();
    let started = Instant::now();
    let result = ReadModelService.camp_open_projection(database, camp_id);
    let elapsed = started.elapsed();
    database
        .connection()
        .progress_handler(0, None::<fn() -> bool>)
        .unwrap();
    database
        .connection()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    (
        result.expect("CampOpen must succeed with every event_log read denied"),
        steps.load(AtomicOrdering::Relaxed),
        elapsed,
    )
}

fn append_waiting_user_deliveries(database: &mut Database, camp_id: &str, active_run: &str) {
    {
        let connection = database.connection();
        let recipient_agent_id: String = connection
            .query_row(
                r#"SELECT conversation.agent_id
                   FROM agent_run
                   JOIN conversation ON conversation.id = agent_run.conversation_id
                   WHERE agent_run.id = ?1"#,
                [active_run],
                |row| row.get(0),
            )
            .unwrap();
        for (index, created_at) in ["2026-08-31T00:00:01Z", "2026-08-31T00:00:02Z"]
            .into_iter()
            .enumerate()
        {
            let message_id = format!("open-user-waiting-{}", index + 1);
            let delivery_id = format!("open-user-waiting-delivery-{}", index + 1);
            let body = format!("排队消息 {}", index + 1);
            let structured_content = json!([{"kind": "text", "text": body}]).to_string();
            connection
                .execute(
                    r#"INSERT INTO camp_message (
                        id, camp_id, sequence, author_type, author_id,
                        body, structured_content_json, content_digest,
                        address_mode, addressed_agent_ids_json,
                        effective_recipient_ids_json, recipient_presentation_json,
                        agent_addressing_mode, origin_kind,
                        version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2,
                        (SELECT COALESCE(MAX(sequence), 0) + 1
                         FROM camp_message WHERE camp_id = ?2),
                        'user', 'local_user', ?3, ?4, ?5,
                        'explicit', json_array(?6), json_array(?6), '{}',
                        'automatic', 'local_composer', 1, ?7, ?7
                    )"#,
                    params![
                        message_id,
                        camp_id,
                        body,
                        structured_content,
                        format!("sha256:open-user-waiting-{}", index + 1),
                        recipient_agent_id,
                        created_at,
                    ],
                )
                .unwrap();
            connection
                .execute(
                    r#"INSERT INTO camp_message_delivery (
                        id, camp_id, message_id, recipient_agent_id,
                        recipient_membership_version_at_admission,
                        queue_sequence, status, version, created_at, updated_at
                    ) SELECT ?1, ?2, ?3, ?4, camp_member.version,
                             (SELECT COALESCE(MAX(queue_sequence), 0) + 1
                              FROM camp_message_delivery
                              WHERE camp_id = ?2 AND recipient_agent_id = ?4),
                             'waiting', 1, ?5, ?5
                      FROM camp_member
                      WHERE camp_member.camp_id = ?2
                        AND camp_member.agent_id = ?4"#,
                    params![
                        delivery_id,
                        camp_id,
                        message_id,
                        recipient_agent_id,
                        created_at,
                    ],
                )
                .unwrap();
        }
    }
}

#[test]
fn camp_open_preserves_business_state_without_reading_event_history() {
    let (mut database, camp_id, completed_run, active_run) = business_fixture();
    append_waiting_user_deliveries(&mut database, &camp_id, &active_run);
    let snapshot = ReadModelService
        .camp_snapshot(&mut database, &camp_id)
        .unwrap();
    assert!(
        snapshot
            .messages
            .iter()
            .any(|message| message.timeline_global_sequence.is_some())
    );
    assert!(
        snapshot
            .timeline
            .iter()
            .any(|event| event.event_id.as_deref() == Some("legacy-open-task-event"))
    );
    database
        .connection()
        .authorizer(Some(deny_event_log))
        .unwrap();
    assert!(
        database
            .connection()
            .query_row("SELECT COUNT(*) FROM event_log", [], |row| row
                .get::<_, i64>(0))
            .is_err()
    );
    let (open, _, _) = read_metered(&mut database, &camp_id);
    let open_json = serde_json::to_value(&open).unwrap();
    let snapshot_json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(open.schema_version, CAMP_OPEN_SCHEMA_VERSION);
    assert_eq!(open_json["camp"], snapshot_json["camp"]);
    let delivery = open
        .message_deliveries
        .iter()
        .find(|delivery| delivery.id == "open-delivery")
        .expect("Camp Open must project current camp_message_delivery rows");
    // The fixture starts with one user-authored Delivery for each addressed
    // Agent, then appends an Agent-authored hand-off and two waiting user
    // Deliveries. Camp Open must project all five current queue facts rather
    // than filtering by author.
    assert_eq!(open.message_deliveries.len(), 5);
    assert_eq!(delivery.message_id, "open-agent-message");
    assert_eq!(
        delivery.target_agent_run_id.as_deref(),
        Some(active_run.as_str())
    );
    assert!(matches!(
        &delivery.kind,
        MessageDeliveryKindView::PublicA2a {
            source_agent_run_id,
            recipient_canonical_position: 0,
            ..
        } if source_agent_run_id.as_deref() == Some(completed_run.as_str())
    ));
    let waiting = open
        .message_deliveries
        .iter()
        .filter(|delivery| delivery.id.starts_with("open-user-waiting-delivery-"))
        .collect::<Vec<_>>();
    assert_eq!(
        waiting.len(),
        2,
        "waiting user deliveries must reach Camp Open"
    );
    assert!(waiting.iter().all(|delivery| {
        delivery.status == "waiting"
            && delivery.dispatch_phase == "never_attempted"
            && delivery.target_agent_run_id.is_none()
            && matches!(
                &delivery.kind,
                MessageDeliveryKindView::PublicA2a {
                    source_agent_run_id: None,
                    ..
                }
            )
    }));
    assert_eq!(open.coverage.message_deliveries.loaded_count, 5);
    assert_eq!(open.coverage.message_deliveries.total_count, 5);
    assert_eq!(open.coverage.message_deliveries.omitted_count, 0);
    assert!(open.coverage.message_deliveries.complete);
    for collection in [
        "members",
        "tasks",
        "turns",
        "agentRuns",
        "approvals",
        "messageDeliveries",
        "agentRunFileChanges",
    ] {
        let mut actual = open_json[collection].as_array().unwrap().clone();
        let mut expected = snapshot_json[collection].as_array().unwrap().clone();
        // Delivery-first Runs no longer create CampTurns. Historical Turns must
        // still compare exactly when present, but an all-current fixture may
        // legitimately have none.
        if collection != "turns" {
            assert!(!actual.is_empty(), "missing {collection}");
        }
        // Open prioritizes non-terminal Runs; the full diagnostic Snapshot has
        // its own ordering. Compare complete Run objects by identity, not position.
        if collection == "agentRuns" {
            actual.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            expected.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
        }
        assert_eq!(actual, expected, "changed {collection}");
    }
    assert!(open.execution_evidence.is_empty());
    assert!(open_json["coverage"].get("executionEvidence").is_none());
    let mut expected_messages = snapshot_json["messages"].clone();
    for message in expected_messages.as_array_mut().unwrap() {
        message["timelineGlobalSequence"] = Value::Null;
    }
    assert_eq!(open_json["messages"], expected_messages);
    assert!(
        open.messages
            .iter()
            .any(|message| !message.attachments.is_empty())
    );
    assert!(open_json.get("timeline").is_none());
    assert!(open_json["coverage"].get("timeline").is_none());
    assert_eq!(
        open.through_global_sequence,
        snapshot.through_global_sequence
    );
    database.connection().execute(
        "INSERT INTO event_log(event_type, payload_json, created_at) VALUES ('test.unrelated', '{}', '2026-08-31T00:00:00Z')", [],
    ).unwrap();
    let (refreshed, _, _) = read_metered(&mut database, &camp_id);
    assert_eq!(
        refreshed.through_global_sequence,
        open.through_global_sequence + 1
    );
    assert_eq!(
        serde_json::to_value(refreshed.messages).unwrap(),
        open_json["messages"]
    );
}

#[test]
fn camp_open_run_titles_survive_message_paging() {
    let (mut database, camp_id, completed_run, active_run) = business_fixture();
    let source_id: String = database.connection().query_row(
        "SELECT message_id FROM agent_run_input WHERE agent_run_id = ?1 ORDER BY ordinal LIMIT 1",
        [&active_run], |row| row.get(0),
    ).unwrap();
    // A later input/anchor must not replace the first input as its message falls
    // out of the conversation page. The fixture's hand-off is already claimed.
    database.connection().execute(
        "INSERT INTO agent_run_input(agent_run_id, ordinal, delivery_id, message_id, message_sequence, message_content_digest, context_manifest_version)
         SELECT ?1, 1, 'open-delivery', id, sequence, content_digest,
         (SELECT context_manifest_version FROM agent_run_input WHERE agent_run_id = ?1 AND ordinal = 0)
         FROM camp_message WHERE id = 'open-agent-message'",
        [&active_run],
    ).unwrap();
    database
        .connection()
        .execute(
            "UPDATE agent_run SET anchor_message_id = 'open-agent-message' WHERE id = ?1",
            [&active_run],
        )
        .unwrap();
    for sequence in 3..=32 {
        database.connection().execute(
            "INSERT INTO camp_message(id, camp_id, sequence, author_type, author_id, body,
             structured_content_json, content_digest, address_mode, addressed_agent_ids_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'user', 'local_user', '较新消息',
             '[{\"kind\":\"text\",\"text\":\"较新消息\"}]', 'sha256:later', 'default', '[]',
             '2026-08-31T00:00:00Z', '2026-08-31T00:00:00Z')",
            params![format!("title-page-{sequence}"), camp_id, sequence],
        ).unwrap();
    }
    // Exercise supported pre-batch Runs through the same summary loader.
    database.connection().execute(
        "INSERT INTO camp_turn(id, camp_id, trigger_type, trigger_id, status, created_at, updated_at,
         execution_budget_schema_version, execution_budget_accepted_at,
         execution_budget_max_agent_run_responsibilities, execution_budget_max_accepted_a2a,
         execution_budget_root_agent_run_responsibilities)
         VALUES ('title-legacy-turn', ?1, 'camp_message', ?2, 'running',
         '2026-08-31T00:00:00Z', '2026-08-31T00:00:00Z',
         1, '2026-08-31T00:00:00Z', 32, 16, 1)", params![camp_id, source_id],
    ).unwrap();
    database
        .connection()
        .execute(
            "DELETE FROM agent_run_input WHERE agent_run_id = ?1",
            [&completed_run],
        )
        .unwrap();
    database
        .connection()
        .execute(
            "UPDATE agent_run SET invocation_kind = 'direct', camp_turn_id = 'title-legacy-turn',
         camp_id = NULL, anchor_message_id = NULL, current_public_tail_sequence = NULL,
         trigger_camp_message_id = ?2 WHERE id = ?1",
            params![completed_run, source_id],
        )
        .unwrap();
    // Changing source state proves that summaries are read projections, not a
    // persisted duplicate that could keep erased content. Unicode is bounded
    // by scalars without splitting UTF-8; attachment metadata needs no file IO.
    let long_body = "花🌷".repeat(130);
    let shortened = format!("{}…", long_body.chars().take(239).collect::<String>());
    for (body, recall, tombstoned, expected) in [
        (
            "保留业务状态\n  并换行",
            "closed",
            false,
            Some("保留业务状态 并换行"),
        ),
        (
            long_body.as_str(),
            "closed",
            false,
            Some(shortened.as_str()),
        ),
        (" \n ", "closed", false, Some("attachment.txt")),
        (
            "should not escape",
            "withdrawn",
            false,
            Some("Message withdrawn"),
        ),
        ("deleted text", "closed", true, None),
    ] {
        database.connection().execute(
            "UPDATE camp_message SET body = ?2, structured_content_json = ?3,
             recall_state = ?4, tombstoned_at = CASE WHEN ?5 THEN '2026-08-31T00:00:00Z' END WHERE id = ?1",
            params![source_id, body, json!([{"kind":"text", "text":body}]).to_string(), recall, tombstoned],
        ).unwrap();
        let (open, _, _) = read_metered(&mut database, &camp_id);
        assert_eq!(open.messages.len(), 20);
        assert!(open.messages.iter().all(|message| message.id != source_id));
        for run in &open.agent_runs {
            assert_eq!(run.input_summary.as_deref(), expected, "{}", run.id);
        }
    }
}

#[test]
fn camp_open_work_is_independent_of_unrelated_event_and_evidence_volume() {
    let (mut database, camp_id, _, _) = business_fixture();
    let unrelated_workspace = database.directory().join("unrelated-workspace");
    std::fs::create_dir_all(&unrelated_workspace).unwrap();
    let unrelated = CollaborationService::default()
        .create_test_camp_conversation(
            &mut database,
            &CommandEnvelope {
                command_id: "camp-open-unrelated-evidence-fixture".to_string(),
                actor: ActorRef::User {
                    user_id: "local_user".to_string(),
                },
                camp_id: None,
                expected_versions: vec![],
                execution_epoch: None,
                payload: TestCampConversationCommand {
                    project_binding_kind: ProjectBindingKind::Directory,
                    project_path: unrelated_workspace.to_string_lossy().to_string(),
                    body: "无关会话".to_string(),
                    address: TestCampMessageAddress::Default,
                    purpose: "验证无关 Evidence 不影响 Camp Open".to_string(),
                },
            },
        )
        .unwrap();
    let unrelated_run_id = unrelated.result.payload["agentRunIds"][0]
        .as_str()
        .unwrap()
        .to_string();
    let (baseline, baseline_steps, _) = read_metered(&mut database, &camp_id);
    let base_sequence = baseline.through_global_sequence;
    let mut expected = serde_json::to_value(baseline).unwrap();
    expected
        .as_object_mut()
        .unwrap()
        .remove("throughGlobalSequence");
    let mut previous_volume = 0_i64;
    // Each scale is a different regression input; five reads report a bounded
    // latency sample. The gate is SQL VM work, not machine-dependent wall time.
    for volume in [50_000_i64, 500_000, 5_000_000] {
        let transaction = database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                r#"WITH RECURSIVE rows(n) AS (
                SELECT ?1 UNION ALL SELECT n + 1 FROM rows WHERE n < ?2
            )
            INSERT INTO event_log(global_sequence, event_type, payload_json, created_at)
            SELECT ?3 + n, 'test.unrelated', '{}', '2026-08-31T00:00:00Z' FROM rows"#,
                params![previous_volume + 1, volume, base_sequence],
            )
            .unwrap();
        transaction
            .execute(
                "UPDATE event_sequence SET last_sequence = ?1 WHERE singleton = 1",
                [base_sequence + volume],
            )
            .unwrap();
        transaction.commit().unwrap();
        let mut timings = Vec::new();
        for _ in 0..5 {
            let (open, steps, elapsed) = read_metered(&mut database, &camp_id);
            assert_eq!(
                steps, baseline_steps,
                "SQL work grew at {volume} unrelated events"
            );
            assert_eq!(open.through_global_sequence, base_sequence + volume);
            let mut actual = serde_json::to_value(open).unwrap();
            actual
                .as_object_mut()
                .unwrap()
                .remove("throughGlobalSequence");
            assert_eq!(actual, expected);
            timings.push(elapsed);
        }
        timings.sort();
        eprintln!(
            "camp_open_scale unrelated_events={volume} vm_steps={baseline_steps} median_ms={:.3} max_ms={:.3}",
            timings[2].as_secs_f64() * 1_000.0,
            timings[4].as_secs_f64() * 1_000.0
        );
        previous_volume = volume;
    }

    let (evidence_baseline, evidence_baseline_steps, _) = read_metered(&mut database, &camp_id);
    let mut evidence_expected = serde_json::to_value(evidence_baseline).unwrap();
    evidence_expected
        .as_object_mut()
        .unwrap()
        .remove("throughGlobalSequence");
    let mut previous_evidence_volume = 0_i64;
    for volume in [1_000_i64, 10_000, 100_000] {
        let transaction = database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                r#"WITH RECURSIVE rows(n) AS (
                SELECT ?1 UNION ALL SELECT n + 1 FROM rows WHERE n < ?2
            )
            INSERT INTO agent_run_execution_evidence(
                id, agent_run_id, execution_epoch, sequence,
                event_type, kind, phase, payload_preview_json,
                content_byte_count, is_truncated, occurred_at
            )
            SELECT 'unrelated-evidence-' || n, ?3, 0, n,
                   'runtime.action', 'command', 'completed', '{}',
                   0, 0, '2026-08-31T00:00:00Z'
            FROM rows"#,
                params![previous_evidence_volume + 1, volume, unrelated_run_id],
            )
            .unwrap();
        transaction.commit().unwrap();
        let (open, steps, elapsed) = read_metered(&mut database, &camp_id);
        // Moving the target key away from an index edge can add a constant
        // boundary check. The gate rejects work that scales with unrelated rows.
        assert!(
            steps <= evidence_baseline_steps + 4,
            "SQL work grew with {volume} unrelated Evidence rows: baseline={evidence_baseline_steps}, actual={steps}"
        );
        let mut actual = serde_json::to_value(open).unwrap();
        actual
            .as_object_mut()
            .unwrap()
            .remove("throughGlobalSequence");
        assert_eq!(actual, evidence_expected);
        eprintln!(
            "camp_open_scale unrelated_evidence={volume} vm_steps={evidence_baseline_steps} elapsed_ms={:.3}",
            elapsed.as_secs_f64() * 1_000.0
        );
        previous_evidence_volume = volume;
    }
}
