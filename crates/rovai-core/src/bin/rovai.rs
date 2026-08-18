use std::{
    collections::BTreeMap,
    env, fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, IsTerminal, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::builtin_tool_cli_output::{
    outcome_indeterminate_agent_error, output_contract_mismatch_agent_error, project_envelope,
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
    CAMP_MESSAGE_SEND_HELP_EXAMPLES, CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP, CAMP_MESSAGE_SEND_TO_HELP,
    CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP,
};
use rovai_core::command::canonical_json_digest;
use serde_json::{Map, Value, json};
use uuid::Uuid;

const CORE_TIMEOUT: Duration = Duration::from_secs(30);
const CORE_ATTEMPTS: usize = 3;
const COMPACTION_HOOK_TIMEOUT: Duration = Duration::from_millis(500);
const COMPACTION_HOOK_ATTEMPTS: usize = 3;

fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(code),
        Err(_error) => {
            print_safe_cli_error();
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<u8> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg == "__compaction-hook") {
        // Runtime hooks are enhancement-only. Malformed input, unavailable
        // Core, and uncertain acknowledgements must never block compaction or
        // the AgentRun that triggered it.
        let _ = run_compaction_hook(&args[1..]);
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
        print_invalid_input();
        return Ok(2);
    }
    if invocation_identity(&args).is_none() {
        print_invalid_input();
        return Ok(2);
    }

    let context = load_context()?;
    let auth = context.auth()?;
    let request = match args.as_slice() {
        [command, rest @ ..] if matches!(command.as_str(), "send" | "gather") => {
            let identity = builtin_tool_identity_by_command(command, "")
                .with_context(|| format!("unknown Rovai command: rovai {command}"))?;
            let description = builtin_tool_description(identity.operation)?;
            let input = match parse_operation_input(&description, rest) {
                Ok(input) => input,
                Err(_) => {
                    print_invalid_input();
                    return Ok(2);
                }
            };
            BuiltinToolIpcRequest {
                ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                auth,
                body: BuiltinToolIpcRequestBody::Invoke {
                    request_id: Uuid::new_v4().to_string(),
                    operation: identity.operation.to_string(),
                    input,
                },
            }
        }
        [group, action, rest @ ..] => {
            let identity = builtin_tool_identity_by_command(group, action)
                .with_context(|| format!("unknown Rovai command: rovai {group} {action}"))?;
            let description = builtin_tool_description(identity.operation)?;
            let input = match parse_operation_input(&description, rest) {
                Ok(input) => input,
                Err(_) => {
                    print_invalid_input();
                    return Ok(2);
                }
            };
            BuiltinToolIpcRequest {
                ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                auth,
                body: BuiltinToolIpcRequestBody::Invoke {
                    request_id: Uuid::new_v4().to_string(),
                    operation: identity.operation.to_string(),
                    input,
                },
            }
        }
        _ => bail!("invalid Rovai command; run `rovai --help`"),
    };

    let response = match send_with_retry(&context.core_endpoint, &request) {
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

fn run_compaction_hook(args: &[String]) -> Result<()> {
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
        match send_compaction_hook(&context.core_endpoint, &request) {
            Ok(_response) => {
                let _ = fs::remove_file(&staged_observation);
                return Ok(());
            }
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < COMPACTION_HOOK_ATTEMPTS {
            std::thread::sleep(Duration::from_millis(50));
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

#[cfg(unix)]
fn send_compaction_hook(
    endpoint: &LocalIpcEndpoint,
    request: &CompactionHookIpcRequest,
) -> Result<CompactionHookIpcResponse> {
    use std::os::unix::net::UnixStream;

    let LocalIpcEndpoint::UnixSocket { path } = endpoint else {
        bail!("compaction hook endpoint does not match this platform");
    };

    let serialized = serde_json::to_vec(request)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        bail!("compaction hook request is too large");
    }
    let mut stream = UnixStream::connect(path)?;
    stream.set_read_timeout(Some(COMPACTION_HOOK_TIMEOUT))?;
    stream.set_write_timeout(Some(COMPACTION_HOOK_TIMEOUT))?;
    stream.write_all(&serialized)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    let response = read_bounded_response(stream)?;
    Ok(serde_json::from_str(&response)?)
}

#[cfg(windows)]
fn send_compaction_hook(
    endpoint: &LocalIpcEndpoint,
    request: &CompactionHookIpcRequest,
) -> Result<CompactionHookIpcResponse> {
    let LocalIpcEndpoint::WindowsNamedPipe { name } = endpoint else {
        bail!("compaction hook endpoint does not match this platform");
    };
    let serialized = serde_json::to_vec(request)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        bail!("compaction hook request is too large");
    }
    let mut stream = open_windows_named_pipe(name)?;
    stream.write_all(&serialized)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    let response = read_bounded_response(stream)?;
    Ok(serde_json::from_str(&response)?)
}

#[cfg(not(any(unix, windows)))]
fn send_compaction_hook(
    _endpoint: &LocalIpcEndpoint,
    _request: &CompactionHookIpcRequest,
) -> Result<CompactionHookIpcResponse> {
    bail!("compaction hook relay is unavailable on this platform")
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

#[cfg(unix)]
fn send_with_retry(
    endpoint: &LocalIpcEndpoint,
    request: &BuiltinToolIpcRequest,
) -> std::result::Result<BuiltinToolIpcResponse, BuiltinToolIpcFailure> {
    use std::os::unix::net::UnixStream;

    let LocalIpcEndpoint::UnixSocket { path } = endpoint else {
        return Err(BuiltinToolIpcFailure::Predictable);
    };

    let serialized = serde_json::to_vec(request).map_err(|_| BuiltinToolIpcFailure::Predictable)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        return Err(BuiltinToolIpcFailure::Predictable);
    }
    let mut dispatch_became_indeterminate = false;
    for _attempt in 0..CORE_ATTEMPTS {
        let Ok(mut stream) = UnixStream::connect(path) else {
            continue;
        };
        if stream.set_read_timeout(Some(CORE_TIMEOUT)).is_err()
            || stream.set_write_timeout(Some(CORE_TIMEOUT)).is_err()
        {
            continue;
        }
        if stream.write_all(&serialized).is_err()
            || stream.write_all(b"\n").is_err()
            || stream.flush().is_err()
        {
            dispatch_became_indeterminate = true;
            continue;
        }
        match read_bounded_response(stream) {
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                return Err(BuiltinToolIpcFailure::Predictable);
            }
            Err(_) => dispatch_became_indeterminate = true,
            Ok(response) => match serde_json::from_str(&response) {
                Ok(response) => return Ok(response),
                Err(_) => return Err(BuiltinToolIpcFailure::Predictable),
            },
        }
    }
    Err(if dispatch_became_indeterminate {
        BuiltinToolIpcFailure::OutcomeIndeterminate
    } else {
        BuiltinToolIpcFailure::Predictable
    })
}

#[cfg(windows)]
fn send_with_retry(
    endpoint: &LocalIpcEndpoint,
    request: &BuiltinToolIpcRequest,
) -> std::result::Result<BuiltinToolIpcResponse, BuiltinToolIpcFailure> {
    let LocalIpcEndpoint::WindowsNamedPipe { name } = endpoint else {
        return Err(BuiltinToolIpcFailure::Predictable);
    };
    let serialized = serde_json::to_vec(request).map_err(|_| BuiltinToolIpcFailure::Predictable)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        return Err(BuiltinToolIpcFailure::Predictable);
    }
    let mut dispatch_became_indeterminate = false;
    for _attempt in 0..CORE_ATTEMPTS {
        let Ok(mut stream) = open_windows_named_pipe(name) else {
            continue;
        };
        if stream.write_all(&serialized).is_err()
            || stream.write_all(b"\n").is_err()
            || stream.flush().is_err()
        {
            dispatch_became_indeterminate = true;
            continue;
        }
        match read_bounded_response(stream) {
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                return Err(BuiltinToolIpcFailure::Predictable);
            }
            Err(_) => dispatch_became_indeterminate = true,
            Ok(response) => match serde_json::from_str(&response) {
                Ok(response) => return Ok(response),
                Err(_) => return Err(BuiltinToolIpcFailure::Predictable),
            },
        }
    }
    Err(if dispatch_became_indeterminate {
        BuiltinToolIpcFailure::OutcomeIndeterminate
    } else {
        BuiltinToolIpcFailure::Predictable
    })
}

