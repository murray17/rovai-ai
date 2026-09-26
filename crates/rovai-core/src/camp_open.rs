use std::time::{Duration, Instant};

use anyhow::Result;
use rusqlite::OptionalExtension;

use crate::{
    collaboration::{CollaborationService, ReconcileDefaultLeadCommand},
    command::{ActorRef, CommandEnvelope, CommandResultStatus, DomainCommandGateway},
    db::Database,
    read_model::{CampOpenProjection, ReadModelService},
};

#[derive(Debug)]
pub struct CampOpenOutcome {
    pub projection: CampOpenProjection,
    pub reconcile_duration: Option<Duration>,
    pub navigation_changed: bool,
    pub projection_duration: Duration,
}

#[derive(Debug, Default)]
pub struct CampOpenService;

impl CampOpenService {
    pub fn enter(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReconcileDefaultLeadCommand>,
    ) -> Result<CampOpenOutcome> {
        let camp_id = envelope.payload.camp_id.clone();
        let activation_state = database
            .connection()
            .query_row(
                "SELECT activation_state FROM camp WHERE id = ?1 AND deletion_operation_id IS NULL",
                [&camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if activation_state.is_none() {
            anyhow::bail!("Camp does not exist or is being deleted");
        }
        let pending = activation_state.as_deref() == Some("pending");
        // Enter may be a pure read. A real, previously submitted reconciliation still
        // replays its original receipt (including rejection) even if membership changed.
        let recorded = if pending {
            None
        } else {
            DomainCommandGateway.replay_if_recorded(database, envelope)?
        };
        let lead_valid: bool = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM camp JOIN camp_member ON camp_member.camp_id=camp.id AND camp_member.agent_id=camp.default_lead_agent_id JOIN agent_profile ON agent_profile.id=camp_member.agent_id WHERE camp.id=?1 AND camp_member.status='active' AND camp_member.leave_requested_at IS NULL AND agent_profile.profile_status='present')",
            [&camp_id], |row| row.get(0),
        )?;
        let mut navigation_changed = false;
        let reconcile_duration = if pending
            || (recorded.is_none() && lead_valid && matches!(envelope.actor, ActorRef::User { .. }))
        {
            None
        } else {
            let reconcile_started_at = Instant::now();
            let execution =
                CollaborationService::default().reconcile_default_lead(database, envelope)?;
            let reconcile_duration = reconcile_started_at.elapsed();
            if execution.result.status == CommandResultStatus::Rejected {
                anyhow::bail!(
                    "Camp enter Default Lead reconciliation was rejected: {}",
                    execution.result.code
                );
            }
            navigation_changed =
                !execution.replayed && execution.result.code == "camp.default_lead_reconciled";
            Some(reconcile_duration)
        };
        let projection_started_at = Instant::now();
        let projection = ReadModelService.camp_open_projection(database, &camp_id)?;
        Ok(CampOpenOutcome {
            projection,
            reconcile_duration,
            navigation_changed,
            projection_duration: projection_started_at.elapsed(),
        })
    }

