use std::collections::BTreeSet;

use anyhow::{Result, bail};
use serde_json::{Map, Value, json};

use crate::{
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput,
    },
    command::canonical_json_digest,
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
pub const ATTESTED_TEAM_PROTOCOL_VERSION: u32 = 5;
pub const ANTIGRAVITY_ALIAS_MAP_VERSION: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltInTeamToolIdentity {
    pub canonical_name: &'static str,
    pub antigravity_alias: &'static str,
}

pub const BUILT_IN_TEAM_TOOL_IDENTITIES: [BuiltInTeamToolIdentity; 12] = [
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
        canonical_name: CAMP_LIST_TOOL_NAME,
        antigravity_alias: "camp_list",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CAMP_SEARCH_TOOL_NAME,
        antigravity_alias: "camp_search",
    },
    BuiltInTeamToolIdentity {
        canonical_name: HISTORY_SEARCH_TOOL_NAME,
        antigravity_alias: "history_search",
    },
    BuiltInTeamToolIdentity {
        canonical_name: CAMP_READ_TOOL_NAME,
        antigravity_alias: "camp_read",
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

/// Kiro currently sends MCP input schemas through Amazon Bedrock, which
/// rejects `oneOf`, `allOf`, and `anyOf` at the schema root. Keep canonical
/// tool identity and Core validation unchanged while exposing a structurally
/// compatible, intentionally less restrictive schema for the affected tool.
pub fn kiro_team_tool_definitions() -> Vec<Value> {
    canonical_team_tool_definitions()
        .into_iter()
        .map(|mut definition| {
            if definition["name"] == CAMP_READ_TOOL_NAME {
                definition["inputSchema"] = kiro_camp_read_input_schema();
            }
            definition
        })
        .collect()
}

fn kiro_camp_read_input_schema() -> Value {
    let canonical = CampHistoryService::camp_read_input_schema();
    let variants = canonical["oneOf"]
        .as_array()
        .expect("canonical camp.read schema has variants");
    let mut properties = Map::new();
    let mut modes = Vec::new();
    let mut required = variants
        .first()
        .and_then(|variant| variant["required"].as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    for variant in variants {
        let variant_required = variant["required"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>();
        required.retain(|name| variant_required.contains(name.as_str()));
        for (name, schema) in variant["properties"]
            .as_object()
            .expect("canonical camp.read variant has properties")
        {
            if name == "mode" {
                if let Some(mode) = schema.get("const").and_then(Value::as_str) {
                    modes.push(mode.to_string());
                }
            } else {
                properties
                    .entry(name.clone())
                    .or_insert_with(|| schema.clone());
            }
        }
    }
    properties.insert(
        "mode".to_string(),
        json!({
            "type": "string",
            "enum": modes,
            "description": "Read mode. item/around/thread require messageId; thread/timeline require direction. Core validates the selected mode exactly."
        }),
    );
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties,
    })
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
        CAMP_LIST_TOOL_NAME => serde_json::from_value::<CampListInput>(input.clone()).map(|_| ()),
        CAMP_SEARCH_TOOL_NAME => {
            serde_json::from_value::<CampSearchInput>(input.clone()).map(|_| ())
        }
        HISTORY_SEARCH_TOOL_NAME => {
            serde_json::from_value::<HistorySearchInput>(input.clone()).map(|_| ())
        }
        CAMP_READ_TOOL_NAME => serde_json::from_value::<CampReadInput>(input.clone()).map(|_| ()),
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

fn camp_list_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["rovaiTeamTool", "rovaiTeamReceipt", "camps", "truncated"],
        "properties": {
            "rovaiTeamTool": {"const": CAMP_LIST_TOOL_NAME},
            "rovaiTeamReceipt": {"type": "string"},
            "camps": {
                "type": "array", "maxItems": 50,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["campId", "title", "lastVisibleActivityAt"],
                    "properties": {
                        "campId": {"type": "string"},
                        "title": {"type": "string"},
                        "lastVisibleActivityAt": {"type": "string", "format": "date-time"}
                    }
                }
            },
            "truncated": {"type": "boolean"}
        }
    })
}

