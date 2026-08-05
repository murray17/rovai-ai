use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{db::Database, managed_blob::ManagedBlobStore};

const INLINE_PAYLOAD_LIMIT_BYTES: usize = 16 * 1024;
const PREVIEW_STRING_LIMIT_CHARS: usize = 4_000;
const PREVIEW_ARRAY_LIMIT: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExecutionEvidence {
    pub id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub sequence: i64,
    pub event_type: String,
    pub kind: String,
    pub phase: String,
    pub payload: Value,
    pub content_blob_id: Option<String>,
    pub content_byte_count: i64,
    pub is_truncated: bool,
    pub occurred_at: String,
}

#[derive(Debug, Default)]
pub struct ExecutionEvidenceService;

impl ExecutionEvidenceService {
    pub fn is_runtime_evidence_event(event_type: &str) -> bool {
        matches!(
            event_type,
            "agent.reasoning.summary.delta"
                | "agent.thought.delta"
                | "agent.text.delta"
                | "runtime.plan"
                | "runtime.plan.delta"
                | "command.output.delta"
                | "file.change.updated"
                | "runtime.action"
                | "activity.started"
                | "activity.completed"
        )
    }

    pub fn record_runtime_event(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        payload: &Value,
    ) -> Result<Option<AgentRunExecutionEvidence>> {
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            payload,
            false,
        )
    }

    pub fn record_team_tool_result(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
    ) -> Result<Option<AgentRunExecutionEvidence>> {
        if !payload
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| matches!(status, "completed" | "failed"))
        {
            anyhow::bail!("Team Tool result evidence must be terminal");
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "runtime.action",
            payload,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_runtime_event_with_fence_policy(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        payload: &Value,
        allow_fenced_terminal_tool_result: bool,
    ) -> Result<Option<AgentRunExecutionEvidence>> {
        let Some((kind, phase)) = evidence_classification(event_type, payload) else {
            return Ok(None);
        };
        let current = database
            .connection()
            .query_row(
                r#"
                SELECT status, execution_epoch, cancel_requested_at
                FROM agent_run
                WHERE id = ?1
                "#,
                [agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((status, current_epoch, cancel_requested_at)) = current else {
            return Ok(None);
        };
        if current_epoch != execution_epoch
            || (!allow_fenced_terminal_tool_result && cancel_requested_at.is_some())
            || (!matches!(status.as_str(), "running" | "waiting")
                && !(allow_fenced_terminal_tool_result
                    && matches!(status.as_str(), "succeeded" | "failed" | "cancelled")))
        {
            return Ok(None);
        }

        let source_event_key = source_event_key(event_type, payload);
        let payload = normalize_public_payload(event_type, payload);
        let encoded = serde_json::to_vec(&payload)?;
        let (preview, content_blob_id, is_truncated) = if encoded.len() > INLINE_PAYLOAD_LIMIT_BYTES
        {
            let blob = blob_store.put_bytes(database, &encoded, "application/json", "normal")?;
            (bounded_preview(&payload), Some(blob.id), true)
        } else {
            (payload, None, false)
        };
        let preview_json = serde_json::to_string(&preview)?;
        let occurred_at = chrono::Utc::now().to_rfc3339();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        if let Some(source_event_key) = source_event_key.as_deref()
            && let Some(existing) =
                load_by_source_key(&transaction, agent_run_id, source_event_key)?
        {
            transaction.commit()?;
            return Ok(Some(existing));
        }

        let still_current: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run
                WHERE id = ?1
                  AND execution_epoch = ?2
                  AND (
                    (status IN ('running', 'waiting')
                     AND (?3 = 1 OR cancel_requested_at IS NULL))
                    OR (?3 = 1 AND status IN ('succeeded', 'failed', 'cancelled'))
                  )
            )
            "#,
            params![
                agent_run_id,
                execution_epoch,
                i64::from(allow_fenced_terminal_tool_result)
            ],
            |row| row.get(0),
        )?;
        if !still_current {
            transaction.commit()?;
            return Ok(None);
        }

        let sequence: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(sequence), 0) + 1
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| row.get(0),
        )?;
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO agent_run_execution_evidence(
                id, agent_run_id, execution_epoch, sequence,
                event_type, kind, phase, source_event_key,
                payload_preview_json, content_blob_id,
                content_byte_count, is_truncated, occurred_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13
            )
            "#,
            params![
                id,
                agent_run_id,
                execution_epoch,
                sequence,
                event_type,
                kind,
                phase,
                source_event_key,
                preview_json,
                content_blob_id,
                encoded.len() as i64,
                i64::from(is_truncated),
                occurred_at,
            ],
        )?;
        transaction.commit()?;
        Ok(Some(AgentRunExecutionEvidence {
            id,
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
            sequence,
            event_type: event_type.to_string(),
            kind: kind.to_string(),
            phase: phase.to_string(),
            payload: preview,
            content_blob_id,
            content_byte_count: encoded.len() as i64,
            is_truncated,
            occurred_at,
        }))
    }

    pub fn read_full_payload(
        &self,
        database: &Database,
        blob_store: &ManagedBlobStore,
        camp_id: &str,
        evidence_id: &str,
    ) -> Result<Value> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT evidence.payload_preview_json, evidence.content_blob_id
                FROM agent_run_execution_evidence AS evidence
                JOIN agent_run ON agent_run.id = evidence.agent_run_id
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE evidence.id = ?1 AND camp_turn.camp_id = ?2
                "#,
                params![evidence_id, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .context("Execution Evidence does not exist in this Camp")?;
        let bytes = match row.1 {
            Some(blob_id) => blob_store.read_bytes(database, &blob_id)?,
            None => row.0.into_bytes(),
        };
        serde_json::from_slice(&bytes).context("Execution Evidence payload is not valid JSON")
    }
}

