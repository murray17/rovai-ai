use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::{
    builtin_tool_cli_output::validate_schema,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput,
    },
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MemoryReadInput, MemoryRetrievalService,
        MemorySearchInput,
    },
    memory_tool::{
        HearthProposalToolInput, MEMORY_PROPOSE_HEARTH_TOOL_NAME, MEMORY_WRITE_TOOL_NAME,
        MemoryToolService, MemoryWriteToolInput,
    },
    message_delivery::CAMP_MESSAGE_SEND_TOOL_NAME,
    team_tool::{
        CampMessageSendInput, TEAM_CREATE_TASK_TOOL_NAME, TEAM_GET_TASK_TOOL_NAME,
        TEAM_LIST_TASKS_TOOL_NAME, TEAM_UPDATE_TASK_TOOL_NAME, TeamCreateTaskInput,
        TeamGetTaskInput, TeamListTasksInput, TeamToolService, TeamUpdateTaskInput,
    },
};

pub fn validate_builtin_tool_input(canonical_name: &str, input: &Value) -> Result<()> {
    let definition = builtin_tool_definitions()
        .into_iter()
        .find(|definition| definition["name"].as_str() == Some(canonical_name))
        .ok_or_else(|| anyhow::anyhow!("unknown built-in operation: {canonical_name}"))?;
    validate_schema(input, &definition["inputSchema"])
        .map_err(|_| anyhow::anyhow!("{canonical_name} input does not match its schema"))?;
    let valid = match canonical_name {
        CAMP_MESSAGE_SEND_TOOL_NAME => {
            serde_json::from_value::<CampMessageSendInput>(input.clone()).map(|_| ())
        }
        TEAM_CREATE_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamCreateTaskInput>(input.clone()).map(|_| ())
        }
        TEAM_GET_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamGetTaskInput>(input.clone()).map(|_| ())
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
        _ => bail!("unknown built-in operation: {canonical_name}"),
    };
    valid.map_err(|_| anyhow::anyhow!("{canonical_name} input does not match its schema"))
}

fn camp_list_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["camps", "truncated"],
        "properties": {
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

fn camp_search_success_schema(include_camp_title: bool) -> Value {
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
        "required": ["results", "truncated", "searchIncomplete"],
        "properties": {
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
        "required": ["campId", "mode", "items"],
        "properties": {
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
            "campId", "mode",
            "anchorMessageId", "items", "hasMoreBefore", "hasMoreAfter"
        ],
        "properties": {
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
            "campId", "mode",
            "anchorMessageId", "threadRootMessageId", "direction", "items",
            "nextCursor", "hasMore"
        ],
        "properties": {
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
            "campId", "mode", "direction",
            "items", "nextCursor", "hasMore"
        ],
        "properties": {
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

fn task_list_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["tasks", "nextCursor", "truncated"],
        "properties": {
            "tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "taskId", "title", "status", "assigneeAgentId",
                        "createdByType", "createdById", "descriptionPreview",
                        "descriptionTruncated", "acceptanceCriteriaCount",
                        "statusNotePreview", "statusNoteTruncated", "version",
                        "createdAt", "updatedAt", "availableActions"
                    ],
                    "properties": {
                        "taskId": {"type": "string"},
                        "title": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]
                        },
                        "assigneeAgentId": {"type": ["string", "null"]},
                        "createdByType": {"type": "string"},
                        "createdById": {"type": "string"},
                        "descriptionPreview": {"type": "string", "maxLength": 240},
                        "descriptionTruncated": {"type": "boolean"},
                        "acceptanceCriteriaCount": {"type": "integer", "minimum": 0, "maximum": 12},
                        "statusNotePreview": {"type": ["string", "null"], "maxLength": 240},
                        "statusNoteTruncated": {"type": "boolean"},
                        "version": {"type": "integer", "minimum": 1},
                        "createdAt": {"type": "string", "format": "date-time"},
                        "updatedAt": {"type": "string", "format": "date-time"},
                        "closedAt": {"type": ["string", "null"], "format": "date-time"},
                        "availableActions": {
                            "type": "array",
                            "items": {"type": "string"},
                            "uniqueItems": true
                        }
                    }
                }
            },
            "nextCursor": {"type": ["string", "null"]},
            "truncated": {"type": "boolean"}
        }
    })
}