fn camp_search_success_schema(tool_name: &str, include_camp_title: bool) -> Value {
    let max_items = if include_camp_title { 30 } else { 20 };
    let mut result_properties = json!({
        "campId": {"type": "string"},
        "messageId": {"type": "string"},
        "sequence": {"type": "integer", "minimum": 1},
        "authorType": {"type": "string"},
        "authorId": {"type": "string"},
        "replyToMessageId": {"type": ["string", "null"]},
        "createdAt": {"type": "string", "format": "date-time"},
        "snippet": {"type": "string", "maxLength": 200}
    });
    let mut required = vec![
        "campId",
        "messageId",
        "sequence",
        "authorType",
        "authorId",
        "replyToMessageId",
        "createdAt",
        "snippet",
    ];
    if include_camp_title {
        result_properties["campTitle"] = json!({"type": "string"});
        required.push("campTitle");
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["rovaiTeamTool", "rovaiTeamReceipt", "results", "truncated", "searchIncomplete"],
        "properties": {
            "rovaiTeamTool": {"const": tool_name},
            "rovaiTeamReceipt": {"type": "string"},
            "results": {
                "type": "array", "maxItems": max_items,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": required,
                    "properties": result_properties
                }
            },
            "truncated": {"type": "boolean"},
            "searchIncomplete": {"type": "boolean"}
        }
    })
}

fn collection_message_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "messageId", "sequence", "authorType", "authorId", "replyToMessageId",
            "createdAt", "body", "bodyOffset", "bodyLength", "bodyTruncated",
            "nextBodyOffset", "attachmentCount"
        ],
        "properties": {
            "messageId": {"type": "string"},
            "sequence": {"type": "integer", "minimum": 1},
            "authorType": {"type": "string"},
            "authorId": {"type": "string"},
            "replyToMessageId": {"type": ["string", "null"]},
            "createdAt": {"type": "string", "format": "date-time"},
            "body": {"type": "string", "maxLength": 500},
            "bodyOffset": {"const": 0},
            "bodyLength": {"type": "integer", "minimum": 0},
            "bodyTruncated": {"type": "boolean"},
            "nextBodyOffset": {"type": ["integer", "null"], "minimum": 1},
            "attachmentCount": {"type": "integer", "minimum": 0}
        }
    })
}

fn item_message_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "messageId", "sequence", "authorType", "authorId", "replyToMessageId",
            "createdAt", "body", "bodyOffset", "bodyLength", "bodyTruncated",
            "nextBodyOffset", "attachmentCount", "attachments", "attachmentsTruncated",
            "attachmentOmittedCount"
        ],
        "properties": {
            "messageId": {"type": "string"},
            "sequence": {"type": "integer", "minimum": 1},
            "authorType": {"type": "string"},
            "authorId": {"type": "string"},
            "replyToMessageId": {"type": ["string", "null"]},
            "createdAt": {"type": "string", "format": "date-time"},
            "body": {"type": "string", "maxLength": 4000},
            "bodyOffset": {"type": "integer", "minimum": 0},
            "bodyLength": {"type": "integer", "minimum": 0},
            "bodyTruncated": {"type": "boolean"},
            "nextBodyOffset": {"type": ["integer", "null"], "minimum": 1},
            "attachmentCount": {"type": "integer", "minimum": 0},
            "attachments": {
                "type": "array", "maxItems": 10,
                "items": {
                    "type": "object", "additionalProperties": false,
                    "required": ["attachmentId", "name", "mediaType", "byteSize"],
                    "properties": {
                        "attachmentId": {"type": "string"},
                        "name": {"type": "string"},
                        "mediaType": {"type": "string"},
                        "byteSize": {"type": "integer", "minimum": 0}
                    }
                }
            },
            "attachmentsTruncated": {"type": "boolean"},
            "attachmentOmittedCount": {"type": "integer", "minimum": 0}
        }
    })
}

fn camp_read_item_schema() -> Value {
    json!({
        "additionalProperties": false,
        "required": ["rovaiTeamTool", "rovaiTeamReceipt", "campId", "mode", "items"],
        "properties": {
            "rovaiTeamTool": {"const": CAMP_READ_TOOL_NAME},
            "rovaiTeamReceipt": {"type": "string"},
            "campId": {"type": "string"},
            "mode": {"const": "item"},
            "items": {
                "type": "array", "minItems": 1, "maxItems": 1,
                "items": item_message_schema()
            }
        }
    })
}

