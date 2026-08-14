use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::{
    builtin_tool_cli_output::validate_schema,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput,
    },
    camp_message_send_teaching::CAMP_MESSAGE_SEND_SUMMARY,
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MemoryReadInput, MemoryRetrievalService,
        MemorySearchInput,
    },
    memory_tool::{MEMORY_WRITE_TOOL_NAME, MemoryToolService, MemoryWriteToolInput},
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
            "attachmentOmittedCount", "addressing"
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
            "attachmentOmittedCount": {"type": "integer", "minimum": 0},
            "addressing": {
                "type": "object",
                "additionalProperties": false,
                "required": ["effectiveAgentRecipients", "mentionsCurrentUser"],
                "properties": {
                    "effectiveAgentRecipients": {
                        "type": "array", "maxItems": 16, "uniqueItems": true,
                        "items": {"type": "string"}
                    },
                    "mentionsCurrentUser": {"type": "boolean"}
                }
            }
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
                        "taskId", "title", "status", "assigneeAgentId", "availableActions"
                    ],
                    "properties": {
                        "taskId": {"type": "string"},
                        "title": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]
                        },
                        "assigneeAgentId": {"type": ["string", "null"]},
                        "availableActions": {
                            "type": "array",
                            "items": {"type": "string", "enum": ["update"]},
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
        "availableActions": {"type": "array", "uniqueItems": true, "items": {"type": "string", "enum": ["update"]}}
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
                    "oneOf": [
                        memory_search_result_schema("hearth", false),
                        memory_search_result_schema("companion", false),
                        memory_search_result_schema("relationship", true)
                    ]
                }
            }
        }
    })
}

fn memory_search_result_schema(scope: &str, relationship: bool) -> Value {
    let mut required = vec![
        "memoryId",
        "revisionId",
        "kind",
        "scope",
        "retrievalKeys",
        "snippet",
    ];
    let mut properties = json!({
        "memoryId": {"type": "string"},
        "revisionId": {"type": "string"},
        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
        "scope": {"const": scope},
        "retrievalKeys": {
            "type": "array",
            "items": {"type": "string"},
            "uniqueItems": true
        },
        "snippet": {"type": "string"}
    });
    if relationship {
        required.extend(["counterpartyAgentId", "direction"]);
        properties["counterpartyAgentId"] = json!({"type": "string"});
        properties["direction"] = json!({"type": "string", "enum": ["mutual", "directed"]});
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties
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
                    "oneOf": [
                        memory_read_authorized_schema("hearth", false),
                        memory_read_authorized_schema("companion", false),
                        memory_read_authorized_schema("relationship", true),
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["memoryId", "cacheState"],
                            "properties": {
                                "memoryId": {"type": "string"},
                                "cacheState": {
                                    "type": "string",
                                    "enum": ["inactive", "deleted", "access_changed", "unavailable"]
                                }
                            }
                        }
                    ]
                }
            }
        }
    })
}

fn memory_read_authorized_schema(scope: &str, relationship: bool) -> Value {
    let mut required = vec![
        "memoryId",
        "cacheState",
        "revisionId",
        "kind",
        "scope",
        "retrievalKeys",
        "body",
    ];
    let mut properties = json!({
        "memoryId": {"type": "string"},
        "cacheState": {"type": "string", "enum": ["current", "revision_changed"]},
        "revisionId": {"type": "string"},
        "kind": {"type": "string", "enum": ["preference", "agreement", "lesson"]},
        "scope": {"const": scope},
        "retrievalKeys": {
            "type": "array",
            "items": {"type": "string"},
            "uniqueItems": true
        },
        "body": {"type": "string"}
    });
    if relationship {
        required.extend(["counterpartyAgentId", "direction"]);
        properties["counterpartyAgentId"] = json!({"type": "string"});
        properties["direction"] = json!({"type": "string", "enum": ["mutual", "directed"]});
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties
    })
}

