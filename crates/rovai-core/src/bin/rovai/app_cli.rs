use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    fs::OpenOptions,
    io::{Write as _, stdout},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Utc};
use rovai_core::{
    builtin_tool_transport::LocalIpcEndpoint, platform::local_ipc::LocalIpcClientStream,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use uuid::Uuid;

const AUTOMATION_CONTRACT_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(300);
const SETTLEMENT_GRACE: Duration = Duration::from_secs(5);
const CONTEXT_ENV: &str = "ROVAI_APP_AUTOMATION_CONTEXT";
const ADAPTER_KINDS: [&str; 12] = [
    "codex-cli",
    "opencode-cli",
    "copilot-cli",
    "claude-code-cli",
    "kiro-cli",
    "qoder-cli",
    "codebuddy-cli",
    "qwen-code",
    "trae-cn-cli",
    "cursor-agent",
    "kimi-code-cli",
    "antigravity-app",
];

#[derive(Debug)]
struct CliError {
    code: String,
    message: String,
    details: Option<Value>,
    exit_code: u8,
}

impl CliError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
            exit_code: 2,
        }
    }

    fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    fn with_exit_code(mut self, exit_code: u8) -> Self {
        self.exit_code = exit_code;
        self
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CliError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationContext {
    contract_version: u32,
    instance_id: String,
    pid: u32,
    endpoint: LocalIpcEndpoint,
    credential: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationRequest<'a> {
    contract_version: u32,
    instance_id: &'a str,
    credential: &'a str,
    request_id: String,
    operation: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationResponse {
    request_id: Option<String>,
    ok: bool,
    result: Option<Value>,
    error: Option<AutomationResponseError>,
}

#[derive(Debug, Deserialize)]
struct AutomationResponseError {
    code: String,
    message: String,
    #[serde(default)]
    details: Option<Value>,
}

#[derive(Debug, Default)]
struct Flags {
    values: BTreeMap<String, Vec<String>>,
    switches: BTreeSet<String>,
}

impl Flags {
    fn parse(args: &[String]) -> std::result::Result<Self, CliError> {
        let mut flags = Self::default();
        let mut index = 0;
        while index < args.len() {
            let token = &args[index];
            if !token.starts_with("--") || token.len() == 2 {
                return Err(CliError::new(
                    "automation_invalid_input",
                    format!("Unexpected argument: {token}"),
                ));
            }
            let key = token[2..].to_string();
            if index + 1 < args.len() && !args[index + 1].starts_with("--") {
                flags
                    .values
                    .entry(key)
                    .or_default()
                    .push(args[index + 1].clone());
                index += 2;
            } else {
                flags.switches.insert(key);
                index += 1;
            }
        }
        Ok(flags)
    }

    fn validate(&self, allowed_values: &[&str], allowed_switches: &[&str]) -> Result<(), CliError> {
        for key in self.values.keys() {
            if !allowed_values.contains(&key.as_str()) {
                return Err(CliError::new(
                    "automation_invalid_input",
                    format!("Unsupported option: --{key}"),
                ));
            }
        }
        for key in &self.switches {
            if !allowed_switches.contains(&key.as_str()) {
                return Err(CliError::new(
                    "automation_invalid_input",
                    format!("Unsupported switch: --{key}"),
                ));
            }
        }
        Ok(())
    }

    fn one(&self, key: &str) -> Result<Option<&str>, CliError> {
        let Some(values) = self.values.get(key) else {
            return Ok(None);
        };
        if values.len() != 1 {
            return Err(CliError::new(
                "automation_invalid_input",
                format!("--{key} may be supplied once"),
            ));
        }
        Ok(values.first().map(String::as_str))
    }

    fn required(&self, key: &str) -> Result<&str, CliError> {
        self.one(key)?.ok_or_else(|| {
            CliError::new(
                "automation_invalid_input",
                format!("Missing required option: --{key}"),
            )
        })
    }

    fn repeated(&self, key: &str) -> Vec<String> {
        self.values.get(key).cloned().unwrap_or_default()
    }

    fn has(&self, key: &str) -> bool {
        self.switches.contains(key)
    }
}

pub async fn run(args: &[String]) -> Result<u8> {
    match execute(args).await {
        Ok(code) => Ok(code),
        Err(error) => {
            let error = error
                .downcast_ref::<CliError>()
                .map(|error| {
                    (
                        error.code.clone(),
                        error.message.clone(),
                        error.details.clone(),
                        error.exit_code,
                    )
                })
                .unwrap_or_else(|| {
                    (
                        "automation_cli_error".to_string(),
                        "The User Automation command could not be completed.".to_string(),
                        None,
                        2,
                    )
                });
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "error": { "code": error.0, "message": error.1, "details": error.2 }
                }))?
            );
            Ok(error.3)
        }
    }
}

async fn execute(args: &[String]) -> Result<u8> {
    if args.is_empty() || args == ["--help"] {
        print_help();
        return Ok(0);
    }
    let (command, action, rest) = match args {
        [command, namespace, member_action, rest @ ..]
            if command == "member"
                && namespace == "runtime"
                && matches!(member_action.as_str(), "set" | "clear") =>
        {
            (
                command.as_str(),
                Some(match member_action.as_str() {
                    "set" => "runtime.set",
                    "clear" => "runtime.clear",
                    _ => unreachable!(),
                }),
                rest,
            )
        }
        [command, action, rest @ ..]
            if matches!(
                command.as_str(),
                "runtime" | "member" | "camp" | "agent-run" | "trial"
            ) =>
        {
            (command.as_str(), Some(action.as_str()), rest)
        }
        [command, rest @ ..] => (command.as_str(), None, rest),
        [] => unreachable!(),
    };
    if rest == ["--help"] {
        print_command_help(command, action)?;
        return Ok(0);
    }
    let flags = Flags::parse(rest).map_err(anyhow::Error::new)?;
    let exit_code = match (command, action) {
        ("status", None) => {
            flags.validate(&[], &["json"]).map_err(anyhow::Error::new)?;
            print_json(&invoke("status", json!({})).await?)?;
            0
        }
        ("runtime", Some("list")) => {
            runtime_list(&flags).await?;
            0
        }
        ("runtime", Some("check")) => {
            runtime_check(&flags).await?;
            0
        }
        ("runtime", Some("models")) => {
            runtime_models(&flags).await?;
            0
        }
        ("member", Some("list")) => {
            member_list(&flags).await?;
            0
        }
        ("member", Some("show")) => {
            member_show(&flags).await?;
            0
        }
        ("member", Some("create")) => member_create(&flags).await?,
        ("member", Some("runtime.set")) => member_runtime_set(&flags).await?,
        ("member", Some("runtime.clear")) => member_runtime_clear(&flags).await?,
        ("camp", Some("create")) => camp_create(&flags).await?,
        ("camp", Some("send")) => camp_send(&flags).await?,
        ("camp", Some("open")) => {
            camp_open(&flags).await?;
            0
        }
        ("agent-run", Some("show")) => {
            agent_run_show(&flags).await?;
            0
        }
        ("agent-run", Some("watch")) => agent_run_watch(&flags).await?,
        ("agent-run", Some("export")) => {
            agent_run_export(&flags).await?;
            0
        }
        ("agent-run", Some("cancel")) => agent_run_cancel(&flags).await?,
        ("trial", Some("run")) => trial_run(&flags).await?,
        _ => {
            return Err(CliError::new(
                "automation_invalid_input",
                "Unknown `rovai app` command; run `rovai app --help`.",
            )
            .into());
        }
    };
    Ok(exit_code)
}

