use std::{collections::BTreeSet, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionControlMode {
    Mediated,
    Intercepted,
    Observed,
}

impl ActionControlMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mediated => "mediated",
            Self::Intercepted => "intercepted",
            Self::Observed => "observed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CanonicalActionInput {
    ShellCommand {
        argv: Vec<String>,
        cwd: String,
        #[serde(default)]
        environment_refs: Vec<String>,
    },
    FileWrite {
        path: String,
        operation: String,
        content_digest: String,
    },
    FileDelete {
        path: String,
    },
    GitMutation {
        repository_scope_id: String,
        operation: String,
        reference_name: Option<String>,
        expected_oid: Option<String>,
    },
    NetworkWrite {
        scheme: String,
        host: String,
        port: u16,
        method: String,
        body_digest: Option<String>,
    },
    NetworkAccess {
        protocol: String,
        host: String,
        port: Option<u16>,
    },
    McpTool {
        server: String,
        tool: String,
        arguments: Value,
    },
    SensitiveRead {
        resource: String,
    },
    RuntimePermissionGrant {
        cwd: String,
        permissions: Value,
        request_digest: String,
    },
    RuntimeObservedUnknown {
        native_kind: String,
        observation_digest: String,
    },
}

impl CanonicalActionInput {
    fn action_kind(&self) -> &'static str {
        match self {
            Self::ShellCommand { .. } => "shell_command",
            Self::FileWrite { .. } => "file_write",
            Self::FileDelete { .. } => "file_delete",
            Self::GitMutation { .. } => "git_mutation",
            Self::NetworkWrite { .. } => "network_write",
            Self::NetworkAccess { .. } => "network_access",
            Self::McpTool { .. } => "mcp_tool",
            Self::SensitiveRead { .. } => "sensitive_read",
            Self::RuntimePermissionGrant { .. } => "runtime_permission_grant",
            Self::RuntimeObservedUnknown { .. } => "runtime_observed_unknown",
        }
    }

    fn summary(&self) -> String {
        match self {
            Self::ShellCommand { argv, cwd, .. } => {
                let command = match argv.as_slice() {
                    [shell, flag, command, ..]
                        if flag == "-lc"
                            && matches!(shell.as_str(), "/bin/zsh" | "/bin/bash" | "/bin/sh") =>
                    {
                        command.clone()
                    }
                    _ => argv.join(" "),
                };
                format!("Run {command} in {cwd}")
            }
            Self::FileWrite {
                path, operation, ..
            } => format!("{operation} {path}"),
            Self::FileDelete { path } => format!("Delete {path}"),
            Self::GitMutation {
                operation,
                reference_name,
                ..
            } => format!(
                "Git {operation} {}",
                reference_name.as_deref().unwrap_or("repository")
            ),
            Self::NetworkWrite {
                scheme,
                host,
                port,
                method,
                ..
            } => format!("{method} {scheme}://{host}:{port}"),
            Self::NetworkAccess {
                protocol,
                host,
                port,
            } => port.map_or_else(
                || format!("Connect to {host} over {protocol}"),
                |port| format!("Connect to {host}:{port} over {protocol}"),
            ),
            Self::McpTool { server, tool, .. } => format!("Call MCP {server}/{tool}"),
            Self::SensitiveRead { resource } => format!("Read restricted resource {resource}"),
            Self::RuntimePermissionGrant { cwd, .. } => {
                format!("Grant additional Runtime permissions in {cwd}")
            }
            Self::RuntimeObservedUnknown { native_kind, .. } => {
                format!("Observed runtime action {native_kind}")
            }
        }
    }

    fn validate(&self) -> Result<()> {
        match self {
            Self::ShellCommand { argv, cwd, .. } => {
                if argv.is_empty() || argv.iter().any(|part| part.is_empty()) {
                    anyhow::bail!("Shell action requires non-empty argv");
                }
                require_absolute_path(cwd, "shell cwd")?;
            }
            Self::FileWrite {
                path,
                operation,
                content_digest,
            } => {
                require_absolute_path(path, "file path")?;
                if !matches!(operation.as_str(), "create" | "replace" | "patch")
                    || content_digest.trim().is_empty()
                {
                    anyhow::bail!("File write operation or content digest is invalid");
                }
            }
            Self::FileDelete { path } => require_absolute_path(path, "file path")?,
            Self::GitMutation {
                repository_scope_id,
                operation,
                expected_oid,
                ..
            } => {
                if repository_scope_id.trim().is_empty()
                    || !matches!(
                        operation.as_str(),
                        "commit" | "update_ref" | "merge" | "rebase" | "push" | "worktree"
                    )
                {
                    anyhow::bail!("Git action is invalid");
                }
                if expected_oid
                    .as_deref()
                    .is_some_and(|oid| !is_full_git_oid(oid))
                {
                    anyhow::bail!("Git expected OID must be a full SHA-1 or SHA-256 OID");
                }
            }
            Self::NetworkWrite {
                scheme,
                host,
                method,
                ..
            } => {
                if !matches!(scheme.as_str(), "http" | "https")
                    || host.trim().is_empty()
                    || method.trim().is_empty()
                {
                    anyhow::bail!("Network action target is invalid");
                }
            }
            Self::NetworkAccess {
                protocol,
                host,
                port,
            } => {
                if !matches!(
                    protocol.as_str(),
                    "http" | "https" | "socks5Tcp" | "socks5Udp"
                ) || host.trim().is_empty()
                    || port.is_some_and(|port| port == 0)
                {
                    anyhow::bail!("Network access target is invalid");
                }
            }
            Self::McpTool {
                server,
                tool,
                arguments,
            } => {
                if server.trim().is_empty() || tool.trim().is_empty() || !arguments.is_object() {
                    anyhow::bail!("MCP action requires server, tool and object arguments");
                }
            }
            Self::SensitiveRead { resource } => {
                if resource.trim().is_empty() {
                    anyhow::bail!("Sensitive read resource must not be empty");
                }
            }
            Self::RuntimePermissionGrant {
                cwd,
                permissions,
                request_digest,
            } => {
                require_absolute_path(cwd, "permission cwd")?;
                if !permissions.is_object() || request_digest.trim().is_empty() {
                    anyhow::bail!(
                        "Runtime permission grant requires object permissions and a request digest"
                    );
                }
            }
            Self::RuntimeObservedUnknown {
                native_kind,
                observation_digest,
            } => {
                if native_kind.trim().is_empty() || observation_digest.trim().is_empty() {
                    anyhow::bail!("Observed action requires stable kind and digest");
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionRequestBinding {
    pub native_method: String,
    pub native_request_id: Value,
    pub native_item_id: String,
    pub native_thread_id: String,
    pub native_turn_id: String,
    #[serde(default)]
    pub response_context: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareActionCommand {
    pub action_id: String,
    pub input: CanonicalActionInput,
    pub control_mode: ActionControlMode,
    pub native_action_id: Option<String>,
    pub runtime_request: Option<RuntimeActionRequestBinding>,
    pub execute_before: Option<String>,
    pub requested_for_user_id: String,
}

impl sealed::Sealed for PrepareActionCommand {}
impl DomainCommand for PrepareActionCommand {
    const TYPE: &'static str = "action.prepare";
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveActionApprovalCommand {
    pub approval_id: String,
    pub decision: ApprovalDecision,
    pub expected_version: i64,
    pub reason: Option<String>,
}

impl sealed::Sealed for ResolveActionApprovalCommand {}
impl DomainCommand for ResolveActionApprovalCommand {
    const TYPE: &'static str = "action.approval.resolve";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimActionCommand {
    pub action_id: String,
    pub expected_version: i64,
    pub lease_owner: String,
    pub lease_seconds: i64,
    pub authorization_delivery_id: Option<String>,
    pub authorization_delivery_lease_owner: Option<String>,
}

impl sealed::Sealed for ClaimActionCommand {}
impl DomainCommand for ClaimActionCommand {
    const TYPE: &'static str = "action.claim";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkActionDispatchStartedCommand {
    pub action_id: String,
    pub attempt_id: String,
    pub action_execution_epoch: i64,
    pub lease_owner: String,
}

impl sealed::Sealed for MarkActionDispatchStartedCommand {}
impl DomainCommand for MarkActionDispatchStartedCommand {
    const TYPE: &'static str = "action.dispatch_started";
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResultOutcome {
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordActionResultCommand {
    pub action_id: String,
    pub attempt_id: String,
    pub action_execution_epoch: i64,
    pub outcome: ActionResultOutcome,
    pub result_code: String,
    pub result_summary: String,
    pub result_data: Value,
    pub effect_disposition: String,
}

impl sealed::Sealed for RecordActionResultCommand {}
impl DomainCommand for RecordActionResultCommand {
    const TYPE: &'static str = "action.result.record";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordObservedActionCommand {
    pub action_id: String,
    pub native_action_id: String,
    pub native_kind: String,
    pub observation_digest: String,
    pub outcome: ActionResultOutcome,
    pub result_code: String,
    pub result_summary: String,
    pub result_data: Value,
    pub effect_disposition: String,
}

impl sealed::Sealed for RecordObservedActionCommand {}
impl DomainCommand for RecordObservedActionCommand {
    const TYPE: &'static str = "action.observed.record";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireRuntimeDeliveryCommand {
    pub delivery_id: String,
    pub expected_version: i64,
    pub lease_owner: String,
    pub lease_seconds: i64,
}

impl sealed::Sealed for AcquireRuntimeDeliveryCommand {}
impl DomainCommand for AcquireRuntimeDeliveryCommand {
    const TYPE: &'static str = "runtime_delivery.acquire";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeRuntimeDeliveryCommand {
    pub delivery_id: String,
    pub payload_digest: String,
    pub target_execution_epoch: i64,
    pub lease_owner: String,
}

impl sealed::Sealed for AcknowledgeRuntimeDeliveryCommand {}
impl DomainCommand for AcknowledgeRuntimeDeliveryCommand {
    const TYPE: &'static str = "runtime_delivery.acknowledge";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailRuntimeDeliveryCommand {
    pub delivery_id: String,
    pub payload_digest: String,
    pub target_execution_epoch: i64,
    pub lease_owner: String,
    pub error: String,
}

impl sealed::Sealed for FailRuntimeDeliveryCommand {}
impl DomainCommand for FailRuntimeDeliveryCommand {
    const TYPE: &'static str = "runtime_delivery.fail";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmRuntimeRequestResolvedCommand {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub native_thread_id: String,
    pub native_request_id: Value,
}

impl sealed::Sealed for ConfirmRuntimeRequestResolvedCommand {}
impl DomainCommand for ConfirmRuntimeRequestResolvedCommand {
    const TYPE: &'static str = "runtime_request.confirm_resolved";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileRuntimeLossCommand {
    pub agent_run_id: String,
    pub expected_version: i64,
    pub execution_epoch: i64,
    pub reason: String,
}

impl sealed::Sealed for ReconcileRuntimeLossCommand {}
impl DomainCommand for ReconcileRuntimeLossCommand {
    const TYPE: &'static str = "runtime_loss.reconcile";
}

#[derive(Debug, Clone)]
pub struct RuntimeDeliveryCandidate {
    pub delivery_id: String,
    pub camp_id: String,
    pub agent_run_id: String,
    pub action_id: String,
    pub action_version: i64,
    pub action_status: String,
    pub action_kind: String,
    pub delivery_kind: String,
    pub delivery_version: i64,
    pub target_execution_epoch: i64,
    pub native_method: String,
    pub native_request_id: Value,
    pub response_context: Value,
}

#[derive(Debug, Clone)]
pub struct InterceptedActionAttempt {
    pub action_id: String,
    pub camp_id: String,
    pub attempt_id: String,
    pub action_execution_epoch: i64,
    pub action_kind: String,
}

#[derive(Debug, Default)]
pub struct ActionSafetyService {
    gateway: DomainCommandGateway,
}

#[derive(Debug)]
struct AgentActionContext {
    effective_config: Value,
    workspace: Option<Value>,
}

#[derive(Debug)]
struct PolicyEvaluation {
    decision: &'static str,
    version: String,
    matched_rule_ids: Vec<String>,
}

impl ActionSafetyService {
    pub fn prepare_action(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<PrepareActionCommand>,
    ) -> Result<CommandExecution> {
        envelope.payload.input.validate()?;
        validate_prepare_action(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            let camp_id = match envelope.camp_id.as_deref() {
                Some(camp_id) => camp_id,
                None => return Ok(rejected("action.camp_required", "Action requires a Camp")),
            };
            let context = match agent_action_context(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                camp_id,
            )? {
                Some(context) => context,
                None => {
                    return Ok(rejected(
                        "action.stale_agent_run",
                        "Action source AgentRun is unavailable or fenced",
                    ));
                }
            };
            if !has_capability(&context.effective_config, "action.request") {
                return Ok(rejected(
                    "action.capability_denied",
                    "AgentRun lacks action.request",
                ));
            }
            if let Err(message) =
                validate_workspace_scope(&envelope.payload.input, context.workspace.as_ref())
            {
                return Ok(rejected("action.workspace_scope_denied", &message));
            }

            let canonical_input = serde_json::to_value(&envelope.payload.input)?;
            let action_digest = canonical_json_digest(&canonical_input)?;
            if let Some((existing_kind, existing_digest, status)) = transaction
                .query_row(
                    "SELECT action_kind, action_digest, status FROM action_execution WHERE id = ?1",
                    [&envelope.payload.action_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?
            {
                if existing_kind == envelope.payload.input.action_kind()
                    && existing_digest == action_digest
                {
                    return Ok(CommandHandlerResult::applied(
                        "action.already_prepared",
                        json!({
                            "actionId": envelope.payload.action_id,
                            "status": status,
                        }),
                        Some(entity_ref("action_execution", &envelope.payload.action_id)),
                    ));
                }
                return Ok(rejected(
                    "action.action_id_conflict",
                    "Action ID is already bound to different canonical input",
                ));
            }

            let policy = if envelope.payload.control_mode == ActionControlMode::Observed {
                PolicyEvaluation {
                    decision: "observed",
                    version: "observed-v1".to_string(),
                    matched_rule_ids: Vec::new(),
                }
            } else {
                evaluate_policy(
                    &context.effective_config,
                    envelope.payload.input.action_kind(),
                )?
            };
            let now = chrono::Utc::now().to_rfc3339();
            let (status, not_executed_reason, unknown_disposition, effect_disposition, ended_at) =
                match policy.decision {
                    "deny" => (
                        "not_executed",
                        Some("policy_denied"),
                        None,
                        Some("none"),
                        Some(now.as_str()),
                    ),
                    "observed" => ("unknown", None, Some("active"), None, None),
                    _ => ("prepared", None, None, None, None),
                };
            let source_agent_run_id = match &envelope.actor {
                ActorRef::Agent {
                    source_agent_run_id,
                    ..
                } => source_agent_run_id,
                _ => unreachable!("agent_action_context rejects non-agent Actors"),
            };
            let input_completeness = if matches!(
                envelope.payload.input,
                CanonicalActionInput::RuntimeObservedUnknown { .. }
            ) {
                "partial"
            } else {
                "complete"
            };
            let execution_authority = match envelope.payload.control_mode {
                ActionControlMode::Mediated => "core",
                ActionControlMode::Intercepted => "runtime",
                ActionControlMode::Observed => "external",
            };
            let runtime_request = envelope.payload.runtime_request.as_ref();
            let native_request_id_json = runtime_request
                .map(|binding| serde_json::to_string(&binding.native_request_id))
                .transpose()?;
            let native_response_context_json = runtime_request
                .map(|binding| serde_json::to_string(&binding.response_context))
                .transpose()?;
            transaction.execute(
                r#"
                INSERT INTO action_execution(
                    id, agent_run_id, action_kind, action_schema_version,
                    action_digest, digest_algorithm, canonicalization_version,
                    canonical_input_json, input_completeness, action_summary,
                    execution_authority, control_mode, native_action_id,
                    source_agent_run_execution_epoch,
                    native_request_method, native_request_id_json, native_item_id,
                    native_thread_id, native_turn_id, native_response_context_json,
                    first_observed_at, execute_before, policy_decision,
                    policy_version, matched_policy_rule_ids_json,
                    status, not_executed_reason, unknown_disposition,
                    effect_disposition, version, created_at, ended_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, '1', ?4, 'sha256', 'canonical-json-v1',
                    ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    ?12, ?13, ?14, ?15, ?16, ?17,
                    ?18, ?19, ?20, ?21, ?22,
                    ?23, ?24, ?25, ?26, 1, ?27, ?28, ?27
                )
                "#,
                params![
                    envelope.payload.action_id,
                    source_agent_run_id,
                    envelope.payload.input.action_kind(),
                    action_digest,
                    serde_json::to_string(&canonical_input)?,
                    input_completeness,
                    envelope.payload.input.summary(),
                    execution_authority,
                    envelope.payload.control_mode.as_str(),
                    envelope.payload.native_action_id,
                    envelope
                        .execution_epoch
                        .expect("Agent action requires epoch"),
                    runtime_request.map(|binding| binding.native_method.as_str()),
                    native_request_id_json,
                    runtime_request.map(|binding| binding.native_item_id.as_str()),
                    runtime_request.map(|binding| binding.native_thread_id.as_str()),
                    runtime_request.map(|binding| binding.native_turn_id.as_str()),
                    native_response_context_json,
                    (envelope.payload.control_mode == ActionControlMode::Observed)
                        .then_some(now.as_str()),
                    envelope.payload.execute_before,
                    policy.decision,
                    policy.version,
                    serde_json::to_string(&policy.matched_rule_ids)?,
                    status,
                    not_executed_reason,
                    unknown_disposition,
                    effect_disposition,
                    now,
                    ended_at,
                ],
            )?;

            let mut approval_id = None;
            if policy.decision == "ask" {
                let id = Uuid::new_v4().to_string();
                transaction.execute(
                    r#"
                    INSERT INTO approval(
                        id, task_id, turn_id, native_request_id, approval_type,
                        reason, request_json, decision_json,
                        action_id, action_kind, action_digest, digest_algorithm,
                        canonicalization_version, action_summary,
                        requested_for_user_id, request_policy_version,
                        matched_policy_rule_id, status, decision_expires_at,
                        resolved_by_type, resolved_by_id, resolution_code,
                        resolution_reason, version, requested_at, updated_at, resolved_at
                    ) VALUES (
                        ?1, NULL, NULL, ?2, 'action', ?3, ?4, NULL,
                        ?5, ?6, ?7, 'sha256', 'canonical-json-v1', ?8,
                        ?9, ?10, ?11, 'pending', ?12,
                        NULL, NULL, NULL, NULL, 1, ?13, ?13, NULL
                    )
                    "#,
                    params![
                        id,
                        envelope.payload.native_action_id,
                        envelope.payload.input.summary(),
                        serde_json::to_string(&canonical_input)?,
                        envelope.payload.action_id,
                        envelope.payload.input.action_kind(),
                        action_digest,
                        envelope.payload.input.summary(),
                        envelope.payload.requested_for_user_id,
                        policy.version,
                        policy.matched_rule_ids.first(),
                        envelope.payload.execute_before,
                        now,
                    ],
                )?;
                approval_id = Some(id);
            }

            let wait_reason = match policy.decision {
                "ask" => Some("approval"),
                "deny" => Some("runtime_delivery"),
                "observed" => Some("unknown_action_outcome"),
                "allow" if envelope.payload.control_mode == ActionControlMode::Mediated => {
                    Some("action_execution")
                }
                "allow" if envelope.payload.control_mode == ActionControlMode::Intercepted => {
                    Some("runtime_delivery")
                }
                _ => None,
            };
            if let Some(wait_reason) = wait_reason {
                mark_agent_run_waiting(transaction, source_agent_run_id, wait_reason, &now)?;
            }
            if policy.decision == "deny" {
                let (delivery_kind, payload) =
                    if envelope.payload.control_mode == ActionControlMode::Intercepted {
                        (
                            "authorization_resolution",
                            json!({
                                "actionId": envelope.payload.action_id,
                                "actionKind": envelope.payload.input.action_kind(),
                                "actionDigest": action_digest,
                                "decision": "denied_by_policy",
                            }),
                        )
                    } else {
                        (
                            "action_result",
                            json!({
                                "actionId": envelope.payload.action_id,
                                "status": "not_executed",
                                "reason": "policy_denied",
                            }),
                        )
                    };
                create_runtime_delivery(
                    transaction,
                    source_agent_run_id,
                    &envelope.payload.action_id,
                    delivery_kind,
                    envelope
                        .execution_epoch
                        .expect("Agent command requires epoch"),
                    &payload,
                )?;
            } else if policy.decision == "allow"
                && envelope.payload.control_mode == ActionControlMode::Intercepted
            {
                create_runtime_delivery(
                    transaction,
                    source_agent_run_id,
                    &envelope.payload.action_id,
                    "authorization_resolution",
                    envelope
                        .execution_epoch
                        .expect("Agent command requires epoch"),
                    &json!({
                        "actionId": envelope.payload.action_id,
                        "actionKind": envelope.payload.input.action_kind(),
                        "actionDigest": action_digest,
                        "decision": "approved_by_policy",
                    }),
                )?;
            }
            append_domain_event(
                transaction,
                "action.prepared",
                Some(camp_id),
                Some(("action_execution", &envelope.payload.action_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "agentRunId": source_agent_run_id,
                    "actionKind": envelope.payload.input.action_kind(),
                    "actionDigest": action_digest,
                    "controlMode": envelope.payload.control_mode,
                    "policyDecision": policy.decision,
                    "status": status,
                    "approvalId": approval_id,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "action.prepared",
                json!({
                    "actionId": envelope.payload.action_id,
                    "actionDigest": action_digest,
                    "status": status,
                    "policyDecision": policy.decision,
                    "approvalId": approval_id,
                }),
                Some(entity_ref("action_execution", &envelope.payload.action_id)),
            ))
        })
    }

    /// Records a side effect that a permissive native Runtime performed before
    /// Lumen received a protocol-level authorization request. This is an
    /// explicit degradation from intercepted execution: it never fabricates an
    /// Approval, Policy decision, dispatch Attempt, or exactly-once guarantee.
    pub fn record_observed_action(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RecordObservedActionCommand>,
    ) -> Result<CommandExecution> {
        let canonical_input = CanonicalActionInput::RuntimeObservedUnknown {
            native_kind: envelope.payload.native_kind.clone(),
            observation_digest: envelope.payload.observation_digest.clone(),
        };
        canonical_input.validate()?;
        validate_action_result_fields(
            envelope.payload.outcome,
            &envelope.payload.result_code,
            &envelope.payload.result_summary,
            &envelope.payload.effect_disposition,
        )?;
        self.gateway.execute(database, envelope, |transaction| {
            let camp_id = match envelope.camp_id.as_deref() {
                Some(camp_id) => camp_id,
                None => {
                    return Ok(rejected(
                        "action.camp_required",
                        "Observed Action requires a Camp",
                    ));
                }
            };
            let context = match agent_action_context(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                camp_id,
            )? {
                Some(context) => context,
                None => {
                    return Ok(rejected(
                        "action.stale_agent_run",
                        "Observed Action source AgentRun is unavailable or fenced",
                    ));
                }
            };
            if !has_capability(&context.effective_config, "action.request") {
                return Ok(rejected(
                    "action.capability_denied",
                    "AgentRun lacks action.request",
                ));
            }
            let source_agent_run_id = match &envelope.actor {
                ActorRef::Agent {
                    source_agent_run_id,
                    ..
                } => source_agent_run_id,
                _ => unreachable!("agent_action_context rejects non-agent Actors"),
            };
            let canonical_input_json = serde_json::to_value(&canonical_input)?;
            let action_digest = canonical_json_digest(&canonical_input_json)?;
            if let Some((existing_digest, status)) = transaction
                .query_row(
                    "SELECT action_digest, status FROM action_execution WHERE id = ?1",
                    [&envelope.payload.action_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
            {
                if existing_digest == action_digest {
                    return Ok(CommandHandlerResult::applied(
                        "action.observation_already_recorded",
                        json!({
                            "actionId": envelope.payload.action_id,
                            "status": status,
                            "guarantee": "observed",
                        }),
                        Some(entity_ref("action_execution", &envelope.payload.action_id)),
                    ));
                }
                return Ok(rejected(
                    "action.action_id_conflict",
                    "Observed Action ID is already bound to a different observation",
                ));
            }
            let (status, unknown_disposition, ended_at) = match envelope.payload.outcome {
                ActionResultOutcome::Succeeded => {
                    ("succeeded", None, Some(chrono::Utc::now().to_rfc3339()))
                }
                ActionResultOutcome::Failed => {
                    ("failed", None, Some(chrono::Utc::now().to_rfc3339()))
                }
                ActionResultOutcome::Unknown => ("unknown", Some("active"), None),
            };
            let result_digest = canonical_json_digest(&json!({
                "outcome": envelope.payload.outcome,
                "resultCode": envelope.payload.result_code,
                "resultSummary": envelope.payload.result_summary,
                "resultData": envelope.payload.result_data,
                "effectDisposition": envelope.payload.effect_disposition,
            }))?;
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO action_execution(
                    id, agent_run_id, action_kind, action_schema_version,
                    action_digest, digest_algorithm, canonicalization_version,
                    canonical_input_json, input_completeness, action_summary,
                    execution_authority, control_mode, native_action_id,
                    source_agent_run_execution_epoch, native_item_id,
                    first_observed_at, policy_decision, policy_version,
                    matched_policy_rule_ids_json, status, unknown_disposition,
                    attempt_count, action_execution_epoch,
                    result_code, result_schema_version, result_summary,
                    result_data_json, result_digest, effect_disposition,
                    resolution_source, resolution_evidence_refs_json,
                    version, created_at, started_at, ended_at, updated_at
                ) VALUES (
                    ?1, ?2, 'runtime_observed_unknown', '1',
                    ?3, 'sha256', 'canonical-json-v1',
                    ?4, 'partial', ?5,
                    'external', 'observed', ?6,
                    ?7, ?6,
                    ?8, 'observed', 'observed-v1',
                    '[]', ?9, ?10,
                    0, 0,
                    ?11, '1', ?12,
                    ?13, ?14, ?15,
                    'runtime', '[]',
                    1, ?8, ?8, ?16, ?8
                )
                "#,
                params![
                    envelope.payload.action_id,
                    source_agent_run_id,
                    action_digest,
                    serde_json::to_string(&canonical_input_json)?,
                    canonical_input.summary(),
                    envelope.payload.native_action_id,
                    envelope
                        .execution_epoch
                        .expect("Observed Agent action requires epoch"),
                    now,
                    status,
                    unknown_disposition,
                    envelope.payload.result_code,
                    envelope.payload.result_summary,
                    serde_json::to_string(&envelope.payload.result_data)?,
                    result_digest,
                    envelope.payload.effect_disposition,
                    ended_at,
                ],
            )?;
            if status == "unknown" {
                mark_agent_run_waiting(
                    transaction,
                    source_agent_run_id,
                    "unknown_action_outcome",
                    &now,
                )?;
            }
            append_domain_event(
                transaction,
                "action.observed",
                Some(camp_id),
                Some(("action_execution", &envelope.payload.action_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "agentRunId": source_agent_run_id,
                    "nativeActionId": envelope.payload.native_action_id,
                    "nativeKind": envelope.payload.native_kind,
                    "status": status,
                    "resultDigest": result_digest,
                    "guarantee": "observed",
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "action.observed",
                json!({
                    "actionId": envelope.payload.action_id,
                    "status": status,
                    "resultDigest": result_digest,
                    "guarantee": "observed",
                }),
                Some(entity_ref("action_execution", &envelope.payload.action_id)),
            ))
        })
    }

    pub fn resolve_approval(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ResolveActionApprovalCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { user_id } = &envelope.actor else {
                return Ok(rejected(
                    "approval.user_required",
                    "Only the target user can resolve an Action Approval",
                ));
            };
            let row = transaction
                .query_row(
                    r#"
                    SELECT approval.action_id, approval.action_kind,
                           approval.action_digest, approval.requested_for_user_id,
                           approval.status, approval.decision_expires_at,
                           approval.version, action_execution.agent_run_id,
                           action_execution.status, action_execution.control_mode,
                           action_execution.version, camp_turn.camp_id,
                           action_execution.source_agent_run_execution_epoch,
                           agent_run.execution_epoch
                    FROM approval
                    JOIN action_execution ON action_execution.id = approval.action_id
                    JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE approval.id = ?1
                    "#,
                    [&envelope.payload.approval_id],
                    |row| {
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
                            row.get::<_, i64>(10)?,
                            row.get::<_, String>(11)?,
                            row.get::<_, i64>(12)?,
                            row.get::<_, i64>(13)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                action_id,
                action_kind,
                action_digest,
                requested_for_user,
                approval_status,
                decision_expires_at,
                approval_version,
                agent_run_id,
                action_status,
                control_mode,
                action_version,
                camp_id,
                action_source_epoch,
                run_epoch,
            )) = row
            else {
                return Ok(rejected("approval.not_found", "Action Approval does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected("approval.camp_mismatch", "Approval is outside the Camp"));
            }
            if requested_for_user != *user_id {
                return Ok(rejected(
                    "approval.wrong_user",
                    "Approval is assigned to a different user",
                ));
            }
            if approval_status != "pending" {
                return Ok(rejected(
                    "approval.not_pending",
                    "Approval is no longer pending",
                ));
            }
            if approval_version != envelope.payload.expected_version {
                return Ok(rejected(
                    "approval.version_conflict",
                    "Approval version is stale",
                ));
            }
            if action_status != "prepared" {
                return Ok(rejected(
                    "approval.action_not_prepared",
                    "Action is no longer prepared",
                ));
            }
            if action_source_epoch != run_epoch {
                return Ok(rejected(
                    "approval.runtime_request_fenced",
                    "Approval belongs to an earlier AgentRun execution epoch",
                ));
            }
            let now = chrono::Utc::now();
            if let Some(expires_at) = decision_expires_at
                && chrono::DateTime::parse_from_rfc3339(&expires_at)
                    .map(|expiry| expiry < now)
                    .unwrap_or(true)
            {
                let now_text = now.to_rfc3339();
                transaction.execute(
                    r#"
                    UPDATE approval
                    SET status = 'expired', resolution_code = 'expired',
                        resolved_by_type = 'system', resolved_by_id = 'approval-expirer',
                        version = version + 1, resolved_at = ?2, updated_at = ?2
                    WHERE id = ?1
                    "#,
                    params![envelope.payload.approval_id, now_text],
                )?;
                set_action_not_executed(
                    transaction,
                    &action_id,
                    action_version,
                    "approval_expired",
                    &now_text,
                )?;
                create_runtime_delivery(
                    transaction,
                    &agent_run_id,
                    &action_id,
                    "authorization_resolution",
                    run_epoch,
                    &json!({ "actionId": action_id, "decision": "expired" }),
                )?;
                return Ok(CommandHandlerResult::applied(
                    "approval.expired",
                    json!({ "approvalId": envelope.payload.approval_id, "actionId": action_id }),
                    Some(entity_ref("approval", &envelope.payload.approval_id)),
                ));
            }

            let now_text = now.to_rfc3339();
            let (approval_status, resolution_code) = match envelope.payload.decision {
                ApprovalDecision::Approve => ("approved", "user_approved"),
                ApprovalDecision::Deny => ("denied", "user_denied"),
            };
            transaction.execute(
                r#"
                UPDATE approval
                SET status = ?2, decision_json = ?3,
                    resolved_by_type = 'user', resolved_by_id = ?4,
                    resolution_code = ?5, resolution_reason = ?6,
                    version = version + 1, resolved_at = ?7, updated_at = ?7
                WHERE id = ?1 AND status = 'pending' AND version = ?8
                "#,
                params![
                    envelope.payload.approval_id,
                    approval_status,
                    serde_json::to_string(&json!({ "decision": approval_status }))?,
                    user_id,
                    resolution_code,
                    envelope.payload.reason,
                    now_text,
                    envelope.payload.expected_version,
                ],
            )?;
            if matches!(envelope.payload.decision, ApprovalDecision::Deny) {
                set_action_not_executed(
                    transaction,
                    &action_id,
                    action_version,
                    "approval_denied",
                    &now_text,
                )?;
            }
            if control_mode == "intercepted"
                || matches!(envelope.payload.decision, ApprovalDecision::Deny)
            {
                create_runtime_delivery(
                    transaction,
                    &agent_run_id,
                    &action_id,
                    "authorization_resolution",
                    run_epoch,
                    &json!({
                        "actionId": action_id,
                        "actionKind": action_kind,
                        "actionDigest": action_digest,
                        "decision": approval_status,
                    }),
                )?;
                mark_agent_run_waiting(transaction, &agent_run_id, "runtime_delivery", &now_text)?;
            } else {
                mark_agent_run_waiting(transaction, &agent_run_id, "action_execution", &now_text)?;
            }
            append_domain_event(
                transaction,
                "approval.resolved",
                Some(&camp_id),
                Some(("approval", &envelope.payload.approval_id)),
                &envelope.actor,
                None,
                &json!({
                    "actionId": action_id,
                    "decision": approval_status,
                    "actionStatus": if approval_status == "approved" { "prepared" } else { "not_executed" },
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "approval.resolved",
                json!({
                    "approvalId": envelope.payload.approval_id,
                    "actionId": action_id,
                    "decision": approval_status,
                }),
                Some(entity_ref("approval", &envelope.payload.approval_id)),
            ))
        })
    }

    pub fn claim_action(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClaimActionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id }
                    if component_id == "action-executor" || component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "action.executor_required",
                    "Only an Action Executor or Runtime Adapter can claim an Action",
                ));
            }
            if envelope.payload.lease_owner.trim().is_empty() || envelope.payload.lease_seconds <= 0 {
                return Ok(rejected("action.invalid_lease", "Action lease is invalid"));
            }
            let row = transaction
                .query_row(
                    r#"
                    SELECT action_execution.status, action_execution.policy_decision,
                           action_execution.control_mode, action_execution.execute_before,
                           action_execution.version, action_execution.attempt_count,
                           action_execution.agent_run_id, camp_turn.camp_id,
                           agent_run.status, agent_run.execution_epoch
                    FROM action_execution
                    JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE action_execution.id = ?1
                    "#,
                    [&envelope.payload.action_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, i64>(9)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                status,
                policy_decision,
                control_mode,
                execute_before,
                version,
                attempt_count,
                agent_run_id,
                camp_id,
                run_status,
                run_epoch,
            )) = row
            else {
                return Ok(rejected("action.not_found", "Action does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected("action.camp_mismatch", "Action is outside the Camp"));
            }
            if status != "prepared" || version != envelope.payload.expected_version {
                return Ok(rejected(
                    "action.not_claimable",
                    "Action is not prepared at the expected version",
                ));
            }
            if !matches!(run_status.as_str(), "running" | "waiting") {
                return Ok(rejected(
                    "action.agent_run_terminal",
                    "Action source AgentRun is no longer active",
                ));
            }
            if let Some(execute_before) = execute_before
                && chrono::DateTime::parse_from_rfc3339(&execute_before)
                    .map(|expiry| expiry < chrono::Utc::now())
                    .unwrap_or(true)
            {
                return Ok(rejected("action.expired", "Action execution deadline has passed"));
            }
            if policy_decision == "ask" {
                let approved: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM approval WHERE action_id = ?1 AND status = 'approved'",
                    [&envelope.payload.action_id],
                    |row| row.get(0),
                )?;
                if approved != 1 {
                    return Ok(rejected(
                        "action.approval_required",
                        "Action has not been approved",
                    ));
                }
            } else if policy_decision != "allow" {
                return Ok(rejected(
                    "action.policy_denied",
                    "Action policy does not permit execution",
                ));
            }
            let valid_component = match (&envelope.actor, control_mode.as_str()) {
                (ActorRef::System { component_id }, "mediated") => component_id == "action-executor",
                (ActorRef::System { component_id }, "intercepted") => {
                    component_id.starts_with("runtime-adapter:")
                }
                _ => false,
            };
            if !valid_component {
                return Ok(rejected(
                    "action.control_mode_mismatch",
                    "Claiming component does not own this control mode",
                ));
            }
            if control_mode == "intercepted" {
                let Some(delivery_id) = envelope.payload.authorization_delivery_id.as_deref()
                else {
                    return Ok(rejected(
                        "action.authorization_delivery_required",
                        "Intercepted Action requires the exact leased authorization delivery",
                    ));
                };
                let Some(delivery_lease_owner) = envelope
                    .payload
                    .authorization_delivery_lease_owner
                    .as_deref()
                else {
                    return Ok(rejected(
                        "action.authorization_delivery_required",
                        "Intercepted Action requires the authorization delivery lease owner",
                    ));
                };
                let leased: i64 = transaction.query_row(
                    r#"
                    SELECT COUNT(*) FROM runtime_delivery_checkpoint
                    WHERE action_id = ?1 AND id = ?2
                      AND delivery_kind = 'authorization_resolution'
                      AND status = 'delivering'
                      AND target_execution_epoch = ?3
                      AND lease_owner = ?4
                    "#,
                    params![
                        envelope.payload.action_id,
                        delivery_id,
                        run_epoch,
                        delivery_lease_owner,
                    ],
                    |row| row.get(0),
                )?;
                if leased != 1 {
                    return Ok(rejected(
                        "action.authorization_delivery_not_owned",
                        "Runtime Adapter does not own the exact authorization delivery lease",
                    ));
                }
            } else if envelope.payload.authorization_delivery_id.is_some()
                || envelope
                    .payload
                    .authorization_delivery_lease_owner
                    .is_some()
            {
                return Ok(rejected(
                    "action.authorization_delivery_unexpected",
                    "Mediated Action cannot claim a Runtime authorization delivery",
                ));
            }

            let now = chrono::Utc::now();
            let now_text = now.to_rfc3339();
            let lease_expires_at = (now + chrono::Duration::seconds(envelope.payload.lease_seconds))
                .to_rfc3339();
            let attempt_id = Uuid::new_v4().to_string();
            let attempt_number = attempt_count + 1;
            let action_epoch = version + 1;
            transaction.execute(
                r#"
                INSERT INTO action_attempt(
                    id, action_id, attempt_number, action_execution_epoch,
                    lease_owner, dispatch_may_have_started_at,
                    external_operation_id, outcome, started_at, ended_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, ?6, NULL)
                "#,
                params![
                    attempt_id,
                    envelope.payload.action_id,
                    attempt_number,
                    action_epoch,
                    envelope.payload.lease_owner,
                    now_text,
                ],
            )?;
            let updated = transaction.execute(
                r#"
                UPDATE action_execution
                SET status = 'executing', attempt_count = ?2,
                    active_attempt_id = ?3, active_attempt_number = ?2,
                    action_execution_epoch = ?4,
                    agent_run_execution_epoch_at_dispatch = ?5,
                    execution_lease_owner = ?6,
                    execution_lease_expires_at = ?7,
                    started_at = COALESCE(started_at, ?8),
                    version = version + 1, updated_at = ?8
                WHERE id = ?1 AND status = 'prepared' AND version = ?9
                "#,
                params![
                    envelope.payload.action_id,
                    attempt_number,
                    attempt_id,
                    action_epoch,
                    run_epoch,
                    envelope.payload.lease_owner,
                    lease_expires_at,
                    now_text,
                    envelope.payload.expected_version,
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("Action claim lost optimistic concurrency after attempt creation");
            }
            append_domain_event(
                transaction,
                "action.claimed",
                Some(&camp_id),
                Some(("action_execution", &envelope.payload.action_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentRunId": agent_run_id,
                    "attemptId": attempt_id,
                    "attemptNumber": attempt_number,
                    "actionExecutionEpoch": action_epoch,
                    "agentRunExecutionEpoch": run_epoch,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "action.claimed",
                json!({
                    "actionId": envelope.payload.action_id,
                    "attemptId": attempt_id,
                    "attemptNumber": attempt_number,
                    "actionExecutionEpoch": action_epoch,
                    "leaseExpiresAt": lease_expires_at,
                }),
                Some(entity_ref("action_execution", &envelope.payload.action_id)),
            ))
        })
    }

    pub fn mark_dispatch_started(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkActionDispatchStartedCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(&envelope.actor, ActorRef::System { .. }) {
                return Ok(rejected(
                    "action.system_required",
                    "Dispatch marker requires a System Actor",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE action_execution
                SET dispatch_may_have_started_at = COALESCE(dispatch_may_have_started_at, ?5),
                    version = version + 1, updated_at = ?5
                WHERE id = ?1 AND active_attempt_id = ?2
                  AND action_execution_epoch = ?3 AND execution_lease_owner = ?4
                  AND status = 'executing'
                "#,
                params![
                    envelope.payload.action_id,
                    envelope.payload.attempt_id,
                    envelope.payload.action_execution_epoch,
                    envelope.payload.lease_owner,
                    now,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "action.attempt_fenced",
                    "Action Attempt is stale or no longer owns the lease",
                ));
            }
            transaction.execute(
                r#"
                UPDATE action_attempt
                SET dispatch_may_have_started_at = COALESCE(dispatch_may_have_started_at, ?2)
                WHERE id = ?1 AND action_id = ?3 AND action_execution_epoch = ?4
                "#,
                params![
                    envelope.payload.attempt_id,
                    now,
                    envelope.payload.action_id,
                    envelope.payload.action_execution_epoch,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "action.dispatch_started",
                json!({
                    "actionId": envelope.payload.action_id,
                    "attemptId": envelope.payload.attempt_id,
                    "startedAt": now,
                }),
                Some(entity_ref("action_execution", &envelope.payload.action_id)),
            ))
        })
    }

    pub fn record_result(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RecordActionResultCommand>,
    ) -> Result<CommandExecution> {
        validate_action_result(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(&envelope.actor, ActorRef::System { .. }) {
                return Ok(rejected("action.system_required", "Action result requires a System Actor"));
            }
            let row = transaction
                .query_row(
                    r#"
                    SELECT action_execution.status, action_execution.active_attempt_id,
                           action_execution.action_execution_epoch,
                           action_execution.execution_lease_owner,
                           action_execution.agent_run_id,
                           action_execution.control_mode,
                           action_execution.dispatch_may_have_started_at,
                           camp_turn.camp_id,
                           agent_run.execution_epoch
                    FROM action_execution
                    JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE action_execution.id = ?1
                    "#,
                    [&envelope.payload.action_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, Option<String>>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, i64>(8)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                status,
                attempt_id,
                action_epoch,
                _lease_owner,
                agent_run_id,
                control_mode,
                dispatch_started_at,
                camp_id,
                run_epoch,
            )) = row
            else {
                return Ok(rejected("action.not_found", "Action does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected("action.camp_mismatch", "Action is outside the Camp"));
            }
            let reconciling_unknown = status == "unknown"
                && matches!(
                    &envelope.actor,
                    ActorRef::System { component_id } if component_id == "action-reconciler"
                );
            if (status != "executing" && !reconciling_unknown)
                || attempt_id.as_deref() != Some(envelope.payload.attempt_id.as_str())
                || action_epoch != envelope.payload.action_execution_epoch
            {
                return Ok(rejected(
                    "action.attempt_fenced",
                    "Old or inactive Action Attempt cannot update the result",
                ));
            }
            let valid_component = match (&envelope.actor, control_mode.as_str()) {
                (ActorRef::System { component_id }, "mediated") => {
                    component_id == "action-executor" || component_id == "action-reconciler"
                }
                (ActorRef::System { component_id }, "intercepted") => {
                    component_id.starts_with("runtime-adapter:")
                        || component_id == "action-reconciler"
                }
                _ => false,
            };
            if !valid_component || dispatch_started_at.is_none() {
                return Ok(rejected(
                    "action.result_source_invalid",
                    "Action result lacks the owning component or durable dispatch marker",
                ));
            }
            let result_data = serde_json::to_value(&envelope.payload.result_data)?;
            let result_digest = canonical_json_digest(&json!({
                "outcome": envelope.payload.outcome,
                "resultCode": envelope.payload.result_code,
                "resultSummary": envelope.payload.result_summary,
                "resultData": result_data,
                "effectDisposition": envelope.payload.effect_disposition,
            }))?;
            let (outcome, unknown_disposition, ended_at) = match envelope.payload.outcome {
                ActionResultOutcome::Succeeded => ("succeeded", None, Some(chrono::Utc::now().to_rfc3339())),
                ActionResultOutcome::Failed => ("failed", None, Some(chrono::Utc::now().to_rfc3339())),
                ActionResultOutcome::Unknown => ("unknown", Some("active"), None),
            };
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE action_execution
                SET status = ?2, unknown_disposition = ?3,
                    result_code = ?4, result_schema_version = '1',
                    result_summary = ?5, result_data_json = ?6,
                    result_digest = ?7, effect_disposition = ?8,
                    resolution_source = ?9,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    next_reconcile_at = ?10, ended_at = ?11,
                    version = version + 1, updated_at = ?12
                WHERE id = ?1 AND status IN ('executing', 'unknown')
                  AND active_attempt_id = ?13 AND action_execution_epoch = ?14
                "#,
                params![
                    envelope.payload.action_id,
                    outcome,
                    unknown_disposition,
                    envelope.payload.result_code,
                    envelope.payload.result_summary,
                    serde_json::to_string(&result_data)?,
                    result_digest,
                    envelope.payload.effect_disposition,
                    if matches!(&envelope.actor, ActorRef::System { component_id } if component_id == "action-reconciler") {
                        "reconciler"
                    } else {
                        "executor"
                    },
                    (outcome == "unknown").then_some(now.as_str()),
                    ended_at,
                    now,
                    envelope.payload.attempt_id,
                    envelope.payload.action_execution_epoch,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE action_attempt
                SET outcome = ?2, ended_at = ?3
                WHERE id = ?1 AND action_id = ?4 AND action_execution_epoch = ?5
                "#,
                params![
                    envelope.payload.attempt_id,
                    outcome,
                    now,
                    envelope.payload.action_id,
                    envelope.payload.action_execution_epoch,
                ],
            )?;
            if outcome == "unknown" {
                mark_agent_run_waiting(transaction, &agent_run_id, "unknown_action_outcome", &now)?;
            } else if control_mode == "mediated" {
                create_runtime_delivery(
                    transaction,
                    &agent_run_id,
                    &envelope.payload.action_id,
                    "action_result",
                    run_epoch,
                    &json!({
                        "actionId": envelope.payload.action_id,
                        "outcome": outcome,
                        "resultCode": envelope.payload.result_code,
                        "resultSummary": envelope.payload.result_summary,
                        "effectDisposition": envelope.payload.effect_disposition,
                    }),
                )?;
                mark_agent_run_waiting(transaction, &agent_run_id, "runtime_delivery", &now)?;
            } else {
                resume_agent_run_if_unblocked(transaction, &agent_run_id, &now)?;
            }
            append_domain_event(
                transaction,
                "action.result_recorded",
                Some(&camp_id),
                Some(("action_execution", &envelope.payload.action_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentRunId": agent_run_id,
                    "attemptId": envelope.payload.attempt_id,
                    "outcome": outcome,
                    "effectDisposition": envelope.payload.effect_disposition,
                    "resultDigest": result_digest,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "action.result_recorded",
                json!({
                    "actionId": envelope.payload.action_id,
                    "status": outcome,
                    "resultDigest": result_digest,
                }),
                Some(entity_ref("action_execution", &envelope.payload.action_id)),
            ))
        })
    }

    pub fn acquire_runtime_delivery(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcquireRuntimeDeliveryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "runtime_delivery.adapter_required",
                    "Runtime Delivery requires a Runtime Adapter",
                ));
            }
            if envelope.payload.lease_owner.trim().is_empty() || envelope.payload.lease_seconds <= 0
            {
                return Ok(rejected(
                    "runtime_delivery.invalid_lease",
                    "Runtime Delivery lease is invalid",
                ));
            }
            let row = transaction
                .query_row(
                    r#"
                    SELECT runtime_delivery_checkpoint.status,
                           runtime_delivery_checkpoint.available_at,
                           runtime_delivery_checkpoint.lease_expires_at,
                           runtime_delivery_checkpoint.version,
                           runtime_delivery_checkpoint.agent_run_id,
                           runtime_delivery_checkpoint.target_execution_epoch,
                           runtime_delivery_checkpoint.payload_digest,
                           runtime_delivery_checkpoint.payload_json,
                           camp_turn.camp_id, agent_run.status,
                           agent_run.execution_epoch
                    FROM runtime_delivery_checkpoint
                    JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE runtime_delivery_checkpoint.id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, String>(9)?,
                            row.get::<_, i64>(10)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                status,
                available_at,
                lease_expires_at,
                version,
                agent_run_id,
                target_epoch,
                payload_digest,
                payload_json,
                camp_id,
                run_status,
                run_epoch,
            )) = row
            else {
                return Ok(rejected(
                    "runtime_delivery.not_found",
                    "Runtime Delivery does not exist",
                ));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str())
                || version != envelope.payload.expected_version
            {
                return Ok(rejected(
                    "runtime_delivery.version_or_scope_conflict",
                    "Runtime Delivery scope or version is stale",
                ));
            }
            let now = chrono::Utc::now();
            let available = chrono::DateTime::parse_from_rfc3339(&available_at)
                .map(|value| value <= now)
                .unwrap_or(false);
            let lease_expired = lease_expires_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_some_and(|value| value <= now);
            if !(status == "pending" || (status == "delivering" && lease_expired)) || !available {
                return Ok(rejected(
                    "runtime_delivery.not_claimable",
                    "Runtime Delivery is not available for delivery",
                ));
            }
            if !matches!(run_status.as_str(), "running" | "waiting") || run_epoch != target_epoch {
                return Ok(rejected(
                    "runtime_delivery.target_fenced",
                    "Runtime Delivery targets an inactive AgentRun epoch",
                ));
            }
            let now_text = now.to_rfc3339();
            let lease_expires_at =
                (now + chrono::Duration::seconds(envelope.payload.lease_seconds)).to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE runtime_delivery_checkpoint
                SET status = 'delivering', attempt_count = attempt_count + 1,
                    lease_owner = ?2, lease_expires_at = ?3,
                    version = version + 1, updated_at = ?4
                WHERE id = ?1 AND version = ?5
                "#,
                params![
                    envelope.payload.delivery_id,
                    envelope.payload.lease_owner,
                    lease_expires_at,
                    now_text,
                    envelope.payload.expected_version,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "runtime_delivery.claim_race_lost",
                    "Runtime Delivery changed before lease acquisition",
                ));
            }
            Ok(CommandHandlerResult::accepted(
                "runtime_delivery.acquired",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "agentRunId": agent_run_id,
                    "targetExecutionEpoch": target_epoch,
                    "payloadDigest": payload_digest,
                    "payload": serde_json::from_str::<Value>(&payload_json)?,
                    "leaseExpiresAt": lease_expires_at,
                }),
                Some(entity_ref(
                    "runtime_delivery_checkpoint",
                    &envelope.payload.delivery_id,
                )),
            ))
        })
    }

    pub fn acknowledge_runtime_delivery(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcknowledgeRuntimeDeliveryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "runtime_delivery.adapter_required",
                    "Runtime Delivery ACK requires a Runtime Adapter",
                ));
            }
            let row = transaction
                .query_row(
                    r#"
                    SELECT runtime_delivery_checkpoint.agent_run_id,
                           runtime_delivery_checkpoint.status,
                           runtime_delivery_checkpoint.payload_digest,
                           runtime_delivery_checkpoint.target_execution_epoch,
                           runtime_delivery_checkpoint.lease_owner,
                           camp_turn.camp_id, agent_run.status,
                           agent_run.execution_epoch
                    FROM runtime_delivery_checkpoint
                    JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE runtime_delivery_checkpoint.id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                agent_run_id,
                status,
                payload_digest,
                target_epoch,
                lease_owner,
                camp_id,
                run_status,
                run_epoch,
            )) = row
            else {
                return Ok(rejected(
                    "runtime_delivery.not_found",
                    "Runtime Delivery does not exist",
                ));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str())
                || status != "delivering"
                || payload_digest != envelope.payload.payload_digest
                || target_epoch != envelope.payload.target_execution_epoch
                || lease_owner.as_deref() != Some(envelope.payload.lease_owner.as_str())
                || run_epoch != target_epoch
                || !matches!(run_status.as_str(), "running" | "waiting")
            {
                return Ok(rejected(
                    "runtime_delivery.ack_fenced",
                    "Runtime Delivery ACK does not match the active payload and Run epoch",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE runtime_delivery_checkpoint
                SET status = 'acked', acked_at = ?2,
                    lease_owner = NULL, lease_expires_at = NULL,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND status = 'delivering'
                  AND payload_digest = ?3 AND target_execution_epoch = ?4
                  AND lease_owner = ?5
                "#,
                params![
                    envelope.payload.delivery_id,
                    now,
                    envelope.payload.payload_digest,
                    envelope.payload.target_execution_epoch,
                    envelope.payload.lease_owner,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "runtime_delivery.ack_race_lost",
                    "Runtime Delivery changed before ACK",
                ));
            }
            resume_agent_run_if_unblocked(transaction, &agent_run_id, &now)?;
            append_domain_event(
                transaction,
                "runtime_delivery.acknowledged",
                Some(&camp_id),
                Some(("runtime_delivery_checkpoint", &envelope.payload.delivery_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentRunId": agent_run_id,
                    "payloadDigest": envelope.payload.payload_digest,
                    "targetExecutionEpoch": envelope.payload.target_execution_epoch,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "runtime_delivery.acknowledged",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "agentRunId": agent_run_id,
                }),
                Some(entity_ref(
                    "runtime_delivery_checkpoint",
                    &envelope.payload.delivery_id,
                )),
            ))
        })
    }

    pub fn confirm_runtime_request_resolved(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ConfirmRuntimeRequestResolvedCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "runtime_request.adapter_required",
                    "Runtime request confirmation requires a Runtime Adapter",
                ));
            }
            let native_request_id_json =
                serde_json::to_string(&envelope.payload.native_request_id)?;
            let row = transaction
                .query_row(
                    r#"
                    SELECT action_execution.id, action_execution.status,
                           action_execution.version, action_execution.native_thread_id,
                           camp_turn.camp_id, agent_run.status, agent_run.execution_epoch,
                           approval.id, approval.status,
                           runtime_delivery_checkpoint.id,
                           runtime_delivery_checkpoint.status
                    FROM action_execution
                    JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    LEFT JOIN approval ON approval.action_id = action_execution.id
                    LEFT JOIN runtime_delivery_checkpoint
                      ON runtime_delivery_checkpoint.action_id = action_execution.id
                     AND runtime_delivery_checkpoint.delivery_kind = 'authorization_resolution'
                    WHERE action_execution.agent_run_id = ?1
                      AND action_execution.control_mode = 'intercepted'
                      AND action_execution.source_agent_run_execution_epoch = ?2
                      AND action_execution.native_request_id_json = ?3
                    "#,
                    params![
                        envelope.payload.agent_run_id,
                        envelope.payload.execution_epoch,
                        native_request_id_json,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, Option<String>>(7)?,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, Option<String>>(10)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                action_id,
                action_status,
                action_version,
                native_thread_id,
                camp_id,
                run_status,
                run_epoch,
                approval_id,
                approval_status,
                delivery_id,
                delivery_status,
            )) = row
            else {
                return Ok(rejected(
                    "runtime_request.not_found",
                    "Resolved Runtime request is not bound to an intercepted Action",
                ));
            };
            if envelope
                .camp_id
                .as_deref()
                .is_some_and(|scope| scope != camp_id)
                || native_thread_id.as_deref() != Some(envelope.payload.native_thread_id.as_str())
                || run_epoch != envelope.payload.execution_epoch
                || !matches!(run_status.as_str(), "running" | "waiting")
            {
                return Ok(rejected(
                    "runtime_request.resolution_fenced",
                    "Resolved Runtime request is outside the active Run binding",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let mut resolution = "already_settled";
            match delivery_status.as_deref() {
                Some("delivering") => {
                    transaction.execute(
                        r#"
                        UPDATE runtime_delivery_checkpoint
                        SET status = 'acked', acked_at = ?2,
                            lease_owner = NULL, lease_expires_at = NULL,
                            version = version + 1, updated_at = ?2
                        WHERE id = ?1 AND status = 'delivering'
                        "#,
                        params![delivery_id, now],
                    )?;
                    resolution = "delivery_acknowledged";
                }
                Some("pending") | None => {
                    if let Some(delivery_id) = delivery_id.as_deref() {
                        transaction.execute(
                            r#"
                            UPDATE runtime_delivery_checkpoint
                            SET status = 'safely_closed', safely_closed_at = ?2,
                                lease_owner = NULL, lease_expires_at = NULL,
                                last_error = 'native_request_resolved_before_delivery',
                                version = version + 1, updated_at = ?2
                            WHERE id = ?1 AND status = 'pending'
                            "#,
                            params![delivery_id, now],
                        )?;
                    }
                    if action_status == "prepared" {
                        set_action_not_executed(
                            transaction,
                            &action_id,
                            action_version,
                            "runtime_request_resolved",
                            &now,
                        )?;
                    }
                    if approval_status.as_deref() == Some("pending") {
                        transaction.execute(
                            r#"
                            UPDATE approval
                            SET status = 'cancelled',
                                decision_json = '{"reason":"native_request_resolved"}',
                                resolved_by_type = 'system',
                                resolved_by_id = 'runtime-adapter:codex',
                                resolution_code = 'native_request_resolved',
                                version = version + 1,
                                resolved_at = ?2, updated_at = ?2
                            WHERE id = ?1 AND status = 'pending'
                            "#,
                            params![approval_id, now],
                        )?;
                    }
                    resolution = "request_closed_without_delivery";
                }
                Some("failed") => {
                    transaction.execute(
                        r#"
                        UPDATE runtime_delivery_checkpoint
                        SET status = 'safely_closed', safely_closed_at = ?2,
                            lease_owner = NULL, lease_expires_at = NULL,
                            version = version + 1, updated_at = ?2
                        WHERE id = ?1 AND status = 'failed'
                        "#,
                        params![delivery_id, now],
                    )?;
                    resolution = "request_closed_after_delivery_failure";
                }
                Some("acked" | "safely_closed") => {}
                Some(_) => {
                    return Ok(rejected(
                        "runtime_request.delivery_state_invalid",
                        "Runtime request has an unsupported delivery state",
                    ));
                }
            }
            resume_agent_run_if_unblocked(transaction, &envelope.payload.agent_run_id, &now)?;
            append_domain_event(
                transaction,
                "runtime_request.resolved",
                Some(&camp_id),
                Some(("action_execution", &action_id)),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "actionId": action_id,
                    "deliveryId": delivery_id,
                    "resolution": resolution,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "runtime_request.resolved",
                json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "actionId": action_id,
                    "deliveryId": delivery_id,
                    "resolution": resolution,
                }),
                Some(entity_ref("action_execution", &action_id)),
            ))
        })
    }

    pub fn reconcile_runtime_loss(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReconcileRuntimeLossCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id }
                    if component_id == "runtime-recovery-coordinator"
            ) {
                return Ok(rejected(
                    "runtime_loss.coordinator_required",
                    "Runtime loss reconciliation requires its coordinator",
                ));
            }
            let run = transaction
                .query_row(
                    r#"
                    SELECT camp_turn.camp_id, agent_run.status,
                           agent_run.version, agent_run.execution_epoch
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
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, run_status, run_version, run_epoch)) = run else {
                return Ok(rejected("agent_run.not_found", "AgentRun does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str())
                || run_version != envelope.payload.expected_version
                || run_epoch != envelope.payload.execution_epoch
                || !matches!(run_status.as_str(), "running" | "waiting")
            {
                return Ok(rejected(
                    "runtime_loss.fenced",
                    "Runtime loss report is stale or outside the active Run",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let actions_marked_unknown = transaction.execute(
                r#"
                UPDATE action_execution
                SET status = 'unknown', unknown_disposition = 'active',
                    effect_disposition = 'unknown', resolution_source = 'reconciler',
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = 'runtime_lost_after_dispatch',
                    next_reconcile_at = ?3,
                    version = version + 1, updated_at = ?3
                WHERE agent_run_id = ?1
                  AND source_agent_run_execution_epoch = ?2
                  AND control_mode = 'intercepted'
                  AND status = 'executing'
                  AND dispatch_may_have_started_at IS NOT NULL
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE action_attempt
                SET outcome = 'unknown', ended_at = COALESCE(ended_at, ?3)
                WHERE outcome IS NULL
                  AND action_id IN (
                      SELECT id FROM action_execution
                      WHERE agent_run_id = ?1
                        AND source_agent_run_execution_epoch = ?2
                        AND status = 'unknown'
                        AND last_error_code = 'runtime_lost_after_dispatch'
                  )
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            let actions_closed = transaction.execute(
                r#"
                UPDATE action_execution
                SET status = 'not_executed',
                    not_executed_reason = 'runtime_request_lost',
                    effect_disposition = 'none', ended_at = ?3,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    version = version + 1, updated_at = ?3
                WHERE agent_run_id = ?1
                  AND source_agent_run_execution_epoch = ?2
                  AND control_mode = 'intercepted'
                  AND status = 'prepared'
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            let approvals_cancelled = transaction.execute(
                r#"
                UPDATE approval
                SET status = 'cancelled',
                    decision_json = '{"reason":"runtime_request_lost"}',
                    resolved_by_type = 'system',
                    resolved_by_id = 'runtime-recovery-coordinator',
                    resolution_code = 'runtime_request_lost',
                    version = version + 1,
                    resolved_at = ?3, updated_at = ?3
                WHERE status = 'pending'
                  AND action_id IN (
                      SELECT id FROM action_execution
                      WHERE agent_run_id = ?1
                        AND source_agent_run_execution_epoch = ?2
                        AND control_mode = 'intercepted'
                  )
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            let deliveries_closed = transaction.execute(
                r#"
                UPDATE runtime_delivery_checkpoint
                SET status = 'safely_closed', safely_closed_at = ?3,
                    lease_owner = NULL, lease_expires_at = NULL,
                    last_error = 'runtime_request_lost',
                    version = version + 1, updated_at = ?3
                WHERE agent_run_id = ?1
                  AND target_execution_epoch = ?2
                  AND delivery_kind = 'authorization_resolution'
                  AND status IN ('pending', 'delivering', 'failed')
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.execution_epoch,
                    now,
                ],
            )?;
            let has_unknown: i64 = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM action_execution
                    WHERE agent_run_id = ?1
                      AND status = 'unknown'
                      AND unknown_disposition = 'active'
                )
                "#,
                [&envelope.payload.agent_run_id],
                |row| row.get(0),
            )?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting',
                    wait_reason = CASE
                        WHEN ?4 <> 0 THEN 'unknown_action_outcome'
                        WHEN status = 'running'
                          OR wait_reason IN ('approval', 'action_execution', 'runtime_delivery')
                            THEN 'runtime_recovery'
                        ELSE wait_reason
                    END,
                    runtime_recovery_required = 1,
                    execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                    last_error_code = CASE
                        WHEN ?4 <> 0 THEN 'runtime_lost_with_unknown_action'
                        ELSE 'runtime_connection_lost'
                    END,
                    version = version + 1, updated_at = ?5
                WHERE id = ?1 AND version = ?2 AND execution_epoch = ?3
                  AND status IN ('running', 'waiting')
                "#,
                params![
                    envelope.payload.agent_run_id,
                    envelope.payload.expected_version,
                    envelope.payload.execution_epoch,
                    has_unknown,
                    now,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "runtime_loss.race_lost",
                    "AgentRun changed while Runtime loss was reconciled",
                ));
            }
            let wait_reason: String = transaction.query_row(
                "SELECT wait_reason FROM agent_run WHERE id = ?1",
                [&envelope.payload.agent_run_id],
                |row| row.get(0),
            )?;
            append_domain_event(
                transaction,
                "agent_run.runtime_loss_reconciled",
                Some(&camp_id),
                Some(("agent_run", &envelope.payload.agent_run_id)),
                &envelope.actor,
                Some(envelope.payload.execution_epoch),
                &json!({
                    "reason": envelope.payload.reason,
                    "actionsMarkedUnknown": actions_marked_unknown,
                    "actionsClosed": actions_closed,
                    "approvalsCancelled": approvals_cancelled,
                    "deliveriesClosed": deliveries_closed,
                    "hasUnknownAction": has_unknown != 0,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_run.runtime_loss_reconciled",
                json!({
                    "agentRunId": envelope.payload.agent_run_id,
                    "waitReason": wait_reason,
                }),
                Some(entity_ref("agent_run", &envelope.payload.agent_run_id)),
            ))
        })
    }

    pub fn fail_runtime_delivery(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<FailRuntimeDeliveryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(
                &envelope.actor,
                ActorRef::System { component_id } if component_id.starts_with("runtime-adapter:")
            ) {
                return Ok(rejected(
                    "runtime_delivery.adapter_required",
                    "Runtime Delivery failure requires a Runtime Adapter",
                ));
            }
            if envelope.payload.error.trim().is_empty() {
                return Ok(rejected(
                    "runtime_delivery.error_required",
                    "Runtime Delivery failure requires an error",
                ));
            }
            let row = transaction
                .query_row(
                    r#"
                    SELECT camp_turn.camp_id, runtime_delivery_checkpoint.agent_run_id,
                           agent_run.execution_epoch
                    FROM runtime_delivery_checkpoint
                    JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE runtime_delivery_checkpoint.id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, agent_run_id, run_epoch)) = row else {
                return Ok(rejected(
                    "runtime_delivery.not_found",
                    "Runtime Delivery does not exist",
                ));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str())
                || run_epoch != envelope.payload.target_execution_epoch
            {
                return Ok(rejected(
                    "runtime_delivery.failure_fenced",
                    "Runtime Delivery failure is outside the active Run epoch",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE runtime_delivery_checkpoint
                SET status = 'failed', last_error = ?2,
                    lease_owner = NULL, lease_expires_at = NULL,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND status = 'delivering'
                  AND payload_digest = ?4 AND target_execution_epoch = ?5
                  AND lease_owner = ?6
                "#,
                params![
                    envelope.payload.delivery_id,
                    envelope.payload.error,
                    now,
                    envelope.payload.payload_digest,
                    envelope.payload.target_execution_epoch,
                    envelope.payload.lease_owner,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "runtime_delivery.failure_race_lost",
                    "Runtime Delivery changed before failure was recorded",
                ));
            }
            append_domain_event(
                transaction,
                "runtime_delivery.failed",
                Some(&camp_id),
                Some(("runtime_delivery_checkpoint", &envelope.payload.delivery_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentRunId": agent_run_id,
                    "payloadDigest": envelope.payload.payload_digest,
                    "targetExecutionEpoch": envelope.payload.target_execution_epoch,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "runtime_delivery.failed",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "agentRunId": agent_run_id,
                }),
                Some(entity_ref(
                    "runtime_delivery_checkpoint",
                    &envelope.payload.delivery_id,
                )),
            ))
        })
    }

    pub fn list_runtime_delivery_candidates(
        &self,
        database: &Database,
        limit: i64,
    ) -> Result<Vec<RuntimeDeliveryCandidate>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT runtime_delivery_checkpoint.id, camp_turn.camp_id,
                   runtime_delivery_checkpoint.agent_run_id,
                   action_execution.id, action_execution.version,
                   action_execution.status, action_execution.action_kind,
                   runtime_delivery_checkpoint.delivery_kind,
                   runtime_delivery_checkpoint.version,
                   runtime_delivery_checkpoint.target_execution_epoch,
                   action_execution.native_request_method,
                   runtime_delivery_checkpoint.native_request_id,
                   action_execution.native_response_context_json
            FROM runtime_delivery_checkpoint
            JOIN action_execution ON action_execution.id = runtime_delivery_checkpoint.action_id
            JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE runtime_delivery_checkpoint.status = 'pending'
              AND runtime_delivery_checkpoint.delivery_kind = 'authorization_resolution'
              AND runtime_delivery_checkpoint.available_at <= ?1
              AND action_execution.control_mode = 'intercepted'
              AND action_execution.source_agent_run_execution_epoch =
                  runtime_delivery_checkpoint.target_execution_epoch
              AND agent_run.execution_epoch = runtime_delivery_checkpoint.target_execution_epoch
              AND agent_run.status IN ('running', 'waiting')
              AND action_execution.native_request_method IS NOT NULL
              AND runtime_delivery_checkpoint.native_request_id IS NOT NULL
              AND action_execution.native_response_context_json IS NOT NULL
            ORDER BY runtime_delivery_checkpoint.created_at, runtime_delivery_checkpoint.id
            LIMIT ?2
            "#,
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        statement
            .query_map(params![now, limit.clamp(1, 100)], |row| {
                let native_request_id_json = row.get::<_, String>(11)?;
                let response_context_json = row.get::<_, String>(12)?;
                Ok(RuntimeDeliveryCandidate {
                    delivery_id: row.get(0)?,
                    camp_id: row.get(1)?,
                    agent_run_id: row.get(2)?,
                    action_id: row.get(3)?,
                    action_version: row.get(4)?,
                    action_status: row.get(5)?,
                    action_kind: row.get(6)?,
                    delivery_kind: row.get(7)?,
                    delivery_version: row.get(8)?,
                    target_execution_epoch: row.get(9)?,
                    native_method: row.get(10)?,
                    native_request_id: serde_json::from_str(&native_request_id_json).map_err(
                        |error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                11,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        },
                    )?,
                    response_context: serde_json::from_str(&response_context_json).map_err(
                        |error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                12,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        },
                    )?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to scan Runtime Delivery candidates")
    }

    pub fn load_intercepted_action_attempts(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
        native_item_id: &str,
    ) -> Result<Vec<InterceptedActionAttempt>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT action_execution.id, camp_turn.camp_id,
                   action_execution.active_attempt_id,
                   action_execution.action_execution_epoch,
                   action_execution.action_kind
            FROM action_execution
            JOIN agent_run ON agent_run.id = action_execution.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE action_execution.agent_run_id = ?1
              AND action_execution.source_agent_run_execution_epoch = ?2
              AND agent_run.execution_epoch = ?2
              AND action_execution.native_item_id = ?3
              AND action_execution.control_mode = 'intercepted'
              AND action_execution.status = 'executing'
              AND action_execution.active_attempt_id IS NOT NULL
            ORDER BY action_execution.created_at, action_execution.id
            "#,
        )?;
        statement
            .query_map(
                params![agent_run_id, execution_epoch, native_item_id],
                |row| {
                    Ok(InterceptedActionAttempt {
                        action_id: row.get(0)?,
                        camp_id: row.get(1)?,
                        attempt_id: row.get(2)?,
                        action_execution_epoch: row.get(3)?,
                        action_kind: row.get(4)?,
                    })
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to load intercepted Action Attempts")
    }
}

