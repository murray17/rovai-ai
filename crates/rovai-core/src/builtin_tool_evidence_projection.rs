use anyhow::{Result, ensure};
use serde_json::{Map, Value, json};

use crate::{
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, HISTORY_SEARCH_TOOL_NAME,
    },
    command::canonical_json_digest,
    memory_retrieval::{MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME},
    memory_secret,
    memory_tool::{MEMORY_PROPOSE_HEARTH_TOOL_NAME, MEMORY_WRITE_TOOL_NAME},
    message_delivery::CAMP_MESSAGE_SEND_TOOL_NAME,
    team_tool::{
        TEAM_CREATE_TASK_TOOL_NAME, TEAM_GET_TASK_TOOL_NAME, TEAM_LIST_TASKS_TOOL_NAME,
        TEAM_UPDATE_TASK_TOOL_NAME,
    },
};

pub const BUILTIN_TOOL_EVIDENCE_PROJECTION_SCHEMA_VERSION: i64 = 1;

const SEMANTIC_TEXT_LIMIT_CHARS: usize = 512;
const IDENTIFIER_LIMIT_CHARS: usize = 256;
const STRING_ARRAY_LIMIT: usize = 32;
const RESULT_ITEM_LIMIT: usize = 64;
const ACCEPTANCE_CRITERION_LIMIT_CHARS: usize = 256;

/// Builds the only operation-specific Built-in Tool projection admitted to
/// Execution Evidence. The interface deliberately accepts the already-computed
/// raw digests and verifies them before projecting. This keeps the projection
/// useful for measurement without making it a second raw payload authority.
pub fn project_builtin_tool_invocation(
    operation: &str,
    raw_input: &Value,
    raw_result: Option<&Value>,
    raw_input_digest: &str,
    raw_result_digest: Option<&str>,
) -> Result<Value> {
    ensure!(
        canonical_json_digest(raw_input)? == raw_input_digest,
        "Built-in Tool Evidence input digest mismatch"
    );
    match (raw_result, raw_result_digest) {
        (Some(result), Some(expected)) => ensure!(
            canonical_json_digest(result)? == expected,
            "Built-in Tool Evidence result digest mismatch"
        ),
        (None, None) => {}
        _ => anyhow::bail!("Built-in Tool Evidence result and digest presence mismatch"),
    }

    let canonical_input = project_input(operation, raw_input)?;
    let canonical_result = raw_result
        .map(|result| project_result(operation, result))
        .transpose()?;
    let mut projection = json!({
        "schemaVersion": BUILTIN_TOOL_EVIDENCE_PROJECTION_SCHEMA_VERSION,
        "operation": operation,
        "canonicalInput": canonical_input,
        "canonicalResult": canonical_result,
        "digestBinding": {
            "input": {
                "evidenceField": "rawInputDigest",
                "digest": raw_input_digest,
            },
            "result": raw_result_digest.map(|digest| json!({
                "evidenceField": "rawOutputDigest",
                "digest": digest,
            })),
        },
        "inputDigest": raw_input_digest,
        "resultDigest": raw_result_digest,
    });
    let projection_digest = canonical_json_digest(&projection)?;
    projection["projectionDigest"] = json!(projection_digest);
    Ok(projection)
}