fn camp_read_around_schema() -> Value {
    json!({
        "additionalProperties": false,
        "required": [
            "rovaiTeamTool", "rovaiTeamReceipt", "campId", "mode",
            "anchorMessageId", "items", "hasMoreBefore", "hasMoreAfter"
        ],
        "properties": {
            "rovaiTeamTool": {"const": CAMP_READ_TOOL_NAME},
            "rovaiTeamReceipt": {"type": "string"},
            "campId": {"type": "string"},
            "mode": {"const": "around"},
            "anchorMessageId": {"type": "string"},
            "items": {"type": "array", "minItems": 1, "maxItems": 21, "items": collection_message_schema()},
            "hasMoreBefore": {"type": "boolean"},
            "hasMoreAfter": {"type": "boolean"}
        }
    })
}

fn camp_read_thread_schema() -> Value {
    json!({
        "additionalProperties": false,
        "required": [
            "rovaiTeamTool", "rovaiTeamReceipt", "campId", "mode",
            "anchorMessageId", "threadRootMessageId", "direction", "items",
            "nextCursor", "hasMore"
        ],
        "properties": {
            "rovaiTeamTool": {"const": CAMP_READ_TOOL_NAME},
            "rovaiTeamReceipt": {"type": "string"},
            "campId": {"type": "string"},
            "mode": {"const": "thread"},
            "anchorMessageId": {"type": "string"},
            "threadRootMessageId": {"type": "string"},
            "direction": {"type": "string", "enum": ["before", "after"]},
            "items": {"type": "array", "maxItems": 20, "items": collection_message_schema()},
            "nextCursor": {"type": ["integer", "null"], "minimum": 1},
            "hasMore": {"type": "boolean"}
        }
    })
}

fn camp_read_timeline_schema() -> Value {
    json!({
        "additionalProperties": false,
        "required": [
            "rovaiTeamTool", "rovaiTeamReceipt", "campId", "mode", "direction",
            "items", "nextCursor", "hasMore"
        ],
        "properties": {
            "rovaiTeamTool": {"const": CAMP_READ_TOOL_NAME},
            "rovaiTeamReceipt": {"type": "string"},
            "campId": {"type": "string"},
            "mode": {"const": "timeline"},
            "direction": {"type": "string", "enum": ["before", "after"]},
            "items": {"type": "array", "maxItems": 20, "items": collection_message_schema()},
            "nextCursor": {"type": ["integer", "null"], "minimum": 1},
            "hasMore": {"type": "boolean"}
        }
    })
}

fn camp_read_success_schema() -> Value {
    json!({
        "type": "object",
        "oneOf": [
            camp_read_item_schema(),
            camp_read_around_schema(),
            camp_read_thread_schema(),
            camp_read_timeline_schema()
        ]
    })
}

