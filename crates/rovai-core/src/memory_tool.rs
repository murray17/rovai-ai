use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    command::{ActorRef, CommandEnvelope, CommandExecution},
    db::Database,
    memory::{AgentMemoryWriteCommand, MemoryService},
    team_tool::{TeamToolInvocationError, TeamToolService},
};

pub const MEMORY_WRITE_TOOL_NAME: &str = "memory.write";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryWriteToolInput {
    pub action: String,
    pub scope: Option<crate::memory::MemoryScopeKind>,
    pub kind: Option<crate::memory::MemoryKind>,
    pub body: String,
    pub retrieval_keys: Vec<String>,
    pub counterparty_agent_id: Option<String>,
    pub direction: Option<crate::memory::RelationshipDirection>,
    pub memory_id: Option<String>,
    pub base_revision_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MemoryWriteToolInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: MemoryWriteToolInput,
}

#[derive(Debug, Default)]
pub struct MemoryToolService;

impl MemoryToolService {
    pub fn write_input_schema() -> Value {
        let body = json!({
            "type": "string",
            "minLength": 1,
            "maxLength": 2048,
            "description": "One atomic durable preference, agreement, or reusable lesson. Never include credentials or task state."
        });
        let retrieval_keys = json!({
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "uniqueItems": true,
            "items": {"type": "string", "minLength": 2, "maxLength": 24},
            "description": "The complete set of one to three specific discovery keys."
        });
        json!({
            "oneOf": [
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["action", "scope", "kind", "body", "retrievalKeys"],
                    "properties": {
                        "action": {"const": "add"},
                        "scope": {"const": "companion"},
                        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
                        "body": body.clone(),
                        "retrievalKeys": retrieval_keys.clone()
                    }
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "action", "scope", "kind", "body", "retrievalKeys",
                        "counterpartyAgentId", "direction"
                    ],
                    "properties": {
                        "action": {"const": "add"},
                        "scope": {"const": "relationship"},
                        "kind": {"type": "string", "enum": ["agreement", "lesson"]},
                        "body": body.clone(),
                        "retrievalKeys": retrieval_keys.clone(),
                        "counterpartyAgentId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Another present member of the current Camp."
                        },
                        "direction": {
                            "const": "directed",
                            "description": "Always current Agent to counterparty."
                        }
                    }
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["action", "scope", "kind", "body", "retrievalKeys"],
                    "properties": {
                        "action": {"const": "add"},
                        "scope": {"const": "hearth"},
                        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
                        "body": body.clone(),
                        "retrievalKeys": retrieval_keys.clone()
                    }
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "action", "scope", "memoryId", "baseRevisionId", "body", "retrievalKeys"
                    ],
                    "properties": {
                        "action": {"const": "revise"},
                        "scope": {
                            "const": "companion",
                            "description": "Immutable target identity copied from memory.read."
                        },
                        "memoryId": {"type": "string", "minLength": 1},
                        "baseRevisionId": {"type": "string", "minLength": 1},
                        "body": body.clone(),
                        "retrievalKeys": retrieval_keys.clone()
                    }
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "action", "scope", "memoryId", "baseRevisionId", "body", "retrievalKeys",
                        "counterpartyAgentId", "direction"
                    ],
                    "properties": {
                        "action": {"const": "revise"},
                        "scope": {
                            "const": "relationship",
                            "description": "Immutable target identity copied from memory.read."
                        },
                        "memoryId": {"type": "string", "minLength": 1},
                        "baseRevisionId": {"type": "string", "minLength": 1},
                        "body": body.clone(),
                        "retrievalKeys": retrieval_keys.clone(),
                        "counterpartyAgentId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Exact immutable counterparty identity copied from memory.read."
                        },
                        "direction": {
                            "const": "directed",
                            "description": "Exact immutable direction copied from memory.read."
                        }
                    }
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "action", "scope", "memoryId", "baseRevisionId", "body", "retrievalKeys"
                    ],
                    "properties": {
                        "action": {"const": "revise"},
                        "scope": {
                            "const": "hearth",
                            "description": "Immutable target identity copied from memory.read."
                        },
                        "memoryId": {"type": "string", "minLength": 1},
                        "baseRevisionId": {"type": "string", "minLength": 1},
                        "body": body,
                        "retrievalKeys": retrieval_keys
                    }
                }
            ]
        })
    }

    pub fn write(
        &self,
        database: &mut Database,
        invocation: &MemoryWriteToolInvocation,
    ) -> Result<CommandExecution> {
        self.write_authorized(database, invocation, None)
    }

    pub fn write_attested(
        &self,
        database: &mut Database,
        invocation: &MemoryWriteToolInvocation,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        self.write_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn write_authorized(
        &self,
        database: &mut Database,
        invocation: &MemoryWriteToolInvocation,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        let (identity, command_id) = authenticate(
            database,
            &invocation.native_binding_id,
            &invocation.binding_credential,
            &invocation.runtime_tool_call_id,
            attested_run,
        )?;
        let input = &invocation.input;
        MemoryService::default()
            .write(
                database,
                &CommandEnvelope {
                    command_id,
                    actor: ActorRef::Agent {
                        agent_id: identity.agent_id,
                        source_agent_run_id: identity.agent_run_id,
                    },
                    camp_id: Some(identity.camp_id),
                    expected_versions: Vec::new(),
                    execution_epoch: Some(identity.execution_epoch),
                    payload: AgentMemoryWriteCommand {
                        action: input.action.clone(),
                        scope: input.scope,
                        kind: input.kind,
                        body: input.body.clone(),
                        retrieval_keys: input.retrieval_keys.clone(),
                        counterparty_agent_id: input.counterparty_agent_id.clone(),
                        direction: input.direction,
                        memory_id: input.memory_id.clone(),
                        base_revision_id: input.base_revision_id.clone(),
                    },
                },
            )
            .map_err(map_memory_tool_error)
    }
}

fn authenticate(
    database: &Database,
    native_binding_id: &str,
    binding_credential: &str,
    runtime_tool_call_id: &str,
    attested_run: Option<(&str, i64)>,
) -> Result<(crate::team_tool::AuthenticatedTeamToolRun, String)> {
    let team_tool = TeamToolService::default();
    let identity = if let Some((agent_run_id, execution_epoch)) = attested_run {
        team_tool.authenticate_attested_binding(
            database,
            native_binding_id,
            binding_credential,
            runtime_tool_call_id,
            agent_run_id,
            execution_epoch,
        )
    } else {
        team_tool.authenticate_read_binding(
            database,
            native_binding_id,
            binding_credential,
            runtime_tool_call_id,
        )
    }
    .map_err(map_memory_tool_error)?;
    let command_id = team_tool
        .binding_command_id(native_binding_id, binding_credential, runtime_tool_call_id)
        .map_err(map_memory_tool_error)?;
    Ok((identity, command_id))
}

fn map_memory_tool_error(error: anyhow::Error) -> anyhow::Error {
    if let Some(invocation) = error.downcast_ref::<TeamToolInvocationError>() {
        return TeamToolInvocationError {
            code: invocation.code.clone(),
            message: invocation.message.clone(),
        }
        .into();
    }
    error
}
