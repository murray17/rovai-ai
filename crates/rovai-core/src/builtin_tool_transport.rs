use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{command::canonical_json_digest, team_tool_catalog::builtin_tool_definitions};

pub const BUILTIN_TOOL_CONTRACT_VERSION: u32 = 22;
pub const BUILTIN_TOOL_IPC_PROTOCOL_VERSION: u32 = 2;
pub const BUILTIN_TOOL_ENVELOPE_VERSION: u32 = 1;
pub const BUILTIN_TOOL_RECEIPT_VERSION: u32 = 1;
pub const BUILTIN_TOOL_CLI_COMMAND_VERSION: u32 = 22;
pub const BUILTIN_TOOL_AGENT_OUTPUT_CONTRACT_VERSION: u32 = 2;
pub const BUILTIN_TOOL_RUNTIME_CAPABILITY: &str = "builtin_cli.transport.v22";
pub const BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES: usize = 1024 * 1024;
pub const ROVAI_AGENT_CLI_ENV: &str = "ROVAI_AGENT_CLI";
pub const ROVAI_CLI_CONTEXT_ENV: &str = "ROVAI_CLI_CONTEXT";
pub const ROVAI_RUN_TMP_ENV: &str = "ROVAI_RUN_TMP";
pub const COMPACTION_HOOK_IPC_PROTOCOL_VERSION: u32 = 1;
pub const COMPACTION_OBSERVATION_IPC_KIND: &str = "compaction_observation";
pub const COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum LocalIpcEndpoint {
    UnixSocket { path: String },
    WindowsNamedPipe { name: String },
}

