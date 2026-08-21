use std::{
    collections::BTreeMap,
    env, fs,
    fs::OpenOptions,
    io::{IsTerminal, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::builtin_tool_cli_output::{
    outcome_indeterminate_agent_error, output_contract_mismatch_agent_error, project_envelope,
    validate_schema,
};
use rovai_core::builtin_tool_transport::{
    BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
    BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES, BuiltinToolArgument, BuiltinToolCliContext,
    BuiltinToolCliIdentity, BuiltinToolDescription, BuiltinToolIpcRequest,
    BuiltinToolIpcRequestBody, BuiltinToolIpcResponse, COMPACTION_HOOK_IPC_PROTOCOL_VERSION,
    COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION, CompactionHookIpcRequest,
    CompactionHookIpcResponse, CompactionObservationOutboxRecord, LocalIpcEndpoint,
    ROVAI_CLI_CONTEXT_ENV, ROVAI_RUN_TMP_ENV, builtin_tool_description,
    builtin_tool_identity_by_command,
};
use rovai_core::camp_message_send_teaching::{
    CAMP_MESSAGE_SEND_FILE_HELP, CAMP_MESSAGE_SEND_HELP_EXAMPLES,
    CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP, CAMP_MESSAGE_SEND_TO_HELP,
    CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP,
};
use rovai_core::command::canonical_json_digest;
use rovai_core::platform::local_ipc::LocalIpcClientStream;
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use uuid::Uuid;

#[path = "rovai/app_cli.rs"]
mod app_cli;

const CORE_TIMEOUT: Duration = Duration::from_secs(30);
const CORE_ATTEMPTS: usize = 3;
const COMPACTION_HOOK_TIMEOUT: Duration = Duration::from_millis(500);
const COMPACTION_HOOK_ATTEMPTS: usize = 3;
const CAMP_READ_DEFAULT_MODE: &str = "timeline";
const CAMP_READ_DEFAULT_DIRECTION: &str = "before";
const CAMP_READ_DEFAULT_LIMIT: i64 = 20;

fn main() -> ExitCode {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build();
    let result = runtime
        .context("failed to initialize the Rovai CLI local IPC runtime")
        .and_then(|runtime| runtime.block_on(run()));
    match result {
        Ok(code) => ExitCode::from(code),
        Err(_error) => {
            print_safe_cli_error();
            ExitCode::from(2)
        }
    }
}

async fn run() -> Result<u8> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg == "app") {
        if !user_automation_available_in_current_process() {
            print_user_automation_unavailable_in_runtime();
            return Ok(2);
        }
        return app_cli::run(&args[1..]).await;
    }
    if args.first().is_some_and(|arg| arg == "__compaction-hook") {
        // Runtime hooks are enhancement-only. Malformed input, unavailable
        // Core, and uncertain acknowledgements must never block compaction or
        // the AgentRun that triggered it.
        let _ = run_compaction_hook(&args[1..]).await;
        return Ok(0);
    }
    if args.as_slice() == ["--version"] || args.as_slice() == ["version"] {
        println!(
            "rovai {} contract-v{} ipc-v{}",
            env!("CARGO_PKG_VERSION"),
            BUILTIN_TOOL_CONTRACT_VERSION,
            BUILTIN_TOOL_IPC_PROTOCOL_VERSION
        );
        return Ok(0);
    }
    if args.as_slice() == ["--help"] || args.is_empty() {
        print_root_help();
        return Ok(0);
    }
    if let Some(description) = operation_help(&args)? {
        print_operation_help(&description);
        return Ok(0);
    }
    if is_family_help(&args) {
        print_invalid_input(None);
        return Ok(2);
    }
    if invocation_identity(&args).is_none() {
        print_invalid_input(None);
        return Ok(2);
    }

    let (operation, input) = match args.as_slice() {
        [command, rest @ ..] if matches!(command.as_str(), "send" | "gather") => {
            let identity = builtin_tool_identity_by_command(command, "")
                .with_context(|| format!("unknown Rovai command: rovai {command}"))?;
            let description = builtin_tool_description(identity.operation)?;
            let input = match parse_and_validate_operation_input(&description, rest) {
                Ok(input) => input,
                Err(failure) => {
                    print_invalid_input(Some(&failure));
                    return Ok(2);
                }
            };
            (identity.operation.to_string(), input)
        }
        [group, action, rest @ ..] => {
            let identity = builtin_tool_identity_by_command(group, action)
                .with_context(|| format!("unknown Rovai command: rovai {group} {action}"))?;
            let description = builtin_tool_description(identity.operation)?;
            let input = match parse_and_validate_operation_input(&description, rest) {
                Ok(input) => input,
                Err(failure) => {
                    print_invalid_input(Some(&failure));
                    return Ok(2);
                }
            };
            (identity.operation.to_string(), input)
        }
        _ => bail!("invalid Rovai command; run `rovai --help`"),
    };
    let context = load_context()?;
    let auth = context.auth()?;
    let request = BuiltinToolIpcRequest {
        ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
        auth,
        body: BuiltinToolIpcRequestBody::Invoke {
            request_id: Uuid::new_v4().to_string(),
            operation,
            input,
        },
    };

    let response = match send_with_retry(&context.core_endpoint, &request).await {
        Ok(response) => response,
        Err(BuiltinToolIpcFailure::OutcomeIndeterminate) => {
            println!(
                "{}",
                serde_json::to_string(&outcome_indeterminate_agent_error())?
            );
            return Ok(3);
        }
        Err(BuiltinToolIpcFailure::Predictable) => {
            print_safe_cli_error();
            return Ok(2);
        }
    };

    match response {
        BuiltinToolIpcResponse::Envelope { envelope } => {
            envelope.validate()?;
            let projected = match project_envelope(&envelope) {
                Ok(projected) => projected,
                Err(error) => {
                    record_output_contract_mismatch(&envelope.operation, &error);
                    println!(
                        "{}",
                        serde_json::to_string(&output_contract_mismatch_agent_error(
                            &envelope.operation
                        ))?
                    );
                    return Ok(2);
                }
            };
            println!("{}", serde_json::to_string(&projected)?);
            Ok(envelope_exit_code(&envelope))
        }
        BuiltinToolIpcResponse::Error { .. } => {
            print_safe_cli_error();
            Ok(2)
        }
    }
}

