use std::time::{Duration, Instant};

use anyhow::Result;
use rusqlite::OptionalExtension;

use crate::{
    collaboration::{CollaborationService, ReconcileDefaultLeadCommand},
    command::{CommandEnvelope, CommandResultStatus},
    db::Database,
    read_model::{CampOpenProjection, ReadModelService},
};

#[derive(Debug)]
pub struct CampOpenOutcome {
    pub projection: CampOpenProjection,
    pub reconcile_duration: Option<Duration>,
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
                "SELECT activation_state FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let reconcile_duration = if activation_state.as_deref() == Some("pending") {
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
            Some(reconcile_duration)
        };
        let projection_started_at = Instant::now();
        let projection = ReadModelService.camp_open_projection(database, &camp_id)?;
        Ok(CampOpenOutcome {
            projection,
            reconcile_duration,
            projection_duration: projection_started_at.elapsed(),
        })
    }

    pub fn open(&self, database: &mut Database, camp_id: &str) -> Result<CampOpenOutcome> {
        let projection_started_at = Instant::now();
        let projection = ReadModelService.camp_open_projection(database, camp_id)?;
        Ok(CampOpenOutcome {
            projection,
            reconcile_duration: None,
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
    };
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
        assert_eq!(
            outcome.projection.schema_version,
            crate::read_model::CAMP_OPEN_SCHEMA_VERSION
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
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
