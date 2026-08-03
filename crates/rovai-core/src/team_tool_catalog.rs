use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::{
    command::canonical_json_digest,
    context_retrieval::{
        CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME, CONTEXT_GET_MESSAGE_TOOL_NAME,
        CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME, CONTEXT_GET_SUMMARY_TOOL_NAME,
        CONTEXT_SEARCH_TOOL_NAME, ContextGetMessageInput, ContextGetMessageThreadInput,
        ContextGetMessageWindowInput, ContextGetSummaryInput, ContextRetrievalService,
        ContextSearchInput,
    },
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MemoryReadInput, MemoryRetrievalService,
        MemorySearchInput,
    },
    memory_tool::{
        HearthProposalToolInput, MEMORY_PROPOSE_HEARTH_TOOL_NAME, MEMORY_WRITE_TOOL_NAME,
        MemoryToolService, MemoryWriteToolInput,
    },
    team_tool::{
        TEAM_CALL_MEMBER_TOOL_NAME, TEAM_CREATE_TASK_TOOL_NAME, TEAM_LIST_TASKS_TOOL_NAME,
        TEAM_UPDATE_TASK_TOOL_NAME, TeamCallMemberInput, TeamCreateTaskInput, TeamListTasksInput,
        TeamToolService, TeamUpdateTaskInput,
    },
};

pub const ANTIGRAVITY_TEAM_SERVER_NAME: &str = "rovai_team";
pub const ATTESTED_TEAM_PROTOCOL_VERSION: u32 = 3;
pub const ANTIGRAVITY_ALIAS_MAP_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltInTeamToolIdentity {
    pub canonical_name: &'static str,
    pub antigravity_alias: &'static str,
}

pub const BUILT_IN_TEAM_TOOL_IDENTITIES: [BuiltInTeamToolIdentity; 13] = [
    BuiltInTeamToolIdentity {
        canonical_name: TEAM_CALL_MEMBER_TOOL_NAME,
        antigravity_alias: "call_member",
    },
    BuiltInTeamToolIdentity {
        canonical_name: TEAM_CREATE_TASK_TOOL_NAME,
        antigravity_alias: "create_task",
    },
    BuiltInTeamToolIdentity {
        canonical_name: TEAM_UPDATE_TASK_TOOL_NAME,
        antigravity_alias: "update_task",
    },
    BuiltInTeamToolIdentity {
        canonical_name: TEAM_LIST_TASKS_TOOL_NAME,
        antigravity_alias: "list_tasks",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CONTEXT_SEARCH_TOOL_NAME,
        antigravity_alias: "context_search",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CONTEXT_GET_MESSAGE_TOOL_NAME,
        antigravity_alias: "context_get_message",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME,
        antigravity_alias: "context_get_message_window",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME,
        antigravity_alias: "context_get_message_thread",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CONTEXT_GET_SUMMARY_TOOL_NAME,
        antigravity_alias: "context_get_summary",
    },
    BuiltInTeamToolIdentity {
        canonical_name: MEMORY_SEARCH_TOOL_NAME,
        antigravity_alias: "memory_search",
    },
    BuiltInTeamToolIdentity {
        canonical_name: MEMORY_READ_TOOL_NAME,
        antigravity_alias: "memory_read",
    },
    BuiltInTeamToolIdentity {
        canonical_name: MEMORY_WRITE_TOOL_NAME,
        antigravity_alias: "memory_write",
    },
    BuiltInTeamToolIdentity {
        canonical_name: MEMORY_PROPOSE_HEARTH_TOOL_NAME,
        antigravity_alias: "memory_propose_hearth",
    },
];

pub fn identity_by_canonical(name: &str) -> Option<BuiltInTeamToolIdentity> {
    BUILT_IN_TEAM_TOOL_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.canonical_name == name)
}

pub fn identity_by_antigravity_alias(alias: &str) -> Option<BuiltInTeamToolIdentity> {
    BUILT_IN_TEAM_TOOL_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.antigravity_alias == alias)
}

