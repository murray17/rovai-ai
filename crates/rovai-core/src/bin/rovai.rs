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
    BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION, BuiltinToolArgument,
    BuiltinToolCliContext, BuiltinToolCliIdentity, BuiltinToolDescription, BuiltinToolIpcRequest,
    BuiltinToolIpcRequestBody, BuiltinToolIpcResponse, COMPACTION_HOOK_IPC_PROTOCOL_VERSION,
    COMPACTION_OBSERVATION_IPC_KIND, COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION,
    CompactionHookIpcRequest, CompactionHookIpcResponse, CompactionObservationOutboxRecord,
    LocalIpcEndpoint, ROVAI_CLI_CONTEXT_ENV, ROVAI_RUN_TMP_ENV, builtin_tool_description,
    builtin_tool_identity_by_command,
};
use rovai_core::camp_message_send_teaching::{
    CAMP_MESSAGE_SEND_BODY_HELP, CAMP_MESSAGE_SEND_FILE_HELP, CAMP_MESSAGE_SEND_HELP_EXAMPLES,
    CAMP_MESSAGE_SEND_INPUT_HELP, CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP, CAMP_MESSAGE_SEND_TO_HELP,
    CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP,
};
use rovai_core::command::canonical_json_digest;
use rovai_core::platform::local_ipc::LocalIpcClientStream;
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use uuid::Uuid;

#[path = "rovai/app_cli.rs"]
mod app_cli;

const CORE_TIMEOUT: Duration = Duration::from_secs(30);
const CORE_ATTEMPTS: usize = 3;
const COMPACTION_HOOK_TIMEOUT: Duration = Duration::from_millis(500);
const COMPACTION_HOOK_ATTEMPTS: usize = 3;

fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args
        .first()
        .is_some_and(|arg| arg == "--prepare-windows-bootstrap-root")
    {
        // A Desktop bootstrap operation, not an Agent-facing command. It must
        // remain independent of Core startup, SQLite and the async IPC runtime.
        if !user_automation_available_in_current_process() {
            print_safe_cli_error();
            return ExitCode::from(2);
        }
        let result = (|| -> Result<()> {
            let [_, key] = args.as_slice() else {
                bail!("bootstrap preparation requires exactly one instance key");
            };
            let layout = rovai_core::platform::prepare_windows_bootstrap_root(key)?;
            println!("{}", serde_json::to_string(&layout)?);
            Ok(())
        })();
        return match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("{error:#}");
                ExitCode::from(1)
            }
        };
    }
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
    if args.as_slice() == ["task", "--help"] {
        print!("{}", task_family_help_text());
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
        [command, rest @ ..] if command == "send" => {
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
    let request_id = if operation == "member.update" {
        input["requestId"]
            .as_str()
            .context("member.update requestId is missing")?
            .to_string()
    } else {
        Uuid::new_v4().to_string()
    };
    let request = BuiltinToolIpcRequest {
        ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
        auth,
        body: BuiltinToolIpcRequestBody::Invoke {
            request_id,
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
        Err(BuiltinToolIpcFailure::BeforeDispatch | BuiltinToolIpcFailure::Predictable) => {
            print_safe_cli_error();
            return Ok(2);
        }
    };

    match response {
        BuiltinToolIpcResponse::Envelope { envelope } => {
            let exit_code = envelope_exit_code(&envelope);
            let operation = envelope.operation.clone();
            let projected = match project_envelope(envelope) {
                Ok(projected) => projected,
                Err(error) => {
                    record_output_contract_mismatch(&operation, &error);
                    println!(
                        "{}",
                        serde_json::to_string(&output_contract_mismatch_agent_error(&operation))?
                    );
                    return Ok(2);
                }
            };
            println!("{}", serde_json::to_string(&projected)?);
            Ok(exit_code)
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
    let display_auth = context.auth().ok();
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
    // The explicit compact_summary field may travel only on this live local IPC
    // request so the execution console can reuse its Managed Blob result path.
    // It never participates in the observation digest or recovery outbox.
    let summary_text = hook_input
        .get("compact_summary")
        .or_else(|| hook_input.get("compactSummary"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
        .map(str::to_string);
    // Runtime occurrence metadata remains sufficient for durable Bootstrap
    // redelivery idempotence; transcript and other context-bearing fields stay
    // out of that lifecycle completely.
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
        kind: COMPACTION_OBSERVATION_IPC_KIND.to_string(),
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
        display_auth,
        summary_text,
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
        [command, ..] if command == "send" => builtin_tool_identity_by_command(command, ""),
        [group, action, ..] => builtin_tool_identity_by_command(group, action),
        _ => None,
    }
}

fn is_family_help(args: &[String]) -> bool {
    matches!(args, [family, help] if help == "--help" && matches!(family.as_str(), "member" | "thread" | "camp" | "history" | "memory" | "single-chat" | "automation" | "mission"))
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

impl CliInputFailure {
    fn generic() -> Self {
        Self {
            message: "Command input does not match the accepted arguments.".to_string(),
            details: None,
        }
    }

    fn send_request_file_conflict() -> Self {
        Self {
            message: "The input file matches a complete Send request and cannot be combined with command-line send options.".to_string(),
            details: None,
        }
    }
}

impl std::fmt::Display for CliInputFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CliInputFailure {}

fn parse_and_validate_operation_input(
    description: &BuiltinToolDescription,
    args: &[String],
) -> std::result::Result<Value, CliInputFailure> {
    let input = parse_operation_input(description, args).map_err(|error| {
        // Only deliberately constructed safe diagnostics may reach the Agent.
        error
            .downcast::<CliInputFailure>()
            .unwrap_or_else(|_| CliInputFailure::generic())
    })?;
    let input = rovai_core::thread_compat::normalize_builtin_input(&description.name, input)
        .map_err(|_| CliInputFailure::generic())?;
    if validate_schema(&input, &description.input_schema).is_err() {
        return Err(explain_input_validation_failure(description, &input));
    }
    Ok(input)
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
    let message = format_cli_input_issue_message(&description.name, mode.as_deref(), &issues);
    CliInputFailure {
        message,
        details: Some(Value::Object(details)),
    }
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
    let mut used_flags = BTreeMap::new();
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
        let canonical_flag = rovai_core::thread_compat::canonical_flag(&description.name, flag);
        if let Some(previous) = used_flags.insert(canonical_flag.to_string(), flag.to_string())
            && previous != flag
        {
            bail!("{previous} and {flag} cannot be supplied together");
        }
        let argument = argument_by_flag
            .get(canonical_flag)
            .with_context(|| format!("unknown argument for {}: {flag}", description.name))?;
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

    if let Some(path) = input_file {
        if description.name == "thread.message.send" {
            if direct.contains_key("body") {
                bail!("--body and --input-file cannot be supplied together");
            }
            return parse_send_file_input(description, Path::new(&path), direct);
        }
        if !direct.is_empty() {
            bail!("--input-file cannot be combined with direct arguments");
        }
        let bytes = fs::read(&path).with_context(|| format!("failed to read {path}"))?;
        return parse_json_object(&bytes, "--input-file");
    }
    if !direct.is_empty() {
        return Ok(Value::Object(direct));
    }

    let mut stdin_text = String::new();
    // Explicit sources win without touching an inherited non-terminal stdin. Some
    // Runtime shells keep stdin open for their own protocol, so probing it here can
    // otherwise block an otherwise complete direct-flag or input-file invocation.
    if !std::io::stdin().is_terminal() {
        std::io::stdin()
            .read_to_string(&mut stdin_text)
            .context("failed to read Built-in Tool input from stdin")?;
    }
    let stdin_text = stdin_text.trim();
    if !stdin_text.is_empty() {
        return parse_json_object(stdin_text.as_bytes(), "stdin");
    }
    Ok(Value::Object(Map::new()))
}

fn parse_send_file_input(
    description: &BuiltinToolDescription,
    path: &Path,
    mut direct: Map<String, Value>,
) -> Result<Value> {
    let text = read_send_body_file(path)?;
    let request = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            rovai_core::thread_compat::normalize_builtin_input(&description.name, value).ok()
        })
        .filter(|value| validate_schema(value, &description.input_schema).is_ok());
    if let Some(request) = request {
        if !direct.is_empty() {
            return Err(CliInputFailure::send_request_file_conflict().into());
        }
        // Business validation belongs to Core. A recognized request must never
        // fall back to publishing its JSON as body after a downstream failure.
        return Ok(request);
    }
    direct.insert("body".to_string(), Value::String(text));
    Ok(Value::Object(direct))
}

fn read_send_body_file(path: &Path) -> Result<String> {
    if !fs::metadata(path)?.is_file() {
        bail!("Send input must be a regular file");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A regular path replaced by a FIFO between stat and open must not block.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options.open(path)?;
    if !file.metadata()?.is_file() {
        bail!("Send input must be a regular file");
    }
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    if text.contains('\0') {
        bail!("Send input must not contain NUL");
    }
    if text.starts_with('\u{feff}') {
        text.drain(..'\u{feff}'.len_utf8());
    }
    Ok(text)
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
    let serialized =
        serde_json::to_vec(request).map_err(|_| BuiltinToolIpcFailure::BeforeDispatch)?;
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
        BuiltinToolIpcFailure::BeforeDispatch
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
    tokio::time::timeout(timeout, read_response_frame(stream))
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

async fn read_response_frame(stream: impl AsyncRead + Unpin) -> std::io::Result<String> {
    let mut reader = BufReader::new(stream);
    let mut frame = Vec::new();
    let read = reader.read_until(b'\n', &mut frame).await?;
    if read == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "Built-in Tool IPC response ended before a frame",
        ));
    }
    if frame.last() != Some(&b'\n') {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Built-in Tool IPC response ended before a complete frame",
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
    BeforeDispatch,
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
    let mut text = "Rovai CLI\n\nAgent operations:\n  rovai send\n  rovai member list|get|create|update\n  rovai task create|get|list|update\n  rovai thread list|search|read|runs\n  rovai history search\n  rovai memory view|search|read|write\n  rovai automation list|get|create|run|close|update|delete\n  rovai mission list|get|update|status\n\nRun an Agent operation's exact `--help` for its closed inputs.\n".to_string();
    if !managed_runtime {
        text.push_str("\nUser Automation:\n  rovai app --help\n\nAgent operations keep their process-private transport. `rovai app` uses the running Desktop App's separate User Automation transport.\n");
    }
    text
}

fn task_family_help_text() -> &'static str {
    "rovai task\n\n  create  Create a durable task.\n  get     Read task details.\n  list    List task summaries.\n  update  Update an existing task.\n\nUse rovai task <command> --help for arguments.\n"
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
    let input_help = if description.name == "thread.message.send" {
        CAMP_MESSAGE_SEND_INPUT_HELP
    } else {
        "Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source."
    };
    writeln!(
        output,
        "rovai {}\n{}\n\n{input_help}\n",
        description.command.join(" "),
        description.summary
    )
    .expect("writing help to a String cannot fail");
    let rendered_discriminated = discriminated_input_variants(description).is_some_and(|input| {
        render_discriminated_input_help(&mut output, description, &input);
        true
    });
    if !rendered_discriminated {
        render_flat_input_help(&mut output, description);
        if description.name == "mission.update" {
            writeln!(output,"\nProvide at least one content field; omitted fields remain unchanged.\nUse mission status to change status.").expect("writing help to a String cannot fail");
        }
        if description.name == "member.update" {
            writeln!(output, "\nProvide at least one change. Clear optional text with \"\"; clear personalityTraits with [] in JSON. displayName cannot be empty.\nIf an image fails, fix the image; do not silently drop it and save only text. For multiline text, use a UTF-8 JSON file.").expect("writing help to a String cannot fail");
        }
        let examples = operation_help_examples(&description.name);
        writeln!(output, "\nExamples:").expect("writing help to a String cannot fail");
        for example in examples {
            for line in example.lines() {
                if !line.is_empty() {
                    output.push_str("  ");
                }
                writeln!(output, "{line}").expect("writing help to a String cannot fail");
            }
        }
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
        if description.name == "member.update" {
            let teaching = match argument.field.as_str() {
                "agentId" => "A current Thread member, or a member you created in this Thread.",
                "avatarCenterX" => {
                    "Supply center X, center Y and size together to crop the source. Centers: 0-1; size: 0.12-1; the crop must fit inside the source."
                }
                "avatarFile" => {
                    "Run-readable PNG/JPEG source. Replaces the portrait and generates its icon; omit the crop fields to use the default crop."
                }
                "avatarSize" => {
                    "With all crop fields and no avatarFile, re-crop the existing source without replacing the portrait."
                }
                "clearAvatar" => {
                    "Clear both images. Cannot combine with avatarFile or any crop field."
                }
                "expectedVersion" => {
                    "Use member get's version. On conflict, read again and decide whether a new update is needed."
                }
                "requestId" => {
                    "Generate one lowercase UUID for this update. Reuse it only for an exact retry allowed by error.recovery; never change the patch under that ID."
                }
                _ => "",
            };
            if !teaching.is_empty() {
                write_indented_help(output, teaching);
            }
        }
        if description.name == "thread.runs" {
            let teaching = match argument.field.as_str() {
                "active" => {
                    "Default: false. Include queued, running and waiting items. Cannot combine with status.\nThese are logical states; they do not prove process liveness or Agent availability."
                }
                "agentId" => "Optional. Filter by Agent ID.",
                "cursor" => "Continue with nextCursor. Keep the same Thread and filters.",
                "limit" => "Default: 20. Range: 1-100. Limits items, not messageCount.",
                "status" => {
                    "One of: queued, running, waiting, succeeded, failed, cancelled. Cannot combine with active.\nqueued includes items with and without a Run ID. Without either filter, include all states."
                }
                "threadId" => {
                    "Optional. Omit for the current Thread; pass any extant public Thread ID."
                }
                _ => "",
            };
            if !teaching.is_empty() {
                write_indented_help(output, teaching);
            }
        }
        if description.name == "thread.message.send" && argument.field == "body" {
            write_indented_help(output, CAMP_MESSAGE_SEND_BODY_HELP);
        }
        if description.name == "thread.message.send" && argument.field == "to" {
            write_indented_help(output, CAMP_MESSAGE_SEND_TO_HELP);
        }
        if description.name == "thread.message.send" && argument.field == "publicOnly" {
            write_indented_help(output, CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP);
        }
        if description.name == "thread.message.send" && argument.field == "mentionUser" {
            write_indented_help(output, CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP);
        }
        if description.name == "thread.message.send" && argument.field == "files" {
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
        if matches!(
            description.name.as_str(),
            "team.create_task" | "team.update_task"
        ) && argument.field == "description"
        {
            writeln!(output, "      Task scope and requirements.")
                .expect("writing help to a String cannot fail");
        }
        if matches!(description.name.as_str(), "thread.search" | "thread.read")
            && argument.field == "threadId"
        {
            writeln!(
                output,
                "      Optional. Omit for the current Thread; pass any extant public Thread ID to target that Thread only."
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

    if description.name == "thread.read" {
        writeln!(
            output,
            "Direction semantics:\n  before = move toward lower sequence numbers / older messages.\n           Without a cursor, begin with the newest visible page.\n  after  = move toward higher sequence numbers / newer messages.\n           Without a cursor, begin with the oldest visible page.\n\nDo not use older, newer, backward, or forward as direction values."
        )
        .expect("writing help to a String cannot fail");
    }
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
    if matches!(description.name.as_str(), "thread.search" | "thread.read")
        && field.field == "threadId"
    {
        writeln!(
            output,
            "        Omit for the current Thread; pass any extant public Thread ID to target that Thread only."
        )
        .expect("writing help to a String cannot fail");
    }
    if description.name == "thread.read" && field.field == "before" {
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
        "mission.list" => &[
            "rovai mission list",
            "rovai mission list --query \"attachments\"",
            "rovai mission list --status needs_you",
        ],
        "mission.get" => &[
            "rovai mission get",
            "rovai mission get --mission-id rvm_example",
        ],
        "mission.update" => &["rovai mission update --title \"Directory navigation\""],
        "mission.status" => &["rovai mission status --status needs_you"],
        "thread.message.send" => &CAMP_MESSAGE_SEND_HELP_EXAMPLES,
        "member.list" => &["rovai member list"],
        "member.get" => &["rovai member get --agent-id agent_27"],
        "member.update" => &[
            "rovai member update --agent-id agent_27 --expected-version 3 --request-id 51d668e1-6dc7-4f39-80b2-0555f823715a --team-role 'Researcher'",
            "rovai member update --input-file member-update.json",
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
        "team.update_task" => &["rovai task update --task-id task_123 --status in_progress"],
        "thread.list" => &["rovai thread list --limit 10"],
        "thread.search" => &[
            "rovai thread search --query 'amount'",
            "rovai thread search --thread-id '<thread-id>' --query 'amount'",
        ],
        "thread.runs" => &[
            "rovai thread runs",
            "rovai thread runs --active",
            "rovai thread runs --agent-id agent_5 --active",
            "rovai thread runs --status queued",
            "rovai thread runs --thread-id '<thread-id>' --active",
            "rovai thread runs --limit 20",
            "rovai thread runs --cursor '<nextCursor>'",
            "rovai thread runs --input-file query.json",
        ],
        "thread.read" => &[
            "rovai thread read",
            "rovai thread read --limit 20",
            "rovai thread read --before 123",
            "rovai thread read --message-id '<message-id>'",
            "rovai thread read --reply-chain '<message-id>' --limit 20",
        ],
        "history.search" => &["rovai history search --query 'amount'"],
        "single_chat.history" => &[
            "rovai single-chat history",
            "rovai single-chat history --before-sequence 12 --limit 20",
        ],
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
    use rovai_core::camp_message_send_teaching::CAMP_MESSAGE_SEND_SUMMARY;
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
                operation: "thread.list".to_string(),
                input: json!({}),
            },
        }
    }

    #[tokio::test]
    async fn ipc_response_reader_requires_one_complete_newline_delimited_utf8_frame() {
        assert_eq!(
            read_response_frame(std::io::Cursor::new(b"{\"ok\":true}\n"))
                .await
                .unwrap(),
            r#"{"ok":true}"#
        );
        assert_eq!(
            read_response_frame(std::io::Cursor::new(b"{}"))
                .await
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
        let large = format!("{{\"body\":\"{}\"}}\n", "x".repeat(2 * 1024 * 1024));
        assert_eq!(
            read_response_frame(std::io::Cursor::new(large.as_bytes()))
                .await
                .unwrap(),
            large.trim_end()
        );
    }

    #[test]
    fn managed_runtime_cli_surface_does_not_advertise_or_admit_user_automation() {
        assert!(!root_help_text(true).contains("rovai app"));
        assert!(root_help_text(false).contains("rovai app --help"));
        for (context, run_tmp, available) in [
            (None, None, true),
            (Some("context"), None, false),
            (None, Some("run-tmp"), false),
            (Some("context"), Some("run-tmp"), false),
            (Some(""), None, false),
            (None, Some(""), false),
        ] {
            assert_eq!(
                user_automation_available_in_process(context, run_tmp),
                available
            );
        }
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
        let read = builtin_tool_description("thread.read").unwrap();
        for flags in [
            ["--thread-id", "scope", "--reply-chain", "message"],
            ["--camp-id", "scope", "--thread", "message"],
        ] {
            assert_eq!(
                parse_operation_input(&read, &flags.map(str::to_string)).unwrap(),
                json!({"threadId":"scope", "replyChain":"message"})
            );
        }
        for flags in [
            ["--thread-id", "same", "--camp-id", "same"],
            ["--reply-chain", "same", "--thread", "same"],
        ] {
            assert!(parse_operation_input(&read, &flags.map(str::to_string)).is_err());
        }
        let history = builtin_tool_description("history.search").unwrap();
        assert!(
            parse_operation_input(
                &history,
                &["--thread-ids", "same", "--camp-ids", "same"].map(str::to_string)
            )
            .is_err()
        );
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
    fn mission_status_help_and_direct_flags_keep_source_message_optional() {
        let description = operation_help(&[
            "mission".to_string(),
            "status".to_string(),
            "--help".to_string(),
        ])
        .unwrap()
        .unwrap();
        let source_message = description
            .arguments
            .iter()
            .find(|argument| argument.field == "sourceMessageId")
            .unwrap();
        assert!(!source_message.required);
        assert_eq!(
            description.input_schema["properties"]["sourceMessageId"]["description"],
            "Optional reference to an existing public message in this Thread."
        );
        let help = operation_help_text(&description);
        assert!(help.contains("rovai mission status --status needs_you"));
        assert!(!help.contains("Required for needs_you or completed"));
        assert_eq!(
            parse_and_validate_operation_input(
                &description,
                &["--status".to_string(), "completed".to_string()],
            )
            .unwrap(),
            json!({"status": "completed"})
        );
    }

    #[test]
    fn single_chat_history_direct_flags_are_bounded_and_id_free() {
        let description = builtin_tool_description("single_chat.history").unwrap();
        let input = parse_and_validate_operation_input(
            &description,
            &[
                "--before-sequence".to_string(),
                "12".to_string(),
                "--limit".to_string(),
                "20".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(input, json!({"beforeSequence": 12, "limit": 20}));
        assert!(
            parse_and_validate_operation_input(
                &description,
                &["--limit".to_string(), "51".to_string()]
            )
            .is_err()
        );
        assert!(description.arguments.iter().all(|argument| !matches!(
            argument.field.as_str(),
            "conversationId" | "threadId" | "agentId"
        )));
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
        let update = builtin_tool_description("member.update").unwrap();
        let direct = parse_and_validate_operation_input(
            &update,
            &[
                "--agent-id".into(),
                "agent_2".into(),
                "--expected-version".into(),
                "3".into(),
                "--request-id".into(),
                "51d668e1-6dc7-4f39-80b2-0555f823715a".into(),
                "--avatar-center-x".into(),
                "0.5".into(),
                "--avatar-center-y".into(),
                "0.5".into(),
                "--avatar-size".into(),
                "0.5".into(),
                "--avatar-file".into(),
                "./missing-avatar.png".into(),
            ],
        )
        .unwrap();
        assert_eq!(direct["avatarSize"], 0.5);
        assert_eq!(direct["expectedVersion"], 3);
        assert!(direct.get("teamRole").is_none());
        // Core resolves against the authenticated Run, not the CLI or JSON cwd.
        // Passing the source through must not require its existence.
        assert_eq!(direct["avatarFile"], "./missing-avatar.png");
        let path = std::env::temp_dir().join(format!("member-update-{}.json", Uuid::new_v4()));
        std::fs::write(&path, serde_json::to_vec(&direct).unwrap()).unwrap();
        let from_file = parse_and_validate_operation_input(
            &update,
            &["--input-file".into(), path.to_string_lossy().into_owned()],
        )
        .unwrap();
        assert_eq!(from_file, direct);
        assert!(
            parse_and_validate_operation_input(
                &update,
                &[
                    "--input-file".into(),
                    path.to_string_lossy().into_owned(),
                    "--team-role".into(),
                    "unexpected".into()
                ]
            )
            .is_err()
        );
        let create = builtin_tool_description("member.create").unwrap();
        let create_input = parse_and_validate_operation_input(
            &create,
            &[
                "--creation-key".into(),
                "51d668e1-6dc7-4f39-80b2-0555f823715a".into(),
                "--display-name".into(),
                "Avatar path fixture".into(),
                "--avatar-file".into(),
                "./missing-avatar.png".into(),
            ],
        )
        .unwrap();
        assert_eq!(create_input["avatarFile"], "./missing-avatar.png");
        std::fs::write(&path, serde_json::to_vec(&create_input).unwrap()).unwrap();
        assert_eq!(
            parse_and_validate_operation_input(
                &create,
                &["--input-file".into(), path.to_string_lossy().into_owned()],
            )
            .unwrap(),
            create_input
        );
        for (description, mut input) in [(update, direct), (create, create_input)] {
            input["avatarFile"] = json!(path.with_file_name("missing-avatar.png"));
            std::fs::write(&path, serde_json::to_vec(&input).unwrap()).unwrap();
            assert_eq!(
                parse_and_validate_operation_input(
                    &description,
                    &["--input-file".into(), path.to_string_lossy().into_owned()],
                )
                .unwrap(),
                input
            );
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn cli_commands_map_to_canonical_operations() {
        assert_eq!(
            builtin_tool_identity_by_command("send", "")
                .unwrap()
                .operation,
            "thread.message.send"
        );
        assert!(builtin_tool_identity_by_command("gather", "").is_none());
        assert!(builtin_tool_identity_by_command("memory", "propose-hearth").is_none());
        assert!(
            invocation_identity(&["memory".to_string(), "propose-hearth".to_string()]).is_none()
        );
        assert!(builtin_tool_identity_by_command("tool", "list").is_none());
        assert!(builtin_tool_identity_by_command("tool", "describe").is_none());
        for family in [
            "member",
            "camp",
            "history",
            "memory",
            "single-chat",
            "automation",
        ] {
            let args = [family.to_string(), "--help".to_string()];
            assert!(operation_help(&args).unwrap().is_none());
            assert!(is_family_help(&args));
        }
        let task_help = ["task".to_string(), "--help".to_string()];
        assert!(operation_help(&task_help).unwrap().is_none());
        assert!(!is_family_help(&task_help));
        assert_eq!(
            task_family_help_text(),
            "rovai task\n\n  create  Create a durable task.\n  get     Read task details.\n  list    List task summaries.\n  update  Update an existing task.\n\nUse rovai task <command> --help for arguments.\n"
        );
    }

    #[test]
    fn exact_help_surface_covers_the_current_catalog_and_no_family_aliases() {
        let exact_paths: &[&[&str]] = &[
            &["send", "--help"],
            &["member", "list", "--help"],
            &["member", "get", "--help"],
            &["member", "update", "--help"],
            &["member", "create", "--help"],
            &["task", "create", "--help"],
            &["task", "get", "--help"],
            &["task", "list", "--help"],
            &["task", "update", "--help"],
            &["camp", "list", "--help"],
            &["camp", "search", "--help"],
            &["camp", "read", "--help"],
            &["history", "search", "--help"],
            &["single-chat", "history", "--help"],
            &["memory", "view", "--help"],
            &["memory", "search", "--help"],
            &["memory", "read", "--help"],
            &["memory", "write", "--help"],
            &["automation", "list", "--help"],
            &["automation", "get", "--help"],
            &["automation", "create", "--help"],
            &["automation", "run", "--help"],
            &["automation", "close", "--help"],
            &["automation", "update", "--help"],
            &["automation", "delete", "--help"],
            &["mission", "list", "--help"],
            &["mission", "get", "--help"],
            &["mission", "update", "--help"],
            &["mission", "status", "--help"],
        ];
        assert_eq!(exact_paths.len(), 29);
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
        for family in [
            "member",
            "camp",
            "history",
            "memory",
            "single-chat",
            "automation",
        ] {
            let args = vec![family.to_string(), "--help".to_string()];
            assert!(operation_help(&args).unwrap().is_none());
            assert!(is_family_help(&args));
        }
        assert!(!is_family_help(&["task".to_string(), "--help".to_string()]));
        let view = builtin_tool_description("memory.view").unwrap();
        let help = operation_help_text(&view);
        assert!(help.contains("One of: hearth, companion, relationship."));
        assert!(help.contains("Required only when --scope relationship"));
    }

    #[test]
    fn camp_help_teaches_default_and_explicit_single_camp_targets() {
        let search = builtin_tool_description("thread.search").unwrap();
        let search_help = operation_help_text(&search);
        assert!(search_help.contains("Omit for the current Thread"));
        assert!(search_help.contains("any extant public Thread ID"));
        assert!(
            search
                .arguments
                .iter()
                .find(|argument| argument.field == "threadId")
                .is_some_and(|argument| !argument.required)
        );
        assert_eq!(
            parse_operation_input(&search, &["--query".to_string(), "amount".to_string()]).unwrap(),
            json!({"query": "amount"})
        );
        assert_eq!(
            operation_help_examples("thread.search"),
            [
                "rovai thread search --query 'amount'",
                "rovai thread search --thread-id '<thread-id>' --query 'amount'",
            ]
        );

        let read = builtin_tool_description("thread.read").unwrap();
        let read_help = operation_help_text(&read);
        for flag in ["--limit", "--before", "--message-id", "--reply-chain"] {
            assert!(read_help.contains(flag), "missing {flag} from help");
        }
        for removed in ["--mode", "--direction", "--cursor", "--after"] {
            assert!(!read_help.contains(removed), "stale {removed} in help");
        }
        assert!(read_help.contains("Omit for the current Thread"));
        assert_eq!(read_help.matches("--thread-id").count(), 1);
        assert_eq!(
            operation_help_examples("thread.read"),
            [
                "rovai thread read",
                "rovai thread read --limit 20",
                "rovai thread read --before 123",
                "rovai thread read --message-id '<message-id>'",
                "rovai thread read --reply-chain '<message-id>' --limit 20",
            ]
        );
        for (args, expected) in [
            (vec!["--limit", "20"], json!({"limit": 20})),
            (vec!["--before", "123"], json!({"before": 123})),
            (
                vec!["--message-id", "msg_123"],
                json!({"messageId": "msg_123"}),
            ),
            (
                vec!["--reply-chain", "msg_123", "--limit", "20"],
                json!({"replyChain": "msg_123", "limit": 20}),
            ),
        ] {
            let args = args.into_iter().map(str::to_string).collect::<Vec<_>>();
            assert_eq!(
                parse_and_validate_operation_input(&read, &args).unwrap(),
                expected
            );
        }
        for removed in ["--mode", "--direction", "--cursor", "--after"] {
            assert!(
                parse_operation_input(&read, &[removed.to_string(), "legacy".to_string()]).is_err()
            );
        }
        assert!(
            parse_and_validate_operation_input(
                &read,
                &[
                    "--message-id".to_string(),
                    "msg_123".to_string(),
                    "--before".to_string(),
                    "10".to_string(),
                ],
            )
            .is_err()
        );
        assert!(
            parse_and_validate_operation_input(
                &read,
                &[
                    "--message-id".to_string(),
                    "msg_123".to_string(),
                    "--reply-chain".to_string(),
                    "msg_456".to_string(),
                ],
            )
            .is_err()
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
            anyhow::anyhow!("thread.read attachments[0] is missing required property fileCount");
        let path =
            write_output_contract_mismatch_diagnostic(&directory, "thread.read", &source_error)
                .unwrap();
        let diagnostic: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(diagnostic["code"], "builtin_tool.output_contract_mismatch");
        assert_eq!(diagnostic["operation"], "thread.read");
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
    fn send_file_input_preserves_text_and_complete_schema_requests() {
        let description = builtin_tool_description("thread.message.send").unwrap();
        let path = env::temp_dir().join(format!("rovai-send-{}", Uuid::new_v4()));
        let file_args = vec!["--input-file".into(), path.to_string_lossy().into_owned()];
        let texts = [
            "  中文 🌸\r\n# Title\n\n`code` \\\"quotes\\\" $() \\n\t\n".to_string(),
            "".to_string(),
            " \r\n\t ".to_string(),
            r#"{"status":"done","count":3}"#.to_string(),
            r#"{"body":"done","publicOnly":true,"extra":1}"#.to_string(),
            r#"{"body":123}"#.to_string(),
            r#"{"body":null}"#.to_string(),
            r#"{"body":"done","publicOnly":"true"}"#.to_string(),
            r#"{"to":["agent_5","agent_5"]}"#.to_string(),
            serde_json::to_string(&json!({"files": vec!["report.pdf"; 17]})).unwrap(),
            "{invalid JSON".to_string(),
            "{\"status\":1}\n{\"status\":2}\n".to_string(),
            r#""literal\nstring""#.to_string(),
            "[]".to_string(),
            "123".to_string(),
            "null".to_string(),
            "```json\n{\"body\":\"hello\",\"publicOnly\":true}\n```\n".to_string(),
        ];
        for text in texts {
            fs::write(&path, &text).unwrap();
            assert_eq!(
                parse_and_validate_operation_input(&description, &file_args).unwrap(),
                json!({"body": text})
            );
            for args in [
                [file_args.clone(), vec!["--public-only".into()]].concat(),
                [vec!["--public-only".into()], file_args.clone()].concat(),
            ] {
                assert_eq!(
                    parse_and_validate_operation_input(&description, &args).unwrap(),
                    json!({"body": text, "publicOnly": true})
                );
            }
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
        }

        let requests = [
            json!({}),
            json!({"publicOnly": true}),
            json!({"files": ["report.pdf"]}),
            json!({"body": "完成\n🌸\\n", "publicOnly": true, "mentionUser": true}),
            json!({"body": "continue", "to": ["agent_5", "agent_7"], "taskId": "task-1", "files": ["report.pdf"]}),
            // Recognition preserves business-invalid requests for Core rejection.
            json!({"body": "bad routing", "publicOnly": true, "to": ["agent_5"]}),
            json!({"body": "missing attachment", "files": ["does-not-exist.pdf"]}),
        ];
        for request in requests {
            fs::write(&path, serde_json::to_vec(&request).unwrap()).unwrap();
            assert_eq!(
                parse_and_validate_operation_input(&description, &file_args).unwrap(),
                request
            );
            for flags in [
                vec!["--public-only"],
                vec!["--public-only=false"],
                vec!["--to-user"],
                vec!["--to-principal"],
                vec!["--to", "agent_5"],
                vec!["--task-id", "task-1"],
                vec!["--file", "report.pdf"],
            ] {
                let flags = flags.into_iter().map(str::to_string).collect::<Vec<_>>();
                for args in [
                    [file_args.clone(), flags.clone()].concat(),
                    [flags, file_args.clone()].concat(),
                ] {
                    let error =
                        parse_and_validate_operation_input(&description, &args).unwrap_err();
                    assert_eq!(
                        error.message,
                        "The input file matches a complete Send request and cannot be combined with command-line send options."
                    );
                    assert!(error.details.is_none());
                }
            }
        }

        // Both encodings keep the existing body limit; JSON escaping and outer
        // whitespace do not impose a new limit on the raw request file.
        let limit = rovai_core::message_delivery::CAMP_MESSAGE_SEND_MAX_BODY_BYTES;
        for body in [
            "x".repeat(limit),
            "中".repeat(limit / 3),
            "🌸".repeat(limit / 4),
        ] {
            fs::write(&path, &body).unwrap();
            assert_eq!(
                parse_and_validate_operation_input(&description, &file_args).unwrap(),
                json!({"body": body})
            );
        }
        fs::write(&path, "x".repeat(limit + 1)).unwrap();
        assert!(parse_and_validate_operation_input(&description, &file_args).is_err());
        let encoded = format!(
            "  {{\"publicOnly\":true,\"body\":\"{}\"}}  ",
            "\\u0061".repeat(limit)
        );
        fs::write(&path, encoded).unwrap();
        assert_eq!(
            parse_and_validate_operation_input(&description, &file_args).unwrap(),
            json!({"body": "a".repeat(limit), "publicOnly": true})
        );

        fs::write(&path, "text").unwrap();
        let flags = vec![
            "--to".into(),
            "agent_5".into(),
            "--to".into(),
            "agent_7".into(),
            "--to-principal".into(),
            "--task-id".into(),
            "task-1".into(),
            "--file".into(),
            "report.pdf".into(),
        ];
        assert_eq!(
            parse_and_validate_operation_input(&description, &[file_args.clone(), flags].concat())
                .unwrap(),
            json!({"body":"text", "to":["agent_5","agent_7"], "mentionUser":true, "taskId":"task-1", "files":["report.pdf"]})
        );
        for args in [
            [file_args.clone(), file_args.clone()].concat(),
            [file_args.clone(), vec!["--body".into(), "other".into()]].concat(),
            [vec!["--body".into(), "other".into()], file_args.clone()].concat(),
            [
                file_args.clone(),
                vec!["--to-user".into(), "--to-principal".into()],
            ]
            .concat(),
        ] {
            assert!(parse_and_validate_operation_input(&description, &args).is_err());
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn send_file_reader_accepts_only_regular_utf8_text_and_removes_one_bom() {
        let directory = env::temp_dir().join(format!("rovai-send-files-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("body.pdf"); // Extension does not select the parser.
        assert!(read_send_body_file(&path).is_err());
        assert!(read_send_body_file(&directory).is_err());
        for bytes in [
            b"\xff".as_slice(),
            b"ok\0bad",
            b"\xef\xbb\xbf\0",
            b"\xf0\x9f",
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(read_send_body_file(&path).is_err());
        }
        for (source, expected) in [
            ("\u{feff}body\n", "body\n"),
            ("\u{feff}\u{feff}body", "\u{feff}body"),
            (" \u{feff}body", " \u{feff}body"),
            ("\u{feff}{\"body\":\"done\"}", "{\"body\":\"done\"}"),
        ] {
            fs::write(&path, source).unwrap();
            assert_eq!(read_send_body_file(&path).unwrap(), expected);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = directory.join("link");
            symlink(&path, &link).unwrap();
            assert_eq!(read_send_body_file(&link).unwrap(), "{\"body\":\"done\"}");
            assert!(read_send_body_file(Path::new("/dev/null")).is_err());
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn public_send_help_has_no_agent_supplied_camp_scope() {
        let description = operation_help(&["send".to_string(), "--help".to_string()])
            .unwrap()
            .unwrap();
        assert!(description.arguments.iter().all(|argument| {
            argument.field != "threadId"
                && argument.flag != "--thread-id"
                && argument.field != "replyToThreadMessageId"
                && argument.flag != "--reply-to-camp-message-id"
        }));
        assert!(
            parse_operation_input(
                &description,
                &["--thread-id".to_string(), "camp-legacy".to_string()]
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
        assert_eq!(description.summary, CAMP_MESSAGE_SEND_SUMMARY);
        assert!(!description.summary.contains("inline"));
        assert!(description.summary.contains("agentAddressingMode"));
        assert!(description.summary.contains("effectiveRecipients"));
        assert!(description.summary.contains("deliveryIds"));
        assert!(description.summary.contains("public-only"));
        assert!(description.summary.contains("--to-user"));
        assert!(!description.summary.contains("--to-principal"));
        let body = description
            .arguments
            .iter()
            .find(|argument| argument.field == "body")
            .unwrap();
        assert!(!body.required);
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--body".to_string(),
                    r"First paragraph.\n\nSecond paragraph.".to_string(),
                ]
            )
            .unwrap(),
            json!({"body": r"First paragraph.\n\nSecond paragraph."})
        );
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--body".to_string(),
                    "First paragraph.\n\nSecond paragraph.".to_string(),
                ]
            )
            .unwrap(),
            json!({"body": "First paragraph.\n\nSecond paragraph."})
        );
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
        assert_eq!(to_principal.flag, "--to-user");
        assert_eq!(to_principal.value_kind, "boolean");
        assert!(!to_principal.repeatable);
        assert!(!to_principal.required);
        assert_eq!(
            parse_operation_input(
                &description,
                &[
                    "--to-user".to_string(),
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
                    "--to-principal".to_string(),
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
            r#"{"body":"First paragraph.\n\nSecond paragraph.","mentionUser":true}"#,
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
            json!({"body": "First paragraph.\n\nSecond paragraph.", "mentionUser": true})
        );
        std::fs::remove_file(input_file).unwrap();
        assert!(parse_operation_input(&description, &["--mention-user".to_string()]).is_err());
        assert_eq!(
            operation_help_examples("thread.message.send"),
            [
                "Write reply.md:\n  Result:\n\n  Updated `src/example.rs`.\nAfter the write succeeds:\n  rovai send --public-only --input-file reply.md",
                "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'",
                "rovai send --public-only --to-user --body 'Please choose whether to roll back the client or continue the token investigation.'",
            ]
        );
        for flags in [
            ["--to-user", "--to-principal"],
            ["--to-principal", "--to-user"],
        ] {
            assert!(parse_operation_input(&description, &flags.map(str::to_string)).is_err());
        }
        let help = operation_help_text(&description);
        assert!(help.contains("Ordinary public Thread messages are already visible to the User."));
        assert!(help.contains("new unresolved decision, answer, or action for the User"));
        assert!(help.contains("User attention is message-local"));
        assert!(help.contains("does not represent approval"));
        assert!(help.contains("Agent addressing schedules concrete continuing work, not CC."));
        assert!(help.contains("This option is invalid with --public-only."));
        assert!(help.contains(
            "effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created."
        ));
        assert!(!help.contains("inline Agent addressing"));
        assert!(help.contains(r"Use --body for simple single-line text; \n remains literal."));
        assert!(help.contains(CAMP_MESSAGE_SEND_INPUT_HELP));
        assert!(help.contains("For multiline, Markdown, or complex text, use a file-write tool to write the reply text itself, with real newlines, to a UTF-8 file."));
        assert!(!help.contains("JSON"));
        assert!(!help.contains("ROVAI_RUN_TMP"));
        assert!(help.contains("Examples:\n  Write reply.md:\n    Result:\n\n    Updated `src/example.rs`.\n  After the write succeeds:\n    rovai send --public-only --input-file reply.md"));
        assert!(help.contains(CAMP_MESSAGE_SEND_FILE_HELP));
        assert!(!help.contains("Rovai privately snapshots"));
        assert!(help.contains("It may be combined with --to-user."));
        assert!(!help.contains("--to-principal"));
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
        assert_eq!(
            description.summary,
            "Create an independently owned task that persists across runs or handoffs.\nPrefer existing tasks; do not create tasks for one-off collaboration or local steps.\nUser/Default Lead only. Put scope and requirements in description.\nDoes not notify or start work; use rovai send --task-id."
        );
        let assignee = description
            .arguments
            .iter()
            .find(|argument| argument.field == "assigneeAgentId")
            .unwrap();
        assert!(assignee.required);
        assert_eq!(assignee.flag, "--assignee-agent-id");
        assert!(
            description
                .arguments
                .iter()
                .all(|argument| argument.flag != "--acceptance-criteria")
        );
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
            BuiltinToolIpcFailure::BeforeDispatch
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
                r"\\.\pipe\rovai-ai-{}-{}",
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
            BuiltinToolIpcFailure::BeforeDispatch
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
            "thread.message.send",
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
