use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};

use crate::{
    builtin_tool_transport::{BuiltinToolError, BuiltinToolInvocationEnvelope},
    team_tool_catalog::builtin_tool_definitions,
};

/// Builds the fixed Agent-facing error for a mutation whose outcome cannot be proven.
pub fn outcome_indeterminate_agent_error() -> Value {
    json!({
        "error": {
            "code": "builtin_tool.outcome_indeterminate",
            "message": "The operation may already have committed. Confirm the exact current state before proceeding; do not blindly repeat the mutation. If confirmation is unavailable, report the uncertainty.",
            "recovery": "confirm_outcome"
        }
    })
}

/// Builds the fixed Agent-facing error used only after Core returned a complete
/// result that the CLI could not validate against its closed output contract.
pub fn output_contract_mismatch_agent_error(operation: &str) -> Value {
    json!({
        "error": {
            "code": "builtin_tool.output_contract_mismatch",
            "message": "The operation completed, but its result could not be safely projected.",
            "recovery": "stop",
            "details": {
                "operation": operation
            }
        }
    })
}

/// Builds the closed Agent-facing success schema for one canonical operation.
///
/// Most operations deliberately reuse their canonical business-result schema. The two compact
/// projections are explicit exceptions; this function is the single catalog-facing definition of
/// those exceptions and is never a recursive field filter.
pub fn agent_output_schema(operation: &str) -> Result<Value> {
    match operation {
        "camp.message.send" => Ok(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["messageId", "agentAddressingMode", "effectiveRecipients", "deliveryIds"],
            "properties": {
                "messageId": {"type": "string"},
                "agentAddressingMode": {
                    "type": "string",
                    "enum": ["automatic", "public_only"]
                },
                "effectiveRecipients": {
                    "type": "array",
                    "uniqueItems": true,
                    "items": {"type": "string"}
                },
                "attachments": {
                    "type": "array",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["attachmentId", "path"],
                        "properties": {"attachmentId": {"type": "string"}, "path": {"type": "string"}}
                    }
                },
                "deliveryIds": {
                    "type": "array",
                    "uniqueItems": true,
                    "items": {"type": "string"}
                }
            }
        })),
        "memory.write" => Ok(json!({
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
        })),
        "team.create_task" => Ok(task_mutation_agent_schema(false)),
        "team.get_task" => Ok(task_get_agent_schema()),
        "team.update_task" => Ok(task_mutation_agent_schema(true)),
        "team.list_tasks" => Ok(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["tasks", "nextCursor", "truncated"],
            "properties": {
                "tasks": {"type": "array", "items": task_mutation_agent_schema(false)},
                "nextCursor": {"type": ["string", "null"]},
                "truncated": {"type": "boolean"}
            }
        })),
        "member.create"
        | "camp.list"
        | "camp.search"
        | "camp.read"
        | "history.search"
        | "memory.view"
        | "memory.search"
        | "memory.read"
        | "single_chat.history"
        | "mission.list"
        | "mission.get"
        | "mission.update"
        | "mission.status"
        | "automation.list"
        | "automation.get"
        | "automation.create"
        | "automation.run"
        | "automation.close"
        | "automation.update"
        | "automation.delete" => builtin_tool_definitions()
            .into_iter()
            .find(|definition| definition["name"].as_str() == Some(operation))
            .map(|definition| definition["outputSchema"].clone())
            .context("unknown built-in operation for Agent output schema"),
        _ => bail!("unknown built-in operation for Agent output schema"),
    }
}

pub fn project_envelope(envelope: BuiltinToolInvocationEnvelope) -> Result<Value> {
    envelope.validate()?;
    let BuiltinToolInvocationEnvelope {
        ok,
        operation,
        result,
        error,
        ..
    } = envelope;
    let projected = if ok {
        let result = result.context("successful Built-in Tool envelope has no result")?;
        project_success(&operation, result)?
    } else {
        let error = error.context("rejected Built-in Tool envelope has no error")?;
        project_error(&error)?
    };
    validate_projected_document(&operation, ok, &projected)?;
    Ok(projected)
}