fn task_detail_success_schema(include_changed: bool) -> Value {
    let mut required = vec![
        "taskId",
        "campId",
        "title",
        "description",
        "acceptanceCriteria",
        "status",
        "assigneeAgentId",
        "blockedReason",
        "completionSummary",
        "cancelReason",
        "createdByType",
        "createdById",
        "sourceAgentRunId",
        "closedByType",
        "closedById",
        "closedByAgentRunId",
        "version",
        "createdAt",
        "updatedAt",
        "closedAt",
        "availableActions",
    ];
    if include_changed {
        required.push("changed");
    }
    let mut properties = json!({
        "taskId": {"type": "string"},
        "campId": {"type": "string"},
        "title": {"type": "string"},
        "description": {"type": "string", "maxLength": 8000},
        "acceptanceCriteria": {"type": "array", "maxItems": 12, "items": {"type": "string"}},
        "status": {"type": "string", "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]},
        "assigneeAgentId": {"type": ["string", "null"]},
        "blockedReason": {"type": ["string", "null"]},
        "completionSummary": {"type": ["string", "null"]},
        "cancelReason": {"type": ["string", "null"]},
        "createdByType": {"type": "string", "enum": ["user", "agent"]},
        "createdById": {"type": "string"},
        "sourceAgentRunId": {"type": ["string", "null"]},
        "closedByType": {"type": ["string", "null"]},
        "closedById": {"type": ["string", "null"]},
        "closedByAgentRunId": {"type": ["string", "null"]},
        "version": {"type": "integer", "minimum": 1},
        "createdAt": {"type": "string", "format": "date-time"},
        "updatedAt": {"type": "string", "format": "date-time"},
        "closedAt": {"type": ["string", "null"], "format": "date-time"},
        "availableActions": {"type": "array", "uniqueItems": true, "items": {"type": "string", "enum": ["update", "claim"]}}
    });
    if include_changed {
        properties["changed"] = json!({"type": "boolean"});
    }
    json!({
        "type": "object", "additionalProperties": false,
        "required": required, "properties": properties
    })
}

fn memory_search_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["results"],
        "properties": {
            "results": {
                "type": "array",
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["memoryId", "revisionId", "kind", "retrievalKeys", "snippet"],
                    "properties": {
                        "memoryId": {"type": "string"},
                        "revisionId": {"type": "string"},
                        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
                        "retrievalKeys": {
                            "type": "array",
                            "items": {"type": "string"},
                            "uniqueItems": true
                        },
                        "snippet": {"type": "string"}
                    }
                }
            }
        }
    })
}

fn memory_read_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["memories"],
        "properties": {
            "memories": {
                "type": "array",
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["memoryId", "cacheState"],
                    "properties": {
                        "memoryId": {"type": "string"},
                        "cacheState": {
                            "type": "string",
                            "enum": [
                                "current", "revision_changed", "inactive", "deleted",
                                "access_changed", "unavailable"
                            ]
                        },
                        "revisionId": {"type": "string"},
                        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
                        "retrievalKeys": {
                            "type": "array",
                            "items": {"type": "string"},
                            "uniqueItems": true
                        },
                        "body": {"type": "string"}
                    }
                }
            }
        }
    })
}