fn print_help() {
    println!(
        "Rovai User Automation CLI\n\nOperations:\n  rovai app status\n  rovai app runtime list|check|models\n  rovai app member list|show|create\n  rovai app member runtime set|clear\n  rovai app camp create|send|open\n  rovai app agent-run show|watch|export|cancel\n  rovai app trial run\n\nThe Desktop App must already be running. V1 never launches it automatically."
    );
}

fn print_command_help(command: &str, action: Option<&str>) -> Result<()> {
    let usage = match (command, action) {
        ("status", None) => "rovai app status [--json]",
        ("runtime", Some("list")) => "rovai app runtime list [--ready-only] [--json]",
        ("runtime", Some("check")) => "rovai app runtime check --adapter <adapter> [--json]",
        ("runtime", Some("models")) => "rovai app runtime models --adapter <adapter> [--json]",
        ("member", Some("list")) => "rovai app member list [--runtime <adapter>] [--json]",
        ("member", Some("show")) => "rovai app member show --agent-id <id> [--json]",
        ("member", Some("create")) => {
            "rovai app member create --display-name <name> [--avatar-ref <ref>] [--team-role <role>] [--professional-responsibilities <text>] [--personality-trait <trait> ...] [--working-principles <text>] [--growth-topic <text>] [--command-id <id>] [--json]"
        }
        ("member", Some("runtime.set")) => {
            "rovai app member runtime set --agent-id <id> --expected-version <version> --adapter <adapter> (--runtime-default | --model <model-id>) --permission-schema-version <version> --permissions-json <object> [--model-options-json <object>] [--command-id <id>] [--json]"
        }
        ("member", Some("runtime.clear")) => {
            "rovai app member runtime clear --agent-id <id> --expected-version <version> [--command-id <id>] [--json]"
        }
        ("camp", Some("create")) => {
            "rovai app camp create [--name <name>] (--workspace <path> | --quick-chat) --member <id> [--member <id> ...] [--lead <id>] [--json]"
        }
        ("camp", Some("send")) => {
            "rovai app camp send --camp-id <id> --agent-id <id> (--body <text> | --body-file <path>) [--timeout <duration> | explicit budget] [--json]"
        }
        ("camp", Some("open")) => "rovai app camp open --camp-id <id> [--json]",
        ("agent-run", Some("show")) => "rovai app agent-run show --agent-run-id <id> [--json]",
        ("agent-run", Some("watch")) => "rovai app agent-run watch --agent-run-id <id> [--jsonl]",
        ("agent-run", Some("export")) => {
            "rovai app agent-run export --agent-run-id <id> --output <directory> [--json]"
        }
        ("agent-run", Some("cancel")) => "rovai app agent-run cancel --agent-run-id <id> [--json]",
        ("trial", Some("run")) => {
            "rovai app trial run --agent-id <id> --workspace <directory> --task-file <file> [--name <name>] [--timeout 30m] [--wait | --no-wait] [--export <directory>] [--open] [--json]"
        }
        _ => {
            return Err(CliError::new(
                "automation_invalid_input",
                "Unknown `rovai app` command; run `rovai app --help`.",
            )
            .into());
        }
    };
    println!("Usage: {usage}\n\nThe Desktop App must already be running.");
    Ok(())
}

async fn runtime_list(flags: &Flags) -> Result<()> {
    flags
        .validate(&[], &["ready-only", "json"])
        .map_err(anyhow::Error::new)?;
    print_json(
        &invoke(
            "runtime.list",
            json!({ "readyOnly": flags.has("ready-only") }),
        )
        .await?,
    )
}

async fn runtime_check(flags: &Flags) -> Result<()> {
    flags
        .validate(&["adapter"], &["json"])
        .map_err(anyhow::Error::new)?;
    print_json(
        &invoke(
            "runtime.check",
            json!({ "adapterKind": adapter_kind(flags, "adapter")? }),
        )
        .await?,
    )
}

async fn runtime_models(flags: &Flags) -> Result<()> {
    flags
        .validate(&["adapter"], &["json"])
        .map_err(anyhow::Error::new)?;
    print_json(
        &invoke(
            "runtime.models",
            json!({ "adapterKind": adapter_kind(flags, "adapter")? }),
        )
        .await?,
    )
}

async fn member_list(flags: &Flags) -> Result<()> {
    flags
        .validate(&["runtime"], &["json"])
        .map_err(anyhow::Error::new)?;
    let mut members = invoke("member.list", json!({})).await?;
    if let Some(runtime) = flags.one("runtime").map_err(anyhow::Error::new)? {
        let filtered = members
            .as_array()
            .context("Member list response is invalid")?
            .iter()
            .filter(|member| {
                member
                    .pointer("/runtimeConfiguration/adapterKind")
                    .and_then(Value::as_str)
                    == Some(runtime)
            })
            .cloned()
            .collect();
        members = Value::Array(filtered);
    }
    print_json(&members)
}

async fn member_show(flags: &Flags) -> Result<()> {
    flags
        .validate(&["agent-id"], &["json"])
        .map_err(anyhow::Error::new)?;
    print_json(
        &invoke(
            "member.show",
            json!({ "agentId": flags.required("agent-id").map_err(anyhow::Error::new)? }),
        )
        .await?,
    )
}

fn member_create_params(flags: &Flags) -> Result<Value> {
    flags
        .validate(
            &[
                "display-name",
                "avatar-ref",
                "team-role",
                "professional-responsibilities",
                "personality-trait",
                "working-principles",
                "growth-topic",
                "command-id",
            ],
            &["json"],
        )
        .map_err(anyhow::Error::new)?;
    Ok(json!({
        "commandId": flags.one("command-id").map_err(anyhow::Error::new)?
            .map(str::to_string).unwrap_or_else(command_id),
        "displayName": flags.required("display-name").map_err(anyhow::Error::new)?,
        "avatarRef": flags.one("avatar-ref").map_err(anyhow::Error::new)?,
        "teamRole": flags.one("team-role").map_err(anyhow::Error::new)?.unwrap_or(""),
        "professionalResponsibilities": flags.one("professional-responsibilities")
            .map_err(anyhow::Error::new)?.unwrap_or(""),
        "personalityTraits": flags.repeated("personality-trait"),
        "workingPrinciples": flags.one("working-principles")
            .map_err(anyhow::Error::new)?.unwrap_or(""),
        "growthTopic": flags.one("growth-topic").map_err(anyhow::Error::new)?.unwrap_or("")
    }))
}

async fn member_create(flags: &Flags) -> Result<u8> {
    let result = invoke("member.create", member_create_params(flags)?).await?;
    print_json(&result)?;
    Ok(command_result_exit_code(&result))
}