impl LocalIpcEndpoint {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::UnixSocket { path } => {
                if path.trim().is_empty() || !Path::new(path).is_absolute() {
                    bail!("Built-in Tool Unix socket endpoint must be absolute");
                }
            }
            Self::WindowsNamedPipe { name } => {
                let Some(suffix) = name.strip_prefix(r"\\.\pipe\rovai-ai-") else {
                    bail!("Built-in Tool Windows named pipe endpoint is invalid");
                };
                let Some((process_id, instance_id)) = suffix.split_once('-') else {
                    bail!("Built-in Tool Windows named pipe endpoint is invalid");
                };
                if process_id.is_empty()
                    || !process_id.bytes().all(|byte| byte.is_ascii_digit())
                    || process_id
                        .parse::<u32>()
                        .ok()
                        .filter(|value| *value > 0)
                        .is_none()
                    || uuid::Uuid::parse_str(instance_id).is_err()
                {
                    bail!("Built-in Tool Windows named pipe endpoint is invalid");
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolLeaseContext {
    pub execution_root: String,
    pub run_tmp: String,
    pub lease_id: String,
    pub lease_generation: u64,
    pub lease_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolCliContext {
    pub contract_version: u32,
    pub ipc_protocol_version: u32,
    pub core_endpoint: LocalIpcEndpoint,
    pub process_id: String,
    pub process_token: String,
    pub lease: Option<BuiltinToolLeaseContext>,
}

impl BuiltinToolCliContext {
    pub fn auth(&self) -> Result<BuiltinToolAuth> {
        if self.contract_version != BUILTIN_TOOL_CONTRACT_VERSION
            || self.ipc_protocol_version != BUILTIN_TOOL_IPC_PROTOCOL_VERSION
        {
            bail!("Built-in Tool CLI context version is unsupported");
        }
        self.core_endpoint.validate()?;
        if self.process_id.trim().is_empty() || self.process_token.trim().is_empty() {
            bail!("Built-in Tool CLI context is incomplete");
        }
        let lease = self
            .lease
            .as_ref()
            .context("Built-in Tool CLI is not bound to an active AgentRun")?;
        if lease.lease_id.trim().is_empty()
            || lease.lease_generation == 0
            || lease.lease_token.trim().is_empty()
            || !std::path::Path::new(&lease.execution_root).is_absolute()
            || !std::path::Path::new(&lease.run_tmp).is_absolute()
        {
            bail!("Built-in Tool active lease is incomplete");
        }
        Ok(BuiltinToolAuth {
            process_id: self.process_id.clone(),
            process_token: self.process_token.clone(),
            lease_id: lease.lease_id.clone(),
            lease_generation: lease.lease_generation,
            lease_token: lease.lease_token.clone(),
        })
    }

    pub fn process_auth(&self) -> Result<(String, String)> {
        if self.contract_version != BUILTIN_TOOL_CONTRACT_VERSION
            || self.ipc_protocol_version != BUILTIN_TOOL_IPC_PROTOCOL_VERSION
            || self.process_id.trim().is_empty()
            || self.process_token.trim().is_empty()
        {
            bail!("Built-in Tool process context is incomplete");
        }
        self.core_endpoint.validate()?;
        Ok((self.process_id.clone(), self.process_token.clone()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompactionHookIpcRequest {
    pub kind: String,
    pub ipc_protocol_version: u32,
    pub process_id: String,
    pub process_token: String,
    pub request_id: String,
    pub adapter_kind: String,
    pub host_instance_id: String,
    pub native_session_id: String,
    pub hook_event_name: String,
    pub trigger: String,
    pub source_event_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_auth: Option<BuiltinToolAuth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompactionHookIpcResponse {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompactionObservationOutboxRecord {
    pub schema_version: u32,
    pub request_id: String,
    pub adapter_kind: String,
    pub host_instance_id: String,
    pub relay_process_id: String,
    pub native_session_id: String,
    pub hook_event_name: String,
    pub trigger: String,
    pub source_event_digest: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltinToolCliIdentity {
    pub operation: &'static str,
    pub group: &'static str,
    pub action: &'static str,
}

pub const BUILTIN_TOOL_CLI_IDENTITIES: [BuiltinToolCliIdentity; 16] = [
    BuiltinToolCliIdentity {
        operation: "camp.message.send",
        group: "send",
        action: "",
    },
    BuiltinToolCliIdentity {
        operation: "team.gather",
        group: "gather",
        action: "",
    },
    BuiltinToolCliIdentity {
        operation: "member.create",
        group: "member",
        action: "create",
    },
    BuiltinToolCliIdentity {
        operation: "team.create_task",
        group: "task",
        action: "create",
    },
    BuiltinToolCliIdentity {
        operation: "team.get_task",
        group: "task",
        action: "get",
    },
    BuiltinToolCliIdentity {
        operation: "team.list_tasks",
        group: "task",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "team.update_task",
        group: "task",
        action: "update",
    },
    BuiltinToolCliIdentity {
        operation: "camp.list",
        group: "camp",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "camp.search",
        group: "camp",
        action: "search",
    },
    BuiltinToolCliIdentity {
        operation: "camp.read",
        group: "camp",
        action: "read",
    },
    BuiltinToolCliIdentity {
        operation: "single_chat.history",
        group: "single-chat",
        action: "history",
    },
    BuiltinToolCliIdentity {
        operation: "history.search",
        group: "history",
        action: "search",
    },
    BuiltinToolCliIdentity {
        operation: "memory.view",
        group: "memory",
        action: "view",
    },
    BuiltinToolCliIdentity {
        operation: "memory.search",
        group: "memory",
        action: "search",
    },
    BuiltinToolCliIdentity {
        operation: "memory.read",
        group: "memory",
        action: "read",
    },
    BuiltinToolCliIdentity {
        operation: "memory.write",
        group: "memory",
        action: "write",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolAuth {
    pub process_id: String,
    pub process_token: String,
    pub lease_id: String,
    pub lease_generation: u64,
    pub lease_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BuiltinToolIpcRequestBody {
    Invoke {
        request_id: String,
        operation: String,
        input: Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolIpcRequest {
    pub ipc_protocol_version: u32,
    #[serde(flatten)]
    pub auth: BuiltinToolAuth,
    #[serde(flatten)]
    pub body: BuiltinToolIpcRequestBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BuiltinToolIpcResponse {
    Envelope {
        envelope: BuiltinToolInvocationEnvelope,
    },
    Error {
        error: BuiltinToolIpcError,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolIpcError {
    pub code: String,
    pub message: String,
}

impl BuiltinToolIpcResponse {
    pub fn ipc_error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Error {
            error: BuiltinToolIpcError {
                code: code.into(),
                message: message.into(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinToolRecovery {
    FixInput,
    RefreshThenDecide,
    RetrySameRequest,
    Stop,
    ConfirmOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolError {
    pub code: String,
    pub message: String,
    pub recovery: BuiltinToolRecovery,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolInvocationEnvelope {
    pub contract_version: u32,
    pub ok: bool,
    pub operation: String,
    pub request_id: String,
    pub receipt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BuiltinToolError>,
}

impl BuiltinToolInvocationEnvelope {
    pub fn success(operation: &str, request_id: &str, result: Value) -> Result<Self> {
        let result = canonical_operation_result(result)?;
        let receipt = builtin_tool_receipt(operation, request_id, true, &result)?;
        let envelope = Self {
            contract_version: BUILTIN_TOOL_ENVELOPE_VERSION,
            ok: true,
            operation: operation.to_string(),
            request_id: request_id.to_string(),
            receipt,
            result: Some(result),
            error: None,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn rejected(operation: &str, request_id: &str, error: BuiltinToolError) -> Result<Self> {
        let error_value = serde_json::to_value(&error)?;
        let receipt = builtin_tool_receipt(operation, request_id, false, &error_value)?;
        let envelope = Self {
            contract_version: BUILTIN_TOOL_ENVELOPE_VERSION,
            ok: false,
            operation: operation.to_string(),
            request_id: request_id.to_string(),
            receipt,
            result: None,
            error: Some(error),
        };
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn validate(&self) -> Result<()> {
        if self.contract_version != BUILTIN_TOOL_ENVELOPE_VERSION {
            bail!("unknown Built-in Tool envelope contract version");
        }
        if builtin_tool_identity_by_operation(&self.operation).is_none() {
            bail!("Built-in Tool envelope operation is not canonical");
        }
        uuid::Uuid::parse_str(&self.request_id)
            .context("Built-in Tool envelope requestId must be a UUID")?;
        let outcome = match (self.ok, self.result.as_ref(), self.error.as_ref()) {
            (true, Some(result), None) => {
                canonical_operation_result(result.clone())?;
                result.clone()
            }
            (false, None, Some(error)) => {
                if error.code.trim().is_empty() || error.message.trim().is_empty() {
                    bail!("Built-in Tool error code and message must not be empty");
                }
                if error
                    .details
                    .as_ref()
                    .is_some_and(|details| !details.is_object())
                {
                    bail!("Built-in Tool error details must be an object");
                }
                serde_json::to_value(error)?
            }
            _ => bail!("Built-in Tool envelope must contain exactly one of result or error"),
        };
        let expected_receipt =
            builtin_tool_receipt(&self.operation, &self.request_id, self.ok, &outcome)?;
        if self.receipt != expected_receipt {
            bail!("Built-in Tool envelope receipt does not cover its outcome");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolListItem {
    pub name: String,
    pub command: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolList {
    pub contract_version: u32,
    pub catalog_digest: String,
    pub operations: Vec<BuiltinToolListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolArgument {
    pub flag: String,
    pub field: String,
    pub value_kind: String,
    pub repeatable: bool,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolErrorContract {
    pub code: String,
    pub recovery: BuiltinToolRecovery,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolEnvelopeContract {
    pub version: u32,
    pub schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinToolDescription {
    pub contract_version: u32,
    pub catalog_digest: String,
    pub name: String,
    pub command: Vec<String>,
    pub summary: String,
    pub arguments: Vec<BuiltinToolArgument>,
    pub input_schema: Value,
    pub result_schema: Value,
    pub agent_output_schema: Value,
    pub projection_identity: String,
    pub errors: Vec<BuiltinToolErrorContract>,
    pub envelope_contract: BuiltinToolEnvelopeContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CatalogDigestDocument {
    contract_version: u32,
    ipc_protocol_version: u32,
    envelope_contract_version: u32,
    receipt_version: u32,
    cli_command_version: u32,
    agent_output_contract_version: u32,
    operations: Vec<CatalogDigestOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CatalogDigestOperation {
    name: String,
    command: Vec<String>,
    summary: String,
    arguments: Vec<BuiltinToolArgument>,
    input_schema: Value,
    result_schema: Value,
    agent_output_schema: Value,
    projection_identity: String,
    errors: Vec<BuiltinToolErrorContract>,
}

pub fn builtin_tool_identity_by_operation(operation: &str) -> Option<BuiltinToolCliIdentity> {
    BUILTIN_TOOL_CLI_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.operation == operation)
}

pub fn builtin_tool_identity_by_command(
    group: &str,
    action: &str,
) -> Option<BuiltinToolCliIdentity> {
    BUILTIN_TOOL_CLI_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.group == group && identity.action == action)
}

pub fn builtin_tool_list() -> Result<BuiltinToolList> {
    let definitions = catalog_digest_operations()?;
    let catalog_digest = builtin_tool_catalog_digest_from(&definitions)?;
    Ok(BuiltinToolList {
        contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
        catalog_digest,
        operations: definitions
            .into_iter()
            .map(|definition| BuiltinToolListItem {
                name: definition.name,
                command: definition.command,
                summary: definition.summary,
            })
            .collect(),
    })
}

pub fn builtin_tool_description(operation: &str) -> Result<BuiltinToolDescription> {
    let definitions = catalog_digest_operations()?;
    let catalog_digest = builtin_tool_catalog_digest_from(&definitions)?;
    let definition = definitions
        .into_iter()
        .find(|definition| definition.name == operation)
        .with_context(|| format!("unknown Built-in Tool operation: {operation}"))?;
    Ok(BuiltinToolDescription {
        contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
        catalog_digest,
        name: definition.name,
        command: definition.command,
        summary: definition.summary,
        arguments: definition.arguments,
        input_schema: definition.input_schema,
        result_schema: definition.result_schema,
        agent_output_schema: definition.agent_output_schema,
        projection_identity: definition.projection_identity,
        errors: definition.errors,
        envelope_contract: BuiltinToolEnvelopeContract {
            version: BUILTIN_TOOL_ENVELOPE_VERSION,
            schema: builtin_tool_envelope_schema(),
        },
    })
}

pub fn builtin_tool_catalog_digest() -> Result<String> {
    let definitions = catalog_digest_operations()?;
    builtin_tool_catalog_digest_from(&definitions)
}

fn builtin_tool_catalog_digest_from(definitions: &[CatalogDigestOperation]) -> Result<String> {
    let digest = canonical_json_digest(&serde_json::to_value(CatalogDigestDocument {
        contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
        ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
        envelope_contract_version: BUILTIN_TOOL_ENVELOPE_VERSION,
        receipt_version: BUILTIN_TOOL_RECEIPT_VERSION,
        cli_command_version: BUILTIN_TOOL_CLI_COMMAND_VERSION,
        agent_output_contract_version: BUILTIN_TOOL_AGENT_OUTPUT_CONTRACT_VERSION,
        operations: definitions.to_vec(),
    })?)?;
    Ok(format!("sha256:{digest}"))
}

fn catalog_digest_operations() -> Result<Vec<CatalogDigestOperation>> {
    let mut definitions_by_name = builtin_tool_definitions()
        .into_iter()
        .map(|definition| {
            let name = definition["name"]
                .as_str()
                .context("Built-in Tool definition has no name")?
                .to_string();
            Ok((name, definition))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut operations = Vec::with_capacity(BUILTIN_TOOL_CLI_IDENTITIES.len());
    for identity in BUILTIN_TOOL_CLI_IDENTITIES {
        let definition = definitions_by_name
            .remove(identity.operation)
            .with_context(|| format!("catalog is missing {}", identity.operation))?;
        let input_schema = definition["inputSchema"].clone();
        let result_schema = definition["outputSchema"].clone();
        let agent_output_schema =
            crate::builtin_tool_cli_output::agent_output_schema(identity.operation)?;
        operations.push(CatalogDigestOperation {
            name: identity.operation.to_string(),
            command: if identity.action.is_empty() {
                vec![identity.group.to_string()]
            } else {
                vec![identity.group.to_string(), identity.action.to_string()]
            },
            summary: definition["description"]
                .as_str()
                .or_else(|| definition["title"].as_str())
                .unwrap_or(identity.operation)
                .to_string(),
            arguments: direct_arguments(&input_schema),
            input_schema,
            result_schema,
            agent_output_schema,
            projection_identity: projection_identity(identity.operation)?.to_string(),
            errors: error_contracts(identity.operation),
        });
    }
    operations.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(operations)
}

pub fn canonical_operation_result(value: Value) -> Result<Value> {
    let result = value
        .as_object()
        .context("Canonical Operation Result must be an object")?;
    for forbidden in ["rovaiTeamTool", "rovaiTeamReceipt", "task"] {
        if result.contains_key(forbidden) {
            bail!("Canonical Operation Result contains forbidden field {forbidden}");
        }
    }
    Ok(value)
}

fn direct_arguments(input_schema: &Value) -> Vec<BuiltinToolArgument> {
    let mut properties = BTreeMap::<String, Value>::new();
    collect_schema_properties(input_schema, &mut properties);
    let required = required_in_every_variant(input_schema);
    properties
        .into_iter()
        .map(|(field, schema)| {
            let value_kind = schema_value_kind(&schema);
            BuiltinToolArgument {
                flag: direct_argument_flag(&field),
                field: field.clone(),
                repeatable: value_kind == "array",
                value_kind,
                required: required.contains(&field),
            }
        })
        .collect()
}

fn direct_argument_flag(field: &str) -> String {
    match field {
        // Principal attention is the canonical Agent-facing vocabulary. The
        // legacy --to-user spelling is accepted only by the CLI parser and is
        // deliberately absent from this discoverable operation catalog.
        // name while keeping the Core input free of a user-selectable identity.
        "mentionUser" => "--to-principal".to_string(),
        "files" => "--file".to_string(),
        _ => format!("--{}", camel_to_kebab(field)),
    }
}

fn collect_schema_properties(schema: &Value, properties: &mut BTreeMap<String, Value>) {
    if let Some(object) = schema.get("properties").and_then(Value::as_object) {
        for (name, definition) in object {
            properties
                .entry(name.clone())
                .or_insert_with(|| definition.clone());
        }
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(variants) = schema.get(keyword).and_then(Value::as_array) {
            for variant in variants {
                collect_schema_properties(variant, properties);
            }
        }
    }
}

fn required_in_every_variant(schema: &Value) -> BTreeSet<String> {
    for keyword in ["oneOf", "anyOf"] {
        if let Some(variants) = schema.get(keyword).and_then(Value::as_array) {
            let mut iter = variants.iter().map(required_in_every_variant);
            return iter.next().map_or_else(BTreeSet::new, |first| {
                iter.fold(first, |intersection, next| {
                    intersection.intersection(&next).cloned().collect()
                })
            });
        }
    }
    let mut required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if let Some(variants) = schema.get("allOf").and_then(Value::as_array) {
        for variant in variants {
            required.extend(required_in_every_variant(variant));
        }
    }
    required
}

fn schema_value_kind(schema: &Value) -> String {
    if schema.get("type").and_then(Value::as_str) == Some("array") {
        return "array".to_string();
    }
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        return kind.to_string();
    }
    if let Some(types) = schema.get("type").and_then(Value::as_array)
        && let Some(kind) = types
            .iter()
            .filter_map(Value::as_str)
            .find(|kind| *kind != "null")
    {
        return kind.to_string();
    }
    if schema.get("const").is_some() || schema.get("enum").is_some() {
        return "string".to_string();
    }
    "json".to_string()
}

fn camel_to_kebab(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_uppercase() {
            output.push('-');
            output.push(character.to_ascii_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

fn error_contracts(operation: &str) -> Vec<BuiltinToolErrorContract> {
    let mut errors = vec![
        BuiltinToolErrorContract {
            code: "builtin_tool.invalid_input".to_string(),
            recovery: BuiltinToolRecovery::FixInput,
        },
        BuiltinToolErrorContract {
            code: "builtin_tool.run_not_bound".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        },
        BuiltinToolErrorContract {
            code: "builtin_tool.idempotency_conflict".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        },
        BuiltinToolErrorContract {
            code: "builtin_tool.outcome_indeterminate".to_string(),
            recovery: BuiltinToolRecovery::ConfirmOutcome,
        },
        BuiltinToolErrorContract {
            code: "builtin_tool.output_contract_mismatch".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        },
    ];
    if matches!(
        operation,
        "camp.list" | "camp.search" | "camp.read" | "history.search"
    ) {
        errors.push(BuiltinToolErrorContract {
            code: "camp.invalid_argument".to_string(),
            recovery: BuiltinToolRecovery::FixInput,
        });
    }
    match operation {
        "camp.message.send" => {
            for code in [
                "message.addressing_invalid",
                "message.public_only_conflict",
                "message.fanout_exceeded",
                "message.a2a_depth_exhausted",
                "message.task_recipient_ambiguous",
                "message.invalid_task",
                "message.execution_budget_exceeded",
            ] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery: BuiltinToolRecovery::FixInput,
                });
            }
        }
        "team.gather" => {
            for (code, recovery) in [
                ("gather.default_lead_required", BuiltinToolRecovery::Stop),
                ("gather.no_recipients", BuiltinToolRecovery::FixInput),
                ("gather.addressing_invalid", BuiltinToolRecovery::FixInput),
                ("gather.fanout_exceeded", BuiltinToolRecovery::FixInput),
                ("gather.turn_not_active", BuiltinToolRecovery::Stop),
                (
                    "gather.execution_budget_exceeded",
                    BuiltinToolRecovery::Stop,
                ),
                ("gather.idempotency_conflict", BuiltinToolRecovery::Stop),
            ] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery,
                });
            }
        }
        "member.create" => {
            for code in [
                "member.invalid_creation_key",
                "member.invalid_identity",
                "member.avatar_invalid",
                "agent_profile.display_name_conflict",
            ] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery: BuiltinToolRecovery::FixInput,
                });
            }
            for code in [
                "member.user_confirmation_required",
                "member.creation_key_conflict",
            ] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery: BuiltinToolRecovery::Stop,
                });
            }
        }
        "team.update_task" => errors.push(BuiltinToolErrorContract {
            code: "task.version_conflict".to_string(),
            recovery: BuiltinToolRecovery::RefreshThenDecide,
        }),
        "memory.write" => {
            for code in ["memory.revision_conflict", "memory.review_version_conflict"] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery: BuiltinToolRecovery::RefreshThenDecide,
                });
            }
        }
        "memory.view" => errors.push(BuiltinToolErrorContract {
            code: "memory.view_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        "camp.search" => errors.push(BuiltinToolErrorContract {
            code: "camp.search_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        "camp.read" => errors.push(BuiltinToolErrorContract {
            code: "camp.read_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        "single_chat.history" => errors.push(BuiltinToolErrorContract {
            code: "single_chat.history_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        _ => {}
    }
    errors.sort_by(|left, right| left.code.cmp(&right.code));
    errors
}

pub fn projection_identity(operation: &str) -> Result<&'static str> {
    match operation {
        "camp.message.send" => Ok("camp-message-send-v2"),
        "team.gather" => Ok("gather-v1"),
        "memory.write" => Ok("memory-write-v2"),
        "member.create"
        | "team.create_task"
        | "team.get_task"
        | "team.list_tasks"
        | "team.update_task"
        | "camp.list"
        | "camp.search"
        | "camp.read"
        | "history.search"
        | "memory.search"
        | "memory.read"
        | "memory.view"
        | "single_chat.history" => Ok("canonical-result-v1"),
        _ => bail!("unknown built-in operation for Agent output projection"),
    }
}

pub fn recovery_for_error_code(code: &str) -> BuiltinToolRecovery {
    if code.ends_with(".version_conflict")
        || code.ends_with(".revision_conflict")
        || code.ends_with(".review_conflict")
        || code.ends_with(".review_stale")
    {
        BuiltinToolRecovery::RefreshThenDecide
    } else if code.ends_with(".invalid_input")
        || code.starts_with("message.addressing_")
        || matches!(
            code,
            "message.reply_invalid"
                | "message.public_only_conflict"
                | "message.fanout_exceeded"
                | "message.a2a_depth_exhausted"
                | "message.task_recipient_ambiguous"
                | "message.invalid_task"
                | "message.execution_budget_exceeded"
                | "gather.no_recipients"
                | "gather.addressing_invalid"
                | "gather.fanout_exceeded"
                | "member.invalid_creation_key"
                | "member.invalid_identity"
                | "member.avatar_invalid"
                | "agent_profile.display_name_conflict"
                | "camp.invalid_argument"
        )
        || code == "builtin_tool.unknown_operation"
    {
        BuiltinToolRecovery::FixInput
    } else if code == "builtin_tool.outcome_indeterminate" {
        BuiltinToolRecovery::ConfirmOutcome
    } else if code == "builtin_tool.retryable" {
        BuiltinToolRecovery::RetrySameRequest
    } else {
        BuiltinToolRecovery::Stop
    }
}

pub fn builtin_tool_receipt(
    operation: &str,
    request_id: &str,
    ok: bool,
    result_or_error: &Value,
) -> Result<String> {
    let digest = canonical_json_digest(&json!({
        "domain": "rovai.builtin-tool-receipt.v1",
        "contractVersion": BUILTIN_TOOL_RECEIPT_VERSION,
        "operation": operation,
        "requestId": request_id,
        "ok": ok,
        "resultOrError": result_or_error,
    }))?;
    Ok(format!("sha256:{digest}"))
}

pub fn builtin_tool_envelope_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["contractVersion", "ok", "operation", "requestId", "receipt"],
        "properties": {
            "contractVersion": {"const": BUILTIN_TOOL_ENVELOPE_VERSION},
            "ok": {"type": "boolean"},
            "operation": {"type": "string"},
            "requestId": {"type": "string", "format": "uuid"},
            "receipt": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
            "result": {"type": "object"},
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
        },
        "oneOf": [
            {"properties": {"ok": {"const": true}}, "required": ["result"], "not": {"required": ["error"]}},
            {"properties": {"ok": {"const": false}}, "required": ["error"], "not": {"required": ["result"]}}
        ]
    })
}

pub fn validate_builtin_tool_contract() -> Result<()> {
    let list = builtin_tool_list()?;
    if list.operations.len() != BUILTIN_TOOL_CLI_IDENTITIES.len() {
        bail!("Built-in Tool catalog is incomplete");
    }
    for identity in BUILTIN_TOOL_CLI_IDENTITIES {
        let description = builtin_tool_description(identity.operation)?;
        let expected_command = if identity.action.is_empty() {
            vec![identity.group]
        } else {
            vec![identity.group, identity.action]
        };
        if description.command != expected_command {
            bail!(
                "Built-in Tool CLI mapping drifted for {}",
                identity.operation
            );
        }
    }
    Ok(())
}

pub fn input_schema_properties(input_schema: &Value) -> Map<String, Value> {
    let mut properties = BTreeMap::new();
    collect_schema_properties(input_schema, &mut properties);
    properties.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_mapping_is_complete_unique_and_contract_valid() {
        assert_eq!(BUILTIN_TOOL_CONTRACT_VERSION, 22);
        assert_eq!(BUILTIN_TOOL_CLI_COMMAND_VERSION, 22);
        assert_eq!(BUILTIN_TOOL_RUNTIME_CAPABILITY, "builtin_cli.transport.v22");
        validate_builtin_tool_contract().unwrap();
        let operations = BUILTIN_TOOL_CLI_IDENTITIES
            .iter()
            .map(|identity| identity.operation)
            .collect::<BTreeSet<_>>();
        let commands = BUILTIN_TOOL_CLI_IDENTITIES
            .iter()
            .map(|identity| (identity.group, identity.action))
            .collect::<BTreeSet<_>>();
        assert_eq!(operations.len(), 16);
        assert_eq!(commands.len(), 16);
    }

    #[test]
    fn local_ipc_endpoint_is_one_closed_tagged_transport() {
        let unix = LocalIpcEndpoint::UnixSocket {
            path: "/tmp/rovai-builtin-7/core.sock".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&unix).unwrap(),
            json!({"transport": "unix_socket", "path": "/tmp/rovai-builtin-7/core.sock"})
        );
        #[cfg(unix)]
        unix.validate().unwrap();
        let windows = LocalIpcEndpoint::WindowsNamedPipe {
            name: r"\\.\pipe\rovai-ai-42-7b5db24c-4a43-4cab-9217-d982b08f7691".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&windows).unwrap(),
            json!({
                "transport": "windows_named_pipe",
                "name": r"\\.\pipe\rovai-ai-42-7b5db24c-4a43-4cab-9217-d982b08f7691"
            })
        );
        #[cfg(windows)]
        windows.validate().unwrap();
        for invalid in [
            r"\\server\pipe\rovai-ai-42-7b5db24c-4a43-4cab-9217-d982b08f7691",
            r"\\.\pipe\rovai-ai-zero-7b5db24c-4a43-4cab-9217-d982b08f7691",
            r"\\.\pipe\rovai-ai-42-not-a-uuid",
        ] {
            assert!(
                LocalIpcEndpoint::WindowsNamedPipe {
                    name: invalid.to_string()
                }
                .validate()
                .is_err()
            );
        }
    }

    #[test]
    fn result_contract_keeps_business_fields_flat() {
        let result = BuiltinToolInvocationEnvelope::success(
            "team.update_task",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({
                "taskId": "task-1",
                "status": "completed",
                "version": 2
            }),
        )
        .unwrap();
        result.validate().unwrap();
        assert_eq!(result.result.as_ref().unwrap()["taskId"], "task-1");
        assert!(result.result.as_ref().unwrap().get("task").is_none());
    }

    #[test]
    fn receipt_is_stable_and_covers_the_outcome() {
        let first =
            builtin_tool_receipt("camp.list", "request-1", true, &json!({"camps": []})).unwrap();
        let replay =
            builtin_tool_receipt("camp.list", "request-1", true, &json!({"camps": []})).unwrap();
        let changed = builtin_tool_receipt(
            "camp.list",
            "request-1",
            true,
            &json!({"camps": [{"campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf"}]}),
        )
        .unwrap();
        assert_eq!(first, replay);
        assert_ne!(first, changed);
        assert!(first.strip_prefix("sha256:").is_some_and(
            |digest| digest.len() == 64 && digest.chars().all(|ch| ch.is_ascii_hexdigit())
        ));
    }

    #[test]
    fn malformed_envelope_fails_receipt_and_operation_validation() {
        let mut envelope = BuiltinToolInvocationEnvelope::success(
            "camp.list",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"camps": [], "truncated": false}),
        )
        .unwrap();
        envelope.receipt = format!("sha256:{}", "0".repeat(64));
        assert!(envelope.validate().is_err());

        let mut envelope = BuiltinToolInvocationEnvelope::success(
            "camp.list",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"camps": [], "truncated": false}),
        )
        .unwrap();
        envelope.operation = "unknown.operation".to_string();
        assert!(envelope.validate().is_err());
    }

    #[test]
    fn list_and_describe_share_one_digest() {
        let list = builtin_tool_list().unwrap();
        assert!(
            list.catalog_digest.strip_prefix("sha256:").is_some_and(
                |digest| digest.len() == 64 && digest.chars().all(|ch| ch.is_ascii_hexdigit())
            )
        );
        for operation in &list.operations {
            let description = builtin_tool_description(&operation.name).unwrap();
            assert_eq!(description.catalog_digest, list.catalog_digest);
            assert!(description.agent_output_schema.is_object());
            assert!(!description.projection_identity.is_empty());
            assert!(description.errors.iter().any(|error| {
                error.code == "builtin_tool.output_contract_mismatch"
                    && error.recovery == BuiltinToolRecovery::Stop
            }));
        }
        let camp_search = builtin_tool_description("camp.search").unwrap();
        assert!(camp_search.errors.iter().any(|error| {
            error.code == "camp.invalid_argument" && error.recovery == BuiltinToolRecovery::FixInput
        }));
        assert!(camp_search.errors.iter().any(|error| {
            error.code == "camp.search_unavailable" && error.recovery == BuiltinToolRecovery::Stop
        }));
        let send = builtin_tool_description("camp.message.send").unwrap();
        assert_eq!(
            send.arguments
                .iter()
                .find(|argument| argument.field == "mentionUser")
                .map(|argument| argument.flag.as_str()),
            Some("--to-principal")
        );
        assert!(send.input_schema["properties"].get("campId").is_none());
        assert!(
            send.input_schema["properties"]
                .get("replyToCampMessageId")
                .is_none()
        );
        assert!(
            send.errors
                .iter()
                .all(|error| error.code != "message.camp_mismatch")
        );
        assert!(
            send.errors
                .iter()
                .all(|error| error.code != "message.reply_invalid")
        );
        assert!(
            send.errors
                .iter()
                .any(|error| error.code == "builtin_tool.idempotency_conflict")
        );
        assert!(
            send.input_schema["properties"]["mentionUser"]["description"]
                .as_str()
                .is_some_and(|description| {
                    description
                        .contains("new unresolved decision, answer, or action for the Principal")
                        && description.contains("Principal attention is message-local")
                })
        );
    }

    #[test]
    fn catalog_digest_changes_with_agent_facing_send_teaching() {
        let current = catalog_digest_operations().unwrap();
        let current_digest = builtin_tool_catalog_digest_from(&current).unwrap();
        let mut legacy_teaching = current.clone();
        let send = legacy_teaching
            .iter_mut()
            .find(|operation| operation.name == "camp.message.send")
            .unwrap();
        send.input_schema["properties"]["mentionUser"]["description"] =
            json!("Mention the current user and create an Inbox notification.");
        let legacy_digest = builtin_tool_catalog_digest_from(&legacy_teaching).unwrap();
        assert_ne!(current_digest, legacy_digest);
    }
}
