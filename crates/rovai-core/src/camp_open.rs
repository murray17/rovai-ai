use std::time::{Duration, Instant};

use anyhow::Result;

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
        let projection_started_at = Instant::now();
        let projection = ReadModelService.camp_open_projection(database, &camp_id)?;
        Ok(CampOpenOutcome {
            projection,
            reconcile_duration: Some(reconcile_duration),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{CreateCampCommand, ProjectBindingKind},
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
        assert_eq!(outcome.projection.schema_version, 1);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
