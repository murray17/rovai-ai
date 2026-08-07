use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig, PublicOutputMode},
    camp_content::{StructuredCampMessageSegment, canonical_content_digest},
    collaboration::exhaust_camp_turn_execution_budget,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    context_index::index_camp_message,
    db::Database,
    execution_budget::{CampTurnExecutionBudgetExhaustionReason, camp_turn_execution_budget_now},
    git::GitObservation,
    message_delivery::{
        DeliveryDispatchTrigger, cancel_pending_turn_deliveries, dispatch_pending_for_recipient,
        settle_materialized_delivery_for_agent_run,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionSemantics {
    CoreEnforcedV1,
    RuntimeManagedV2,
}

impl PermissionSemantics {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CoreEnforcedV1 => "core_enforced_v1",
            Self::RuntimeManagedV2 => "runtime_managed_v2",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self> {
        match value {
            "core_enforced_v1" => Ok(Self::CoreEnforcedV1),
            "runtime_managed_v2" => Ok(Self::RuntimeManagedV2),
            _ => anyhow::bail!("AgentRun permission semantics are invalid"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunWorkspace {
    pub execution_root: String,
    pub access: String,
    pub isolation: String,
}

impl AgentRunWorkspace {
    pub fn runtime_managed_path(execution_root: String) -> Self {
        Self {
            execution_root,
            access: "write".to_string(),
            isolation: "shared".to_string(),
        }
    }

    pub fn path(&self) -> &Path {
        Path::new(&self.execution_root)
    }

    pub fn validate(&self) -> Result<()> {
        if !Path::new(&self.execution_root).is_absolute() {
            anyhow::bail!("AgentRun executionRoot must be absolute");
        }
        if !matches!(self.access.as_str(), "read_only" | "write") {
            anyhow::bail!("AgentRun workspace access must be read_only or write");
        }
        if !matches!(self.isolation.as_str(), "shared" | "git_worktree") {
            anyhow::bail!("AgentRun workspace isolation must be shared or git_worktree");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAgentRunCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub lease_owner: String,
    pub lease_seconds: i64,
    pub workspace: Option<AgentRunWorkspace>,
    pub starting_git_observation: Option<GitObservation>,
}

impl sealed::Sealed for ClaimAgentRunCommand {}
impl DomainCommand for ClaimAgentRunCommand {
    const TYPE: &'static str = "agent_run.claim";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkAgentRunForRecoveryCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub execution_epoch: i64,
    pub reason: String,
}

impl sealed::Sealed for MarkAgentRunForRecoveryCommand {}
impl DomainCommand for MarkAgentRunForRecoveryCommand {
    const TYPE: &'static str = "agent_run.runtime_recovery.request";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelCampTurnCommand {
    pub camp_id: String,
    pub camp_turn_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for CancelCampTurnCommand {}
impl DomainCommand for CancelCampTurnCommand {
    const TYPE: &'static str = "camp_turn.cancel";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeAgentRunCancellationCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub execution_epoch: i64,
    pub ending_git_observation: Option<GitObservation>,
}

impl sealed::Sealed for AcknowledgeAgentRunCancellationCommand {}
impl DomainCommand for AcknowledgeAgentRunCancellationCommand {
    const TYPE: &'static str = "agent_run.cancellation.acknowledge";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCancelledAgentRunEndingGitObservationCommand {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub ending_git_observation: GitObservation,
}

impl sealed::Sealed for RecordCancelledAgentRunEndingGitObservationCommand {}
impl DomainCommand for RecordCancelledAgentRunEndingGitObservationCommand {
    const TYPE: &'static str = "agent_run.cancelled.ending_git_observation.record";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindNativeSessionCommand {
    pub conversation_id: String,
    pub agent_run_id: String,
    pub expected_conversation_version: i64,
    pub expected_execution_epoch: i64,
    pub previous_adapter_installation_id: Option<String>,
    pub previous_native_session_id: Option<String>,
    pub previous_binding_compatibility_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposed_binding_id: Option<String>,
    pub adapter_installation_id: String,
    pub native_session_id: String,
    pub binding_compatibility_digest: String,
}

impl sealed::Sealed for BindNativeSessionCommand {}
impl DomainCommand for BindNativeSessionCommand {
    const TYPE: &'static str = "conversation.native_session.bind";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartNativeSessionCommand {
    pub conversation_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RestartNativeSessionCommand {}
impl DomainCommand for RestartNativeSessionCommand {
    const TYPE: &'static str = "conversation.native_session.restart";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SucceedAgentRunCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub execution_epoch: i64,
    pub native_turn_id: String,
    pub final_output: String,
    pub ending_git_observation: Option<GitObservation>,
}

impl sealed::Sealed for SucceedAgentRunCommand {}
impl DomainCommand for SucceedAgentRunCommand {
    const TYPE: &'static str = "agent_run.succeed";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailAgentRunCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub execution_epoch: i64,
    pub error_code: String,
    pub error_detail: Option<String>,
    pub manual_retry_allowed: bool,
    pub ending_git_observation: Option<GitObservation>,
}

impl sealed::Sealed for FailAgentRunCommand {}
impl DomainCommand for FailAgentRunCommand {
    const TYPE: &'static str = "agent_run.fail";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectAgentRunDispatchCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub error_code: String,
    pub error_detail: Option<String>,
    pub manual_retry_allowed: bool,
}

impl sealed::Sealed for RejectAgentRunDispatchCommand {}
impl DomainCommand for RejectAgentRunDispatchCommand {
    const TYPE: &'static str = "agent_run.rejectDispatch";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedAgentRunCandidate {
    pub agent_run_id: String,
    pub camp_id: String,
    pub camp_turn_id: String,
    pub conversation_id: String,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub version: i64,
    pub permission_semantics: PermissionSemantics,
    pub project_binding_kind: String,
    pub project_path: String,
    pub effective_config: Value,
    pub workspace: Option<AgentRunWorkspace>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunCancellationCandidate {
    pub agent_run_id: String,
    pub camp_id: String,
    pub camp_turn_id: String,
    pub project_binding_kind: String,
    pub project_path: String,
    pub version: i64,
    pub execution_epoch: i64,
    pub status: String,
    pub wait_reason: Option<String>,
    pub adapter_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampTurnExecutionBudgetExpiry {
    pub camp_turn_id: String,
    pub camp_id: String,
    pub deadline_at: String,
    pub agent_runs_fenced: i64,
}

impl QueuedAgentRunCandidate {
    pub fn execution_workspace(&self) -> AgentRunWorkspace {
        self.workspace.clone().unwrap_or_else(|| {
            if self.permission_semantics == PermissionSemantics::RuntimeManagedV2 {
                return AgentRunWorkspace::runtime_managed_path(self.project_path.clone());
            }
            let can_write = self.effective_config["capabilities"]
                .as_array()
                .is_some_and(|capabilities| {
                    capabilities
                        .iter()
                        .any(|capability| capability.as_str() == Some("workspace.bind"))
                });
            AgentRunWorkspace {
                execution_root: self.project_path.clone(),
                access: if can_write { "write" } else { "read_only" }.to_string(),
                isolation: "shared".to_string(),
            }
        })
    }

    pub fn frozen_runtime(&self) -> Result<FrozenAgentRuntimeConfig> {
        serde_json::from_value(
            self.effective_config
                .get("runtime")
                .cloned()
                .context("queued AgentRun has no frozen Runtime configuration")?,
        )
        .context("queued AgentRun frozen Runtime configuration is invalid")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExecution {
    pub agent_run_id: String,
    pub camp_id: String,
    pub camp_turn_id: String,
    pub conversation_id: String,
    pub conversation_version: i64,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub version: i64,
    pub permission_semantics: PermissionSemantics,
    pub project_binding_kind: String,
    pub project_path: String,
    pub execution_epoch: i64,
    pub status: String,
    pub wait_reason: Option<String>,
    pub runtime_recovery_required: bool,
    pub native_adapter_installation_id: Option<String>,
    pub native_session_id: Option<String>,
    pub native_binding_compatibility_digest: Option<String>,
    pub native_installation_generation: Option<i64>,
    pub native_session_compatibility_key: Option<String>,
    pub purpose: String,
    pub expected_output: String,
    pub effective_config: Value,
    pub runtime: FrozenAgentRuntimeConfig,
    pub workspace: AgentRunWorkspace,
    pub runtime_compatibility_digest: Option<String>,
}

impl AgentRunExecution {
    pub fn resumable_native_session_id(&self) -> Option<&str> {
        (self.native_session_resume_disposition() != NativeSessionResumeDisposition::New)
            .then_some(self.native_session_id.as_deref())
            .flatten()
    }

    pub fn native_session_resume_disposition(&self) -> NativeSessionResumeDisposition {
        if self.native_session_id.is_none()
            || self.native_adapter_installation_id.as_deref()
                != Some(self.runtime.installation_id.as_str())
            || self.native_binding_compatibility_digest.as_deref()
                != Some(self.runtime.binding_compatibility_digest.as_str())
        {
            return NativeSessionResumeDisposition::New;
        }
        match (
            self.native_session_compatibility_key.as_deref(),
            self.runtime.native_session_compatibility_key.as_deref(),
        ) {
            (Some(previous), Some(current)) if previous == current => {
                NativeSessionResumeDisposition::Compatible
            }
            (None, None)
                if self.native_installation_generation
                    == Some(self.runtime.installation_generation) =>
            {
                NativeSessionResumeDisposition::Compatible
            }
            (None, None) => NativeSessionResumeDisposition::Controlled,
            (Some(_), Some(_)) => NativeSessionResumeDisposition::New,
            (None, Some(_)) | (Some(_), None) => NativeSessionResumeDisposition::Controlled,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSessionResumeDisposition {
    New,
    Compatible,
    Controlled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSessionResumeFailure {
    Incompatible,
    Ambiguous,
}

#[allow(clippy::too_many_arguments)]
fn validate_frozen_runtime_columns(
    runtime: &FrozenAgentRuntimeConfig,
    adapter_kind: Option<&str>,
    installation_id: Option<&str>,
    installation_generation: Option<i64>,
    search_environment_generation: Option<i64>,
    executable_path: Option<&str>,
    auth_scope: Option<&str>,
    reported_version: Option<&str>,
    executable_fingerprint: Option<&str>,
    capabilities_json: Option<&str>,
    model_json: Option<&str>,
    permissions_json: Option<&str>,
    binding_digest: Option<&str>,
    host_digest: Option<&str>,
    protocol_version: Option<&str>,
    native_session_compatibility_key: Option<&str>,
) -> Result<()> {
    let capabilities = capabilities_json
        .map(serde_json::from_str::<Vec<String>>)
        .transpose()
        .context("AgentRun frozen Runtime capabilities are invalid")?;
    let model = model_json
        .map(serde_json::from_str)
        .transpose()
        .context("AgentRun frozen model selection is invalid")?;
    let permissions = permissions_json
        .map(serde_json::from_str)
        .transpose()
        .context("AgentRun frozen permission configuration is invalid")?;
    let consistent = adapter_kind == Some(runtime.adapter_kind.as_str())
        && installation_id == Some(runtime.installation_id.as_str())
        && installation_generation == Some(runtime.installation_generation)
        && search_environment_generation == Some(runtime.search_environment_generation)
        && executable_path == Some(runtime.executable_path.as_str())
        && auth_scope == Some(runtime.auth_scope.as_str())
        && reported_version == Some(runtime.reported_version.as_str())
        && executable_fingerprint == Some(runtime.executable_fingerprint.as_str())
        && capabilities.as_ref() == Some(&runtime.capabilities)
        && model.as_ref() == Some(&runtime.model)
        && permissions.as_ref() == Some(&runtime.permissions)
        && binding_digest == Some(runtime.binding_compatibility_digest.as_str())
        && host_digest == Some(runtime.host_config_digest.as_str())
        && protocol_version == Some(runtime.protocol_version.as_str())
        && native_session_compatibility_key == runtime.native_session_compatibility_key.as_deref();
    if !consistent {
        anyhow::bail!("AgentRun frozen Runtime columns disagree with effective configuration");
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct ExecutionRuntimeService {
    gateway: DomainCommandGateway,
}

impl ExecutionRuntimeService {
    pub fn record_runtime_compatibility_digest(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        digest: &str,
    ) -> Result<()> {
        if digest.trim().is_empty() {
            anyhow::bail!("Runtime compatibility digest cannot be empty");
        }
        let changed = database.connection_mut().execute(
            r#"
            UPDATE agent_run
            SET runtime_compatibility_digest = ?1
            WHERE id = ?2
              AND execution_epoch = ?3
              AND status IN ('running', 'waiting')
            "#,
            params![digest, agent_run_id, execution_epoch],
        )?;
        if changed == 0 {
            let current = database
                .connection()
                .query_row(
                    "SELECT runtime_compatibility_digest FROM agent_run WHERE id = ?1",
                    [agent_run_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?;
            if current.flatten().as_deref() != Some(digest) {
                anyhow::bail!(
                    "AgentRun runtime compatibility digest could not be persisted for the active execution"
                );
            }
        }
        Ok(())
    }

    pub fn prepare_native_session_resume(
        &self,
        database: &mut Database,
        execution: &AgentRunExecution,
    ) -> Result<NativeSessionResumeDisposition> {
        let disposition = execution.native_session_resume_disposition();
        if disposition != NativeSessionResumeDisposition::Controlled {
            return Ok(disposition);
        }
        let transaction = database.connection_mut().transaction()?;
        let existing = transaction
            .query_row(
                r#"
                SELECT status
                FROM native_session_resume_attempt
                WHERE conversation_id = ?1
                  AND installation_id = ?2
                  AND installation_generation = ?3
                "#,
                params![
                    execution.conversation_id,
                    execution.runtime.installation_id,
                    execution.runtime.installation_generation,
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let now = chrono::Utc::now().to_rfc3339();
        let disposition = match existing.as_deref() {
            None => {
                transaction.execute(
                    r#"
                    INSERT INTO native_session_resume_attempt(
                        conversation_id, installation_id,
                        installation_generation, status,
                        attempted_at, completed_at
                    ) VALUES (?1, ?2, ?3, 'attempting', ?4, NULL)
                    "#,
                    params![
                        execution.conversation_id,
                        execution.runtime.installation_id,
                        execution.runtime.installation_generation,
                        now,
                    ],
                )?;
                NativeSessionResumeDisposition::Controlled
            }
            Some("attempting") => {
                transaction.execute(
                    r#"
                    UPDATE native_session_resume_attempt
                    SET status = 'ambiguous', completed_at = ?4
                    WHERE conversation_id = ?1
                      AND installation_id = ?2
                      AND installation_generation = ?3
                      AND status = 'attempting'
                    "#,
                    params![
                        execution.conversation_id,
                        execution.runtime.installation_id,
                        execution.runtime.installation_generation,
                        now,
                    ],
                )?;
                NativeSessionResumeDisposition::New
            }
            Some("succeeded") => NativeSessionResumeDisposition::Compatible,
            Some("incompatible" | "ambiguous") => NativeSessionResumeDisposition::New,
            Some(_) => anyhow::bail!("Native Session resume attempt has an invalid status"),
        };
        transaction.commit()?;
        Ok(disposition)
    }

    pub fn record_native_session_resume_failure(
        &self,
        database: &mut Database,
        execution: &AgentRunExecution,
        failure: NativeSessionResumeFailure,
    ) -> Result<()> {
        let status = match failure {
            NativeSessionResumeFailure::Incompatible => "incompatible",
            NativeSessionResumeFailure::Ambiguous => "ambiguous",
        };
        let now = chrono::Utc::now().to_rfc3339();
        database.connection_mut().execute(
            r#"
            UPDATE native_session_resume_attempt
            SET status = ?4, completed_at = ?5
            WHERE conversation_id = ?1
              AND installation_id = ?2
              AND installation_generation = ?3
              AND status = 'attempting'
            "#,
            params![
                execution.conversation_id,
                execution.runtime.installation_id,
                execution.runtime.installation_generation,
                status,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn expire_elapsed_camp_turn_execution_budgets(
        &self,
        database: &mut Database,
        observed_now: chrono::DateTime<chrono::Utc>,
        limit: i64,
    ) -> Result<Vec<CampTurnExecutionBudgetExpiry>> {
        if !(1..=100).contains(&limit) {
            anyhow::bail!("CampTurn Execution Budget expiry limit must be between 1 and 100");
        }
        let now = observed_now.to_rfc3339();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidates = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, camp_id, execution_budget_deadline_at
                FROM camp_turn
                WHERE status IN ('running', 'waiting')
                  AND execution_budget_exhausted_at IS NULL
                  AND execution_budget_deadline_at <= ?1
                ORDER BY execution_budget_deadline_at, id
                LIMIT ?2
                "#,
            )?;
            statement
                .query_map(params![now, limit], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let actor = ActorRef::System {
            component_id: "execution-budget-deadline-monitor".to_string(),
        };
        let mut expired = Vec::with_capacity(candidates.len());
        for (camp_turn_id, camp_id, deadline_at) in candidates {
            let command_id = format!("camp-turn-execution-budget-expiry:{camp_turn_id}");
            let exhaustion = exhaust_camp_turn_execution_budget(
                &transaction,
                &camp_turn_id,
                CampTurnExecutionBudgetExhaustionReason::Elapsed,
                &command_id,
                &now,
                &actor,
                None,
            )?;
            if exhaustion.newly_exhausted {
                expired.push(CampTurnExecutionBudgetExpiry {
                    camp_turn_id,
                    camp_id,
                    deadline_at,
                    agent_runs_fenced: exhaustion.agent_runs_fenced,
                });
            }
        }
        transaction.commit()?;
        Ok(expired)
    }

    pub fn list_cancellation_candidates(
        &self,
        database: &Database,
        limit: i64,
    ) -> Result<Vec<AgentRunCancellationCandidate>> {
        if !(1..=100).contains(&limit) {
            anyhow::bail!("AgentRun cancellation limit must be between 1 and 100");
        }
        let mut statement = database.connection().prepare(
            r#"
            SELECT agent_run.id, camp_turn.camp_id, agent_run.camp_turn_id,
                   agent_run.version, agent_run.execution_epoch, agent_run.status,
                   agent_run.wait_reason, agent_run.runtime_adapter_kind,
                   camp.project_binding_kind, camp.project_path
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            WHERE agent_run.cancel_requested_at IS NOT NULL
              AND agent_run.cancel_acknowledged_at IS NULL
              AND agent_run.status IN ('queued', 'running', 'waiting')
            ORDER BY agent_run.cancel_requested_at, agent_run.id
            LIMIT ?1
            "#,
        )?;
        Ok(statement
            .query_map([limit], |row| {
                Ok(AgentRunCancellationCandidate {
                    agent_run_id: row.get(0)?,
                    camp_id: row.get(1)?,
                    camp_turn_id: row.get(2)?,
                    version: row.get(3)?,
                    execution_epoch: row.get(4)?,
                    status: row.get(5)?,
                    wait_reason: row.get(6)?,
                    adapter_kind: row.get(7)?,
                    project_binding_kind: row.get(8)?,
                    project_path: row.get(9)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_dispatchable_agent_runs(
        &self,
        database: &Database,
        limit: i64,
    ) -> Result<Vec<QueuedAgentRunCandidate>> {
        if !(1..=100).contains(&limit) {
            anyhow::bail!("AgentRun scheduler limit must be between 1 and 100");
        }
        let now = camp_turn_execution_budget_now().to_rfc3339();
        let mut statement = database.connection().prepare(
            r#"
            SELECT agent_run.id, camp_turn.camp_id, agent_run.camp_turn_id,
                   agent_run.conversation_id, conversation.agent_id,
                   agent_run.task_id, agent_run.version,
                   agent_run.permission_semantics, camp.project_binding_kind,
                   camp.project_path, agent_run.effective_config_json,
                   agent_run.workspace_json
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = conversation.agent_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_id
            WHERE (agent_run.status = 'queued'
                   OR (agent_run.status = 'waiting'
                       AND agent_run.wait_reason = 'runtime_recovery'
                       AND agent_run.runtime_recovery_required = 1))
              AND agent_run.input_ready_at IS NOT NULL
              AND agent_run.cancel_requested_at IS NULL
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND camp_turn.execution_budget_exhausted_at IS NULL
              AND camp_turn.execution_budget_deadline_at > ?1
              AND NOT (
                  agent_run.status = 'waiting'
                  AND agent_run.wait_reason = 'runtime_recovery'
                  AND EXISTS (
                      SELECT 1 FROM runtime_input_delivery
                      WHERE runtime_input_delivery.agent_run_id = agent_run.id
                        AND runtime_input_delivery.status = 'accepted'
                  )
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run AS active_run
                  WHERE active_run.conversation_id = agent_run.conversation_id
                    AND active_run.id <> agent_run.id
                    AND active_run.status IN ('running', 'waiting')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run AS earlier_run
                  WHERE earlier_run.conversation_id = agent_run.conversation_id
                    AND (earlier_run.status = 'queued'
                         OR (earlier_run.status = 'waiting'
                             AND earlier_run.wait_reason = 'runtime_recovery'
                             AND earlier_run.runtime_recovery_required = 1))
                    AND earlier_run.input_ready_at IS NOT NULL
                    AND earlier_run.cancel_requested_at IS NULL
                    AND (earlier_run.created_at < agent_run.created_at
                         OR (earlier_run.created_at = agent_run.created_at
                             AND earlier_run.id < agent_run.id))
              )
              AND (
                  agent_run.task_id IS NULL
                  OR EXISTS (
                      SELECT 1 FROM task
                      WHERE task.id = agent_run.task_id
                        AND task.camp_id = camp.id
                        AND task.status IN ('pending', 'in_progress')
                  )
              )
            ORDER BY agent_run.created_at, agent_run.id
            LIMIT ?2
            "#,
        )?;
        let rows = statement
            .query_map(params![now, limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(
                |(
                    agent_run_id,
                    camp_id,
                    camp_turn_id,
                    conversation_id,
                    agent_id,
                    task_id,
                    version,
                    permission_semantics,
                    project_binding_kind,
                    project_path,
                    effective_config,
                    workspace,
                )| {
                    Ok(QueuedAgentRunCandidate {
                        agent_run_id,
                        camp_id,
                        camp_turn_id,
                        conversation_id,
                        agent_id,
                        task_id,
                        version,
                        permission_semantics: PermissionSemantics::parse(&permission_semantics)?,
                        project_binding_kind,
                        project_path,
                        effective_config: serde_json::from_str(&effective_config)
                            .context("AgentRun effective config is invalid")?,
                        workspace: workspace
                            .map(|workspace| {
                                serde_json::from_str(&workspace)
                                    .context("AgentRun workspace is invalid")
                            })
                            .transpose()?,
                    })
                },
            )
            .collect()
    }

    pub fn load_agent_run_execution(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<Option<AgentRunExecution>> {
        let now = camp_turn_execution_budget_now().to_rfc3339();
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.id, camp_turn.camp_id, agent_run.camp_turn_id,
                       agent_run.conversation_id, conversation.version,
                       conversation.agent_id, agent_run.task_id,
                       agent_run.version, agent_run.permission_semantics,
                       agent_run.execution_epoch,
                       agent_run.status, agent_run.wait_reason,
                       agent_run.runtime_recovery_required,
                       conversation.native_adapter_installation_id,
                       conversation.native_session_id,
                       conversation.native_binding_compatibility_digest,
                       conversation.native_installation_generation,
                       conversation.native_session_compatibility_key,
                       agent_run.purpose,
                       agent_run.expected_output, agent_run.effective_config_json,
                       agent_run.workspace_json,
                       agent_run.runtime_adapter_kind,
                       agent_run.runtime_installation_id,
                       agent_run.runtime_executable_path,
                       agent_run.runtime_auth_scope,
                       agent_run.runtime_reported_version,
                       agent_run.runtime_executable_fingerprint,
                       agent_run.runtime_capabilities_json,
                       agent_run.runtime_model_selection_json,
                       agent_run.runtime_permission_config_json,
                       agent_run.runtime_binding_compatibility_digest,
                       agent_run.runtime_host_config_digest,
                       agent_run.runtime_protocol_version,
                       agent_run.runtime_installation_generation,
                       agent_run.runtime_search_environment_generation,
                       agent_run.runtime_native_session_compatibility_key,
                       camp.project_binding_kind, camp.project_path,
                       agent_run.runtime_compatibility_digest
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN camp ON camp.id = camp_turn.camp_id
                JOIN conversation ON conversation.id = agent_run.conversation_id
                WHERE agent_run.id = ?1
                  AND agent_run.status IN ('running', 'waiting')
                  AND agent_run.cancel_requested_at IS NULL
                  AND agent_run.execution_epoch = ?2
                  AND camp_turn.status IN ('running', 'waiting')
                  AND camp_turn.cancel_requested_at IS NULL
                  AND camp_turn.execution_budget_exhausted_at IS NULL
                  AND camp_turn.execution_budget_deadline_at > ?3
                "#,
                params![agent_run_id, execution_epoch, now],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, i64>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        row.get::<_, Option<String>>(15)?,
                        row.get::<_, Option<i64>>(16)?,
                        row.get::<_, Option<String>>(17)?,
                        row.get::<_, String>(18)?,
                        row.get::<_, String>(19)?,
                        row.get::<_, String>(20)?,
                        row.get::<_, String>(21)?,
                        row.get::<_, Option<String>>(22)?,
                        row.get::<_, Option<String>>(23)?,
                        row.get::<_, Option<String>>(24)?,
                        row.get::<_, Option<String>>(25)?,
                        row.get::<_, Option<String>>(26)?,
                        row.get::<_, Option<String>>(27)?,
                        row.get::<_, Option<String>>(28)?,
                        row.get::<_, Option<String>>(29)?,
                        row.get::<_, Option<String>>(30)?,
                        row.get::<_, Option<String>>(31)?,
                        row.get::<_, Option<String>>(32)?,
                        row.get::<_, Option<String>>(33)?,
                        row.get::<_, Option<i64>>(34)?,
                        row.get::<_, Option<i64>>(35)?,
                        row.get::<_, Option<String>>(36)?,
                        row.get::<_, String>(37)?,
                        row.get::<_, String>(38)?,
                        row.get::<_, Option<String>>(39)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            agent_run_id,
            camp_id,
            camp_turn_id,
            conversation_id,
            conversation_version,
            agent_id,
            task_id,
            version,
            permission_semantics,
            execution_epoch,
            status,
            wait_reason,
            runtime_recovery_required,
            native_adapter_installation_id,
            native_session_id,
            native_binding_compatibility_digest,
            native_installation_generation,
            native_session_compatibility_key,
            purpose,
            expected_output,
            effective_config,
            workspace,
            runtime_adapter_kind,
            runtime_installation_id,
            runtime_executable_path,
            runtime_auth_scope,
            runtime_reported_version,
            runtime_executable_fingerprint,
            runtime_capabilities_json,
            runtime_model_selection_json,
            runtime_permission_config_json,
            runtime_binding_compatibility_digest,
            runtime_host_config_digest,
            runtime_protocol_version,
            runtime_installation_generation,
            runtime_search_environment_generation,
            runtime_native_session_compatibility_key,
            project_binding_kind,
            project_path,
            runtime_compatibility_digest,
        )) = row
        else {
            return Ok(None);
        };
        let workspace = serde_json::from_str::<AgentRunWorkspace>(&workspace)
            .context("claimed AgentRun has no valid frozen workspace")?;
        workspace.validate()?;
        let effective_config: Value = serde_json::from_str(&effective_config)
            .context("AgentRun effective config is invalid")?;
        let runtime: FrozenAgentRuntimeConfig = serde_json::from_value(
            effective_config
                .get("runtime")
                .cloned()
                .context("AgentRun has no frozen Runtime configuration")?,
        )
        .context("AgentRun frozen Runtime configuration is invalid")?;
        validate_frozen_runtime_columns(
            &runtime,
            runtime_adapter_kind.as_deref(),
            runtime_installation_id.as_deref(),
            runtime_installation_generation,
            runtime_search_environment_generation,
            runtime_executable_path.as_deref(),
            runtime_auth_scope.as_deref(),
            runtime_reported_version.as_deref(),
            runtime_executable_fingerprint.as_deref(),
            runtime_capabilities_json.as_deref(),
            runtime_model_selection_json.as_deref(),
            runtime_permission_config_json.as_deref(),
            runtime_binding_compatibility_digest.as_deref(),
            runtime_host_config_digest.as_deref(),
            runtime_protocol_version.as_deref(),
            runtime_native_session_compatibility_key.as_deref(),
        )?;
        Ok(Some(AgentRunExecution {
            agent_run_id,
            camp_id,
            camp_turn_id,
            conversation_id,
            conversation_version,
            agent_id,
            task_id,
            version,
            permission_semantics: PermissionSemantics::parse(&permission_semantics)?,
            project_binding_kind,
            project_path,
            execution_epoch,
            status,
            wait_reason,
            runtime_recovery_required: runtime_recovery_required != 0,
            native_adapter_installation_id,
            native_session_id,
            native_binding_compatibility_digest,
            native_installation_generation,
            native_session_compatibility_key,
            purpose,
            expected_output,
            effective_config,
            runtime,
            workspace,
            runtime_compatibility_digest,
        }))
    }

    pub fn claim_agent_run(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClaimAgentRunCommand>,
    ) -> Result<CommandExecution> {
        if let Some(workspace) = &envelope.payload.workspace {
            workspace.validate()?;
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id }
                    if component_id == "agent-run-scheduler"
                        || component_id == "runtime-recovery-coordinator"
            ) {
                return Ok(rejected(
                    "agent_run.scheduler_required",
                    "AgentRun claim requires the scheduler or recovery coordinator",
                ));
            }
            if envelope.payload.lease_owner.trim().is_empty() || envelope.payload.lease_seconds <= 0
            {
                return Ok(rejected(
                    "agent_run.invalid_lease",
                    "Execution lease is invalid",
                ));
            }
            let run = load_claimable_run(transaction, &envelope.payload.agent_run_id)?;
            let Some(run) = run else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(run.camp_id.as_str()) {
                return Ok(rejected(
                    "agent_run.camp_mismatch",
                    "AgentRun is outside the Camp",
                ));
            }
            if run.version != envelope.payload.expected_version {
                return Ok(rejected(
                    "agent_run.version_conflict",
                    "AgentRun version is stale",
                ));
            }
            if !matches!(run.camp_turn_status.as_str(), "running" | "waiting")
                || run.camp_turn_cancel_requested_at.is_some()
            {
                return Ok(rejected(
                    "agent_run.turn_fenced",
                    "CampTurn is no longer accepting AgentRun execution",
                ));
            }
            if run.execution_budget_exhausted_at.is_some() {
                return Ok(rejected(
                    "agent_run.execution_budget_exhausted",
                    "CampTurn Execution Budget is already exhausted",
                ));
            }
            let now = camp_turn_execution_budget_now();
            let now_text = now.to_rfc3339();
            let deadline = chrono::DateTime::parse_from_rfc3339(&run.execution_budget_deadline_at)
                .context("CampTurn Execution Budget deadline is invalid")?
                .with_timezone(&chrono::Utc);
            if now >= deadline {
                let exhaustion = exhaust_camp_turn_execution_budget(
                    transaction,
                    &run.camp_turn_id,
                    CampTurnExecutionBudgetExhaustionReason::Elapsed,
                    &envelope.command_id,
                    &now_text,
                    &envelope.actor,
                    None,
                )?;
                return Ok(CommandHandlerResult::rejected(
                    "agent_run.execution_budget_exhausted",
                    json!({
                        "message": "CampTurn Execution Budget deadline has elapsed",
                        "reason": "elapsed",
                        "campTurnId": run.camp_turn_id,
                        "deadlineAt": run.execution_budget_deadline_at,
                        "agentRunsFenced": exhaustion.agent_runs_fenced,
                    }),
                ));
            }
            let valid_state = run.status == "queued"
                || (run.status == "waiting"
                    && run.wait_reason.as_deref() == Some("runtime_recovery")
                    && run.runtime_recovery_required);
            if !valid_state || run.input_ready_at.is_none() || run.cancel_requested_at.is_some() {
                return Ok(rejected(
                    "agent_run.not_claimable",
                    "AgentRun is not ready for execution",
                ));
            }
            if run.status == "waiting"
                && run.wait_reason.as_deref() == Some("runtime_recovery")
                && has_accepted_runtime_input(transaction, &run.id)?
            {
                return Ok(rejected(
                    "agent_run.accepted_input_requires_reconciliation",
                    "An accepted Runtime input cannot be resent or assumed complete after restart",
                ));
            }
            if !run.member_active {
                return Ok(rejected(
                    "agent_run.member_unavailable",
                    "Agent is no longer an active Camp member",
                ));
            }
            if !current_authorization_covers_snapshot(
                &run.effective_config,
                &run.current_default_capabilities,
                &run.current_capability_overrides,
            )? {
                return Ok(rejected(
                    "agent_run.authorization_revoked",
                    "Current Camp authorization no longer covers the frozen AgentRun",
                ));
            }
            if let Some(task_id) = run.task_id.as_deref()
                && !task_is_executable(transaction, task_id, &run.camp_id)?
            {
                return Ok(rejected(
                    "agent_run.task_blocked",
                    "Task is no longer executable",
                ));
            }
            if run.status == "waiting" && has_recovery_safety_blocker(transaction, &run.id)? {
                return Ok(rejected(
                    "agent_run.recovery_blocked",
                    "Approval, Action or Runtime Delivery must settle before recovery",
                ));
            }
            let other_active: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*) FROM agent_run
                WHERE conversation_id = ?1 AND id <> ?2
                  AND status IN ('running', 'waiting')
                "#,
                params![run.conversation_id, run.id],
                |row| row.get(0),
            )?;
            if other_active != 0 {
                return Ok(rejected(
                    "agent_run.conversation_busy",
                    "Conversation already has an active AgentRun",
                ));
            }

            let frozen_workspace = match (&run.workspace, &envelope.payload.workspace) {
                (Some(existing), Some(requested)) => {
                    let existing: AgentRunWorkspace = serde_json::from_value(existing.clone())
                        .context("stored AgentRun workspace is invalid")?;
                    if existing != *requested {
                        return Ok(rejected(
                            "agent_run.workspace_frozen",
                            "AgentRun workspace cannot be changed after it is frozen",
                        ));
                    }
                    Some(serde_json::to_value(existing)?)
                }
                (Some(existing), None) => Some(existing.clone()),
                (None, Some(requested)) => Some(serde_json::to_value(requested)?),
                (None, None) => None,
            };
            if let Some(workspace) = frozen_workspace.as_ref()
                && !workspace_matches_camp(transaction, &run.camp_id, workspace)?
            {
                return Ok(rejected(
                    "agent_run.workspace_scope_mismatch",
                    "AgentRun workspace does not match the Camp project path",
                ));
            }
            let starting_git_observation = envelope
                .payload
                .starting_git_observation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;

            let lease_expires_at =
                (now + chrono::Duration::seconds(envelope.payload.lease_seconds)).to_rfc3339();
            let next_epoch = run.execution_epoch + 1;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET workspace_json = COALESCE(workspace_json, ?2),
                    starting_git_observation_json =
                        COALESCE(starting_git_observation_json, ?8),
                    status = 'running', wait_reason = NULL, wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_epoch = ?3, execution_lease_owner = ?4,
                    execution_lease_expires_at = ?5,
                    started_at = COALESCE(started_at, ?6),
                    version = version + 1, updated_at = ?6
                WHERE id = ?1 AND version = ?7
                  AND (status = 'queued'
                       OR (status = 'waiting' AND wait_reason = 'runtime_recovery'
                           AND runtime_recovery_required = 1))
                  AND cancel_requested_at IS NULL
                  AND EXISTS (
                      SELECT 1 FROM camp_turn
                      WHERE camp_turn.id = agent_run.camp_turn_id
                        AND camp_turn.status IN ('running', 'waiting')
                        AND camp_turn.cancel_requested_at IS NULL
                        AND camp_turn.execution_budget_exhausted_at IS NULL
                        AND camp_turn.execution_budget_deadline_at > ?6
                  )
                "#,
                params![
                    run.id,
                    frozen_workspace
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    next_epoch,
                    envelope.payload.lease_owner,
                    lease_expires_at,
                    now_text,
                    envelope.payload.expected_version,
                    starting_git_observation,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.claim_race_lost",
                    "AgentRun changed before its lease was acquired",
                ));
            }
            // A reusable Native Session may outlive an AgentRun epoch. Clear the
            // previous Team Tool credential before the new epoch can execute so
            // a stale MCP process cannot be resolved as the newly claimed Run.
            transaction.execute(
                r#"
                UPDATE conversation
                SET native_binding_secret_digest = NULL,
                    version = version + 1,
                    updated_at = ?2
                WHERE id = ?1
                "#,
                params![run.conversation_id, now_text],
            )?;
            if let Some(task_id) = run.task_id.as_deref() {
                transaction.execute(
                    r#"
                    UPDATE task SET status = 'in_progress', version = version + 1,
                        updated_at = ?2
                    WHERE id = ?1 AND status = 'pending'
                    "#,
                    params![task_id, now_text],
                )?;
            }
            append_domain_event(
                transaction,
                "agent_run.claimed",
                &run.camp_id,
                ("agent_run", &run.id),
                &envelope.actor,
                None,
                &json!({
                    "conversationId": run.conversation_id,
                    "executionEpoch": next_epoch,
                    "leaseOwner": envelope.payload.lease_owner,
                    "leaseExpiresAt": lease_expires_at,
                    "workspace": frozen_workspace,
                    "startingGitObservation": envelope.payload.starting_git_observation,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "agent_run.claimed",
                json!({
                    "agentRunId": run.id,
                    "conversationId": run.conversation_id,
                    "executionEpoch": next_epoch,
                    "leaseExpiresAt": lease_expires_at,
                    "workspace": frozen_workspace,
                    "startingGitObservation": envelope.payload.starting_git_observation,
                }),
                Some(entity_ref("agent_run", &run.id)),
            ))
        })
    }

    pub fn mark_for_recovery(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkAgentRunForRecoveryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id == "runtime-recovery-coordinator"
            ) {
                return Ok(rejected(
                    "agent_run.recovery_coordinator_required",
                    "Runtime recovery requires its coordinator",
                ));
            }
            let camp_id = transaction
                .query_row(
                    r#"
                    SELECT camp_turn.camp_id
                    FROM agent_run JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE agent_run.id = ?1
                    "#,
                    [&envelope.payload.agent_run_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(camp_id) = camp_id else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected(
                    "agent_run.camp_mismatch",
                    "AgentRun is outside the Camp",
                ));
            }
            let now = camp_turn_execution_budget_now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting',
                    wait_reason = CASE
                        WHEN status = 'running' THEN 'runtime_recovery'
                        ELSE wait_reason
                    END,
                    runtime_recovery_required = 1,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = 'runtime_connection_lost',
                    version = version + 1, updated_at = ?4
                WHERE id = ?1 AND status IN ('running', 'waiting')
                  AND version = ?2 AND execution_epoch = ?3
                  AND cancel_requested_at IS NULL
                  AND EXISTS (
                      SELECT 1 FROM camp_turn
                      WHERE camp_turn.id = agent_run.camp_turn_id
                        AND camp_turn.status IN ('running', 'waiting')
                        AND camp_turn.cancel_requested_at IS NULL
                        AND camp_turn.execution_budget_exhausted_at IS NULL
                        AND camp_turn.execution_budget_deadline_at > ?4
                  )
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.expected_version,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.recovery_fenced",
                    "AgentRun is stale or is not active",
                ));
            }
            append_domain_event(
                transaction,
                "agent_run.runtime_recovery_requested",
                &camp_id,
                ("agent_run", &envelope.payload.agent_run_id),
                &envelope.actor,
                None,
                &json!({
                    "executionEpoch": envelope.payload.execution_epoch,
                    "reason": envelope.payload.reason,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "agent_run.runtime_recovery_requested",
                json!({ "agentRunId": envelope.payload.agent_run_id }),
                Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
            ))
        })
    }

    pub fn request_camp_turn_cancellation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CancelCampTurnCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp_turn.cancel_user_required",
                    "Only a User can stop a CampTurn from the v0.04 workbench",
                ));
            }
            let turn = transaction
                .query_row(
                    r#"
                    SELECT camp_id, status, version, cancel_requested_at
                    FROM camp_turn WHERE id = ?1
                    "#,
                    [&envelope.payload.camp_turn_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, status, version, cancel_requested_at)) = turn else {
                return Ok(rejected("camp_turn.not_found", "CampTurn does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected(
                    "camp_turn.camp_mismatch",
                    "CampTurn is outside the Camp",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": version }),
                ));
            }
            if matches!(status.as_str(), "completed" | "failed" | "cancelled") {
                return Ok(CommandHandlerResult::applied(
                    "camp_turn.already_terminal",
                    json!({
                        "campTurnId": envelope.payload.camp_turn_id,
                        "status": status,
                    }),
                    Some(entity_ref("camp_turn", &envelope.payload.camp_turn_id)),
                ));
            }
            if cancel_requested_at.is_some() {
                return Ok(CommandHandlerResult::accepted(
                    "camp_turn.cancellation_already_requested",
                    json!({ "campTurnId": envelope.payload.camp_turn_id }),
                    Some(entity_ref("camp_turn", &envelope.payload.camp_turn_id)),
                ));
            }

            let mut statement = transaction.prepare(
                r#"
                SELECT id, execution_epoch
                FROM agent_run
                WHERE camp_turn_id = ?1 AND status IN ('queued', 'running', 'waiting')
                ORDER BY id
                "#,
            )?;
            let runs = statement
                .query_map([&envelope.payload.camp_turn_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(statement);

            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE camp_turn
                SET status = 'waiting', cancel_requested_at = ?2,
                    cancel_request_command_id = ?3,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![envelope.payload.camp_turn_id, now, envelope.command_id,],
            )?;
            let message_deliveries_cancelled = cancel_pending_turn_deliveries(
                transaction,
                &envelope.payload.camp_turn_id,
                "camp_turn_cancelled",
                &envelope.actor,
                None,
                &now,
            )?;
            transaction.execute(
                r#"
                UPDATE agent_run
                SET cancel_requested_at = ?2,
                    cancel_reason_code = 'camp_turn_cancelled',
                    version = version + 1, updated_at = ?2
                WHERE camp_turn_id = ?1
                  AND status IN ('queued', 'running', 'waiting')
                  AND cancel_requested_at IS NULL
                "#,
                params![envelope.payload.camp_turn_id, now],
            )?;
            append_domain_event(
                transaction,
                "camp_turn.cancel_requested",
                &camp_id,
                ("camp_turn", &envelope.payload.camp_turn_id),
                &envelope.actor,
                None,
                &json!({
                    "agentRunCount": runs.len(),
                    "messageDeliveriesCancelled": message_deliveries_cancelled,
                }),
            )?;
            for (run_id, execution_epoch) in &runs {
                append_domain_event(
                    transaction,
                    "agent_run.cancel_requested",
                    &camp_id,
                    ("agent_run", run_id),
                    &envelope.actor,
                    Some(*execution_epoch),
                    &json!({
                        "campTurnId": envelope.payload.camp_turn_id,
                        "reasonCode": "camp_turn_cancelled",
                    }),
                )?;
            }
            let camp_turn_status = recompute_camp_turn(
                transaction,
                &camp_id,
                &envelope.payload.camp_turn_id,
                &envelope.actor,
                None,
                &now,
            )?;
            Ok(CommandHandlerResult::accepted(
                "camp_turn.cancellation_requested",
                json!({
                    "campTurnId": envelope.payload.camp_turn_id,
                    "agentRunCount": runs.len(),
                    "messageDeliveriesCancelled": message_deliveries_cancelled,
                    "campTurnStatus": camp_turn_status,
                }),
                Some(entity_ref("camp_turn", &envelope.payload.camp_turn_id)),
            ))
        })
    }

    pub fn acknowledge_agent_run_cancellation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcknowledgeAgentRunCancellationCommand>,
    ) -> Result<CommandExecution> {
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id }
                    if component_id == "runtime-cancellation-coordinator"
            ) {
                return Ok(rejected(
                    "agent_run.cancellation_coordinator_required",
                    "AgentRun cancellation acknowledgement requires its coordinator",
                ));
            }
            let target = transaction
                .query_row(
                    r#"
                    SELECT camp_turn.camp_id, agent_run.camp_turn_id,
                           agent_run.status, agent_run.version,
                           agent_run.execution_epoch, agent_run.cancel_requested_at,
                           agent_run.cancel_reason_code
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE agent_run.id = ?1
                    "#,
                    [&envelope.payload.agent_run_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<String>>(6)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                camp_id,
                camp_turn_id,
                status,
                version,
                execution_epoch,
                requested_at,
                cancel_reason_code,
            )) = target
            else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected(
                    "agent_run.camp_mismatch",
                    "AgentRun is outside the Camp",
                ));
            }
            if version != envelope.payload.expected_version
                || execution_epoch != envelope.payload.execution_epoch
            {
                return Ok(rejected(
                    "agent_run.cancellation_fenced",
                    "AgentRun cancellation acknowledgement is stale",
                ));
            }
            if matches!(status.as_str(), "succeeded" | "failed" | "cancelled") {
                return Ok(CommandHandlerResult::applied(
                    "agent_run.already_terminal",
                    json!({ "agentRunId": envelope.payload.agent_run_id, "status": status }),
                    Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
                ));
            }
            if requested_at.is_none() {
                return Ok(rejected(
                    "agent_run.cancellation_not_requested",
                    "AgentRun has no cancellation request",
                ));
            }
            let cancel_reason_code =
                cancel_reason_code.context("AgentRun cancellation request has no reason code")?;
            let now = chrono::Utc::now().to_rfc3339();
            let ending_git_observation = envelope
                .payload
                .ending_git_observation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            let effect_fence =
                fence_cancelled_run_effects(transaction, &envelope.payload.agent_run_id, &now)?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'cancelled', wait_reason = NULL, wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    ending_git_observation_json = ?5,
                    cancel_acknowledged_at = ?2, ended_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND status IN ('queued', 'running', 'waiting')
                  AND version = ?3 AND execution_epoch = ?4
                  AND cancel_requested_at IS NOT NULL
                "#,
                params![
                    envelope.payload.agent_run_id,
                    now,
                    envelope.payload.expected_version,
                    envelope.payload.execution_epoch,
                    ending_git_observation,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.cancellation_fenced",
                    "AgentRun changed before cancellation acknowledgement",
                ));
            }
            append_domain_event(
                transaction,
                "agent_run.cancelled",
                &camp_id,
                ("agent_run", &envelope.payload.agent_run_id),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "reasonCode": cancel_reason_code,
                    "actionsMarkedUnknown": effect_fence.actions_marked_unknown,
                    "actionsClosed": effect_fence.actions_closed,
                    "approvalsCancelled": effect_fence.approvals_cancelled,
                    "deliveriesClosed": effect_fence.deliveries_closed,
                    "preparedInputsClosed": effect_fence.prepared_inputs_closed,
                    "endingGitObservation": envelope.payload.ending_git_observation,
                }),
            )?;
            settle_materialized_delivery_for_agent_run(
                transaction,
                &envelope.payload.agent_run_id,
                "cancelled",
                Some(&cancel_reason_code),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &now,
            )?;
            let camp_turn_status = recompute_camp_turn(
                transaction,
                &camp_id,
                &camp_turn_id,
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &now,
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.cancelled",
                json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "campTurnId": camp_turn_id,
                    "campTurnStatus": camp_turn_status,
                    "reasonCode": cancel_reason_code,
                }),
                Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
            ))
        })?;
        if !execution.replayed && execution.result.code == "agent_run.cancelled" {
            pump_target_after_run_terminal(database, &envelope.payload.agent_run_id)?;
        }
        Ok(execution)
    }

    pub fn record_cancelled_agent_run_ending_git_observation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RecordCancelledAgentRunEndingGitObservationCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id }
                    if component_id == "agent-run-git-observer"
            ) {
                return Ok(rejected(
                    "agent_run.git_observer_required",
                    "Cancelled AgentRun Git observation requires its background observer",
                ));
            }
            let target = transaction
                .query_row(
                    r#"
                    SELECT camp_turn.camp_id, agent_run.status,
                           agent_run.execution_epoch,
                           agent_run.ending_git_observation_json
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE agent_run.id = ?1
                    "#,
                    [&envelope.payload.agent_run_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, status, execution_epoch, existing_observation)) = target else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected(
                    "agent_run.camp_mismatch",
                    "AgentRun is outside the Camp",
                ));
            }
            if execution_epoch != envelope.payload.execution_epoch {
                return Ok(rejected(
                    "agent_run.git_observation_fenced",
                    "AgentRun execution epoch changed before Git observation",
                ));
            }
            if existing_observation.is_some() {
                return Ok(CommandHandlerResult::applied(
                    "agent_run.ending_git_observation_already_recorded",
                    json!({ "agentRunId": envelope.payload.agent_run_id }),
                    Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
                ));
            }
            if status != "cancelled" {
                return Ok(rejected(
                    "agent_run.not_cancelled",
                    "Ending Git observation can be appended only after cancellation",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let ending_git_observation =
                serde_json::to_string(&envelope.payload.ending_git_observation)?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET ending_git_observation_json = ?2,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND status = 'cancelled'
                  AND execution_epoch = ?4
                  AND ending_git_observation_json IS NULL
                "#,
                params![
                    envelope.payload.agent_run_id,
                    ending_git_observation,
                    now,
                    envelope.payload.execution_epoch,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.git_observation_fenced",
                    "AgentRun changed before Git observation was recorded",
                ));
            }
            append_domain_event(
                transaction,
                "agent_run.ending_git_observation_recorded",
                &camp_id,
                ("agent_run", &envelope.payload.agent_run_id),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "endingGitObservation": envelope.payload.ending_git_observation,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.ending_git_observation_recorded",
                json!({ "agentRunId": envelope.payload.agent_run_id }),
                Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
            ))
        })
    }

    pub fn bind_native_session(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<BindNativeSessionCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.adapter_installation_id.trim().is_empty()
            || envelope.payload.native_session_id.trim().is_empty()
            || envelope
                .payload
                .binding_compatibility_digest
                .trim()
                .is_empty()
        {
            anyhow::bail!("Native Binding fields must not be empty");
        }
        if let Some(proposed_binding_id) = envelope.payload.proposed_binding_id.as_deref() {
            Uuid::parse_str(proposed_binding_id)
                .context("proposed Native Binding ID must be a UUID")?;
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "runtime.adapter_required",
                    "Native Session binding requires a Runtime Adapter",
                ));
            }
            let now = camp_turn_execution_budget_now().to_rfc3339();
            let row = transaction
                .query_row(
                    r#"
                    SELECT conversation.camp_id,
                           conversation.native_adapter_installation_id,
                           conversation.native_session_id,
                           conversation.native_binding_compatibility_digest,
                           conversation.native_installation_generation,
                           conversation.native_session_compatibility_key,
                           conversation.native_binding_id,
                           conversation.native_binding_generation,
                           conversation.version, agent_run.execution_epoch,
                           agent_run.status, agent_run.runtime_installation_id,
                           agent_run.runtime_binding_compatibility_digest,
                           agent_run.runtime_installation_generation,
                           agent_run.runtime_native_session_compatibility_key
                    FROM conversation
                    JOIN agent_run ON agent_run.conversation_id = conversation.id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE conversation.id = ?1 AND agent_run.id = ?2
                      AND agent_run.cancel_requested_at IS NULL
                      AND camp_turn.status IN ('running', 'waiting')
                      AND camp_turn.cancel_requested_at IS NULL
                      AND camp_turn.execution_budget_exhausted_at IS NULL
                      AND camp_turn.execution_budget_deadline_at > ?3
                    "#,
                    params![
                        envelope.payload.conversation_id,
                        envelope.payload.agent_run_id,
                        now,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<i64>>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<String>>(6)?,
                            row.get::<_, i64>(7)?,
                            row.get::<_, i64>(8)?,
                            row.get::<_, i64>(9)?,
                            row.get::<_, String>(10)?,
                            row.get::<_, Option<String>>(11)?,
                            row.get::<_, Option<String>>(12)?,
                            row.get::<_, Option<i64>>(13)?,
                            row.get::<_, Option<String>>(14)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                camp_id,
                current_installation,
                current_session,
                current_digest,
                current_installation_generation,
                current_session_compatibility_key,
                current_binding_id,
                current_binding_generation,
                version,
                epoch,
                run_status,
                frozen_installation,
                frozen_digest,
                frozen_installation_generation,
                frozen_session_compatibility_key,
            )) = row
            else {
                return Ok(rejected(
                    "runtime.binding_not_found",
                    "Conversation and AgentRun binding does not exist",
                ));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str())
                || version != envelope.payload.expected_conversation_version
                || epoch != envelope.payload.expected_execution_epoch
                || !matches!(run_status.as_str(), "running" | "waiting")
            {
                return Ok(rejected(
                    "runtime.binding_fenced",
                    "Conversation or AgentRun binding is stale",
                ));
            }
            if frozen_installation.as_deref()
                != Some(envelope.payload.adapter_installation_id.as_str())
                || frozen_digest.as_deref()
                    != Some(envelope.payload.binding_compatibility_digest.as_str())
                || frozen_installation_generation.is_none()
            {
                return Ok(rejected(
                    "runtime.binding_configuration_mismatch",
                    "Native Binding does not match the AgentRun frozen Runtime",
                ));
            }
            if current_installation != envelope.payload.previous_adapter_installation_id
                || current_session != envelope.payload.previous_native_session_id
                || current_digest != envelope.payload.previous_binding_compatibility_digest
            {
                return Ok(rejected(
                    "runtime.session_changed",
                    "Native Binding changed before replacement",
                ));
            }
            let frozen_installation_generation =
                frozen_installation_generation.context("frozen Runtime has no generation")?;
            let binding_reused = current_binding_id.is_some()
                && current_binding_generation >= 1
                && current_installation.as_deref()
                    == Some(envelope.payload.adapter_installation_id.as_str())
                && current_session.as_deref() == Some(envelope.payload.native_session_id.as_str())
                && current_digest.as_deref()
                    == Some(envelope.payload.binding_compatibility_digest.as_str());
            let binding_prepared = current_binding_id.is_some()
                && current_binding_generation >= 1
                && current_installation.as_deref()
                    == Some(envelope.payload.adapter_installation_id.as_str())
                && current_session.is_none()
                && current_digest.as_deref()
                    == Some(envelope.payload.binding_compatibility_digest.as_str())
                && envelope.payload.proposed_binding_id.as_deref()
                    == current_binding_id.as_deref();
            if binding_reused
                && envelope.payload.proposed_binding_id.is_some()
                && envelope.payload.proposed_binding_id.as_deref()
                    != current_binding_id.as_deref()
            {
                return Ok(rejected(
                    "runtime.binding_proposal_conflict",
                    "Proposed Native Binding ID conflicts with the reusable binding",
                ));
            }
            let binding_id = if binding_reused || binding_prepared {
                current_binding_id.context("reused Native Binding has no identity")?
            } else {
                envelope
                    .payload
                    .proposed_binding_id
                    .clone()
                    .unwrap_or_else(|| Uuid::new_v4().to_string())
            };
            let binding_generation = if binding_reused || binding_prepared {
                current_binding_generation
            } else {
                current_binding_generation
                    .checked_add(1)
                    .context("Native Binding generation overflow")?
                    .max(1)
            };
            if !binding_reused {
                let updated = if binding_prepared {
                    // The Team Tool credential and Binding identity were
                    // reserved before the Adapter started its MCP process.
                    // Completing that reservation must retain the secret,
                    // generation, accepted public boundary and Charter state prepared
                    // for this exact Native Session generation.
                    transaction.execute(
                        r#"
                        UPDATE conversation
                        SET native_session_id = ?2,
                            native_installation_generation = ?9,
                            native_session_compatibility_key = ?10,
                            version = version + 1,
                            updated_at = ?3
                        WHERE id = ?1 AND version = ?4
                          AND native_adapter_installation_id = ?5
                          AND native_session_id IS NULL
                          AND native_binding_compatibility_digest = ?6
                          AND native_binding_id = ?7
                          AND native_binding_generation = ?8
                          AND native_binding_secret_digest IS NOT NULL
                        "#,
                        params![
                            envelope.payload.conversation_id,
                            envelope.payload.native_session_id,
                            now,
                            envelope.payload.expected_conversation_version,
                            envelope.payload.adapter_installation_id,
                            envelope.payload.binding_compatibility_digest,
                            binding_id,
                            binding_generation,
                            frozen_installation_generation,
                            frozen_session_compatibility_key,
                        ],
                    )?
                } else {
                    transaction.execute(
                        r#"
                        UPDATE conversation
                        SET native_adapter_installation_id = ?2,
                            native_session_id = ?3,
                            native_binding_compatibility_digest = ?4,
                            native_installation_generation = ?12,
                            native_session_compatibility_key = ?13,
                            native_binding_id = ?5,
                            native_binding_generation = ?6,
                            native_binding_secret_digest = NULL,
                            last_accepted_public_boundary_sequence = 0,
                            native_charter_digest = NULL,
                            native_member_state_digest = NULL,
                            version = version + 1, updated_at = ?7
                        WHERE id = ?1 AND version = ?8
                          AND native_adapter_installation_id IS ?9
                          AND native_session_id IS ?10
                          AND native_binding_compatibility_digest IS ?11
                        "#,
                        params![
                            envelope.payload.conversation_id,
                            envelope.payload.adapter_installation_id,
                            envelope.payload.native_session_id,
                            envelope.payload.binding_compatibility_digest,
                            binding_id,
                            binding_generation,
                            now,
                            envelope.payload.expected_conversation_version,
                            envelope.payload.previous_adapter_installation_id,
                            envelope.payload.previous_native_session_id,
                            envelope.payload.previous_binding_compatibility_digest,
                            frozen_installation_generation,
                            frozen_session_compatibility_key,
                        ],
                    )?
                };
                if updated != 1 {
                    return Ok(rejected(
                        "runtime.binding_race_lost",
                        "Conversation changed before Native Session binding",
                    ));
                }
            } else if current_installation_generation
                != Some(frozen_installation_generation)
                || current_session_compatibility_key != frozen_session_compatibility_key
            {
                let updated = transaction.execute(
                    r#"
                    UPDATE conversation
                    SET native_installation_generation = ?2,
                        native_session_compatibility_key = ?3,
                        version = version + 1, updated_at = ?4
                    WHERE id = ?1 AND version = ?5
                      AND native_session_id = ?6
                      AND native_binding_id = ?7
                      AND native_binding_generation = ?8
                    "#,
                    params![
                        envelope.payload.conversation_id,
                        frozen_installation_generation,
                        frozen_session_compatibility_key,
                        now,
                        envelope.payload.expected_conversation_version,
                        envelope.payload.native_session_id,
                        binding_id,
                        binding_generation,
                    ],
                )?;
                if updated != 1 {
                    return Ok(rejected(
                        "runtime.binding_race_lost",
                        "Conversation changed before compatible Native Session metadata update",
                    ));
                }
            }
            transaction.execute(
                r#"
                UPDATE native_session_resume_attempt
                SET status = 'succeeded', completed_at = ?4
                WHERE conversation_id = ?1
                  AND installation_id = ?2
                  AND installation_generation = ?3
                  AND status = 'attempting'
                "#,
                params![
                    envelope.payload.conversation_id,
                    envelope.payload.adapter_installation_id,
                    frozen_installation_generation,
                    now,
                ],
            )?;
            append_domain_event(
                transaction,
                "conversation.native_session_bound",
                &camp_id,
                ("conversation", &envelope.payload.conversation_id),
                &envelope.actor,
                None,
                &json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "executionEpoch": envelope.payload.expected_execution_epoch,
                    "previousAdapterInstallationId": envelope.payload.previous_adapter_installation_id,
                    "previousNativeSessionId": envelope.payload.previous_native_session_id,
                    "previousBindingCompatibilityDigest": envelope.payload.previous_binding_compatibility_digest,
                    "adapterInstallationId": envelope.payload.adapter_installation_id,
                    "nativeSessionId": envelope.payload.native_session_id,
                    "bindingCompatibilityDigest": envelope.payload.binding_compatibility_digest,
                    "nativeBindingId": binding_id,
                    "nativeBindingGeneration": binding_generation,
                    "bindingReused": binding_reused,
                    "bindingPrepared": binding_prepared,
                    "installationGeneration": frozen_installation_generation,
                    "nativeSessionCompatibilityKey": frozen_session_compatibility_key,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "conversation.native_session_bound",
                json!({
                    "conversationId": envelope.payload.conversation_id,
                    "adapterInstallationId": envelope.payload.adapter_installation_id,
                    "nativeSessionId": envelope.payload.native_session_id,
                    "bindingCompatibilityDigest": envelope.payload.binding_compatibility_digest,
                    "nativeBindingId": binding_id,
                    "nativeBindingGeneration": binding_generation,
                    "bindingReused": binding_reused,
                    "bindingPrepared": binding_prepared,
                }),
                Some(entity_ref(
                    "conversation",
                    &envelope.payload.conversation_id,
                )),
            ))
        })
    }

    pub fn restart_native_session(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RestartNativeSessionCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.conversation_id.trim().is_empty() {
            anyhow::bail!("conversationId must not be empty");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "conversation.user_required",
                    "Only the local user may restart a Native Session",
                ));
            }
            let conversation = transaction
                .query_row(
                    r#"
                    SELECT camp_id, version, native_adapter_installation_id,
                           native_session_id, native_binding_id
                    FROM conversation WHERE id = ?1
                    "#,
                    [&envelope.payload.conversation_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, version, installation_id, native_session_id, binding_id)) =
                conversation
            else {
                return Ok(rejected(
                    "conversation.not_found",
                    "Conversation does not exist",
                ));
            };
            if envelope.camp_id.as_deref().is_some_and(|id| id != camp_id) {
                return Ok(rejected(
                    "conversation.camp_mismatch",
                    "Conversation is outside the requested Camp",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(rejected(
                    "conversation.version_conflict",
                    "Conversation changed before its Native Session was restarted",
                ));
            }
            let active_run_count: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*) FROM agent_run
                WHERE conversation_id = ?1
                  AND status IN ('queued', 'running', 'waiting')
                "#,
                [&envelope.payload.conversation_id],
                |row| row.get(0),
            )?;
            if active_run_count != 0 {
                return Ok(rejected(
                    "conversation.active_run",
                    "Native Session cannot be restarted while this Conversation has active work",
                ));
            }
            if installation_id.is_none() && native_session_id.is_none() && binding_id.is_none() {
                return Ok(CommandHandlerResult::applied(
                    "conversation_native_session_already_clear",
                    json!({
                        "conversationId": envelope.payload.conversation_id,
                        "nativeBindingGenerationChanged": false,
                    }),
                    Some(entity_ref(
                        "conversation",
                        &envelope.payload.conversation_id,
                    )),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE conversation
                SET native_adapter_installation_id = NULL,
                    native_session_id = NULL,
                    native_binding_compatibility_digest = NULL,
                    native_installation_generation = NULL,
                    native_session_compatibility_key = NULL,
                    native_binding_id = NULL,
                    native_binding_secret_digest = NULL,
                    last_accepted_public_boundary_sequence = 0,
                    native_charter_digest = NULL,
                    native_member_state_digest = NULL,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1 AND version = ?2
                "#,
                params![
                    envelope.payload.conversation_id,
                    envelope.payload.expected_version,
                    now,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "conversation.version_conflict",
                    "Conversation changed before its Native Session was restarted",
                ));
            }
            append_domain_event(
                transaction,
                "conversation.native_session_restarted",
                &camp_id,
                ("conversation", &envelope.payload.conversation_id),
                &envelope.actor,
                None,
                &json!({
                    "conversationId": envelope.payload.conversation_id,
                    "previousAdapterInstallationId": installation_id,
                    "previousNativeSessionId": native_session_id,
                    "previousNativeBindingId": binding_id,
                    "nativeBindingGenerationChanged": false,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "conversation_native_session_restarted",
                json!({
                    "conversationId": envelope.payload.conversation_id,
                    "version": version + 1,
                    "nativeBindingGenerationChanged": false,
                }),
                Some(entity_ref(
                    "conversation",
                    &envelope.payload.conversation_id,
                )),
            ))
        })
    }

    pub fn succeed_agent_run(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SucceedAgentRunCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.native_turn_id.trim().is_empty() {
            anyhow::bail!("nativeTurnId must not be empty");
        }
        if envelope.payload.final_output.trim().is_empty() {
            anyhow::bail!("successful AgentRun finalOutput must not be empty");
        }
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if !is_runtime_adapter(&envelope.actor) {
                return Ok(rejected(
                    "runtime.adapter_required",
                    "AgentRun completion requires a Runtime Adapter",
                ));
            }
            let target = load_terminal_target(transaction, &envelope.payload.agent_run_id)?;
            let Some(target) = target else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if let Some(rejection) = validate_terminal_target(
                transaction,
                envelope.camp_id.as_deref(),
                &target,
                envelope.payload.expected_version,
                envelope.payload.execution_epoch,
            )? {
                return Ok(rejection);
            }
            let public_output_mode = target
                .runtime_adapter_kind
                .as_deref()
                .and_then(|value| value.parse::<AdapterKind>().ok())
                .map(AdapterKind::public_output_mode)
                .unwrap_or(PublicOutputMode::ExplicitSendOnly);
            let final_output_digest =
                canonical_content_digest(&[StructuredCampMessageSegment::Text {
                    text: envelope.payload.final_output.clone(),
                }])?;
            let (final_camp_message_id, automatic_public_output_suppressed) =
                if public_output_mode == PublicOutputMode::AssistantFinalVisible {
                    // A Runtime may have already made the exact final answer public through
                    // `camp.message.send`. Suppress only that same Run + canonical body digest;
                    // never deduplicate across Runs, recipients, time windows, or semantics.
                    let existing_final_message_id: Option<String> = transaction
                        .query_row(
                            r#"
                            SELECT id
                            FROM camp_message
                            WHERE source_agent_run_id = ?1
                              AND author_type = 'agent'
                              AND tombstoned_at IS NULL
                              AND content_digest = ?2
                              AND source_operation_id IS NOT NULL
                              AND json_array_length(effective_recipient_ids_json) = 0
                              AND NOT EXISTS (
                                  SELECT 1 FROM message_delivery
                                  WHERE message_delivery.message_id = camp_message.id
                              )
                            ORDER BY sequence, id
                            LIMIT 1
                            "#,
                            params![target.agent_run_id, final_output_digest],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if let Some(existing_final_message_id) = existing_final_message_id {
                        (Some(existing_final_message_id), true)
                    } else {
                        let final_camp_message_id = Uuid::new_v4().to_string();
                        transaction.execute(
                            r#"
                    UPDATE camp
                    SET last_message_sequence = last_message_sequence + 1,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1
                    "#,
                            params![target.camp_id, target.now],
                        )?;
                        let camp_sequence: i64 = transaction.query_row(
                            "SELECT last_message_sequence FROM camp WHERE id = ?1",
                            [&target.camp_id],
                            |row| row.get(0),
                        )?;
                        let addressed_agents_json = "[]";
                        let structured_content = vec![StructuredCampMessageSegment::Text {
                            text: envelope.payload.final_output.clone(),
                        }];
                        let structured_content_json = serde_json::to_string(&structured_content)?;
                        transaction.execute(
                            r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence,
                        author_type, author_id, source_agent_run_id, body,
                        structured_content_json, content_digest,
                        address_mode, addressed_agent_ids_json,
                        reply_to_camp_message_id, camp_turn_id, agent_run_id,
                        tombstoned_at, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8,
                        'default', ?9, ?10, ?11, ?5,
                        NULL, 1, ?12, ?12
                    )
                    "#,
                            params![
                                final_camp_message_id,
                                target.camp_id,
                                camp_sequence,
                                target.agent_id,
                                target.agent_run_id,
                                envelope.payload.final_output,
                                structured_content_json,
                                final_output_digest,
                                addressed_agents_json,
                                Option::<String>::None,
                                target.camp_turn_id,
                                target.now,
                            ],
                        )?;
                        index_camp_message(
                            transaction,
                            &final_camp_message_id,
                            &target.camp_id,
                            &envelope.payload.final_output,
                            addressed_agents_json,
                        )?;
                        append_domain_event(
                            transaction,
                            "camp_message.sent",
                            &target.camp_id,
                            ("camp_message", &final_camp_message_id),
                            &envelope.actor,
                            Some(envelope.payload.execution_epoch),
                            &json!({
                                "sequence": camp_sequence,
                                "sourceAgentRunId": target.agent_run_id,
                                "publicOutputMode": public_output_mode.as_str(),
                                "recipientFree": true,
                            }),
                        )?;
                        (Some(final_camp_message_id), false)
                    }
                } else {
                    (None, false)
                };
            let ending_git_observation = envelope
                .payload
                .ending_git_observation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'succeeded', wait_reason = NULL, wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    final_conversation_message_id = NULL,
                    final_camp_message_id = ?2,
                    ending_git_observation_json = ?6,
                    ended_at = ?3, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND status = 'running'
                  AND version = ?4 AND execution_epoch = ?5
                "#,
                params![
                    target.agent_run_id,
                    final_camp_message_id,
                    target.now,
                    envelope.payload.expected_version,
                    envelope.payload.execution_epoch,
                    ending_git_observation,
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("AgentRun changed inside its completion transaction");
            }
            append_domain_event(
                transaction,
                "agent_run.succeeded",
                &target.camp_id,
                ("agent_run", &target.agent_run_id),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "nativeTurnId": envelope.payload.native_turn_id,
                    "finalCampMessageId": final_camp_message_id,
                    "finalOutputDigest": final_output_digest,
                    "publicOutputMode": public_output_mode.as_str(),
                    "recipientFree": true,
                    "automaticPublicOutputSuppressed": automatic_public_output_suppressed,
                    "endingGitObservation": envelope.payload.ending_git_observation,
                }),
            )?;
            settle_materialized_delivery_for_agent_run(
                transaction,
                &target.agent_run_id,
                "succeeded",
                None,
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &target.now,
            )?;
            let camp_turn_status = recompute_camp_turn(
                transaction,
                &target.camp_id,
                &target.camp_turn_id,
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &target.now,
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.succeeded",
                json!({
                    "agentRunId": target.agent_run_id,
                    "campTurnId": target.camp_turn_id,
                    "campTurnStatus": camp_turn_status,
                    "finalCampMessageId": final_camp_message_id,
                    "finalOutputDigest": final_output_digest,
                    "publicOutputMode": public_output_mode.as_str(),
                    "automaticPublicOutputSuppressed": automatic_public_output_suppressed,
                }),
                Some(entity_ref("agent_run", &target.agent_run_id)),
            ))
        })?;
        if !execution.replayed && execution.result.code == "agent_run.succeeded" {
            pump_target_after_run_terminal(database, &envelope.payload.agent_run_id)?;
        }
        Ok(execution)
    }

    pub fn reject_agent_run_dispatch(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RejectAgentRunDispatchCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.error_code.trim().is_empty() {
            anyhow::bail!("AgentRun dispatch errorCode must not be empty");
        }
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id == "agent-run-scheduler"
            ) {
                return Ok(rejected(
                    "agent_run.scheduler_required",
                    "AgentRun dispatch rejection requires the scheduler",
                ));
            }
            let target = load_terminal_target(transaction, &envelope.payload.agent_run_id)?;
            let Some(target) = target else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(target.camp_id.as_str()) {
                return Ok(rejected(
                    "agent_run.camp_mismatch",
                    "AgentRun is outside the Camp",
                ));
            }
            if target.version != envelope.payload.expected_version {
                return Ok(rejected(
                    "agent_run.version_conflict",
                    "AgentRun version is stale",
                ));
            }
            if !matches!(target.status.as_str(), "queued" | "waiting")
                || target.cancel_requested_at.is_some()
            {
                return Ok(rejected(
                    "agent_run.dispatch_fenced",
                    "AgentRun is no longer awaiting dispatch",
                ));
            }
            let error_details_ref = envelope
                .payload
                .error_detail
                .as_ref()
                .map(|detail| json!({ "detail": detail }).to_string());
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', wait_reason = NULL, wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = ?2, last_error_details_ref = ?3,
                    manual_retry_allowed = ?4,
                    ended_at = ?5, version = version + 1, updated_at = ?5
                WHERE id = ?1 AND version = ?6
                  AND cancel_requested_at IS NULL
                  AND (
                    status = 'queued'
                    OR (
                      status = 'waiting'
                      AND wait_reason = 'runtime_recovery'
                      AND runtime_recovery_required = 1
                    )
                  )
                "#,
                params![
                    target.agent_run_id,
                    envelope.payload.error_code,
                    error_details_ref,
                    i64::from(envelope.payload.manual_retry_allowed),
                    target.now,
                    envelope.payload.expected_version,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.dispatch_fenced",
                    "AgentRun changed before dispatch rejection was persisted",
                ));
            }
            append_domain_event(
                transaction,
                "agent_run.failed",
                &target.camp_id,
                ("agent_run", &target.agent_run_id),
                &envelope.actor,
                Some(target.execution_epoch),
                &json!({
                    "phase": "dispatch_preflight",
                    "errorCode": envelope.payload.error_code,
                    "errorDetail": envelope.payload.error_detail,
                    "manualRetryAllowed": envelope.payload.manual_retry_allowed,
                }),
            )?;
            settle_materialized_delivery_for_agent_run(
                transaction,
                &target.agent_run_id,
                "failed",
                Some(&envelope.payload.error_code),
                &envelope.actor,
                Some(target.execution_epoch),
                &target.now,
            )?;
            let camp_turn_status = recompute_camp_turn(
                transaction,
                &target.camp_id,
                &target.camp_turn_id,
                &envelope.actor,
                Some(target.execution_epoch),
                &target.now,
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.dispatch_rejected",
                json!({
                    "agentRunId": target.agent_run_id,
                    "campTurnId": target.camp_turn_id,
                    "campTurnStatus": camp_turn_status,
                }),
                Some(entity_ref("agent_run", &target.agent_run_id)),
            ))
        })?;
        if !execution.replayed && execution.result.code == "agent_run.dispatch_rejected" {
            pump_target_after_run_terminal(database, &envelope.payload.agent_run_id)?;
        }
        Ok(execution)
    }

    pub fn fail_agent_run(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<FailAgentRunCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.error_code.trim().is_empty() {
            anyhow::bail!("AgentRun errorCode must not be empty");
        }
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if !is_runtime_adapter(&envelope.actor) {
                return Ok(rejected(
                    "runtime.adapter_required",
                    "AgentRun failure requires a Runtime Adapter",
                ));
            }
            let target = load_terminal_target(transaction, &envelope.payload.agent_run_id)?;
            let Some(target) = target else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if let Some(rejection) = validate_terminal_target(
                transaction,
                envelope.camp_id.as_deref(),
                &target,
                envelope.payload.expected_version,
                envelope.payload.execution_epoch,
            )? {
                return Ok(rejection);
            }
            let error_details_ref = envelope
                .payload
                .error_detail
                .as_ref()
                .map(|detail| json!({ "detail": detail }).to_string());
            let ending_git_observation = envelope
                .payload
                .ending_git_observation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', wait_reason = NULL, wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = ?2, last_error_details_ref = ?3,
                    manual_retry_allowed = ?4,
                    ending_git_observation_json = ?8,
                    ended_at = ?5, version = version + 1, updated_at = ?5
                WHERE id = ?1 AND status = 'running'
                  AND version = ?6 AND execution_epoch = ?7
                "#,
                params![
                    target.agent_run_id,
                    envelope.payload.error_code,
                    error_details_ref,
                    i64::from(envelope.payload.manual_retry_allowed),
                    target.now,
                    envelope.payload.expected_version,
                    envelope.payload.execution_epoch,
                    ending_git_observation,
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("AgentRun changed inside its failure transaction");
            }
            append_domain_event(
                transaction,
                "agent_run.failed",
                &target.camp_id,
                ("agent_run", &target.agent_run_id),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "errorCode": envelope.payload.error_code,
                    "errorDetail": envelope.payload.error_detail,
                    "manualRetryAllowed": envelope.payload.manual_retry_allowed,
                    "endingGitObservation": envelope.payload.ending_git_observation,
                }),
            )?;
            settle_materialized_delivery_for_agent_run(
                transaction,
                &target.agent_run_id,
                "failed",
                Some(&envelope.payload.error_code),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &target.now,
            )?;
            let camp_turn_status = recompute_camp_turn(
                transaction,
                &target.camp_id,
                &target.camp_turn_id,
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &target.now,
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.failed",
                json!({
                    "agentRunId": target.agent_run_id,
                    "campTurnId": target.camp_turn_id,
                    "campTurnStatus": camp_turn_status,
                }),
                Some(entity_ref("agent_run", &target.agent_run_id)),
            ))
        })?;
        if !execution.replayed && execution.result.code == "agent_run.failed" {
            pump_target_after_run_terminal(database, &envelope.payload.agent_run_id)?;
        }
        Ok(execution)
    }
}