async fn run_compaction_hook(args: &[String]) -> Result<()> {
    let [
        adapter_flag,
        adapter_kind,
        host_flag,
        host_instance_id,
        signal_flag,
        source_signal,
    ] = args
    else {
        bail!("invalid internal compaction hook arguments");
    };
    if adapter_flag != "--adapter-kind"
        || host_flag != "--host-instance-id"
        || signal_flag != "--source-signal"
        || adapter_kind.trim().is_empty()
        || host_instance_id.trim().is_empty()
        || source_signal.trim().is_empty()
    {
        bail!("invalid internal compaction hook identity");
    }
    let context_path = env::var_os(ROVAI_CLI_CONTEXT_ENV)
        .map(PathBuf::from)
        .context("ROVAI_CLI_CONTEXT is not set")?;
    let context = load_context()?;
    let (process_id, process_token) = context.process_auth()?;
    let mut hook_input = String::new();
    std::io::stdin()
        .read_to_string(&mut hook_input)
        .context("failed to read compaction hook input")?;
    let hook_input: Value =
        serde_json::from_str(&hook_input).context("compaction hook input is not valid JSON")?;
    if !hook_input.is_object() {
        bail!("compaction hook input must be an object");
    }
    let native_session_id = hook_input
        .get("session_id")
        .or_else(|| hook_input.get("sessionId"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("compaction hook input has no Native Session identity")?
        .to_string();
    let reported_hook_event_name = hook_input
        .get("hook_event_name")
        .or_else(|| hook_input.get("hookEventName"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    if reported_hook_event_name.is_some_and(|reported| reported != source_signal) {
        bail!("compaction hook signal does not match its configured source");
    }
    let hook_event_name = source_signal.to_string();
    let trigger = hook_input
        .get("trigger")
        .or_else(|| hook_input.get("source"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    // Never relay or persist a digest of compact_summary, transcript content,
    // or other context-bearing Hook fields. Runtime occurrence metadata is
    // sufficient for durable idempotence and carries no Bootstrap content.
    let runtime_occurrence = hook_input
        .get("compaction_id")
        .or_else(|| hook_input.get("compactionId"))
        .or_else(|| hook_input.get("observation_id"))
        .or_else(|| hook_input.get("observationId"))
        .or_else(|| hook_input.get("request_id"))
        .or_else(|| hook_input.get("requestId"))
        .or_else(|| hook_input.get("timestamp"))
        .cloned()
        .unwrap_or_else(|| Value::String(Uuid::new_v4().to_string()));
    let source_event_digest = canonical_json_digest(&json!({
        "schemaVersion": 1,
        "adapterKind": adapter_kind,
        "nativeSessionId": native_session_id,
        "hookEventName": hook_event_name,
        "trigger": trigger,
        "runtimeOccurrence": runtime_occurrence,
    }))?;
    let request_id = Uuid::new_v4().to_string();
    let observed_at = chrono::Utc::now().to_rfc3339();
    let request = CompactionHookIpcRequest {
        kind: "compaction_observation".to_string(),
        ipc_protocol_version: COMPACTION_HOOK_IPC_PROTOCOL_VERSION,
        process_id,
        process_token,
        request_id: request_id.clone(),
        adapter_kind: adapter_kind.clone(),
        host_instance_id: host_instance_id.clone(),
        native_session_id,
        hook_event_name,
        trigger,
        source_event_digest,
    };
    let outbox_record = CompactionObservationOutboxRecord {
        schema_version: COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION,
        request_id,
        adapter_kind: request.adapter_kind.clone(),
        host_instance_id: request.host_instance_id.clone(),
        relay_process_id: request.process_id.clone(),
        native_session_id: request.native_session_id.clone(),
        hook_event_name: request.hook_event_name.clone(),
        trigger: request.trigger.clone(),
        source_event_digest: request.source_event_digest.clone(),
        observed_at,
    };
    let staged_observation = stage_compaction_observation(&context_path, &outbox_record)?;
    let mut last_error = None;
    for attempt in 0..COMPACTION_HOOK_ATTEMPTS {
        match send_compaction_hook(&context.core_endpoint, &request).await {
            Ok(_response) => {
                let _ = fs::remove_file(&staged_observation);
                return Ok(());
            }
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < COMPACTION_HOOK_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    let error = last_error.context("compaction observation submission remained uncertain")?;
    Err(error)
}

fn stage_compaction_observation(
    context_path: &Path,
    record: &CompactionObservationOutboxRecord,
) -> Result<PathBuf> {
    let process_root = context_path
        .parent()
        .context("Built-in Tool context has no process root")?;
    let outbox = process_root.join("compaction-observation-outbox");
    fs::create_dir_all(&outbox).with_context(|| {
        format!(
            "failed to create compaction observation outbox {}",
            outbox.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&outbox, fs::Permissions::from_mode(0o700))?;
    }
    let final_path = outbox.join(format!("{}.json", record.request_id));
    let temporary_path = outbox.join(format!(".{}.tmp", record.request_id));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary_path)
        .with_context(|| format!("failed to stage {}", temporary_path.display()))?;
    serde_json::to_writer(&mut file, record)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temporary_path, &final_path).with_context(|| {
        format!(
            "failed to commit compaction observation outbox record {}",
            final_path.display()
        )
    })?;
    Ok(final_path)
}

async fn send_compaction_hook(
    endpoint: &LocalIpcEndpoint,
    request: &CompactionHookIpcRequest,
) -> Result<CompactionHookIpcResponse> {
    let serialized = serde_json::to_vec(request)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        bail!("compaction hook request is too large");
    }
    let response = exchange_local_ipc_frame(endpoint, &serialized, COMPACTION_HOOK_TIMEOUT)
        .await
        .map_err(|(_, error)| error)?;
    Ok(serde_json::from_str(&response)?)
}

fn envelope_exit_code(
    envelope: &rovai_core::builtin_tool_transport::BuiltinToolInvocationEnvelope,
) -> u8 {
    if envelope.ok {
        0
    } else if envelope
        .error
        .as_ref()
        .is_some_and(|error| error.code == "builtin_tool.outcome_indeterminate")
    {
        3
    } else {
        1
    }
}

fn operation_help(args: &[String]) -> Result<Option<BuiltinToolDescription>> {
    let identity = match args {
        [command, help] if help == "--help" => builtin_tool_identity_by_command(command, ""),
        [group, action, help] if help == "--help" => {
            builtin_tool_identity_by_command(group, action)
        }
        _ => None,
    };
    identity
        .map(|identity| builtin_tool_description(identity.operation))
        .transpose()
}

fn invocation_identity(args: &[String]) -> Option<BuiltinToolCliIdentity> {
    match args {
        [command, ..] if matches!(command.as_str(), "send" | "gather") => {
            builtin_tool_identity_by_command(command, "")
        }
        [group, action, ..] => builtin_tool_identity_by_command(group, action),
        _ => None,
    }
}

fn is_family_help(args: &[String]) -> bool {
    matches!(args, [family, help] if help == "--help" && matches!(family.as_str(), "member" | "task" | "camp" | "history" | "memory"))
}

fn load_context() -> Result<BuiltinToolCliContext> {
    let path = env::var_os(ROVAI_CLI_CONTEXT_ENV)
        .map(std::path::PathBuf::from)
        .context("ROVAI_CLI_CONTEXT is not set")?;
    let bytes = fs::read(&path)
        .with_context(|| format!("failed to read Built-in Tool context {}", path.display()))?;
    serde_json::from_slice(&bytes)
        .with_context(|| format!("invalid Built-in Tool context {}", path.display()))
}

#[derive(Debug, Clone, PartialEq)]
struct CliInputField {
    field: String,
    flag: String,
    required: bool,
    value_kind: String,
    accepted_types: Vec<String>,
    constant: Option<Value>,
    allowed_values: Vec<Value>,
    minimum: Option<i64>,
    maximum: Option<i64>,
    min_length: Option<usize>,
    max_length: Option<usize>,
    min_items: Option<usize>,
    max_items: Option<usize>,
    repeatable: bool,
}

#[derive(Debug, Clone)]
struct CliInputVariant {
    discriminator_value: Value,
    fields: Vec<CliInputField>,
}

#[derive(Debug, Clone)]
struct CliDiscriminatedInput {
    discriminator_field: String,
    variants: Vec<CliInputVariant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CliInputIssueReason {
    MissingRequired,
    NotAllowedForMode,
    InvalidEnum,
    InvalidType,
    BelowMinimum,
    AboveMaximum,
    BelowMinLength,
    AboveMaxLength,
    BelowMinItems,
    AboveMaxItems,
    MissingMode,
    UnknownMode,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliInputIssue {
    field: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    flag: Option<String>,
    reason: CliInputIssueReason,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    allowed_values: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    minimum: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    maximum: Option<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    valid_modes: Vec<String>,
    #[serde(skip)]
    expected_type: Option<String>,
}

impl CliInputIssue {
    fn for_field(field: &CliInputField, reason: CliInputIssueReason) -> Self {
        Self {
            field: field.field.clone(),
            flag: Some(field.flag.clone()),
            reason,
            allowed_values: field.allowed_values.clone(),
            minimum: None,
            maximum: None,
            valid_modes: Vec::new(),
            expected_type: Some(field.value_kind.clone()),
        }
    }
}

#[derive(Debug, Clone)]
struct CliInputFailure {
    message: String,
    details: Option<Value>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct CliAppliedDefaults {
    mode: bool,
    direction: bool,
    limit: bool,
}

impl CliInputFailure {
    fn generic() -> Self {
        Self {
            message: "Command input does not match the accepted arguments.".to_string(),
            details: None,
        }
    }
}

fn parse_and_validate_operation_input(
    description: &BuiltinToolDescription,
    args: &[String],
) -> std::result::Result<Value, CliInputFailure> {
    let input = parse_operation_input(description, args).map_err(|_| CliInputFailure::generic())?;
    let (input, applied_defaults) = apply_operation_defaults(&description.name, input)
        .map_err(|_| CliInputFailure::generic())?;
    if validate_schema(&input, &description.input_schema).is_err() {
        return Err(explain_input_validation_failure(
            description,
            &input,
            applied_defaults,
        ));
    }
    Ok(input)
}

fn apply_operation_defaults(
    operation: &str,
    mut input: Value,
) -> Result<(Value, CliAppliedDefaults)> {
    let mut applied = CliAppliedDefaults::default();
    if operation != "camp.read" {
        return Ok((input, applied));
    }

    let object = input
        .as_object_mut()
        .context("camp.read input must be an object")?;
    if !object.contains_key("mode") {
        object.insert(
            "mode".to_string(),
            Value::String(CAMP_READ_DEFAULT_MODE.to_string()),
        );
        applied.mode = true;
    }
    if object.get("mode").and_then(Value::as_str) == Some(CAMP_READ_DEFAULT_MODE) {
        if !object.contains_key("direction") {
            object.insert(
                "direction".to_string(),
                Value::String(CAMP_READ_DEFAULT_DIRECTION.to_string()),
            );
            applied.direction = true;
        }
        if !object.contains_key("limit") {
            object.insert(
                "limit".to_string(),
                Value::Number(CAMP_READ_DEFAULT_LIMIT.into()),
            );
            applied.limit = true;
        }
    }

    Ok((input, applied))
}

fn discriminated_input_variants(
    description: &BuiltinToolDescription,
) -> Option<CliDiscriminatedInput> {
    let branches = description.input_schema.get("oneOf")?.as_array()?;
    if branches.len() < 2 {
        return None;
    }
    let first_properties = branches.first()?.get("properties")?.as_object()?;
    let discriminator_fields = first_properties
        .iter()
        .filter_map(|(field, property)| {
            let first_constant = property.get("const")?;
            let constants = branches
                .iter()
                .map(|branch| branch.get("properties")?.get(field)?.get("const").cloned())
                .collect::<Option<Vec<_>>>()?;
            let all_distinct = constants.iter().enumerate().all(|(index, constant)| {
                constants
                    .iter()
                    .take(index)
                    .all(|previous| previous != constant)
            });
            (constants.first() == Some(first_constant) && all_distinct).then(|| field.clone())
        })
        .collect::<Vec<_>>();
    let [discriminator_field] = discriminator_fields.as_slice() else {
        return None;
    };
    let variants = branches
        .iter()
        .map(|branch| {
            let discriminator_value = branch
                .get("properties")?
                .get(discriminator_field)?
                .get("const")?
                .clone();
            Some(CliInputVariant {
                discriminator_value,
                fields: cli_input_fields(description, branch)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(CliDiscriminatedInput {
        discriminator_field: discriminator_field.clone(),
        variants,
    })
}

fn cli_input_fields(
    description: &BuiltinToolDescription,
    schema: &Value,
) -> Option<Vec<CliInputField>> {
    let properties = schema.get("properties")?.as_object()?;
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    Some(
        properties
            .iter()
            .map(|(field, property)| {
                let argument = description
                    .arguments
                    .iter()
                    .find(|argument| argument.field == *field);
                let value_kind = argument
                    .map(|argument| argument.value_kind.clone())
                    .unwrap_or_else(|| cli_schema_value_kind(property));
                CliInputField {
                    field: field.clone(),
                    flag: argument
                        .map(|argument| argument.flag.clone())
                        .unwrap_or_else(|| format!("--{}", camel_to_kebab_cli(field))),
                    required: required.contains(&field.as_str()),
                    accepted_types: cli_schema_types(property),
                    constant: property.get("const").cloned(),
                    allowed_values: property
                        .get("enum")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                    minimum: property.get("minimum").and_then(Value::as_i64),
                    maximum: property.get("maximum").and_then(Value::as_i64),
                    min_length: property
                        .get("minLength")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize),
                    max_length: property
                        .get("maxLength")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize),
                    min_items: property
                        .get("minItems")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize),
                    max_items: property
                        .get("maxItems")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize),
                    repeatable: argument.is_some_and(|argument| argument.repeatable)
                        || value_kind == "array",
                    value_kind,
                }
            })
            .collect(),
    )
}

fn cli_schema_types(schema: &Value) -> Vec<String> {
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        return vec![kind.to_string()];
    }
    if let Some(kinds) = schema.get("type").and_then(Value::as_array) {
        return kinds
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    if let Some(constant) = schema.get("const") {
        return vec![cli_value_kind(constant).to_string()];
    }
    if let Some(value) = schema
        .get("enum")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
    {
        return vec![cli_value_kind(value).to_string()];
    }
    Vec::new()
}

fn cli_schema_value_kind(schema: &Value) -> String {
    cli_schema_types(schema)
        .into_iter()
        .find(|kind| kind != "null")
        .unwrap_or_else(|| "json".to_string())
}

fn cli_value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn camel_to_kebab_cli(value: &str) -> String {
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

fn explain_input_validation_failure(
    description: &BuiltinToolDescription,
    input: &Value,
    applied_defaults: CliAppliedDefaults,
) -> CliInputFailure {
    let Some(object) = input.as_object() else {
        return CliInputFailure::generic();
    };
    let (mode, issues) = if let Some(discriminated) = discriminated_input_variants(description) {
        explain_discriminated_input_failure(description, &discriminated, object)
    } else {
        let Some(fields) = cli_input_fields(description, &description.input_schema) else {
            return CliInputFailure::generic();
        };
        (
            None,
            explain_variant_fields(description, &fields, object, None),
        )
    };
    if issues.is_empty() {
        return CliInputFailure::generic();
    }
    let issues = issues.into_iter().take(4).collect::<Vec<_>>();
    let mut details = Map::new();
    details.insert(
        "operation".to_string(),
        Value::String(description.name.clone()),
    );
    if let Some(mode) = &mode {
        details.insert("mode".to_string(), Value::String(mode.clone()));
    }
    details.insert(
        "issues".to_string(),
        serde_json::to_value(&issues).unwrap_or_else(|_| Value::Array(Vec::new())),
    );
    let message = if description.name == "camp.read" && applied_defaults.mode {
        format_camp_read_default_mode_failure(&issues).unwrap_or_else(|| {
            format_cli_input_issue_message(&description.name, mode.as_deref(), &issues)
        })
    } else {
        format_cli_input_issue_message(&description.name, mode.as_deref(), &issues)
    };
    CliInputFailure {
        message,
        details: Some(Value::Object(details)),
    }
}

fn format_camp_read_default_mode_failure(issues: &[CliInputIssue]) -> Option<String> {
    let issue = issues
        .iter()
        .find(|issue| issue.reason == CliInputIssueReason::NotAllowedForMode)?;
    let flag = issue.flag.as_deref().unwrap_or(&issue.field);
    let mut message = format!(
        "--mode defaults to timeline, which does not accept {flag}.\nUse an explicit message-anchored mode:"
    );
    if issue.valid_modes.iter().any(|mode| mode == "item") {
        message.push_str("\n  rovai camp read --mode item --message-id '<message-id>'");
    }
    if issue.valid_modes.iter().any(|mode| mode == "around") {
        message.push_str(
            "\n  rovai camp read --mode around --message-id '<message-id>' --before 5 --after 5",
        );
    }
    if issue.valid_modes.iter().any(|mode| mode == "thread") {
        message.push_str(
            "\n  rovai camp read --mode thread --message-id '<message-id>' --direction <before|after>",
        );
    }
    Some(message)
}

fn explain_discriminated_input_failure(
    description: &BuiltinToolDescription,
    discriminated: &CliDiscriminatedInput,
    object: &Map<String, Value>,
) -> (Option<String>, Vec<CliInputIssue>) {
    let allowed_values = discriminated
        .variants
        .iter()
        .map(|variant| variant.discriminator_value.clone())
        .collect::<Vec<_>>();
    let Some(discriminator_value) = object.get(&discriminated.discriminator_field) else {
        return (
            None,
            vec![CliInputIssue {
                field: discriminated.discriminator_field.clone(),
                flag: description
                    .arguments
                    .iter()
                    .find(|argument| argument.field == discriminated.discriminator_field)
                    .map(|argument| argument.flag.clone()),
                reason: if discriminated.discriminator_field == "mode" {
                    CliInputIssueReason::MissingMode
                } else {
                    CliInputIssueReason::MissingRequired
                },
                allowed_values,
                minimum: None,
                maximum: None,
                valid_modes: Vec::new(),
                expected_type: Some("string".to_string()),
            }],
        );
    };
    let Some(variant) = discriminated
        .variants
        .iter()
        .find(|variant| variant.discriminator_value == *discriminator_value)
    else {
        return (
            None,
            vec![CliInputIssue {
                field: discriminated.discriminator_field.clone(),
                flag: description
                    .arguments
                    .iter()
                    .find(|argument| argument.field == discriminated.discriminator_field)
                    .map(|argument| argument.flag.clone()),
                reason: if discriminated.discriminator_field == "mode" {
                    CliInputIssueReason::UnknownMode
                } else {
                    CliInputIssueReason::InvalidEnum
                },
                allowed_values,
                minimum: None,
                maximum: None,
                valid_modes: Vec::new(),
                expected_type: Some("string".to_string()),
            }],
        );
    };
    let mode = variant.discriminator_value.as_str().map(str::to_string);
    let issues = explain_variant_fields(description, &variant.fields, object, Some(discriminated));
    (mode, issues)
}

fn explain_variant_fields(
    description: &BuiltinToolDescription,
    fields: &[CliInputField],
    object: &Map<String, Value>,
    discriminated: Option<&CliDiscriminatedInput>,
) -> Vec<CliInputIssue> {
    let mut issues = Vec::new();

    for field in fields.iter().filter(|field| field.required) {
        if !object.contains_key(&field.field) {
            issues.push(CliInputIssue::for_field(
                field,
                CliInputIssueReason::MissingRequired,
            ));
        }
    }

    for field_name in object.keys() {
        if fields.iter().any(|field| field.field == *field_name) {
            continue;
        }
        let valid_modes = discriminated.map_or_else(Vec::new, |discriminated| {
            discriminated
                .variants
                .iter()
                .filter(|variant| {
                    variant
                        .fields
                        .iter()
                        .any(|field| field.field == *field_name)
                })
                .filter_map(|variant| variant.discriminator_value.as_str().map(str::to_string))
                .collect()
        });
        issues.push(CliInputIssue {
            field: field_name.clone(),
            flag: description
                .arguments
                .iter()
                .find(|argument| argument.field == *field_name)
                .map(|argument| argument.flag.clone()),
            reason: CliInputIssueReason::NotAllowedForMode,
            allowed_values: Vec::new(),
            minimum: None,
            maximum: None,
            valid_modes,
            expected_type: None,
        });
    }

    for field in fields {
        let Some(value) = object.get(&field.field) else {
            continue;
        };
        let invalid_constant = field
            .constant
            .as_ref()
            .is_some_and(|constant| constant != value);
        let invalid_enum = !field.allowed_values.is_empty()
            && !field.allowed_values.iter().any(|allowed| allowed == value);
        if invalid_constant || invalid_enum {
            let mut issue = CliInputIssue::for_field(field, CliInputIssueReason::InvalidEnum);
            if issue.allowed_values.is_empty()
                && let Some(constant) = &field.constant
            {
                issue.allowed_values.push(constant.clone());
            }
            issues.push(issue);
        }
    }

    for field in fields {
        let Some(value) = object.get(&field.field) else {
            continue;
        };
        if !field.accepted_types.is_empty()
            && !field
                .accepted_types
                .iter()
                .any(|kind| cli_value_matches_type(value, kind))
        {
            issues.push(CliInputIssue::for_field(
                field,
                CliInputIssueReason::InvalidType,
            ));
        }
    }

    for field in fields {
        let Some(value) = object.get(&field.field) else {
            continue;
        };
        let Some(number) = value.as_i64() else {
            continue;
        };
        if let Some(minimum) = field.minimum
            && number < minimum
        {
            let mut issue = CliInputIssue::for_field(field, CliInputIssueReason::BelowMinimum);
            issue.minimum = Some(minimum);
            issues.push(issue);
        }
        if let Some(maximum) = field.maximum
            && number > maximum
        {
            let mut issue = CliInputIssue::for_field(field, CliInputIssueReason::AboveMaximum);
            issue.maximum = Some(maximum);
            issues.push(issue);
        }
    }

    for field in fields {
        let Some(value) = object.get(&field.field) else {
            continue;
        };
        if let Some(text) = value.as_str() {
            let length = text.chars().count();
            if let Some(minimum) = field.min_length
                && length < minimum
            {
                let mut issue =
                    CliInputIssue::for_field(field, CliInputIssueReason::BelowMinLength);
                issue.minimum = Some(minimum as i64);
                issues.push(issue);
            }
            if let Some(maximum) = field.max_length
                && length > maximum
            {
                let mut issue =
                    CliInputIssue::for_field(field, CliInputIssueReason::AboveMaxLength);
                issue.maximum = Some(maximum as i64);
                issues.push(issue);
            }
        }
        if let Some(values) = value.as_array() {
            if let Some(minimum) = field.min_items
                && values.len() < minimum
            {
                let mut issue = CliInputIssue::for_field(field, CliInputIssueReason::BelowMinItems);
                issue.minimum = Some(minimum as i64);
                issues.push(issue);
            }
            if let Some(maximum) = field.max_items
                && values.len() > maximum
            {
                let mut issue = CliInputIssue::for_field(field, CliInputIssueReason::AboveMaxItems);
                issue.maximum = Some(maximum as i64);
                issues.push(issue);
            }
        }
    }

    issues
}

fn cli_value_matches_type(value: &Value, kind: &str) -> bool {
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

fn format_cli_input_issue_message(
    operation: &str,
    mode: Option<&str>,
    issues: &[CliInputIssue],
) -> String {
    let context = mode.map_or_else(
        || operation.to_string(),
        |mode| format!("{operation} {mode}"),
    );
    let clauses = issues
        .iter()
        .map(|issue| {
            let flag = issue.flag.as_deref().unwrap_or(&issue.field);
            match issue.reason {
                CliInputIssueReason::MissingMode => format!(
                    "requires {flag} <{}>",
                    pipe_separated_values(&issue.allowed_values)
                ),
                CliInputIssueReason::UnknownMode | CliInputIssueReason::InvalidEnum => format!(
                    "accepts only {} for {flag}",
                    human_join_values(&issue.allowed_values)
                ),
                CliInputIssueReason::MissingRequired => {
                    if issue.allowed_values.is_empty() {
                        format!("requires {flag}")
                    } else {
                        format!(
                            "requires {flag} <{}>",
                            pipe_separated_values(&issue.allowed_values)
                        )
                    }
                }
                CliInputIssueReason::NotAllowedForMode => {
                    if issue.valid_modes.len() == 1 {
                        format!("{flag} is valid only in {} mode", issue.valid_modes[0])
                    } else if issue.valid_modes.is_empty() {
                        format!("does not accept {flag}")
                    } else {
                        format!(
                            "{flag} is valid only in {} modes",
                            human_join_strings(&issue.valid_modes)
                        )
                    }
                }
                CliInputIssueReason::InvalidType => format!(
                    "requires {flag} to be {}",
                    issue
                        .expected_type
                        .as_deref()
                        .unwrap_or("the documented type")
                ),
                CliInputIssueReason::BelowMinimum => format!(
                    "requires {flag} to be at least {}",
                    issue.minimum.unwrap_or_default()
                ),
                CliInputIssueReason::AboveMaximum => format!(
                    "requires {flag} to be at most {}",
                    issue.maximum.unwrap_or_default()
                ),
                CliInputIssueReason::BelowMinLength => format!(
                    "requires {flag} to contain at least {} characters",
                    issue.minimum.unwrap_or_default()
                ),
                CliInputIssueReason::AboveMaxLength => format!(
                    "requires {flag} to contain at most {} characters",
                    issue.maximum.unwrap_or_default()
                ),
                CliInputIssueReason::BelowMinItems => format!(
                    "requires {flag} at least {} time(s)",
                    issue.minimum.unwrap_or_default()
                ),
                CliInputIssueReason::AboveMaxItems => format!(
                    "accepts {flag} at most {} time(s)",
                    issue.maximum.unwrap_or_default()
                ),
            }
        })
        .collect::<Vec<_>>();
    format!("{context} {}.", clauses.join("; "))
}

fn pipe_separated_values(values: &[Value]) -> String {
    values
        .iter()
        .map(compact_cli_value)
        .collect::<Vec<_>>()
        .join("|")
}

fn human_join_values(values: &[Value]) -> String {
    human_join_strings(&values.iter().map(compact_cli_value).collect::<Vec<_>>())
}

fn human_join_strings(values: &[String]) -> String {
    match values {
        [] => "the documented values".to_string(),
        [value] => value.clone(),
        [left, right] => format!("{left} or {right}"),
        _ => format!(
            "{}, or {}",
            values[..values.len() - 1].join(", "),
            values.last().expect("non-empty values")
        ),
    }
}

fn compact_cli_value(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn parse_operation_input(description: &BuiltinToolDescription, args: &[String]) -> Result<Value> {
    let argument_by_flag = description
        .arguments
        .iter()
        .map(|argument| (argument.flag.as_str(), argument))
        .collect::<BTreeMap<_, _>>();
    let mut direct = Map::new();
    let mut input_file = None::<String>;
    let mut index = 0usize;
    while index < args.len() {
        let raw = &args[index];
        if raw == "--input-file" {
            if input_file.is_some() {
                bail!("--input-file may be specified only once");
            }
            index += 1;
            input_file = Some(
                args.get(index)
                    .context("--input-file requires a path")?
                    .clone(),
            );
            index += 1;
            continue;
        }
        let (flag, inline_value) = raw
            .split_once('=')
            .map_or((raw.as_str(), None), |(flag, value)| (flag, Some(value)));
        let canonical_flag = if description.name == "camp.message.send" && flag == "--to-user" {
            "--to-principal"
        } else {
            flag
        };
        let argument = argument_by_flag
            .get(canonical_flag)
            .with_context(|| format!("unknown argument for {}: {flag}", description.name))?;
        if input_file.is_some() {
            bail!("--input-file cannot be combined with direct arguments");
        }
        let value = if argument.value_kind == "boolean" && inline_value.is_none() {
            match args.get(index + 1) {
                Some(next) if !next.starts_with("--") => {
                    index += 1;
                    parse_direct_value(argument, next)?
                }
                _ => Value::Bool(true),
            }
        } else {
            let value = match inline_value {
                Some(value) => value,
                None => {
                    index += 1;
                    args.get(index)
                        .with_context(|| format!("{flag} requires a value"))?
                }
            };
            parse_direct_value(argument, value)?
        };
        insert_direct_value(&mut direct, argument, value)?;
        index += 1;
    }

    let mut stdin_text = String::new();
    // Explicit sources win without touching an inherited non-terminal stdin. Some
    // Runtime shells keep stdin open for their own protocol, so probing it here can
    // otherwise block an otherwise complete direct-flag or input-file invocation.
    if direct.is_empty() && input_file.is_none() && !std::io::stdin().is_terminal() {
        std::io::stdin()
            .read_to_string(&mut stdin_text)
            .context("failed to read Built-in Tool input from stdin")?;
    }
    let stdin_text = stdin_text.trim();
    let sources = usize::from(!direct.is_empty())
        + usize::from(input_file.is_some())
        + usize::from(!stdin_text.is_empty());
    if sources > 1 {
        bail!("direct arguments, stdin/heredoc, and --input-file are mutually exclusive");
    }
    if !direct.is_empty() {
        return Ok(Value::Object(direct));
    }
    if let Some(path) = input_file {
        let bytes = fs::read(&path).with_context(|| format!("failed to read {path}"))?;
        return parse_json_object(&bytes, "--input-file");
    }
    if !stdin_text.is_empty() {
        return parse_json_object(stdin_text.as_bytes(), "stdin");
    }
    Ok(Value::Object(Map::new()))
}

fn parse_json_object(bytes: &[u8], source: &str) -> Result<Value> {
    let value: Value = serde_json::from_slice(bytes)
        .with_context(|| format!("{source} must contain one valid JSON object"))?;
    if !value.is_object() {
        bail!("{source} must contain one JSON object");
    }
    Ok(value)
}

fn parse_direct_value(argument: &BuiltinToolArgument, raw: &str) -> Result<Value> {
    match argument.value_kind.as_str() {
        "boolean" => raw
            .parse::<bool>()
            .map(Value::Bool)
            .with_context(|| format!("{} expects true or false", argument.flag)),
        "integer" => raw
            .parse::<i64>()
            .map(serde_json::Number::from)
            .map(Value::Number)
            .with_context(|| format!("{} expects an integer", argument.flag)),
        "number" => serde_json::from_str::<Value>(raw)
            .with_context(|| format!("{} expects a JSON number", argument.flag)),
        "json" => serde_json::from_str::<Value>(raw)
            .with_context(|| format!("{} expects JSON", argument.flag)),
        "array" | "string" => Ok(Value::String(raw.to_string())),
        other => bail!("{} has unsupported value kind {other}", argument.flag),
    }
}

fn insert_direct_value(
    direct: &mut Map<String, Value>,
    argument: &BuiltinToolArgument,
    value: Value,
) -> Result<()> {
    if argument.repeatable {
        let values = direct
            .entry(argument.field.clone())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .context("repeatable argument did not produce an array")?;
        values.push(value);
        return Ok(());
    }
    if direct.insert(argument.field.clone(), value).is_some() {
        bail!("{} may be specified only once", argument.flag);
    }
    Ok(())
}

async fn send_with_retry(
    endpoint: &LocalIpcEndpoint,
    request: &BuiltinToolIpcRequest,
) -> std::result::Result<BuiltinToolIpcResponse, BuiltinToolIpcFailure> {
    let serialized = serde_json::to_vec(request).map_err(|_| BuiltinToolIpcFailure::Predictable)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        return Err(BuiltinToolIpcFailure::Predictable);
    }
    let mut dispatch_became_indeterminate = false;
    for attempt in 0..CORE_ATTEMPTS {
        match exchange_local_ipc_frame(endpoint, &serialized, CORE_TIMEOUT).await {
            Err((LocalIpcRoundTripFailure::InvalidFrame, _)) => {
                return Err(BuiltinToolIpcFailure::Predictable);
            }
            Err((LocalIpcRoundTripFailure::BeforeDispatch, _)) => {}
            Err((LocalIpcRoundTripFailure::AfterDispatch, _)) => {
                dispatch_became_indeterminate = true;
            }
            Ok(response) => match serde_json::from_str(&response) {
                Ok(response) => return Ok(response),
                Err(_) => return Err(BuiltinToolIpcFailure::Predictable),
            },
        }
        if attempt + 1 < CORE_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    Err(if dispatch_became_indeterminate {
        BuiltinToolIpcFailure::OutcomeIndeterminate
    } else {
        BuiltinToolIpcFailure::Predictable
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalIpcRoundTripFailure {
    BeforeDispatch,
    AfterDispatch,
    InvalidFrame,
}

async fn exchange_local_ipc_frame(
    endpoint: &LocalIpcEndpoint,
    serialized: &[u8],
    timeout: Duration,
) -> std::result::Result<String, (LocalIpcRoundTripFailure, anyhow::Error)> {
    let mut stream = tokio::time::timeout(timeout, LocalIpcClientStream::connect(endpoint))
        .await
        .map_err(|error| (LocalIpcRoundTripFailure::BeforeDispatch, error.into()))?
        .map_err(|error| (LocalIpcRoundTripFailure::BeforeDispatch, error))?;
    tokio::time::timeout(timeout, async {
        stream.write_all(serialized).await?;
        stream.write_all(b"\n").await?;
        stream.flush().await
    })
    .await
    .map_err(|error| (LocalIpcRoundTripFailure::AfterDispatch, error.into()))?
    .map_err(|error| (LocalIpcRoundTripFailure::AfterDispatch, error.into()))?;
    tokio::time::timeout(timeout, read_bounded_response(stream))
        .await
        .map_err(|error| (LocalIpcRoundTripFailure::AfterDispatch, error.into()))?
        .map_err(|error| {
            let kind = if error.kind() == std::io::ErrorKind::InvalidData {
                LocalIpcRoundTripFailure::InvalidFrame
            } else {
                LocalIpcRoundTripFailure::AfterDispatch
            };
            (kind, error.into())
        })
}

async fn read_bounded_response(stream: impl AsyncRead + Unpin) -> std::io::Result<String> {
    let reader = BufReader::new(stream);
    let mut limited = reader.take((BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 2) as u64);
    let mut frame = Vec::new();
    let read = limited.read_until(b'\n', &mut frame).await?;
    if read == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "Built-in Tool IPC response ended before a frame",
        ));
    }
    if frame.last() != Some(&b'\n') || frame.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 1 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Built-in Tool IPC response exceeds the frame limit",
        ));
    }
    frame.pop();
    if frame.last() == Some(&b'\r') {
        frame.pop();
    }
    String::from_utf8(frame).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Built-in Tool IPC response is not UTF-8",
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BuiltinToolIpcFailure {
    Predictable,
    OutcomeIndeterminate,
}

fn print_root_help() {
    print!(
        "{}",
        root_help_text(!user_automation_available_in_current_process())
    );
}

fn root_help_text(managed_runtime: bool) -> String {
    let mut text = "Rovai CLI\n\nAgent operations:\n  rovai send\n  rovai gather\n  rovai member create\n  rovai task create|get|list|update\n  rovai camp list|search|read\n  rovai history search\n  rovai memory view|search|read|write\n\nRun an Agent operation's exact `--help` for its closed inputs. Each Agent operation supports direct flags, JSON stdin/heredoc, or --input-file <path>.\n".to_string();
    if !managed_runtime {
        text.push_str("\nUser Automation:\n  rovai app --help\n\nAgent operations keep their process-private transport. `rovai app` uses the running Desktop App's separate User Automation transport.\n");
    }
    text
}

fn user_automation_available_in_current_process() -> bool {
    user_automation_available_in_process(
        env::var(ROVAI_CLI_CONTEXT_ENV).ok().as_deref(),
        env::var(ROVAI_RUN_TMP_ENV).ok().as_deref(),
    )
}

fn user_automation_available_in_process(
    builtin_tool_context: Option<&str>,
    run_tmp: Option<&str>,
) -> bool {
    builtin_tool_context.is_none() && run_tmp.is_none()
}

fn print_user_automation_unavailable_in_runtime() {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "error": {
                "code": "user_automation.unavailable_in_managed_runtime",
                "message": "User Automation is unavailable inside a Core-managed Runtime process.",
                "recovery": "stop"
            }
        }))
        .unwrap_or_else(|_| {
            "{\"error\":{\"code\":\"user_automation.unavailable_in_managed_runtime\",\"message\":\"User Automation is unavailable inside a Core-managed Runtime process.\",\"recovery\":\"stop\"}}".to_string()
        })
    );
}

fn print_safe_cli_error() {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "error": {
                "code": "builtin_tool.cli_error",
                "message": "Built-in Tool request could not be completed.",
                "recovery": "stop"
            }
        }))
        .unwrap_or_else(|_| {
            "{\"error\":{\"code\":\"builtin_tool.cli_error\",\"message\":\"Built-in Tool request could not be completed.\",\"recovery\":\"stop\"}}".to_string()
        })
    );
}

fn record_output_contract_mismatch(operation: &str, error: &anyhow::Error) {
    let Some(run_tmp) = env::var_os(ROVAI_RUN_TMP_ENV) else {
        return;
    };
    let _ = write_output_contract_mismatch_diagnostic(Path::new(&run_tmp), operation, error);
}

fn write_output_contract_mismatch_diagnostic(
    run_tmp: &Path,
    operation: &str,
    error: &anyhow::Error,
) -> Result<PathBuf> {
    let path = run_tmp.join(format!(
        "builtin-tool-cli-diagnostic-{}.json",
        Uuid::new_v4()
    ));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .context("failed to create Built-in Tool CLI diagnostic")?;
    let diagnostic = json!({
        "observedAt": chrono::Utc::now().to_rfc3339(),
        "code": "builtin_tool.output_contract_mismatch",
        "operation": operation,
        "diagnostic": format!("{error:#}"),
    });
    serde_json::to_writer(&mut file, &diagnostic)
        .context("failed to write Built-in Tool CLI diagnostic")?;
    file.write_all(b"\n")
        .context("failed to finish Built-in Tool CLI diagnostic")?;
    Ok(path)
}

fn print_invalid_input(failure: Option<&CliInputFailure>) {
    let mut error = Map::new();
    error.insert(
        "code".to_string(),
        Value::String("builtin_tool.invalid_input".to_string()),
    );
    error.insert(
        "message".to_string(),
        Value::String(
            failure
                .map(|failure| failure.message.clone())
                .unwrap_or_else(|| {
                    "Command input does not match the accepted arguments.".to_string()
                }),
        ),
    );
    error.insert(
        "recovery".to_string(),
        Value::String("fix_input".to_string()),
    );
    if let Some(details) = failure.and_then(|failure| failure.details.clone()) {
        error.insert("details".to_string(), details);
    }
    println!(
        "{}",
        serde_json::to_string(&json!({"error": error}))
        .unwrap_or_else(|_| {
            "{\"error\":{\"code\":\"builtin_tool.invalid_input\",\"message\":\"Command input does not match the accepted arguments.\",\"recovery\":\"fix_input\"}}".to_string()
        })
    );
}

fn print_operation_help(description: &BuiltinToolDescription) {
    print!("{}", operation_help_text(description));
}

fn operation_help_text(description: &BuiltinToolDescription) -> String {
    use std::fmt::Write as _;

    let mut output = String::new();
    writeln!(
        output,
        "rovai {}\n{}\n\nInput: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.\n",
        description.command.join(" "),
        description.summary
    )
    .expect("writing help to a String cannot fail");
    if description.name == "camp.read" {
        writeln!(
            output,
            "Default behavior:\n  With no --mode, camp read uses:\n    --mode {CAMP_READ_DEFAULT_MODE} --direction {CAMP_READ_DEFAULT_DIRECTION} --limit {CAMP_READ_DEFAULT_LIMIT}\n\n  This reads the newest {CAMP_READ_DEFAULT_LIMIT} visible messages from the current Camp,\n  or from --camp-id when one is supplied.\n\n  Use --direction after to begin with the oldest visible page.\n  Use an explicit item, around, or thread mode for message-anchored reads.\n"
        )
        .expect("writing help to a String cannot fail");
    }
    let rendered_discriminated = discriminated_input_variants(description).is_some_and(|input| {
        if description.name == "camp.read" {
            render_camp_read_input_help(&mut output, description, &input);
        } else {
            render_discriminated_input_help(&mut output, description, &input);
        }
        true
    });
    if !rendered_discriminated {
        render_flat_input_help(&mut output, description);
        let examples = operation_help_examples(&description.name);
        writeln!(output, "\nExamples:").expect("writing help to a String cannot fail");
        for example in examples {
            writeln!(output, "  {example}").expect("writing help to a String cannot fail");
        }
    }
    if description.name == "team.gather" {
        writeln!(
            output,
            "\nGather is asynchronous. After acceptance, end the current Lead Run. Do not poll, repeat Gather, or wait synchronously; Rovai delivers one FIFO completion after every member Run is terminal. Member progress returns stay public, but only the last accepted return from each current Run/retry generation is included as its captured result, so the member's final send must contain the complete conclusion. Captured returns do not consume the ordinary A2A allowance and are limited to 16 per Item/retry generation."
        )
        .expect("writing help to a String cannot fail");
    }
    output
}

fn render_flat_input_help(output: &mut String, description: &BuiltinToolDescription) {
    use std::fmt::Write as _;

    for argument in &description.arguments {
        writeln!(
            output,
            "  {:<28} field={} type={}{}{}",
            argument.flag,
            argument.field,
            argument.value_kind,
            if argument.repeatable {
                " repeatable"
            } else {
                ""
            },
            if argument.required { " required" } else { "" },
        )
        .expect("writing help to a String cannot fail");
        if description.name == "camp.message.send" && argument.field == "to" {
            write_indented_help(output, CAMP_MESSAGE_SEND_TO_HELP);
        }
        if description.name == "camp.message.send" && argument.field == "publicOnly" {
            write_indented_help(output, CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP);
        }
        if description.name == "team.gather" && argument.field == "to" {
            writeln!(
                output,
                "      Canonical member target; repeat as needed. Duplicate targets are frozen once."
            )
            .expect("writing help to a String cannot fail");
        }
        if description.name == "camp.message.send" && argument.field == "mentionUser" {
            write_indented_help(output, CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP);
        }
        if description.name == "camp.message.send" && argument.field == "files" {
            write_indented_help(output, CAMP_MESSAGE_SEND_FILE_HELP);
        }
        if description.name == "memory.view" && argument.field == "scope" {
            writeln!(output, "      One of: hearth, companion, relationship.")
                .expect("writing help to a String cannot fail");
        }
        if description.name == "memory.view" && argument.field == "counterpartyAgentId" {
            writeln!(
                output,
                "      Required only when --scope relationship selects an exact pair."
            )
            .expect("writing help to a String cannot fail");
        }
        if description.name == "member.create" && argument.field == "creationKey" {
            writeln!(
                output,
                "      Generate one new lowercase UUID after confirmation; reuse it only for an exact retry."
            )
            .expect("writing help to a String cannot fail");
        }
        if description.name == "member.create" && argument.field == "avatarFile" {
            writeln!(
                output,
                "      Optional run-readable PNG/JPEG path. If unavailable, omit it and Rovai uses the default avatar."
            )
                .expect("writing help to a String cannot fail");
        }
        if matches!(description.name.as_str(), "camp.search" | "camp.read")
            && argument.field == "campId"
        {
            writeln!(
                output,
                "      Optional. Omit for the current Camp; pass an authorized frozen historical Camp ID to target that Camp only."
            )
            .expect("writing help to a String cannot fail");
        }
    }
}

fn render_discriminated_input_help(
    output: &mut String,
    description: &BuiltinToolDescription,
    input: &CliDiscriminatedInput,
) {
    use std::fmt::Write as _;

    let common_fields = discriminated_common_fields(input);
    if !common_fields.is_empty() {
        writeln!(output, "Common options:").expect("writing help to a String cannot fail");
        for required in [true, false] {
            let fields = common_fields
                .iter()
                .copied()
                .filter(|field| field.required == required)
                .collect::<Vec<_>>();
            if fields.is_empty() {
                continue;
            }
            writeln!(
                output,
                "  {}:",
                if required { "Required" } else { "Optional" }
            )
            .expect("writing help to a String cannot fail");
            for field in fields {
                render_cli_input_field(output, description, field);
            }
        }
        writeln!(output).expect("writing help to a String cannot fail");
    }

    for variant in &input.variants {
        let mode = compact_cli_value(&variant.discriminator_value);
        writeln!(
            output,
            "{} {mode}:",
            capitalize_cli_label(&input.discriminator_field)
        )
        .expect("writing help to a String cannot fail");
        for required in [true, false] {
            let mut fields = variant
                .fields
                .iter()
                .filter(|field| {
                    field.required == required
                        && !common_fields
                            .iter()
                            .any(|common| common.field == field.field)
                })
                .collect::<Vec<_>>();
            fields.sort_by_key(|field| {
                (
                    usize::from(field.field != input.discriminator_field),
                    field.field.as_str(),
                )
            });
            if fields.is_empty() {
                continue;
            }
            writeln!(
                output,
                "  {}:",
                if required { "Required" } else { "Optional" }
            )
            .expect("writing help to a String cannot fail");
            for field in fields {
                render_cli_input_field(output, description, field);
            }
        }
        let examples = operation_help_examples_for_variant(&description.name, &mode);
        if !examples.is_empty() {
            writeln!(output, "  Examples:").expect("writing help to a String cannot fail");
            for example in examples {
                writeln!(output, "    {example}").expect("writing help to a String cannot fail");
            }
        }
        writeln!(output).expect("writing help to a String cannot fail");
    }

    if description.name == "camp.read" {
        writeln!(
            output,
            "Direction semantics:\n  before = move toward lower sequence numbers / older messages.\n           Without a cursor, begin with the newest visible page.\n  after  = move toward higher sequence numbers / newer messages.\n           Without a cursor, begin with the oldest visible page.\n\nDo not use older, newer, backward, or forward as direction values."
        )
        .expect("writing help to a String cannot fail");
    }
}

fn render_camp_read_input_help(
    output: &mut String,
    description: &BuiltinToolDescription,
    input: &CliDiscriminatedInput,
) {
    use std::fmt::Write as _;

    let common_fields = discriminated_common_fields(input);
    if !common_fields.is_empty() {
        writeln!(output, "Common options:\n  Optional:")
            .expect("writing help to a String cannot fail");
        for field in &common_fields {
            render_cli_input_field(output, description, field);
        }
        writeln!(output).expect("writing help to a String cannot fail");
    }

    let mode_values = input
        .variants
        .iter()
        .map(|variant| compact_cli_value(&variant.discriminator_value))
        .collect::<Vec<_>>();
    writeln!(
        output,
        "Mode selection:\n  Optional:\n    --mode <{}>\n        JSON field: mode\n        Allowed values: {}\n        Default: {CAMP_READ_DEFAULT_MODE}.\n",
        mode_values.join("|"),
        mode_values.join(", ")
    )
    .expect("writing help to a String cannot fail");

    for variant in &input.variants {
        let mode = compact_cli_value(&variant.discriminator_value);
        writeln!(output, "Mode {mode}:").expect("writing help to a String cannot fail");
        for required in [true, false] {
            let mut fields = variant
                .fields
                .iter()
                .filter(|field| {
                    field.field != input.discriminator_field
                        && !common_fields
                            .iter()
                            .any(|common| common.field == field.field)
                        && camp_read_help_field_required(&mode, field) == required
                })
                .collect::<Vec<_>>();
            fields.sort_by_key(|field| field.field.as_str());
            if fields.is_empty() {
                continue;
            }
            writeln!(
                output,
                "  {}:",
                if required { "Required" } else { "Optional" }
            )
            .expect("writing help to a String cannot fail");
            for field in fields {
                render_cli_input_field(output, description, field);
                if mode == "timeline" && field.field == "direction" {
                    writeln!(output, "        Default: {CAMP_READ_DEFAULT_DIRECTION}.")
                        .expect("writing help to a String cannot fail");
                }
                if matches!(mode.as_str(), "thread" | "timeline") && field.field == "limit" {
                    writeln!(output, "        Default: {CAMP_READ_DEFAULT_LIMIT}.")
                        .expect("writing help to a String cannot fail");
                }
            }
        }
        let examples = operation_help_examples_for_variant(&description.name, &mode);
        if !examples.is_empty() {
            writeln!(output, "  Examples:").expect("writing help to a String cannot fail");
            for example in examples {
                writeln!(output, "    {example}").expect("writing help to a String cannot fail");
            }
        }
        writeln!(output).expect("writing help to a String cannot fail");
    }

    writeln!(
        output,
        "Direction semantics:\n  before = move toward lower sequence numbers / older messages.\n           Without a cursor, begin with the newest visible page.\n  after  = move toward higher sequence numbers / newer messages.\n           Without a cursor, begin with the oldest visible page.\n\nReuse nextCursor with the same mode and direction.\nDo not use older, newer, backward, or forward as direction values."
    )
    .expect("writing help to a String cannot fail");
}

fn camp_read_help_field_required(mode: &str, field: &CliInputField) -> bool {
    field.required && !(mode == CAMP_READ_DEFAULT_MODE && field.field == "direction")
}

fn discriminated_common_fields(input: &CliDiscriminatedInput) -> Vec<&CliInputField> {
    let Some(first) = input.variants.first() else {
        return Vec::new();
    };
    first
        .fields
        .iter()
        .filter(|candidate| candidate.field != input.discriminator_field)
        .filter(|candidate| {
            input.variants.iter().skip(1).all(|variant| {
                variant
                    .fields
                    .iter()
                    .find(|field| field.field == candidate.field)
                    == Some(*candidate)
            })
        })
        .collect()
}

fn render_cli_input_field(
    output: &mut String,
    description: &BuiltinToolDescription,
    field: &CliInputField,
) {
    use std::fmt::Write as _;

    let placeholder = if let Some(constant) = &field.constant {
        format!(" <{}>", compact_cli_value(constant))
    } else if !field.allowed_values.is_empty() {
        format!(" <{}>", pipe_separated_values(&field.allowed_values))
    } else if field.value_kind == "boolean" {
        String::new()
    } else {
        format!(" <{}>", field.value_kind)
    };
    writeln!(output, "    {}{}", field.flag, placeholder)
        .expect("writing help to a String cannot fail");
    writeln!(output, "        JSON field: {}", field.field)
        .expect("writing help to a String cannot fail");
    if let Some(constant) = &field.constant {
        writeln!(output, "        Constant: {}", compact_cli_value(constant))
            .expect("writing help to a String cannot fail");
    }
    if !field.allowed_values.is_empty() {
        writeln!(
            output,
            "        Allowed values: {}",
            field
                .allowed_values
                .iter()
                .map(compact_cli_value)
                .collect::<Vec<_>>()
                .join(", ")
        )
        .expect("writing help to a String cannot fail");
    }
    if let Some(minimum) = field.minimum {
        writeln!(output, "        Minimum: {minimum}")
            .expect("writing help to a String cannot fail");
    }
    if let Some(maximum) = field.maximum {
        writeln!(output, "        Maximum: {maximum}")
            .expect("writing help to a String cannot fail");
    }
    if let Some(minimum) = field.min_length {
        writeln!(output, "        Minimum length: {minimum}")
            .expect("writing help to a String cannot fail");
    }
    if let Some(maximum) = field.max_length {
        writeln!(output, "        Maximum length: {maximum}")
            .expect("writing help to a String cannot fail");
    }
    if let Some(minimum) = field.min_items {
        writeln!(output, "        Minimum items: {minimum}")
            .expect("writing help to a String cannot fail");
    }
    if let Some(maximum) = field.max_items {
        writeln!(output, "        Maximum items: {maximum}")
            .expect("writing help to a String cannot fail");
    }
    if field.repeatable {
        writeln!(output, "        Repeat the flag for multiple values.")
            .expect("writing help to a String cannot fail");
    }
    if matches!(description.name.as_str(), "camp.search" | "camp.read") && field.field == "campId" {
        writeln!(
            output,
            "        Omit for the current Camp; pass an authorized frozen historical Camp ID to target that Camp only."
        )
        .expect("writing help to a String cannot fail");
    }
    if description.name == "camp.read" && field.field == "cursor" {
        writeln!(
            output,
            "        Pass the nextCursor returned by the previous page."
        )
        .expect("writing help to a String cannot fail");
    }
    if description.name == "memory.view" && field.field == "scope" {
        writeln!(output, "        One of: hearth, companion, relationship.")
            .expect("writing help to a String cannot fail");
    }
    if description.name == "memory.view" && field.field == "counterpartyAgentId" {
        writeln!(
            output,
            "        Required only when --scope relationship selects an exact pair."
        )
        .expect("writing help to a String cannot fail");
    }
}

fn capitalize_cli_label(value: &str) -> String {
    let mut characters = value.chars();
    characters.next().map_or_else(String::new, |first| {
        format!("{}{}", first.to_uppercase(), characters.as_str())
    })
}

fn operation_help_examples_for_variant(
    operation: &str,
    discriminator_value: &str,
) -> &'static [&'static str] {
    match (operation, discriminator_value) {
        ("camp.read", "item") => &[
            "rovai camp read --mode item --message-id '<message-id>'",
            "rovai camp read --camp-id '<camp-id>' --mode item --message-id '<message-id>' --body-offset 0 --body-limit 4000",
        ],
        ("camp.read", "around") => &[
            "rovai camp read --mode around --message-id '<message-id>' --before 5 --after 5",
            "rovai camp read --before 5 --message-id '<message-id>' --mode around",
        ],
        ("camp.read", "thread") => &[
            "rovai camp read --mode thread --message-id '<message-id>' --direction before --limit 20",
            "rovai camp read --camp-id '<camp-id>' --mode thread --message-id '<message-id>' --direction after --cursor 123 --limit 20",
        ],
        ("camp.read", "timeline") => &[
            "rovai camp read",
            "rovai camp read --camp-id '<camp-id>'",
            "rovai camp read --limit 5",
            "rovai camp read --direction after --limit 20",
            "rovai camp read --cursor 123",
        ],
        ("memory.view", "hearth") => &["rovai memory view --scope hearth"],
        ("memory.view", "companion") => &["rovai memory view --scope companion"],
        ("memory.view", "relationship") => {
            &["rovai memory view --scope relationship --counterparty-agent-id agent_3"]
        }
        _ => &[],
    }
}

fn write_indented_help(output: &mut String, help: &str) {
    use std::fmt::Write as _;

    for line in help.lines() {
        if line.is_empty() {
            writeln!(output).expect("writing help to a String cannot fail");
        } else {
            writeln!(output, "      {line}").expect("writing help to a String cannot fail");
        }
    }
}

fn operation_help_examples(operation: &str) -> &'static [&'static str] {
    match operation {
        "camp.message.send" => &CAMP_MESSAGE_SEND_HELP_EXAMPLES,
        "team.gather" => &[
            "rovai gather --to agent_2 --to agent_3 --body '请分别分析并公开回复'",
            "rovai gather --input-file gather.json",
        ],
        "member.create" => &[
            "rovai member create --creation-key 2b945f3f-4b45-4ae5-92b2-739fce600338 --display-name 'Nova' --team-role 'Researcher'",
            "rovai member create --input-file confirmed-member.json",
        ],
        "team.create_task" => {
            &["rovai task create --title 'Prepare release notes' --assignee-agent-id agent_27"]
        }
        "team.get_task" => &["rovai task get --task-id task_123"],
        "team.list_tasks" => &["rovai task list --limit 10"],
        "team.update_task" => {
            &["rovai task update --task-id task_123 --expected-version 1 --status in_progress"]
        }
        "camp.list" => &["rovai camp list --limit 10"],
        "camp.search" => &[
            "rovai camp search --query 'amount'",
            "rovai camp search --camp-id '<camp-id>' --query 'amount'",
        ],
        "camp.read" => &[
            "rovai camp read",
            "rovai camp read --camp-id '<camp-id>'",
            "rovai camp read --limit 5",
            "rovai camp read --direction after --limit 20",
            "rovai camp read --mode item --message-id '<message-id>'",
            "rovai camp read --mode around --message-id '<message-id>' --before 5 --after 5",
            "rovai camp read --mode thread --message-id '<message-id>' --direction after --limit 20",
        ],
        "history.search" => &["rovai history search --query 'amount'"],
        "memory.view" => &[
            "rovai memory view --scope companion",
            "rovai memory view --scope relationship --counterparty-agent-id agent_3",
        ],
        "memory.search" => &["rovai memory search --query 'preferences' --limit 6"],
        "memory.read" => &["rovai memory read --memory-ids memory_123"],
        "memory.write" => &["rovai memory write --input-file memory-write.json"],
        _ => &["rovai --help"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rovai_core::builtin_tool_transport::{BuiltinToolAuth, builtin_tool_description};
    #[cfg(windows)]
    use rovai_core::platform::local_ipc::LocalIpcListener;

    fn request_for_ipc_test() -> BuiltinToolIpcRequest {
        BuiltinToolIpcRequest {
            ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
            auth: BuiltinToolAuth {
                process_id: "process-test".to_string(),
                process_token: "process-token".to_string(),
                lease_id: "lease-test".to_string(),
                lease_generation: 1,
                lease_token: "lease-token".to_string(),
            },
            body: BuiltinToolIpcRequestBody::Invoke {
                request_id: Uuid::new_v4().to_string(),
                operation: "camp.list".to_string(),
                input: json!({}),
            },
        }
    }

    #[tokio::test]
    async fn ipc_response_reader_requires_one_bounded_newline_delimited_utf8_frame() {
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(b"{\"ok\":true}\n"))
                .await
                .unwrap(),
            r#"{"ok":true}"#
        );
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(b"{}"))
                .await
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
        let oversized = vec![b'x'; BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 2];
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(oversized))
                .await
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn managed_runtime_cli_surface_does_not_advertise_or_admit_user_automation() {
        assert!(!root_help_text(true).contains("rovai app"));
        assert!(root_help_text(false).contains("rovai app --help"));
        assert!(!user_automation_available_in_process(
            Some("context"),
            Some("run-tmp")
        ));
        assert!(user_automation_available_in_process(None, None));
    }

    #[test]
    fn direct_flags_use_canonical_fields_and_repeated_arrays() {
        let description = builtin_tool_description("memory.read").unwrap();
        let mut direct = Map::new();
        let argument = description
            .arguments
            .iter()
            .find(|argument| argument.flag == "--memory-ids")
            .unwrap();
        insert_direct_value(&mut direct, argument, Value::String("m1".to_string())).unwrap();
        insert_direct_value(&mut direct, argument, Value::String("m2".to_string())).unwrap();
        assert_eq!(direct["memoryIds"], json!(["m1", "m2"]));
    }

    #[test]
    fn memory_view_direct_flags_form_the_exact_relationship_input() {
        let description = builtin_tool_description("memory.view").unwrap();
        let input = parse_operation_input(
            &description,
            &[
                "--scope".to_string(),
                "relationship".to_string(),
                "--counterparty-agent-id".to_string(),
                "agent_3".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(
            input,
            json!({
                "scope": "relationship",
                "counterpartyAgentId": "agent_3"
            })
        );
    }

    #[test]
    fn direct_flags_and_input_file_are_mutually_exclusive() {
        let description = builtin_tool_description("team.create_task").unwrap();
        assert!(
            parse_operation_input(
                &description,
                &[
                    "--title".to_string(),
                    "task".to_string(),
                    "--input-file".to_string(),
                    "request.json".to_string(),
                ]
            )
            .is_err()
        );
    }

    #[test]
    fn cli_commands_map_to_canonical_operations() {
        assert_eq!(
            builtin_tool_identity_by_command("send", "")
                .unwrap()
                .operation,
            "camp.message.send"
        );
        assert_eq!(
            builtin_tool_identity_by_command("gather", "")
                .unwrap()
                .operation,
            "team.gather"
        );
        assert!(builtin_tool_identity_by_command("memory", "propose-hearth").is_none());
        assert!(
            invocation_identity(&["memory".to_string(), "propose-hearth".to_string()]).is_none()
        );
        assert!(builtin_tool_identity_by_command("tool", "list").is_none());
        assert!(builtin_tool_identity_by_command("tool", "describe").is_none());
        for family in ["member", "task", "camp", "history", "memory"] {
            let args = [family.to_string(), "--help".to_string()];
            assert!(operation_help(&args).unwrap().is_none());
            assert!(is_family_help(&args));
        }
    }

    #[test]
    fn exact_help_surface_covers_all_fifteen_operations_and_no_family_aliases() {
        let exact_paths: &[&[&str]] = &[
            &["send", "--help"],
            &["gather", "--help"],
            &["member", "create", "--help"],
            &["task", "create", "--help"],
            &["task", "get", "--help"],
            &["task", "list", "--help"],
            &["task", "update", "--help"],
            &["camp", "list", "--help"],
            &["camp", "search", "--help"],
            &["camp", "read", "--help"],
            &["history", "search", "--help"],
            &["memory", "view", "--help"],
            &["memory", "search", "--help"],
            &["memory", "read", "--help"],
            &["memory", "write", "--help"],
        ];
        assert_eq!(exact_paths.len(), 15);
        for path in exact_paths {
            let args = path
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>();
            assert!(
                operation_help(&args).unwrap().is_some(),
                "missing exact help for {path:?}"
            );
        }
        for family in ["member", "task", "camp", "history", "memory"] {
            let args = vec![family.to_string(), "--help".to_string()];
            assert!(operation_help(&args).unwrap().is_none());
            assert!(is_family_help(&args));
        }
        let view = builtin_tool_description("memory.view").unwrap();
        let help = operation_help_text(&view);
        assert!(help.contains("One of: hearth, companion, relationship."));
        assert!(help.contains("Required only when --scope relationship"));
        let gather = builtin_tool_description("team.gather").unwrap();
        let gather_help = operation_help_text(&gather);
        assert!(gather_help.contains("only the last accepted return"));
        assert!(gather_help.contains("limited to 16 per Item/retry generation"));
    }

    #[test]
    fn camp_help_teaches_default_and_explicit_single_camp_targets() {
        let search = builtin_tool_description("camp.search").unwrap();
        let search_help = operation_help_text(&search);
        assert!(search_help.contains("Omit for the current Camp"));
        assert!(search_help.contains("authorized frozen historical Camp ID"));
        assert!(
            search
                .arguments
                .iter()
                .find(|argument| argument.field == "campId")
                .is_some_and(|argument| !argument.required)
        );
        assert_eq!(
            parse_operation_input(&search, &["--query".to_string(), "amount".to_string()]).unwrap(),
            json!({"query": "amount"})
        );
        assert_eq!(
            operation_help_examples("camp.search"),
            [
                "rovai camp search --query 'amount'",
                "rovai camp search --camp-id '<camp-id>' --query 'amount'",
            ]
        );

        let read = builtin_tool_description("camp.read").unwrap();
        let read_help = operation_help_text(&read);
        assert!(read_help.contains("Default behavior:"));
        assert!(read_help.contains("--mode timeline --direction before --limit 20"));
        assert!(read_help.contains("newest 20 visible messages"));
        assert!(read_help.contains("Omit for the current Camp"));
        assert_eq!(read_help.matches("--camp-id <string>").count(), 1);
        assert_eq!(
            read_help
                .matches("--mode <item|around|thread|timeline>")
                .count(),
            1
        );
        assert!(read_help.contains("Default: timeline."));
        let item_index = read_help.find("Mode item:").unwrap();
        let around_index = read_help.find("Mode around:").unwrap();
        let thread_index = read_help.find("Mode thread:").unwrap();
        let timeline_index = read_help.find("Mode timeline:").unwrap();
        assert!(
            item_index < around_index
                && around_index < thread_index
                && thread_index < timeline_index
        );
        assert!(read_help.contains("--direction <before|after>"));
        assert!(read_help.contains("Allowed values: before, after"));
        assert!(read_help.contains("--cursor <integer>"));
        assert!(read_help.contains("Minimum: 1"));
        assert!(read_help.contains("Maximum: 20"));
        assert!(read_help[timeline_index..].contains("Default: before."));
        assert!(read_help[thread_index..timeline_index].contains("Default: 20."));
        assert!(read_help.contains("Do not use older, newer, backward, or forward"));
        assert!(read_help.contains("Reuse nextCursor with the same mode and direction"));
        assert!(read_help[item_index..around_index].contains("--body-offset <integer>"));
        assert!(read_help[around_index..thread_index].contains("--before <integer>"));
        assert!(!read_help[timeline_index..].contains("--before <integer>"));
        assert_eq!(
            parse_and_validate_operation_input(
                &read,
                &[
                    "--mode".to_string(),
                    "item".to_string(),
                    "--message-id".to_string(),
                    "msg_123".to_string(),
                ],
            )
            .unwrap(),
            json!({"mode": "item", "messageId": "msg_123"})
        );
        assert_eq!(
            parse_and_validate_operation_input(
                &read,
                &[
                    "--before".to_string(),
                    "5".to_string(),
                    "--message-id".to_string(),
                    "msg_123".to_string(),
                    "--mode".to_string(),
                    "around".to_string(),
                ],
            )
            .unwrap(),
            json!({"mode": "around", "messageId": "msg_123", "before": 5})
        );
        assert_eq!(
            operation_help_examples("camp.read"),
            [
                "rovai camp read",
                "rovai camp read --camp-id '<camp-id>'",
                "rovai camp read --limit 5",
                "rovai camp read --direction after --limit 20",
                "rovai camp read --mode item --message-id '<message-id>'",
                "rovai camp read --mode around --message-id '<message-id>' --before 5 --after 5",
                "rovai camp read --mode thread --message-id '<message-id>' --direction after --limit 20",
            ]
        );
        assert_eq!(
            apply_operation_defaults("camp.read", json!({})).unwrap(),
            (
                json!({"mode": "timeline", "direction": "before", "limit": 20}),
                CliAppliedDefaults {
                    mode: true,
                    direction: true,
                    limit: true,
                },
            )
        );
        assert_eq!(
            parse_and_validate_operation_input(
                &read,
                &[
                    "--camp-id".to_string(),
                    "rvcamp_01h47kvsy5fk1shh6w1g60eecf".to_string(),
                ],
            )
            .unwrap(),
            json!({
                "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
                "mode": "timeline",
                "direction": "before",
                "limit": 20
            })
        );
        assert_eq!(
            parse_and_validate_operation_input(&read, &["--limit".to_string(), "5".to_string()],)
                .unwrap(),
            json!({"mode": "timeline", "direction": "before", "limit": 5})
        );
        assert_eq!(
            parse_and_validate_operation_input(
                &read,
                &["--direction".to_string(), "after".to_string()],
            )
            .unwrap(),
            json!({"mode": "timeline", "direction": "after", "limit": 20})
        );
        assert_eq!(
            parse_and_validate_operation_input(
                &read,
                &["--mode".to_string(), "timeline".to_string()],
            )
            .unwrap(),
            json!({"mode": "timeline", "direction": "before", "limit": 20})
        );
        let default_mode_conflict = parse_and_validate_operation_input(
            &read,
            &["--message-id".to_string(), "msg_123".to_string()],
        )
        .unwrap_err();
        assert_eq!(
            default_mode_conflict.message,
            "--mode defaults to timeline, which does not accept --message-id.\nUse an explicit message-anchored mode:\n  rovai camp read --mode item --message-id '<message-id>'\n  rovai camp read --mode around --message-id '<message-id>' --before 5 --after 5\n  rovai camp read --mode thread --message-id '<message-id>' --direction <before|after>"
        );
        assert_eq!(
            default_mode_conflict.details.unwrap()["issues"][0],
            json!({
                "field": "messageId",
                "flag": "--message-id",
                "reason": "not_allowed_for_mode",
                "validModes": ["item", "around", "thread"]
            })
        );
        let unknown_mode = parse_and_validate_operation_input(
            &read,
            &["--mode".to_string(), "archive".to_string()],
        )
        .unwrap_err();
        assert_eq!(
            unknown_mode.details.unwrap()["issues"][0]["reason"],
            "unknown_mode"
        );
        for direction in ["backward", "older", "newer", "forward"] {
            let failure = parse_and_validate_operation_input(
                &read,
                &[
                    "--mode".to_string(),
                    "timeline".to_string(),
                    "--direction".to_string(),
                    direction.to_string(),
                ],
            )
            .unwrap_err();
            assert_eq!(
                failure.details.unwrap()["issues"][0],
                json!({
                    "field": "direction",
                    "flag": "--direction",
                    "reason": "invalid_enum",
                    "allowedValues": ["before", "after"]
                })
            );
        }
        let missing_thread_direction = parse_and_validate_operation_input(
            &read,
            &[
                "--mode".to_string(),
                "thread".to_string(),
                "--message-id".to_string(),
                "msg_123".to_string(),
            ],
        )
        .unwrap_err();
        assert_eq!(
            missing_thread_direction.message,
            "camp.read thread requires --direction <before|after>."
        );
        assert_eq!(
            missing_thread_direction.details.as_ref().unwrap(),
            &json!({
                "operation": "camp.read",
                "mode": "thread",
                "issues": [{
                    "field": "direction",
                    "flag": "--direction",
                    "reason": "missing_required",
                    "allowedValues": ["before", "after"]
                }]
            })
        );
        let wrong_mode_field = parse_and_validate_operation_input(
            &read,
            &[
                "--mode".to_string(),
                "timeline".to_string(),
                "--before".to_string(),
                "5".to_string(),
            ],
        )
        .unwrap_err();
        assert_eq!(
            wrong_mode_field.message,
            "camp.read timeline --before is valid only in around mode."
        );
        assert_eq!(
            wrong_mode_field.details.as_ref().unwrap()["issues"],
            json!([{
                "field": "before",
                "flag": "--before",
                "reason": "not_allowed_for_mode",
                "validModes": ["around"]
            }])
        );
        let cursor_zero = parse_and_validate_operation_input(
            &read,
            &[
                "--mode".to_string(),
                "timeline".to_string(),
                "--direction".to_string(),
                "before".to_string(),
                "--cursor".to_string(),
                "0".to_string(),
            ],
        )
        .unwrap_err();
        assert_eq!(
            cursor_zero.details.unwrap()["issues"][0]["reason"],
            "below_minimum"
        );
        assert_eq!(
            cursor_zero.message,
            "camp.read timeline requires --cursor to be at least 1."
        );

        let input_file =
            env::temp_dir().join(format!("rovai-camp-read-input-{}.json", Uuid::new_v4()));
        fs::write(&input_file, r#"{"mode":"timeline"}"#).unwrap();
        let input_file_value = parse_and_validate_operation_input(
            &read,
            &[
                "--input-file".to_string(),
                input_file.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        fs::remove_file(input_file).unwrap();
        assert_eq!(
            input_file_value,
            json!({"mode": "timeline", "direction": "before", "limit": 20})
        );
        let stdin_value = parse_json_object(br#"{"direction":"after"}"#, "stdin").unwrap();
        assert_eq!(
            apply_operation_defaults("camp.read", stdin_value)
                .unwrap()
                .0,
            json!({"mode": "timeline", "direction": "after", "limit": 20})
        );
        assert_eq!(
            operation_help_examples("history.search"),
            ["rovai history search --query 'amount'"]
        );
    }

    #[test]
    fn output_contract_mismatch_keeps_full_error_in_a_private_local_diagnostic() {
        let directory = env::temp_dir().join(format!(
            "rovai-output-contract-mismatch-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir(&directory).unwrap();
        let source_error =
            anyhow::anyhow!("camp.read attachments[0] is missing required property fileCount");
        let path =
            write_output_contract_mismatch_diagnostic(&directory, "camp.read", &source_error)
                .unwrap();
        let diagnostic: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(diagnostic["code"], "builtin_tool.output_contract_mismatch");
        assert_eq!(diagnostic["operation"], "camp.read");
        assert!(
            diagnostic["diagnostic"]
                .as_str()
                .unwrap()
                .contains("attachments[0]")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn public_send_help_has_no_agent_supplied_camp_scope() {
        let description = operation_help(&["send".to_string(), "--help".to_string()])
            .unwrap()
            .unwrap();
        assert!(description.arguments.iter().all(|argument| {
            argument.field != "campId"
                && argument.flag != "--camp-id"
                && argument.field != "replyToCampMessageId"
                && argument.flag != "--reply-to-camp-message-id"
        }));
        assert!(
            parse_operation_input(
                &description,
                &["--camp-id".to_string(), "camp-legacy".to_string()]
            )
            .is_err()
        );
        assert!(
            parse_operation_input(
                &description,
                &[
                    "--reply-to-camp-message-id".to_string(),
                    "message-legacy".to_string(),
                ]
            )
            .is_err()
        );
        assert!(
            description
                .summary
                .contains("restricted inline Agent addressing")
        );
        assert!(description.summary.contains("agentAddressingMode"));
        assert!(description.summary.contains("effectiveRecipients"));
        assert!(description.summary.contains("deliveryIds"));
        assert!(description.summary.contains("public-only"));
        assert!(description.summary.contains("--to-principal"));
        assert!(!description.summary.contains("--to-user"));
        let body = description
            .arguments
            .iter()
            .find(|argument| argument.field == "body")
            .unwrap();
        assert!(!body.required);
        let to = description
            .arguments
            .iter()
            .find(|argument| argument.field == "to")
            .unwrap();
        assert_eq!(to.flag, "--to");
        assert!(to.repeatable);
        let public_only = description
            .arguments
            .iter()
            .find(|argument| argument.field == "publicOnly")
            .unwrap();
        assert_eq!(public_only.flag, "--public-only");
        assert_eq!(public_only.value_kind, "boolean");
        assert!(!public_only.repeatable);
        assert!(!public_only.required);
        let to_principal = description
            .arguments
            .iter()
            .find(|argument| argument.field == "mentionUser")
            .unwrap();
        assert_eq!(to_principal.flag, "--to-principal");
        assert_eq!(to_principal.value_kind, "boolean");
        assert!(!to_principal.repeatable);
        assert!(!to_principal.required);
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--to-principal".to_string(),
                    "--body".to_string(),
                    "Choose A or B".to_string(),
                ]
            )
            .unwrap(),
            json!({"body": "Choose A or B", "mentionUser": true})
        );
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--to-user".to_string(),
                    "--body".to_string(),
                    "Legacy spelling".to_string(),
                ]
            )
            .unwrap(),
            json!({"body": "Legacy spelling", "mentionUser": true})
        );
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--file".to_string(),
                    "$ROVAI_RUN_TMP/report.pdf".to_string(),
                ]
            )
            .unwrap(),
            json!({"files": ["$ROVAI_RUN_TMP/report.pdf"]})
        );
        let input_file =
            std::env::temp_dir().join(format!("rovai-send-v4-input-{}.json", Uuid::new_v4()));
        std::fs::write(
            &input_file,
            r#"{"body":"Choose A or B","mentionUser":true}"#,
        )
        .unwrap();
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--input-file".to_string(),
                    input_file.to_string_lossy().into_owned(),
                ],
            )
            .unwrap(),
            json!({"body": "Choose A or B", "mentionUser": true})
        );
        std::fs::remove_file(input_file).unwrap();
        assert!(parse_operation_input(&description, &["--mention-user".to_string()]).is_err());
        assert_eq!(
            operation_help_examples("camp.message.send"),
            [
                "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'",
                "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
                "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'",
                "rovai send --file \"$ROVAI_RUN_TMP/report.pdf\"",
            ]
        );
        let help = operation_help_text(&description);
        assert!(
            help.contains("Ordinary public Camp messages are already visible to the Principal.")
        );
        assert!(help.contains("new unresolved decision, answer, or action for the Principal"));
        assert!(help.contains("Principal attention is message-local"));
        assert!(help.contains("does not represent approval"));
        assert!(help.contains("Agent addressing schedules concrete continuing work, not CC."));
        assert!(help.contains("This option is invalid with --public-only."));
        assert!(help.contains("Restricted inline Agent addressing is disabled"));
        assert!(help.contains("--body may be omitted for an attachment-only message"));
        assert!(help.contains("It may be combined with --to-principal."));
        assert!(!help.contains("--to-user"));
        assert!(!help.contains("--to agent_5 --public-only"));
    }

    #[test]
    fn task_create_help_is_lead_facing_and_requires_an_explicit_owner() {
        let description = operation_help(&[
            "task".to_string(),
            "create".to_string(),
            "--help".to_string(),
        ])
        .unwrap()
        .unwrap();
        assert!(description.summary.contains("current Default Lead"));
        assert!(
            description
                .summary
                .contains("Prefer advancing an existing Task")
        );
        assert!(description.summary.contains("one-off review"));
        let assignee = description
            .arguments
            .iter()
            .find(|argument| argument.field == "assigneeAgentId")
            .unwrap();
        assert!(assignee.required);
        assert_eq!(assignee.flag, "--assignee-agent-id");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn connection_preflight_failure_is_predictable() {
        let socket = std::path::PathBuf::from("/tmp").join(format!(
            "rv-missing-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket.to_string_lossy().into_owned(),
        };
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn response_loss_after_dispatch_is_indeterminate() {
        use std::os::unix::net::UnixListener;

        let socket = std::path::PathBuf::from("/tmp")
            .join(format!("rv-loss-{}.sock", &Uuid::new_v4().to_string()[..8]));
        let listener = UnixListener::bind(&socket).unwrap();
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket.to_string_lossy().into_owned(),
        };
        let server = std::thread::spawn(move || {
            for _ in 0..CORE_ATTEMPTS {
                let (stream, _) = listener.accept().unwrap();
                drop(stream);
            }
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::OutcomeIndeterminate
        );
        server.join().unwrap();
        std::fs::remove_file(socket).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_core_response_is_a_predictable_protocol_failure() {
        use std::os::unix::net::UnixListener;

        let socket = std::path::PathBuf::from("/tmp").join(format!(
            "rv-protocol-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        let listener = UnixListener::bind(&socket).unwrap();
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket.to_string_lossy().into_owned(),
        };
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut byte = [0_u8; 1];
            loop {
                stream.read_exact(&mut byte).unwrap();
                if byte[0] == b'\n' {
                    break;
                }
            }
            stream.write_all(b"not-json\n").unwrap();
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
        server.join().unwrap();
        std::fs::remove_file(socket).unwrap();
    }

    #[cfg(windows)]
    fn windows_test_endpoint() -> LocalIpcEndpoint {
        LocalIpcEndpoint::WindowsNamedPipe {
            name: format!(
                r"\\.\pipe\rovai-ai-cli-test-{}-{}",
                std::process::id(),
                Uuid::new_v4()
            ),
        }
    }

    #[cfg(windows)]
    async fn respond_to_one_windows_request(
        stream: rovai_core::platform::local_ipc::LocalIpcStream,
        response: &[u8],
    ) {
        let (reader, mut writer) = tokio::io::split(stream);
        let mut reader = BufReader::new(reader);
        let mut request = Vec::new();
        reader.read_until(b'\n', &mut request).await.unwrap();
        assert_eq!(request.last(), Some(&b'\n'));
        writer.write_all(response).await.unwrap();
        writer.write_all(b"\n").await.unwrap();
        writer.shutdown().await.unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_named_pipe_connection_preflight_failure_is_predictable() {
        let endpoint = windows_test_endpoint();
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_named_pipe_response_loss_after_dispatch_is_indeterminate() {
        let endpoint = windows_test_endpoint();
        let mut listener = LocalIpcListener::bind(&endpoint).unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..CORE_ATTEMPTS {
                let stream = listener.accept().await.unwrap();
                drop(stream);
            }
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::OutcomeIndeterminate
        );
        server.await.unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_named_pipe_malformed_response_is_predictable() {
        let endpoint = windows_test_endpoint();
        let mut listener = LocalIpcListener::bind(&endpoint).unwrap();
        let server = tokio::spawn(async move {
            let stream = listener.accept().await.unwrap();
            respond_to_one_windows_request(stream, b"not-json").await;
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
        server.await.unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_named_pipe_busy_instance_is_retried() {
        let endpoint = windows_test_endpoint();
        let mut listener = LocalIpcListener::bind(&endpoint).unwrap();
        let blocker = LocalIpcClientStream::connect(&endpoint).await.unwrap();
        let expected = BuiltinToolIpcResponse::ipc_error("test.response", "retry completed");
        let serialized = serde_json::to_vec(&expected).unwrap();
        let server = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(75)).await;
            let blocked_stream = listener.accept().await.unwrap();
            drop(blocked_stream);
            drop(blocker);
            let stream = listener.accept().await.unwrap();
            respond_to_one_windows_request(stream, &serialized).await;
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test())
                .await
                .unwrap(),
            expected
        );
        server.await.unwrap();
    }

    #[test]
    fn authoritative_indeterminate_envelope_uses_exit_three() {
        let envelope = rovai_core::builtin_tool_transport::BuiltinToolInvocationEnvelope::rejected(
            "camp.message.send",
            &Uuid::new_v4().to_string(),
            rovai_core::builtin_tool_transport::BuiltinToolError {
                code: "builtin_tool.outcome_indeterminate".to_string(),
                message: "The operation may already have committed. Confirm the exact current state before proceeding; do not blindly repeat the mutation. If confirmation is unavailable, report the uncertainty.".to_string(),
                recovery: rovai_core::builtin_tool_transport::BuiltinToolRecovery::ConfirmOutcome,
                details: None,
            },
        )
        .unwrap();
        assert_eq!(envelope_exit_code(&envelope), 3);
    }

    #[test]
    fn compaction_hook_stages_only_lifecycle_metadata_for_uncertain_recovery() {
        let root = std::env::temp_dir().join(format!("rovai-hook-outbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let context_path = root.join("context.json");
        let request_id = Uuid::new_v4().to_string();
        let record = CompactionObservationOutboxRecord {
            schema_version: COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION,
            request_id: request_id.clone(),
            adapter_kind: "copilot-cli".to_string(),
            host_instance_id: "host-1".to_string(),
            relay_process_id: "process-1".to_string(),
            native_session_id: "session-1".to_string(),
            hook_event_name: "preCompact".to_string(),
            trigger: "manual".to_string(),
            source_event_digest: "digest-1".to_string(),
            observed_at: "2026-08-08T00:00:00Z".to_string(),
        };
        let staged = stage_compaction_observation(&context_path, &record).unwrap();
        assert_eq!(
            staged.file_name().unwrap().to_str().unwrap(),
            format!("{request_id}.json")
        );
        let recovered: CompactionObservationOutboxRecord =
            serde_json::from_slice(&std::fs::read(&staged).unwrap()).unwrap();
        assert_eq!(recovered, record);
        let serialized = std::fs::read_to_string(staged).unwrap();
        assert!(!serialized.contains("summary"));
        assert!(!serialized.contains("processToken"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
