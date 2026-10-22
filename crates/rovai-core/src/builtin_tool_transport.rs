use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::OnceLock,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::team_tool_catalog::builtin_tool_definitions;

pub const BUILTIN_TOOL_CONTRACT_VERSION: u32 = 44;
pub const BUILTIN_TOOL_IPC_PROTOCOL_VERSION: u32 = 3;
pub const BUILTIN_TOOL_ENVELOPE_VERSION: u32 = 2;
pub const BUILTIN_TOOL_CLI_COMMAND_VERSION: u32 = 44;
pub const BUILTIN_TOOL_AGENT_OUTPUT_CONTRACT_VERSION: u32 = 14;
pub const BUILTIN_TOOL_RUNTIME_CAPABILITY: &str = "builtin_cli.transport.v44";
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
    #[serde(default)]
    pub tasks_enabled: bool,
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

pub const BUILTIN_TOOL_CLI_IDENTITIES: [BuiltinToolCliIdentity; 30] = [
    BuiltinToolCliIdentity {
        operation: "thread.message.send",
        group: "send",
        action: "",
    },
    BuiltinToolCliIdentity {
        operation: "member.list",
        group: "member",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "member.get",
        group: "member",
        action: "get",
    },
    BuiltinToolCliIdentity {
        operation: "member.update",
        group: "member",
        action: "update",
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
        operation: "thread.list",
        group: "thread",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "thread.search",
        group: "thread",
        action: "search",
    },
    BuiltinToolCliIdentity {
        operation: "thread.read",
        group: "thread",
        action: "read",
    },
    BuiltinToolCliIdentity {
        operation: "thread.runs",
        group: "thread",
        action: "runs",
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
    BuiltinToolCliIdentity {
        operation: "mission.list",
        group: "mission",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "mission.get",
        group: "mission",
        action: "get",
    },
    BuiltinToolCliIdentity {
        operation: "mission.update",
        group: "mission",
        action: "update",
    },
    BuiltinToolCliIdentity {
        operation: "mission.status",
        group: "mission",
        action: "status",
    },
    BuiltinToolCliIdentity {
        operation: "automation.list",
        group: "automation",
        action: "list",
    },
    BuiltinToolCliIdentity {
        operation: "automation.get",
        group: "automation",
        action: "get",
    },
    BuiltinToolCliIdentity {
        operation: "automation.create",
        group: "automation",
        action: "create",
    },
    BuiltinToolCliIdentity {
        operation: "automation.run",
        group: "automation",
        action: "run",
    },
    BuiltinToolCliIdentity {
        operation: "automation.close",
        group: "automation",
        action: "close",
    },
    BuiltinToolCliIdentity {
        operation: "automation.update",
        group: "automation",
        action: "update",
    },
    BuiltinToolCliIdentity {
        operation: "automation.delete",
        group: "automation",
        action: "delete",
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
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "sendInputFilePath"
        )]
        send_input_file_path: Option<String>,
    },
}

/// A display-only source identity. Never opens the file or resolves symlinks.
pub fn normalize_send_input_file_path(path: &Path) -> Option<String> {
    let path = crate::runtime_diff::normalize_absolute_path(path)?;
    let path = path.to_str()?;
    (!path.contains('\0')).then(|| path.replace('\\', "/"))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BuiltinToolError>,
}