struct CancellationEffectFence {
    actions_marked_unknown: usize,
    actions_closed: usize,
    approvals_cancelled: usize,
    deliveries_closed: usize,
    prepared_inputs_closed: usize,
}

fn fence_cancelled_run_effects(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    now: &str,
) -> Result<CancellationEffectFence> {
    let actions_marked_unknown = transaction.execute(
        r#"
        UPDATE action_execution
        SET status = 'unknown', unknown_disposition = 'active',
            effect_disposition = 'unknown', resolution_source = 'reconciler',
            execution_lease_owner = NULL, execution_lease_expires_at = NULL,
            last_error_code = 'agent_run_cancelled_after_dispatch',
            next_reconcile_at = ?2,
            version = version + 1, updated_at = ?2
        WHERE agent_run_id = ?1
          AND status = 'executing'
          AND dispatch_may_have_started_at IS NOT NULL
        "#,
        params![agent_run_id, now],
    )?;
    transaction.execute(
        r#"
        UPDATE action_attempt
        SET outcome = 'unknown', ended_at = COALESCE(ended_at, ?2)
        WHERE outcome IS NULL
          AND action_id IN (
            SELECT id FROM action_execution
            WHERE agent_run_id = ?1
              AND status = 'unknown'
              AND last_error_code = 'agent_run_cancelled_after_dispatch'
          )
        "#,
        params![agent_run_id, now],
    )?;
    let actions_closed = transaction.execute(
        r#"
        UPDATE action_execution
        SET status = 'not_executed',
            not_executed_reason = 'agent_run_cancelled',
            effect_disposition = 'none', ended_at = ?2,
            execution_lease_owner = NULL, execution_lease_expires_at = NULL,
            version = version + 1, updated_at = ?2
        WHERE agent_run_id = ?1
          AND (
            status = 'prepared'
            OR (
              status = 'executing'
              AND dispatch_may_have_started_at IS NULL
            )
          )
        "#,
        params![agent_run_id, now],
    )?;
    let approvals_cancelled = transaction.execute(
        r#"
        UPDATE approval
        SET status = 'cancelled',
            decision_json = '{"reason":"agent_run_cancelled"}',
            resolved_by_type = 'system',
            resolved_by_id = 'runtime-cancellation-coordinator',
            resolution_code = 'agent_run_cancelled',
            version = version + 1,
            resolved_at = ?2, updated_at = ?2
        WHERE status = 'pending'
          AND action_id IN (
            SELECT id FROM action_execution WHERE agent_run_id = ?1
          )
        "#,
        params![agent_run_id, now],
    )?;
    let deliveries_closed = transaction.execute(
        r#"
        UPDATE runtime_delivery_checkpoint
        SET status = 'safely_closed', safely_closed_at = ?2,
            lease_owner = NULL, lease_expires_at = NULL,
            last_error = 'agent_run_cancelled',
            version = version + 1, updated_at = ?2
        WHERE agent_run_id = ?1
          AND status IN ('pending', 'delivering', 'failed')
        "#,
        params![agent_run_id, now],
    )?;
    let prepared_inputs_closed = transaction.execute(
        r#"
        UPDATE runtime_input_delivery
        SET status = 'not_accepted', resolved_at = ?2,
            last_error = 'agent_run_cancelled', updated_at = ?2
        WHERE agent_run_id = ?1 AND status = 'prepared'
        "#,
        params![agent_run_id, now],
    )?;
    Ok(CancellationEffectFence {
        actions_marked_unknown,
        actions_closed,
        approvals_cancelled,
        deliveries_closed,
        prepared_inputs_closed,
    })
}