fn project_input(operation: &str, input: &Value) -> Result<Value> {
    let mut projected = Map::new();
    match operation {
        CAMP_MESSAGE_SEND_TOOL_NAME => {
            insert_string_array(&mut projected, "recipientAgentIds", input.get("to"));
            insert_bool(
                &mut projected,
                "mentionsCurrentUser",
                input.get("mentionUser"),
            );
            insert_identifier(&mut projected, "taskId", input.get("taskId"));
            insert_content_facts(&mut projected, input.get("body"));
        }
        TEAM_CREATE_TASK_TOOL_NAME => {
            insert_semantic_text(&mut projected, "title", input.get("title"));
            insert_semantic_text(&mut projected, "description", input.get("description"));
            insert_bounded_semantic_array(
                &mut projected,
                "acceptanceCriteria",
                input.get("acceptanceCriteria"),
                ACCEPTANCE_CRITERION_LIMIT_CHARS,
            );
            insert_identifier(
                &mut projected,
                "assigneeAgentId",
                input.get("assigneeAgentId"),
            );
        }
        TEAM_GET_TASK_TOOL_NAME => {
            insert_identifier(&mut projected, "taskId", input.get("taskId"));
        }
        TEAM_UPDATE_TASK_TOOL_NAME => {
            insert_identifier(&mut projected, "taskId", input.get("taskId"));
            insert_i64(
                &mut projected,
                "expectedVersion",
                input.get("expectedVersion"),
            );
            insert_enum(&mut projected, "requestedStatus", input.get("status"));
            insert_identifier(
                &mut projected,
                "assigneeAgentId",
                input.get("assigneeAgentId"),
            );
            insert_bool(&mut projected, "clearAssignee", input.get("clearAssignee"));
            insert_bool(
                &mut projected,
                "clearAcceptanceCriteria",
                input.get("clearAcceptanceCriteria"),
            );
            let changed_fields = [
                "title",
                "description",
                "acceptanceCriteria",
                "clearAcceptanceCriteria",
                "status",
                "assigneeAgentId",
                "clearAssignee",
                "blockedReason",
                "completionSummary",
                "cancelReason",
            ]
            .into_iter()
            .filter(|field| input.get(*field).is_some())
            .collect::<Vec<_>>();
            projected.insert("changedFields".to_string(), json!(changed_fields));
        }
        TEAM_LIST_TASKS_TOOL_NAME => {
            insert_string_array(&mut projected, "statuses", input.get("statuses"));
            insert_identifier(
                &mut projected,
                "assigneeAgentId",
                input.get("assigneeAgentId"),
            );
            insert_bool(
                &mut projected,
                "unassignedOnly",
                input.get("unassignedOnly"),
            );
            insert_i64(&mut projected, "limit", input.get("limit"));
            insert_opaque_cursor(&mut projected, input.get("cursor"));
        }
        CAMP_LIST_TOOL_NAME => {
            insert_query(&mut projected, input.get("query"));
            insert_i64(&mut projected, "limit", input.get("limit"));
        }
        CAMP_SEARCH_TOOL_NAME | MEMORY_SEARCH_TOOL_NAME => {
            insert_query(&mut projected, input.get("query"));
            insert_i64(&mut projected, "limit", input.get("limit"));
        }
        HISTORY_SEARCH_TOOL_NAME => {
            insert_query(&mut projected, input.get("query"));
            insert_string_array(&mut projected, "campIds", input.get("campIds"));
            insert_safe_string(&mut projected, "dateFrom", input.get("dateFrom"), 64);
            insert_safe_string(&mut projected, "dateTo", input.get("dateTo"), 64);
            insert_i64(&mut projected, "limit", input.get("limit"));
        }
        CAMP_READ_TOOL_NAME => {
            insert_identifier(&mut projected, "campId", input.get("campId"));
            insert_enum(&mut projected, "mode", input.get("mode"));
            insert_identifier(&mut projected, "messageId", input.get("messageId"));
            insert_enum(&mut projected, "direction", input.get("direction"));
            for field in [
                "cursor",
                "limit",
                "before",
                "after",
                "bodyOffset",
                "bodyLimit",
            ] {
                insert_i64(&mut projected, field, input.get(field));
            }
        }
        MEMORY_READ_TOOL_NAME => {
            insert_string_array(&mut projected, "memoryIds", input.get("memoryIds"));
        }
        MEMORY_WRITE_TOOL_NAME => {
            project_memory_mutation_input(&mut projected, input, true);
        }
        MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
            project_memory_mutation_input(&mut projected, input, false);
        }
        _ => anyhow::bail!("unsupported Built-in Tool Evidence operation: {operation}"),
    }
    Ok(Value::Object(projected))
}

fn project_memory_mutation_input(
    projected: &mut Map<String, Value>,
    input: &Value,
    relationship: bool,
) {
    insert_enum(projected, "action", input.get("action"));
    insert_enum(projected, "scope", input.get("scope"));
    insert_enum(projected, "kind", input.get("kind"));
    insert_semantic_text(projected, "body", input.get("body"));
    insert_bounded_semantic_array(projected, "retrievalKeys", input.get("retrievalKeys"), 64);
    insert_identifier(projected, "memoryId", input.get("memoryId"));
    insert_identifier(projected, "baseRevisionId", input.get("baseRevisionId"));
    if relationship {
        insert_identifier(
            projected,
            "counterpartyAgentId",
            input.get("counterpartyAgentId"),
        );
        insert_enum(projected, "direction", input.get("direction"));
    }
}

