//! Native delegation is an ordinary tool invocation. This module only owns
//! display provenance; it neither schedules children nor consumes their results.
use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{agent_profile::AdapterKind, command::canonical_json_digest};

pub fn is_agent_tool(adapter: AdapterKind, name: &str) -> bool {
    match adapter {
        AdapterKind::CodexCli => matches!(
            name,
            "subAgentActivity"
                | "spawn_agent"
                | "wait"
                | "wait_agent"
                | "send_input"
                | "close_agent"
                | "resume_agent"
        ),
        AdapterKind::CopilotCli => {
            matches!(name, "task" | "read_agent" | "list_agents" | "write_agent")
        }
        AdapterKind::ClaudeCodeCli
        | AdapterKind::ZcodeApp
        | AdapterKind::KimiCodeCli
        | AdapterKind::CodebuddyCli
        | AdapterKind::QoderCli => matches!(name, "Agent" | "Task" | "TaskOutput" | "TaskStop"),
        AdapterKind::QwenCode => matches!(name, "agent" | "task_output" | "task_stop"),
        AdapterKind::OpencodeCli => matches!(name, "task" | "subagent" | "task_output"),
        AdapterKind::KiloCli => name == "task",
        AdapterKind::GooseCli => name == "delegate",
        AdapterKind::MinimaxCodeCli => matches!(name, "task" | "task_output" | "task_stop"),
        AdapterKind::CommandCodeCli => name == "agent",
        AdapterKind::GrokBuild => name == "spawn_subagent",
        AdapterKind::DeepseekHarness | AdapterKind::KiroCli => name == "subagent",
        AdapterKind::HermesCli => name == "delegate_task",
        AdapterKind::TraeCnCli => matches!(
            name,
            "spawn_agent" | "wait" | "send_input" | "close_agent" | "resume_agent"
        ),
        AdapterKind::AntigravityApp => name == "invoke_subagent",
        AdapterKind::Pi => name == "subagent",
        _ => false,
    }
}

/// Grok's result reader also handles background shell commands. It exposes task
/// parameters, but its name alone does not prove an agent-only tool type.
pub fn exposes_task_parameters(adapter: AdapterKind, name: &str) -> bool {
    is_agent_tool(adapter, name)
        || (adapter == AdapterKind::GrokBuild && name == "get_command_or_subagent_output")
}

pub fn mark_agent_tool(adapter: AdapterKind, payload: &mut Value) {
    let name = payload
        .get("toolName")
        .or_else(|| payload.pointer("/item/tool"))
        .and_then(Value::as_str);
    if name.is_some_and(|name| is_agent_tool(adapter, name)) {
        payload["runtimeToolType"] = json!("agent");
    }
}