fn validate_prepare_action(command: &PrepareActionCommand) -> Result<()> {
    if command.action_id.trim().is_empty() || command.requested_for_user_id.trim().is_empty() {
        anyhow::bail!("Action ID and target user are required");
    }
    let observed_input = matches!(
        command.input,
        CanonicalActionInput::RuntimeObservedUnknown { .. }
    );
    if (command.control_mode == ActionControlMode::Observed) != observed_input {
        anyhow::bail!("Observed control mode requires RuntimeObservedUnknown input and vice versa");
    }
    match command.control_mode {
        ActionControlMode::Intercepted => {
            let native_action_id = command
                .native_action_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .context("Intercepted Action requires a Native Action ID")?;
            let binding = command
                .runtime_request
                .as_ref()
                .context("Intercepted Action requires an exact Runtime request binding")?;
            if native_action_id.trim().is_empty()
                || binding.native_method.trim().is_empty()
                || binding.native_item_id.trim().is_empty()
                || binding.native_thread_id.trim().is_empty()
                || binding.native_turn_id.trim().is_empty()
                || binding.native_request_id.is_null()
                || !binding.response_context.is_object()
            {
                anyhow::bail!("Intercepted Runtime request binding is incomplete");
            }
        }
        ActionControlMode::Mediated | ActionControlMode::Observed => {
            if command.runtime_request.is_some() {
                anyhow::bail!("Only intercepted Actions may bind a Runtime server request");
            }
        }
    }
    if let Some(execute_before) = &command.execute_before {
        chrono::DateTime::parse_from_rfc3339(execute_before)
            .context("executeBefore must be RFC3339")?;
    }
    Ok(())
}