fn member_runtime_set_params(flags: &Flags) -> Result<Value> {
    flags
        .validate(
            &[
                "agent-id",
                "expected-version",
                "adapter",
                "model",
                "model-options-json",
                "permission-schema-version",
                "permissions-json",
                "command-id",
            ],
            &["runtime-default", "json"],
        )
        .map_err(anyhow::Error::new)?;
    let model_id = flags.one("model").map_err(anyhow::Error::new)?;
    if flags.has("runtime-default") == model_id.is_some() {
        return Err(CliError::new(
            "automation_invalid_input",
            "Choose exactly one of --runtime-default or --model",
        )
        .into());
    }
    let model_options = flags
        .one("model-options-json")
        .map_err(anyhow::Error::new)?;
    if model_options.is_some() && model_id.is_none() {
        return Err(CliError::new(
            "automation_invalid_input",
            "--model-options-json requires --model",
        )
        .into());
    }
    let model = match model_id {
        Some(model_id) => json!({
            "mode": "explicit",
            "modelId": model_id,
            "options": model_options
                .map(|value| parse_json_object(value, "model-options-json"))
                .transpose()?
                .unwrap_or_else(|| json!({}))
        }),
        None => json!({ "mode": "runtime_default" }),
    };
    let adapter_kind = adapter_kind(flags, "adapter")?;
    Ok(json!({
        "commandId": flags.one("command-id").map_err(anyhow::Error::new)?
            .map(str::to_string).unwrap_or_else(command_id),
        "agentId": flags.required("agent-id").map_err(anyhow::Error::new)?,
        "expectedVersion": parse_positive_i64(
            flags.required("expected-version").map_err(anyhow::Error::new)?,
            "expected-version"
        )?,
        "adapterKind": adapter_kind,
        "model": model,
        "permissions": {
            "adapterKind": adapter_kind,
            "schemaVersion": parse_positive_i64(
                flags.required("permission-schema-version").map_err(anyhow::Error::new)?,
                "permission-schema-version"
            )?,
            "values": parse_json_object(
                flags.required("permissions-json").map_err(anyhow::Error::new)?,
                "permissions-json"
            )?
        }
    }))
}

async fn member_runtime_set(flags: &Flags) -> Result<u8> {
    let result = invoke("member.runtime.set", member_runtime_set_params(flags)?).await?;
    print_json(&result)?;
    Ok(command_result_exit_code(&result))
}

async fn member_runtime_clear(flags: &Flags) -> Result<u8> {
    flags
        .validate(&["agent-id", "expected-version", "command-id"], &["json"])
        .map_err(anyhow::Error::new)?;
    let result = invoke(
        "member.runtime.clear",
        json!({
            "commandId": flags.one("command-id").map_err(anyhow::Error::new)?
                .map(str::to_string).unwrap_or_else(command_id),
            "agentId": flags.required("agent-id").map_err(anyhow::Error::new)?,
            "expectedVersion": parse_positive_i64(
                flags.required("expected-version").map_err(anyhow::Error::new)?,
                "expected-version"
            )?
        }),
    )
    .await?;
    print_json(&result)?;
    Ok(command_result_exit_code(&result))
}

fn camp_create_params(
    command_id: String,
    name: Option<String>,
    workspace: Option<Value>,
    member_agent_ids: Vec<String>,
    default_lead_agent_id: String,
) -> Value {
    json!({
        "commandId": command_id,
        "name": name,
        "workspace": workspace,
        "memberAgentIds": member_agent_ids,
        "defaultLeadAgentId": default_lead_agent_id,
        "collaborationMode": "peer",
        "activationState": "active"
    })
}

async fn camp_create(flags: &Flags) -> Result<u8> {
    flags
        .validate(
            &["name", "workspace", "member", "lead", "command-id"],
            &["quick-chat", "json"],
        )
        .map_err(anyhow::Error::new)?;
    let members = flags.repeated("member");
    if members.is_empty() {
        return Err(CliError::new(
            "automation_invalid_input",
            "At least one --member is required",
        )
        .into());
    }
    let quick_chat = flags.has("quick-chat");
    let workspace = flags.one("workspace").map_err(anyhow::Error::new)?;
    if quick_chat == workspace.is_some() {
        return Err(CliError::new(
            "automation_invalid_input",
            "Choose exactly one of --workspace or --quick-chat",
        )
        .into());
    }
    let lead = flags
        .one("lead")
        .map_err(anyhow::Error::new)?
        .unwrap_or(&members[0])
        .to_string();
    if !members.iter().any(|member| member == &lead) {
        return Err(
            CliError::new("automation_invalid_input", "--lead must also be a --member").into(),
        );
    }
    let params = camp_create_params(
        flags
            .one("command-id")
            .map_err(anyhow::Error::new)?
            .map(str::to_string)
            .unwrap_or_else(command_id),
        flags
            .one("name")
            .map_err(anyhow::Error::new)?
            .map(str::to_string),
        workspace.map(|project_path| json!({ "projectPath": project_path })),
        members,
        lead,
    );
    let result = invoke("camp.create", params).await?;
    print_json(&result)?;
    Ok(command_result_exit_code(&result))
}

async fn camp_send(flags: &Flags) -> Result<u8> {
    flags
        .validate(
            &[
                "camp-id",
                "camp",
                "agent-id",
                "body",
                "body-file",
                "command-id",
                "timeout",
                "elapsed-seconds",
                "max-agent-run-responsibilities",
                "max-accepted-a2a",
            ],
            &["json"],
        )
        .map_err(anyhow::Error::new)?;
    let camp_id = alias_required(flags, "camp-id", "camp")?;
    let body = read_body(flags, "body", &["body-file"])?;
    let execution_budget = execution_budget_from_flags(flags, false)?;
    let result = invoke(
        "camp.send",
        json!({
            "commandId": flags.one("command-id").map_err(anyhow::Error::new)?
                .map(str::to_string).unwrap_or_else(command_id),
            "campId": camp_id,
            "agentId": flags.required("agent-id").map_err(anyhow::Error::new)?,
            "body": body,
            "executionBudget": execution_budget
        }),
    )
    .await?;
    print_json(&result)?;
    Ok(launch_result_exit_code(&result))
}

async fn camp_open(flags: &Flags) -> Result<()> {
    flags
        .validate(&["camp-id", "camp"], &["json"])
        .map_err(anyhow::Error::new)?;
    print_json(
        &invoke(
            "camp.open",
            json!({ "campId": alias_required(flags, "camp-id", "camp")? }),
        )
        .await?,
    )
}

async fn agent_run_show(flags: &Flags) -> Result<()> {
    flags
        .validate(&["agent-run-id"], &["json"])
        .map_err(anyhow::Error::new)?;
    print_json(&diagnostic(flags.required("agent-run-id").map_err(anyhow::Error::new)?).await?)
}

async fn agent_run_watch(flags: &Flags) -> Result<u8> {
    flags
        .validate(&["agent-run-id"], &["jsonl"])
        .map_err(anyhow::Error::new)?;
    let agent_run_id = flags.required("agent-run-id").map_err(anyhow::Error::new)?;
    let initial = diagnostic(agent_run_id).await?;
    let deadline = Utc::now() + chrono::Duration::days(1);
    let outcome = watch_until_terminal(agent_run_id, &initial, deadline, true).await?;
    if !outcome.terminal {
        return Err(CliError::new(
            "trial_settlement_incomplete",
            "The AgentRun did not settle before the watch safety deadline.",
        )
        .with_exit_code(3)
        .into());
    }
    Ok(terminal_exit_code(&outcome.diagnostic))
}

