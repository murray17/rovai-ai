use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::{
    automation::{
        AUTOMATION_CLOSE_TOOL_NAME, AUTOMATION_CREATE_TOOL_NAME, AUTOMATION_DELETE_TOOL_NAME,
        AUTOMATION_GET_TOOL_NAME, AUTOMATION_LIST_TOOL_NAME, AUTOMATION_RUN_TOOL_NAME,
        AUTOMATION_UPDATE_TOOL_NAME, AutomationCreateToolInput, AutomationGetToolInput,
        AutomationListToolInput, AutomationRunToolInput, AutomationUpdateToolInput,
        AutomationVersionedToolInput,
    },
    builtin_tool_cli_output::validate_schema,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput,
    },
    camp_message_send_teaching::CAMP_MESSAGE_SEND_SUMMARY,
    member_studio::{MEMBER_CREATE_TOOL_NAME, MemberCreateInput, member_create_input_schema},
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MEMORY_VIEW_TOOL_NAME, MemoryReadInput,
        MemoryRetrievalService, MemorySearchInput, MemoryViewInput,
    },
    memory_tool::{MEMORY_WRITE_TOOL_NAME, MemoryToolService, MemoryWriteToolInput},
    message_delivery::CAMP_MESSAGE_SEND_TOOL_NAME,
    single_chat::{SINGLE_CHAT_HISTORY_TOOL_NAME, SingleChatHistoryInput, SingleChatService},
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
        MEMBER_CREATE_TOOL_NAME => {
            serde_json::from_value::<MemberCreateInput>(input.clone()).map(|_| ())
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
        SINGLE_CHAT_HISTORY_TOOL_NAME => {
            serde_json::from_value::<SingleChatHistoryInput>(input.clone()).map(|_| ())
        }
        MEMORY_SEARCH_TOOL_NAME => {
            serde_json::from_value::<MemorySearchInput>(input.clone()).map(|_| ())
        }
        MEMORY_READ_TOOL_NAME => {
            serde_json::from_value::<MemoryReadInput>(input.clone()).map(|_| ())
        }
        MEMORY_VIEW_TOOL_NAME => {
            serde_json::from_value::<MemoryViewInput>(input.clone()).map(|_| ())
        }
        MEMORY_WRITE_TOOL_NAME => {
            serde_json::from_value::<MemoryWriteToolInput>(input.clone()).map(|_| ())
        }
        "mission.list" => {
            serde_json::from_value::<crate::mission::MissionListInput>(input.clone()).map(|_| ())
        }
        "mission.get" => {
            serde_json::from_value::<crate::mission::MissionGetInput>(input.clone()).map(|_| ())
        }
        "mission.update" => {
            serde_json::from_value::<crate::mission::MissionUpdateInput>(input.clone()).map(|_| ())
        }
        "mission.status" => {
            serde_json::from_value::<crate::mission::MissionStatusInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_LIST_TOOL_NAME => {
            serde_json::from_value::<AutomationListToolInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_GET_TOOL_NAME => {
            serde_json::from_value::<AutomationGetToolInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_CREATE_TOOL_NAME => {
            serde_json::from_value::<AutomationCreateToolInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_RUN_TOOL_NAME => {
            serde_json::from_value::<AutomationRunToolInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_CLOSE_TOOL_NAME | AUTOMATION_DELETE_TOOL_NAME => {
            serde_json::from_value::<AutomationVersionedToolInput>(input.clone()).map(|_| ())
        }
        AUTOMATION_UPDATE_TOOL_NAME => {
            serde_json::from_value::<AutomationUpdateToolInput>(input.clone()).map(|_| ())
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
        "anchorMessageId": {"type": ["string", "null"]},
        "createdAt": {"type": "string", "format": "date-time"},
        "snippet": {"type": "string", "maxLength": 200},
        "quotes": crate::message_quote::model_quotes_schema("camp_messages")
    });
    let mut required = vec![
        "campId",
        "messageId",
        "sequence",
        "authorType",
        "authorId",
        "anchorMessageId",
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
            "messageId", "sequence", "authorType", "authorId", "anchorMessageId",
            "createdAt", "body", "attachmentCount"
        ],
        "properties": {
            "messageId": {"type": "string"},
            "sequence": {"type": "integer", "minimum": 1},
            "authorType": {"type": "string"},
            "authorId": {"type": "string"},
            "anchorMessageId": {"type": ["string", "null"]},
            "createdAt": {"type": "string", "format": "date-time"},
            "body": {"type": "string"},
            "quotes": crate::message_quote::model_quotes_schema("camp_messages"),
            "attachmentCount": {"type": "integer", "minimum": 0}
        }
    })
}

fn withdrawn_message_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["messageId", "sequence", "withdrawn", "displayText"],
        "properties": {
            "messageId": {"type": "string"},
            "sequence": {"type": "integer", "minimum": 1},
            "withdrawn": {"const": true},
            "displayText": {"const": "Message withdrawn"}
        }
    })
}

fn camp_read_attachment_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "attachmentId", "name", "kind", "fileCount", "mediaType", "byteSize"
        ],
        "properties": {
            "attachmentId": {"type": "string"},
            "name": {"type": "string"},
            "kind": {"type": "string"},
            "fileCount": {"type": ["integer", "null"], "minimum": 0},
            "mediaType": {"type": ["string", "null"]},
            "byteSize": {"type": ["integer", "null"], "minimum": 0},
            "path": {"type": "string"}
        }
    })
}

