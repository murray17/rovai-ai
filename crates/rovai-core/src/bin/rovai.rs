use std::{
    collections::BTreeMap,
    env, fs,
    io::{BufRead, BufReader, IsTerminal, Read, Write},
    path::Path,
    process::ExitCode,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::builtin_tool_cli_output::project_envelope;
use rovai_core::builtin_tool_transport::{
    BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
    BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES, BuiltinToolArgument, BuiltinToolCliContext,
    BuiltinToolDescription, BuiltinToolIpcRequest, BuiltinToolIpcRequestBody,
    BuiltinToolIpcResponse, ROVAI_CLI_CONTEXT_ENV, builtin_tool_description,
    builtin_tool_identity_by_command,
};
use serde_json::{Map, Value, json};
use uuid::Uuid;

const CORE_TIMEOUT: Duration = Duration::from_secs(30);
const CORE_ATTEMPTS: usize = 3;

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

    let context = load_context()?;
    let auth = context.auth()?;
    let request = match args.as_slice() {
        [command, rest @ ..] if command == "send" => {
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

    let response = match send_with_retry(Path::new(&context.core_socket), &request) {
        Ok(response) => response,
        Err(BuiltinToolIpcFailure::OutcomeIndeterminate) => {
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "error": {
                        "code": "builtin_tool.outcome_indeterminate",
                        "message": "Confirm current state before acting again.",
                        "recovery": "confirm_outcome"
                    }
                }))?
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
            let projected = project_envelope(&envelope)?;
            println!("{}", serde_json::to_string(&projected)?);
            Ok(envelope_exit_code(&envelope))
        }
        BuiltinToolIpcResponse::Error { .. } => {
            print_safe_cli_error();
            Ok(2)
        }
    }
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
        let argument = argument_by_flag
            .get(flag)
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
    socket: &Path,
    request: &BuiltinToolIpcRequest,
) -> std::result::Result<BuiltinToolIpcResponse, BuiltinToolIpcFailure> {
    use std::os::unix::net::UnixStream;

    let serialized = serde_json::to_vec(request).map_err(|_| BuiltinToolIpcFailure::Predictable)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        return Err(BuiltinToolIpcFailure::Predictable);
    }
    let mut dispatch_became_indeterminate = false;
    for _attempt in 0..CORE_ATTEMPTS {
        let Ok(mut stream) = UnixStream::connect(socket) else {
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
        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        match reader.read_line(&mut response) {
            Ok(0) | Err(_) => {
                dispatch_became_indeterminate = true;
            }
            Ok(_) => match serde_json::from_str(&response) {
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

#[cfg(not(unix))]
fn send_with_retry(
    _socket: &Path,
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
        "Rovai Agent CLI\n\nOperations:\n  rovai send\n  rovai task create|get|list|update\n  rovai camp list|search|read\n  rovai history search\n  rovai memory search|read|write|propose-hearth\n\nUse '<command> --help' for concise arguments and examples. Each operation supports direct flags, JSON stdin/heredoc, or --input-file <path>."
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
    println!(
        "rovai {}\n{}\n\nInput: direct flags, JSON stdin/heredoc, or --input-file <path>\n",
        description.command.join(" "),
        description.summary
    );
    for argument in &description.arguments {
        println!(
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
        );
    }
    println!(
        "\nExample:\n  {}",
        operation_help_example(&description.name)
    );
}

fn operation_help_example(operation: &str) -> &'static str {
    match operation {
        "camp.message.send" => "rovai send --body 'Status update'",
        "team.create_task" => "rovai task create --title 'Prepare release notes'",
        "team.get_task" => "rovai task get --task-id task_123",
        "team.list_tasks" => "rovai task list --limit 10",
        "team.update_task" => {
            "rovai task update --task-id task_123 --expected-version 1 --status in_progress"
        }
        "camp.list" => "rovai camp list --limit 10",
        "camp.search" => "rovai camp search --query 'release' --limit 5",
        "camp.read" => "rovai camp read --camp-id camp_123 --mode item --message-id msg_123",
        "history.search" => "rovai history search --query 'decision' --limit 5",
        "memory.search" => "rovai memory search --query 'preferences' --limit 6",
        "memory.read" => "rovai memory read --memory-ids memory_123",
        "memory.write" => "rovai memory write --input-file memory-write.json",
        "memory.propose_hearth" => "rovai memory propose-hearth --input-file proposal.json",
        _ => "rovai --help",
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
            builtin_tool_identity_by_command("memory", "propose-hearth")
                .unwrap()
                .operation,
            "memory.propose_hearth"
        );
        assert!(builtin_tool_identity_by_command("tool", "list").is_none());
        assert!(builtin_tool_identity_by_command("tool", "describe").is_none());
    }

    #[test]
    fn public_send_help_has_no_agent_supplied_camp_scope() {
        let description = operation_help(&["send".to_string(), "--help".to_string()])
            .unwrap()
            .unwrap();
        assert!(
            description
                .arguments
                .iter()
                .all(|argument| argument.field != "campId" && argument.flag != "--camp-id")
        );
        assert!(
            parse_operation_input(
                &description,
                &["--camp-id".to_string(), "camp-legacy".to_string()]
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn connection_preflight_failure_is_predictable() {
        let socket = std::path::PathBuf::from("/tmp").join(format!(
            "rv-missing-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        assert_eq!(
            send_with_retry(&socket, &request_for_ipc_test()).unwrap_err(),
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
        let server = std::thread::spawn(move || {
            for _ in 0..CORE_ATTEMPTS {
                let (stream, _) = listener.accept().unwrap();
                drop(stream);
            }
        });
        assert_eq!(
            send_with_retry(&socket, &request_for_ipc_test()).unwrap_err(),
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
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.write_all(b"not-json\n").unwrap();
        });
        assert_eq!(
            send_with_retry(&socket, &request_for_ipc_test()).unwrap_err(),
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
                message: "Confirm current state before acting again.".to_string(),
                recovery: rovai_core::builtin_tool_transport::BuiltinToolRecovery::ConfirmOutcome,
                details: None,
            },
        )
        .unwrap();
        assert_eq!(envelope_exit_code(&envelope), 3);
    }
}