async fn agent_run_export(flags: &Flags) -> Result<()> {
    flags
        .validate(&["agent-run-id", "output", "export"], &["json"])
        .map_err(anyhow::Error::new)?;
    let agent_run_id = flags.required("agent-run-id").map_err(anyhow::Error::new)?;
    let path = PathBuf::from(alias_required(flags, "output", "export")?);
    reserve_private_directory(&path)?;
    let diagnostic = diagnostic(agent_run_id).await?;
    let captured = capture_available(agent_run_id, &diagnostic).await?;
    write_agent_run_bundle(&path, &diagnostic, &captured)?;
    print_json(&json!({
        "agentRunId": agent_run_id,
        "resultDirectory": absolute_path(&path)?,
        "sensitiveLocalMaterial": true
    }))
}

async fn agent_run_cancel(flags: &Flags) -> Result<u8> {
    flags
        .validate(&["agent-run-id", "command-id"], &["json"])
        .map_err(anyhow::Error::new)?;
    let result = invoke(
        "agentRun.cancel",
        json!({
            "agentRunId": flags.required("agent-run-id").map_err(anyhow::Error::new)?,
            "commandId": flags.one("command-id").map_err(anyhow::Error::new)?
                .map(str::to_string).unwrap_or_else(command_id)
        }),
    )
    .await?;
    print_json(&result)?;
    Ok(command_result_exit_code(&result))
}

async fn trial_run(flags: &Flags) -> Result<u8> {
    flags
        .validate(
            &[
                "agent-id",
                "name",
                "workspace",
                "task-file",
                "timeout",
                "export",
            ],
            &["wait", "no-wait", "open", "json"],
        )
        .map_err(anyhow::Error::new)?;
    if flags.has("wait") && flags.has("no-wait") {
        return Err(CliError::new(
            "automation_invalid_input",
            "Choose at most one of --wait and --no-wait",
        )
        .into());
    }
    let wait = !flags.has("no-wait");
    let agent_id = flags.required("agent-id").map_err(anyhow::Error::new)?;
    let workspace = absolute_path(Path::new(
        flags.required("workspace").map_err(anyhow::Error::new)?,
    ))?;
    let task_path = PathBuf::from(flags.required("task-file").map_err(anyhow::Error::new)?);
    let task = fs::read_to_string(&task_path)
        .with_context(|| format!("failed to read task file {}", task_path.display()))?;
    if task.trim().is_empty() {
        return Err(
            CliError::new("automation_invalid_input", "--task-file must not be empty").into(),
        );
    }
    let elapsed_seconds = parse_duration_seconds(
        flags
            .one("timeout")
            .map_err(anyhow::Error::new)?
            .unwrap_or("30m"),
    )?;
    let trial_id = format!("rvtrial_{}", Uuid::now_v7().simple());
    let create_command_id = command_id();
    let send_command_id = command_id();
    let export_path = flags
        .one("export")
        .map_err(anyhow::Error::new)?
        .map(PathBuf::from);
    if let Some(path) = &export_path
        && path.exists()
    {
        return Err(CliError::new(
            "export_path_exists",
            "The Trial export directory already exists.",
        )
        .into());
    }
    let journal_path = trial_journal_path(&trial_id)?;
    let mut journal = json!({
        "schemaVersion": 1,
        "trialId": trial_id,
        "phase": "prepared",
        "createCommandId": create_command_id,
        "sendCommandId": send_command_id,
        "exportPath": export_path.as_ref().map(|path| absolute_path(path)).transpose()?,
        "updatedAt": Utc::now().to_rfc3339(),
    });
    atomic_write_private_json(&journal_path, &journal)?;
    if let Some(path) = &export_path {
        reserve_private_directory(path)?;
    }

    let configured = invoke("member.show", json!({ "agentId": agent_id })).await?;
    let readiness = configured
        .pointer("/runtimeReadiness/status")
        .and_then(Value::as_str)
        .unwrap_or("runtime_not_configured");
    if !matches!(readiness, "ready" | "light_ready") {
        return Err(CliError::new(
            "runtime_not_ready",
            format!("Member Runtime readiness is {readiness}."),
        )
        .into());
    }
    let baseline = invoke("workspace.inspect", json!({ "path": workspace })).await?;
    let camp_name = flags
        .one("name")
        .map_err(anyhow::Error::new)?
        .map(str::to_string)
        .unwrap_or_else(|| format!("Runtime Diagnostic {trial_id}"));
    let created = invoke(
        "camp.create",
        camp_create_params(
            create_command_id,
            Some(camp_name),
            Some(json!({ "projectPath": workspace })),
            vec![agent_id.to_string()],
            agent_id.to_string(),
        ),
    )
    .await?;
    let camp_id = applied_camp_id(&created)?;
    set_journal_phase(
        &mut journal,
        "camp_created",
        Some(("campId", json!(camp_id))),
    );
    atomic_write_private_json(&journal_path, &journal)?;

    let launch = invoke(
        "camp.send",
        json!({
            "commandId": send_command_id,
            "campId": camp_id,
            "agentId": agent_id,
            "body": task,
            "executionBudget": {
                "elapsedSeconds": elapsed_seconds,
                "maxAgentRunResponsibilities": 1,
                "maxAcceptedA2a": 0
            }
        }),
    )
    .await?;
    set_journal_phase(
        &mut journal,
        "launch_recorded",
        Some(("launch", launch.clone())),
    );
    atomic_write_private_json(&journal_path, &journal)?;
    let status = launch.get("status").and_then(Value::as_str);
    if status == Some("rejected") {
        set_journal_phase(&mut journal, "launch_rejected", None);
        atomic_write_private_json(&journal_path, &journal)?;
        let result = json!({
            "trialId": trial_id,
            "trialClass": "diagnostic_trial",
            "formalQualification": false,
            "campId": camp_id,
            "launch": launch,
            "agentRunId": Value::Null,
            "journalPath": journal_path
        });
        if let Some(path) = &export_path {
            write_trial_bundle(
                path,
                &result,
                &task,
                &launch,
                &baseline,
                &configured,
                None,
                None,
            )?;
        }
        if flags.has("open") {
            let _ = invoke("camp.open", json!({ "campId": camp_id })).await?;
        }
        print_json(&result)?;
        return Ok(1);
    }
    if status != Some("dispatched") {
        return Err(CliError::new(
            "automation_contract_upgrade_required",
            "Trial launch status is not supported by Automation V1.",
        )
        .into());
    }
    let run_ids = launch
        .get("agentRunIds")
        .and_then(Value::as_array)
        .context("Trial launch has no AgentRun identities")?;
    if run_ids.len() != 1 || run_ids[0].as_str().is_none() {
        return Err(CliError::new(
            "trial_dispatch_shape_invalid",
            "A diagnostic Trial requires exactly one root AgentRun.",
        )
        .with_details(json!({
            "campId": camp_id,
            "launch": launch,
            "journalPath": journal_path
        }))
        .into());
    }
    let agent_run_id = run_ids[0].as_str().unwrap().to_string();
    set_journal_phase(
        &mut journal,
        "agent_run_identified",
        Some(("agentRunId", json!(agent_run_id))),
    );
    atomic_write_private_json(&journal_path, &journal)?;
    let mut diagnostic_view = diagnostic(&agent_run_id).await?;
    let mut captured = capture_available(&agent_run_id, &diagnostic_view).await?;
    let terminal = if wait {
        let deadline_at = launch
            .pointer("/executionBudget/deadlineAt")
            .and_then(Value::as_str)
            .context("Trial launch has no Core deadline")?;
        let deadline = DateTime::parse_from_rfc3339(deadline_at)
            .context("Trial Core deadline is invalid")?
            .with_timezone(&Utc)
            + chrono::Duration::from_std(SETTLEMENT_GRACE)?;
        let outcome =
            watch_until_terminal(&agent_run_id, &diagnostic_view, deadline, false).await?;
        captured = outcome.captured;
        diagnostic_view = outcome.diagnostic;
        if !outcome.terminal {
            set_journal_phase(&mut journal, "settlement_incomplete", None);
            atomic_write_private_json(&journal_path, &journal)?;
            let partial = json!({
                "trialId": trial_id,
                "trialClass": "diagnostic_trial",
                "formalQualification": false,
                "campId": camp_id,
                "launch": launch,
                "agentRunId": agent_run_id,
                "terminal": {
                    "status": "trial_settlement_incomplete",
                    "diagnosticView": diagnostic_view
                },
                "journalPath": journal_path
            });
            if let Some(path) = &export_path {
                write_trial_bundle(
                    path,
                    &partial,
                    &task,
                    &launch,
                    &baseline,
                    &configured,
                    Some(&diagnostic_view),
                    Some(&captured),
                )?;
            }
            if flags.has("open") {
                let _ = invoke("camp.open", json!({ "campId": camp_id })).await?;
            }
            return Err(CliError::new(
                "trial_settlement_incomplete",
                format!("Trial did not settle; campId={camp_id} agentRunId={agent_run_id}"),
            )
            .with_details(json!({
                "campId": camp_id,
                "campTurnId": launch.get("campTurnId").cloned().unwrap_or(Value::Null),
                "agentRunId": agent_run_id,
                "journalPath": journal_path,
                "resultDirectory": export_path.as_ref().map(|path| absolute_path(path)).transpose()?
            }))
            .with_exit_code(3)
            .into());
        }
        Some(json!({
            "status": diagnostic_view.get("status").cloned().unwrap_or(Value::Null),
            "diagnosticView": diagnostic_view
        }))
    } else {
        None
    };
    let mut result = json!({
        "trialId": trial_id,
        "trialClass": "diagnostic_trial",
        "formalQualification": false,
        "campId": camp_id,
        "launch": launch,
        "agentRunId": agent_run_id,
        "journalPath": journal_path
    });
    if let Some(terminal) = terminal {
        result
            .as_object_mut()
            .expect("Trial result is an object")
            .insert("terminal".to_string(), terminal);
    }
    if let Some(path) = &export_path {
        write_trial_bundle(
            path,
            &result,
            &task,
            &launch,
            &baseline,
            &configured,
            Some(&diagnostic_view),
            Some(&captured),
        )?;
    }
    set_journal_phase(&mut journal, "completed", None);
    atomic_write_private_json(&journal_path, &journal)?;
    if flags.has("open") {
        let _ = invoke("camp.open", json!({ "campId": camp_id })).await?;
    }
    let exit_code = if wait {
        terminal_exit_code(&diagnostic_view)
    } else {
        0
    };
    print_json(&result)?;
    Ok(exit_code)
}

