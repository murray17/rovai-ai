//! Convert native Claude Code can_use_tool requests into existing Actions
//! and frozen Approval options. Native policy remains Claude's authority.

use std::path::Path;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use crate::{
    action::{CanonicalActionInput, RuntimeActionRequestBinding, RuntimePermissionOption},
    command::canonical_json_digest,
};

pub const CLAUDE_PERMISSION_NATIVE_METHOD: &str = "claude/permission_request";

pub struct ClaudePermissionAction {
    pub action_id: String,
    pub native_action_id: String,
    pub input: CanonicalActionInput,
    pub runtime_request: RuntimeActionRequestBinding,
    pub reason: Option<String>,
}

pub fn deny_decision(message: &str) -> Value {
    json!({"behavior": "deny", "message": message})
}

pub fn intercepted_action_request(
    agent_run_id: &str,
    execution_epoch: i64,
    expected_session_id: &str,
    execution_root: &Path,
    control_request: &Value,
) -> Result<ClaudePermissionAction> {
    if control_request.get("type").and_then(Value::as_str) != Some("control_request")
        || control_request
            .get("session_id")
            .is_some_and(|id| id.as_str() != Some(expected_session_id))
    {
        bail!("Claude permission request is outside the active Native Session");
    }
    let request_id = control_request
        .get("request_id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .context("Claude permission request has no request_id")?;
    let request = &control_request["request"];
    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
        bail!("Claude control request is not a tool permission request");
    }
    let native_tool_call_id = request
        .get("tool_use_id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .context("Claude permission request has no reliable tool_use_id")?;
    let tool_name = request
        .get("tool_name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .context("Claude permission request has no tool name")?;
    let tool_input = request
        .get("input")
        .filter(|input| input.is_object())
        .context("Claude permission request has no object tool input")?;
    let root = execution_root
        .to_str()
        .context("Claude execution root is not UTF-8")?;
    if !execution_root.is_absolute() {
        bail!("Claude execution root must be absolute");
    }
    let request_digest = canonical_json_digest(&json!({
        "requestId": request_id,
        "request": control_request,
    }))?;
    let cwd = root;
    let input = match tool_name {
        "Bash" => match tool_input.get("command").and_then(Value::as_str) {
            Some(command) if !command.trim().is_empty() => CanonicalActionInput::ShellCommand {
                argv: vec![command.into()],
                cwd: cwd.into(),
                environment_refs: Vec::new(),
                command_transport: None,
            },
            _ => bail!("Claude Bash permission request has no command"),
        },
        "Write" | "Edit" | "NotebookEdit" => {
            let path = tool_input
                .get("file_path")
                .or_else(|| tool_input.get("notebook_path"))
                .and_then(Value::as_str)
                .context("Claude file permission request has no path")?;
            let path = Path::new(path);
            let path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                Path::new(cwd).join(path)
            };
            CanonicalActionInput::FileWrite {
                path: path.to_string_lossy().into_owned(),
                operation: if tool_name == "Write" {
                    "create"
                } else {
                    "patch"
                }
                .into(),
                content_digest: request_digest.clone(),
            }
        }
        "Read" => CanonicalActionInput::SensitiveRead {
            resource: tool_input
                .get("file_path")
                .and_then(Value::as_str)
                .context("Claude read permission request has no path")?
                .into(),
        },
        name if name.starts_with("mcp__") => {
            let (server, tool) = name[5..]
                .split_once("__")
                .context("Claude MCP permission request has no server/tool pair")?;
            CanonicalActionInput::McpTool {
                server: server.into(),
                tool: tool.into(),
                arguments: tool_input.clone(),
            }
        }
        _ => CanonicalActionInput::RuntimePermissionGrant {
            cwd: cwd.into(),
            permissions: json!({"toolName": tool_name, "toolInput": tool_input}),
            request_digest: request_digest.clone(),
        },
    };
    let allow = json!({"behavior": "allow", "updatedInput": tool_input});
    let deny = deny_decision("Rovai 用户拒绝了这次 Claude Code 操作");
    // Claude's stdio protocol supplies decisions and permission suggestions, not UI labels.
    // These English labels/templates are from the native Claude Code 2.1.280 dialog.
    let mut options = vec![
        RuntimePermissionOption::from_native(
            "claude.deny",
            "deny",
            "No",
            "拒绝这一次 Claude Code 操作。",
            deny,
            false,
        )?,
        RuntimePermissionOption::from_native(
            "claude.allow_once",
            "allow_once",
            "Yes",
            "仅允许这一次 Claude Code 操作，不保存规则。",
            allow,
            true,
        )?,
    ];
    options.extend(remembered_permission_options(request, tool_input)?);
    let action_id_digest = canonical_json_digest(&json!({
        "agentRunId": agent_run_id,
        "executionEpoch": execution_epoch,
        "nativeMethod": CLAUDE_PERMISSION_NATIVE_METHOD,
        "requestId": request_id,
    }))?;
    Ok(ClaudePermissionAction {
        action_id: format!("action-{action_id_digest}"),
        native_action_id: request_id.into(),
        input,
        runtime_request: RuntimeActionRequestBinding {
            native_method: CLAUDE_PERMISSION_NATIVE_METHOD.into(),
            native_request_id: Value::String(request_id.into()),
            native_item_id: native_tool_call_id.into(),
            native_thread_id: expected_session_id.into(),
            native_turn_id: format!("claude-code:{agent_run_id}:{execution_epoch}"),
            response_context: control_request.clone(),
            options,
        },
        reason: tool_input
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Some(tool_name.into())),
    })
}