fn project_success(operation: &str, result: Value) -> Result<Value> {
    match operation {
        "camp.message.send" => {
            let object = result
                .as_object()
                .context("Canonical Operation Result must be an object")?;
            let mut projected = json!({
            "messageId": object
                .get("messageId")
                .context("camp.message.send result has no messageId")?,
            "agentAddressingMode": object
                .get("agentAddressingMode")
                .context("camp.message.send result has no agentAddressingMode")?,
            "effectiveRecipients": object
                .get("effectiveRecipients")
                .context("camp.message.send result has no effectiveRecipients")?,
            "deliveryIds": object
                .get("deliveryIds")
                .context("camp.message.send result has no deliveryIds")?,
            });
            if let Some(attachments) = object
                .get("attachments")
                .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()))
            {
                projected["attachments"] = attachments.clone();
            }
            Ok(projected)
        }
        "memory.write" => match result
            .as_object()
            .context("Canonical Operation Result must be an object")?
            .get("outcome")
            .and_then(Value::as_str)
        {
            Some("effective") => Ok(json!({
                "outcome": "effective",
                "memoryId": result
                    .as_object()
                    .expect("memory result was checked above")
                    .get("memoryId")
                    .context("effective memory.write result has no memoryId")?,
                "revisionId": result
                    .as_object()
                    .expect("memory result was checked above")
                    .get("revisionId")
                    .context("effective memory.write result has no revisionId")?,
            })),
            Some("review_pending") => Ok(json!({
                "outcome": "review_pending",
                "reviewItemId": result
                    .as_object()
                    .expect("memory result was checked above")
                    .get("reviewItemId")
                    .context("pending memory.write result has no reviewItemId")?,
            })),
            _ => bail!("memory.write result has an unknown outcome"),
        },
        "team.create_task" => project_task_mutation(
            result
                .as_object()
                .context("Canonical Operation Result must be an object")?,
            false,
        ),
        "team.get_task" => project_task_get(
            result
                .as_object()
                .context("Canonical Operation Result must be an object")?,
        ),
        "team.update_task" => project_task_mutation(
            result
                .as_object()
                .context("Canonical Operation Result must be an object")?,
            true,
        ),
        "team.list_tasks" => project_task_list(
            result
                .as_object()
                .context("Canonical Operation Result must be an object")?,
        ),
        "member.create"
        | "camp.list"
        | "camp.search"
        | "camp.read"
        | "history.search"
        | "memory.view"
        | "memory.search"
        | "memory.read"
        | "single_chat.history"
        | "mission.list"
        | "mission.get"
        | "mission.update"
        | "mission.status"
        | "automation.list"
        | "automation.get"
        | "automation.create"
        | "automation.run"
        | "automation.close"
        | "automation.update"
        | "automation.delete" => Ok(result),
        _ => bail!("unknown built-in operation for Agent output projection"),
    }
}

fn task_mutation_agent_schema(include_changed: bool) -> Value {
    let mut required = vec!["taskId", "title", "status", "assigneeAgentId"];
    if include_changed {
        required.push("changed");
    }
    let mut properties = json!({
        "taskId": {"type": "string"},
        "title": {"type": "string"},
        "status": {"type": "string", "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]},
        "assigneeAgentId": {"type": ["string", "null"]}
    });
    if include_changed {
        properties["changed"] = json!({"type": "boolean"});
    }
    json!({
        "type": "object", "additionalProperties": false,
        "required": required, "properties": properties
    })
}

fn task_get_agent_schema() -> Value {
    let branch = |status: &str, note: Option<&str>| {
        let mut required = vec![
            "taskId",
            "title",
            "description",
            "status",
            "assigneeAgentId",
        ];
        let mut properties = json!({
            "taskId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string", "maxLength": 16000},
            "status": {"const": status},
            "assigneeAgentId": {"type": ["string", "null"]}
        });
        if let Some(note) = note {
            required.push(note);
            properties[note] = json!({"type": "string", "minLength": 1, "maxLength": 4000});
        }
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": required,
            "properties": properties
        })
    };
    json!({
        "oneOf": [
            branch("pending", None),
            branch("in_progress", None),
            branch("blocked", Some("blockedReason")),
            branch("completed", Some("completionSummary")),
            branch("cancelled", Some("cancelReason"))
        ]
    })
}