pub fn antigravity_permission_rules() -> Vec<String> {
    BUILT_IN_TEAM_TOOL_IDENTITIES
        .iter()
        .map(|identity| {
            format!(
                "mcp({ANTIGRAVITY_TEAM_SERVER_NAME}/{})",
                identity.antigravity_alias
            )
        })
        .collect()
}

pub fn built_in_team_catalog_digest() -> Result<String> {
    canonical_json_digest(&json!({
        "protocolVersion": ATTESTED_TEAM_PROTOCOL_VERSION,
        "aliasMapVersion": ANTIGRAVITY_ALIAS_MAP_VERSION,
        "identities": BUILT_IN_TEAM_TOOL_IDENTITIES.iter().map(|identity| json!({
            "canonicalName": identity.canonical_name,
            "antigravityAlias": identity.antigravity_alias,
        })).collect::<Vec<_>>(),
        "tools": canonical_team_tool_definitions(),
    }))
}

pub fn antigravity_team_tool_definitions() -> Vec<Value> {
    canonical_team_tool_definitions()
        .into_iter()
        .zip(BUILT_IN_TEAM_TOOL_IDENTITIES)
        .map(|(mut definition, identity)| {
            definition["name"] = Value::String(identity.antigravity_alias.to_string());
            definition
        })
        .collect()
}

pub fn validate_builtin_team_tool_input(canonical_name: &str, input: &Value) -> Result<()> {
    let valid = match canonical_name {
        TEAM_CALL_MEMBER_TOOL_NAME => {
            serde_json::from_value::<TeamCallMemberInput>(input.clone()).map(|_| ())
        }
        TEAM_CREATE_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamCreateTaskInput>(input.clone()).map(|_| ())
        }
        TEAM_UPDATE_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamUpdateTaskInput>(input.clone()).map(|_| ())
        }
        TEAM_LIST_TASKS_TOOL_NAME => {
            serde_json::from_value::<TeamListTasksInput>(input.clone()).map(|_| ())
        }
        CONTEXT_SEARCH_TOOL_NAME => {
            serde_json::from_value::<ContextSearchInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageWindowInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageThreadInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_SUMMARY_TOOL_NAME => {
            serde_json::from_value::<ContextGetSummaryInput>(input.clone()).map(|_| ())
        }
        MEMORY_SEARCH_TOOL_NAME => {
            serde_json::from_value::<MemorySearchInput>(input.clone()).map(|_| ())
        }
        MEMORY_READ_TOOL_NAME => {
            serde_json::from_value::<MemoryReadInput>(input.clone()).map(|_| ())
        }
        MEMORY_WRITE_TOOL_NAME => {
            serde_json::from_value::<MemoryWriteToolInput>(input.clone()).map(|_| ())
        }
        MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
            serde_json::from_value::<HearthProposalToolInput>(input.clone()).map(|_| ())
        }
        _ => bail!("unknown built-in Team Tool: {canonical_name}"),
    };
    valid.map_err(|_| anyhow::anyhow!("{canonical_name} input does not match its schema"))
}