fn item_message_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "messageId", "sequence", "authorType", "authorId", "anchorMessageId",
            "createdAt", "body", "attachmentCount", "attachments", "attachmentsTruncated",
            "attachmentOmittedCount", "addressing"
        ],
        "properties": {
            "messageId": {"type": "string"},
            "sequence": {"type": "integer", "minimum": 1},
            "authorType": {"type": "string"},
            "authorId": {"type": "string"},
            "anchorMessageId": {"type": ["string", "null"]},
            "createdAt": {"type": "string", "format": "date-time"},
            "body": {"type": "string"},
            "quotes": crate::message_quote::model_quotes_schema("camp_messages"),
            "attachmentCount": {"type": "integer", "minimum": 0},
            "attachments": {
                "type": "array", "maxItems": 10,
                "items": camp_read_attachment_schema()
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
                "items": {"oneOf": [item_message_schema(), withdrawn_message_schema()]}
            }
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
            "items": {"type": "array", "maxItems": 100,
                "items": {"oneOf": [collection_message_schema(), withdrawn_message_schema()]}},
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
            "items": {"type": "array", "maxItems": 100,
                "items": {"oneOf": [collection_message_schema(), withdrawn_message_schema()]}},
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

fn member_create_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["agentId", "version", "avatarRef", "avatarStatus"],
        "properties": {
            "agentId": {"type": "string"},
            "version": {"type": "integer", "minimum": 1},
            "avatarRef": {"type": ["string", "null"]},
            "avatarStatus": {"type": "string", "enum": ["saved", "not_requested"]}
        }
    })
}

fn task_detail_success_schema(include_changed: bool) -> Value {
    let mut required = vec![
        "taskId",
        "campId",
        "title",
        "description",
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
        "description": {"type": "string", "maxLength": 16000},
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
    let kinds = if relationship {
        json!(["agreement", "lesson"])
    } else {
        json!(["preference", "agreement", "lesson"])
    };
    let mut properties = json!({
        "memoryId": {"type": "string"},
        "revisionId": {"type": "string"},
        "kind": {"type": "string", "enum": kinds},
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
                        memory_read_authorized_schema("hearth", None, true),
                        memory_read_authorized_schema("companion", None, true),
                        memory_read_authorized_schema("relationship", Some("directed"), true),
                        memory_read_authorized_schema("relationship", Some("mutual"), false),
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

fn memory_read_authorized_schema(
    scope: &str,
    relationship_direction: Option<&str>,
    agent_can_revise: bool,
) -> Value {
    let required = vec![
        "memoryId",
        "cacheState",
        "target",
        "kind",
        "agentCanRevise",
        "retrievalKeys",
        "body",
    ];
    let kinds = if relationship_direction.is_some() {
        json!(["agreement", "lesson"])
    } else {
        json!(["preference", "agreement", "lesson"])
    };
    let properties = json!({
        "memoryId": {"type": "string"},
        "cacheState": {"type": "string", "enum": ["current", "revision_changed"]},
        "target": memory_target_schema(scope, relationship_direction),
        "kind": {"type": "string", "enum": kinds},
        "agentCanRevise": {"const": agent_can_revise},
        "retrievalKeys": {
            "type": "array",
            "items": {"type": "string"},
            "uniqueItems": true
        },
        "body": {"type": "string"}
    });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties
    })
}

fn memory_target_schema(scope: &str, relationship_direction: Option<&str>) -> Value {
    let mut required = vec!["memoryId", "revisionId", "scope"];
    let mut properties = json!({
        "memoryId": {"type": "string"},
        "revisionId": {"type": "string"},
        "scope": {"const": scope}
    });
    if let Some(direction) = relationship_direction {
        required.extend(["counterpartyAgentId", "direction"]);
        properties["counterpartyAgentId"] = json!({"type": "string"});
        properties["direction"] = json!({"const": direction});
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties
    })
}

fn automation_identifier_schema() -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 256})
}

fn automation_notify_schema() -> Value {
    json!({
        "type": "array", "maxItems": 2, "uniqueItems": true,
        "items": {"type": "string", "enum": ["feishu", "lark", "dingtalk"]}
    })
}

fn automation_time_schema() -> Value {
    json!({"type": "string", "pattern": "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"})
}

fn automation_project_ref_schema() -> Value {
    json!({
        "oneOf": [
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind"],
                "properties": {"kind": {"const": "quick_chat"}}
            },
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind", "path"],
                "properties": {
                    "kind": {"const": "directory"},
                    "path": {"type": "string", "minLength": 1}
                }
            }
        ]
    })
}