fn project_task_get(object: &Map<String, Value>) -> Result<Value> {
    let mut projected = Map::new();
    for key in [
        "taskId",
        "title",
        "description",
        "status",
        "assigneeAgentId",
    ] {
        projected.insert(
            key.to_string(),
            object
                .get(key)
                .with_context(|| format!("Task get result has no {key}"))?
                .clone(),
        );
    }
    let note = match object.get("status").and_then(Value::as_str) {
        Some("pending" | "in_progress") => None,
        Some("blocked") => Some("blockedReason"),
        Some("completed") => Some("completionSummary"),
        Some("cancelled") => Some("cancelReason"),
        _ => bail!("Task get result has an unknown status"),
    };
    if let Some(note) = note {
        let value = object
            .get(note)
            .filter(|value| value.is_string())
            .with_context(|| format!("Task get result has no matching {note}"))?;
        projected.insert(note.to_string(), value.clone());
    }
    Ok(Value::Object(projected))
}

fn project_task_mutation(object: &Map<String, Value>, include_changed: bool) -> Result<Value> {
    let mut projected = Map::new();
    for key in ["taskId", "title", "status", "assigneeAgentId"] {
        projected.insert(
            key.to_string(),
            object
                .get(key)
                .with_context(|| format!("Task mutation result has no {key}"))?
                .clone(),
        );
    }
    if include_changed {
        projected.insert(
            "changed".to_string(),
            object
                .get("changed")
                .context("Task update result has no changed")?
                .clone(),
        );
    }
    Ok(Value::Object(projected))
}

fn project_task_list(object: &Map<String, Value>) -> Result<Value> {
    let tasks = object
        .get("tasks")
        .and_then(Value::as_array)
        .context("Task list result has no tasks")?
        .iter()
        .map(|task| {
            project_task_mutation(
                task.as_object()
                    .context("Task list item must be an object")?,
                false,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({
        "tasks": tasks,
        "nextCursor": object.get("nextCursor").context("Task list result has no nextCursor")?,
        "truncated": object.get("truncated").context("Task list result has no truncated")?,
    }))
}

fn project_error(error: &BuiltinToolError) -> Result<Value> {
    if error.code == "builtin_tool.outcome_indeterminate" {
        return Ok(outcome_indeterminate_agent_error());
    }
    let mut projected = Map::new();
    projected.insert("code".to_string(), Value::String(error.code.clone()));
    projected.insert("message".to_string(), Value::String(error.message.clone()));
    projected.insert(
        "recovery".to_string(),
        serde_json::to_value(&error.recovery).context("failed to serialize error recovery")?,
    );
    if let Some(details) = &error.details {
        projected.insert("details".to_string(), details.clone());
    }
    Ok(json!({"error": projected}))
}

fn validate_projected_document(operation: &str, success: bool, value: &Value) -> Result<()> {
    if success {
        let schema = agent_output_schema(operation)?;
        validate_schema(value, &schema).with_context(|| {
            format!("Agent output projection does not match {operation} agentOutputSchema")
        })?;
    } else {
        validate_schema(value, &agent_error_schema())
            .context("Agent error projection does not match the closed error schema")?;
    }
    Ok(())
}

fn agent_error_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["error"],
        "properties": {
            "error": {
                "type": "object",
                "additionalProperties": false,
                "required": ["code", "message", "recovery"],
                "properties": {
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                    "recovery": {
                        "type": "string",
                        "enum": [
                            "fix_input", "refresh_then_decide", "retry_same_request",
                            "stop", "confirm_outcome"
                        ]
                    },
                    "details": {"type": "object"}
                }
            }
        }
    })
}

