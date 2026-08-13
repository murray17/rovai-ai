use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};

use crate::{
    builtin_tool_transport::{BuiltinToolError, BuiltinToolInvocationEnvelope},
    team_tool_catalog::builtin_tool_definitions,
};

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
            "required": ["messageId", "effectiveRecipients"],
            "properties": {
                "messageId": {"type": "string"},
                "effectiveRecipients": {
                    "type": "array",
                    "maxItems": 16,
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
        "team.update_task" => Ok(task_mutation_agent_schema(true)),
        "team.get_task" | "team.list_tasks" | "camp.list" | "camp.search" | "camp.read"
        | "history.search" | "memory.search" | "memory.read" => builtin_tool_definitions()
            .into_iter()
            .find(|definition| definition["name"].as_str() == Some(operation))
            .map(|definition| definition["outputSchema"].clone())
            .context("unknown built-in operation for Agent output schema"),
        _ => bail!("unknown built-in operation for Agent output schema"),
    }
}

pub fn project_envelope(envelope: &BuiltinToolInvocationEnvelope) -> Result<Value> {
    envelope.validate()?;
    let projected = if envelope.ok {
        let result = envelope
            .result
            .as_ref()
            .context("successful Built-in Tool envelope has no result")?;
        project_success(&envelope.operation, result)?
    } else {
        let error = envelope
            .error
            .as_ref()
            .context("rejected Built-in Tool envelope has no error")?;
        project_error(error)?
    };
    validate_projected_document(&envelope.operation, envelope.ok, &projected)?;
    Ok(projected)
}

fn project_success(operation: &str, result: &Value) -> Result<Value> {
    let object = result
        .as_object()
        .context("Canonical Operation Result must be an object")?;
    match operation {
        "camp.message.send" => Ok(json!({
            "messageId": object
                .get("messageId")
                .context("camp.message.send result has no messageId")?,
            "effectiveRecipients": object
                .get("effectiveRecipients")
                .context("camp.message.send result has no effectiveRecipients")?,
        })),
        "memory.write" => match object.get("outcome").and_then(Value::as_str) {
            Some("effective") => Ok(json!({
                "outcome": "effective",
                "memoryId": object
                    .get("memoryId")
                    .context("effective memory.write result has no memoryId")?,
                "revisionId": object
                    .get("revisionId")
                    .context("effective memory.write result has no revisionId")?,
            })),
            Some("review_pending") => Ok(json!({
                "outcome": "review_pending",
                "reviewItemId": object
                    .get("reviewItemId")
                    .context("pending memory.write result has no reviewItemId")?,
            })),
            _ => bail!("memory.write result has an unknown outcome"),
        },
        "team.create_task" => project_task_mutation(object, false),
        "team.update_task" => project_task_mutation(object, true),
        "team.get_task" | "team.list_tasks" | "camp.list" | "camp.search" | "camp.read"
        | "history.search" | "memory.search" | "memory.read" => Ok(result.clone()),
        _ => bail!("unknown built-in operation for Agent output projection"),
    }
}

fn task_mutation_agent_schema(include_changed: bool) -> Value {
    let mut required = vec![
        "taskId",
        "title",
        "status",
        "assigneeAgentId",
        "version",
        "availableActions",
    ];
    if include_changed {
        required.push("changed");
    }
    let mut properties = json!({
        "taskId": {"type": "string"},
        "title": {"type": "string"},
        "status": {"type": "string", "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]},
        "assigneeAgentId": {"type": ["string", "null"]},
        "version": {"type": "integer", "minimum": 1},
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

fn project_task_mutation(object: &Map<String, Value>, include_changed: bool) -> Result<Value> {
    let mut projected = Map::new();
    for key in [
        "taskId",
        "title",
        "status",
        "assigneeAgentId",
        "version",
        "availableActions",
    ] {
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

fn project_error(error: &BuiltinToolError) -> Result<Value> {
    if error.code == "builtin_tool.outcome_indeterminate" {
        return Ok(json!({
            "error": {
                "code": "builtin_tool.outcome_indeterminate",
                "message": "Confirm current state before acting again.",
                "recovery": "confirm_outcome"
            }
        }));
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
    if let Some(variants) = schema.get("anyOf").and_then(Value::as_array) {
        if variants
            .iter()
            .any(|variant| validate_schema(value, variant).is_ok())
        {
            return Ok(());
        }
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
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        let object = value.as_object().context("schema expects an object")?;
        if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
            for key in object.keys() {
                if !properties.contains_key(key) {
                    bail!("schema rejects extra property {key}");
                }
            }
        }
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for key in required.iter().filter_map(Value::as_str) {
                if !object.contains_key(key) {
                    bail!("schema requires property {key}");
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
            project_envelope(&envelope).unwrap(),
            json!({"messageId": "msg_123", "effectiveRecipients": ["agent_27"]})
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
            project_envelope(&envelope).unwrap(),
            json!({"error": {
                "code": "builtin_tool.outcome_indeterminate",
                "message": "Confirm current state before acting again.",
                "recovery": "confirm_outcome"
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
    fn closed_agent_output_schema_rejects_extra_fields() {
        let schema = agent_output_schema("camp.message.send").unwrap();
        assert!(
            validate_schema(
                &json!({
                    "messageId": "msg_123",
                    "effectiveRecipients": [],
                    "receipt": "must-not-cross-the-boundary"
                }),
                &schema
            )
            .is_err()
        );
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
            assert_eq!(project_envelope(&envelope).unwrap(), expected);
        }
    }

    #[test]
    fn every_operation_has_a_schema_valid_golden_projection() {
        let golden: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/builtin-tool-agent-output-v5.json"
        ))
        .unwrap();
        let documents = golden.as_object().unwrap();
        assert_eq!(documents.len(), 12);
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
                project_envelope(&envelope).unwrap(),
                *expected_agent_output,
                "{operation} Envelope projection drifted from its golden output"
            );
        }
    }
}