    pub fn open(&self, database: &mut Database, camp_id: &str) -> Result<CampOpenOutcome> {
        let projection_started_at = Instant::now();
        let projection = ReadModelService.camp_open_projection(database, camp_id)?;
        Ok(CampOpenOutcome {
            projection,
            reconcile_duration: None,
            navigation_changed: false,
            projection_duration: projection_started_at.elapsed(),
        })
    }
}

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;
    use crate::{
        camp_attachment::CampAttachmentStore,
        collaboration::{CampActivationState, CreateCampCommand, ProjectBindingKind},
        command::ActorRef,
        execution_evidence::ExecutionEvidenceService,
        managed_blob::ManagedBlobStore,
    };
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    use serde_json::json;
    use uuid::Uuid;

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn enter_returns_only_the_post_reconcile_open_projection() {
        let directory =
            std::env::temp_dir().join(format!("rovai-camp-open-enter-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let mut create = CreateCampCommand::for_test_with_members(
            directory.join("workspace").to_string_lossy().to_string(),
            &["agent_1", "agent_2"],
            "agent_1",
        );
        create.project_binding_kind = ProjectBindingKind::Directory;
        let created = CollaborationService::default()
            .create_camp(
                &mut database,
                &user_envelope("camp-open-create", None, create),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();

        let outcome = CampOpenService
            .enter(
                &mut database,
                &user_envelope(
                    "camp-open-enter",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .unwrap();

        assert_eq!(
            outcome.projection.camp.default_lead_agent_id.as_deref(),
            Some("agent_2")
        );
        assert!(
            outcome
                .projection
                .members
                .iter()
                .any(|member| member.agent_id == "agent_2" && member.is_default_lead)
        );
        assert!(outcome.reconcile_duration.is_some());
        let stable_sequence = outcome.projection.through_global_sequence;
        let read_only_enter = CampOpenService
            .enter(
                &mut database,
                &user_envelope(
                    "camp-open-unchanged",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .unwrap();
        assert!(read_only_enter.reconcile_duration.is_none());
        assert_eq!(
            read_only_enter.projection.through_global_sequence,
            stable_sequence
        );
        let receipt_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE command_id='camp-open-unchanged'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(receipt_count, 0);
        let replay = CampOpenService
            .enter(
                &mut database,
                &user_envelope(
                    "camp-open-enter",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .unwrap();
        assert!(replay.reconcile_duration.is_some());
        assert_eq!(replay.projection.through_global_sequence, stable_sequence);
        assert_eq!(
            outcome.projection.schema_version,
            crate::read_model::CAMP_OPEN_SCHEMA_VERSION
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn open_and_read_only_enter_never_settle_work_or_write_managed_blobs() {
        use crate::collaboration::{
            ExecutionRequest, TestCampMessageAddress, TestCampMessageCommand,
        };
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let service = CollaborationService::default();
        let mut camps = Vec::new();
        for index in 0..2 {
            let mut create = CreateCampCommand::for_test_with_members(
                database
                    .directory()
                    .join(format!("workspace-{index}"))
                    .to_string_lossy()
                    .into_owned(),
                &["agent_1", "agent_2"],
                "agent_1",
            );
            create.project_binding_kind = ProjectBindingKind::Directory;
            let created = service
                .create_camp(
                    &mut database,
                    &user_envelope(&format!("create-repair-{index}"), None, create),
                )
                .unwrap();
            let camp_id = created.result.payload["campId"]
                .as_str()
                .unwrap()
                .to_string();
            let sent = service
                .send_test_camp_message(
                    &mut database,
                    &user_envelope(
                        &format!("send-repair-{index}"),
                        Some(&camp_id),
                        TestCampMessageCommand {
                            camp_id: camp_id.clone(),
                            draft_revision: None,
                            body: "repair scope".into(),
                            prepared_attachment_ids: Vec::new(),
                            address: TestCampMessageAddress::Broadcast,
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: None,
                                purpose: "repair scope".into(),
                                completion_role: "required".into(),
                                budget: None,
                            }),
                        },
                    ),
                )
                .unwrap();
            let runs = sent.result.payload["agentRunIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            assert_eq!(runs.len(), 2);
            for run in &runs {
                database.connection().execute("UPDATE agent_run SET status = 'waiting', wait_reason = 'runtime_delivery' WHERE id = ?1", [run]).unwrap();
            }
            database.connection().execute("UPDATE agent_run SET cancel_requested_at = '2026-08-31T00:00:00Z', cancel_reason_code = 'user_requested_agent_run_stop' WHERE id = ?1", [&runs[0]]).unwrap();
            camps.push((camp_id, runs));
        }

        // Recreate the exact retired CampTurn-linked shape that the old service repair owned.
        let legacy_trigger: String = database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id=?1",
                [&camps[0].1[0]],
                |row| row.get(0),
            )
            .unwrap();
        database.connection().execute(
            "INSERT INTO camp_turn(id,camp_id,trigger_type,trigger_id,status,created_at,updated_at) VALUES('open-legacy-turn',?1,'camp_message',?2,'waiting','2026-08-31T00:00:00Z','2026-08-31T00:00:00Z')",
            rusqlite::params![camps[0].0, legacy_trigger],
        ).unwrap();
        database.connection().execute(
            "UPDATE camp_turn SET execution_budget_schema_version=?2, execution_budget_accepted_at='2026-08-31T00:00:00Z', execution_budget_deadline_at='2026-09-01T00:00:00Z', execution_budget_elapsed_seconds=?3, execution_budget_max_agent_run_responsibilities=?4, execution_budget_max_accepted_a2a=?5, execution_budget_root_agent_run_responsibilities=?6, agent_run_responsibilities_allocated=0, accepted_a2a_allocated=0 WHERE id=?1",
            rusqlite::params![
                "open-legacy-turn",
                crate::execution_budget::CAMP_TURN_EXECUTION_BUDGET_SCHEMA_VERSION,
                crate::execution_budget::PRODUCT_MAX_EXECUTION_ELAPSED_SECONDS,
                crate::execution_budget::PRODUCT_MAX_AGENT_RUN_RESPONSIBILITIES,
                crate::execution_budget::PRODUCT_MAX_ACCEPTED_A2A,
                camps[0].1.len() as i64,
            ],
        ).unwrap();
        for run_id in &camps[0].1 {
            database.connection().execute(
                "UPDATE agent_run SET invocation_kind='direct', camp_id=NULL, anchor_message_id=NULL, current_public_tail_sequence=NULL, camp_turn_id='open-legacy-turn', trigger_camp_message_id=?2 WHERE id=?1",
                rusqlite::params![run_id, legacy_trigger],
            ).unwrap();
        }

        // Keep a large block in another Camp terminal only in SQLite. Opening either Camp must
        // not turn this in-memory read overlay into a Managed Blob write.
        let text_run = &camps[1].1[1];
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running', wait_reason=NULL, execution_epoch=1, started_at='2026-08-31T00:00:00Z', cancel_requested_at=NULL, cancel_reason_code=NULL WHERE id=?1",
                [text_run],
            )
            .unwrap();
        let blob_store = ManagedBlobStore::new(database.directory());
        let block = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                text_run,
                1,
                "agent.text.delta",
                &json!({"itemId":"pending-text","delta":"pending text ".repeat(2_000)}),
            )
            .unwrap()
            .unwrap();
        let block_id = block.payload["blockId"].as_str().unwrap().to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status='failed', ended_at='2026-08-31T00:00:01Z' WHERE id=?1",
                [text_run],
            )
            .unwrap();

        let managed_blobs = database.directory().join("managed-blobs");
        assert!(!managed_blobs.exists());
        let changes = database.connection().total_changes();
        database
            .connection()
            .authorizer(Some(|context: AuthContext<'_>| match context.action {
                AuthAction::Insert { .. }
                | AuthAction::Update { .. }
                | AuthAction::Delete { .. } => Authorization::Deny,
                _ => Authorization::Allow,
            }))
            .unwrap();
        let first_open = CampOpenService.open(&mut database, &camps[0].0);
        let second_open = CampOpenService.open(&mut database, &camps[1].0);
        let enter = CampOpenService.enter(
            &mut database,
            &user_envelope(
                "read-only-enter",
                Some(&camps[1].0),
                ReconcileDefaultLeadCommand {
                    camp_id: camps[1].0.clone(),
                },
            ),
        );
        database
            .connection()
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
            .unwrap();

        let first_projection = first_open.unwrap().projection;
        second_open.unwrap();
        let enter = enter.unwrap();
        assert!(enter.reconcile_duration.is_none());
        assert_eq!(
            first_projection
                .agent_runs
                .iter()
                .find(|run| run.id == camps[0].1[0])
                .unwrap()
                .status,
            "waiting"
        );
        assert_eq!(
            database.connection().total_changes(),
            changes,
            "Camp open and read-only enter must not execute SQL writes"
        );
        assert!(
            !managed_blobs.exists(),
            "Camp reads must not write Blob files"
        );
        let (phase, blob): (String, Option<String>) = database
            .connection()
            .query_row(
                "SELECT phase, content_blob_id FROM agent_run_execution_evidence WHERE id=?1",
                [&block_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(phase, "updated");
        assert!(blob.is_none());
        assert!(
            crate::execution_text::live_payload(&database, &block_id)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn enter_returns_pending_projection_without_default_lead_reconciliation() {
        let directory =
            std::env::temp_dir().join(format!("rovai-camp-open-pending-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let mut create = CreateCampCommand::for_test_with_members(
            directory.join("workspace").to_string_lossy().to_string(),
            &["agent_1", "agent_2"],
            "agent_1",
        );
        create.activation_state = CampActivationState::Pending;
        create.project_binding_kind = ProjectBindingKind::Directory;
        let created = CollaborationService::default()
            .create_camp(
                &mut database,
                &user_envelope("camp-open-pending-create", None, create),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let attachment_store = CampAttachmentStore::new(&directory);
        let draft_before_enter = attachment_store
            .save_body(&mut database, &camp_id, "unfinished startup draft")
            .unwrap();

        let outcome = CampOpenService
            .enter(
                &mut database,
                &user_envelope(
                    "camp-open-pending-enter",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .unwrap();

        assert_eq!(outcome.projection.camp.activation_state, "pending");
        assert_eq!(outcome.projection.camp.version, 1);
        assert_eq!(
            outcome.projection.camp.default_lead_agent_id.as_deref(),
            Some("agent_1")
        );
        assert!(outcome.reconcile_duration.is_none());
        let enter_command_events: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE command_id = ?1",
                ["camp-open-pending-enter"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enter_command_events, 0);
        let draft_after_enter = attachment_store.load_draft(&database, &camp_id).unwrap();
        assert_eq!(draft_after_enter.body, draft_before_enter.body);
        assert_eq!(draft_after_enter.revision, draft_before_enter.revision);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