/// Small, intentionally bounded JSON Schema validator for the schemas owned by the built-in catalog.
/// It supports only the keywords used by the catalog output schemas; it is not a general-purpose
/// schema engine and it does not implement a global forbidden-field rule.
pub fn validate_schema(value: &Value, schema: &Value) -> Result<()> {
    if let Some(variants) = schema.get("oneOf").and_then(Value::as_array) {
        if variants
            .iter()
            .any(|variant| validate_schema(value, variant).is_ok())
        {
            return Ok(());
        }
        bail!("value does not match any oneOf variant");
    }
    if let Some(variants) = schema.get("anyOf").and_then(Value::as_array)
        && !variants
            .iter()
            .any(|variant| validate_schema(value, variant).is_ok())
    {
        bail!("value does not match any anyOf variant");
    }
    if let Some(variants) = schema.get("allOf").and_then(Value::as_array) {
        for variant in variants {
            validate_schema(value, variant)?;
        }
    }
    if let Some(constant) = schema.get("const")
        && value != constant
    {
        bail!("value does not match const schema");
    }
    if let Some(enums) = schema.get("enum").and_then(Value::as_array)
        && !enums.iter().any(|candidate| candidate == value)
    {
        bail!("value does not match enum schema");
    }
    if let Some(types) = schema.get("type") {
        let matches = types
            .as_str()
            .map(|kind| value_matches_type(value, kind))
            .or_else(|| {
                types.as_array().map(|kinds| {
                    kinds
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|kind| value_matches_type(value, kind))
                })
            })
            .unwrap_or(true);
        if !matches {
            bail!("value type does not match schema");
        }
    }
    if let Some(string) = value.as_str() {
        let length = string.chars().count();
        if let Some(min) = schema.get("minLength").and_then(Value::as_u64)
            && length < min as usize
        {
            bail!("string is shorter than minLength");
        }
        if let Some(max) = schema.get("maxLength").and_then(Value::as_u64)
            && length > max as usize
        {
            bail!("string is longer than maxLength");
        }
    }
    if let Some(number) = value.as_f64() {
        if let Some(min) = schema.get("minimum").and_then(Value::as_f64)
            && number < min
        {
            bail!("number is lower than minimum");
        }
        if let Some(max) = schema.get("maximum").and_then(Value::as_f64)
            && number > max
        {
            bail!("number is higher than maximum");
        }
    }
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let object = value.as_object().context("schema expects an object")?;
        for key in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                bail!("schema requires property {key}");
            }
        }
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        let object = value.as_object().context("schema expects an object")?;
        if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
            for key in object.keys() {
                if !properties.contains_key(key) {
                    bail!("schema rejects extra property {key}");
                }
            }
        }
        for (key, property_schema) in properties {
            if let Some(property) = object.get(key) {
                validate_schema(property, property_schema)
                    .with_context(|| format!("property {key} failed schema"))?;
            }
        }
    }
    if let Some(items) = schema.get("items") {
        let array = value.as_array().context("schema expects an array")?;
        if let Some(min) = schema.get("minItems").and_then(Value::as_u64)
            && array.len() < min as usize
        {
            bail!("array is shorter than minItems");
        }
        if let Some(max) = schema.get("maxItems").and_then(Value::as_u64)
            && array.len() > max as usize
        {
            bail!("array is longer than maxItems");
        }
        if schema.get("uniqueItems").and_then(Value::as_bool) == Some(true) {
            for (index, item) in array.iter().enumerate() {
                if array.iter().take(index).any(|previous| previous == item) {
                    bail!("array contains duplicate items");
                }
            }
        }
        for item in array {
            validate_schema(item, items)?;
        }
    }
    Ok(())
}