fn automation_stored_schedule_schema() -> Value {
    let timed = |kind: &str| {
        json!({
            "type": "object", "additionalProperties": false,
            "required": ["kind", "at"],
            "properties": {"kind": {"const": kind}, "at": automation_time_schema()}
        })
    };
    json!({
        "oneOf": [
            timed("daily"),
            timed("weekdays"),
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind", "weekday", "at"],
                "properties": {
                    "kind": {"const": "weekly"},
                    "weekday": {"type": "string", "enum": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]},
                    "at": automation_time_schema()
                }
            },
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind", "date", "at"],
                "properties": {
                    "kind": {"const": "once"},
                    "date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
                    "at": automation_time_schema()
                }
            },
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind", "expression"],
                "properties": {
                    "kind": {"const": "cron"},
                    "expression": {"type": "string", "minLength": 1, "maxLength": 128}
                }
            },
            {
                "type": "object", "additionalProperties": false,
                "required": ["kind"],
                "properties": {"kind": {"const": "manual"}}
            }
        ]
    })
}

fn automation_run_summary_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["runId", "status", "reason", "scheduledFor", "campId", "resultMessageId", "notificationStatus", "createdAt", "endedAt"],
        "properties": {
            "runId": {"type": "string", "minLength": 1},
            "status": {"type": "string", "enum": ["running", "cancelling", "completed", "failed", "skipped"]},
            "reason": {"type": ["string", "null"]},
            "scheduledFor": {"type": "string"},
            "campId": {"type": ["string", "null"]},
            "resultMessageId": {"type": ["string", "null"]},
            "notificationStatus": {"type": "string", "enum": ["none", "pending", "sent", "failed", "partial"]},
            "createdAt": {"type": "string"},
            "endedAt": {"type": ["string", "null"]}
        }
    })
}

fn automation_schedule_schema() -> Value {
    let common = json!({
        "name": {"type": "string", "maxLength": 80},
        "prompt": {"type": "string", "minLength": 1, "maxLength": 100000},
        "member": {"type": "string", "minLength": 1},
        "project": {"type": "string", "minLength": 1},
        "notify": automation_notify_schema()
    });
    let properties = |repeat: &str| {
        let mut value = common.clone();
        value["repeat"] = json!({"const": repeat});
        value
    };
    let mut daily = properties("daily");
    daily["at"] = automation_time_schema();
    let mut weekdays = properties("weekdays");
    weekdays["at"] = daily["at"].clone();
    let mut weekly = properties("weekly");
    weekly["at"] = daily["at"].clone();
    weekly["weekday"] = json!({"type": "string", "enum": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]});
    let mut once = properties("once");
    once["at"] = daily["at"].clone();
    once["date"] = json!({"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"});
    let mut cron = properties("cron");
    cron["cron"] = json!({"type": "string", "minLength": 1, "maxLength": 128});
    json!({
        "oneOf": [
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat", "at"], "properties": daily},
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat", "at"], "properties": weekdays},
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat", "weekday", "at"], "properties": weekly},
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat", "date", "at"], "properties": once},
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat", "cron"], "properties": cron},
            {"type": "object", "additionalProperties": false, "required": ["prompt", "repeat"], "properties": properties("manual")}
        ]
    })
}

fn automation_view_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["automationId", "version", "name", "prompt", "enabled", "memberId", "projectRef", "schedule", "notifyChannels", "nextRunAt", "lastRun", "createdAt", "updatedAt"],
        "properties": {
            "automationId": automation_identifier_schema(),
            "version": {"type": "integer", "minimum": 1},
            "name": {"type": "string", "maxLength": 80},
            "prompt": {"type": "string", "minLength": 1, "maxLength": 100000},
            "enabled": {"type": "boolean"},
            "memberId": {"type": "string", "minLength": 1},
            "projectRef": automation_project_ref_schema(),
            "schedule": automation_stored_schedule_schema(),
            "notifyChannels": automation_notify_schema(),
            "nextRunAt": {"type": ["string", "null"]},
            "lastRun": {"oneOf": [automation_run_summary_schema(), {"type": "null"}]},
            "createdAt": {"type": "string"},
            "updatedAt": {"type": "string"}
        }
    })
}

fn automation_update_input_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["automationId", "expectedVersion"],
        "properties": {
            "automationId": automation_identifier_schema(),
            "expectedVersion": {"type": "integer", "minimum": 1},
            "name": {"type": "string", "maxLength": 80},
            "prompt": {"type": "string", "minLength": 1, "maxLength": 100000},
            "member": {"type": "string", "minLength": 1},
            "project": {"type": "string", "minLength": 1},
            "repeat": {"type": "string", "enum": ["daily", "weekdays", "weekly", "once", "cron", "manual"]},
            "at": {"type": "string"},
            "weekday": {"type": "string", "enum": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]},
            "date": {"type": "string"},
            "cron": {"type": "string"},
            "notify": automation_notify_schema(),
            "clearNotify": {"type": "boolean"},
            "enabled": {"type": "boolean"}
        }
    })
}

fn memory_view_success_schema() -> Value {
    json!({
        "oneOf": [
            memory_view_scope_schema("hearth", false, 32, 16 * 1024),
            memory_view_scope_schema("companion", false, 32, 16 * 1024),
            memory_view_scope_schema("relationship", true, 12, 12 * 1024)
        ]
    })
}