fn validate_action_result(command: &RecordActionResultCommand) -> Result<()> {
    validate_action_result_fields(
        command.outcome,
        &command.result_code,
        &command.result_summary,
        &command.effect_disposition,
    )
}

fn validate_action_result_fields(
    outcome: ActionResultOutcome,
    result_code: &str,
    result_summary: &str,
    effect_disposition: &str,
) -> Result<()> {
    if result_code.trim().is_empty() || result_summary.trim().is_empty() {
        anyhow::bail!("Action result code and summary are required");
    }
    let valid = match outcome {
        ActionResultOutcome::Succeeded => {
            matches!(effect_disposition, "none" | "complete" | "partial")
        }
        ActionResultOutcome::Failed => matches!(effect_disposition, "none" | "partial" | "unknown"),
        ActionResultOutcome::Unknown => matches!(effect_disposition, "partial" | "unknown"),
    };
    if !valid {
        anyhow::bail!("Action outcome and effect disposition are inconsistent");
    }
    Ok(())
}

fn agent_action_context(
    transaction: &Transaction<'_>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    camp_id: &str,
) -> Result<Option<AgentActionContext>> {
    let ActorRef::Agent {
        agent_profile_id,
        source_agent_run_id,
    } = actor
    else {
        return Ok(None);
    };
    let Some(execution_epoch) = execution_epoch else {
        return Ok(None);
    };
    transaction
        .query_row(
            r#"
            SELECT agent_run.effective_config_json, agent_run.workspace_json
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            JOIN camp_member
              ON camp_member.camp_id = camp_turn.camp_id
             AND camp_member.agent_profile_id = conversation.agent_profile_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
            WHERE agent_run.id = ?1 AND camp_turn.camp_id = ?2
              AND conversation.agent_profile_id = ?3
              AND agent_run.execution_epoch = ?4
              AND agent_run.status IN ('running', 'waiting')
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'active'
            "#,
            params![
                source_agent_run_id,
                camp_id,
                agent_profile_id,
                execution_epoch
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?
        .map(|(effective_config, workspace)| {
            Ok(AgentActionContext {
                effective_config: serde_json::from_str(&effective_config)
                    .context("AgentRun effective config is invalid")?,
                workspace: workspace
                    .map(|value| {
                        serde_json::from_str(&value).context("AgentRun workspace is invalid")
                    })
                    .transpose()?,
            })
        })
        .transpose()
}

fn has_capability(effective_config: &Value, capability: &str) -> bool {
    effective_config["capabilities"]
        .as_array()
        .is_some_and(|values| {
            values
                .iter()
                .any(|value| value.as_str() == Some(capability))
        })
}

fn evaluate_policy(effective_config: &Value, action_kind: &str) -> Result<PolicyEvaluation> {
    let envelope = &effective_config["actionPermissionEnvelope"];
    let rules = envelope["rules"].as_array().cloned().unwrap_or_default();
    let mut matched_rule_ids = Vec::new();
    let mut decisions = BTreeSet::new();
    for rule in rules {
        let matches_kind = rule["actionKind"].as_str() == Some(action_kind)
            || rule["actionKind"].as_str() == Some("*");
        if !matches_kind {
            continue;
        }
        let Some(effect) = rule["effect"].as_str() else {
            anyhow::bail!("Action permission rule is missing an effect");
        };
        if !matches!(effect, "allow" | "ask" | "deny") {
            anyhow::bail!("Action permission rule has an invalid effect");
        }
        decisions.insert(effect.to_string());
        matched_rule_ids.push(rule["id"].as_str().unwrap_or("anonymous-rule").to_string());
    }
    let decision = if decisions.contains("deny") {
        "deny"
    } else if decisions.contains("ask") {
        "ask"
    } else if decisions.contains("allow") {
        "allow"
    } else {
        "deny"
    };
    Ok(PolicyEvaluation {
        decision,
        version: envelope["schemaVersion"]
            .as_i64()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "1".to_string()),
        matched_rule_ids,
    })
}

fn validate_workspace_scope(
    input: &CanonicalActionInput,
    workspace: Option<&Value>,
) -> std::result::Result<(), String> {
    let target = match input {
        CanonicalActionInput::ShellCommand { cwd, .. } => Some(cwd.as_str()),
        CanonicalActionInput::FileWrite { path, .. }
        | CanonicalActionInput::FileDelete { path } => Some(path.as_str()),
        CanonicalActionInput::RuntimePermissionGrant { cwd, .. } => Some(cwd.as_str()),
        _ => None,
    };
    let Some(target) = target else {
        return Ok(());
    };
    let Some(workspace) = workspace else {
        return Err("Filesystem action requires a frozen AgentRun workspace".to_string());
    };
    let Some(root) = workspace["executionRoot"].as_str() else {
        return Err("AgentRun workspace has no executionRoot".to_string());
    };
    if !path_is_within_workspace(Path::new(target), Path::new(root))? {
        return Err("Filesystem action target is outside the frozen executionRoot".to_string());
    }
    if matches!(
        input,
        CanonicalActionInput::FileWrite { .. } | CanonicalActionInput::FileDelete { .. }
    ) && workspace["access"].as_str() != Some("write")
    {
        return Err("Read-only AgentRun workspace cannot mutate files".to_string());
    }
    if let CanonicalActionInput::RuntimePermissionGrant { permissions, .. } = input {
        validate_runtime_permission_scope(permissions, workspace, Path::new(root))?;
    }
    Ok(())
}

fn validate_runtime_permission_scope(
    permissions: &Value,
    workspace: &Value,
    root: &Path,
) -> std::result::Result<(), String> {
    let permissions = permissions
        .as_object()
        .ok_or_else(|| "Runtime permission profile must be an object".to_string())?;
    if permissions
        .keys()
        .any(|key| !matches!(key.as_str(), "fileSystem" | "network"))
    {
        return Err("Runtime permission profile contains an unsupported field".to_string());
    }
    if let Some(network) = permissions.get("network").filter(|value| !value.is_null()) {
        let network = network
            .as_object()
            .ok_or_else(|| "Runtime network permission must be an object".to_string())?;
        if network.keys().any(|key| key != "enabled")
            || network
                .get("enabled")
                .is_some_and(|enabled| !enabled.is_null() && !enabled.is_boolean())
        {
            return Err("Runtime network permission is not supported safely".to_string());
        }
    }
    let Some(file_system) = permissions
        .get("fileSystem")
        .filter(|value| !value.is_null())
    else {
        return Ok(());
    };
    let file_system = file_system
        .as_object()
        .ok_or_else(|| "Runtime filesystem permission must be an object".to_string())?;
    if file_system.keys().any(|key| {
        !matches!(
            key.as_str(),
            "entries" | "read" | "write" | "globScanMaxDepth"
        )
    }) {
        return Err("Runtime filesystem permission contains an unsupported field".to_string());
    }
    if file_system
        .get("globScanMaxDepth")
        .is_some_and(|depth| !depth.is_null() && depth.as_u64().is_none_or(|depth| depth == 0))
    {
        return Err("Runtime filesystem globScanMaxDepth is invalid".to_string());
    }
    for (field, requires_write) in [("read", false), ("write", true)] {
        let Some(paths) = file_system.get(field).filter(|value| !value.is_null()) else {
            continue;
        };
        let paths = paths
            .as_array()
            .ok_or_else(|| format!("Runtime filesystem {field} permission must be an array"))?;
        for path in paths {
            let path = path
                .as_str()
                .ok_or_else(|| "Runtime filesystem permission path must be a string".to_string())?;
            validate_permission_path(path, requires_write, workspace, root)?;
        }
    }
    if let Some(entries) = file_system.get("entries").filter(|value| !value.is_null()) {
        let entries = entries
            .as_array()
            .ok_or_else(|| "Runtime filesystem entries must be an array".to_string())?;
        for entry in entries {
            let entry = entry
                .as_object()
                .ok_or_else(|| "Runtime filesystem entry must be an object".to_string())?;
            let access = entry
                .get("access")
                .and_then(Value::as_str)
                .ok_or_else(|| "Runtime filesystem entry has no access mode".to_string())?;
            if access == "deny" {
                continue;
            }
            if !matches!(access, "read" | "write") {
                return Err("Runtime filesystem entry has an unsupported access mode".to_string());
            }
            let path = entry
                .get("path")
                .and_then(Value::as_object)
                .ok_or_else(|| "Runtime filesystem entry has no path".to_string())?;
            if path.get("type").and_then(Value::as_str) != Some("path") {
                return Err(
                    "Glob and special Runtime filesystem grants are not supported in v0.02"
                        .to_string(),
                );
            }
            let path = path
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "Runtime filesystem entry path is invalid".to_string())?;
            validate_permission_path(path, access == "write", workspace, root)?;
        }
    }
    Ok(())
}