/// Only protocol-owned names. Vendor metadata takes precedence over display
/// titles (CodeBuddy changes Agent's title to the selected agent subtype).
pub fn acp_tool_name(adapter: AdapterKind, update: &Value) -> Option<String> {
    let explicit = update
        .get("toolName")
        .or_else(|| update.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            match adapter {
                AdapterKind::GooseCli => update.pointer("/_meta/goose/toolCall/toolName"),
                AdapterKind::CodebuddyCli => update.pointer("/_meta/codebuddy.ai~1toolName"),
                AdapterKind::QoderCli => update.pointer("/_meta/qoder/toolName"),
                AdapterKind::KiroCli => update.pointer("/_meta/kiro/toolName"),
                AdapterKind::QwenCode => update.pointer("/_meta/toolName"),
                AdapterKind::OpencodeCli => update.pointer("/_meta/name"),
                AdapterKind::GrokBuild => update.pointer("/_meta/x.ai~1tool/name"),
                AdapterKind::TraeCnCli
                    if update.pointer("/_meta/traex/type").and_then(Value::as_str)
                        == Some("subagent_control") =>
                {
                    update.pointer("/_meta/traex/action")
                }
                _ => None,
            }
            .and_then(Value::as_str)
        });
    if let Some(name) = explicit.filter(|name| !name.trim().is_empty()) {
        return Some(name.to_owned());
    }
    // These adapters publish the function name in a fixed native label field,
    // rather than toolName. Accept only the measured function-label grammar;
    // arbitrary prose titles never establish a tool type.
    let title = update.get("title").and_then(Value::as_str)?;
    match adapter {
        AdapterKind::KimiCodeCli | AdapterKind::DeepseekHarness | AdapterKind::CommandCodeCli
            if is_agent_tool(adapter, title) =>
        {
            Some(title.to_owned())
        }
        AdapterKind::HermesCli
            if title.starts_with("delegate_task: ")
                && update.get("kind").and_then(Value::as_str) == Some("execute") =>
        {
            Some("delegate_task".into())
        }
        // Copilot ACP omits the name, but task has this native structured input
        // signature. A description/title alone is not sufficient evidence.
        AdapterKind::CopilotCli
            if update["kind"] == "other"
                && update["rawInput"]["agent_type"].is_string()
                && update["rawInput"]["prompt"].is_string() =>
        {
            Some("task".into())
        }
        AdapterKind::CopilotCli
            if title == "read_agent"
                && update["kind"] == "read"
                && update["rawInput"]["agent_id"].is_string() =>
        {
            Some("read_agent".into())
        }
        // Kilo's fixed pending label is task/think. Running updates replace
        // that label with description; the native task input proves identity.
        AdapterKind::KiloCli
            if update["kind"] == "think"
                && (title == "task"
                    || (update["rawInput"]["description"].is_string()
                        && update["rawInput"]["subagent_type"].is_string()
                        && update["rawInput"]["prompt"].is_string())) =>
        {
            Some("task".into())
        }
        _ => None,
    }
}

pub fn acp_lifecycle_notice(adapter: AdapterKind, update: &Value) -> bool {
    if adapter == AdapterKind::QwenCode
        && update["_meta"]["backgroundTask"]["kind"] == "agent"
        && matches!(
            update["_meta"]["source"].as_str(),
            Some("background_task_completed" | "background_notification")
        )
    {
        return true;
    }
    adapter == AdapterKind::TraeCnCli
        && update["rawOutput"]["type"] == "subagent_completion"
        && update["toolCallId"]
            .as_str()
            .is_some_and(|id| id.starts_with("subagent:") && id.contains(":lifecycle:"))
}

fn child_scope(adapter: AdapterKind, params: &Value) -> Option<Value> {
    let update = &params["update"];
    for value in [update, &update["_meta"], params, &params["_meta"]] {
        for (field, scope) in [
            ("parentToolCallId", "parent-tool-call"),
            ("parent_tool_call_id", "parent-tool-call"),
            ("parent_tool_use_id", "parent-tool-call"),
            ("codebuddy.ai/parentToolCallId", "parent-tool-call"),
            ("subagentId", "agent"),
            ("subAgentId", "agent"),
            ("sourceAgentId", "agent"),
            ("source_agent_id", "agent"),
            ("agentId", "agent"),
            ("parentAgentId", "parent-agent"),
            ("parentSessionId", "parent-session"),
        ] {
            if let Some(id) = value
                .get(field)
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                return Some(json!([scope, id]));
            }
        }
    }
    if let Some(id) = update
        .pointer("/_meta/opencode~1child-session/id")
        .and_then(Value::as_str)
    {
        return Some(json!(["opencode/child-session", id]));
    }
    if let Some(id) = update
        .pointer("/_meta/github.com~1copilot/agentId")
        .and_then(Value::as_str)
    {
        return Some(json!(["github.com/copilot", id]));
    }
    if adapter == AdapterKind::TraeCnCli {
        if let Some(id) = update["toolCallId"]
            .as_str()
            .and_then(|id| id.strip_prefix("subagent:"))
            .and_then(|id| id.split_once(':').map(|(id, _)| id))
        {
            return Some(json!(["traex", id]));
        }
    }
    None
}

#[derive(Debug, Default)]
struct DisplayCall {
    name: Option<String>,
    input: Option<Value>,
    source: Option<Value>,
    child: bool,
    delegation_open: bool,
    background: bool,
    finished: bool,
    launch_failed: bool,
}