fn memory_view_scope_schema(
    scope: &str,
    relationship: bool,
    max_items: usize,
    max_body_bytes: usize,
) -> Value {
    let item_schema = if relationship {
        json!({
            "oneOf": [
                memory_view_item_schema(scope, Some("directed"), true),
                memory_view_item_schema(scope, Some("mutual"), false)
            ]
        })
    } else {
        memory_view_item_schema(scope, None, true)
    };
    let mut required = vec!["scope", "complete", "itemCount", "totalBodyBytes", "items"];
    let mut properties = json!({
        "scope": {"const": scope},
        "complete": {"const": true},
        "itemCount": {"type": "integer", "minimum": 0, "maximum": max_items},
        "totalBodyBytes": {"type": "integer", "minimum": 0, "maximum": max_body_bytes},
        "items": {
            "type": "array",
            "maxItems": max_items,
            "items": item_schema
        }
    });
    if relationship {
        required.push("counterpartyAgentId");
        properties["counterpartyAgentId"] = json!({"type": "string"});
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties
    })
}

fn memory_view_item_schema(
    scope: &str,
    relationship_direction: Option<&str>,
    agent_can_revise: bool,
) -> Value {
    let kinds = if relationship_direction.is_some() {
        json!(["agreement", "lesson"])
    } else {
        json!(["preference", "agreement", "lesson"])
    };
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["target", "kind", "retrievalKeys", "body", "agentCanRevise"],
        "properties": {
            "target": memory_target_schema(scope, relationship_direction),
            "kind": {"type": "string", "enum": kinds},
            "retrievalKeys": {
                "type": "array", "minItems": 1, "maxItems": 3,
                "uniqueItems": true, "items": {"type": "string"}
            },
            "body": {"type": "string"},
            "agentCanRevise": {"const": agent_can_revise}
        }
    })
}

fn mission_mutation_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["missionId","changed"],"properties":{"missionId":{"type":"string"},"changed":{"type":"boolean"}}})
}

fn mission_attachment_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "attachmentId", "name", "kind", "fileCount", "mediaType", "byteSize", "path"
        ],
        "properties": {
            "attachmentId": {"type": "string"},
            "name": {"type": "string"},
            "kind": {"type": "string", "enum": ["file", "directory"]},
            "fileCount": {"type": ["integer", "null"], "minimum": 0},
            "mediaType": {"type": ["string", "null"]},
            "byteSize": {"type": ["integer", "null"], "minimum": 0},
            "path": {"type": "string"}
        }
    })
}

fn mission_status_schema() -> Value {
    json!({"type":"string","enum":["needs_you","not_started","in_progress","completed"]})
}

fn mission_list_success_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["missions", "nextCursor", "hasMore"],
        "properties": {
            "missions": {
                "type": "array",
                "maxItems": crate::mission::MISSION_LIST_MAX_LIMIT,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["missionId", "campId", "title", "status", "updatedAt"],
                    "properties": {
                        "missionId": {"type": "string"},
                        "campId": {"type": "string"},
                        "title": {"type": "string"},
                        "status": mission_status_schema(),
                        "updatedAt": {"type": "string", "format": "date-time"}
                    }
                }
            },
            "nextCursor": {"type": ["string", "null"]},
            "hasMore": {"type": "boolean"}
        }
    })
}

