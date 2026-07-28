use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    command::{ActorRef, CommandEnvelope, CommandExecution},
    db::Database,
    memory::{MEMORY_PROPOSE_CHANGE_CAPABILITY, MemoryService, SaveMemoryProposalCommand},
    team_tool::{TeamToolInvocationError, TeamToolService},
};

pub const MEMORY_PROPOSE_CHANGE_TOOL_NAME: &str = "memory.propose_change";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryProposalToolInput {
    pub action: String,
    pub scope: Option<crate::memory::MemoryScopeKind>,
    pub kind: Option<crate::memory::MemoryKind>,
    pub body: String,
    pub counterparty_agent_id: Option<String>,
    pub direction: Option<crate::memory::RelationshipDirection>,
    pub memory_id: Option<String>,
    pub base_revision_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MemoryToolInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: MemoryProposalToolInput,
}

#[derive(Debug, Default)]
pub struct MemoryToolService;

impl MemoryToolService {
    pub fn input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["action", "body"],
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add", "revise"],
                    "description": "Use add for a new durable memory suggestion or revise for a current Memory revision."
                },
                "scope": {
                    "type": "string",
                    "enum": ["hearth", "companion", "relationship"],
                    "description": "Required only for add. Companion always means the current Agent."
                },
                "kind": {
                    "type": "string",
                    "enum": ["preference", "agreement", "lesson"],
                    "description": "Required only for add. Relationship allows agreement or lesson. Any legal non-Hearth add can qualify for bounded automatic formation under the live policy."
                },
                "body": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2048,
                    "description": "One atomic durable preference, agreement, or reusable lesson. Never include credentials or task state."
                },
                "counterpartyAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "For a Relationship add, another current member of this Camp."
                },
                "direction": {
                    "type": "string",
                    "enum": ["mutual", "directed"],
                    "description": "For a Relationship add. directed always means current Agent to counterparty."
                },
                "memoryId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Required only for revise and must be currently readable by this Agent."
                },
                "baseRevisionId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Required only for revise and must still be the current revision."
                }
            }
        })
    }

    pub fn propose_change(
        &self,
        database: &mut Database,
        invocation: &MemoryToolInvocation,
    ) -> Result<CommandExecution> {
        let team_tool = TeamToolService::default();
        let identity = team_tool
            .authenticate_binding(
                database,
                &invocation.native_binding_id,
                &invocation.binding_credential,
                &invocation.runtime_tool_call_id,
                MEMORY_PROPOSE_CHANGE_CAPABILITY,
            )
            .map_err(map_memory_tool_error)?;
        let command_id = team_tool
            .binding_command_id(
                &invocation.native_binding_id,
                &invocation.binding_credential,
                &invocation.runtime_tool_call_id,
            )
            .map_err(map_memory_tool_error)?;
        let input = &invocation.input;
        MemoryService::default()
            .save_proposal(
                database,
                &CommandEnvelope {
                    command_id,
                    actor: ActorRef::Agent {
                        agent_profile_id: identity.agent_profile_id,
                        source_agent_run_id: identity.agent_run_id,
                    },
                    camp_id: Some(identity.camp_id),
                    expected_versions: Vec::new(),
                    execution_epoch: Some(identity.execution_epoch),
                    payload: SaveMemoryProposalCommand {
                        action: input.action.clone(),
                        scope: input.scope,
                        kind: input.kind,
                        body: input.body.clone(),
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

fn map_memory_tool_error(error: anyhow::Error) -> anyhow::Error {
    if let Some(invocation) = error.downcast_ref::<TeamToolInvocationError>() {
        return TeamToolInvocationError {
            code: if invocation.code == "team_tool.capability_denied" {
                "memory.capability_denied".to_string()
            } else {
                invocation.code.clone()
            },
            message: invocation.message.clone(),
        }
        .into();
    }
    let message = error.to_string();
    if let Some((code, detail)) = message.split_once(':')
        && code.starts_with("memory.")
    {
        return TeamToolInvocationError {
            code: code.to_string(),
            message: detail.trim().to_string(),
        }
        .into();
    }
    error
}