#[derive(Debug)]
struct TerminalTarget {
    agent_run_id: String,
    camp_id: String,
    camp_turn_id: String,
    agent_id: String,
    runtime_adapter_kind: Option<String>,
    status: String,
    version: i64,
    execution_epoch: i64,
    cancel_requested_at: Option<String>,
    final_conversation_message_id: Option<String>,
    final_camp_message_id: Option<String>,
    now: String,
}

fn load_terminal_target(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
) -> Result<Option<TerminalTarget>> {
    transaction
        .query_row(
            r#"
            SELECT agent_run.id, camp_turn.camp_id, agent_run.camp_turn_id,
                   conversation.agent_id,
                   agent_run.runtime_adapter_kind,
                   agent_run.status, agent_run.version, agent_run.execution_epoch,
                   agent_run.cancel_requested_at,
                   agent_run.final_conversation_message_id,
                   agent_run.final_camp_message_id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
            "#,
            [agent_run_id],
            |row| {
                Ok(TerminalTarget {
                    agent_run_id: row.get(0)?,
                    camp_id: row.get(1)?,
                    camp_turn_id: row.get(2)?,
                    agent_id: row.get(3)?,
                    runtime_adapter_kind: row.get(4)?,
                    status: row.get(5)?,
                    version: row.get(6)?,
                    execution_epoch: row.get(7)?,
                    cancel_requested_at: row.get(8)?,
                    final_conversation_message_id: row.get(9)?,
                    final_camp_message_id: row.get(10)?,
                    now: chrono::Utc::now().to_rfc3339(),
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn validate_terminal_target(
    transaction: &Transaction<'_>,
    camp_id: Option<&str>,
    target: &TerminalTarget,
    expected_version: i64,
    execution_epoch: i64,
) -> Result<Option<CommandHandlerResult>> {
    if camp_id != Some(target.camp_id.as_str()) {
        return Ok(Some(rejected(
            "agent_run.camp_mismatch",
            "AgentRun is outside the Camp",
        )));
    }
    if target.version != expected_version {
        return Ok(Some(rejected(
            "agent_run.version_conflict",
            "AgentRun version is stale",
        )));
    }
    if target.status != "running" || target.execution_epoch != execution_epoch {
        return Ok(Some(rejected(
            "agent_run.terminal_fenced",
            "AgentRun terminal update is stale or the Run is not active",
        )));
    }
    if target.cancel_requested_at.is_some() {
        return Ok(Some(rejected(
            "agent_run.terminal_fenced",
            "AgentRun was stopped before its terminal output arrived",
        )));
    }
    if target.final_conversation_message_id.is_some() || target.final_camp_message_id.is_some() {
        return Ok(Some(rejected(
            "agent_run.output_already_recorded",
            "AgentRun already has a final output",
        )));
    }
    if has_terminal_safety_blocker(transaction, &target.agent_run_id)? {
        return Ok(Some(rejected(
            "agent_run.terminal_safety_blocked",
            "Approval, Action or Runtime Delivery must settle before the Run can become terminal",
        )));
    }
    Ok(None)
}

fn has_terminal_safety_blocker(transaction: &Transaction<'_>, run_id: &str) -> Result<bool> {
    let blockers: i64 = transaction.query_row(
        r#"
        SELECT
            (SELECT COUNT(*) FROM approval
             JOIN action_execution ON action_execution.id = approval.action_id
             WHERE action_execution.agent_run_id = ?1 AND approval.status = 'pending')
          + (SELECT COUNT(*) FROM action_execution
             WHERE agent_run_id = ?1
               AND (status IN ('prepared', 'executing')
                    OR (status = 'unknown' AND unknown_disposition = 'active')))
          + (SELECT COUNT(*) FROM runtime_delivery_checkpoint
             WHERE agent_run_id = ?1 AND status IN ('pending', 'delivering', 'failed'))
          + (SELECT COUNT(*) FROM runtime_input_delivery
             WHERE agent_run_id = ?1 AND status IN ('prepared', 'delivery_unknown'))
        "#,
        [run_id],
        |row| row.get(0),
    )?;
    Ok(blockers != 0)
}

fn is_runtime_adapter(actor: &ActorRef) -> bool {
    matches!(
        actor,
        ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
    )
}

pub(crate) fn recompute_camp_turn(
    transaction: &Transaction<'_>,
    camp_id: &str,
    camp_turn_id: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<String> {
    let (current_status, cancel_requested_at, budget_exhausted_at): (
        String,
        Option<String>,
        Option<String>,
    ) = transaction.query_row(
        "SELECT status, cancel_requested_at, execution_budget_exhausted_at FROM camp_turn WHERE id = ?1 AND camp_id = ?2",
        params![camp_turn_id, camp_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let mut statement = transaction.prepare(
        r#"
        SELECT agent_run.completion_role, agent_run.status,
               agent_run.manual_retry_allowed, agent_run.retry_declined_at
        FROM agent_run
        WHERE agent_run.camp_turn_id = ?1
          AND NOT EXISTS (
              SELECT 1 FROM agent_run AS successor
              WHERE successor.predecessor_agent_run_id = agent_run.id
          )
        "#,
    )?;
    let runs = statement
        .query_map([camp_turn_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if runs.is_empty() {
        anyhow::bail!("CampTurn has no current AgentRun responsibilities");
    }

    let has_nonterminal = runs
        .iter()
        .any(|(_, status, _, _)| matches!(status.as_str(), "queued" | "running" | "waiting"));
    let delivery_statuses = {
        let mut statement = transaction.prepare(
            r#"
            SELECT status
            FROM message_delivery
            WHERE camp_turn_id = ?1
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map([camp_turn_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let has_nonterminal_delivery = delivery_statuses
        .iter()
        .any(|status| matches!(status.as_str(), "pending" | "running"));
    let has_failed_delivery = delivery_statuses
        .iter()
        .any(|status| matches!(status.as_str(), "failed" | "interrupted_before_dispatch"));
    let next_status = if budget_exhausted_at.is_some() {
        if has_nonterminal || has_nonterminal_delivery {
            "waiting"
        } else {
            "failed"
        }
    } else if cancel_requested_at.is_some() {
        if has_nonterminal || has_nonterminal_delivery {
            "waiting"
        } else {
            "cancelled"
        }
    } else if has_nonterminal || has_nonterminal_delivery {
        if runs.iter().any(|(_, status, _, _)| status == "waiting") {
            "waiting"
        } else {
            "running"
        }
    } else if has_failed_delivery {
        "failed"
    } else if runs.iter().any(|(role, status, retry, declined)| {
        role == "required" && status == "failed" && *retry && declined.is_none()
    }) {
        "waiting"
    } else if runs
        .iter()
        .any(|(role, status, _, _)| role == "required" && status == "failed")
    {
        "failed"
    } else if runs
        .iter()
        .any(|(role, status, _, _)| role == "required" && status == "cancelled")
    {
        "cancelled"
    } else {
        "completed"
    };

    if current_status != next_status {
        let ended_at = matches!(next_status, "completed" | "failed" | "cancelled").then_some(now);
        transaction.execute(
            r#"
            UPDATE camp_turn
            SET status = ?2, ended_at = ?3, version = version + 1, updated_at = ?4
            WHERE id = ?1
            "#,
            params![camp_turn_id, next_status, ended_at, now],
        )?;
        append_domain_event(
            transaction,
            "camp_turn.status_changed",
            camp_id,
            ("camp_turn", camp_turn_id),
            actor,
            execution_epoch,
            &json!({
                "previousStatus": current_status,
                "status": next_status,
            }),
        )?;
    }
    Ok(next_status.to_string())
}

fn pump_target_after_run_terminal(database: &mut Database, agent_run_id: &str) -> Result<()> {
    let target = database
        .connection()
        .query_row(
            r#"
            SELECT camp_turn.camp_id, conversation.agent_id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
            "#,
            [agent_run_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((camp_id, recipient_agent_id)) = target else {
        return Ok(());
    };
    let _ = dispatch_pending_for_recipient(
        database,
        &camp_id,
        &recipient_agent_id,
        DeliveryDispatchTrigger::TargetRunEnded,
        true,
    )?;
    Ok(())
}

#[derive(Debug)]
struct ClaimableRun {
    id: String,
    camp_id: String,
    camp_turn_id: String,
    conversation_id: String,
    task_id: Option<String>,
    input_ready_at: Option<String>,
    effective_config: Value,
    workspace: Option<Value>,
    status: String,
    wait_reason: Option<String>,
    runtime_recovery_required: bool,
    execution_epoch: i64,
    cancel_requested_at: Option<String>,
    camp_turn_status: String,
    camp_turn_cancel_requested_at: Option<String>,
    execution_budget_exhausted_at: Option<String>,
    execution_budget_deadline_at: String,
    version: i64,
    member_active: bool,
    current_default_capabilities: Value,
    current_capability_overrides: Value,
}

fn load_claimable_run(transaction: &Transaction<'_>, run_id: &str) -> Result<Option<ClaimableRun>> {
    transaction
        .query_row(
            r#"
            SELECT agent_run.id, camp_turn.camp_id, agent_run.camp_turn_id,
                   agent_run.conversation_id,
                   agent_run.task_id,
                   agent_run.input_ready_at,
                   agent_run.effective_config_json, agent_run.workspace_json,
                   agent_run.status, agent_run.wait_reason,
                   agent_run.runtime_recovery_required,
                   agent_run.execution_epoch, agent_run.cancel_requested_at,
                   agent_run.version, camp_turn.status,
                   camp_turn.cancel_requested_at,
                   camp_turn.execution_budget_exhausted_at,
                   camp_turn.execution_budget_deadline_at,
                   CASE WHEN camp_member.status = 'active'
                             AND camp_member.leave_requested_at IS NULL
                        THEN 1 ELSE 0 END,
                   agent_profile.default_capabilities_json,
                   camp_member.capability_overrides_json
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = conversation.agent_id
            WHERE agent_run.id = ?1
            "#,
            [run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, i64>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, String>(17)?,
                    row.get::<_, i64>(18)?,
                    row.get::<_, String>(19)?,
                    row.get::<_, String>(20)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                id,
                camp_id,
                camp_turn_id,
                conversation_id,
                task_id,
                input_ready_at,
                effective_config,
                workspace,
                status,
                wait_reason,
                runtime_recovery_required,
                execution_epoch,
                cancel_requested_at,
                version,
                camp_turn_status,
                camp_turn_cancel_requested_at,
                execution_budget_exhausted_at,
                execution_budget_deadline_at,
                member_active,
                current_default_capabilities,
                current_capability_overrides,
            )| {
                Ok(ClaimableRun {
                    id,
                    camp_id,
                    camp_turn_id,
                    conversation_id,
                    task_id,
                    input_ready_at,
                    effective_config: serde_json::from_str(&effective_config)
                        .context("AgentRun effective config is invalid")?,
                    workspace: workspace
                        .map(|value| {
                            serde_json::from_str(&value).context("AgentRun workspace is invalid")
                        })
                        .transpose()?,
                    status,
                    wait_reason,
                    runtime_recovery_required: runtime_recovery_required != 0,
                    execution_epoch,
                    cancel_requested_at,
                    camp_turn_status,
                    camp_turn_cancel_requested_at,
                    execution_budget_exhausted_at,
                    execution_budget_deadline_at,
                    version,
                    member_active: member_active != 0,
                    current_default_capabilities: serde_json::from_str(
                        &current_default_capabilities,
                    )
                    .context("AgentProfile capabilities are invalid")?,
                    current_capability_overrides: serde_json::from_str(
                        &current_capability_overrides,
                    )
                    .context("CampMember capability overrides are invalid")?,
                })
            },
        )
        .transpose()
}

pub(crate) fn current_authorization_covers_snapshot(
    effective_config: &Value,
    current_defaults: &Value,
    overrides: &Value,
) -> Result<bool> {
    let mut current = current_defaults
        .as_array()
        .context("current default capabilities must be an array")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .context("capability must be a string")
        })
        .collect::<Result<BTreeSet<_>>>()?;
    if let Some(overrides) = overrides.as_object() {
        for (capability, effect) in overrides {
            match effect.as_str() {
                Some("allow") => {
                    current.insert(capability.clone());
                }
                Some("deny") => {
                    current.remove(capability);
                }
                _ => anyhow::bail!("invalid CampMember capability override"),
            }
        }
    }
    let frozen = effective_config["capabilities"]
        .as_array()
        .context("frozen AgentRun capabilities must be an array")?;
    Ok(frozen
        .iter()
        .filter_map(Value::as_str)
        .all(|capability| current.contains(capability)))
}

fn task_is_executable(transaction: &Transaction<'_>, task_id: &str, camp_id: &str) -> Result<bool> {
    let executable: i64 = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM task
            WHERE task.id = ?1 AND task.camp_id = ?2
              AND task.status IN ('pending', 'in_progress')
        )
        "#,
        params![task_id, camp_id],
        |row| row.get(0),
    )?;
    Ok(executable != 0)
}

fn has_accepted_runtime_input(transaction: &Transaction<'_>, run_id: &str) -> Result<bool> {
    let accepted: i64 = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM runtime_input_delivery
            WHERE agent_run_id = ?1 AND status = 'accepted'
        )
        "#,
        [run_id],
        |row| row.get(0),
    )?;
    Ok(accepted != 0)
}

fn has_recovery_safety_blocker(transaction: &Transaction<'_>, run_id: &str) -> Result<bool> {
    let blockers: i64 = transaction.query_row(
        r#"
        SELECT
            (SELECT COUNT(*) FROM approval
             JOIN action_execution ON action_execution.id = approval.action_id
             WHERE action_execution.agent_run_id = ?1 AND approval.status = 'pending')
          + (SELECT COUNT(*) FROM action_execution
             WHERE agent_run_id = ?1 AND status IN ('executing', 'unknown'))
          + (SELECT COUNT(*) FROM runtime_delivery_checkpoint
             WHERE agent_run_id = ?1 AND status IN ('pending', 'delivering', 'failed'))
          + (SELECT COUNT(*) FROM runtime_input_delivery
             WHERE agent_run_id = ?1 AND status = 'delivery_unknown')
        "#,
        [run_id],
        |row| row.get(0),
    )?;
    Ok(blockers != 0)
}

fn workspace_matches_camp(
    transaction: &Transaction<'_>,
    camp_id: &str,
    workspace: &Value,
) -> Result<bool> {
    let project_path = transaction.query_row(
        "SELECT project_path FROM camp WHERE id = ?1",
        [camp_id],
        |row| row.get::<_, String>(0),
    )?;
    Ok(workspace["executionRoot"].as_str() == Some(project_path.as_str()))
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHostKey {
    pub adapter_kind: String,
    pub protocol_version: String,
    pub auth_scope: String,
    pub process_config_digest: String,
}

impl RuntimeHostKey {
    pub fn validate(&self) -> Result<()> {
        if !matches!(
            self.adapter_kind.as_str(),
            "codex-cli" | "opencode-cli" | "copilot-cli" | "claude-code-cli" | "antigravity-app"
        ) || self.protocol_version.trim().is_empty()
            || self.auth_scope.trim().is_empty()
            || self.process_config_digest.trim().is_empty()
        {
            anyhow::bail!("RuntimeHostKey is incomplete or unsupported");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeHostDescriptor {
    pub host_instance_id: String,
    pub key: RuntimeHostKey,
    pub fenced: bool,
}

#[derive(Debug, Default)]
pub struct RuntimeHostManager {
    hosts: HashMap<RuntimeHostKey, RuntimeHostDescriptor>,
}

impl RuntimeHostManager {
    pub fn acquire(&mut self, key: RuntimeHostKey) -> Result<RuntimeHostDescriptor> {
        key.validate()?;
        if let Some(host) = self.hosts.get(&key)
            && !host.fenced
        {
            return Ok(host.clone());
        }
        let host = RuntimeHostDescriptor {
            host_instance_id: Uuid::new_v4().to_string(),
            key: key.clone(),
            fenced: false,
        };
        self.hosts.insert(key, host.clone());
        Ok(host)
    }

    pub fn fence(&mut self, host_instance_id: &str) -> bool {
        let Some(host) = self
            .hosts
            .values_mut()
            .find(|host| host.host_instance_id == host_instance_id)
        else {
            return false;
        };
        host.fenced = true;
        true
    }

    pub fn is_current(&self, host_instance_id: &str) -> bool {
        self.hosts
            .values()
            .any(|host| host.host_instance_id == host_instance_id && !host.fenced)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeThreadBinding {
    pub host_instance_id: String,
    pub conversation_id: String,
    pub native_thread_id: String,
    pub active_agent_run_id: Option<String>,
    pub execution_epoch: Option<i64>,
    pub native_turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeEventRoute {
    pub conversation_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub native_turn_id: String,
}

#[derive(Debug, Default)]
pub struct NativeThreadBindingRegistry {
    by_thread: HashMap<String, NativeThreadBinding>,
    by_conversation: HashMap<String, String>,
}

impl NativeThreadBindingRegistry {
    pub fn bind(&mut self, binding: NativeThreadBinding) -> Result<()> {
        if binding.host_instance_id.trim().is_empty()
            || binding.conversation_id.trim().is_empty()
            || binding.native_thread_id.trim().is_empty()
        {
            anyhow::bail!("Native Thread binding identifiers must not be empty");
        }
        if let Some(existing_thread) = self.by_conversation.get(&binding.conversation_id)
            && existing_thread != &binding.native_thread_id
        {
            anyhow::bail!("Conversation is already bound to another Native Thread");
        }
        if let Some(existing) = self.by_thread.get(&binding.native_thread_id)
            && existing.conversation_id != binding.conversation_id
        {
            anyhow::bail!("Native Thread is already bound to another Conversation");
        }
        self.by_conversation.insert(
            binding.conversation_id.clone(),
            binding.native_thread_id.clone(),
        );
        self.by_thread
            .insert(binding.native_thread_id.clone(), binding);
        Ok(())
    }

    pub fn activate(
        &mut self,
        host_instance_id: &str,
        native_thread_id: &str,
        agent_run_id: String,
        execution_epoch: i64,
        native_turn_id: String,
    ) -> Result<()> {
        let binding = self
            .by_thread
            .get_mut(native_thread_id)
            .context("Native Thread is not registered")?;
        if binding.host_instance_id != host_instance_id {
            anyhow::bail!("Runtime Host instance is fenced");
        }
        if binding.active_agent_run_id.is_some() {
            anyhow::bail!("Native Thread already has an active AgentRun");
        }
        binding.active_agent_run_id = Some(agent_run_id);
        binding.execution_epoch = Some(execution_epoch);
        binding.native_turn_id = Some(native_turn_id);
        Ok(())
    }

    pub fn route(
        &self,
        host_instance_id: &str,
        native_thread_id: &str,
        native_turn_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<RuntimeEventRoute> {
        let binding = self
            .by_thread
            .get(native_thread_id)
            .context("Runtime event has no Native Thread binding")?;
        if binding.host_instance_id != host_instance_id
            || binding.native_turn_id.as_deref() != Some(native_turn_id)
            || binding.active_agent_run_id.as_deref() != Some(agent_run_id)
            || binding.execution_epoch != Some(execution_epoch)
        {
            anyhow::bail!("Runtime event failed host/thread/turn/run/epoch fencing");
        }
        Ok(RuntimeEventRoute {
            conversation_id: binding.conversation_id.clone(),
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
            native_turn_id: native_turn_id.to_string(),
        })
    }

    pub fn fence_host(&mut self, host_instance_id: &str) -> usize {
        let removed = self
            .by_thread
            .iter()
            .filter(|(_, binding)| binding.host_instance_id == host_instance_id)
            .map(|(thread_id, _)| thread_id.clone())
            .collect::<Vec<_>>();
        for thread_id in &removed {
            if let Some(binding) = self.by_thread.remove(thread_id) {
                self.by_conversation.remove(&binding.conversation_id);
            }
        }
        removed.len()
    }
}

fn append_domain_event(
    transaction: &Transaction<'_>,
    event_type: &str,
    camp_id: &str,
    entity: (&str, &str),
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    payload: &Value,
) -> Result<()> {
    let (actor_type, actor_id, source_agent_run_id) = match actor {
        ActorRef::User { user_id } => ("user", user_id.as_str(), None),
        ActorRef::Agent {
            agent_id,
            source_agent_run_id,
        } => (
            "agent",
            agent_id.as_str(),
            Some(source_agent_run_id.as_str()),
        ),
        ActorRef::System { component_id } => ("system", component_id.as_str(), None),
    };
    transaction.execute(
        r#"
        INSERT INTO event_log(
            event_id, task_id, turn_id, sequence, event_type, native_method,
            payload_json, camp_id, entity_type, entity_id,
            actor_type, actor_id, source_agent_run_id, execution_epoch, created_at
        ) VALUES (?1, NULL, NULL, NULL, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            Uuid::new_v4().to_string(),
            event_type,
            serde_json::to_string(payload)?,
            camp_id,
            entity.0,
            entity.1,
            actor_type,
            actor_id,
            source_agent_run_id,
            execution_epoch,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn entity_ref(entity_type: &str, entity_id: &str) -> EntityReference {
    EntityReference {
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::{
            AdapterKind, AdapterPermissionConfig, FrozenAgentRuntimeConfig, ResolvedModelSelection,
            configure_test_runtime,
        },
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ExecutionRequest,
            TestCampMessageAddress, TestCampMessageCommand,
        },
        command::CommandResultStatus,
        execution_budget::CampTurnExecutionBudgetRequest,
    };

    fn host_key(scope: &str) -> RuntimeHostKey {
        RuntimeHostKey {
            adapter_kind: "codex-cli".to_string(),
            protocol_version: "0.1".to_string(),
            auth_scope: scope.to_string(),
            process_config_digest: "digest-v1".to_string(),
        }
    }

    fn resume_execution(
        previous_key: Option<&str>,
        current_key: Option<&str>,
        previous_generation: i64,
        current_generation: i64,
    ) -> AgentRunExecution {
        AgentRunExecution {
            agent_run_id: "run-resume".to_string(),
            camp_id: "camp-resume".to_string(),
            camp_turn_id: "turn-resume".to_string(),
            conversation_id: "conversation-resume".to_string(),
            conversation_version: 1,
            agent_id: "agent_1".to_string(),
            task_id: None,
            version: 1,
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
            project_binding_kind: "directory".to_string(),
            project_path: "/tmp".to_string(),
            execution_epoch: 1,
            status: "running".to_string(),
            wait_reason: None,
            runtime_recovery_required: false,
            native_adapter_installation_id: Some("adapter-test-codex".to_string()),
            native_session_id: Some("session-existing".to_string()),
            native_binding_compatibility_digest: Some("binding-stable".to_string()),
            native_installation_generation: Some(previous_generation),
            native_session_compatibility_key: previous_key.map(str::to_string),
            purpose: "resume safely".to_string(),
            expected_output: "result".to_string(),
            effective_config: json!({}),
            runtime: FrozenAgentRuntimeConfig {
                adapter_kind: AdapterKind::CodexCli,
                installation_id: "adapter-test-codex".to_string(),
                installation_generation: current_generation,
                search_environment_generation: 1,
                executable_path: "/tmp/codex".to_string(),
                auth_scope: "test-user".to_string(),
                reported_version: "1.2.3".to_string(),
                executable_fingerprint: "sha256:test".to_string(),
                capabilities: Vec::new(),
                protocol_version: "codex-app-server-v2".to_string(),
                model: ResolvedModelSelection {
                    source: "runtime_default".to_string(),
                    model_id: "gpt-test".to_string(),
                    options: json!({}),
                },
                permissions: AdapterPermissionConfig {
                    adapter_kind: AdapterKind::CodexCli,
                    schema_version: 1,
                    values: json!({}),
                },
                native_session_compatibility_key: current_key.map(str::to_string),
                binding_compatibility_digest: "binding-stable".to_string(),
                host_config_digest: "host-current".to_string(),
                config_digest: "config-current".to_string(),
            },
            workspace: AgentRunWorkspace::runtime_managed_path("/tmp".to_string()),
            runtime_compatibility_digest: None,
        }
    }

    #[test]
    fn session_compatibility_key_controls_resume_independently_of_installation_generation() {
        assert_eq!(
            resume_execution(Some("session-v1"), Some("session-v1"), 1, 2)
                .native_session_resume_disposition(),
            NativeSessionResumeDisposition::Compatible
        );
        assert_eq!(
            resume_execution(Some("session-v1"), Some("session-v2"), 1, 2)
                .native_session_resume_disposition(),
            NativeSessionResumeDisposition::New
        );
        assert_eq!(
            resume_execution(Some("session-v1"), None, 1, 2).native_session_resume_disposition(),
            NativeSessionResumeDisposition::Controlled
        );
        assert_eq!(
            resume_execution(None, None, 1, 1).native_session_resume_disposition(),
            NativeSessionResumeDisposition::Compatible
        );
        assert_eq!(
            resume_execution(None, None, 1, 2).native_session_resume_disposition(),
            NativeSessionResumeDisposition::Controlled
        );
    }

    #[test]
    fn controlled_resume_is_persistently_fenced_after_a_crash_or_failure() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-resume-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'camp-resume', 'Resume', 'directory', '/tmp',
                    0, 1, ?1, ?1
                )
                "#,
                [&now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id,
                    native_adapter_installation_id, native_session_id,
                    native_binding_compatibility_digest,
                    native_installation_generation,
                    native_session_compatibility_key,
                    version, created_at, updated_at
                ) VALUES (
                    'conversation-resume', 'camp-resume', 'agent_1',
                    'adapter-test-codex', 'session-existing',
                    'binding-stable', 1, NULL, 1, ?1, ?1
                )
                "#,
                [&now],
            )
            .unwrap();
        let service = ExecutionRuntimeService::default();
        let generation_two = resume_execution(None, None, 1, 2);
        assert_eq!(
            service
                .prepare_native_session_resume(&mut database, &generation_two)
                .unwrap(),
            NativeSessionResumeDisposition::Controlled
        );
        assert_eq!(
            service
                .prepare_native_session_resume(&mut database, &generation_two)
                .unwrap(),
            NativeSessionResumeDisposition::New,
            "an unfinished pre-input attempt becomes ambiguous after restart"
        );
        let crash_status: String = database
            .connection()
            .query_row(
                r#"
                SELECT status FROM native_session_resume_attempt
                WHERE conversation_id = 'conversation-resume'
                  AND installation_generation = 2
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(crash_status, "ambiguous");

        let generation_three = resume_execution(None, None, 1, 3);
        assert_eq!(
            service
                .prepare_native_session_resume(&mut database, &generation_three)
                .unwrap(),
            NativeSessionResumeDisposition::Controlled
        );
        service
            .record_native_session_resume_failure(
                &mut database,
                &generation_three,
                NativeSessionResumeFailure::Incompatible,
            )
            .unwrap();
        assert_eq!(
            service
                .prepare_native_session_resume(&mut database, &generation_three)
                .unwrap(),
            NativeSessionResumeDisposition::New
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn host_manager_reuses_only_the_same_unfenced_key() {
        let mut manager = RuntimeHostManager::default();
        let first = manager.acquire(host_key("local-user")).unwrap();
        let reused = manager.acquire(host_key("local-user")).unwrap();
        let other = manager.acquire(host_key("other-user")).unwrap();

        assert_eq!(first.host_instance_id, reused.host_instance_id);
        assert_ne!(first.host_instance_id, other.host_instance_id);
        assert!(manager.fence(&first.host_instance_id));
        assert!(!manager.is_current(&first.host_instance_id));
        let replacement = manager.acquire(host_key("local-user")).unwrap();
        assert_ne!(first.host_instance_id, replacement.host_instance_id);
    }

    #[test]
    fn event_routing_fences_host_thread_turn_run_and_epoch() {
        let mut registry = NativeThreadBindingRegistry::default();
        registry
            .bind(NativeThreadBinding {
                host_instance_id: "host-1".to_string(),
                conversation_id: "conversation-a".to_string(),
                native_thread_id: "thread-a".to_string(),
                active_agent_run_id: None,
                execution_epoch: None,
                native_turn_id: None,
            })
            .unwrap();
        registry
            .bind(NativeThreadBinding {
                host_instance_id: "host-1".to_string(),
                conversation_id: "conversation-b".to_string(),
                native_thread_id: "thread-b".to_string(),
                active_agent_run_id: None,
                execution_epoch: None,
                native_turn_id: None,
            })
            .unwrap();
        registry
            .activate(
                "host-1",
                "thread-a",
                "run-a".to_string(),
                3,
                "turn-a".to_string(),
            )
            .unwrap();
        registry
            .activate(
                "host-1",
                "thread-b",
                "run-b".to_string(),
                7,
                "turn-b".to_string(),
            )
            .unwrap();

        let route = registry
            .route("host-1", "thread-b", "turn-b", "run-b", 7)
            .unwrap();
        assert_eq!(route.conversation_id, "conversation-b");
        assert!(
            registry
                .route("host-old", "thread-b", "turn-b", "run-b", 7)
                .is_err()
        );
        assert!(
            registry
                .route("host-1", "thread-a", "turn-b", "run-b", 7)
                .is_err()
        );
        assert!(
            registry
                .route("host-1", "thread-b", "turn-b", "run-b", 6)
                .is_err()
        );
        assert_eq!(registry.fence_host("host-1"), 2);
        assert!(
            registry
                .route("host-1", "thread-b", "turn-b", "run-b", 7)
                .is_err()
        );
    }

    #[test]
    fn manual_native_session_restart_keeps_conversation_identity_and_generation() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-restart-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'restart-camp', 'Restart', 'directory', ?1,
                    0, 1, ?2, ?2
                )
                "#,
                params![directory.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id,
                    native_adapter_installation_id, native_session_id,
                    native_binding_compatibility_digest, native_binding_id,
                    native_binding_generation, native_binding_secret_digest,
                    last_accepted_public_boundary_sequence,
                    native_charter_digest, native_member_state_digest,
                    version, created_at, updated_at
                ) VALUES (
                    'restart-conversation', 'restart-camp', 'agent_1',
                    'adapter-test-codex', 'session-old', 'digest-old', ?1,
                    7, 'secret-old', 12, 'charter-old', 'members-old',
                    1, ?2, ?2
                )
                "#,
                params![Uuid::new_v4().to_string(), now],
            )
            .unwrap();

        let envelope = user_envelope(
            "restart-native-session",
            Some("restart-camp"),
            RestartNativeSessionCommand {
                conversation_id: "restart-conversation".to_string(),
                expected_version: 1,
            },
        );
        let execution = ExecutionRuntimeService::default()
            .restart_native_session(&mut database, &envelope)
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Applied);
        let replay = ExecutionRuntimeService::default()
            .restart_native_session(&mut database, &envelope)
            .unwrap();
        assert!(replay.replayed);
        let state: (
            String,
            String,
            i64,
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT camp_id, agent_id, version,
                       native_binding_generation,
                       native_adapter_installation_id, native_session_id,
                       native_binding_id
                FROM conversation WHERE id = 'restart-conversation'
                "#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(state.0, "restart-camp");
        assert_eq!(state.1, "agent_1");
        assert_eq!(state.2, 2);
        assert_eq!(state.3, 7);
        assert!(state.4.is_none() && state.5.is_none() && state.6.is_none());
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn scheduler_envelope<P>(command_id: &str, camp_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: "agent-run-scheduler".to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn adapter_envelope<P>(command_id: &str, camp_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: "runtime-adapter:codex".to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn test_git_observation(
        state: crate::git::GitCapabilityState,
        head_commit: Option<&str>,
    ) -> GitObservation {
        GitObservation {
            state,
            repository_root: None,
            git_common_dir: None,
            object_format: None,
            head_commit: head_commit.map(str::to_string),
            branch: None,
            dirty: (state == crate::git::GitCapabilityState::GitValid).then_some(false),
            observed_at: "2026-07-30T00:00:00Z".to_string(),
            diagnostic: None,
        }
    }

    #[test]
    fn scheduler_serializes_one_conversation_and_increments_recovery_epoch() {
        let directory = std::env::temp_dir().join(format!("rovai-runtime-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "runtime-create-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "runtime-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let mut run_ids = Vec::new();
        for index in 0..2 {
            let turn = collaboration
                .send_test_camp_message(
                    &mut database,
                    &user_envelope(
                        &format!("runtime-turn-{index}"),
                        Some(&camp_id),
                        TestCampMessageCommand {
                            camp_id: camp_id.clone(),
                            draft_revision: None,
                            body: format!("执行职责 {index}"),
                            prepared_attachment_ids: Vec::new(),
                            address: TestCampMessageAddress::Default,
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: None,
                                purpose: format!("职责 {index}"),
                                expected_output: "公开结果".to_string(),
                                completion_role: "required".to_string(),
                                budget: None,
                            }),
                        },
                    ),
                )
                .unwrap();
            run_ids.push(
                turn.result.payload["agentRunIds"][0]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        let runtime = ExecutionRuntimeService::default();
        let claim = runtime
            .claim_agent_run(
                &mut database,
                &scheduler_envelope(
                    "claim-first-run",
                    &camp_id,
                    ClaimAgentRunCommand {
                        agent_run_id: run_ids[0].clone(),
                        expected_version: 1,
                        lease_owner: "runtime-host-1".to_string(),
                        lease_seconds: 60,
                        workspace: Some(AgentRunWorkspace {
                            execution_root: workspace.to_string_lossy().to_string(),
                            access: "write".to_string(),
                            isolation: "shared".to_string(),
                        }),
                        starting_git_observation: Some(test_git_observation(
                            crate::git::GitCapabilityState::NotGit,
                            None,
                        )),
                    },
                ),
            )
            .unwrap();
        assert_eq!(claim.result.status, CommandResultStatus::Accepted);
        assert_eq!(claim.result.payload["executionEpoch"], 1);
        let execution = runtime
            .load_agent_run_execution(&database, &run_ids[0], 1)
            .unwrap()
            .expect("claimed AgentRun should materialize");
        assert_eq!(execution.runtime.installation_id, "adapter-test-codex");
        assert_eq!(execution.runtime.model.model_id, "gpt-test");
        database
            .connection()
            .execute(
                r#"
                INSERT INTO native_session_resume_attempt(
                    conversation_id, installation_id,
                    installation_generation, status,
                    attempted_at, completed_at
                ) VALUES (?1, ?2, ?3, 'attempting', ?4, NULL)
                "#,
                params![
                    execution.conversation_id,
                    execution.runtime.installation_id,
                    execution.runtime.installation_generation,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
        let bound = runtime
            .bind_native_session(
                &mut database,
                &adapter_envelope(
                    "bind-first-session",
                    &camp_id,
                    BindNativeSessionCommand {
                        conversation_id: execution.conversation_id.clone(),
                        agent_run_id: execution.agent_run_id.clone(),
                        expected_conversation_version: execution.conversation_version,
                        expected_execution_epoch: execution.execution_epoch,
                        previous_adapter_installation_id: None,
                        previous_native_session_id: None,
                        previous_binding_compatibility_digest: None,
                        proposed_binding_id: None,
                        adapter_installation_id: execution.runtime.installation_id.clone(),
                        native_session_id: "thread-first".to_string(),
                        binding_compatibility_digest: execution
                            .runtime
                            .binding_compatibility_digest
                            .clone(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(bound.result.status, CommandResultStatus::Applied);
        let binding: (Option<String>, Option<String>, Option<String>) = database
            .connection()
            .query_row(
                r#"
                SELECT native_adapter_installation_id, native_session_id,
                       native_binding_compatibility_digest
                FROM conversation WHERE id = ?1
                "#,
                [&execution.conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(binding.0.as_deref(), Some("adapter-test-codex"));
        assert_eq!(binding.1.as_deref(), Some("thread-first"));
        assert_eq!(
            binding.2.as_deref(),
            Some(execution.runtime.binding_compatibility_digest.as_str())
        );
        let resume_status: String = database
            .connection()
            .query_row(
                r#"
                SELECT status
                FROM native_session_resume_attempt
                WHERE conversation_id = ?1
                  AND installation_id = ?2
                  AND installation_generation = ?3
                "#,
                params![
                    execution.conversation_id,
                    execution.runtime.installation_id,
                    execution.runtime.installation_generation,
                ],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(resume_status, "succeeded");

        let busy = runtime
            .claim_agent_run(
                &mut database,
                &scheduler_envelope(
                    "claim-second-run",
                    &camp_id,
                    ClaimAgentRunCommand {
                        agent_run_id: run_ids[1].clone(),
                        expected_version: 1,
                        lease_owner: "runtime-host-1".to_string(),
                        lease_seconds: 60,
                        workspace: None,
                        starting_git_observation: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(busy.result.status, CommandResultStatus::Rejected);
        assert_eq!(busy.result.code, "agent_run.conversation_busy");

        let marked = runtime
            .mark_for_recovery(
                &mut database,
                &CommandEnvelope {
                    command_id: "mark-recovery".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-recovery-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: MarkAgentRunForRecoveryCommand {
                        agent_run_id: run_ids[0].clone(),
                        expected_version: 2,
                        execution_epoch: 1,
                        reason: "host_lost".to_string(),
                    },
                },
            )
            .unwrap();
        assert_eq!(marked.result.status, CommandResultStatus::Accepted);
        let reclaimed = runtime
            .claim_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "reclaim-first-run".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-recovery-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: run_ids[0].clone(),
                        expected_version: 3,
                        lease_owner: "runtime-host-2".to_string(),
                        lease_seconds: 60,
                        workspace: None,
                        starting_git_observation: Some(test_git_observation(
                            crate::git::GitCapabilityState::GitValid,
                            Some("1111111111111111111111111111111111111111"),
                        )),
                    },
                },
            )
            .unwrap();
        assert_eq!(reclaimed.result.status, CommandResultStatus::Accepted);
        assert_eq!(reclaimed.result.payload["executionEpoch"], 2);
        let starting_observation_json: String = database
            .connection()
            .query_row(
                "SELECT starting_git_observation_json FROM agent_run WHERE id = ?1",
                [&run_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        let starting_observation: GitObservation =
            serde_json::from_str(&starting_observation_json).unwrap();
        assert_eq!(
            starting_observation.state,
            crate::git::GitCapabilityState::NotGit,
            "recovery must preserve the original run-start observation"
        );

        let stale_recovery = runtime
            .mark_for_recovery(
                &mut database,
                &CommandEnvelope {
                    command_id: "stale-recovery".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-recovery-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: MarkAgentRunForRecoveryCommand {
                        agent_run_id: run_ids[0].clone(),
                        expected_version: 4,
                        execution_epoch: 1,
                        reason: "late_host_callback".to_string(),
                    },
                },
            )
            .unwrap();
        assert_eq!(stale_recovery.result.status, CommandResultStatus::Rejected);
        assert_eq!(stale_recovery.result.code, "agent_run.recovery_fenced");
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn scheduler_can_reject_a_queued_run_without_starting_it_or_removing_its_message() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-dispatch-reject-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "dispatch-reject-create",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "dispatch-reject-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let sent = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "dispatch-reject-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "消息必须保留".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证调度失败".to_string(),
                            expected_output: "不启动 Runtime".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let runtime = ExecutionRuntimeService::default();
        let rejected = runtime
            .reject_agent_run_dispatch(
                &mut database,
                &scheduler_envelope(
                    "dispatch-reject-run",
                    &camp_id,
                    RejectAgentRunDispatchCommand {
                        agent_run_id: run_id.clone(),
                        expected_version: 1,
                        error_code: "workspace_unavailable".to_string(),
                        error_detail: Some("workspace safety check failed".to_string()),
                        manual_retry_allowed: true,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Applied);
        let state: (String, String, Option<String>, Option<String>, String) = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.status, camp_turn.status,
                       agent_run.started_at, agent_run.starting_git_observation_json,
                       agent_run.last_error_code
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE agent_run.id = ?1
                "#,
                [&run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(state.0, "failed");
        assert_eq!(state.1, "waiting");
        assert!(state.2.is_none());
        assert!(state.3.is_none());
        assert_eq!(state.4, "workspace_unavailable");
        let message_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row.get(0))
            .unwrap();
        assert_eq!(message_count, 1);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn persisted_deadline_exhausts_after_reopen_and_fences_dispatch_recovery_and_replay() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-budget-restart-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "budget-restart-create-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "budget-restart-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let sent = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "budget-restart-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "执行一个受 deadline 约束的职责".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证持久化 deadline".to_string(),
                            expected_output: "到期后不得启动".to_string(),
                            completion_role: "required".to_string(),
                            budget: Some(CampTurnExecutionBudgetRequest {
                                elapsed_seconds: 60,
                                max_agent_run_responsibilities: 1,
                                max_accepted_a2a: 0,
                            }),
                        }),
                    },
                ),
            )
            .unwrap();
        let camp_turn_id = sent.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        let agent_run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let deadline_at: String = database
            .connection()
            .query_row(
                "SELECT execution_budget_deadline_at FROM camp_turn WHERE id = ?1",
                [&camp_turn_id],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);

        let mut database = Database::open(&directory).unwrap();
        let observed_after_deadline = chrono::DateTime::parse_from_rfc3339(&deadline_at)
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::seconds(1);
        let runtime = ExecutionRuntimeService::default();
        let expired = runtime
            .expire_elapsed_camp_turn_execution_budgets(&mut database, observed_after_deadline, 10)
            .unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].camp_turn_id, camp_turn_id);
        assert_eq!(expired[0].deadline_at, deadline_at);
        assert_eq!(expired[0].agent_runs_fenced, 1);
        assert!(
            runtime
                .list_dispatchable_agent_runs(&database, 10)
                .unwrap()
                .is_empty()
        );
        let state: (String, String, String, i64, String) = database
            .connection()
            .query_row(
                r#"
                SELECT execution_budget_deadline_at,
                       execution_budget_exhaustion_reason,
                       execution_budget_exhaustion_command_id,
                       (SELECT COUNT(*) FROM event_log
                        WHERE event_type = 'camp_turn.execution_budget_exhausted'),
                       (SELECT cancel_reason_code FROM agent_run WHERE id = ?2)
                FROM camp_turn WHERE id = ?1
                "#,
                params![camp_turn_id, agent_run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(state.0, deadline_at);
        assert_eq!(state.1, "elapsed");
        assert_eq!(
            state.2,
            format!("camp-turn-execution-budget-expiry:{camp_turn_id}")
        );
        assert_eq!(state.3, 1);
        assert_eq!(state.4, "execution_budget_exhausted");

        let run_version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let claim = runtime
            .claim_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "budget-restart-claim".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-recovery-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: agent_run_id.clone(),
                        expected_version: run_version,
                        lease_owner: "recovery-after-deadline".to_string(),
                        lease_seconds: 60,
                        workspace: None,
                        starting_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(claim.result.code, "agent_run.execution_budget_exhausted");
        let no_second_expiry = runtime
            .expire_elapsed_camp_turn_execution_budgets(
                &mut database,
                observed_after_deadline + chrono::Duration::seconds(1),
                10,
            )
            .unwrap();
        assert!(no_second_expiry.is_empty());

        let candidate = runtime
            .list_cancellation_candidates(&database, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == agent_run_id)
            .unwrap();
        let acknowledged = runtime
            .acknowledge_agent_run_cancellation(
                &mut database,
                &CommandEnvelope {
                    command_id: "budget-restart-ack".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-cancellation-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AcknowledgeAgentRunCancellationCommand {
                        agent_run_id,
                        expected_version: candidate.version,
                        execution_epoch: candidate.execution_epoch,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(acknowledged.result.payload["campTurnStatus"], "failed");
        assert_eq!(
            acknowledged.result.payload["reasonCode"],
            "execution_budget_exhausted"
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn camp_turn_cancellation_is_persisted_and_finalized_from_authoritative_state() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-cancel-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "cancel-create-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "cancel-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let sent = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "cancel-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "开始一项可取消职责".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证停止运行".to_string(),
                            expected_output: "不应产生输出".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let camp_turn_id = sent.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        let agent_run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let runtime = ExecutionRuntimeService::default();
        let cancel_envelope = user_envelope(
            "cancel-turn",
            Some(&camp_id),
            CancelCampTurnCommand {
                camp_id: camp_id.clone(),
                camp_turn_id: camp_turn_id.clone(),
                expected_version: 1,
            },
        );
        let requested = runtime
            .request_camp_turn_cancellation(&mut database, &cancel_envelope)
            .unwrap();
        assert_eq!(requested.result.status, CommandResultStatus::Accepted);
        assert_eq!(requested.result.code, "camp_turn.cancellation_requested");
        let replay = runtime
            .request_camp_turn_cancellation(&mut database, &cancel_envelope)
            .unwrap();
        assert!(replay.replayed);

        let candidates = runtime.list_cancellation_candidates(&database, 10).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].agent_run_id, agent_run_id);
        assert_eq!(candidates[0].status, "queued");
        let acknowledged = runtime
            .acknowledge_agent_run_cancellation(
                &mut database,
                &CommandEnvelope {
                    command_id: "cancel-ack".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-cancellation-coordinator".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AcknowledgeAgentRunCancellationCommand {
                        agent_run_id: agent_run_id.clone(),
                        expected_version: candidates[0].version,
                        execution_epoch: candidates[0].execution_epoch,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(acknowledged.result.status, CommandResultStatus::Applied);
        assert_eq!(acknowledged.result.payload["campTurnStatus"], "cancelled");
        let state: (String, String, i64, i64, Option<String>) = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.status, camp_turn.status,
                       agent_run.cancel_requested_at IS NOT NULL,
                       agent_run.cancel_acknowledged_at IS NOT NULL,
                       agent_run.ending_git_observation_json
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE agent_run.id = ?1
                "#,
                [&agent_run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(&state.0, "cancelled");
        assert_eq!(&state.1, "cancelled");
        assert_eq!((state.2, state.3), (1, 1));
        assert!(state.4.is_none());

        let observation = test_git_observation(
            crate::git::GitCapabilityState::GitValid,
            Some("2222222222222222222222222222222222222222"),
        );
        let recorded = runtime
            .record_cancelled_agent_run_ending_git_observation(
                &mut database,
                &CommandEnvelope {
                    command_id: "cancel-ending-git".to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-git-observer".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RecordCancelledAgentRunEndingGitObservationCommand {
                        agent_run_id: agent_run_id.clone(),
                        execution_epoch: candidates[0].execution_epoch,
                        ending_git_observation: observation.clone(),
                    },
                },
            )
            .unwrap();
        assert_eq!(recorded.result.status, CommandResultStatus::Applied);
        let persisted_observation: String = database
            .connection()
            .query_row(
                "SELECT ending_git_observation_json FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<GitObservation>(&persisted_observation).unwrap(),
            observation
        );
        assert!(
            runtime
                .list_cancellation_candidates(&database, 10)
                .unwrap()
                .is_empty()
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn away_members_keep_queued_runs_and_terminal_output_completes_the_turn_once() {
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-fanout-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "fanout-runtime-create-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2", "agent_1"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        for agent_id in ["agent_2", "agent_1"] {
            collaboration
                .add_camp_member(
                    &mut database,
                    &user_envelope(
                        &format!("fanout-runtime-add-{agent_id}"),
                        Some(&camp_id),
                        AddCampMemberCommand {
                            camp_id: camp_id.clone(),
                            agent_id: agent_id.to_string(),
                            capability_overrides: json!({}),
                        },
                    ),
                )
                .unwrap();
        }
        configure_test_runtime(&database, &["agent_2", "agent_1"]);
        let queued = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "fanout-runtime-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "请独立分析并公开各自结论。".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_2".to_string(), "agent_1".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "独立分析".to_string(),
                            expected_output: "公开结论".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let camp_turn_id = queued.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id IN ('agent_2', 'agent_1')",
                [],
            )
            .unwrap();
        // Public output mode is frozen on AgentRun, not re-read from a later
        // Profile edit while the Runtime is completing the Run.
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET selected_runtime_adapter_kind = 'opencode-cli' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let runtime = ExecutionRuntimeService::default();
        let candidates = runtime.list_dispatchable_agent_runs(&database, 10).unwrap();
        assert_eq!(candidates.len(), 2);
        assert_eq!(
            candidates
                .iter()
                .find(|candidate| candidate.agent_id == "agent_2")
                .unwrap()
                .execution_workspace()
                .access,
            "write"
        );
        assert_eq!(
            candidates
                .iter()
                .find(|candidate| candidate.agent_id == "agent_1")
                .unwrap()
                .execution_workspace()
                .access,
            "write"
        );
        assert!(candidates.iter().all(
            |candidate| candidate.permission_semantics == PermissionSemantics::RuntimeManagedV2
        ));

        let mut executions = Vec::new();
        for (index, candidate) in candidates.iter().enumerate() {
            let claim = runtime
                .claim_agent_run(
                    &mut database,
                    &scheduler_envelope(
                        &format!("fanout-claim-{index}"),
                        &camp_id,
                        ClaimAgentRunCommand {
                            agent_run_id: candidate.agent_run_id.clone(),
                            expected_version: candidate.version,
                            lease_owner: format!("runtime-host-{index}"),
                            lease_seconds: 60,
                            workspace: Some(candidate.execution_workspace()),
                            starting_git_observation: None,
                        },
                    ),
                )
                .unwrap();
            assert_eq!(claim.result.status, CommandResultStatus::Accepted);
            let execution = runtime
                .load_agent_run_execution(&database, &candidate.agent_run_id, 1)
                .unwrap()
                .unwrap();
            executions.push(execution);
        }

        for (index, execution) in executions.iter().enumerate() {
            let completed = runtime
                .succeed_agent_run(
                    &mut database,
                    &adapter_envelope(
                        &format!("fanout-complete-{index}"),
                        &camp_id,
                        SucceedAgentRunCommand {
                            agent_run_id: execution.agent_run_id.clone(),
                            expected_version: execution.version,
                            execution_epoch: execution.execution_epoch,
                            native_turn_id: format!("native-turn-{index}"),
                            final_output: format!("Agent {index} 的公开结论"),
                            ending_git_observation: Some(test_git_observation(
                                crate::git::GitCapabilityState::NotGit,
                                None,
                            )),
                        },
                    ),
                )
                .unwrap();
            assert_eq!(completed.result.status, CommandResultStatus::Applied);
            assert_eq!(
                completed.result.payload["campTurnStatus"],
                if index == 0 { "running" } else { "completed" }
            );
        }

        let turn_status: String = database
            .connection()
            .query_row(
                "SELECT status FROM camp_turn WHERE id = ?1",
                [&camp_turn_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(turn_status, "completed");
        let final_outputs: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE final_camp_message_id IS NOT NULL AND final_conversation_message_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(final_outputs, 2);
        let ending_observations: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE ending_git_observation_json IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ending_observations, 2);
        let public_agent_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(public_agent_messages, 2);
        let recipient_free_defaults: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id IS NOT NULL AND address_mode = 'default' AND addressed_agent_ids_json = '[]'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recipient_free_defaults, 2);

        let replay = runtime
            .succeed_agent_run(
                &mut database,
                &adapter_envelope(
                    "fanout-complete-1",
                    &camp_id,
                    SucceedAgentRunCommand {
                        agent_run_id: executions[1].agent_run_id.clone(),
                        expected_version: executions[1].version,
                        execution_epoch: executions[1].execution_epoch,
                        native_turn_id: "native-turn-1".to_string(),
                        final_output: "Agent 1 的公开结论".to_string(),
                        ending_git_observation: Some(test_git_observation(
                            crate::git::GitCapabilityState::NotGit,
                            None,
                        )),
                    },
                ),
            )
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