fn read_bounded_response(stream: impl Read) -> std::io::Result<String> {
    let reader = BufReader::new(stream);
    let mut limited = reader.take((BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 2) as u64);
    let mut frame = Vec::new();
    let read = limited.read_until(b'\n', &mut frame)?;
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

#[cfg(windows)]
fn open_windows_named_pipe(name: &str) -> Result<std::fs::File> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};

    let stream = OpenOptions::new().read(true).write(true).open(name)?;
    if unsafe { SetHandleInformation(stream.as_raw_handle() as _, HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(std::io::Error::last_os_error())
            .context("failed to make the Built-in Tool client handle non-inheritable");
    }
    Ok(stream)
}

#[cfg(not(any(unix, windows)))]
fn send_with_retry(
    _endpoint: &LocalIpcEndpoint,
    _request: &BuiltinToolIpcRequest,
) -> std::result::Result<BuiltinToolIpcResponse, BuiltinToolIpcFailure> {
    Err(BuiltinToolIpcFailure::Predictable)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BuiltinToolIpcFailure {
    Predictable,
    OutcomeIndeterminate,
}

fn print_root_help() {
    println!(
        "Rovai Agent CLI\n\nOperations:\n  rovai send\n  rovai gather\n  rovai member create\n  rovai task create|get|list|update\n  rovai camp list|search|read\n  rovai history search\n  rovai memory view|search|read|write\n\nRun `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry. Each operation supports direct flags, JSON stdin/heredoc, or --input-file <path>."
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

fn print_invalid_input() {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "error": {
                "code": "builtin_tool.invalid_input",
                "message": "Command input does not match the accepted arguments.",
                "recovery": "fix_input"
            }
        }))
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
        "rovai {}\n{}\n\nInput: direct flags, JSON stdin/heredoc, or --input-file <path>\n",
        description.command.join(" "),
        description.summary
    )
    .expect("writing help to a String cannot fail");
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
            write_indented_help(&mut output, CAMP_MESSAGE_SEND_TO_HELP);
        }
        if description.name == "camp.message.send" && argument.field == "publicOnly" {
            write_indented_help(&mut output, CAMP_MESSAGE_SEND_PUBLIC_ONLY_HELP);
        }
        if description.name == "team.gather" && argument.field == "to" {
            writeln!(
                output,
                "      Canonical member target; repeat as needed. Duplicate targets are frozen once."
            )
            .expect("writing help to a String cannot fail");
        }
        if description.name == "camp.message.send" && argument.field == "mentionUser" {
            write_indented_help(&mut output, CAMP_MESSAGE_SEND_TO_PRINCIPAL_HELP);
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
    let examples = operation_help_examples(&description.name);
    writeln!(output, "\nExamples:").expect("writing help to a String cannot fail");
    for example in examples {
        writeln!(output, "  {example}").expect("writing help to a String cannot fail");
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
            "rovai camp read --mode item --message-id '<message-id>'",
            "rovai camp read --camp-id '<camp-id>' --mode item --message-id '<message-id>'",
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

    #[test]
    fn ipc_response_reader_requires_one_bounded_newline_delimited_utf8_frame() {
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(b"{\"ok\":true}\n")).unwrap(),
            r#"{"ok":true}"#
        );
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(b"{}"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
        let oversized = vec![b'x'; BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 2];
        assert_eq!(
            read_bounded_response(std::io::Cursor::new(oversized))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
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
        assert!(read_help.contains("Omit for the current Camp"));
        assert_eq!(
            parse_operation_input(
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
            operation_help_examples("camp.read"),
            [
                "rovai camp read --mode item --message-id '<message-id>'",
                "rovai camp read --camp-id '<camp-id>' --mode item --message-id '<message-id>'",
            ]
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
    #[test]
    fn connection_preflight_failure_is_predictable() {
        let socket = std::path::PathBuf::from("/tmp").join(format!(
            "rv-missing-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket.to_string_lossy().into_owned(),
        };
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test()).unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
    }

    #[cfg(unix)]
    #[test]
    fn response_loss_after_dispatch_is_indeterminate() {
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
            send_with_retry(&endpoint, &request_for_ipc_test()).unwrap_err(),
            BuiltinToolIpcFailure::OutcomeIndeterminate
        );
        server.join().unwrap();
        std::fs::remove_file(socket).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn malformed_core_response_is_a_predictable_protocol_failure() {
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
            stream.write_all(b"not-json\n").unwrap();
        });
        assert_eq!(
            send_with_retry(&endpoint, &request_for_ipc_test()).unwrap_err(),
            BuiltinToolIpcFailure::Predictable
        );
        server.join().unwrap();
        std::fs::remove_file(socket).unwrap();
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