fn evidence_classification(
    event_type: &str,
    payload: &Value,
) -> Option<(&'static str, &'static str)> {
    match event_type {
        "agent.reasoning.summary.delta" | "agent.thought.delta" => {
            Some(("reasoning_summary", "updated"))
        }
        "agent.text.delta" => Some(("narration", "updated")),
        "runtime.plan" | "runtime.plan.delta" => Some(("plan", "updated")),
        "command.output.delta" => Some(("command", "updated")),
        "file.change.updated" => Some(("file_change", "updated")),
        "runtime.action" => Some((
            if payload
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| matches!(status, "completed" | "failed"))
            {
                "tool_result"
            } else {
                "tool_call"
            },
            phase_from_payload(payload),
        )),
        "activity.started" => Some((activity_kind(payload), "started")),
        "activity.completed" => Some((activity_kind(payload), "completed")),
        _ => None,
    }
}

fn normalize_public_payload(event_type: &str, payload: &Value) -> Value {
    match event_type {
        "agent.reasoning.summary.delta" | "agent.thought.delta" => serde_json::json!({
            "itemId": payload.get("itemId").or_else(|| payload.get("toolCallId")),
            "delta": payload
                .get("delta")
                .and_then(Value::as_str)
                .or_else(|| payload.pointer("/content/text").and_then(Value::as_str))
                .or_else(|| payload.get("text").and_then(Value::as_str))
                .unwrap_or(""),
        }),
        "agent.text.delta" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "delta": payload.get("delta").and_then(Value::as_str).unwrap_or(""),
        }),
        "runtime.plan.delta" => serde_json::json!({
            "delta": payload.get("delta").and_then(Value::as_str).unwrap_or(""),
        }),
        "runtime.plan" => serde_json::json!({
            "explanation": payload.get("explanation"),
            "plan": payload.get("plan"),
        }),
        "command.output.delta" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "delta": payload.get("delta").or_else(|| payload.get("output")),
        }),
        "file.change.updated" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "patch": payload.get("patch").or_else(|| payload.get("delta")),
        }),
        "runtime.action" => serde_json::json!({
            "toolCallId": payload.get("toolCallId"),
            "status": payload.get("status"),
            "kind": payload.get("kind"),
            "title": payload.get("title"),
            "sourceAuthority": payload.get("sourceAuthority"),
            "canonicalTool": payload.get("canonicalTool"),
            "authorizationDecision": payload.get("authorizationDecision"),
            "locationCount": payload.get("locationCount"),
            "input": payload.get("input"),
            "output": payload.get("output"),
            "rawInputDigest": payload.get("rawInputDigest"),
            "rawOutputDigest": payload.get("rawOutputDigest"),
            "errorCode": payload.get("errorCode"),
            "idempotentReplay": payload.get("idempotentReplay"),
            "receiptId": payload.get("receiptId"),
        }),
        "activity.started" | "activity.completed" => {
            let item = payload.get("item").unwrap_or(&Value::Null);
            serde_json::json!({
                "item": {
                    "id": item.get("id"),
                    "type": item.get("type"),
                    "status": item.get("status"),
                    "title": item.get("title"),
                    "command": item.get("command"),
                    "cwd": item.get("cwd"),
                    "durationMs": item.get("durationMs"),
                    "exitCode": item.get("exitCode"),
                    "aggregatedOutput": item.get("aggregatedOutput"),
                    "output": item.get("output").or_else(|| item.get("result")),
                    "summary": item.get("summary"),
                    "changes": item.get("changes"),
                    "tool": item.get("tool"),
                    "server": item.get("server"),
                    "error": item.get("error"),
                }
            })
        }
        _ => Value::Null,
    }
}