pub fn builtin_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": CAMP_MESSAGE_SEND_TOOL_NAME,
            "title": "Send a public Camp message",
            "description": "Publish exactly one Agent-authored Camp message. Effective recipients are the union of explicit to values, strict inline @agent_id tokens, and the eligible direct reply author. The canonical recipient set is atomic and creates one Message Delivery per recipient; a recipient-free message remains public-only.",
            "inputSchema": TeamToolService::camp_message_send_input_schema(),
            "outputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "status", "messageId", "visibility", "campTurnId",
                    "effectiveRecipients", "recipientPresentation", "recipientSetDigest",
                    "deliveryIds",
                    "allocatedAgentRunResponsibilities"
                ],
                "properties": {
                    "status": {"const": "accepted"},
                    "messageId": {"type": "string"},
                    "visibility": {"const": "camp_public"},
                    "campTurnId": {"type": "string"},
                    "effectiveRecipients": {
                        "type": "array", "maxItems": 16, "uniqueItems": true,
                        "items": {"type": "string"}
                    },
                    "recipientPresentation": {"type": "object"},
                    "recipientSetDigest": {"type": "string"},
                    "deliveryIds": {
                        "type": "array", "maxItems": 16, "uniqueItems": true,
                        "items": {"type": "string"}
                    },
                    "allocatedAgentRunResponsibilities": {"type": "integer", "minimum": 1}
                }
            }
        }),
        json!({
            "name": TEAM_CREATE_TASK_TOOL_NAME,
            "title": "Create a durable Task",
            "description": "Create a long-lived responsibility. Assignment records ownership but does not notify or wake the assignee.",
            "inputSchema": TeamToolService::create_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_GET_TASK_TOOL_NAME,
            "title": "Get a durable Task",
            "description": "Read one full visible Task by stable taskId.",
            "inputSchema": TeamToolService::get_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_UPDATE_TASK_TOOL_NAME,
            "title": "Update a durable Task",
            "description": "Atomically edit an authorized non-terminal Task using its current version. A successful update does not wake an assignee.",
            "inputSchema": TeamToolService::update_task_input_schema(),
            "outputSchema": task_detail_success_schema(true)
        }),
        json!({
            "name": TEAM_LIST_TASKS_TOOL_NAME,
            "title": "List visible Tasks",
            "description": "Read a current Task snapshot visible to this Agent. Lead sees all; other members see their own and unassigned Tasks. This is not a waiting primitive: never combine it with sleep or repeated calls to poll for state changes.",
            "inputSchema": TeamToolService::list_tasks_input_schema(),
            "outputSchema": task_list_success_schema()
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
            "outputSchema": camp_search_success_schema(false)
        }),
        json!({
            "name": HISTORY_SEARCH_TOOL_NAME,
            "title": "Search authorized Camp history",
            "description": "Return a bounded Top-K of original public messages across other Camps frozen into this AgentRun and still authorized now. Camp titles are metadata, not hits. Use camp.read with stable IDs for evidence and sequence paging. Summaries and attachments are not searched.",
            "inputSchema": CampHistoryService::history_search_input_schema(),
            "outputSchema": camp_search_success_schema(true)
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
            "outputSchema": memory_search_success_schema()
        }),
        json!({
            "name": MEMORY_READ_TOOL_NAME,
            "title": "Read current Memory",
            "description": "Resolve stable Memory IDs against current Revision, lifecycle, Camp access, and Presence. Stale/deleted results never return old bodies.",
            "inputSchema": MemoryRetrievalService::read_input_schema(),
            "outputSchema": memory_read_success_schema()
        }),
        json!({
            "name": MEMORY_WRITE_TOOL_NAME,
            "title": "Write active partner Memory",
            "description": "Add an active Companion/Relationship Memory or publish a Revision to an accessible one. Hearth is not writable through this tool.",
            "inputSchema": MemoryToolService::write_input_schema(),
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["action", "memoryId", "revisionId", "effective"],
                "properties": {
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
                "required": ["proposalId", "status", "effective"],
                "properties": {
                    "proposalId": {"type": "string"}, "status": {"const": "pending"}, "effective": {"const": false}
                }
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::team_tool::TEAM_TOOL_NAMES;

    #[test]
    fn catalog_is_complete_and_contains_only_domain_schemas() {
        let definitions = builtin_tool_definitions();
        assert_eq!(definitions.len(), TEAM_TOOL_NAMES.len());
        assert_eq!(
            definitions
                .iter()
                .map(|definition| definition["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            TEAM_TOOL_NAMES
        );
        let serialized = serde_json::to_string(&definitions).unwrap();
        assert!(!serialized.contains("\"rovaiTeamTool\""));
        assert!(!serialized.contains("\"rovaiTeamReceipt\""));
        assert!(!serialized.contains("team.call_member"));
        assert!(!serialized.contains("rovai member call"));
    }

    #[test]
    fn retired_context_operations_are_not_accepted() {
        assert!(
            validate_builtin_tool_input(
                "context.search",
                &json!({
                    "query": "old"
                })
            )
            .is_err()
        );
        assert!(
            validate_builtin_tool_input(
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

    #[test]
    fn public_send_has_no_agent_supplied_camp_scope() {
        let send = builtin_tool_definitions()
            .into_iter()
            .find(|definition| definition["name"] == CAMP_MESSAGE_SEND_TOOL_NAME)
            .unwrap();
        assert_eq!(send["inputSchema"]["required"], json!(["body"]));
        assert!(send["inputSchema"]["properties"].get("campId").is_none());
        assert!(
            validate_builtin_tool_input(
                CAMP_MESSAGE_SEND_TOOL_NAME,
                &json!({"campId": "camp-legacy", "body": "hello"})
            )
            .is_err()
        );
        validate_builtin_tool_input(CAMP_MESSAGE_SEND_TOOL_NAME, &json!({"body": "hello"}))
            .unwrap();
    }

    #[test]
    fn ipc_input_validation_enforces_catalog_bounds_before_domain_dispatch() {
        assert!(
            validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"statuses": []}))
                .is_err()
        );
        assert!(
            validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"limit": 101})).is_err()
        );
        assert!(
            validate_builtin_tool_input(CAMP_MESSAGE_SEND_TOOL_NAME, &json!({"body": ""})).is_err()
        );
        validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"limit": 100})).unwrap();
    }
}