fn validate_permission_path(
    path: &str,
    requires_write: bool,
    workspace: &Value,
    root: &Path,
) -> std::result::Result<(), String> {
    let path = Path::new(path);
    if !path.is_absolute() || !path_is_within_workspace(path, root)? {
        return Err("Runtime permission path is outside the frozen executionRoot".to_string());
    }
    if requires_write && workspace["access"].as_str() != Some("write") {
        return Err("Read-only AgentRun cannot receive additional write access".to_string());
    }
    Ok(())
}

fn path_is_within_workspace(target: &Path, root: &Path) -> std::result::Result<bool, String> {
    use std::path::Component;

    if !target.is_absolute() || !root.is_absolute() {
        return Ok(false);
    }
    if target
        .components()
        .chain(root.components())
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Ok(false);
    }
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|error| format!("frozen executionRoot cannot be resolved: {error}"))?;
    let mut existing_ancestor = target;
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| "filesystem Action target has no existing ancestor".to_string())?;
    }
    let canonical_ancestor = std::fs::canonicalize(existing_ancestor)
        .map_err(|error| format!("filesystem Action target cannot be resolved: {error}"))?;
    Ok(canonical_ancestor.starts_with(canonical_root))
}

fn set_action_not_executed(
    transaction: &Transaction<'_>,
    action_id: &str,
    expected_version: i64,
    reason: &str,
    now: &str,
) -> Result<()> {
    let updated = transaction.execute(
        r#"
        UPDATE action_execution
        SET status = 'not_executed', not_executed_reason = ?2,
            effect_disposition = 'none', ended_at = ?3,
            version = version + 1, updated_at = ?3
        WHERE id = ?1 AND status = 'prepared' AND version = ?4
        "#,
        params![action_id, reason, now, expected_version],
    )?;
    if updated != 1 {
        anyhow::bail!("Action changed while resolving Approval");
    }
    Ok(())
}