fn project_result(operation: &str, result: &Value) -> Result<Value> {
    let mut projected = Map::new();
    match operation {
        CAMP_MESSAGE_SEND_TOOL_NAME => {
            insert_enum(&mut projected, "status", result.get("status"));
            insert_identifier(&mut projected, "messageId", result.get("messageId"));
            insert_identifier(&mut projected, "campTurnId", result.get("campTurnId"));
            insert_string_array(
                &mut projected,
                "effectiveRecipients",
                result.get("effectiveRecipients"),
            );
            insert_string_array(&mut projected, "deliveryIds", result.get("deliveryIds"));
            insert_i64(
                &mut projected,
                "allocatedAgentRunResponsibilities",
                result.get("allocatedAgentRunResponsibilities"),
            );
        }
        TEAM_CREATE_TASK_TOOL_NAME | TEAM_GET_TASK_TOOL_NAME | TEAM_UPDATE_TASK_TOOL_NAME => {
            project_task_result(&mut projected, result);
        }
        TEAM_LIST_TASKS_TOOL_NAME => {
            let tasks = project_object_array(result.get("tasks"), project_task_item);
            projected.insert("tasks".to_string(), Value::Array(tasks.values));
            projected.insert("taskCount".to_string(), json!(tasks.total));
            projected.insert("tasksTruncated".to_string(), json!(tasks.truncated));
            insert_bool(&mut projected, "truncated", result.get("truncated"));
            insert_cursor_facts(&mut projected, result.get("nextCursor"));
        }
        CAMP_LIST_TOOL_NAME => {
            let camps = project_object_array(result.get("camps"), |item| {
                let mut value = Map::new();
                insert_identifier(&mut value, "campId", item.get("campId"));
                Value::Object(value)
            });
            projected.insert("camps".to_string(), Value::Array(camps.values));
            projected.insert("campCount".to_string(), json!(camps.total));
            projected.insert("campsTruncated".to_string(), json!(camps.truncated));
            insert_bool(&mut projected, "truncated", result.get("truncated"));
        }
        CAMP_SEARCH_TOOL_NAME | HISTORY_SEARCH_TOOL_NAME => {
            let messages = project_object_array(result.get("results"), project_search_result);
            projected.insert("results".to_string(), Value::Array(messages.values));
            projected.insert("resultCount".to_string(), json!(messages.total));
            projected.insert("resultsTruncated".to_string(), json!(messages.truncated));
            insert_bool(&mut projected, "truncated", result.get("truncated"));
            insert_bool(
                &mut projected,
                "searchIncomplete",
                result.get("searchIncomplete"),
            );
        }
        CAMP_READ_TOOL_NAME => {
            insert_identifier(&mut projected, "campId", result.get("campId"));
            insert_enum(&mut projected, "mode", result.get("mode"));
            insert_identifier(
                &mut projected,
                "anchorMessageId",
                result.get("anchorMessageId"),
            );
            insert_identifier(
                &mut projected,
                "threadRootMessageId",
                result.get("threadRootMessageId"),
            );
            insert_enum(&mut projected, "direction", result.get("direction"));
            let items = project_object_array(result.get("items"), project_read_item);
            projected.insert("items".to_string(), Value::Array(items.values));
            projected.insert("itemCount".to_string(), json!(items.total));
            projected.insert("itemsTruncated".to_string(), json!(items.truncated));
            for field in ["hasMore", "hasMoreBefore", "hasMoreAfter"] {
                insert_bool(&mut projected, field, result.get(field));
            }
            insert_i64(&mut projected, "nextCursor", result.get("nextCursor"));
        }
        MEMORY_SEARCH_TOOL_NAME => {
            let memories = project_object_array(result.get("results"), project_memory_result);
            projected.insert("results".to_string(), Value::Array(memories.values));
            projected.insert("resultCount".to_string(), json!(memories.total));
            projected.insert("resultsTruncated".to_string(), json!(memories.truncated));
        }
        MEMORY_READ_TOOL_NAME => {
            let memories = project_object_array(result.get("memories"), project_memory_result);
            projected.insert("memories".to_string(), Value::Array(memories.values));
            projected.insert("memoryCount".to_string(), json!(memories.total));
            projected.insert("memoriesTruncated".to_string(), json!(memories.truncated));
        }
        MEMORY_WRITE_TOOL_NAME => {
            insert_identifier(&mut projected, "memoryId", result.get("memoryId"));
            insert_identifier(&mut projected, "revisionId", result.get("revisionId"));
            insert_i64(&mut projected, "version", result.get("version"));
        }
        MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
            insert_identifier(&mut projected, "proposalId", result.get("proposalId"));
            insert_enum(&mut projected, "status", result.get("status"));
            insert_bool(&mut projected, "effective", result.get("effective"));
            insert_i64(&mut projected, "version", result.get("version"));
        }
        _ => anyhow::bail!("unsupported Built-in Tool Evidence operation: {operation}"),
    }
    Ok(Value::Object(projected))
}