#[derive(Debug, Default)]
pub(crate) struct AcpExecutionDisplay {
    calls: HashMap<String, DisplayCall>,
    // Raw call ID -> exact source scopes. Sparse updates may borrow a scope only
    // if that ID has exactly one owner in this Session/Prompt.
    identities: HashMap<String, Vec<String>>,
}

impl AcpExecutionDisplay {
    /// Permission lookups may reuse metadata only for an unambiguous native ID.
    pub(crate) fn unique_call_id<'a>(&'a self, native_id: &'a str) -> Option<&'a str> {
        match self.identities.get(native_id) {
            None => Some(native_id),
            Some(keys) if keys.len() == 1 => Some(keys[0].as_str()),
            _ => None,
        }
    }

    pub(crate) fn observe(
        &mut self,
        adapter: AdapterKind,
        prompt: &str,
        params: &Value,
    ) -> Option<Value> {
        let update = &params["update"];
        let stage = update["sessionUpdate"].as_str().unwrap_or_default();
        if acp_lifecycle_notice(adapter, update) {
            return None;
        }
        let child = child_scope(adapter, params);
        let mut result = params.clone();
        let is_text = matches!(
            stage,
            "agent_message_chunk" | "agent_thought_chunk" | "plan"
        );
        let ambiguous = matches!(adapter, AdapterKind::CopilotCli | AdapterKind::QoderCli | AdapterKind::TraeCnCli)
            && self.calls.values().any(|call| call.delegation_open)
            // TRAE's root messages have a native messageId; forwarded child
            // chunks do not. Copilot/Qoder do not provide that guarantee.
            && !(adapter == AdapterKind::TraeCnCli && update["messageId"].is_string());
        result["runtimeRootOutput"] = json!(
            crate::runtime::is_root_output(params)
                && crate::runtime::is_root_output(update)
                && child.is_none()
                && !(is_text && ambiguous)
        );
        if !matches!(stage, "tool_call" | "tool_call_update") {
            return Some(result);
        }
        let Some(id) = update["toolCallId"].as_str().filter(|id| !id.is_empty()) else {
            return Some(result);
        };
        let keys = self.identities.entry(id.to_owned()).or_default();
        let identity = if adapter == AdapterKind::ZcodeApp {
            // The native ZCode bridge owns its globally scoped call ID, also
            // used by the existing fenced late-background evidence path.
            id.to_owned()
        } else if child.is_none() && stage == "tool_call_update" && !keys.is_empty() {
            if keys.len() != 1 {
                return None;
            }
            keys[0].clone()
        } else {
            format!(
                "acp-call:{}",
                canonical_json_digest(&json!([params["sessionId"], prompt, child, id]))
                    .expect("JSON identity")
            )
        };
        if !keys.contains(&identity) {
            keys.push(identity.clone());
        }
        let call = self.calls.entry(identity.clone()).or_default();
        call.child |= child.is_some();
        if child.is_some() {
            call.source = child;
        }
        if let Some(name) = acp_tool_name(adapter, update) {
            call.name = Some(name);
        }
        let agent_tool = call
            .name
            .as_deref()
            .is_some_and(|name| is_agent_tool(adapter, name));
        let task_parameters = call
            .name
            .as_deref()
            .is_some_and(|name| exposes_task_parameters(adapter, name));
        if task_parameters {
            if let Some(input) = update.get("rawInput").filter(|v| !v.is_null()) {
                call.input = Some(input.clone());
            }
        }
        if agent_tool {
            let input = call.input.as_ref().unwrap_or(&Value::Null);
            call.background |= input["run_in_background"] == true
                || input["background"] == true
                || matches!(input["mode"].as_str(), Some("background" | "async"))
                || matches!(call.name.as_deref(), Some("spawn_agent" | "delegate_task"));
            let launch = matches!(
                call.name.as_deref(),
                Some(
                    "Agent"
                        | "Task"
                        | "task"
                        | "agent"
                        | "subagent"
                        | "spawn_agent"
                        | "spawn_subagent"
                        | "delegate_task"
                )
            );
            if launch {
                call.launch_failed |=
                    matches!(update["status"].as_str(), Some("failed" | "cancelled"));
                call.finished |= matches!(
                    update["status"].as_str(),
                    Some("completed" | "failed" | "cancelled")
                );
                call.delegation_open = !call.launch_failed && (call.background || !call.finished);
            }
        }
        if call.child {
            result["runtimeRootOutput"] = json!(false);
        }
        result["update"]["operationId"] = json!(identity);
        result["update"]["runtimeSource"] =
            json!({"sessionId":params["sessionId"],"promptId":prompt,"scope":call.source});
        if let Some(name) = &call.name {
            result["update"]["toolName"] = json!(name);
        }
        if agent_tool {
            result["update"]["runtimeToolType"] = json!("agent");
        }
        if task_parameters {
            if let Some(input) = &call.input {
                result["update"]["rawInput"] = input.clone();
            }
        }
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns the new Prompt-local provenance state machine. Pure native frames
    // reproduce collisions/anonymous text without a database or model process.
    #[test]
    fn display_calls_keep_scoped_identity_and_exclude_unattributed_child_prose() {
        // Official Kilo starts with an empty input and a fixed function label,
        // then changes that label to the task description. Its terminal omits
        // kind/input; the child Session in the result is the target, not author.
        let mut kilo = AcpExecutionDisplay::default();
        let pending = kilo.observe(AdapterKind::KiloCli, "kilo-prompt", &json!({
            "sessionId":"kilo-session","update":{"sessionUpdate":"tool_call","toolCallId":"kilo-task",
                "title":"task","kind":"think","status":"pending","rawInput":{}}
        })).unwrap();
        assert_eq!(pending["update"]["toolName"], "task");
        assert_eq!(pending["update"]["runtimeToolType"], "agent");
        let input = json!({"description":"Read fixture","subagent_type":"general","prompt":"Read the fixture"});
        let running = kilo.observe(AdapterKind::KiloCli, "kilo-prompt", &json!({
            "sessionId":"kilo-session","update":{"sessionUpdate":"tool_call_update","toolCallId":"kilo-task",
                "title":"Read fixture","kind":"think","status":"in_progress","rawInput":input}
        })).unwrap();
        let completed = kilo.observe(AdapterKind::KiloCli, "kilo-prompt", &json!({
            "sessionId":"kilo-session","update":{"sessionUpdate":"tool_call_update","toolCallId":"kilo-task",
                "status":"completed","rawOutput":{"output":"child report","metadata":{
                    "parentSessionId":"kilo-session","sessionId":"child-session"}}}
        })).unwrap();
        for update in [&running, &completed] {
            assert_eq!(
                update["update"]["operationId"],
                pending["update"]["operationId"]
            );
            assert_eq!(update["update"]["toolName"], "task");
            assert_eq!(update["update"]["runtimeToolType"], "agent");
            assert_eq!(update["update"]["rawInput"], input);
            assert_eq!(update["runtimeRootOutput"], true);
        }
        let mut state = AcpExecutionDisplay::default();
        let launch = json!({"sessionId":"session", "update":{
            "sessionUpdate":"tool_call", "toolCallId":"parent", "status":"pending", "kind":"other",
            "title":"Read fixture", "rawInput":{"agent_type":"explore","prompt":"Read fixture","mode":"sync"}}});
        let first = state
            .observe(AdapterKind::CopilotCli, "prompt", &launch)
            .unwrap();
        assert_eq!(first["update"]["toolName"], "task");
        assert_eq!(first["runtimeRootOutput"], true);
        let prose = json!({"sessionId":"session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"unknown author"}}});
        assert_eq!(
            state
                .observe(AdapterKind::CopilotCli, "prompt", &prose)
                .unwrap()["runtimeRootOutput"],
            false
        );
        let finish = json!({"sessionId":"session","update":{"sessionUpdate":"tool_call_update","toolCallId":"parent","status":"completed","content":[{"type":"text","text":"actual report"}]}});
        let result = state
            .observe(AdapterKind::CopilotCli, "prompt", &finish)
            .unwrap();
        assert_eq!(
            result["update"]["operationId"],
            first["update"]["operationId"]
        );
        assert_eq!(result["update"]["toolName"], "task");
        assert_eq!(result["update"]["rawInput"], launch["update"]["rawInput"]);
        assert_eq!(result["update"]["content"], finish["update"]["content"]);
        assert_eq!(
            state
                .observe(AdapterKind::CopilotCli, "prompt", &prose)
                .unwrap()["runtimeRootOutput"],
            true
        );
        let mut late_progress = finish.clone();
        late_progress["update"]["status"] = json!("in_progress");
        state.observe(AdapterKind::CopilotCli, "prompt", &late_progress);
        assert_eq!(
            state
                .observe(AdapterKind::CopilotCli, "prompt", &prose)
                .unwrap()["runtimeRootOutput"],
            true
        );
        let mut background = launch.clone();
        background["update"]["toolCallId"] = json!("background");
        background["update"]["rawInput"]["mode"] = json!("background");
        state.observe(AdapterKind::CopilotCli, "prompt", &background);
        let mut background_finish = finish.clone();
        background_finish["update"]["toolCallId"] = json!("background");
        state.observe(AdapterKind::CopilotCli, "prompt", &background_finish);
        assert_eq!(
            state
                .observe(AdapterKind::CopilotCli, "prompt", &prose)
                .unwrap()["runtimeRootOutput"],
            false
        );

        // An explicit launch failure releases only its own anonymous-text gate,
        // and late progress must not reopen it.
        for (adapter, tool) in [
            (AdapterKind::CopilotCli, "task"),
            (AdapterKind::QoderCli, "Agent"),
        ] {
            for status in ["failed", "cancelled"] {
                let mut state = AcpExecutionDisplay::default();
                let mut launch = background.clone();
                launch["update"]["toolName"] = json!(tool);
                state.observe(adapter, "prompt", &launch);
                let mut other = launch.clone();
                other["update"]["toolCallId"] = json!("other-background");
                state.observe(adapter, "prompt", &other);
                let mut failed = background_finish.clone();
                failed["update"]["status"] = json!(status);
                let result = state.observe(adapter, "prompt", &failed).unwrap();
                assert_eq!(result["update"]["status"], status);
                assert_eq!(
                    state.observe(adapter, "prompt", &prose).unwrap()["runtimeRootOutput"],
                    false
                );
                failed["update"]["toolCallId"] = json!("other-background");
                state.observe(adapter, "prompt", &failed);
                assert_eq!(
                    state.observe(adapter, "prompt", &prose).unwrap()["runtimeRootOutput"],
                    true
                );
                launch["update"]["sessionUpdate"] = json!("tool_call_update");
                launch["update"]["status"] = json!("in_progress");
                state.observe(adapter, "prompt", &launch);
                assert_eq!(
                    state.observe(adapter, "prompt", &prose).unwrap()["runtimeRootOutput"],
                    true
                );
            }
        }

        let mut state = AcpExecutionDisplay::default();
        let root = json!({"sessionId":"session", "update":{"sessionUpdate":"tool_call","toolCallId":"same","toolName":"Read","status":"pending"}});
        let mut child = root.clone();
        child["update"]["_meta"] = json!({"codebuddy.ai/parentToolCallId":"parent"});
        let a = state
            .observe(AdapterKind::CodebuddyCli, "prompt", &root)
            .unwrap();
        let b = state
            .observe(AdapterKind::CodebuddyCli, "prompt", &child)
            .unwrap();
        assert_ne!(a["update"]["operationId"], b["update"]["operationId"]);
        assert!(state.unique_call_id("same").is_none());
        assert_eq!(b["runtimeRootOutput"], false);
        let mut sparse = root.clone();
        sparse["update"]["sessionUpdate"] = json!("tool_call_update");
        assert!(
            state
                .observe(AdapterKind::CodebuddyCli, "prompt", &sparse)
                .is_none()
        );
        child["update"]["sessionUpdate"] = json!("tool_call_update");
        child["update"]["status"] = json!("completed");
        assert_eq!(
            state
                .observe(AdapterKind::CodebuddyCli, "prompt", &child)
                .unwrap()["update"]["operationId"],
            b["update"]["operationId"]
        );
        child["update"]["_meta"] = json!({"parent_tool_call_id":"parent"});
        assert_eq!(
            state
                .observe(AdapterKind::CodebuddyCli, "prompt", &child)
                .unwrap()["update"]["operationId"],
            b["update"]["operationId"]
        );
        let c = AcpExecutionDisplay::default()
            .observe(AdapterKind::CodebuddyCli, "next-prompt", &root)
            .unwrap();
        assert_ne!(a["update"]["operationId"], c["update"]["operationId"]);

        for (adapter, update, expected) in [
            (
                AdapterKind::CodebuddyCli,
                json!({"title":"general-purpose","_meta":{"codebuddy.ai/toolName":"Agent"}}),
                Some("Agent"),
            ),
            (
                AdapterKind::QoderCli,
                json!({"_meta":{"qoder":{"toolName":"Agent"}}}),
                Some("Agent"),
            ),
            (
                AdapterKind::KiroCli,
                json!({"title":"Spawning agent crew","_meta":{"kiro":{"toolName":"subagent"}}}),
                Some("subagent"),
            ),
            (
                AdapterKind::QwenCode,
                json!({"_meta":{"toolName":"agent"}}),
                Some("agent"),
            ),
            (
                AdapterKind::OpencodeCli,
                json!({"name":"subagent"}),
                Some("subagent"),
            ),
            (
                AdapterKind::MinimaxCodeCli,
                json!({"name":"task"}),
                Some("task"),
            ),
            (
                AdapterKind::CopilotCli,
                json!({"title":"read_agent","kind":"read","rawInput":{"agent_id":"child","since_turn":0}}),
                Some("read_agent"),
            ),
            (
                AdapterKind::TraeCnCli,
                json!({"_meta":{"traex":{"type":"subagent_control","action":"spawn_agent"}}}),
                Some("spawn_agent"),
            ),
            (
                AdapterKind::GrokBuild,
                json!({"title":"Readable task description", "_meta":{"x.ai/tool":{"name":"spawn_subagent","kind":"task"}}}),
                Some("spawn_subagent"),
            ),
            (AdapterKind::CopilotCli, json!({"title":"Agent"}), None),
            (
                AdapterKind::KiloCli,
                json!({"title":"User task description","kind":"think","rawInput":{
                    "description":"Read fixture","subagent_type":"general","prompt":"Read the fixture"}}),
                Some("task"),
            ),
            (
                AdapterKind::KiloCli,
                json!({"title":"task","kind":"other"}),
                None,
            ),
            (
                AdapterKind::KiloCli,
                json!({"title":"Task review","kind":"think"}),
                None,
            ),
            (
                AdapterKind::KiloCli,
                json!({"title":"Task review","kind":"think","rawInput":{"subagent_type":"general","prompt":"Read"}}),
                None,
            ),
            (
                AdapterKind::KiroCli,
                json!({"title":"Spawning agent crew"}),
                None,
            ),
            (
                AdapterKind::OpencodeCli,
                json!({"title":"delegate_task: prose"}),
                None,
            ),
        ] {
            assert_eq!(acp_tool_name(adapter, &update).as_deref(), expected);
        }
        let notice = json!({"sessionId":"session","update":{"sessionUpdate":"tool_call","toolCallId":"subagent:child:lifecycle:turn","rawOutput":{"type":"subagent_completion","status":"completed"}}});
        assert!(
            state
                .observe(AdapterKind::TraeCnCli, "prompt", &notice)
                .is_none()
        );
        assert!(!acp_lifecycle_notice(
            AdapterKind::CopilotCli,
            &notice["update"]
        ));
        assert!(exposes_task_parameters(
            AdapterKind::GrokBuild,
            "get_command_or_subagent_output"
        ));
        assert!(!is_agent_tool(
            AdapterKind::GrokBuild,
            "get_command_or_subagent_output"
        ));
        let qwen_notice = json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"native completion notice"},
            "_meta":{"source":"background_notification","backgroundTask":{"kind":"agent","taskId":"task"}}});
        assert!(acp_lifecycle_notice(AdapterKind::QwenCode, &qwen_notice));
        let mut ordinary = qwen_notice.clone();
        ordinary["_meta"] = Value::Null;
        assert!(!acp_lifecycle_notice(AdapterKind::QwenCode, &ordinary));
    }
}
