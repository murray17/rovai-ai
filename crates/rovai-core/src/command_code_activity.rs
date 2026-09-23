//! Public activity projection for Command Code's native AgentEvent frames.
//! Raw `run_end.nextState` and thinking events never leave this boundary.
#![allow(dead_code)] // Staged until Command Code receives Product Catalog admission.

use std::collections::HashMap;

use anyhow::{Result, ensure};
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub(crate) struct CommandCodeRuntimeEvent {
    pub event_type: &'static str,
    pub payload: Value,
}

#[derive(Debug)]
struct ToolState {
    name: String,
    requested_input: Option<Value>,
    started: bool,
    terminal: bool,
}

#[derive(Default)]
pub(crate) struct CommandCodeActivityNormalizer {
    message_number: u64,
    text_item_id: Option<String>,
    text_delta_seen: bool,
    observed_model: Option<String>,
    tools: HashMap<String, ToolState>,
}

impl CommandCodeActivityNormalizer {
    pub(crate) fn observe(&mut self, event: &Value) -> Result<Vec<CommandCodeRuntimeEvent>> {
        let mut output = Vec::new();
        match event.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                self.message_number = self.message_number.saturating_add(1);
                self.text_item_id = Some(format!("command-code-text-{}", self.message_number));
                self.text_delta_seen = false;
            }
            Some("model_request_start") => {
                if let Some(model) = event.get("model").and_then(Value::as_str)
                    && !model.is_empty()
                    && self.observed_model.as_deref() != Some(model)
                {
                    self.observed_model = Some(model.to_owned());
                    output.push(CommandCodeRuntimeEvent {
                        event_type: "runtime.model.observed",
                        payload: json!({"modelId": model}),
                    });
                }
            }
            Some("text_delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str)
                    && !delta.is_empty()
                {
                    let item_id = self.text_item_id()?.to_owned();
                    self.text_delta_seen = true;
                    output.push(CommandCodeRuntimeEvent {
                        event_type: "agent.text.delta",
                        payload: json!({"itemId": item_id, "delta": delta}),
                    });
                }
            }
            Some("message_end") => {
                if let Some(text) = event
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|block| {
                                block.get("type").and_then(Value::as_str) == Some("text")
                            })
                            .filter_map(|block| block.get("text").and_then(Value::as_str))
                            .collect::<String>()
                    })
                    .filter(|text| !text.is_empty())
                {
                    let item_id = self.text_item_id()?;
                    if !self.text_delta_seen {
                        output.push(CommandCodeRuntimeEvent {
                            event_type: "agent.text.delta",
                            payload: json!({"itemId": item_id, "delta": text}),
                        });
                    }
                    output.push(CommandCodeRuntimeEvent {
                        event_type: "agent.text.completed",
                        payload: json!({"itemId": item_id, "text": text}),
                    });
                }
                self.text_item_id = None;
            }
            Some("tool_queued") => {
                let (id, name) = tool_identity(event)?;
                match self.tools.get(id) {
                    Some(prior) => ensure!(
                        prior.name == name && !prior.terminal,
                        "Command Code reused a tool ID with conflicting state"
                    ),
                    None => {
                        self.tools.insert(
                            id.to_owned(),
                            ToolState {
                                name: name.to_owned(),
                                requested_input: event.get("input").cloned(),
                                started: false,
                                terminal: false,
                            },
                        );
                    }
                }
            }
            Some("tool_running") => {
                let (id, name) = tool_identity(event)?;
                let tool = self.tool(id, name)?;
                if !tool.started && !tool.terminal {
                    tool.started = true;
                    output.push(action_event(id, tool, "in_progress", None));
                }
            }
            Some("tool_completed" | "tool_errored" | "tool_denied" | "tool_hook_blocked") => {
                let event_type = event["type"].as_str().unwrap_or_default();
                let (id, name) = tool_identity(event)?;
                let tool = self.tool(id, name)?;
                if tool.terminal {
                    return Ok(output);
                }
                if !tool.started {
                    tool.started = true;
                    output.push(action_event(id, tool, "in_progress", None));
                }
                tool.terminal = true;
                let status = if event_type == "tool_completed" {
                    "completed"
                } else {
                    "failed"
                };
                let result = match event_type {
                    "tool_completed" => event.get("result"),
                    "tool_errored" => event.get("error"),
                    "tool_hook_blocked" => event.get("hookOutput"),
                    _ => None,
                };
                output.push(action_event(id, tool, status, result.and_then(public_text)));
            }
            _ => {} // `run_end` can contain the entire private transcript.
        }
        Ok(output)
    }

    fn text_item_id(&self) -> Result<&str> {
        self.text_item_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("Command Code text event preceded message_start"))
    }

    fn tool(&mut self, id: &str, name: &str) -> Result<&mut ToolState> {
        let tool = self
            .tools
            .entry(id.to_owned())
            .or_insert_with(|| ToolState {
                name: name.to_owned(),
                requested_input: None,
                started: false,
                terminal: false,
            });
        ensure!(
            tool.name == name,
            "Command Code changed a tool name for one ID"
        );
        Ok(tool)
    }
}