pub fn builtin_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": CAMP_MESSAGE_SEND_TOOL_NAME,
            "title": "Send a public Camp message",
            "description": CAMP_MESSAGE_SEND_SUMMARY,
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
            "description": "Create a durable Camp responsibility only when work must persist across AgentRuns or handoffs, has one explicit current Camp owner, and can independently complete, block, or transfer. Prefer advancing an existing Task. Do not create Tasks for analysis, consultation, one-off review, tool operations, local plans, A2A requests, or steps inside another Task. Only the User or current Default Lead may create. Creation does not notify, wake, or start the Assignee; use rovai send --task-id when execution must begin now.",
            "inputSchema": TeamToolService::create_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_GET_TASK_TOOL_NAME,
            "title": "Get a durable Task",
            "description": "Read one complete current Camp Task by stable taskId. Every current fenced Camp Agent has the same read scope; this read grants no write authority. Use it to obtain full content and current version before updating. availableActions is advisory capability metadata. Core authorization and field-level mutation rules are authoritative.",
            "inputSchema": TeamToolService::get_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_UPDATE_TASK_TOOL_NAME,
            "title": "Update a durable Task",
            "description": "Atomically update an authorized non-terminal Task using its current version. User/current Default Lead own responsibility definition; an ordinary current Assignee may update only status and its matching blockedReason or completionSummary on its own Task. availableActions is advisory capability metadata; Core authorization and field-level mutation rules are authoritative. A successful update does not wake an Assignee.",
            "inputSchema": TeamToolService::update_task_input_schema(),
            "outputSchema": task_detail_success_schema(true)
        }),
        json!({
            "name": TEAM_LIST_TASKS_TOOL_NAME,
            "title": "List Camp Tasks",
            "description": "Read a bounded page of minimal Task summaries for the current Camp. Every current fenced Camp Agent has the same read scope; this read grants no write authority. availableActions is advisory capability metadata. Core authorization and field-level mutation rules are authoritative. Use rovai task get for full content and current version. This is not a waiting primitive and must not be polled.",
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
            "description": "Search active Memory that is currently accessible to this Agent. Results are discovery hints, include immutable Scope identity for safe target selection, and do not include full bodies.",
            "inputSchema": MemoryRetrievalService::search_input_schema(),
            "outputSchema": memory_search_success_schema()
        }),
        json!({
            "name": MEMORY_READ_TOOL_NAME,
            "title": "Read current Memory",
            "description": "Resolve stable Memory IDs against current Revision, lifecycle, Camp access, and Presence. Authorized current results include immutable Scope identity; stale/deleted results never return old bodies or target identity.",
            "inputSchema": MemoryRetrievalService::read_input_schema(),
            "outputSchema": memory_read_success_schema()
        }),
        json!({
            "name": MEMORY_WRITE_TOOL_NAME,
            "title": "Write actor-bounded Memory",
            "description": "Add or revise Memory within the current Agent's authority. Revise must copy the exact immutable Scope identity from memory.read. Companion and directed Relationship writes are immediately effective; Hearth writes create a pending user Review Item.",
            "inputSchema": MemoryToolService::write_input_schema(),
            "outputSchema": {
                "oneOf": [
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["outcome", "memoryId", "revisionId"],
                        "properties": {
                            "outcome": {"const": "effective"},
                            "memoryId": {"type": "string"},
                            "revisionId": {"type": "string"}
                        }
                    },
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["outcome", "reviewItemId"],
                        "properties": {
                            "outcome": {"const": "review_pending"},
                            "reviewItemId": {"type": "string"}
                        }
                    }
                ]
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
            send["inputSchema"]["properties"]
                .get("replyToCampMessageId")
                .is_none()
        );
        assert!(
            validate_builtin_tool_input(
                CAMP_MESSAGE_SEND_TOOL_NAME,
                &json!({"campId": "camp-legacy", "body": "hello"})
            )
            .is_err()
        );
        assert!(
            validate_builtin_tool_input(
                CAMP_MESSAGE_SEND_TOOL_NAME,
                &json!({"body": "hello", "replyToCampMessageId": "message-legacy"})
            )
            .is_err()
        );
        validate_builtin_tool_input(CAMP_MESSAGE_SEND_TOOL_NAME, &json!({"body": "hello"}))
            .unwrap();
        validate_builtin_tool_input(
            CAMP_MESSAGE_SEND_TOOL_NAME,
            &json!({"body": "hello", "mentionUser": true}),
        )
        .unwrap();
        for forbidden in [
            "userId",
            "currentUserId",
            "attentionUserId",
            "mentionedUserId",
        ] {
            let mut input = json!({"body": "hello"});
            input
                .as_object_mut()
                .unwrap()
                .insert(forbidden.to_string(), json!("local_user"));
            assert!(
                validate_builtin_tool_input(CAMP_MESSAGE_SEND_TOOL_NAME, &input).is_err(),
                "{forbidden} must not cross the closed Agent input boundary"
            );
        }
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

    #[test]
    fn memory_revise_schema_requires_one_complete_scope_identity() {
        let old_shape = json!({
            "action": "revise",
            "memoryId": "memory_1",
            "baseRevisionId": "revision_1",
            "body": "Replacement durable agreement.",
            "retrievalKeys": ["replacement agreement"]
        });
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &old_shape).is_err());

        let mut companion = old_shape.clone();
        companion["scope"] = json!("companion");
        validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &companion).unwrap();

        let mut relationship = old_shape.clone();
        relationship["scope"] = json!("relationship");
        relationship["counterpartyAgentId"] = json!("agent_3");
        relationship["direction"] = json!("directed");
        validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &relationship).unwrap();
        relationship["direction"] = json!("mutual");
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &relationship).is_err());

        let mut hearth = old_shape;
        hearth["scope"] = json!("hearth");
        hearth["counterpartyAgentId"] = json!("agent_3");
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &hearth).is_err());
    }
}