fn project_task_result(projected: &mut Map<String, Value>, result: &Value) {
    insert_identifier(projected, "taskId", result.get("taskId"));
    insert_enum(projected, "status", result.get("status"));
    insert_identifier(projected, "assigneeAgentId", result.get("assigneeAgentId"));
    insert_i64(projected, "version", result.get("version"));
    insert_bool(projected, "changed", result.get("changed"));
}

fn project_task_item(item: &Value) -> Value {
    let mut projected = Map::new();
    project_task_result(&mut projected, item);
    Value::Object(projected)
}

fn project_search_result(item: &Value) -> Value {
    let mut projected = Map::new();
    insert_identifier(&mut projected, "campId", item.get("campId"));
    insert_identifier(&mut projected, "messageId", item.get("messageId"));
    insert_i64(&mut projected, "sequence", item.get("sequence"));
    insert_identifier(
        &mut projected,
        "replyToMessageId",
        item.get("replyToMessageId"),
    );
    Value::Object(projected)
}

fn project_read_item(item: &Value) -> Value {
    let mut projected = Map::new();
    insert_identifier(&mut projected, "messageId", item.get("messageId"));
    insert_i64(&mut projected, "sequence", item.get("sequence"));
    insert_identifier(
        &mut projected,
        "replyToMessageId",
        item.get("replyToMessageId"),
    );
    for field in ["bodyOffset", "bodyLength", "nextBodyOffset"] {
        insert_i64(&mut projected, field, item.get(field));
    }
    insert_bool(&mut projected, "bodyTruncated", item.get("bodyTruncated"));
    if let Some(addressing) = item.get("addressing") {
        let mut projected_addressing = Map::new();
        insert_string_array(
            &mut projected_addressing,
            "effectiveAgentRecipients",
            addressing.get("effectiveAgentRecipients"),
        );
        insert_bool(
            &mut projected_addressing,
            "mentionsCurrentUser",
            addressing.get("mentionsCurrentUser"),
        );
        projected.insert(
            "addressing".to_string(),
            Value::Object(projected_addressing),
        );
    }
    Value::Object(projected)
}

fn project_memory_result(item: &Value) -> Value {
    let mut projected = Map::new();
    insert_identifier(&mut projected, "memoryId", item.get("memoryId"));
    insert_identifier(&mut projected, "revisionId", item.get("revisionId"));
    insert_enum(&mut projected, "cacheState", item.get("cacheState"));
    insert_enum(&mut projected, "kind", item.get("kind"));
    Value::Object(projected)
}

struct ProjectedArray {
    values: Vec<Value>,
    total: usize,
    truncated: bool,
}

fn project_object_array(
    source: Option<&Value>,
    project: impl Fn(&Value) -> Value,
) -> ProjectedArray {
    let source = source
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    ProjectedArray {
        values: source.iter().take(RESULT_ITEM_LIMIT).map(project).collect(),
        total: source.len(),
        truncated: source.len() > RESULT_ITEM_LIMIT,
    }
}

fn insert_query(projected: &mut Map<String, Value>, value: Option<&Value>) {
    insert_safe_string(projected, "query", value, SEMANTIC_TEXT_LIMIT_CHARS);
}

fn insert_semantic_text(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    insert_safe_string(projected, field, value, SEMANTIC_TEXT_LIMIT_CHARS);
}

fn insert_safe_string(
    projected: &mut Map<String, Value>,
    field: &str,
    value: Option<&Value>,
    limit: usize,
) {
    let Some(value) = value.and_then(Value::as_str) else {
        return;
    };
    projected.insert(format!("{field}CharCount"), json!(value.chars().count()));
    if contains_projection_secret(value) {
        projected.insert(format!("{field}Redacted"), json!(true));
        return;
    }
    let (bounded, truncated) = truncate_chars(value, limit);
    projected.insert(field.to_string(), json!(bounded));
    projected.insert(format!("{field}Truncated"), json!(truncated));
}