fn mark_agent_run_waiting(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    reason: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE agent_run
        SET status = 'waiting', wait_reason = ?2,
            version = version + 1, updated_at = ?3
        WHERE id = ?1 AND status IN ('running', 'waiting')
        "#,
        params![agent_run_id, reason, now],
    )?;
    Ok(())
}

fn resume_agent_run_if_unblocked(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    now: &str,
) -> Result<()> {
    let other_blockers: i64 = transaction.query_row(
        r#"
        SELECT
            (SELECT COUNT(*) FROM approval
             JOIN action_execution ON action_execution.id = approval.action_id
             WHERE action_execution.agent_run_id = ?1 AND approval.status = 'pending')
          + (SELECT COUNT(*) FROM action_execution
             WHERE agent_run_id = ?1 AND status = 'unknown' AND unknown_disposition = 'active')
          + (SELECT COUNT(*) FROM runtime_delivery_checkpoint
             WHERE agent_run_id = ?1 AND status IN ('pending', 'delivering', 'failed'))
        "#,
        [agent_run_id],
        |row| row.get(0),
    )?;
    if other_blockers == 0 {
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = CASE
                    WHEN runtime_recovery_required = 1 THEN 'waiting'
                    ELSE 'running'
                END,
                wait_reason = CASE
                    WHEN runtime_recovery_required = 1 THEN 'runtime_recovery'
                    ELSE NULL
                END,
                version = version + 1, updated_at = ?2
            WHERE id = ?1 AND status = 'waiting'
              AND wait_reason IN ('approval', 'action_execution', 'runtime_delivery')
            "#,
            params![agent_run_id, now],
        )?;
    }
    Ok(())
}