pub fn canonical_team_tool_definitions() -> Vec<Value> {
    let definitions = vec![
        json!({
            "name": TEAM_CALL_MEMBER_TOOL_NAME,
            "title": "Request work from a Camp member",
            "description": "team.call_member is not the default action for ending the current task. Call it only when the target member needs this message to continue acting or make a decision. Never use it to acknowledge receipt, reply politely, send non-blocking progress, or repeat information already shared. Before calling, confirm the target will have a clear next step after receiving it or is waiting for this necessary result; otherwise do not call. An accepted call persists one private execution request and later single-slot AgentRun. Do not sleep or poll team.list_tasks.",
            "inputSchema": TeamToolService::input_schema(),
            "outputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["rovaiTeamTool", "rovaiTeamReceipt", "status", "recipient", "recipientName", "taskLinked"],
                "properties": {
                    "rovaiTeamTool": {"const": TEAM_CALL_MEMBER_TOOL_NAME},
                    "rovaiTeamReceipt": {"type": "string"},
                    "status": {"const": "accepted"},
                    "recipient": {"type": "string"},
                    "recipientName": {"type": "string"},
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
            "name": CAMP_LIST_TOOL_NAME,
            "title": "Discover other Camps",
            "description": "Return a bounded Top-K of other Camps frozen into this AgentRun and still authorized now. Search only frozen Camp names; omit query for recent Camps. This tool never searches messages and never paginates.",
            "inputSchema": CampHistoryService::camp_list_input_schema(),
            "outputSchema": camp_list_success_schema()
        }),
        json!({
            "name": CAMP_SEARCH_TOOL_NAME,
            "title": "Search the current Camp",
            "description": "Return a bounded Top-K of original public messages in the current Camp. Search is discovery, not traversal: use a stable messageId with camp.read, then use sequence paging when continuous reading is needed. Summaries and attachments are not searched.",
            "inputSchema": CampHistoryService::camp_search_input_schema(),
            "outputSchema": camp_search_success_schema(CAMP_SEARCH_TOOL_NAME, false)
        }),
        json!({
            "name": HISTORY_SEARCH_TOOL_NAME,
            "title": "Search authorized Camp history",
            "description": "Return a bounded Top-K of original public messages across other Camps frozen into this AgentRun and still authorized now. Camp titles are metadata, not hits. Use camp.read with stable IDs for evidence and sequence paging. Summaries and attachments are not searched.",
            "inputSchema": CampHistoryService::history_search_input_schema(),
            "outputSchema": camp_search_success_schema(HISTORY_SEARCH_TOOL_NAME, true)
        }),
        json!({
            "name": CAMP_READ_TOOL_NAME,
            "title": "Read original Camp messages",
            "description": "Read one original public message, a bounded neighborhood, a reply tree, or a stable Camp timeline. item slices one body; around does not paginate; thread and timeline use exclusive integer sequence cursors. IDs and cursors locate content but never grant access. Summary bodies and attachment content are unavailable.",
            "inputSchema": CampHistoryService::camp_read_input_schema(),
            "outputSchema": camp_read_success_schema()
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
            if identity.canonical_name == CAMP_READ_TOOL_NAME {
                for variant in 0..4 {
                    assert_eq!(
                        antigravity.pointer(&format!(
                            "/outputSchema/oneOf/0/oneOf/{variant}/properties/rovaiTeamTool/const"
                        )),
                        Some(&Value::String(identity.canonical_name.to_string()))
                    );
                }
            } else {
                assert_eq!(
                    antigravity.pointer("/outputSchema/oneOf/0/properties/rovaiTeamTool/const"),
                    Some(&Value::String(identity.canonical_name.to_string()))
                );
            }
            assert_eq!(
                antigravity.pointer("/outputSchema/oneOf/1/properties/rovaiTeamTool/const"),
                Some(&Value::String(identity.canonical_name.to_string()))
            );
        }
    }

    #[test]
    fn kiro_catalog_flattens_only_the_unsupported_root_union() {
        let canonical = canonical_team_tool_definitions();
        let kiro = kiro_team_tool_definitions();
        assert_eq!(canonical.len(), kiro.len());
        for (canonical, kiro) in canonical.iter().zip(&kiro) {
            assert_eq!(canonical["name"], kiro["name"]);
            assert_eq!(canonical["title"], kiro["title"]);
            assert_eq!(canonical["description"], kiro["description"]);
            assert_eq!(canonical["outputSchema"], kiro["outputSchema"]);
            if canonical["name"] == CAMP_READ_TOOL_NAME {
                assert!(canonical["inputSchema"].get("oneOf").is_some());
                for keyword in ["oneOf", "allOf", "anyOf"] {
                    assert!(kiro["inputSchema"].get(keyword).is_none());
                }
                assert_eq!(kiro["inputSchema"]["required"], json!(["campId", "mode"]));
                assert_eq!(
                    kiro["inputSchema"]["properties"]["mode"]["enum"],
                    json!(["item", "around", "thread", "timeline"])
                );
            } else {
                assert_eq!(canonical["inputSchema"], kiro["inputSchema"]);
            }
        }
    }

    #[test]
    fn catalog_digest_is_stable_and_versioned() {
        assert_eq!(
            built_in_team_catalog_digest().unwrap(),
            built_in_team_catalog_digest().unwrap()
        );
        assert_eq!(ATTESTED_TEAM_PROTOCOL_VERSION, 5);
        assert_eq!(ANTIGRAVITY_ALIAS_MAP_VERSION, 3);
    }

    #[test]
    fn legacy_context_tools_are_not_accepted_after_the_clean_break() {
        assert!(
            validate_builtin_team_tool_input(
                "context.search",
                &json!({
                    "query": "old"
                })
            )
            .is_err()
        );
        assert!(
            validate_builtin_team_tool_input(
                "context.read",
                &json!({
                    "campId": "camp-1",
                    "messageId": "message-1"
                })
            )
            .is_err()
        );
        assert!(
            TEAM_TOOL_NAMES
                .iter()
                .all(|name| !name.starts_with("context."))
        );
    }
}
