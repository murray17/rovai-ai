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
        let initial = domain_state(&database, &camp);
        let send = message(&camp, &["agent_2", "agent_2"], broadcast);

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

        // These normal rejections happen after tentative membership writes.
        let mut bad_reply = send.clone();
        bad_reply.reply_to_camp_message_id = Some("missing-message".into());
        let mut bad_task = send.clone();
        bad_task.execution.as_mut().unwrap().task_id = Some("missing-task".into());
        for (label, input) in [("reply", bad_reply), ("task", bad_task)] {
            let command = envelope(&format!("reject-{broadcast}-{label}"), Some(&camp), input);
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
        }

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
        assert!(
            service
                .send_user_camp_message(&mut database, &conflict)
                .is_err()
        );
        assert_eq!(domain_state(&database, &camp), committed);
    }
}