#[derive(Debug, Default, Clone)]
struct CapturedWatch {
    items: Vec<Value>,
    evidence: Vec<Value>,
    domain_cursor: i64,
    evidence_cursor: i64,
    ordinal: i64,
}

struct WatchOutcome {
    terminal: bool,
    diagnostic: Value,
    captured: CapturedWatch,
}

async fn watch_until_terminal(
    agent_run_id: &str,
    initial: &Value,
    deadline: DateTime<Utc>,
    print_items: bool,
) -> Result<WatchOutcome> {
    let mut diagnostic_view = initial.clone();
    let mut captured = CapturedWatch::default();
    loop {
        capture_cycle(agent_run_id, &diagnostic_view, &mut captured, print_items).await?;
        diagnostic_view = diagnostic(agent_run_id).await?;
        if terminal_status(&diagnostic_view) {
            capture_cycle(agent_run_id, &diagnostic_view, &mut captured, print_items).await?;
            diagnostic_view = diagnostic(agent_run_id).await?;
            return Ok(WatchOutcome {
                terminal: terminal_status(&diagnostic_view),
                diagnostic: diagnostic_view,
                captured,
            });
        }
        if Utc::now() > deadline {
            return Ok(WatchOutcome {
                terminal: false,
                diagnostic: diagnostic_view,
                captured,
            });
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn capture_available(agent_run_id: &str, diagnostic_view: &Value) -> Result<CapturedWatch> {
    let mut captured = CapturedWatch::default();
    capture_cycle(agent_run_id, diagnostic_view, &mut captured, false).await?;
    Ok(captured)
}

async fn capture_cycle(
    agent_run_id: &str,
    diagnostic_view: &Value,
    captured: &mut CapturedWatch,
    print_items: bool,
) -> Result<()> {
    let camp_id = diagnostic_view
        .get("campId")
        .and_then(Value::as_str)
        .context("AgentRun diagnostic has no Camp identity")?;
    loop {
        let batch = invoke(
            "domain.events",
            json!({
                "campId": camp_id,
                "afterGlobalSequence": captured.domain_cursor,
                "limit": 500
            }),
        )
        .await?;
        let events = batch
            .get("events")
            .and_then(Value::as_array)
            .context("Domain event batch is invalid")?;
        for event in events {
            if !event_belongs_to_run(event, agent_run_id) {
                continue;
            }
            captured.ordinal += 1;
            let item = json!({
                "ordinal": captured.ordinal,
                "source": "domain",
                "globalSequence": event.get("globalSequence").cloned().unwrap_or(Value::Null),
                "eventType": event.get("eventType").cloned().unwrap_or(Value::Null),
                "event": event
            });
            emit_watch_item(&item, print_items)?;
            captured.items.push(item);
        }
        captured.domain_cursor = batch
            .get("nextGlobalSequence")
            .and_then(Value::as_i64)
            .context("Domain event batch has no next cursor")?;
        if batch.get("hasMore").and_then(Value::as_bool) != Some(true) {
            break;
        }
    }
    loop {
        let page = invoke(
            "evidence.list",
            json!({
                "campId": camp_id,
                "agentRunId": agent_run_id,
                "afterSequence": captured.evidence_cursor,
                "limit": 500
            }),
        )
        .await?;
        let evidence = page
            .get("evidence")
            .and_then(Value::as_array)
            .context("Execution Evidence page is invalid")?;
        for entry in evidence {
            captured.ordinal += 1;
            let item = json!({
                "ordinal": captured.ordinal,
                "source": "evidence",
                "evidenceSequence": entry.get("sequence").cloned().unwrap_or(Value::Null),
                "eventType": entry.get("eventType").cloned().unwrap_or(Value::Null),
                "evidence": entry
            });
            emit_watch_item(&item, print_items)?;
            captured.items.push(item);
            captured.evidence.push(entry.clone());
        }
        captured.evidence_cursor = page
            .get("nextAfterSequence")
            .and_then(Value::as_i64)
            .context("Execution Evidence page has no next cursor")?;
        if page.get("hasMore").and_then(Value::as_bool) != Some(true) {
            break;
        }
    }
    Ok(())
}

fn emit_watch_item(item: &Value, print: bool) -> Result<()> {
    if print {
        println!("{}", serde_json::to_string(item)?);
        stdout().flush()?;
    }
    Ok(())
}

fn event_belongs_to_run(event: &Value, agent_run_id: &str) -> bool {
    (event.get("entityType").and_then(Value::as_str) == Some("agent_run")
        && event.get("entityId").and_then(Value::as_str) == Some(agent_run_id))
        || event.get("sourceAgentRunId").and_then(Value::as_str) == Some(agent_run_id)
        || event.pointer("/payload/agentRunId").and_then(Value::as_str) == Some(agent_run_id)
}

fn terminal_status(diagnostic: &Value) -> bool {
    matches!(
        diagnostic.get("status").and_then(Value::as_str),
        Some("succeeded" | "failed" | "cancelled")
    )
}

fn command_result_exit_code(result: &Value) -> u8 {
    match result.get("status").and_then(Value::as_str) {
        Some("applied" | "accepted") => 0,
        Some("rejected") => 1,
        _ => 2,
    }
}

fn launch_result_exit_code(result: &Value) -> u8 {
    match result.get("status").and_then(Value::as_str) {
        Some("dispatched") => 0,
        Some("rejected") => 1,
        _ => 2,
    }
}

fn terminal_exit_code(diagnostic: &Value) -> u8 {
    match diagnostic.get("status").and_then(Value::as_str) {
        Some("succeeded") => 0,
        Some("failed" | "cancelled") => 1,
        _ => 3,
    }
}

async fn diagnostic(agent_run_id: &str) -> Result<Value> {
    invoke("agentRun.diagnostic", json!({ "agentRunId": agent_run_id })).await
}

async fn invoke(operation: &str, params: Value) -> Result<Value> {
    let context = load_automation_context()?;
    let request_id = Uuid::new_v4().to_string();
    let request = AutomationRequest {
        contract_version: AUTOMATION_CONTRACT_VERSION,
        instance_id: &context.instance_id,
        credential: &context.credential,
        request_id: request_id.clone(),
        operation,
        params,
    };
    let serialized = serde_json::to_vec(&request)?;
    if serialized.len() > MAX_FRAME_BYTES {
        return Err(CliError::new(
            "automation_frame_too_large",
            "Automation request is too large",
        )
        .into());
    }
    let mut stream = tokio::time::timeout(
        REQUEST_TIMEOUT,
        LocalIpcClientStream::connect(&context.endpoint),
    )
    .await
    .map_err(|_| CliError::new("app_not_running", "Rovai Desktop is not responding."))?
    .map_err(|_| CliError::new("app_not_running", "Rovai Desktop is not running."))?;
    tokio::time::timeout(REQUEST_TIMEOUT, async {
        stream.write_all(&serialized).await?;
        stream.write_all(b"\n").await?;
        stream.flush().await
    })
    .await
    .map_err(|_| CliError::new("automation_timeout", "Automation request timed out."))??;
    let mut reader = BufReader::new(stream);
    let mut frame = Vec::new();
    tokio::time::timeout(REQUEST_TIMEOUT, reader.read_until(b'\n', &mut frame))
        .await
        .map_err(|_| CliError::new("automation_timeout", "Automation response timed out."))??;
    if frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
        return Err(CliError::new(
            "automation_contract_upgrade_required",
            "Automation response frame is invalid.",
        )
        .into());
    }
    let response: AutomationResponse = serde_json::from_slice(&frame)?;
    if response.request_id.as_deref() != Some(request_id.as_str()) {
        return Err(CliError::new(
            "automation_contract_upgrade_required",
            "Automation response identity does not match the request.",
        )
        .into());
    }
    if response.ok {
        response.result.context("Automation response has no result")
    } else {
        let error = response.error.context("Automation response has no error")?;
        let mut mapped = CliError::new(error.code, error.message);
        mapped.details = error.details;
        Err(mapped.into())
    }
}

fn load_automation_context() -> Result<AutomationContext> {
    let path = env::var_os(CONTEXT_ENV)
        .map(PathBuf::from)
        .or_else(|| {
            dirs::data_dir().map(|root| {
                root.join("Rovai AI")
                    .join("automation-v1")
                    .join("connection-v1.json")
            })
        })
        .ok_or_else(|| CliError::new("app_not_running", "Rovai Desktop is not running."))?;
    let raw = fs::read(&path)
        .map_err(|_| CliError::new("app_not_running", "Rovai Desktop is not running."))?;
    let context: AutomationContext = serde_json::from_slice(&raw).map_err(|_| {
        CliError::new(
            "automation_context_invalid",
            "The Rovai Desktop Automation context is invalid.",
        )
    })?;
    if context.contract_version != AUTOMATION_CONTRACT_VERSION
        || context.instance_id.trim().is_empty()
        || context.pid == 0
        || context.credential.len() < 32
    {
        return Err(CliError::new(
            "automation_contract_upgrade_required",
            "The running App uses an unsupported Automation contract.",
        )
        .into());
    }
    context.endpoint.validate()?;
    Ok(context)
}

fn execution_budget_from_flags(flags: &Flags, required: bool) -> Result<Value> {
    let timeout = flags.one("timeout").map_err(anyhow::Error::new)?;
    let elapsed = flags.one("elapsed-seconds").map_err(anyhow::Error::new)?;
    if timeout.is_some() && elapsed.is_some() {
        return Err(CliError::new(
            "automation_invalid_input",
            "Choose one of --timeout or --elapsed-seconds",
        )
        .into());
    }
    let has_any = timeout.is_some()
        || elapsed.is_some()
        || flags
            .one("max-agent-run-responsibilities")
            .map_err(anyhow::Error::new)?
            .is_some()
        || flags
            .one("max-accepted-a2a")
            .map_err(anyhow::Error::new)?
            .is_some();
    if !has_any && !required {
        return Ok(Value::Null);
    }
    let elapsed_seconds = match (timeout, elapsed) {
        (Some(value), None) => parse_duration_seconds(value)?,
        (None, Some(value)) => parse_positive_i64(value, "elapsed-seconds")?,
        (None, None) => {
            return Err(CliError::new(
                "automation_invalid_input",
                "Execution Budget requires --timeout or --elapsed-seconds",
            )
            .into());
        }
        _ => unreachable!(),
    };
    Ok(json!({
        "elapsedSeconds": elapsed_seconds,
        "maxAgentRunResponsibilities": flags.one("max-agent-run-responsibilities")
            .map_err(anyhow::Error::new)?.map(|value| parse_positive_i64(value, "max-agent-run-responsibilities"))
            .transpose()?.unwrap_or(1),
        "maxAcceptedA2a": flags.one("max-accepted-a2a")
            .map_err(anyhow::Error::new)?.map(|value| parse_nonnegative_i64(value, "max-accepted-a2a"))
            .transpose()?.unwrap_or(0)
    }))
}

fn parse_duration_seconds(value: &str) -> Result<i64> {
    let (digits, multiplier) = match value.chars().last() {
        Some('s') => (&value[..value.len() - 1], 1_i64),
        Some('m') => (&value[..value.len() - 1], 60_i64),
        Some('h') => (&value[..value.len() - 1], 3_600_i64),
        Some('d') => (&value[..value.len() - 1], 86_400_i64),
        _ => (value, 1_i64),
    };
    let amount = parse_positive_i64(digits, "timeout")?;
    amount
        .checked_mul(multiplier)
        .filter(|seconds| *seconds <= 86_400)
        .ok_or_else(|| {
            CliError::new("automation_invalid_input", "--timeout must be at most 24h").into()
        })
}

fn parse_positive_i64(value: &str, label: &str) -> Result<i64> {
    let parsed = value.parse::<i64>().map_err(|_| {
        CliError::new(
            "automation_invalid_input",
            format!("--{label} must be an integer"),
        )
    })?;
    if parsed < 1 {
        return Err(CliError::new(
            "automation_invalid_input",
            format!("--{label} must be positive"),
        )
        .into());
    }
    Ok(parsed)
}

fn parse_nonnegative_i64(value: &str, label: &str) -> Result<i64> {
    let parsed = value.parse::<i64>().map_err(|_| {
        CliError::new(
            "automation_invalid_input",
            format!("--{label} must be an integer"),
        )
    })?;
    if parsed < 0 {
        return Err(CliError::new(
            "automation_invalid_input",
            format!("--{label} must not be negative"),
        )
        .into());
    }
    Ok(parsed)
}

fn adapter_kind<'a>(flags: &'a Flags, key: &str) -> Result<&'a str> {
    let value = flags.required(key).map_err(anyhow::Error::new)?;
    if !ADAPTER_KINDS.contains(&value) {
        return Err(CliError::new(
            "automation_invalid_input",
            format!("--{key} is not a supported Runtime"),
        )
        .into());
    }
    Ok(value)
}