fn create_runtime_delivery(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    action_id: &str,
    delivery_kind: &str,
    target_execution_epoch: i64,
    payload: &Value,
) -> Result<String> {
    let payload_digest = canonical_json_digest(payload)?;
    let delivery_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        INSERT OR IGNORE INTO runtime_delivery_checkpoint(
            id, agent_run_id, action_id, delivery_kind,
            payload_digest, payload_json, target_execution_epoch,
            native_request_id, status, attempt_count, available_at,
            lease_owner, lease_expires_at, acked_at, safely_closed_at,
            last_error, version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            (SELECT native_request_id_json FROM action_execution WHERE id = ?3),
            'pending', 0, ?8,
            NULL, NULL, NULL, NULL, NULL, 1, ?8, ?8
        )
        "#,
        params![
            delivery_id,
            agent_run_id,
            action_id,
            delivery_kind,
            payload_digest,
            serde_json::to_string(payload)?,
            target_execution_epoch,
            now,
        ],
    )?;
    let persisted_id = transaction.query_row(
        r#"
        SELECT id FROM runtime_delivery_checkpoint
        WHERE action_id = ?1 AND delivery_kind = ?2 AND payload_digest = ?3
        "#,
        params![action_id, delivery_kind, payload_digest],
        |row| row.get(0),
    )?;
    Ok(persisted_id)
}