fn phase_from_payload(payload: &Value) -> &'static str {
    match payload.get("status").and_then(Value::as_str) {
        Some("completed" | "succeeded") => "completed",
        Some("failed" | "declined" | "cancelled") => "failed",
        Some("inProgress" | "running" | "pending") => "updated",
        _ => "updated",
    }
}

fn activity_kind(payload: &Value) -> &'static str {
    match payload
        .pointer("/item/type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "commandExecution" => "command",
        "fileChange" => "file_change",
        "reasoning" => "reasoning_summary",
        "plan" => "plan",
        "agentMessage" | "userMessage" => "narration",
        "mcpToolCall"
        | "dynamicToolCall"
        | "webSearch"
        | "imageGeneration"
        | "collabToolCall"
        | "collabAgentToolCall" => "tool_call",
        _ => "runtime_activity",
    }
}

fn source_event_key(event_type: &str, payload: &Value) -> Option<String> {
    if event_type.ends_with(".delta") || event_type == "file.change.updated" {
        return None;
    }
    let identity = payload
        .get("eventId")
        .or_else(|| payload.get("toolCallId"))
        .or_else(|| payload.pointer("/item/id"))
        .and_then(Value::as_str)?;
    if event_type == "runtime.action"
        && payload.get("idempotentReplay").and_then(Value::as_bool) == Some(true)
    {
        // A replay is not a second logical Tool call or effect, but every observed
        // invocation attempt remains distinct diagnostic evidence.
        return None;
    }
    let replay_observation = if event_type == "runtime.action" {
        match payload.get("idempotentReplay").and_then(Value::as_bool) {
            Some(false) => ":original",
            Some(true) | None => "",
        }
    } else {
        ""
    };
    Some(format!(
        "{event_type}:{identity}:{}{replay_observation}",
        phase_from_payload(payload)
    ))
}

fn bounded_preview(value: &Value) -> Value {
    match value {
        Value::String(value) => Value::String(truncate_chars(value, PREVIEW_STRING_LIMIT_CHARS)),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(PREVIEW_ARRAY_LIMIT)
                .map(bounded_preview)
                .collect(),
        ),
        Value::Object(values) => {
            let mut preview = Map::new();
            for (key, value) in values.iter().take(PREVIEW_ARRAY_LIMIT) {
                preview.insert(key.clone(), bounded_preview(value));
            }
            preview.insert("_rovaiTruncated".to_string(), Value::Bool(true));
            Value::Object(preview)
        }
        value => value.clone(),
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n…（内容已截断，可按需读取完整证据）");
    truncated
}