fn tool_identity(event: &Value) -> Result<(&str, &str)> {
    let id = event
        .get("toolCallId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Command Code tool event omitted toolCallId"))?;
    let name = event
        .get("toolName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| anyhow::anyhow!("Command Code tool event omitted toolName"))?;
    Ok((id, name))
}

fn public_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => {
            let text = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn action_event(
    id: &str,
    tool: &ToolState,
    status: &str,
    output: Option<String>,
) -> CommandCodeRuntimeEvent {
    let kind = match tool.name.as_str() {
        "shell_command" | "monitor_command" | "kill_shell" => "execute",
        "read_file" | "list_dir" => "read",
        "grep" | "glob" => "file_search",
        "edit_file" => "edit",
        "write_file" => "write",
        _ => "tool",
    };
    let input = (kind == "execute")
        .then(|| tool.requested_input.as_ref()?.get("command")?.as_str())
        .flatten()
        .map(str::to_owned);
    CommandCodeRuntimeEvent {
        event_type: "runtime.action",
        payload: json!({
            "toolCallId": id,
            "toolName": tool.name,
            "status": status,
            "kind": kind,
            "title": tool.name,
            "input": input,
            "output": output,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_code_activity_separates_public_text_tool_outcomes_and_private_state() {
        let mut normalizer = CommandCodeActivityNormalizer::default();
        let frames = [
            json!({"type":"run_start","sessionId":"session-A"}),
            json!({"type":"message_start"}),
            json!({"type":"model_request_start","model":"probe/fixture"}),
            json!({"type":"thinking_delta","delta":"private reasoning"}),
            json!({"type":"text_delta","delta":"hello"}),
            json!({"type":"message_end","content":[{"type":"text","text":"hello"}]}),
            json!({"type":"tool_queued","toolCallId":"tool-1","toolName":"shell_command","input":{"command":"printf MARKER"}}),
            json!({"type":"tool_running","toolCallId":"tool-1","toolName":"shell_command"}),
            json!({"type":"tool_completed","toolCallId":"tool-1","toolName":"shell_command","result":[{"type":"text","text":"MARKER"}]}),
            json!({"type":"tool_completed","toolCallId":"tool-1","toolName":"shell_command","result":[{"type":"text","text":"MARKER"}]}),
            json!({"type":"tool_queued","toolCallId":"tool-2","toolName":"shell_command","input":{"command":"touch marker"}}),
            json!({"type":"tool_denied","toolCallId":"tool-2","toolName":"shell_command"}),
            json!({"type":"run_end","result":{"nextState":{"messages":[{"role":"user","content":"private prompt"}]}}}),
        ];
        let output = frames
            .iter()
            .flat_map(|frame| normalizer.observe(frame).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(output.len(), 7);
        assert_eq!(output[0].event_type, "runtime.model.observed");
        assert_eq!(output[1].event_type, "agent.text.delta");
        assert_eq!(output[2].event_type, "agent.text.completed");
        assert_eq!(output[4].payload["output"], "MARKER");
        assert_eq!(output[5].payload["status"], "in_progress");
        assert_eq!(output[6].payload["status"], "failed");
        assert!(!format!("{output:?}").contains("private"));
    }
}