pub fn builtin_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "mission.list",
            "title": "List Missions",
            "description": "List all Missions in this Rovai instance, newest first. Use mission get for details.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "query": {"type": "string", "minLength": 1, "maxLength": 200, "description": "Title substring or exact Mission ID."},
                    "status": mission_status_schema(),
                    "limit": {"type": "integer", "minimum": 1, "maximum": crate::mission::MISSION_LIST_MAX_LIMIT, "description": "Default 20; maximum 50."},
                    "cursor": {"type": "string", "minLength": 1, "maxLength": 2048, "description": "Continue with the same filters."}
                }
            },
            "outputSchema": mission_list_success_schema()
        }),
        json!({
            "name": "mission.get",
            "title": "Read a Mission",
            "description": "Read any Mission in this Rovai instance. Omit --mission-id for the current Camp's Mission. Reading does not switch context.\n\nAttachments include saved metadata and source paths, not live file checks.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "missionId": {"type": "string", "minLength": 1, "maxLength": 128, "description": "Optional opaque Mission ID returned by mission list or Run Facts, for example rvm_example."}
                }
            },
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["missionId", "title", "description", "status", "sourceMessageId", "attachments"],
                "properties": {
                    "missionId": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "status": mission_status_schema(),
                    "sourceMessageId": {"type": ["string", "null"]},
                    "attachments": {"type": "array", "items": mission_attachment_schema()}
                }
            }
        }),
        json!({"name":"mission.update","title":"Update the current Mission","description":"Update the current Mission's title or description without starting work.","inputSchema":{"type":"object","additionalProperties":false,"anyOf":[{"required":["title"]},{"required":["description"]}],"properties":{"title":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string","maxLength":12000}}},"outputSchema":mission_mutation_schema()}),
        json!({"name":"mission.status","title":"Set the current Mission status","description":"Set the current Mission's status without starting or stopping work.","inputSchema":{"type":"object","additionalProperties":false,"required":["status"],"properties":{"status":{"type":"string","enum":["needs_you","not_started","in_progress","completed"],"description":"One of: needs_you, not_started, in_progress, completed."},"sourceMessageId":{"type":"string","minLength":1,"description":"Optional reference to an existing public message in this Camp."}}},"outputSchema":mission_mutation_schema()}),
        json!({
            "name": AUTOMATION_LIST_TOOL_NAME,
            "title": "List scheduled Automations",
            "description": "List a bounded page of the local user's scheduled Automations. Filter by enabled state, name or prompt text, and stable project reference. This read does not run or modify a task.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "status": {"type": "string", "enum": ["all", "enabled", "closed"]},
                    "query": {"type": "string"},
                    "project": {"type": "string", "minLength": 1},
                    "cursor": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50}
                }
            },
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["automations", "nextCursor", "truncated"],
                "properties": {
                    "automations": {"type": "array", "maxItems": 50, "items": automation_view_schema()},
                    "nextCursor": {"type": ["string", "null"]},
                    "truncated": {"type": "boolean"}
                }
            }
        }),
        json!({
            "name": AUTOMATION_GET_TOOL_NAME,
            "title": "Get one scheduled Automation",
            "description": "Read one Automation by stable ID. Use automationId=current only from a conversation created by that Automation.",
            "inputSchema": {
                "type": "object", "additionalProperties": false, "required": ["automationId"],
                "properties": {"automationId": automation_identifier_schema()}
            },
            "outputSchema": automation_view_schema()
        }),
        json!({
            "name": AUTOMATION_CREATE_TOOL_NAME,
            "title": "Create a scheduled Automation",
            "description": "Create and enable one durable Automation only when the user explicitly asks. member defaults to the current Agent; project defaults to the current Camp project or Quick Chat. Times use the device timezone; notify may include feishu and dingtalk.",
            "inputSchema": automation_schedule_schema(),
            "outputSchema": automation_view_schema()
        }),
        json!({
            "name": AUTOMATION_RUN_TOOL_NAME,
            "title": "Run an Automation now",
            "description": "Run one enabled Automation immediately only when the user explicitly asks. A successful start creates a new ordinary conversation; an overlapping run is skipped.",
            "inputSchema": {
                "type": "object", "additionalProperties": false, "required": ["automationId"],
                "properties": {"automationId": automation_identifier_schema()}
            },
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["status", "runId", "campId", "conversationId", "reason"],
                "properties": {
                    "status": {"type": "string", "enum": ["started", "skipped", "failed"]},
                    "runId": {"type": "string"},
                    "campId": {"type": ["string", "null"]},
                    "conversationId": {"type": ["string", "null"]},
                    "reason": {"type": ["string", "null"]}
                }
            }
        }),
        json!({
            "name": AUTOMATION_CLOSE_TOOL_NAME,
            "title": "Close a scheduled Automation",
            "description": "Disable one Automation only when the user explicitly asks, using its current version. Existing claimed runs continue to their terminal state.",
            "inputSchema": {
                "type": "object", "additionalProperties": false, "required": ["automationId", "expectedVersion"],
                "properties": {"automationId": automation_identifier_schema(), "expectedVersion": {"type": "integer", "minimum": 1}}
            },
            "outputSchema": automation_view_schema()
        }),
        json!({
            "name": AUTOMATION_UPDATE_TOOL_NAME,
            "title": "Update a scheduled Automation",
            "description": "Update one Automation only when the user explicitly asks, using its current version. Omitted fields stay unchanged. notify replaces all channels; clear-notify removes all. Providing repeat replaces the full schedule.",
            "inputSchema": automation_update_input_schema(),
            "outputSchema": automation_view_schema()
        }),
        json!({
            "name": AUTOMATION_DELETE_TOOL_NAME,
            "title": "Delete a scheduled Automation",
            "description": "Permanently delete one Automation definition only when the user explicitly asks, using its current version. Existing run conversations and immutable run history remain available.",
            "inputSchema": {
                "type": "object", "additionalProperties": false, "required": ["automationId", "expectedVersion"],
                "properties": {"automationId": automation_identifier_schema(), "expectedVersion": {"type": "integer", "minimum": 1}}
            },
            "outputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["automationId", "deleted"],
                "properties": {"automationId": {"type": "string"}, "deleted": {"const": true}}
            }
        }),
        json!({
            "name": CAMP_MESSAGE_SEND_TOOL_NAME,
            "title": "Send a public Camp message",
            "description": CAMP_MESSAGE_SEND_SUMMARY,
            "inputSchema": TeamToolService::camp_message_send_input_schema(),
            "outputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                    "status", "messageId", "visibility",
                    "agentAddressingMode",
                    "effectiveRecipients", "recipientPresentation", "recipientSetDigest",
                    "deliveryIds", "attachments"
                ],
                "properties": {
                    "status": {"const": "accepted"},
                    "messageId": {"type": "string"},
                    "visibility": {"const": "camp_public"},
                    "anchorMessageId": {"type": ["string", "null"]},
                    "agentAddressingMode": {
                        "type": "string",
                        "enum": ["automatic", "public_only"]
                    },
                    "effectiveRecipients": {
                        "type": "array", "uniqueItems": true,
                        "items": {"type": "string"}
                    },
                    "recipientPresentation": {"type": "object"},
                    "recipientSetDigest": {"type": "string"},
                    "deliveryIds": {
                        "type": "array", "uniqueItems": true,
                        "items": {"type": "string"}
                    },
                    "attachments": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": false,
                            "required": ["attachmentId", "path"],
                            "properties": {
                                "attachmentId": {"type": "string"},
                                "path": {"type": "string"}
                            }
                        }
                    }
                }
            }
        }),
        json!({
            "name": MEMBER_CREATE_TOOL_NAME,
            "title": "Create a confirmed Rovai member",
            "description": "Create one durable Rovai member from the final member card only after the user explicitly confirms it in this direct user-triggered run. Reuse creationKey only for an exact retry. avatarFile is optional and must name a run-readable local PNG or JPEG; Rovai safely normalizes and imports it without persisting the path. If image preparation is unavailable or fails, retry without avatarFile to use the default avatar.",
            "inputSchema": member_create_input_schema(),
            "outputSchema": member_create_success_schema()
        }),
        json!({
            "name": TEAM_CREATE_TASK_TOOL_NAME,
            "title": "Create a durable Task",
            "description": "Create an independently owned task that persists across runs or handoffs.\nPrefer existing tasks; do not create tasks for one-off collaboration or local steps.\nUser/Default Lead only. Put scope and requirements in description.\nDoes not notify or start work; use rovai send --task-id.",
            "inputSchema": TeamToolService::create_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_GET_TASK_TOOL_NAME,
            "title": "Get a durable Task",
            "description": "Read a task's current content, status and owner in this Camp.",
            "inputSchema": TeamToolService::get_task_input_schema(),
            "outputSchema": task_detail_success_schema(false)
        }),
        json!({
            "name": TEAM_UPDATE_TASK_TOOL_NAME,
            "title": "Update a durable Task",
            "description": "Update explicit fields of a non-terminal task.\nUser/Default Lead may edit task content, assignment and status.\nOther assignees may update only their own status and matching blockedReason or completionSummary.\nDoes not notify or start work.",
            "inputSchema": TeamToolService::update_task_input_schema(),
            "outputSchema": task_detail_success_schema(true)
        }),
        json!({
            "name": TEAM_LIST_TASKS_TOOL_NAME,
            "title": "List Camp Tasks",
            "description": "List task summaries in this Camp. Use task get for details. Do not poll.",
            "inputSchema": TeamToolService::list_tasks_input_schema(),
            "outputSchema": task_list_success_schema()
        }),
        json!({
            "name": CAMP_LIST_TOOL_NAME,
            "title": "Discover other Camps",
            "description": "Return a bounded Top-K of other public Camps frozen into this AgentRun. Target-Camp membership is not a read permission. Search only frozen Camp names; omit query for recent Camps. This tool never searches messages and never paginates.",
            "inputSchema": CampHistoryService::camp_list_input_schema(),
            "outputSchema": camp_list_success_schema()
        }),
        json!({
            "name": CAMP_SEARCH_TOOL_NAME,
            "title": "Search one public Camp timeline",
            "description": "Search one public Camp timeline. Omit campId to search the current Camp, or pass any extant public Camp ID; target-Camp membership is not a read permission. Search is discovery, not traversal: use a stable messageId with camp.read. Summaries and attachments are not searched.",
            "inputSchema": CampHistoryService::camp_search_input_schema(),
            "outputSchema": camp_search_success_schema(false)
        }),
        json!({
            "name": HISTORY_SEARCH_TOOL_NAME,
            "title": "Search public Camp history",
            "description": "Discover messages across public historical Camps when the target Camp is unknown. Target-Camp membership is not a read permission. Camp titles are metadata, not hits. Once a Camp is known, prefer camp.search and camp.read with stable IDs. Summaries and attachments are not searched.",
            "inputSchema": CampHistoryService::history_search_input_schema(),
            "outputSchema": camp_search_success_schema(true)
        }),
        json!({
            "name": CAMP_READ_TOOL_NAME,
            "title": "Read public Camp messages",
            "description": "Read messages from exactly one public Camp. Target-Camp membership is not a read permission. With no message selector, return the newest published messages from the current or explicitly selected Camp; use before as the exclusive sequence cursor. The default limit is 20; an explicit limit must be an integer from 1 to 100. Recallable messages remain readable until withdrawn; a withdrawn message returns a Message withdrawn marker without its original content. Use messageId for one exact message, or thread for a thread page ending before the optional cursor. Reuse nextCursor as before. IDs and cursors never bypass the publication boundary.",
            "inputSchema": CampHistoryService::camp_read_input_schema(),
            "outputSchema": camp_read_success_schema()
        }),
        json!({
            "name": SINGLE_CHAT_HISTORY_TOOL_NAME,
            "title": "Read current Single Chat history",
            "description": "Read a bounded page of user and assistant messages before CURRENT_INPUT in the active Single Chat. Core derives the conversation from the authenticated current Run and caps every requested boundary at the current input sequence. This operation does not read execution evidence or mutate any Conversation state.",
            "inputSchema": SingleChatService::history_input_schema(),
            "outputSchema": SingleChatService::history_output_schema()
        }),
        json!({
            "name": MEMORY_VIEW_TOOL_NAME,
            "title": "View one complete Memory scope",
            "description": "Return the complete current applicable Memory set for Hearth, this Agent's Companion, or one exact Relationship pair. The result is never paginated or truncated; copy one returned target unchanged into memory.write revise.",
            "inputSchema": MemoryRetrievalService::view_input_schema(),
            "outputSchema": memory_view_success_schema()
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
            "description": "Resolve stable Memory IDs against current Revision, lifecycle, Camp access, and Presence. Authorized current results include one copyable target; stale/deleted results never return old bodies or target identity.",
            "inputSchema": MemoryRetrievalService::read_input_schema(),
            "outputSchema": memory_read_success_schema()
        }),
        json!({
            "name": MEMORY_WRITE_TOOL_NAME,
            "title": "Write actor-bounded Memory",
            "description": "Add or revise Memory within the current Agent's authority. Revise must copy the exact target from the deciding memory.view or current memory.read result. Companion and directed Relationship writes are immediately effective; Hearth writes create a pending user Review Item.",
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
    fn task_descriptions_and_input_schemas_use_the_current_copy() {
        let definitions = builtin_tool_definitions();
        let definition = |name: &str| {
            definitions
                .iter()
                .find(|definition| definition["name"] == name)
                .unwrap()
        };
        let create = definition(TEAM_CREATE_TASK_TOOL_NAME);
        let update = definition(TEAM_UPDATE_TASK_TOOL_NAME);
        assert_eq!(create["description"], create["inputSchema"]["description"]);
        assert_eq!(update["description"], update["inputSchema"]["description"]);
        assert_eq!(
            definition(TEAM_GET_TASK_TOOL_NAME)["description"],
            "Read a task's current content, status and owner in this Camp."
        );
        assert_eq!(
            definition(TEAM_LIST_TASKS_TOOL_NAME)["description"],
            "List task summaries in this Camp. Use task get for details. Do not poll."
        );
        for current in [create, update] {
            assert_eq!(
                current["inputSchema"]["properties"]["description"]["description"],
                "Task scope and requirements."
            );
        }
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
                    "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
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
    fn single_chat_history_accepts_only_its_bounded_cursor_shape() {
        for valid in [json!({}), json!({"beforeSequence": 12, "limit": 50})] {
            validate_builtin_tool_input(SINGLE_CHAT_HISTORY_TOOL_NAME, &valid).unwrap();
        }
        for invalid in [
            json!({"conversationId": "conversation-1"}),
            json!({"campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf"}),
            json!({"agentId": "agent_1"}),
            json!({"beforeSequence": 0}),
            json!({"limit": 51}),
        ] {
            assert!(validate_builtin_tool_input(SINGLE_CHAT_HISTORY_TOOL_NAME, &invalid).is_err());
        }
    }

    #[test]
    fn public_send_has_no_agent_supplied_camp_scope() {
        let send = builtin_tool_definitions()
            .into_iter()
            .find(|definition| definition["name"] == CAMP_MESSAGE_SEND_TOOL_NAME)
            .unwrap();
        assert!(send["inputSchema"].get("required").is_none());
        assert_eq!(send["inputSchema"]["properties"]["body"]["default"], "");
        assert_eq!(
            send["inputSchema"]["properties"]["files"]["default"],
            json!([])
        );
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
            &json!({"files": ["report.pdf"]}),
        )
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
        for input in [
            json!({
                "title": "legacy",
                "assigneeAgentId": "agent_1",
                "acceptanceCriteria": ["removed"]
            }),
            json!({
                "taskId": "task_1",
                "expectedVersion": 1,
                "clearAcceptanceCriteria": true
            }),
        ] {
            let operation = if input.get("taskId").is_some() {
                TEAM_UPDATE_TASK_TOOL_NAME
            } else {
                TEAM_CREATE_TASK_TOOL_NAME
            };
            assert!(
                validate_builtin_tool_input(operation, &input).is_err(),
                "legacy Task fields must be rejected: {input}"
            );
        }
        validate_builtin_tool_input(
            TEAM_CREATE_TASK_TOOL_NAME,
            &json!({
                "title": "long description",
                "description": "x".repeat(16_000),
                "assigneeAgentId": "agent_1"
            }),
        )
        .unwrap();
        assert!(
            validate_builtin_tool_input(
                TEAM_CREATE_TASK_TOOL_NAME,
                &json!({
                    "title": "too long",
                    "description": "x".repeat(16_001),
                    "assigneeAgentId": "agent_1"
                })
            )
            .is_err()
        );
        assert!(
            validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"statuses": []}))
                .is_err()
        );
        assert!(
            validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"limit": 101})).is_err()
        );
        validate_builtin_tool_input(CAMP_MESSAGE_SEND_TOOL_NAME, &json!({"body": ""})).unwrap();
        validate_builtin_tool_input(TEAM_LIST_TASKS_TOOL_NAME, &json!({"limit": 100})).unwrap();
        validate_builtin_tool_input("mission.list", &json!({})).unwrap();
        validate_builtin_tool_input(
            "mission.list",
            &json!({"query": "rvm_example", "status": "in_progress", "limit": 50}),
        )
        .unwrap();
        validate_builtin_tool_input("mission.get", &json!({})).unwrap();
        validate_builtin_tool_input("mission.get", &json!({"missionId": "rvm_example"})).unwrap();
        validate_builtin_tool_input("mission.update", &json!({"description": ""})).unwrap();
        validate_builtin_tool_input("mission.status", &json!({"status": "in_progress"})).unwrap();
        for (operation, input) in [
            ("mission.get", json!({"version": 1})),
            ("mission.list", json!({"limit": 51})),
            ("mission.list", json!({"query": ""})),
            ("mission.update", json!({})),
            ("mission.update", json!({"title": "x", "version": 1})),
            (
                "mission.update",
                json!({"title": "x", "workingDirectory": "/tmp"}),
            ),
            ("mission.status", json!({"status": "running"})),
            (
                "mission.status",
                json!({"status": "completed", "sourceMessageId": ""}),
            ),
        ] {
            assert!(
                validate_builtin_tool_input(operation, &input).is_err(),
                "{operation}: {input}"
            );
        }
    }

    #[test]
    fn camp_search_and_read_accept_an_omitted_or_explicit_single_camp_target() {
        validate_builtin_tool_input(CAMP_SEARCH_TOOL_NAME, &json!({"query": "amount"})).unwrap();
        validate_builtin_tool_input(
            CAMP_SEARCH_TOOL_NAME,
            &json!({
                "campId": "7b5db24c-4a43-4cab-9217-d982b08f7691",
                "query": "amount"
            }),
        )
        .unwrap();
        validate_builtin_tool_input(CAMP_READ_TOOL_NAME, &json!({"messageId": "message_123"}))
            .unwrap();
        validate_builtin_tool_input(
            CAMP_READ_TOOL_NAME,
            &json!({
                "campId": "7b5db24c-4a43-4cab-9217-d982b08f7691",
                "before": 42,
                "limit": 20
            }),
        )
        .unwrap();
        validate_builtin_tool_input(
            CAMP_READ_TOOL_NAME,
            &json!({"thread": "message_123", "limit": 100}),
        )
        .unwrap();
        validate_builtin_tool_input(CAMP_READ_TOOL_NAME, &json!({"limit": 100})).unwrap();
        for invalid in [json!(0), json!(101), json!(-1), json!(1.5), json!("20")] {
            assert!(
                validate_builtin_tool_input(CAMP_READ_TOOL_NAME, &json!({"limit": invalid}))
                    .is_err()
            );
        }
        for legacy in [
            json!({"mode": "timeline"}),
            json!({"direction": "before"}),
            json!({"cursor": 42}),
            json!({"after": 5}),
        ] {
            assert!(validate_builtin_tool_input(CAMP_READ_TOOL_NAME, &legacy).is_err());
        }
    }

    #[test]
    fn camp_read_output_contract_distinguishes_original_and_withdrawn_items() {
        let schema = camp_read_success_schema();
        let mut item = json!({
            "campId": "camp_123",
            "mode": "item",
            "items": [{
                "messageId": "message_123",
                "sequence": 1,
                "authorType": "agent",
                "authorId": "agent_1",
                "anchorMessageId": null,
                "createdAt": "2026-08-18T00:00:00Z",
                "body": "evidence",
                "attachmentCount": 1,
                "attachments": [{
                    "attachmentId": "attachment_123",
                    "name": "notes.txt",
                    "kind": "file",
                    "fileCount": 1,
                    "mediaType": "text/plain",
                    "byteSize": 8
                }],
                "attachmentsTruncated": false,
                "attachmentOmittedCount": 0,
                "addressing": {
                    "effectiveAgentRecipients": ["agent_1"],
                    "mentionsCurrentUser": false
                }
            }]
        });
        crate::builtin_tool_cli_output::validate_schema(&item, &schema).unwrap();
        item["items"][0]["attachments"][0]
            .as_object_mut()
            .unwrap()
            .remove("kind");
        assert!(crate::builtin_tool_cli_output::validate_schema(&item, &schema).is_err());

        let mut withdrawn = json!({
            "campId": "camp_123",
            "mode": "item",
            "items": [{
                "messageId": "message_123",
                "sequence": 1,
                "withdrawn": true,
                "displayText": "Message withdrawn"
            }]
        });
        crate::builtin_tool_cli_output::validate_schema(&withdrawn, &schema).unwrap();
        withdrawn["items"][0]["body"] = json!("erased content");
        assert!(crate::builtin_tool_cli_output::validate_schema(&withdrawn, &schema).is_err());
    }

    #[test]
    fn memory_revise_schema_requires_one_complete_copyable_target() {
        let old_shape = json!({
            "action": "revise",
            "memoryId": "memory_1",
            "baseRevisionId": "revision_1",
            "body": "Replacement durable agreement.",
            "retrievalKeys": ["replacement agreement"]
        });
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &old_shape).is_err());

        let companion = json!({
            "action": "revise",
            "target": {
                "memoryId": "memory_1",
                "revisionId": "revision_1",
                "scope": "companion"
            },
            "body": "Replacement durable agreement.",
            "retrievalKeys": ["replacement agreement"]
        });
        validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &companion).unwrap();

        let mut relationship = companion.clone();
        relationship["target"] = json!({
            "memoryId": "memory_1",
            "revisionId": "revision_1",
            "scope": "relationship",
            "counterpartyAgentId": "agent_3",
            "direction": "directed"
        });
        validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &relationship).unwrap();
        relationship["target"]["direction"] = json!("mutual");
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &relationship).is_err());

        let mut hearth = companion;
        hearth["target"] = json!({
            "memoryId": "memory_1",
            "revisionId": "revision_1",
            "scope": "hearth",
            "counterpartyAgentId": "agent_3"
        });
        assert!(validate_builtin_tool_input(MEMORY_WRITE_TOOL_NAME, &hearth).is_err());
    }
}