fn parse_json_object(value: &str, label: &str) -> Result<Value> {
    let parsed: Value = serde_json::from_str(value).map_err(|_| {
        CliError::new(
            "automation_invalid_input",
            format!("--{label} must be a valid JSON object"),
        )
    })?;
    if !parsed.is_object() {
        return Err(CliError::new(
            "automation_invalid_input",
            format!("--{label} must be a JSON object"),
        )
        .into());
    }
    Ok(parsed)
}

fn read_body(flags: &Flags, inline: &str, files: &[&str]) -> Result<String> {
    let inline_value = flags.one(inline).map_err(anyhow::Error::new)?;
    let mut file_values = Vec::new();
    for key in files {
        if let Some(value) = flags.one(key).map_err(anyhow::Error::new)? {
            file_values.push((*key, value));
        }
    }
    if usize::from(inline_value.is_some()) + file_values.len() != 1 {
        return Err(CliError::new(
            "automation_invalid_input",
            "Choose exactly one inline body or body file.",
        )
        .into());
    }
    let body = if let Some(value) = inline_value {
        value.to_string()
    } else {
        fs::read_to_string(file_values[0].1)
            .with_context(|| format!("failed to read --{}", file_values[0].0))?
    };
    if body.trim().is_empty() {
        return Err(
            CliError::new("automation_invalid_input", "Message body must not be empty").into(),
        );
    }
    Ok(body)
}