impl BuiltinToolInvocationEnvelope {
    pub fn success(operation: &str, request_id: &str, result: Value) -> Result<Self> {
        let envelope = Self {
            contract_version: BUILTIN_TOOL_ENVELOPE_VERSION,
            ok: true,
            operation: operation.to_string(),
            request_id: request_id.to_string(),
            result: Some(result),
            error: None,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn rejected(operation: &str, request_id: &str, error: BuiltinToolError) -> Result<Self> {
        let envelope = Self {
            contract_version: BUILTIN_TOOL_ENVELOPE_VERSION,
            ok: false,
            operation: operation.to_string(),
            request_id: request_id.to_string(),
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
        match (self.ok, self.result.as_ref(), self.error.as_ref()) {
            (true, Some(result), None) => {
                validate_canonical_operation_result(result)?;
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
            }
            _ => bail!("Built-in Tool envelope must contain exactly one of result or error"),
        };
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
struct CatalogOperation {
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
    let operation = crate::thread_compat::canonical_operation(operation);
    BUILTIN_TOOL_CLI_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.operation == operation)
}

pub fn builtin_tool_identity_by_command(
    group: &str,
    action: &str,
) -> Option<BuiltinToolCliIdentity> {
    let group = if group == "camp" { "thread" } else { group };
    BUILTIN_TOOL_CLI_IDENTITIES
        .iter()
        .copied()
        .find(|identity| identity.group == group && identity.action == action)
}

pub fn builtin_tool_list(tasks_enabled: bool) -> Result<BuiltinToolList> {
    let definitions = catalog_operations()?;
    Ok(BuiltinToolList {
        contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
        operations: definitions
            .iter()
            .filter(|definition| {
                tasks_enabled || !crate::task_capability::is_task_operation(&definition.name)
            })
            .map(|definition| BuiltinToolListItem {
                name: definition.name.clone(),
                command: definition.command.clone(),
                summary: definition.summary.clone(),
            })
            .collect(),
    })
}

pub fn builtin_tool_description(
    operation: &str,
    tasks_enabled: bool,
) -> Result<BuiltinToolDescription> {
    let operation = crate::thread_compat::canonical_operation(operation);
    anyhow::ensure!(
        tasks_enabled || !crate::task_capability::is_task_operation(operation),
        "{}: {}",
        crate::task_capability::DISABLED_CODE,
        crate::task_capability::DISABLED_MESSAGE
    );
    let definitions = catalog_operations()?;
    let definition = definitions
        .iter()
        .find(|definition| definition.name == operation)
        .cloned()
        .with_context(|| format!("unknown Built-in Tool operation: {operation}"))?;
    Ok(BuiltinToolDescription {
        contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
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

fn catalog_operations() -> Result<&'static [CatalogOperation]> {
    static CATALOG: OnceLock<std::result::Result<Vec<CatalogOperation>, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| build_catalog_operations().map_err(|error| format!("{error:#}")))
        .as_ref()
        .map(Vec::as_slice)
        .map_err(|error| anyhow::anyhow!(error.clone()))
}

fn build_catalog_operations() -> Result<Vec<CatalogOperation>> {
    let mut definitions_by_name = builtin_tool_definitions()
        .iter()
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
        operations.push(CatalogOperation {
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
    validate_canonical_operation_result(&value)?;
    Ok(value)
}

fn validate_canonical_operation_result(value: &Value) -> Result<()> {
    let result = value
        .as_object()
        .context("Canonical Operation Result must be an object")?;
    for forbidden in ["rovaiTeamTool", "rovaiTeamReceipt", "task"] {
        if result.contains_key(forbidden) {
            bail!("Canonical Operation Result contains forbidden field {forbidden}");
        }
    }
    Ok(())
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
        // Keep the legacy --to-principal alias in the parser only.
        "mentionUser" => "--to-user".to_string(),
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
        "thread.list" | "thread.search" | "thread.read" | "history.search"
    ) {
        errors.push(BuiltinToolErrorContract {
            code: "camp.invalid_argument".to_string(),
            recovery: BuiltinToolRecovery::FixInput,
        });
    }
    if crate::task_capability::is_task_operation(operation) {
        errors.push(BuiltinToolErrorContract {
            code: crate::task_capability::DISABLED_CODE.into(),
            recovery: BuiltinToolRecovery::Stop,
        });
    }
    match operation {
        "thread.message.send" => {
            for code in ["message.addressing_invalid", "message.public_only_conflict"] {
                errors.push(BuiltinToolErrorContract {
                    code: code.to_string(),
                    recovery: BuiltinToolRecovery::FixInput,
                });
            }
        }
        "member.list" | "member.get" | "member.update" => {
            for code in ["member.access_denied", "member.user_confirmation_required"] {
                errors.push(BuiltinToolErrorContract {
                    code: code.into(),
                    recovery: BuiltinToolRecovery::Stop,
                });
            }
            if operation == "member.update" {
                errors.push(BuiltinToolErrorContract {
                    code: "version_conflict".into(),
                    recovery: BuiltinToolRecovery::RefreshThenDecide,
                });
                for code in [
                    "member.invalid_patch",
                    "member.invalid_identity",
                    "member.avatar_invalid",
                    "agent_profile.display_name_conflict",
                ] {
                    errors.push(BuiltinToolErrorContract {
                        code: code.into(),
                        recovery: BuiltinToolRecovery::FixInput,
                    });
                }
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
        "thread.search" => errors.push(BuiltinToolErrorContract {
            code: "thread.search_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        "thread.runs" => errors.extend([
            BuiltinToolErrorContract {
                code: "thread.runs_unavailable".into(),
                recovery: BuiltinToolRecovery::Stop,
            },
            BuiltinToolErrorContract {
                code: "single_chat.operation_denied".into(),
                recovery: BuiltinToolRecovery::Stop,
            },
        ]),
        "thread.read" => errors.push(BuiltinToolErrorContract {
            code: "thread.read_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        "single_chat.history" => errors.push(BuiltinToolErrorContract {
            code: "single_chat.history_unavailable".to_string(),
            recovery: BuiltinToolRecovery::Stop,
        }),
        _ => {}
    }
    if matches!(operation, "mission.list" | "mission.get") {
        for code in [
            "mission.invalid_input",
            "mission.invalid_cursor",
            "mission.not_found",
            "mission.current_unavailable",
        ] {
            errors.push(BuiltinToolErrorContract {
                code: code.into(),
                recovery: BuiltinToolRecovery::FixInput,
            });
        }
    }
    if matches!(operation, "mission.update" | "mission.status") {
        for code in ["mission.current_unavailable", "mission.forbidden"] {
            errors.push(BuiltinToolErrorContract {
                code: code.into(),
                recovery: BuiltinToolRecovery::Stop,
            });
        }
        for code in [
            "mission.invalid_input",
            "mission.content_required",
            "mission.invalid_title",
            "mission.description_too_long",
            "mission.invalid_source_message",
        ] {
            errors.push(BuiltinToolErrorContract {
                code: code.into(),
                recovery: BuiltinToolRecovery::FixInput,
            });
        }
    }
    errors.sort_by(|left, right| left.code.cmp(&right.code));
    errors
}

pub fn projection_identity(operation: &str) -> Result<&'static str> {
    match operation {
        "thread.message.send" => Ok("camp-message-send-v2"),
        "memory.write" => Ok("memory-write-v2"),
        "member.list"
        | "member.get"
        | "member.update"
        | "member.create"
        | "team.create_task"
        | "team.get_task"
        | "team.list_tasks"
        | "team.update_task"
        | "thread.list"
        | "thread.search"
        | "thread.read"
        | "thread.runs"
        | "history.search"
        | "memory.search"
        | "memory.read"
        | "memory.view"
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
        | "automation.delete" => Ok("canonical-result-v1"),
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

pub fn recovery_for_operation_error(operation: &str, code: &str) -> BuiltinToolRecovery {
    error_contracts(operation)
        .into_iter()
        .find(|error| error.code == code)
        .map(|error| error.recovery)
        .unwrap_or_else(|| recovery_for_error_code(code))
}

pub fn builtin_tool_envelope_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["contractVersion", "ok", "operation", "requestId"],
        "properties": {
            "contractVersion": {"const": BUILTIN_TOOL_ENVELOPE_VERSION},
            "ok": {"type": "boolean"},
            "operation": {"type": "string"},
            "requestId": {"type": "string", "format": "uuid"},
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
    let list = builtin_tool_list(true)?;
    if list.operations.len() != BUILTIN_TOOL_CLI_IDENTITIES.len() {
        bail!("Built-in Tool catalog is incomplete");
    }
    for identity in BUILTIN_TOOL_CLI_IDENTITIES {
        let description = builtin_tool_description(identity.operation, true)?;
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
        assert_eq!(BUILTIN_TOOL_CONTRACT_VERSION, 44);
        assert_eq!(BUILTIN_TOOL_CLI_COMMAND_VERSION, 44);
        assert_eq!(BUILTIN_TOOL_AGENT_OUTPUT_CONTRACT_VERSION, 14);
        assert_eq!(BUILTIN_TOOL_RUNTIME_CAPABILITY, "builtin_cli.transport.v44");
        validate_builtin_tool_contract().unwrap();
        let operations = BUILTIN_TOOL_CLI_IDENTITIES
            .iter()
            .map(|identity| identity.operation)
            .collect::<BTreeSet<_>>();
        let commands = BUILTIN_TOOL_CLI_IDENTITIES
            .iter()
            .map(|identity| (identity.group, identity.action))
            .collect::<BTreeSet<_>>();
        assert_eq!(operations.len(), 30);
        assert_eq!(commands.len(), 30);
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
                "status": "completed"
            }),
        )
        .unwrap();
        result.validate().unwrap();
        assert_eq!(result.result.as_ref().unwrap()["taskId"], "task-1");
        assert!(result.result.as_ref().unwrap().get("task").is_none());
    }

    #[test]
    fn malformed_envelope_fails_outcome_and_operation_validation() {
        let mut envelope = BuiltinToolInvocationEnvelope::success(
            "thread.list",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"threads": [], "truncated": false}),
        )
        .unwrap();
        envelope.error = Some(BuiltinToolError {
            code: "unexpected".to_string(),
            message: "result and error cannot coexist".to_string(),
            recovery: BuiltinToolRecovery::Stop,
            details: None,
        });
        assert!(envelope.validate().is_err());

        let mut envelope = BuiltinToolInvocationEnvelope::success(
            "thread.list",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"threads": [], "truncated": false}),
        )
        .unwrap();
        envelope.operation = "unknown.operation".to_string();
        assert!(envelope.validate().is_err());
    }

    #[test]
    fn list_and_describe_share_the_current_catalog() {
        let list = builtin_tool_list(true).unwrap();
        assert!(
            serde_json::to_value(&list)
                .unwrap()
                .get("catalogDigest")
                .is_none()
        );
        for operation in &list.operations {
            let description = builtin_tool_description(&operation.name, true).unwrap();
            assert_eq!(description.name, operation.name);
            assert_eq!(description.summary, operation.summary);
            assert_eq!(description.command, operation.command);
            assert!(description.agent_output_schema.is_object());
            assert!(!description.projection_identity.is_empty());
            assert!(description.errors.iter().any(|error| {
                error.code == "builtin_tool.output_contract_mismatch"
                    && error.recovery == BuiltinToolRecovery::Stop
            }));
        }
        let camp_search = builtin_tool_description("thread.search", true).unwrap();
        assert!(camp_search.errors.iter().any(|error| {
            error.code == "camp.invalid_argument" && error.recovery == BuiltinToolRecovery::FixInput
        }));
        assert!(camp_search.errors.iter().any(|error| {
            error.code == "thread.search_unavailable" && error.recovery == BuiltinToolRecovery::Stop
        }));
        assert_eq!(
            recovery_for_operation_error("mission.get", "mission.current_unavailable"),
            BuiltinToolRecovery::FixInput
        );
        assert_eq!(
            recovery_for_operation_error("mission.status", "mission.current_unavailable"),
            BuiltinToolRecovery::Stop
        );
        assert_eq!(
            recovery_for_operation_error("mission.status", "mission.invalid_source_message"),
            BuiltinToolRecovery::FixInput
        );
        let mission_status = builtin_tool_description("mission.status", true).unwrap();
        assert!(mission_status.errors.iter().any(|error| {
            error.code == "mission.invalid_source_message"
                && error.recovery == BuiltinToolRecovery::FixInput
        }));
        assert!(
            mission_status
                .errors
                .iter()
                .all(|error| error.code != "mission.source_message_required")
        );
        let send = builtin_tool_description("thread.message.send", true).unwrap();
        assert_eq!(
            send.arguments
                .iter()
                .find(|argument| argument.field == "mentionUser")
                .map(|argument| argument.flag.as_str()),
            Some("--to-user")
        );
        assert!(send.input_schema["properties"].get("threadId").is_none());
        assert!(
            send.input_schema["properties"]
                .get("replyToThreadMessageId")
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
                    description.contains("new unresolved decision, answer, or action for the User")
                        && description.contains("User attention is message-local")
                })
        );
    }
}