fn append_domain_event(
    transaction: &Transaction<'_>,
    event_type: &str,
    camp_id: Option<&str>,
    entity: Option<(&str, &str)>,
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
            entity.map(|value| value.0),
            entity.map(|value| value.1),
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

fn require_absolute_path(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() || !Path::new(value).is_absolute() {
        anyhow::bail!("{label} must be an absolute path");
    }
    Ok(())
}

fn is_full_git_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::configure_test_runtime,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ExecutionRequest,
            MessageAddressSpec, SendCampMessageCommand,
        },
        command::CommandResultStatus,
    };

    struct Fixture {
        database: Database,
        directory: std::path::PathBuf,
        camp_id: String,
        agent_run_id: String,
        workspace: String,
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

    fn system_envelope<P>(
        command_id: &str,
        camp_id: &str,
        component: &str,
        payload: P,
    ) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: component.to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn fixture(policy_effect: &str) -> Fixture {
        let directory = std::env::temp_dir().join(format!("lumen-action-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-camp",
                    None,
                    CreateCampCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        repository: None,
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "add-muwa",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_profile_id: "agent-muwa".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent-muwa"]);
        let turn = collaboration
            .send_camp_message(
                &mut database,
                &user_envelope(
                    "start-run",
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: "执行一个受限动作".to_string(),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "测试动作安全".to_string(),
                            expected_output: "动作结果".to_string(),
                            completion_role: "required".to_string(),
                        }),
                    },
                ),
            )
            .unwrap();
        let agent_run_id = turn.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let config_json: String = database
            .connection()
            .query_row(
                "SELECT effective_config_json FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut config: Value = serde_json::from_str(&config_json).unwrap();
        config["actionPermissionEnvelope"] = json!({
            "schemaVersion": 1,
            "rules": [{
                "id": "shell-policy",
                "actionKind": "shell_command",
                "effect": policy_effect,
            }],
        });
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET effective_config_json = ?2,
                    workspace_json = ?3,
                    status = 'running', execution_epoch = 1,
                    started_at = ?4, updated_at = ?4
                WHERE id = ?1
                "#,
                params![
                    agent_run_id,
                    serde_json::to_string(&config).unwrap(),
                    serde_json::to_string(&json!({
                        "executionRoot": workspace.to_string_lossy(),
                        "access": "write",
                        "isolation": "shared",
                        "repositoryScopeId": null,
                        "baseGitCommit": null,
                    }))
                    .unwrap(),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
        Fixture {
            database,
            directory,
            camp_id,
            agent_run_id,
            workspace: workspace.to_string_lossy().to_string(),
        }
    }

    fn prepare_envelope(
        fixture: &Fixture,
        action_id: &str,
    ) -> CommandEnvelope<PrepareActionCommand> {
        CommandEnvelope {
            command_id: format!("prepare-{action_id}"),
            actor: ActorRef::Agent {
                agent_profile_id: "agent-muwa".to_string(),
                source_agent_run_id: fixture.agent_run_id.clone(),
            },
            camp_id: Some(fixture.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(1),
            payload: PrepareActionCommand {
                action_id: action_id.to_string(),
                input: CanonicalActionInput::ShellCommand {
                    argv: vec!["cargo".to_string(), "test".to_string()],
                    cwd: fixture.workspace.clone(),
                    environment_refs: Vec::new(),
                },
                control_mode: ActionControlMode::Mediated,
                native_action_id: Some(format!("native-{action_id}")),
                runtime_request: None,
                execute_before: None,
                requested_for_user_id: "local-user".to_string(),
            },
        }
    }

    fn intercepted_prepare_envelope(
        fixture: &Fixture,
        action_id: &str,
        native_item_id: &str,
    ) -> CommandEnvelope<PrepareActionCommand> {
        CommandEnvelope {
            command_id: format!("prepare-{action_id}"),
            actor: ActorRef::Agent {
                agent_profile_id: "agent-muwa".to_string(),
                source_agent_run_id: fixture.agent_run_id.clone(),
            },
            camp_id: Some(fixture.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(1),
            payload: PrepareActionCommand {
                action_id: action_id.to_string(),
                input: CanonicalActionInput::ShellCommand {
                    argv: vec!["cargo".to_string(), "test".to_string()],
                    cwd: fixture.workspace.clone(),
                    environment_refs: Vec::new(),
                },
                control_mode: ActionControlMode::Intercepted,
                native_action_id: Some(format!("approval-{native_item_id}")),
                runtime_request: Some(RuntimeActionRequestBinding {
                    native_method: "item/commandExecution/requestApproval".to_string(),
                    native_request_id: json!(native_item_id),
                    native_item_id: native_item_id.to_string(),
                    native_thread_id: "thread-1".to_string(),
                    native_turn_id: "turn-1".to_string(),
                    response_context: json!({}),
                }),
                execute_before: None,
                requested_for_user_id: "local-user".to_string(),
            },
        }
    }

    #[test]
    fn observed_terminal_action_is_a_single_degraded_audit_fact() {
        let mut fixture = fixture("ask");
        let service = ActionSafetyService::default();
        let envelope = CommandEnvelope {
            command_id: "record-observed-action".to_string(),
            actor: ActorRef::Agent {
                agent_profile_id: "agent-muwa".to_string(),
                source_agent_run_id: fixture.agent_run_id.clone(),
            },
            camp_id: Some(fixture.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(1),
            payload: RecordObservedActionCommand {
                action_id: "action-observed".to_string(),
                native_action_id: "tool-observed".to_string(),
                native_kind: "edit".to_string(),
                observation_digest: "sha256:observation".to_string(),
                outcome: ActionResultOutcome::Succeeded,
                result_code: "acp_tool_completed".to_string(),
                result_summary: "Observed edit completed".to_string(),
                result_data: json!({"nativeItemId": "tool-observed"}),
                effect_disposition: "complete".to_string(),
            },
        };

        let recorded = service
            .record_observed_action(&mut fixture.database, &envelope)
            .expect("observed Action should persist");
        assert_eq!(recorded.result.status, CommandResultStatus::Applied);
        let row = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT control_mode, input_completeness, policy_decision,
                       status, resolution_source, attempt_count
                FROM action_execution WHERE id = 'action-observed'
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "observed".to_string(),
                "partial".to_string(),
                "observed".to_string(),
                "succeeded".to_string(),
                "runtime".to_string(),
                0,
            )
        );
        let approval_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM approval WHERE action_id = 'action-observed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(approval_count, 0);
    }

    #[test]
    fn workspace_scope_rejects_parent_traversal() {
        let directory = std::env::temp_dir().join(format!("lumen-action-scope-{}", Uuid::new_v4()));
        let workspace_root = directory.join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let workspace = json!({
            "executionRoot": workspace_root,
            "access": "write",
            "isolation": "shared",
        });
        let escaped = directory.join("workspace/../outside.txt");
        let result = validate_workspace_scope(
            &CanonicalActionInput::FileWrite {
                path: escaped.to_string_lossy().to_string(),
                operation: "create".to_string(),
                content_digest: "digest".to_string(),
            },
            Some(&workspace),
        );
        assert!(result.is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn runtime_permission_scope_rejects_symlink_escape_and_read_only_write_grant() {
        use std::os::unix::fs::symlink;

        let directory =
            std::env::temp_dir().join(format!("lumen-permission-scope-{}", Uuid::new_v4()));
        let workspace_root = directory.join("workspace");
        let outside_root = directory.join("outside");
        std::fs::create_dir_all(&workspace_root).unwrap();
        std::fs::create_dir_all(&outside_root).unwrap();
        symlink(&outside_root, workspace_root.join("escape")).unwrap();
        let read_only_workspace = json!({
            "executionRoot": workspace_root,
            "access": "read_only",
            "isolation": "shared",
        });
        let symlink_grant = CanonicalActionInput::RuntimePermissionGrant {
            cwd: read_only_workspace["executionRoot"]
                .as_str()
                .unwrap()
                .to_string(),
            permissions: json!({
                "fileSystem": {
                    "read": [workspace_root.join("escape").to_string_lossy()]
                }
            }),
            request_digest: "digest-1".to_string(),
        };
        assert!(validate_workspace_scope(&symlink_grant, Some(&read_only_workspace)).is_err());

        let write_grant = CanonicalActionInput::RuntimePermissionGrant {
            cwd: read_only_workspace["executionRoot"]
                .as_str()
                .unwrap()
                .to_string(),
            permissions: json!({
                "fileSystem": {
                    "write": [workspace_root.to_string_lossy()]
                }
            }),
            request_digest: "digest-2".to_string(),
        };
        assert!(validate_workspace_scope(&write_grant, Some(&read_only_workspace)).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn approval_authorizes_but_does_not_complete_the_action() {
        let mut fixture = fixture("ask");
        let service = ActionSafetyService::default();
        let prepare = prepare_envelope(&fixture, "action-1");
        let prepared = service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        assert_eq!(prepared.result.status, CommandResultStatus::Applied);
        assert_eq!(prepared.result.payload["status"], "prepared");
        let (approval_id, approval_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT id, version FROM approval WHERE action_id = 'action-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let approved = service
            .resolve_approval(
                &mut fixture.database,
                &user_envelope(
                    "approve-action",
                    Some(&fixture.camp_id),
                    ResolveActionApprovalCommand {
                        approval_id: approval_id.clone(),
                        decision: ApprovalDecision::Approve,
                        expected_version: approval_version,
                        reason: Some("测试批准".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(approved.result.status, CommandResultStatus::Applied);
        let (approval_status, action_status, action_version): (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT approval.status, action_execution.status, action_execution.version
                FROM approval JOIN action_execution ON action_execution.id = approval.action_id
                WHERE approval.id = ?1
                "#,
                [&approval_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(approval_status, "approved");
        assert_eq!(action_status, "prepared");

        let claimed = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-action",
                    &fixture.camp_id,
                    "action-executor",
                    ClaimActionCommand {
                        action_id: "action-1".to_string(),
                        expected_version: action_version,
                        lease_owner: "executor-1".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: None,
                        authorization_delivery_lease_owner: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(claimed.result.status, CommandResultStatus::Accepted);
        let attempt_id = claimed.result.payload["attemptId"].as_str().unwrap();
        let action_epoch = claimed.result.payload["actionExecutionEpoch"]
            .as_i64()
            .unwrap();
        service
            .mark_dispatch_started(
                &mut fixture.database,
                &system_envelope(
                    "dispatch-action",
                    &fixture.camp_id,
                    "action-executor",
                    MarkActionDispatchStartedCommand {
                        action_id: "action-1".to_string(),
                        attempt_id: attempt_id.to_string(),
                        action_execution_epoch: action_epoch,
                        lease_owner: "executor-1".to_string(),
                    },
                ),
            )
            .unwrap();
        let result = service
            .record_result(
                &mut fixture.database,
                &system_envelope(
                    "record-action",
                    &fixture.camp_id,
                    "action-executor",
                    RecordActionResultCommand {
                        action_id: "action-1".to_string(),
                        attempt_id: attempt_id.to_string(),
                        action_execution_epoch: action_epoch,
                        outcome: ActionResultOutcome::Succeeded,
                        result_code: "exit_0".to_string(),
                        result_summary: "Tests passed".to_string(),
                        result_data: json!({ "exitCode": 0 }),
                        effect_disposition: "complete".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.status, CommandResultStatus::Applied);
        let final_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM action_execution WHERE id = 'action-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(final_status, "succeeded");
        let (delivery_id, payload_digest, delivery_version): (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT id, payload_digest, version
                FROM runtime_delivery_checkpoint
                WHERE action_id = 'action-1' AND delivery_kind = 'action_result'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let acquired = service
            .acquire_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "acquire-result-delivery",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcquireRuntimeDeliveryCommand {
                        delivery_id: delivery_id.clone(),
                        expected_version: delivery_version,
                        lease_owner: "codex-reader-1".to_string(),
                        lease_seconds: 30,
                    },
                ),
            )
            .unwrap();
        assert_eq!(acquired.result.status, CommandResultStatus::Accepted);
        let acknowledged = service
            .acknowledge_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "ack-result-delivery",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcknowledgeRuntimeDeliveryCommand {
                        delivery_id,
                        payload_digest,
                        target_execution_epoch: 1,
                        lease_owner: "codex-reader-1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(acknowledged.result.status, CommandResultStatus::Applied);
        let run_state: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, wait_reason FROM agent_run WHERE id = ?1",
                [&fixture.agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(run_state, ("running".to_string(), None));
        let stale = service
            .record_result(
                &mut fixture.database,
                &system_envelope(
                    "stale-result",
                    &fixture.camp_id,
                    "action-executor",
                    RecordActionResultCommand {
                        action_id: "action-1".to_string(),
                        attempt_id: attempt_id.to_string(),
                        action_execution_epoch: action_epoch,
                        outcome: ActionResultOutcome::Failed,
                        result_code: "late_failure".to_string(),
                        result_summary: "Late callback".to_string(),
                        result_data: json!({}),
                        effect_disposition: "unknown".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale.result.status, CommandResultStatus::Rejected);
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn intercepted_action_is_claimed_only_with_the_leased_authorization_delivery() {
        let mut fixture = fixture("ask");
        let service = ActionSafetyService::default();
        let prepare = intercepted_prepare_envelope(&fixture, "action-intercepted", "item-1");
        let prepared = service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        assert_eq!(prepared.result.status, CommandResultStatus::Applied);
        let (approval_id, approval_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT id, version FROM approval WHERE action_id = 'action-intercepted'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        service
            .resolve_approval(
                &mut fixture.database,
                &user_envelope(
                    "approve-intercepted",
                    Some(&fixture.camp_id),
                    ResolveActionApprovalCommand {
                        approval_id,
                        decision: ApprovalDecision::Approve,
                        expected_version: approval_version,
                        reason: None,
                    },
                ),
            )
            .unwrap();
        let (action_version, delivery_id, delivery_version, payload_digest): (
            i64,
            String,
            i64,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT action_execution.version, runtime_delivery_checkpoint.id,
                       runtime_delivery_checkpoint.version,
                       runtime_delivery_checkpoint.payload_digest
                FROM action_execution
                JOIN runtime_delivery_checkpoint
                  ON runtime_delivery_checkpoint.action_id = action_execution.id
                WHERE action_execution.id = 'action-intercepted'
                  AND runtime_delivery_checkpoint.delivery_kind = 'authorization_resolution'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let unleased = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-without-delivery",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ClaimActionCommand {
                        action_id: "action-intercepted".to_string(),
                        expected_version: action_version,
                        lease_owner: "action-owner".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: Some(delivery_id.clone()),
                        authorization_delivery_lease_owner: Some("delivery-owner".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(unleased.result.status, CommandResultStatus::Rejected);
        let acquired = service
            .acquire_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "acquire-authorization",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcquireRuntimeDeliveryCommand {
                        delivery_id: delivery_id.clone(),
                        expected_version: delivery_version,
                        lease_owner: "delivery-owner".to_string(),
                        lease_seconds: 30,
                    },
                ),
            )
            .unwrap();
        assert_eq!(acquired.result.status, CommandResultStatus::Accepted);
        let wrong_lease = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-wrong-delivery-lease",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ClaimActionCommand {
                        action_id: "action-intercepted".to_string(),
                        expected_version: action_version,
                        lease_owner: "action-owner".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: Some(delivery_id.clone()),
                        authorization_delivery_lease_owner: Some("wrong-owner".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(wrong_lease.result.status, CommandResultStatus::Rejected);
        let claimed = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-with-authorization",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ClaimActionCommand {
                        action_id: "action-intercepted".to_string(),
                        expected_version: action_version,
                        lease_owner: "action-owner".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: Some(delivery_id.clone()),
                        authorization_delivery_lease_owner: Some("delivery-owner".to_string()),
                    },
                ),
            )
            .unwrap();
        assert_eq!(claimed.result.status, CommandResultStatus::Accepted);
        let attempt_id = claimed.result.payload["attemptId"].as_str().unwrap();
        let action_epoch = claimed.result.payload["actionExecutionEpoch"]
            .as_i64()
            .unwrap();
        let dispatched = service
            .mark_dispatch_started(
                &mut fixture.database,
                &system_envelope(
                    "mark-intercepted-dispatch",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    MarkActionDispatchStartedCommand {
                        action_id: "action-intercepted".to_string(),
                        attempt_id: attempt_id.to_string(),
                        action_execution_epoch: action_epoch,
                        lease_owner: "action-owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(dispatched.result.status, CommandResultStatus::Applied);
        let acknowledged = service
            .acknowledge_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "ack-authorization",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcknowledgeRuntimeDeliveryCommand {
                        delivery_id,
                        payload_digest,
                        target_execution_epoch: 1,
                        lease_owner: "delivery-owner".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(acknowledged.result.status, CommandResultStatus::Applied);
        service
            .record_result(
                &mut fixture.database,
                &system_envelope(
                    "record-intercepted-result",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    RecordActionResultCommand {
                        action_id: "action-intercepted".to_string(),
                        attempt_id: attempt_id.to_string(),
                        action_execution_epoch: action_epoch,
                        outcome: ActionResultOutcome::Succeeded,
                        result_code: "command_exit_0".to_string(),
                        result_summary: "Command completed successfully".to_string(),
                        result_data: json!({ "exitCode": 0 }),
                        effect_disposition: "complete".to_string(),
                    },
                ),
            )
            .unwrap();
        let action_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM action_execution WHERE id = 'action-intercepted'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(action_status, "succeeded");
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn restart_fails_closed_intercepted_approvals_and_authorization_deliveries() {
        let mut fixture = fixture("ask");
        let service = ActionSafetyService::default();
        for (action_id, item_id) in [
            ("action-awaiting-user", "item-awaiting-user"),
            ("action-awaiting-runtime", "item-awaiting-runtime"),
        ] {
            let prepare = intercepted_prepare_envelope(&fixture, action_id, item_id);
            service
                .prepare_action(&mut fixture.database, &prepare)
                .unwrap();
        }
        let (approval_id, approval_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT id, version FROM approval
                WHERE action_id = 'action-awaiting-runtime'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        service
            .resolve_approval(
                &mut fixture.database,
                &user_envelope(
                    "approve-before-restart",
                    Some(&fixture.camp_id),
                    ResolveActionApprovalCommand {
                        approval_id,
                        decision: ApprovalDecision::Approve,
                        expected_version: approval_version,
                        reason: None,
                    },
                ),
            )
            .unwrap();
        let directory = fixture.directory.clone();
        drop(fixture.database);

        let mut reopened = Database::open(&directory).unwrap();
        let recovery = reopened.prepare_v2_recovery().unwrap();
        assert_eq!(recovery.intercepted_actions_failed_closed, 2);
        assert_eq!(recovery.action_approvals_cancelled, 1);
        assert_eq!(recovery.authorization_deliveries_failed_closed, 1);
        let states = {
            let mut statement = reopened
                .connection()
                .prepare(
                    r#"
                    SELECT action_execution.id, action_execution.status,
                           action_execution.not_executed_reason, approval.status
                    FROM action_execution
                    JOIN approval ON approval.action_id = action_execution.id
                    WHERE action_execution.id IN (
                        'action-awaiting-user', 'action-awaiting-runtime'
                    )
                    ORDER BY action_execution.id
                    "#,
                )
                .unwrap();
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            states,
            vec![
                (
                    "action-awaiting-runtime".to_string(),
                    "not_executed".to_string(),
                    "runtime_request_lost".to_string(),
                    "approved".to_string(),
                ),
                (
                    "action-awaiting-user".to_string(),
                    "not_executed".to_string(),
                    "runtime_request_lost".to_string(),
                    "cancelled".to_string(),
                ),
            ]
        );
        let second = reopened.prepare_v2_recovery().unwrap();
        assert_eq!(second.intercepted_actions_failed_closed, 0);
        assert_eq!(second.action_approvals_cancelled, 0);
        assert_eq!(second.authorization_deliveries_failed_closed, 0);
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_loss_closes_an_unanswered_intercepted_request_and_preserves_recovery() {
        let mut fixture = fixture("ask");
        let service = ActionSafetyService::default();
        let prepare = intercepted_prepare_envelope(&fixture, "action-runtime-lost", "request-1");
        service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        let run_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id = ?1",
                [&fixture.agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let reconciled = service
            .reconcile_runtime_loss(
                &mut fixture.database,
                &system_envelope(
                    "reconcile-runtime-loss",
                    &fixture.camp_id,
                    "runtime-recovery-coordinator",
                    ReconcileRuntimeLossCommand {
                        agent_run_id: fixture.agent_run_id.clone(),
                        expected_version: run_version,
                        execution_epoch: 1,
                        reason: "host_exited".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(reconciled.result.status, CommandResultStatus::Applied);
        let state: (String, String, String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT action_execution.status, action_execution.not_executed_reason,
                       approval.status, agent_run.wait_reason,
                       agent_run.runtime_recovery_required
                FROM action_execution
                JOIN approval ON approval.action_id = action_execution.id
                JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                WHERE action_execution.id = 'action-runtime-lost'
                "#,
                [],
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
        assert_eq!(
            state,
            (
                "not_executed".to_string(),
                "runtime_request_lost".to_string(),
                "cancelled".to_string(),
                "runtime_recovery".to_string(),
                1,
            )
        );
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn runtime_loss_marks_a_dispatched_intercepted_action_unknown() {
        let mut fixture = fixture("allow");
        let service = ActionSafetyService::default();
        let prepare = intercepted_prepare_envelope(&fixture, "action-runtime-unknown", "request-2");
        service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        let (action_version, delivery_id, delivery_version): (i64, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT action_execution.version, runtime_delivery_checkpoint.id,
                       runtime_delivery_checkpoint.version
                FROM action_execution
                JOIN runtime_delivery_checkpoint
                  ON runtime_delivery_checkpoint.action_id = action_execution.id
                WHERE action_execution.id = 'action-runtime-unknown'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        service
            .acquire_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "acquire-runtime-unknown",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcquireRuntimeDeliveryCommand {
                        delivery_id: delivery_id.clone(),
                        expected_version: delivery_version,
                        lease_owner: "delivery-owner".to_string(),
                        lease_seconds: 30,
                    },
                ),
            )
            .unwrap();
        let claimed = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-runtime-unknown",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ClaimActionCommand {
                        action_id: "action-runtime-unknown".to_string(),
                        expected_version: action_version,
                        lease_owner: "action-owner".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: Some(delivery_id),
                        authorization_delivery_lease_owner: Some("delivery-owner".to_string()),
                    },
                ),
            )
            .unwrap();
        let attempt_id = claimed.result.payload["attemptId"]
            .as_str()
            .unwrap()
            .to_string();
        let action_execution_epoch = claimed.result.payload["actionExecutionEpoch"]
            .as_i64()
            .unwrap();
        service
            .mark_dispatch_started(
                &mut fixture.database,
                &system_envelope(
                    "dispatch-runtime-unknown",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    MarkActionDispatchStartedCommand {
                        action_id: "action-runtime-unknown".to_string(),
                        attempt_id,
                        action_execution_epoch,
                        lease_owner: "action-owner".to_string(),
                    },
                ),
            )
            .unwrap();
        let run_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id = ?1",
                [&fixture.agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        service
            .reconcile_runtime_loss(
                &mut fixture.database,
                &system_envelope(
                    "reconcile-runtime-unknown",
                    &fixture.camp_id,
                    "runtime-recovery-coordinator",
                    ReconcileRuntimeLossCommand {
                        agent_run_id: fixture.agent_run_id.clone(),
                        expected_version: run_version,
                        execution_epoch: 1,
                        reason: "host_exited".to_string(),
                    },
                ),
            )
            .unwrap();
        let state: (String, String, String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT action_execution.status, action_attempt.outcome,
                       runtime_delivery_checkpoint.status, agent_run.wait_reason,
                       agent_run.runtime_recovery_required
                FROM action_execution
                JOIN action_attempt ON action_attempt.action_id = action_execution.id
                JOIN runtime_delivery_checkpoint
                  ON runtime_delivery_checkpoint.action_id = action_execution.id
                JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                WHERE action_execution.id = 'action-runtime-unknown'
                "#,
                [],
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
        assert_eq!(
            state,
            (
                "unknown".to_string(),
                "unknown".to_string(),
                "safely_closed".to_string(),
                "unknown_action_outcome".to_string(),
                1,
            )
        );
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn native_request_resolution_is_the_exact_authorization_delivery_ack() {
        let mut fixture = fixture("allow");
        let service = ActionSafetyService::default();
        let prepare =
            intercepted_prepare_envelope(&fixture, "action-request-resolved", "request-resolved");
        service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        let (action_version, delivery_id, delivery_version): (i64, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT action_execution.version, runtime_delivery_checkpoint.id,
                       runtime_delivery_checkpoint.version
                FROM action_execution
                JOIN runtime_delivery_checkpoint
                  ON runtime_delivery_checkpoint.action_id = action_execution.id
                WHERE action_execution.id = 'action-request-resolved'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        service
            .acquire_runtime_delivery(
                &mut fixture.database,
                &system_envelope(
                    "acquire-request-resolved",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    AcquireRuntimeDeliveryCommand {
                        delivery_id: delivery_id.clone(),
                        expected_version: delivery_version,
                        lease_owner: "delivery-owner".to_string(),
                        lease_seconds: 30,
                    },
                ),
            )
            .unwrap();
        let claimed = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-request-resolved",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ClaimActionCommand {
                        action_id: "action-request-resolved".to_string(),
                        expected_version: action_version,
                        lease_owner: "action-owner".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: Some(delivery_id),
                        authorization_delivery_lease_owner: Some("delivery-owner".to_string()),
                    },
                ),
            )
            .unwrap();
        service
            .mark_dispatch_started(
                &mut fixture.database,
                &system_envelope(
                    "dispatch-request-resolved",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    MarkActionDispatchStartedCommand {
                        action_id: "action-request-resolved".to_string(),
                        attempt_id: claimed.result.payload["attemptId"]
                            .as_str()
                            .unwrap()
                            .to_string(),
                        action_execution_epoch: claimed.result.payload["actionExecutionEpoch"]
                            .as_i64()
                            .unwrap(),
                        lease_owner: "action-owner".to_string(),
                    },
                ),
            )
            .unwrap();
        let confirmed = service
            .confirm_runtime_request_resolved(
                &mut fixture.database,
                &system_envelope(
                    "confirm-request-resolved",
                    &fixture.camp_id,
                    "runtime-adapter:codex",
                    ConfirmRuntimeRequestResolvedCommand {
                        agent_run_id: fixture.agent_run_id.clone(),
                        execution_epoch: 1,
                        native_thread_id: "thread-1".to_string(),
                        native_request_id: json!("request-resolved"),
                    },
                ),
            )
            .unwrap();
        assert_eq!(confirmed.result.status, CommandResultStatus::Applied);
        let state: (String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT runtime_delivery_checkpoint.status, agent_run.status
                FROM runtime_delivery_checkpoint
                JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
                WHERE runtime_delivery_checkpoint.action_id = 'action-request-resolved'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, ("acked".to_string(), "running".to_string()));
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn deny_policy_records_not_executed_without_creating_approval() {
        let mut fixture = fixture("deny");
        let service = ActionSafetyService::default();
        let prepare = prepare_envelope(&fixture, "action-denied");
        let result = service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        assert_eq!(result.result.payload["status"], "not_executed");
        let approvals: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM approval WHERE action_id = 'action-denied'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(approvals, 0);
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn unknown_action_is_not_replayed_and_only_reconciler_can_settle_it() {
        let mut fixture = fixture("allow");
        let service = ActionSafetyService::default();
        let prepare = prepare_envelope(&fixture, "action-unknown");
        service
            .prepare_action(&mut fixture.database, &prepare)
            .unwrap();
        let claimed = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "claim-unknown-action",
                    &fixture.camp_id,
                    "action-executor",
                    ClaimActionCommand {
                        action_id: "action-unknown".to_string(),
                        expected_version: 1,
                        lease_owner: "executor-unknown".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: None,
                        authorization_delivery_lease_owner: None,
                    },
                ),
            )
            .unwrap();
        let attempt_id = claimed.result.payload["attemptId"]
            .as_str()
            .unwrap()
            .to_string();
        let action_epoch = claimed.result.payload["actionExecutionEpoch"]
            .as_i64()
            .unwrap();
        service
            .mark_dispatch_started(
                &mut fixture.database,
                &system_envelope(
                    "dispatch-unknown-action",
                    &fixture.camp_id,
                    "action-executor",
                    MarkActionDispatchStartedCommand {
                        action_id: "action-unknown".to_string(),
                        attempt_id: attempt_id.clone(),
                        action_execution_epoch: action_epoch,
                        lease_owner: "executor-unknown".to_string(),
                    },
                ),
            )
            .unwrap();
        service
            .record_result(
                &mut fixture.database,
                &system_envelope(
                    "record-unknown-action",
                    &fixture.camp_id,
                    "action-executor",
                    RecordActionResultCommand {
                        action_id: "action-unknown".to_string(),
                        attempt_id: attempt_id.clone(),
                        action_execution_epoch: action_epoch,
                        outcome: ActionResultOutcome::Unknown,
                        result_code: "connection_lost".to_string(),
                        result_summary: "Dispatch may have completed".to_string(),
                        result_data: json!({}),
                        effect_disposition: "unknown".to_string(),
                    },
                ),
            )
            .unwrap();
        let version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM action_execution WHERE id = 'action-unknown' AND status = 'unknown'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let replay_attempt = service
            .claim_action(
                &mut fixture.database,
                &system_envelope(
                    "replay-unknown-action",
                    &fixture.camp_id,
                    "action-executor",
                    ClaimActionCommand {
                        action_id: "action-unknown".to_string(),
                        expected_version: version,
                        lease_owner: "executor-replay".to_string(),
                        lease_seconds: 30,
                        authorization_delivery_id: None,
                        authorization_delivery_lease_owner: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(replay_attempt.result.status, CommandResultStatus::Rejected);
        let reconciled = service
            .record_result(
                &mut fixture.database,
                &system_envelope(
                    "reconcile-unknown-action",
                    &fixture.camp_id,
                    "action-reconciler",
                    RecordActionResultCommand {
                        action_id: "action-unknown".to_string(),
                        attempt_id,
                        action_execution_epoch: action_epoch,
                        outcome: ActionResultOutcome::Succeeded,
                        result_code: "verified_complete".to_string(),
                        result_summary: "External state confirms completion".to_string(),
                        result_data: json!({ "verified": true }),
                        effect_disposition: "complete".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(reconciled.result.status, CommandResultStatus::Applied);
        assert_eq!(reconciled.result.payload["status"], "succeeded");
        drop(fixture.database);
        std::fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn restart_distinguishes_not_dispatched_from_unknown_effects() {
        let mut fixture = fixture("allow");
        let service = ActionSafetyService::default();
        for action_id in ["action-before-dispatch", "action-after-dispatch"] {
            let prepare = prepare_envelope(&fixture, action_id);
            service
                .prepare_action(&mut fixture.database, &prepare)
                .unwrap();
            let claimed = service
                .claim_action(
                    &mut fixture.database,
                    &system_envelope(
                        &format!("claim-{action_id}"),
                        &fixture.camp_id,
                        "action-executor",
                        ClaimActionCommand {
                            action_id: action_id.to_string(),
                            expected_version: 1,
                            lease_owner: format!("executor-{action_id}"),
                            lease_seconds: 300,
                            authorization_delivery_id: None,
                            authorization_delivery_lease_owner: None,
                        },
                    ),
                )
                .unwrap();
            if action_id == "action-after-dispatch" {
                service
                    .mark_dispatch_started(
                        &mut fixture.database,
                        &system_envelope(
                            "mark-after-dispatch",
                            &fixture.camp_id,
                            "action-executor",
                            MarkActionDispatchStartedCommand {
                                action_id: action_id.to_string(),
                                attempt_id: claimed.result.payload["attemptId"]
                                    .as_str()
                                    .unwrap()
                                    .to_string(),
                                action_execution_epoch:
                                    claimed.result.payload["actionExecutionEpoch"]
                                        .as_i64()
                                        .unwrap(),
                                lease_owner: format!("executor-{action_id}"),
                            },
                        ),
                    )
                    .unwrap();
            }
        }
        let directory = fixture.directory.clone();
        let run_id = fixture.agent_run_id.clone();
        drop(fixture.database);

        let mut reopened = Database::open(&directory).unwrap();
        let recovery = reopened.prepare_v2_recovery().unwrap();
        assert_eq!(recovery.actions_returned_to_prepared, 1);
        assert_eq!(recovery.actions_marked_unknown, 1);
        let states = {
            let mut statement = reopened
                .connection()
                .prepare("SELECT id, status FROM action_execution ORDER BY id")
                .unwrap();
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            states,
            vec![
                ("action-after-dispatch".to_string(), "unknown".to_string()),
                ("action-before-dispatch".to_string(), "prepared".to_string()),
            ]
        );
        let run_state: (String, String) = reopened
            .connection()
            .query_row(
                "SELECT status, wait_reason FROM agent_run WHERE id = ?1",
                [&run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            run_state,
            ("waiting".to_string(), "unknown_action_outcome".to_string())
        );
        let second_recovery = reopened.prepare_v2_recovery().unwrap();
        assert_eq!(second_recovery.actions_marked_unknown, 0);
        assert_eq!(second_recovery.actions_returned_to_prepared, 0);
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