fn alias_required<'a>(flags: &'a Flags, first: &str, second: &str) -> Result<&'a str> {
    let first_value = flags.one(first).map_err(anyhow::Error::new)?;
    let second_value = flags.one(second).map_err(anyhow::Error::new)?;
    match (first_value, second_value) {
        (Some(value), None) | (None, Some(value)) => Ok(value),
        _ => Err(CliError::new(
            "automation_invalid_input",
            format!("Choose exactly one of --{first} or --{second}"),
        )
        .into()),
    }
}

fn applied_camp_id(result: &Value) -> Result<String> {
    if result.get("status").and_then(Value::as_str) == Some("rejected") {
        let code = result
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("camp_create_rejected");
        return Err(CliError::new(code, "Camp creation was rejected.")
            .with_exit_code(1)
            .into());
    }
    result
        .pointer("/payload/campId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            CliError::new(
                "automation_contract_upgrade_required",
                "Camp creation returned no Camp ID",
            )
            .into()
        })
}

fn command_id() -> String {
    Uuid::new_v4().to_string()
}

fn print_json(value: &Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn absolute_path(path: &Path) -> Result<String> {
    if path.is_absolute() {
        Ok(path.to_string_lossy().into_owned())
    } else {
        Ok(env::current_dir()?
            .join(path)
            .to_string_lossy()
            .into_owned())
    }
}

fn reserve_private_directory(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            anyhow!(CliError::new(
                "export_path_exists",
                "The export directory already exists."
            ))
        } else {
            error.into()
        }
    })?;
    restrict_private_directory(path)?;
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn write_private_json(path: &Path, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    write_private(path, &bytes)
}

fn write_jsonl(path: &Path, values: &[Value]) -> Result<()> {
    let mut bytes = Vec::new();
    for value in values {
        serde_json::to_writer(&mut bytes, value)?;
        bytes.push(b'\n');
    }
    write_private(path, &bytes)
}

fn write_agent_run_bundle(path: &Path, diagnostic: &Value, captured: &CapturedWatch) -> Result<()> {
    write_private_json(&path.join("agent-run-diagnostic.json"), diagnostic)?;
    write_jsonl(&path.join("watch.jsonl"), &captured.items)?;
    write_jsonl(&path.join("evidence.jsonl"), &captured.evidence)?;
    write_private(
        &path.join("README.md"),
        b"This directory contains sensitive local diagnostic material. Do not publish it without review.\n",
    )?;
    fs::create_dir(path.join("attachments"))?;
    restrict_private_directory(&path.join("attachments"))?;
    if let Some(output) = diagnostic
        .pointer("/output/publicOutput")
        .and_then(Value::as_str)
    {
        write_private(&path.join("public-output.md"), output.as_bytes())?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_trial_bundle(
    path: &Path,
    trial: &Value,
    task: &str,
    launch: &Value,
    baseline: &Value,
    configured: &Value,
    diagnostic: Option<&Value>,
    captured: Option<&CapturedWatch>,
) -> Result<()> {
    write_private_json(&path.join("trial.json"), trial)?;
    write_private(&path.join("task.md"), task.as_bytes())?;
    write_private_json(&path.join("launch.json"), launch)?;
    write_private_json(&path.join("workspace-baseline.json"), baseline)?;
    let configured_safe = json!({
        "agentId": configured.get("agentId").cloned().unwrap_or(Value::Null),
        "displayName": configured.get("displayName").cloned().unwrap_or(Value::Null),
        "presence": configured.get("presence").cloned().unwrap_or(Value::Null),
        "runtimeConfiguration": configured.get("runtimeConfiguration").cloned().unwrap_or(Value::Null),
        "runtimeReadiness": configured.get("runtimeReadiness").cloned().unwrap_or(Value::Null),
        "profileVersion": configured.get("version").cloned().unwrap_or(Value::Null)
    });
    write_private_json(&path.join("runtime-configured.json"), &configured_safe)?;
    if let (Some(diagnostic), Some(captured)) = (diagnostic, captured) {
        write_private_json(&path.join("agent-run-diagnostic.json"), diagnostic)?;
        write_jsonl(&path.join("watch.jsonl"), &captured.items)?;
        write_jsonl(&path.join("evidence.jsonl"), &captured.evidence)?;
        if let Some(output) = diagnostic
            .pointer("/output/publicOutput")
            .and_then(Value::as_str)
        {
            write_private(&path.join("public-output.md"), output.as_bytes())?;
        }
    }
    write_private(
        &path.join("README.md"),
        b"Diagnostic Trial only; this is not formal Benchmark qualification. The directory contains sensitive local material.\n",
    )?;
    fs::create_dir(path.join("attachments"))?;
    restrict_private_directory(&path.join("attachments"))?;
    Ok(())
}

fn trial_journal_path(trial_id: &str) -> Result<PathBuf> {
    let root = dirs::data_dir()
        .context("User data directory is unavailable")?
        .join("Rovai AI")
        .join("automation-v1")
        .join("trials");
    fs::create_dir_all(&root)?;
    restrict_private_directory(&root)?;
    Ok(root.join(format!("{trial_id}.journal.json")))
}

fn atomic_write_private_json(path: &Path, value: &Value) -> Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    write_private(&temporary, &bytes)?;
    fs::rename(&temporary, path)?;
    restrict_private_file(path)?;
    if let Some(parent) = path.parent() {
        OpenOptions::new().read(true).open(parent)?.sync_all()?;
    }
    Ok(())
}

fn set_journal_phase(journal: &mut Value, phase: &str, extra: Option<(&str, Value)>) {
    let object = journal.as_object_mut().expect("Trial journal is an object");
    object.insert("phase".to_string(), json!(phase));
    object.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));
    if let Some((key, value)) = extra {
        object.insert(key.to_string(), value);
    }
}

