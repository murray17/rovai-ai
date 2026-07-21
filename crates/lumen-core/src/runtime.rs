use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunWorkspace {
    pub execution_root: String,
    pub access: String,
    pub isolation: String,
    pub repository_scope_id: Option<String>,
    pub base_git_commit: Option<String>,
}

impl AgentRunWorkspace {
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
        if self
            .base_git_commit
            .as_deref()
            .is_some_and(|oid| !is_full_git_oid(oid))
        {
            anyhow::bail!("baseGitCommit must be a full SHA-1 or SHA-256 OID");
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
pub struct BindNativeSessionCommand {
    pub conversation_id: String,
    pub agent_run_id: String,
    pub expected_conversation_version: i64,
    pub expected_execution_epoch: i64,
    pub previous_native_session_id: Option<String>,
    pub native_session_id: String,
}

impl sealed::Sealed for BindNativeSessionCommand {}
impl DomainCommand for BindNativeSessionCommand {
    const TYPE: &'static str = "conversation.native_session.bind";
}

#[derive(Debug, Default)]
pub struct ExecutionRuntimeService {
    gateway: DomainCommandGateway,
}

impl ExecutionRuntimeService {
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
            let valid_state = run.status == "queued"
                || (run.status == "waiting"
                    && run.wait_reason.as_deref() == Some("runtime_recovery"));
            if !valid_state || run.input_ready_at.is_none() || run.cancel_requested_at.is_some() {
                return Ok(rejected(
                    "agent_run.not_claimable",
                    "AgentRun is not ready for execution",
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
                    "AgentRun workspace does not match the Camp repository scope",
                ));
            }

            let now = chrono::Utc::now();
            let now_text = now.to_rfc3339();
            let lease_expires_at =
                (now + chrono::Duration::seconds(envelope.payload.lease_seconds)).to_rfc3339();
            let next_epoch = run.execution_epoch + 1;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET workspace_json = COALESCE(workspace_json, ?2),
                    status = 'running', wait_reason = NULL, wait_deadline_at = NULL,
                    execution_epoch = ?3, execution_lease_owner = ?4,
                    execution_lease_expires_at = ?5,
                    started_at = COALESCE(started_at, ?6),
                    version = version + 1, updated_at = ?6
                WHERE id = ?1 AND version = ?7
                  AND (status = 'queued'
                       OR (status = 'waiting' AND wait_reason = 'runtime_recovery'))
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
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "agent_run.claim_race_lost",
                    "AgentRun changed before its lease was acquired",
                ));
            }
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
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting', wait_reason = 'runtime_recovery',
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = 'runtime_connection_lost',
                    version = version + 1, updated_at = ?4
                WHERE id = ?1 AND status = 'running'
                  AND version = ?2 AND execution_epoch = ?3
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
                    "AgentRun is stale or is not actively running",
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

    pub fn bind_native_session(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<BindNativeSessionCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.native_session_id.trim().is_empty() {
            anyhow::bail!("nativeSessionId must not be empty");
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
            let row = transaction
                .query_row(
                    r#"
                    SELECT conversation.camp_id, conversation.native_session_id,
                           conversation.version, agent_run.execution_epoch,
                           agent_run.status
                    FROM conversation
                    JOIN agent_run ON agent_run.conversation_id = conversation.id
                    WHERE conversation.id = ?1 AND agent_run.id = ?2
                    "#,
                    params![
                        envelope.payload.conversation_id,
                        envelope.payload.agent_run_id,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, current_session, version, epoch, run_status)) = row else {
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
            if current_session != envelope.payload.previous_native_session_id {
                return Ok(rejected(
                    "runtime.session_changed",
                    "Native Session changed before binding",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE conversation
                SET native_session_id = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                  AND native_session_id IS ?5
                "#,
                params![
                    envelope.payload.conversation_id,
                    envelope.payload.native_session_id,
                    now,
                    envelope.payload.expected_conversation_version,
                    envelope.payload.previous_native_session_id,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "runtime.binding_race_lost",
                    "Conversation changed before Native Session binding",
                ));
            }
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
                    "previousNativeSessionId": envelope.payload.previous_native_session_id,
                    "nativeSessionId": envelope.payload.native_session_id,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "conversation.native_session_bound",
                json!({
                    "conversationId": envelope.payload.conversation_id,
                    "nativeSessionId": envelope.payload.native_session_id,
                }),
                Some(entity_ref(
                    "conversation",
                    &envelope.payload.conversation_id,
                )),
            ))
        })
    }
}