fn insert_identifier(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    insert_safe_string(projected, field, value, IDENTIFIER_LIMIT_CHARS);
}

fn insert_enum(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    insert_safe_string(projected, field, value, 64);
}

fn insert_bool(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_bool) {
        projected.insert(field.to_string(), json!(value));
    }
}

fn insert_i64(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_i64) {
        projected.insert(field.to_string(), json!(value));
    }
}

fn insert_string_array(projected: &mut Map<String, Value>, field: &str, value: Option<&Value>) {
    let Some(values) = value.and_then(Value::as_array) else {
        return;
    };
    let mut safe = Vec::new();
    let mut redacted_count = 0usize;
    for value in values.iter().take(STRING_ARRAY_LIMIT) {
        let Some(value) = value.as_str() else {
            redacted_count += 1;
            continue;
        };
        if value.chars().count() > IDENTIFIER_LIMIT_CHARS || contains_projection_secret(value) {
            redacted_count += 1;
        } else {
            safe.push(Value::String(value.to_string()));
        }
    }
    projected.insert(field.to_string(), Value::Array(safe));
    projected.insert(format!("{field}Count"), json!(values.len()));
    projected.insert(
        format!("{field}OmittedCount"),
        json!(values.len().saturating_sub(STRING_ARRAY_LIMIT) + redacted_count),
    );
}

fn insert_bounded_semantic_array(
    projected: &mut Map<String, Value>,
    field: &str,
    value: Option<&Value>,
    item_limit: usize,
) {
    let Some(values) = value.and_then(Value::as_array) else {
        return;
    };
    let mut safe = Vec::new();
    let mut redacted_count = 0usize;
    let mut truncated_count = 0usize;
    for value in values.iter().take(STRING_ARRAY_LIMIT) {
        let Some(value) = value.as_str() else {
            redacted_count += 1;
            continue;
        };
        if contains_projection_secret(value) {
            redacted_count += 1;
            continue;
        }
        let (bounded, truncated) = truncate_chars(value, item_limit);
        truncated_count += usize::from(truncated);
        safe.push(Value::String(bounded));
    }
    projected.insert(field.to_string(), Value::Array(safe));
    projected.insert(format!("{field}Count"), json!(values.len()));
    projected.insert(
        format!("{field}OmittedCount"),
        json!(values.len().saturating_sub(STRING_ARRAY_LIMIT) + redacted_count),
    );
    projected.insert(format!("{field}TruncatedCount"), json!(truncated_count));
}

fn insert_content_facts(projected: &mut Map<String, Value>, value: Option<&Value>) {
    let Some(value) = value.and_then(Value::as_str) else {
        return;
    };
    projected.insert("contentCharCount".to_string(), json!(value.chars().count()));
    projected.insert(
        "contentDigest".to_string(),
        json!(canonical_json_digest(&Value::String(value.to_string())).ok()),
    );
    projected.insert(
        "contentSecretDetected".to_string(),
        json!(contains_projection_secret(value)),
    );
}

fn insert_opaque_cursor(projected: &mut Map<String, Value>, value: Option<&Value>) {
    let Some(value) = value.and_then(Value::as_str) else {
        return;
    };
    projected.insert("cursorPresent".to_string(), json!(true));
    projected.insert("cursorCharCount".to_string(), json!(value.chars().count()));
}

fn insert_cursor_facts(projected: &mut Map<String, Value>, value: Option<&Value>) {
    let present = value.is_some_and(|value| !value.is_null());
    projected.insert("nextCursorPresent".to_string(), json!(present));
}

fn truncate_chars(value: &str, limit: usize) -> (String, bool) {
    let mut chars = value.chars();
    let bounded = chars.by_ref().take(limit).collect::<String>();
    (bounded, chars.next().is_some())
}

