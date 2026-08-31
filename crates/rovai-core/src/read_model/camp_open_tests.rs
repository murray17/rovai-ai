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
fn business_fixture() -> (OwnedTestDatabase, String) {
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
            assignee_agent_id, created_by_type, created_by_id, version, created_at, updated_at
        ) VALUES ('open-task', ?1, '旧任务', '保留任务业务数据', '[]', 'pending',
                  'agent_2', 'user', 'local_user', 1, ?2, ?2)"#,
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
                 'agent', conversation.agent_id, agent_run.id, '交接',
                 '[{"kind":"text","text":"交接"}]', 'sha256:open-message', 'default',
                 '[]', agent_run.camp_turn_id, 1, ?3, ?3
          FROM agent_run JOIN conversation ON conversation.id = agent_run.conversation_id
          WHERE agent_run.id = ?2"#,
            params![camp_id, completed_run, now],
        )
        .unwrap();
    connection.execute(
        r#"INSERT INTO message_delivery (
            id, camp_id, camp_turn_id, message_id, recipient_agent_id,
            recipient_canonical_position, recipient_digest, message_body_digest,
            source_agent_run_id, edge_kind, a2a_root_agent_run_id, target_parent_agent_run_id, a2a_depth,
            ancestor_agent_ids_json, recipient_presentation_snapshot_json,
            frozen_snapshot_json, queue_sequence, status, dispatch_phase,
            created_at, updated_at, recipient_membership_version_at_admission
        ) SELECT 'open-delivery', ?1, agent_run.camp_turn_id, 'open-agent-message',
                 conversation.agent_id, 0, 'sha256:open-recipient', 'sha256:open-message',
                 ?2, 'forward', ?2, ?2, 1, '[]', '{}', '{}', 1, 'pending', 'never_attempted',
                 ?4, ?4, 1
          FROM agent_run JOIN conversation ON conversation.id = agent_run.conversation_id
          WHERE agent_run.id = ?3"#,
        params![camp_id, completed_run, active_run, now],
    ).unwrap();
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
    (database, camp_id)
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

#[test]
fn camp_open_preserves_business_state_without_reading_event_history() {
    let (mut database, camp_id) = business_fixture();
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
    assert_eq!(open.schema_version, 6);
    assert_eq!(open_json["camp"], snapshot_json["camp"]);
    for collection in [
        "members",
        "tasks",
        "turns",
        "agentRuns",
        "approvals",
        "messageDeliveries",
        "agentRunFileChanges",
        "executionEvidence",
    ] {
        let mut actual = open_json[collection].as_array().unwrap().clone();
        let mut expected = snapshot_json[collection].as_array().unwrap().clone();
        assert!(!actual.is_empty(), "missing {collection}");
        // Open prioritizes non-terminal Runs; the full diagnostic Snapshot has
        // its own ordering. Compare complete Run objects by identity, not position.
        if collection == "agentRuns" {
            actual.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            expected.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
        }
        assert_eq!(actual, expected, "changed {collection}");
    }
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
fn camp_open_work_is_independent_of_unrelated_event_volume() {
    let (mut database, camp_id) = business_fixture();
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
}