fn value_matches_type(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtin_tool_transport::BuiltinToolInvocationEnvelope;

    #[test]
    fn compact_projections_are_not_reduced_envelopes() {
        let envelope = BuiltinToolInvocationEnvelope::success(
            "camp.message.send",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({
                "status": "accepted",
                "messageId": "msg_123",
                "agentAddressingMode": "automatic",
                "visibility": "camp_public",
                "campTurnId": "turn_1",
                "effectiveRecipients": ["agent_27"],
                "recipientPresentation": {},
                "recipientSetDigest": "sha256:digest",
                "deliveryIds": ["delivery_1"],
                "allocatedAgentRunResponsibilities": 1
            }),
        )
        .unwrap();
        assert_eq!(
            project_envelope(envelope).unwrap(),
            json!({
                "messageId": "msg_123",
                "agentAddressingMode": "automatic",
                "effectiveRecipients": ["agent_27"],
                "deliveryIds": ["delivery_1"]
            })
        );
    }

    #[test]
    fn indeterminate_projection_drops_hidden_identity_details() {
        let envelope = BuiltinToolInvocationEnvelope::rejected(
            "camp.message.send",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            BuiltinToolError {
                code: "builtin_tool.outcome_indeterminate".to_string(),
                message: "unsafe transport diagnostic with private identity".to_string(),
                recovery: crate::builtin_tool_transport::BuiltinToolRecovery::ConfirmOutcome,
                details: Some(json!({"requestId": "hidden", "operation": "camp.message.send"})),
            },
        )
        .unwrap();
        assert_eq!(
            project_envelope(envelope).unwrap(),
            json!({"error": {
                "code": "builtin_tool.outcome_indeterminate",
                "message": "The operation may already have committed. Confirm the exact current state before proceeding; do not blindly repeat the mutation. If confirmation is unavailable, report the uncertainty.",
                "recovery": "confirm_outcome"
            }})
        );
    }

    #[test]
    fn output_contract_mismatch_is_closed_and_non_retryable() {
        let completed_core_result = json!({
            "campId": "camp_123",
            "mode": "item",
            "items": [{
                "messageId": "msg_123",
                "sequence": 1,
                "authorType": "agent",
                "authorId": "agent_27",
                "anchorMessageId": null,
                "createdAt": "2026-01-01T00:00:00Z",
                "body": "hello",
                "attachmentCount": 1,
                "attachments": [{
                    "attachmentId": "attachment_123",
                    "name": "notes.txt",
                    "mediaType": "text/plain",
                    "byteSize": 123
                }],
                "attachmentsTruncated": false,
                "attachmentOmittedCount": 0,
                "addressing": {
                    "effectiveAgentRecipients": ["agent_27"],
                    "mentionsCurrentUser": true
                }
            }]
        });
        let envelope = BuiltinToolInvocationEnvelope::success(
            "camp.read",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            completed_core_result,
        )
        .unwrap();
        assert!(project_envelope(envelope).is_err());

        let projected = output_contract_mismatch_agent_error("camp.read");
        validate_schema(&projected, &agent_error_schema()).unwrap();
        assert_eq!(
            projected,
            json!({"error": {
                "code": "builtin_tool.output_contract_mismatch",
                "message": "The operation completed, but its result could not be safely projected.",
                "recovery": "stop",
                "details": {"operation": "camp.read"}
            }})
        );
    }

    #[test]
    fn canonical_business_field_names_are_not_global_forbidden_names() {
        let schema = json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["operation"],
            "properties": {"operation": {"type": "string"}}
        });
        validate_schema(&json!({"operation": "business-value"}), &schema).unwrap();
    }

    #[test]
    fn closed_agent_output_schemas_reject_extra_and_invalid_fields() {
        let schema = agent_output_schema("camp.message.send").unwrap();
        assert!(
            validate_schema(
                &json!({
                    "messageId": "msg_123",
                    "agentAddressingMode": "automatic",
                    "effectiveRecipients": [],
                    "deliveryIds": [],
                    "receipt": "must-not-cross-the-boundary"
                }),
                &schema
            )
            .is_err()
        );

        let mission_list_schema = agent_output_schema("mission.list").unwrap();
        validate_schema(
            &json!({
                "missions": [{
                    "missionId": "rvm_example",
                    "campId": "rvcamp_example",
                    "title": "使命",
                    "status": "in_progress",
                    "updatedAt": "2026-09-19T00:00:00Z"
                }],
                "nextCursor": null,
                "hasMore": false
            }),
            &mission_list_schema,
        )
        .unwrap();

        let mission_schema = agent_output_schema("mission.get").unwrap();
        let mission = json!({
            "missionId": "rvm_example",
            "title": "使命",
            "description": "读取当前定义",
            "status": "in_progress",
            "sourceMessageId": null,
            "attachments": [{
                "attachmentId": "attachment_1",
                "name": "requirements.pdf",
                "kind": "file",
                "fileCount": 1,
                "mediaType": "application/pdf",
                "byteSize": 42,
                "path": "/workspace/requirements.pdf"
            }]
        });
        validate_schema(&mission, &mission_schema).unwrap();
        let mut missing = mission.clone();
        missing.as_object_mut().unwrap().remove("attachments");
        assert!(validate_schema(&missing, &mission_schema).is_err());
        let mut wrong_collection = mission.clone();
        wrong_collection["attachments"] = json!("/workspace/requirements.pdf");
        assert!(validate_schema(&wrong_collection, &mission_schema).is_err());
        let mut wrong_item = mission;
        wrong_item["attachments"][0]
            .as_object_mut()
            .unwrap()
            .remove("path");
        assert!(validate_schema(&wrong_item, &mission_schema).is_err());
    }

    #[test]
    fn memory_write_projects_both_closed_outcome_members() {
        for (canonical, expected) in [
            (
                json!({
                    "outcome": "effective",
                    "memoryId": "memory_123",
                    "revisionId": "revision_123"
                }),
                json!({
                    "outcome": "effective",
                    "memoryId": "memory_123",
                    "revisionId": "revision_123"
                }),
            ),
            (
                json!({
                    "outcome": "review_pending",
                    "reviewItemId": "review_123"
                }),
                json!({
                    "outcome": "review_pending",
                    "reviewItemId": "review_123"
                }),
            ),
        ] {
            let envelope = BuiltinToolInvocationEnvelope::success(
                "memory.write",
                "7b5db24c-4a43-4cab-9217-d982b08f7691",
                canonical,
            )
            .unwrap();
            assert_eq!(project_envelope(envelope).unwrap(), expected);
        }
    }

    #[test]
    fn task_get_projects_only_the_note_matching_the_current_status() {
        for (status, note_key, note_value) in [
            ("blocked", "blockedReason", "等待输入"),
            ("completed", "completionSummary", "已经完成"),
            ("cancelled", "cancelReason", "范围取消"),
        ] {
            let mut canonical = json!({
                "taskId": "task_123",
                "campId": "camp_123",
                "title": "Task",
                "description": "Scope and requirements",
                "status": status,
                "assigneeAgentId": "agent_1",
                "blockedReason": null,
                "completionSummary": null,
                "cancelReason": null,
                "createdByType": "user",
                "createdById": "local_user",
                "sourceAgentRunId": null,
                "closedByType": null,
                "closedById": null,
                "closedByAgentRunId": null,
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
                "closedAt": null,
                "availableActions": []
            });
            canonical[note_key] = json!(note_value);
            let projected = project_envelope(
                BuiltinToolInvocationEnvelope::success(
                    "team.get_task",
                    "7b5db24c-4a43-4cab-9217-d982b08f7691",
                    canonical,
                )
                .unwrap(),
            )
            .unwrap();
            assert_eq!(projected[note_key], note_value);
            assert_eq!(projected.as_object().unwrap().len(), 6);
            for unrelated in [
                "campId",
                "createdById",
                "blockedReason",
                "completionSummary",
                "cancelReason",
            ] {
                if unrelated != note_key {
                    assert!(projected.get(unrelated).is_none());
                }
            }
        }
    }

    #[test]
    fn every_operation_has_a_schema_valid_golden_projection() {
        let golden: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/builtin-tool-agent-output-v5.json"
        ))
        .unwrap();
        let documents = golden.as_object().unwrap();
        assert_eq!(documents.len(), builtin_tool_definitions().len());
        for definition in builtin_tool_definitions() {
            let operation = definition["name"].as_str().unwrap();
            let fixture = documents
                .get(operation)
                .unwrap_or_else(|| panic!("missing golden Agent output for {operation}"));
            let canonical_result = &fixture["canonicalResult"];
            let expected_agent_output = &fixture["agentOutput"];
            validate_schema(canonical_result, &definition["outputSchema"])
                .unwrap_or_else(|error| panic!("invalid {operation} canonical result: {error:#}"));
            validate_schema(
                expected_agent_output,
                &agent_output_schema(operation).unwrap(),
            )
            .unwrap_or_else(|error| panic!("invalid {operation} golden projection: {error:#}"));
            let envelope = BuiltinToolInvocationEnvelope::success(
                operation,
                "7b5db24c-4a43-4cab-9217-d982b08f7691",
                canonical_result.clone(),
            )
            .unwrap();
            assert_eq!(
                project_envelope(envelope).unwrap(),
                *expected_agent_output,
                "{operation} Envelope projection drifted from its golden output"
            );
        }
    }
}