pub(crate) fn remembered_permission_options(
    request: &Value,
    tool_input: &Value,
) -> Result<Vec<RuntimePermissionOption>> {
    let mut options: Vec<RuntimePermissionOption> = Vec::new();
    // Share this admission rule with the control writer; suppression cannot be bypassed there.
    if request
        .get("suppress_always_allow_rule")
        .is_none_or(|value| value.as_bool() == Some(false))
        && let Some(suggestions) = request
            .get("permission_suggestions")
            .and_then(Value::as_array)
    {
        for suggestion in suggestions {
            if let Some(option) = remembered_permission_option(suggestion, tool_input)?
                && !options
                    .iter()
                    .any(|existing| existing.option_id == option.option_id)
            {
                options.push(option);
            }
        }
    }
    Ok(options)
}

fn remembered_permission_option(
    suggestion: &Value,
    tool_input: &Value,
) -> Result<Option<RuntimePermissionOption>> {
    if suggestion.get("type").and_then(Value::as_str) != Some("addRules")
        || suggestion.get("behavior").and_then(Value::as_str) != Some("allow")
    {
        return Ok(None);
    }
    let destination = match suggestion.get("destination").and_then(Value::as_str) {
        Some("localSettings") => "localSettings · .claude/settings.local.json",
        Some("projectSettings") => "projectSettings · .claude/settings.json",
        Some("userSettings") => "userSettings",
        Some("session") => "session",
        _ => return Ok(None),
    };
    let Some(rules) = suggestion.get("rules").and_then(Value::as_array) else {
        return Ok(None);
    };
    if rules.is_empty() {
        return Ok(None);
    }
    let mut scopes = Vec::new();
    let mut single_label = None;
    for rule in rules {
        let Some(tool) = rule
            .get("toolName")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
        else {
            return Ok(None);
        };
        match rule.get("ruleContent") {
            None => {
                scopes.push(tool.to_string());
                single_label = Some(format!("Yes, and don’t ask again for any {tool} command"));
            }
            Some(Value::String(pattern)) if !pattern.trim().is_empty() => {
                scopes.push(format!("{tool}({pattern})"));
                single_label = Some(format!("Yes, and don’t ask again for: {pattern}"));
            }
            _ => return Ok(None),
        }
    }
    let label = if scopes.len() == 1 {
        single_label.expect("a validated rule has a label")
    } else {
        format!("Yes, and don’t ask again for: {}", scopes.join(", "))
    };
    let scope = format!("{}\n{destination}", scopes.join("\n"));
    let option_id = format!(
        "claude.allow_remember.{}",
        canonical_json_digest(suggestion)?
    );
    // Pass through the selected native update unchanged. Never synthesize a rule or setMode.
    RuntimePermissionOption::from_native(
        option_id,
        "other",
        label,
        scope,
        json!({"behavior": "allow", "updatedInput": tool_input, "updatedPermissions": [suggestion]}),
        true,
    )
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_permission_ids_and_exact_input_bind_frozen_approval_options() {
        let request = json!({"type":"control_request", "request_id":"request-1", "session_id":"session-1",
            "request":{"subtype":"can_use_tool", "tool_use_id":"tool-1", "tool_name":"Bash",
                "input":{"command":"rovai send --public-only --body hello", "description":"Send update"}}});
        let convert = |request: &Value| {
            intercepted_action_request("run-1", 3, "session-1", Path::new("/tmp/project"), request)
        };
        let action = convert(&request).unwrap();
        match &action.input {
            CanonicalActionInput::ShellCommand { argv, cwd, .. } => {
                assert_eq!(
                    argv,
                    &vec!["rovai send --public-only --body hello".to_string()]
                );
                assert_eq!(cwd, "/tmp/project");
            }
            _ => panic!("Claude Bash must keep the exact command for Approval"),
        }
        assert_eq!(action.runtime_request.native_request_id, "request-1");
        assert_eq!(action.runtime_request.native_item_id, "tool-1");
        assert_eq!(action.runtime_request.native_thread_id, "session-1");
        assert_eq!(action.runtime_request.options[0].label, "No");
        assert_eq!(action.runtime_request.options[1].label, "Yes");
        assert_eq!(
            action.runtime_request.options[1].native_response["updatedInput"],
            request["request"]["input"]
        );
        assert!(
            action.runtime_request.options[1]
                .native_response
                .get("updatedPermissions")
                .is_none()
        );
        assert_eq!(
            action.runtime_request.options[0].native_response["behavior"],
            "deny"
        );
        for (pointer, invalid) in [
            ("session_id", json!("session-2")),
            ("request_id", json!("")),
        ] {
            let mut value = request.clone();
            value[pointer] = invalid;
            assert!(convert(&value).is_err());
        }
        for (pointer, invalid) in [
            ("tool_use_id", Value::Null),
            ("tool_use_id", json!("")),
            ("input", json!([])),
        ] {
            let mut value = request.clone();
            value["request"][pointer] = invalid;
            assert!(convert(&value).is_err());
        }
        let mut identical = request.clone();
        identical["request_id"] = json!("request-2");
        identical["request"]["tool_use_id"] = json!("tool-2");
        let second = convert(&identical).unwrap();
        assert_ne!(action.action_id, second.action_id);
        assert_eq!(second.runtime_request.native_item_id, "tool-2");

        let suggestion = json!({"type":"addRules", "behavior":"allow", "destination":"localSettings",
            "rules":[{"toolName":"Bash", "ruleContent":"rovai send *"}]});
        let mut remember = request.clone();
        remember["request"]["permission_suggestions"] = json!([suggestion, suggestion]);
        let remembered = convert(&remember).unwrap();
        let options = &remembered.runtime_request.options;
        assert_eq!(
            options.len(),
            3,
            "identical native suggestions do not duplicate option IDs"
        );
        assert_eq!(
            options[2].label,
            "Yes, and don’t ask again for: rovai send *"
        );
        assert_eq!(
            options[2].consequence,
            "Bash(rovai send *)\nlocalSettings · .claude/settings.local.json"
        );
        assert!(options[2].allows_action);
        assert_eq!(
            options[2].native_response["updatedInput"],
            request["request"]["input"]
        );
        assert_eq!(
            options[2].native_response["updatedPermissions"],
            json!([suggestion])
        );
        assert!(
            options[1]
                .native_response
                .get("updatedPermissions")
                .is_none()
        );
        assert_ne!(
            options[1].native_response_digest,
            options[2].native_response_digest
        );
        for destination in [
            "userSettings",
            "projectSettings",
            "localSettings",
            "session",
        ] {
            let mut different = suggestion.clone();
            different["destination"] = json!(destination);
            remember["request"]["permission_suggestions"] = json!([different]);
            let converted = convert(&remember).unwrap();
            assert_eq!(
                converted.runtime_request.options[2].native_response["updatedPermissions"],
                json!([different])
            );
        }
        remember["request"]["permission_suggestions"] = json!([suggestion]);
        for suppression in [json!(true), Value::Null, json!("false")] {
            remember["request"]["suppress_always_allow_rule"] = suppression;
            assert_eq!(convert(&remember).unwrap().runtime_request.options.len(), 2);
        }
        remember["request"]["suppress_always_allow_rule"] = json!(false);
        assert_eq!(convert(&remember).unwrap().runtime_request.options.len(), 3);
        for (key, value) in [
            ("type", json!("setMode")),
            ("behavior", json!("deny")),
            ("destination", Value::Null),
            ("destination", json!("unknown")),
            ("rules", json!([])),
            ("rules", json!([{"toolName":""}])),
            ("rules", json!([{"toolName":"Bash", "ruleContent":[]}])),
        ] {
            let mut invalid = suggestion.clone();
            invalid[key] = value;
            remember["request"]["permission_suggestions"] = json!([invalid]);
            assert_eq!(convert(&remember).unwrap().runtime_request.options.len(), 2);
        }
        let mut multiple = suggestion.clone();
        multiple["rules"] =
            json!([{"toolName":"Bash", "ruleContent":"rovai send *"}, {"toolName":"Read"}]);
        remember["request"]["permission_suggestions"] = json!([suggestion, multiple]);
        let options = convert(&remember).unwrap().runtime_request.options;
        assert_eq!(options.len(), 4);
        assert_ne!(options[2].option_id, options[3].option_id);
        assert_eq!(
            options[3].consequence,
            "Bash(rovai send *)\nRead\nlocalSettings · .claude/settings.local.json"
        );
        assert_eq!(
            options[3].native_response["updatedPermissions"],
            json!([multiple])
        );
    }
}
