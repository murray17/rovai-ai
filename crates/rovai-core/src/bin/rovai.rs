use std::{
    collections::BTreeMap,
    env, fs,
    io::{BufRead, BufReader, IsTerminal, Read, Write},
    path::Path,
    process::ExitCode,
    time::Duration,
};

use anyhow::{Context, Result, bail};
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
        Err(error) => {
            let diagnostic = json!({
                "kind": "cli_error",
                "code": "builtin_tool.cli_error",
                "message": format!("{error:#}"),
            });
            eprintln!(
                "{}",
                serde_json::to_string(&diagnostic)
                    .unwrap_or_else(|_| "Built-in Tool CLI failed".to_string())
            );
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

    let context = load_context()?;
    let auth = context.auth()?;
    let request = match args.as_slice() {
        [group, action] if group == "tool" && action == "list" => BuiltinToolIpcRequest {
            ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
            auth,
            body: BuiltinToolIpcRequestBody::List,
        },
        [group, action, operation]
            if group == "tool" && action == "describe" && operation != "--help" =>
        {
            BuiltinToolIpcRequest {
                ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                auth,
                body: BuiltinToolIpcRequestBody::Describe {
                    operation: operation.clone(),
                },
            }
        }
        [command, rest @ ..] if command == "send" => {
            let identity = builtin_tool_identity_by_command(command, "")
                .with_context(|| format!("unknown Rovai command: rovai {command}"))?;
            let description = builtin_tool_description(identity.operation)?;
            if rest == ["--help"] {
                print_operation_help(&description);
                return Ok(0);
            }
            let input = parse_operation_input(&description, rest)?;
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
            if rest == ["--help"] {
                print_operation_help(&description);
                return Ok(0);
            }
            let input = parse_operation_input(&description, rest)?;
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
        Err(_error) => {
            let (operation, request_id) = match &request.body {
                BuiltinToolIpcRequestBody::Invoke {
                    operation,
                    request_id,
                    ..
                } => (Some(operation.as_str()), Some(request_id.as_str())),
                _ => (None, None),
            };
            let diagnostic = json!({
                "kind": "transport_error",
                "outcome": "indeterminate",
                "operation": operation,
                "requestId": request_id,
                "message": "结果待确认：Rovai Core response could not be established.",
            });
            eprintln!("{}", serde_json::to_string(&diagnostic)?);
            return Ok(3);
        }
    };

    match response {
        BuiltinToolIpcResponse::Catalog { catalog } => {
            println!("{}", serde_json::to_string(&catalog)?);
            Ok(0)
        }
        BuiltinToolIpcResponse::Description { description } => {
            println!("{}", serde_json::to_string(&description)?);
            Ok(0)
        }
        BuiltinToolIpcResponse::Envelope { envelope } => {
            envelope.validate()?;
            println!("{}", serde_json::to_string(&envelope)?);
            Ok(if envelope.ok { 0 } else { 1 })
        }
        BuiltinToolIpcResponse::Error { error } => {
            eprintln!(
                "{}",
                serde_json::to_string(&json!({
                    "kind": "ipc_error",
                    "code": error.code,
                    "message": error.message,
                }))?
            );
            Ok(2)
        }
    }
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
) -> Result<BuiltinToolIpcResponse> {
    use std::os::unix::net::UnixStream;

    let serialized = serde_json::to_vec(request)?;
    if serialized.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES {
        bail!("Built-in Tool request exceeds 1 MiB");
    }
    let mut last_error = None;
    for _attempt in 0..CORE_ATTEMPTS {
        let result = (|| -> Result<BuiltinToolIpcResponse> {
            let mut stream = UnixStream::connect(socket)
                .with_context(|| format!("failed to connect to {}", socket.display()))?;
            stream.set_read_timeout(Some(CORE_TIMEOUT))?;
            stream.set_write_timeout(Some(CORE_TIMEOUT))?;
            stream.write_all(&serialized)?;
            stream.write_all(b"\n")?;
            stream.flush()?;
            let mut reader = BufReader::new(stream);
            let mut response = String::new();
            let read = reader.read_line(&mut response)?;
            if read == 0 {
                bail!("Rovai Core closed the Built-in Tool socket without a response");
            }
            serde_json::from_str(&response).context("Rovai Core returned an invalid response")
        })();
        match result {
            Ok(response) => return Ok(response),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Built-in Tool IPC failed")))
}

#[cfg(not(unix))]
fn send_with_retry(
    _socket: &Path,
    _request: &BuiltinToolIpcRequest,
) -> Result<BuiltinToolIpcResponse> {
    bail!("Built-in Tool IPC requires Unix domain sockets")
}

fn print_root_help() {
    println!(
        "Rovai Agent CLI\n\nDiscovery:\n  rovai tool list\n  rovai tool describe <canonical-operation>\n\nOperations:\n  rovai send\n  rovai task create|list|update\n  rovai camp list|search|read\n  rovai history search\n  rovai memory search|read|write|propose-hearth\n\nEach operation supports direct flags, JSON stdin/heredoc, or --input-file <path>."
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use rovai_core::builtin_tool_transport::builtin_tool_description;

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
    }
}