#[derive(Debug)]
struct ClaimableRun {
    id: String,
    camp_id: String,
    conversation_id: String,
    task_id: Option<String>,
    input_ready_at: Option<String>,
    effective_config: Value,
    workspace: Option<Value>,
    status: String,
    wait_reason: Option<String>,
    execution_epoch: i64,
    cancel_requested_at: Option<String>,
    version: i64,
    member_active: bool,
    current_default_capabilities: Value,
    current_capability_overrides: Value,
}

fn load_claimable_run(transaction: &Transaction<'_>, run_id: &str) -> Result<Option<ClaimableRun>> {
    transaction
        .query_row(
            r#"
            SELECT agent_run.id, camp_turn.camp_id, agent_run.conversation_id,
                   agent_run.task_id, agent_run.input_ready_at,
                   agent_run.effective_config_json, agent_run.workspace_json,
                   agent_run.status, agent_run.wait_reason,
                   agent_run.execution_epoch, agent_run.cancel_requested_at,
                   agent_run.version,
                   CASE WHEN camp.status = 'active'
                             AND camp_member.status = 'active'
                             AND camp_member.leave_requested_at IS NULL
                             AND agent_profile.profile_status = 'active'
                        THEN 1 ELSE 0 END,
                   agent_profile.default_capabilities_json,
                   camp_member.capability_overrides_json
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_profile_id = conversation.agent_profile_id
            WHERE agent_run.id = ?1
            "#,
            [run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                id,
                camp_id,
                conversation_id,
                task_id,
                input_ready_at,
                effective_config,
                workspace,
                status,
                wait_reason,
                execution_epoch,
                cancel_requested_at,
                version,
                member_active,
                current_default_capabilities,
                current_capability_overrides,
            )| {
                Ok(ClaimableRun {
                    id,
                    camp_id,
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
                    execution_epoch,
                    cancel_requested_at,
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

fn current_authorization_covers_snapshot(
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
              AND NOT EXISTS (
                  SELECT 1 FROM task_dependency
                  JOIN task AS dependency ON dependency.id = task_dependency.depends_on_task_id
                  WHERE task_dependency.task_id = task.id
                    AND dependency.status <> 'completed'
              )
        )
        "#,
        params![task_id, camp_id],
        |row| row.get(0),
    )?;
    Ok(executable != 0)
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
             WHERE agent_run_id = ?1 AND status IN ('pending', 'delivering'))
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
    let repository_scope_id = transaction.query_row(
        "SELECT repository_scope_id FROM camp WHERE id = ?1",
        [camp_id],
        |row| row.get::<_, Option<String>>(0),
    )?;
    let workspace_scope = workspace["repositoryScopeId"].as_str();
    Ok(match (repository_scope_id.as_deref(), workspace_scope) {
        (Some(expected), Some(actual)) => expected == actual,
        (Some(_), None) => false,
        (None, Some(_)) => false,
        (None, None) => true,
    })
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
        if self.adapter_kind != "codex"
            || self.protocol_version.trim().is_empty()
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
            agent_profile_id,
            source_agent_run_id,
        } => (
            "agent",
            agent_profile_id.as_str(),
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

fn is_full_git_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ExecutionRequest,
            MessageAddressSpec, SendCampMessageCommand,
        },
        command::CommandResultStatus,
    };

    fn host_key(scope: &str) -> RuntimeHostKey {
        RuntimeHostKey {
            adapter_kind: "codex".to_string(),
            protocol_version: "0.1".to_string(),
            auth_scope: scope.to_string(),
            process_config_digest: "digest-v1".to_string(),
        }
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

    #[test]
    fn scheduler_serializes_one_conversation_and_increments_recovery_epoch() {
        let directory = std::env::temp_dir().join(format!("lumen-runtime-test-{}", Uuid::new_v4()));
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
                    CreateCampCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        repository: None,
                    },
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
                        agent_profile_id: "agent-muwa".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        let mut run_ids = Vec::new();
        for index in 0..2 {
            let turn = collaboration
                .send_camp_message(
                    &mut database,
                    &user_envelope(
                        &format!("runtime-turn-{index}"),
                        Some(&camp_id),
                        SendCampMessageCommand {
                            camp_id: camp_id.clone(),
                            body: format!("执行职责 {index}"),
                            address: MessageAddressSpec::Default,
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: None,
                                purpose: format!("职责 {index}"),
                                expected_output: "公开结果".to_string(),
                                completion_role: "required".to_string(),
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
                            repository_scope_id: None,
                            base_git_commit: None,
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(claim.result.status, CommandResultStatus::Accepted);
        assert_eq!(claim.result.payload["executionEpoch"], 1);

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
                    },
                },
            )
            .unwrap();
        assert_eq!(reclaimed.result.status, CommandResultStatus::Accepted);
        assert_eq!(reclaimed.result.payload["executionEpoch"], 2);

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
}