pub fn canonical_team_tool_definitions() -> Vec<Value> {
    let definitions = vec![
        json!({
            "name": TEAM_CALL_MEMBER_TOOL_NAME,
            "title": "Request work from a Camp member",
            "description": "Persist a private execution request for another active Agent in the same Camp. The recipient receives a later single-slot AgentRun when idle. Do not sleep or poll team.list_tasks for the result; finish the current Run when only waiting, and Core will resume this Agent through a later input when required.",
            "inputSchema": TeamToolService::input_schema(),
            "outputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "status", "recipient", "recipientName", "returnPolicy", "taskLinked"],
                "properties": {
                    "rovaiTeamTool": {"const": TEAM_CALL_MEMBER_TOOL_NAME},
                    "rovaiTeamReceipt": {"type": "string"},
                    "status": {"const": "accepted"},
                    "recipient": {"type": "string"},
                    "recipientName": {"type": "string"},
                    "returnPolicy": {"type": "string", "enum": ["required", "none"]},
                    "taskLinked": {"type": "boolean"}
                }
            }
        }),
        json!({
            "name": TEAM_CREATE_TASK_TOOL_NAME,
            "title": "Create a durable Camp Task",
            "description": "Create a long-lived responsibility. Assignment records ownership but does not notify or wake the assignee.",
            "inputSchema": TeamToolService::create_task_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "taskId", "status", "version"],
                "properties": {
                    "rovaiTeamTool": {"const": TEAM_CREATE_TASK_TOOL_NAME},
                    "rovaiTeamReceipt": {"type": "string"},
                    "taskId": {"type": "string"}, "status": {"const": "pending"},
                    "version": {"type": "integer"}
                }
            }
        }),
        json!({
            "name": TEAM_UPDATE_TASK_TOOL_NAME,
            "title": "Update a durable Camp Task",
            "description": "Atomically edit an authorized non-terminal Task using its current version. A successful update does not wake an assignee.",
            "inputSchema": TeamToolService::update_task_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "taskId", "status", "assigneeAgentId", "version"],
                "properties": {
                    "rovaiTeamTool": {"const": TEAM_UPDATE_TASK_TOOL_NAME},
                    "rovaiTeamReceipt": {"type": "string"},
                    "taskId": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"]},
                    "assigneeAgentId": {"type": ["string", "null"]},
                    "version": {"type": "integer"}
                }
            }
        }),
        json!({
            "name": TEAM_LIST_TASKS_TOOL_NAME,
            "title": "List visible Camp Tasks",
            "description": "Read a current Task snapshot visible to this Agent. Lead sees all; other members see their own and unassigned Tasks. This is not a waiting primitive: never combine it with sleep or repeated calls to poll for state changes.",
            "inputSchema": TeamToolService::list_tasks_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "tasks", "nextCursor", "truncated"],
                "properties": {
                    "rovaiTeamTool": {"const": TEAM_LIST_TASKS_TOOL_NAME},
                    "rovaiTeamReceipt": {"type": "string"},
                    "tasks": {"type": "array", "items": {"type": "object"}},
                    "nextCursor": {"type": ["string", "null"]}, "truncated": {"type": "boolean"}
                }
            }
        }),
        json!({
            "name": CONTEXT_SEARCH_TOOL_NAME,
            "title": "Search frozen Camp context",
            "description": "Search public Camp messages and shared summaries without crossing this AgentRun's frozen message boundary.",
            "inputSchema": ContextRetrievalService::search_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "results", "truncated", "boundarySequence"],
                "properties": {
                    "rovaiTeamTool": {"const": CONTEXT_SEARCH_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "results": {"type": "array"}, "truncated": {"type": "boolean"}, "boundarySequence": {"type": "integer"}
                }
            }
        }),
        json!({
            "name": CONTEXT_GET_MESSAGE_TOOL_NAME,
            "title": "Read one frozen Camp message",
            "description": "Read one visible public Camp message, with a bounded body slice and attachment metadata.",
            "inputSchema": ContextRetrievalService::get_message_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messageId", "sequence", "body", "bodyLength", "bodyTruncated"],
                "properties": {
                    "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "messageId": {"type": "string"}, "sequence": {"type": "integer"}, "body": {"type": "string"},
                    "bodyLength": {"type": "integer"}, "bodyTruncated": {"type": "boolean"}
                }
            }
        }),
        json!({
            "name": CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME,
            "title": "Read a frozen message window",
            "description": "Read the bounded chronological neighborhood around one visible Camp message.",
            "inputSchema": ContextRetrievalService::get_message_window_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messages", "truncated", "boundarySequence"],
                "properties": {
                    "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "messages": {"type": "array"}, "truncated": {"type": "boolean"}, "boundarySequence": {"type": "integer"}
                }
            }
        }),
        json!({
            "name": CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME,
            "title": "Read a frozen reply thread",
            "description": "Read a visible Camp root message and its visible recursive replies in sequence order.",
            "inputSchema": ContextRetrievalService::get_message_thread_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messages", "truncated", "boundarySequence"],
                "properties": {
                    "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "messages": {"type": "array"}, "truncated": {"type": "boolean"}, "boundarySequence": {"type": "integer"}
                }
            }
        }),
        json!({
            "name": CONTEXT_GET_SUMMARY_TOOL_NAME,
            "title": "Read one frozen Camp summary",
            "description": "Read a Segment or Epoch only when its full coverage range ends at or before this AgentRun's boundary.",
            "inputSchema": ContextRetrievalService::get_summary_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "summaryId", "level", "fromSequence", "throughSequence", "body"],
                "properties": {
                    "rovaiTeamTool": {"const": CONTEXT_GET_SUMMARY_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "summaryId": {"type": "string"}, "level": {"type": "string", "enum": ["segment", "epoch"]},
                    "fromSequence": {"type": "integer"}, "throughSequence": {"type": "integer"}, "body": {"type": "string"}
                }
            }
        }),
        json!({
            "name": MEMORY_SEARCH_TOOL_NAME,
            "title": "Search current Memory",
            "description": "Search active Memory that is currently accessible to this Agent. Results are discovery hints and do not include full bodies.",
            "inputSchema": MemoryRetrievalService::search_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "results"],
                "properties": {
                    "rovaiTeamTool": {"const": MEMORY_SEARCH_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "results": {"type": "array"}
                }
            }
        }),
        json!({
            "name": MEMORY_READ_TOOL_NAME,
            "title": "Read current Memory",
            "description": "Resolve stable Memory IDs against current Revision, lifecycle, Camp access, and Presence. Stale/deleted results never return old bodies.",
            "inputSchema": MemoryRetrievalService::read_input_schema(),
            "outputSchema": {
                "type": "object", "required": ["rovaiTeamTool", "rovaiTeamReceipt", "memories"],
                "properties": {
                    "rovaiTeamTool": {"const": MEMORY_READ_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "memories": {"type": "array"}
                }
            }
        }),
        json!({
            "name": MEMORY_WRITE_TOOL_NAME,
            "title": "Write active partner Memory",
            "description": "Add an active Companion/Relationship Memory or publish a Revision to an accessible one. Hearth is not writable through this tool.",
            "inputSchema": MemoryToolService::write_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "action", "memoryId", "revisionId", "effective"],
                "properties": {
                    "rovaiTeamTool": {"const": MEMORY_WRITE_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "action": {"type": "string", "enum": ["add", "revise"]}, "memoryId": {"type": "string"},
                    "revisionId": {"type": "string"}, "effective": {"const": true}
                }
            }
        }),
        json!({
            "name": MEMORY_PROPOSE_HEARTH_TOOL_NAME,
            "title": "Propose Hearth Memory",
            "description": "Submit one Hearth add or revise proposal. It is not effective until the user accepts it.",
            "inputSchema": MemoryToolService::propose_hearth_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "proposalId", "status", "effective"],
                "properties": {
                    "rovaiTeamTool": {"const": MEMORY_PROPOSE_HEARTH_TOOL_NAME}, "rovaiTeamReceipt": {"type": "string"},
                    "proposalId": {"type": "string"}, "status": {"const": "pending"}, "effective": {"const": false}
                }
            }
        }),
    ];
    definitions
        .into_iter()
        .map(|mut definition| {
            let canonical_name = definition["name"]
                .as_str()
                .expect("built-in Team Tool definition has a canonical name")
                .to_string();
            let success_schema = definition
                .as_object_mut()
                .and_then(|object| object.remove("outputSchema"))
                .expect("built-in Team Tool definition has an output schema");
            definition["outputSchema"] = json!({
                "type": "object",
                "oneOf": [
                    success_schema,
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["rovaiTeamTool", "rovaiTeamReceipt", "errorCode"],
                        "properties": {
                            "rovaiTeamTool": {"const": canonical_name},
                            "rovaiTeamReceipt": {"type": "string"},
                            "errorCode": {"type": "string"}
                        }
                    }
                ]
            });
            definition
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::team_tool::TEAM_TOOL_NAMES;

    #[test]
    fn canonical_catalog_and_antigravity_aliases_are_complete_and_unique() {
        assert_eq!(BUILT_IN_TEAM_TOOL_IDENTITIES.len(), TEAM_TOOL_NAMES.len());
        assert_eq!(
            canonical_team_tool_definitions().len(),
            TEAM_TOOL_NAMES.len()
        );
        assert_eq!(
            antigravity_team_tool_definitions().len(),
            TEAM_TOOL_NAMES.len()
        );
        assert_eq!(
            BUILT_IN_TEAM_TOOL_IDENTITIES
                .iter()
                .map(|identity| identity.canonical_name)
                .collect::<Vec<_>>(),
            TEAM_TOOL_NAMES
        );
        assert_eq!(
            BUILT_IN_TEAM_TOOL_IDENTITIES
                .iter()
                .map(|identity| identity.antigravity_alias)
                .collect::<HashSet<_>>()
                .len(),
            TEAM_TOOL_NAMES.len()
        );
        assert!(
            BUILT_IN_TEAM_TOOL_IDENTITIES
                .iter()
                .all(|identity| !identity.antigravity_alias.contains('.'))
        );
    }

    #[test]
    fn permission_bundle_covers_every_alias_in_order() {
        let permissions = antigravity_permission_rules();
        assert_eq!(permissions.len(), TEAM_TOOL_NAMES.len());
        for (permission, identity) in permissions.iter().zip(BUILT_IN_TEAM_TOOL_IDENTITIES) {
            assert_eq!(
                permission,
                &format!("mcp(rovai_team/{})", identity.antigravity_alias)
            );
        }
    }

    #[test]
    fn every_output_schema_accepts_the_canonical_error_receipt_shape() {
        for (definition, identity) in canonical_team_tool_definitions()
            .iter()
            .zip(BUILT_IN_TEAM_TOOL_IDENTITIES)
        {
            assert_eq!(definition["outputSchema"]["type"], "object");
            assert_eq!(
                definition.pointer("/outputSchema/oneOf/1/additionalProperties"),
                Some(&Value::Bool(false))
            );
            assert_eq!(
                definition.pointer("/outputSchema/oneOf/1/properties/rovaiTeamTool/const"),
                Some(&Value::String(identity.canonical_name.to_string()))
            );
            assert_eq!(
                definition.pointer("/outputSchema/oneOf/1/required/2"),
                Some(&Value::String("errorCode".to_string()))
            );
        }
    }

    #[test]
    fn antigravity_definitions_change_only_native_names() {
        let canonical = canonical_team_tool_definitions();
        let antigravity = antigravity_team_tool_definitions();
        for ((canonical, antigravity), identity) in canonical
            .iter()
            .zip(&antigravity)
            .zip(BUILT_IN_TEAM_TOOL_IDENTITIES)
        {
            assert_eq!(canonical["name"], identity.canonical_name);
            assert_eq!(antigravity["name"], identity.antigravity_alias);
            assert_eq!(canonical["title"], antigravity["title"]);
            assert_eq!(canonical["description"], antigravity["description"]);
            assert_eq!(canonical["inputSchema"], antigravity["inputSchema"]);
            assert_eq!(canonical["outputSchema"], antigravity["outputSchema"]);
            assert_eq!(
                antigravity.pointer("/outputSchema/oneOf/0/properties/rovaiTeamTool/const"),
                Some(&Value::String(identity.canonical_name.to_string()))
            );
            assert_eq!(
                antigravity.pointer("/outputSchema/oneOf/1/properties/rovaiTeamTool/const"),
                Some(&Value::String(identity.canonical_name.to_string()))
            );
        }
    }

    #[test]
    fn catalog_digest_is_stable_and_versioned() {
        assert_eq!(
            built_in_team_catalog_digest().unwrap(),
            built_in_team_catalog_digest().unwrap()
        );
        assert_eq!(ATTESTED_TEAM_PROTOCOL_VERSION, 3);
        assert_eq!(ANTIGRAVITY_ALIAS_MAP_VERSION, 2);
    }
}