fn restrict_private_directory(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(_path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn restrict_private_file(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(_path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        Flags, camp_create_params, command_result_exit_code, event_belongs_to_run,
        launch_result_exit_code, member_create_params, member_runtime_set_params,
        parse_duration_seconds, terminal_exit_code, terminal_status,
    };
    use serde_json::json;

    #[test]
    fn duration_parser_freezes_supported_units_and_caps_at_one_day() {
        assert_eq!(parse_duration_seconds("30m").unwrap(), 1_800);
        assert_eq!(parse_duration_seconds("2h").unwrap(), 7_200);
        assert!(parse_duration_seconds("25h").is_err());
        assert!(parse_duration_seconds("0s").is_err());
    }

    #[test]
    fn repeated_member_flags_are_preserved() {
        let flags = Flags::parse(&[
            "--member".into(),
            "agent_1".into(),
            "--member".into(),
            "agent_2".into(),
        ])
        .unwrap();
        assert_eq!(flags.repeated("member"), ["agent_1", "agent_2"]);
    }

    #[test]
    fn automation_camp_creation_uses_the_supported_peer_mode() {
        let params = camp_create_params(
            "command-1".to_string(),
            Some("TRAE Command View".to_string()),
            Some(json!({ "projectPath": "/tmp/workspace" })),
            vec!["agent_8".to_string()],
            "agent_8".to_string(),
        );

        assert_eq!(params["collaborationMode"], "peer");
    }

    #[test]
    fn member_creation_defaults_optional_identity_fields_without_open_core_params() {
        let flags = Flags::parse(&[
            "--display-name".into(),
            "开栈".into(),
            "--personality-trait".into(),
            "严谨".into(),
            "--command-id".into(),
            "command-create".into(),
        ])
        .unwrap();
        let params = member_create_params(&flags).unwrap();

        assert_eq!(params["commandId"], "command-create");
        assert_eq!(params["displayName"], "开栈");
        assert_eq!(params["teamRole"], "");
        assert_eq!(params["personalityTraits"], json!(["严谨"]));
    }

    #[test]
    fn member_runtime_configuration_freezes_model_permissions_and_version_fence() {
        let flags = Flags::parse(&[
            "--agent-id".into(),
            "agent_12".into(),
            "--expected-version".into(),
            "1".into(),
            "--adapter".into(),
            "opencode-cli".into(),
            "--model".into(),
            "minimax/MiniMax-M3".into(),
            "--model-options-json".into(),
            r#"{"effort":"high"}"#.into(),
            "--permission-schema-version".into(),
            "1".into(),
            "--permissions-json".into(),
            r#"{"permission_mode":"allow"}"#.into(),
            "--command-id".into(),
            "command-runtime".into(),
        ])
        .unwrap();
        let params = member_runtime_set_params(&flags).unwrap();

        assert_eq!(params["commandId"], "command-runtime");
        assert_eq!(params["expectedVersion"], 1);
        assert_eq!(params["model"]["mode"], "explicit");
        assert_eq!(params["model"]["modelId"], "minimax/MiniMax-M3");
        assert_eq!(params["model"]["options"]["effort"], "high");
        assert_eq!(params["permissions"]["adapterKind"], "opencode-cli");
        assert_eq!(params["permissions"]["values"]["permission_mode"], "allow");
    }

    #[test]
    fn member_runtime_configuration_rejects_ambiguous_or_non_object_inputs() {
        let ambiguous = Flags::parse(&[
            "--agent-id".into(),
            "agent_12".into(),
            "--expected-version".into(),
            "1".into(),
            "--adapter".into(),
            "opencode-cli".into(),
            "--model".into(),
            "minimax/MiniMax-M3".into(),
            "--runtime-default".into(),
            "--permission-schema-version".into(),
            "1".into(),
            "--permissions-json".into(),
            "{}".into(),
        ])
        .unwrap();
        assert!(member_runtime_set_params(&ambiguous).is_err());

        let array_permissions = Flags::parse(&[
            "--agent-id".into(),
            "agent_12".into(),
            "--expected-version".into(),
            "1".into(),
            "--adapter".into(),
            "opencode-cli".into(),
            "--runtime-default".into(),
            "--permission-schema-version".into(),
            "1".into(),
            "--permissions-json".into(),
            "[]".into(),
        ])
        .unwrap();
        assert!(member_runtime_set_params(&array_permissions).is_err());
    }

    #[test]
    fn domain_filter_and_terminal_state_do_not_infer_from_evidence() {
        assert!(event_belongs_to_run(
            &json!({ "entityType": "agent_run", "entityId": "rvrun_1" }),
            "rvrun_1"
        ));
        assert!(!event_belongs_to_run(
            &json!({ "entityType": "agent_run", "entityId": "rvrun_2" }),
            "rvrun_1"
        ));
        assert!(terminal_status(&json!({ "status": "succeeded" })));
        assert!(!terminal_status(&json!({ "status": "running" })));
    }

    #[test]
    fn shell_exit_codes_distinguish_domain_and_terminal_outcomes() {
        assert_eq!(command_result_exit_code(&json!({ "status": "applied" })), 0);
        assert_eq!(
            command_result_exit_code(&json!({ "status": "rejected" })),
            1
        );
        assert_eq!(
            launch_result_exit_code(&json!({ "status": "dispatched" })),
            0
        );
        assert_eq!(launch_result_exit_code(&json!({ "status": "rejected" })), 1);
        assert_eq!(terminal_exit_code(&json!({ "status": "succeeded" })), 0);
        assert_eq!(terminal_exit_code(&json!({ "status": "failed" })), 1);
        assert_eq!(terminal_exit_code(&json!({ "status": "cancelled" })), 1);
    }
}