fn load_by_source_key(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
    source_event_key: &str,
) -> Result<Option<AgentRunExecutionEvidence>> {
    transaction
        .query_row(
            r#"
            SELECT id, agent_run_id, execution_epoch, sequence,
                   event_type, kind, phase, payload_preview_json,
                   content_blob_id, content_byte_count, is_truncated, occurred_at
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1 AND source_event_key = ?2
            "#,
            params![agent_run_id, source_event_key],
            |row| {
                let payload: String = row.get(7)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    payload,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)? != 0,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                id,
                agent_run_id,
                execution_epoch,
                sequence,
                event_type,
                kind,
                phase,
                payload,
                content_blob_id,
                content_byte_count,
                is_truncated,
                occurred_at,
            )| {
                Ok(AgentRunExecutionEvidence {
                    id,
                    agent_run_id,
                    execution_epoch,
                    sequence,
                    event_type,
                    kind,
                    phase,
                    payload: serde_json::from_str(&payload)?,
                    content_blob_id,
                    content_byte_count,
                    is_truncated,
                    occurred_at,
                })
            },
        )
        .transpose()
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
        command::{ActorRef, CommandEnvelope},
        context::{
            CharterDeliveryMode, ContextMaterialization, ContextService,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, MaterializeContextRequest,
        },
        runtime::{
            AgentRunWorkspace, CancelCampTurnCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
        },
        team_tool::TeamToolService,
    };
    use serde_json::json;

    #[test]
    fn provider_packets_are_reduced_to_public_evidence_fields() {
        let normalized = normalize_public_payload(
            "activity.completed",
            &json!({
                "threadId": "internal-thread",
                "hiddenProviderPacket": "must-not-persist",
                "item": {
                    "id": "command-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "command": "pnpm test",
                    "aggregatedOutput": "99 tests passed",
                    "providerPrivateState": "must-not-persist"
                }
            }),
        );
        let encoded = serde_json::to_string(&normalized).unwrap();
        assert!(encoded.contains("pnpm test"));
        assert!(encoded.contains("99 tests passed"));
        assert!(!encoded.contains("hiddenProviderPacket"));
        assert!(!encoded.contains("providerPrivateState"));
        assert!(!encoded.contains("internal-thread"));
    }

    #[test]
    fn ordinary_messages_and_unknown_activities_are_not_classified_as_tool_calls() {
        assert_eq!(
            activity_kind(&json!({"item": {"type": "agentMessage"}})),
            "narration"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "userMessage"}})),
            "narration"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "providerPrivateActivity"}})),
            "runtime_activity"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "mcpToolCall"}})),
            "tool_call"
        );
    }

    #[test]
    fn team_tool_results_keep_authoritative_ledger_fields_without_private_packets() {
        let normalized = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "tool-call-digest",
                "status": "failed",
                "kind": "mcp_tool_call",
                "title": "team.call_member",
                "sourceAuthority": "core",
                "canonicalTool": "team.call_member",
                "authorizationDecision": "indeterminate",
                "rawInputDigest": "input-digest",
                "rawOutputDigest": null,
                "errorCode": "team_tool.execution_budget_exhausted",
                "idempotentReplay": true,
                "receiptId": "receipt-1",
                "bindingCredential": "must-not-persist",
                "rawInput": { "content": "must-not-persist" }
            }),
        );
        assert_eq!(
            normalized["errorCode"],
            "team_tool.execution_budget_exhausted"
        );
        assert_eq!(normalized["idempotentReplay"], true);
        assert_eq!(normalized["receiptId"], "receipt-1");
        assert_eq!(normalized["sourceAuthority"], "core");
        assert_eq!(normalized["canonicalTool"], "team.call_member");
        let encoded = serde_json::to_string(&normalized).unwrap();
        assert!(!encoded.contains("bindingCredential"));
        assert!(!encoded.contains("must-not-persist"));
    }

    #[test]
    fn evidence_is_durable_blob_backed_agent_inaccessible_and_cancel_fenced() {
        let directory =
            std::env::temp_dir().join(format!("rovai-execution-evidence-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let capabilities_json: String = database
            .connection()
            .query_row(
                "SELECT capabilities_json FROM adapter_capability_snapshot WHERE installation_id = 'adapter-test-codex'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut capabilities: Vec<String> = serde_json::from_str(&capabilities_json).unwrap();
        capabilities.push("team_tool.call_member".to_string());
        database
            .connection()
            .execute(
                "UPDATE adapter_capability_snapshot SET capabilities_json = ?1 WHERE installation_id = 'adapter-test-codex'",
                [serde_json::to_string(&capabilities).unwrap()],
            )
            .unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampCommand::for_test(workspace.display().to_string()),
                },
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_profile_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                },
            )
            .unwrap();
        let sent = collaboration
            .send_camp_message(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "Run with private execution evidence".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: MessageAddressSpec::Explicit {
                            agent_profile_ids: vec!["agent_2".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "Verify evidence boundaries".to_string(),
                            expected_output: "Finish without exposing evidence".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                },
            )
            .unwrap();
        let run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let camp_turn_id = sent.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        let runtime = ExecutionRuntimeService::default();
        let candidate = runtime
            .list_dispatchable_agent_runs(&database, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == run_id)
            .unwrap();
        let claim = runtime
            .claim_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: run_id.clone(),
                        expected_version: candidate.version,
                        lease_owner: "test-scheduler".to_string(),
                        lease_seconds: 60,
                        workspace: Some(AgentRunWorkspace::runtime_managed_path(
                            workspace.display().to_string(),
                        )),
                        starting_git_observation: None,
                    },
                },
            )
            .unwrap();
        let execution_epoch = claim.result.payload["executionEpoch"].as_i64().unwrap();
        TeamToolService::default()
            .prepare_binding_credential(&mut database, &run_id, execution_epoch, false)
            .unwrap();
        let blob_store = ManagedBlobStore::new(&directory);
        let secret = format!("EVIDENCE_ONLY_{}", "x".repeat(20_000));
        let evidence = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "command.output.delta",
                &json!({ "itemId": "command-1", "delta": secret }),
            )
            .unwrap()
            .unwrap();
        assert!(evidence.is_truncated);
        assert!(evidence.content_blob_id.is_some());
        assert_eq!(evidence.sequence, 1);

        let materialized = ContextService
            .materialize(
                &mut database,
                &blob_store,
                &MaterializeContextRequest {
                    agent_run_id: &run_id,
                    execution_epoch,
                    charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap();
        let ContextMaterialization::Ready(context) = materialized else {
            panic!("small Camp context should materialize");
        };
        assert!(!context.rendered_payload.contains("EVIDENCE_ONLY_"));

        let turn_version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM camp_turn WHERE id = ?1",
                [&camp_turn_id],
                |row| row.get(0),
            )
            .unwrap();
        runtime
            .request_camp_turn_cancellation(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CancelCampTurnCommand {
                        camp_id,
                        camp_turn_id,
                        expected_version: turn_version,
                    },
                },
            )
            .unwrap();
        let late = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "agent.thought.delta",
                &json!({ "delta": "must be fenced" }),
            )
            .unwrap();
        assert!(late.is_none());

        let failed_tool_result = json!({
            "toolCallId": "team-tool-call-1",
            "status": "failed",
            "kind": "mcp_tool_call",
            "title": "team.call_member",
            "rawInputDigest": "input-digest",
            "rawOutputDigest": null,
            "errorCode": "team_tool.execution_budget_exhausted",
            "idempotentReplay": false,
            "receiptId": null,
        });
        let failed = ExecutionEvidenceService
            .record_team_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &failed_tool_result,
            )
            .unwrap()
            .expect("terminal Team Tool result must survive the Turn fence");
        assert_eq!(failed.sequence, 2);
        assert_eq!(
            failed.payload["errorCode"],
            "team_tool.execution_budget_exhausted"
        );

        let duplicate = ExecutionEvidenceService
            .record_team_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &failed_tool_result,
            )
            .unwrap()
            .unwrap();
        assert_eq!(duplicate.id, failed.id);

        let mut replay_tool_result = failed_tool_result.clone();
        replay_tool_result["idempotentReplay"] = json!(true);
        let replay = ExecutionEvidenceService
            .record_team_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &replay_tool_result,
            )
            .unwrap()
            .expect("the first replay observation must remain visible");
        assert_eq!(replay.sequence, 3);
        assert_eq!(replay.payload["idempotentReplay"], true);

        let replay_duplicate = ExecutionEvidenceService
            .record_team_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &replay_tool_result,
            )
            .unwrap()
            .unwrap();
        assert_ne!(replay_duplicate.id, replay.id);
        assert_eq!(replay_duplicate.sequence, 4);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