fn contains_projection_secret(value: &str) -> bool {
    if memory_secret::contains_secret(value) {
        return true;
    }
    let lower = value.to_ascii_lowercase();
    [
        "authorization:",
        "authorization=",
        "bindingcredential",
        "binding_credential",
        "requesttoken",
        "request_token",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(value: &Value) -> String {
        canonical_json_digest(value).unwrap()
    }

    fn projection(operation: &str, input: Value, result: Value) -> Value {
        let input_digest = digest(&input);
        let result_digest = digest(&result);
        project_builtin_tool_invocation(
            operation,
            &input,
            Some(&result),
            &input_digest,
            Some(&result_digest),
        )
        .unwrap()
    }

    #[test]
    fn camp_search_projects_bounded_query_and_result_identities_without_snippets() {
        let projected = projection(
            CAMP_SEARCH_TOOL_NAME,
            json!({"query": "handoff decision", "limit": 4}),
            json!({
                "results": [{
                    "campId": "camp-1",
                    "messageId": "message-1",
                    "sequence": 9,
                    "snippet": "private full search result"
                }],
                "truncated": false,
                "searchIncomplete": false
            }),
        );
        assert_eq!(projected["canonicalInput"]["query"], "handoff decision");
        assert_eq!(
            projected["canonicalResult"]["results"][0]["messageId"],
            "message-1"
        );
        assert!(
            !serde_json::to_string(&projected)
                .unwrap()
                .contains("private full search result")
        );
    }

    #[test]
    fn memory_results_project_revision_and_cache_state_without_body() {
        let projected = projection(
            MEMORY_READ_TOOL_NAME,
            json!({"memoryIds": ["memory-1"]}),
            json!({"memories": [{
                "memoryId": "memory-1",
                "revisionId": "revision-2",
                "cacheState": "revision_changed",
                "kind": "lesson",
                "body": "private durable memory body"
            }]}),
        );
        let result = &projected["canonicalResult"]["memories"][0];
        assert_eq!(result["memoryId"], "memory-1");
        assert_eq!(result["revisionId"], "revision-2");
        assert_eq!(result["cacheState"], "revision_changed");
        assert!(
            !serde_json::to_string(&projected)
                .unwrap()
                .contains("private durable memory body")
        );
    }

    #[test]
    fn a2a_send_projects_current_identity_recipients_and_message_receipt() {
        let projected = projection(
            CAMP_MESSAGE_SEND_TOOL_NAME,
            json!({
                "body": "Please review the patch",
                "to": ["agent_5"],
                "mentionUser": true,
                "taskId": "task-1"
            }),
            json!({
                "status": "accepted",
                "messageId": "message-1",
                "campTurnId": "turn-1",
                "effectiveRecipients": ["agent_5"],
                "deliveryIds": ["delivery-1"],
                "allocatedAgentRunResponsibilities": 2,
                "recipientPresentation": {"private": "not measurement evidence"}
            }),
        );
        assert_eq!(projected["operation"], "camp.message.send");
        assert_eq!(
            projected["canonicalInput"]["recipientAgentIds"][0],
            "agent_5"
        );
        assert_eq!(projected["canonicalInput"]["mentionsCurrentUser"], true);
        assert_eq!(projected["canonicalResult"]["messageId"], "message-1");
        assert_eq!(
            projected["canonicalResult"]["effectiveRecipients"][0],
            "agent_5"
        );
        assert_eq!(projected["canonicalResult"]["deliveryIds"][0], "delivery-1");
        assert!(
            !serde_json::to_string(&projected)
                .unwrap()
                .contains("Please review the patch")
        );
    }

    #[test]
    fn projection_excludes_credentials_and_redacts_detected_secret_semantics() {
        let input = json!({
            "query": "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
            "limit": 2,
            "bindingCredential": "credential-must-never-persist",
            "requestToken": "request-token-must-never-persist"
        });
        let result = json!({"results": []});
        let projected = projection(MEMORY_SEARCH_TOOL_NAME, input, result);
        let encoded = serde_json::to_string(&projected).unwrap();
        assert_eq!(projected["canonicalInput"]["queryRedacted"], true);
        assert!(!encoded.contains("abcdefghijklmnopqrstuvwxyz"));
        assert!(!encoded.contains("credential-must-never-persist"));
        assert!(!encoded.contains("request-token-must-never-persist"));
        assert!(!encoded.contains("bindingCredential"));
        assert!(!encoded.contains("requestToken"));
    }

    #[test]
    fn projection_verifies_source_digests_and_bounds_semantic_text() {
        let input = json!({"query": "x".repeat(2_000)});
        let result = json!({"results": []});
        let input_digest = digest(&input);
        let result_digest = digest(&result);
        let projected = project_builtin_tool_invocation(
            CAMP_SEARCH_TOOL_NAME,
            &input,
            Some(&result),
            &input_digest,
            Some(&result_digest),
        )
        .unwrap();
        assert_eq!(
            projected["canonicalInput"]["query"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            SEMANTIC_TEXT_LIMIT_CHARS
        );
        assert_eq!(projected["canonicalInput"]["queryTruncated"], true);

        assert!(
            project_builtin_tool_invocation(
                CAMP_SEARCH_TOOL_NAME,
                &input,
                Some(&result),
                "wrong-input-digest",
                Some(&result_digest),
            )
            .is_err()
        );
        assert!(
            project_builtin_tool_invocation(
                CAMP_SEARCH_TOOL_NAME,
                &input,
                Some(&result),
                &input_digest,
                Some("wrong-result-digest"),
            )
            .is_err()
        );

        let mut digest_document = projected.clone();
        let persisted_digest = digest_document
            .as_object_mut()
            .unwrap()
            .remove("projectionDigest")
            .unwrap();
        assert_eq!(
            persisted_digest,
            canonical_json_digest(&digest_document).unwrap()
        );
    }

    #[test]
    fn result_projection_rejects_raw_bodies_snippets_tokens_headers_and_unbounded_items() {
        let projected = projection(
            CAMP_SEARCH_TOOL_NAME,
            json!({"query": "find the review", "limit": 20}),
            json!({
                "results": (0..100).map(|index| json!({
                    "campId": "camp-1",
                    "messageId": format!("message-{index}"),
                    "sequence": index,
                    "body": "RAW_BODY_MUST_NOT_PERSIST",
                    "snippet": "RAW_SNIPPET_MUST_NOT_PERSIST",
                    "requestToken": "RAW_REQUEST_TOKEN_MUST_NOT_PERSIST",
                    "headers": {
                        "Authorization": "Bearer RAW_AUTHORIZATION_MUST_NOT_PERSIST"
                    }
                })).collect::<Vec<_>>(),
                "truncated": false,
                "searchIncomplete": false,
                "body": "TOP_LEVEL_RAW_BODY_MUST_NOT_PERSIST",
                "snippet": "TOP_LEVEL_RAW_SNIPPET_MUST_NOT_PERSIST",
                "token": "TOP_LEVEL_RAW_TOKEN_MUST_NOT_PERSIST",
                "authorization": "TOP_LEVEL_RAW_AUTHORIZATION_MUST_NOT_PERSIST"
            }),
        );
        let encoded = serde_json::to_string(&projected).unwrap();
        for forbidden in [
            "RAW_BODY_MUST_NOT_PERSIST",
            "RAW_SNIPPET_MUST_NOT_PERSIST",
            "RAW_REQUEST_TOKEN_MUST_NOT_PERSIST",
            "RAW_AUTHORIZATION_MUST_NOT_PERSIST",
            "TOP_LEVEL_RAW_BODY_MUST_NOT_PERSIST",
            "TOP_LEVEL_RAW_SNIPPET_MUST_NOT_PERSIST",
            "TOP_LEVEL_RAW_TOKEN_MUST_NOT_PERSIST",
            "TOP_LEVEL_RAW_AUTHORIZATION_MUST_NOT_PERSIST",
            "Authorization",
            "requestToken",
        ] {
            assert!(!encoded.contains(forbidden), "leaked {forbidden}");
        }
        assert_eq!(
            projected["canonicalResult"]["results"]
                .as_array()
                .unwrap()
                .len(),
            RESULT_ITEM_LIMIT
        );
        assert_eq!(projected["canonicalResult"]["resultCount"], 100);
        assert_eq!(projected["canonicalResult"]["resultsTruncated"], true);
    }

    #[test]
    fn projection_redacts_transport_identity_markers_even_without_known_token_prefixes() {
        for query in [
            "requestToken=opaque-value-not-a-known-prefix",
            "bindingCredential: opaque-value-not-a-known-prefix",
            "Authorization: <redacted>",
        ] {
            let projected = projection(
                MEMORY_SEARCH_TOOL_NAME,
                json!({"query": query}),
                json!({"results": []}),
            );
            assert_eq!(projected["canonicalInput"]["queryRedacted"], true);
            assert!(!serde_json::to_string(&projected).unwrap().contains(query));
        }
    }
}
