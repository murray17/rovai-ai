//! Ephemeral root-run feedback. Only an explicit, bounded native heading may
//! cross the public boundary; reasoning bodies never belong to this state.
use serde_json::{Value, json};

const MAX_TITLE_CHARS: usize = 80;
const MAX_HEADING_BYTES: usize = 384;

#[derive(Clone, Default)]
pub(crate) struct RuntimeThinking {
    thinking: bool,
    title: Option<String>,
    item: Option<String>,
    summary_index: Option<u64>,
    heading: String,
    heading_closed: bool,
}

pub(crate) fn title(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.chars().count() <= MAX_TITLE_CHARS
        && !value.chars().any(char::is_control)
        && !value.contains(['\u{2028}', '\u{2029}']))
    .then(|| value.to_owned())
}

fn root(payload: &Value) -> bool {
    payload.get("runtimeRootOutput") != Some(&Value::Bool(false))
        && [payload, &payload["item"], &payload["data"]]
            .into_iter()
            .all(crate::runtime::is_root_output)
}

pub(crate) fn copilot_intent(params: &Value) -> Option<Value> {
    if params.get("type")?.as_str()? != "assistant.intent" || !root(params) {
        return None;
    }
    Some(json!({"title": title(params.pointer("/data/intent")?.as_str()?)}))
}

fn phase(event: &str, payload: &Value) -> Option<bool> {
    if !root(payload) {
        return None;
    }
    if payload.pointer("/item/type").and_then(Value::as_str) == Some("reasoning") {
        return match event {
            "activity.started" => Some(true),
            "activity.completed" => Some(false),
            _ => None,
        };
    }
    if payload.pointer("/item/type").and_then(Value::as_str) == Some("agentMessage")
        && matches!(event, "activity.started" | "activity.completed")
    {
        return Some(false);
    }
    match event {
        "agent.thought.started"
        | "agent.thought.delta"
        | "agent.thought.block"
        | "agent.reasoning.summary.delta"
        | "agent.reasoning.summary.block"
        | "agent.thinking.title" => Some(true),
        "agent.thought.completed"
        | "agent.text.delta"
        | "agent.text.block"
        | "agent.text.completed"
        | "runtime.plan"
        | "runtime.plan.delta"
        | "runtime.diagnostic"
        | "activity.started" => Some(false),
        "runtime.action"
            if payload.get("runtimePhaseBoundary") != Some(&Value::Bool(false))
                && payload.get("sessionUpdate").and_then(Value::as_str)
                    != Some("tool_call_update")
                && !matches!(
                    payload.get("status").and_then(Value::as_str),
                    Some(
                        "completed"
                            | "succeeded"
                            | "success"
                            | "failed"
                            | "error"
                            | "cancelled"
                            | "canceled"
                            | "stopped"
                            | "declined"
                            | "denied"
                            | "not_executed"
                    )
                ) =>
        {
            Some(false)
        }
        "runtime.compaction.display"
            if payload.get("phase").and_then(Value::as_str) == Some("started") =>
        {
            Some(false)
        }
        // Late tool results, file updates, Fast observations and completed /
        // imminent compaction cannot cancel a newer root thinking stretch.
        _ => None,
    }
}

impl RuntimeThinking {
    pub(crate) fn observes(event: &str, payload: &Value) -> bool {
        phase(event, payload).is_some()
    }

    pub(crate) fn phase(&self) -> &'static str {
        if self.thinking {
            "thinking"
        } else {
            "executing"
        }
    }

    pub(crate) fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub(crate) fn observe(&mut self, event: &str, payload: &Value) -> bool {
        let Some(thinking) = phase(event, payload) else {
            return false;
        };
        let item = payload
            .get("itemId")
            .or_else(|| payload.pointer("/item/id"))
            .and_then(Value::as_str);
        let thinking_completed = event == "agent.thought.completed"
            || (event == "activity.completed"
                && payload.pointer("/item/type").and_then(Value::as_str) == Some("reasoning"));
        if !thinking
            && thinking_completed
            && item.is_some()
            && self
                .item
                .as_deref()
                .is_some_and(|active| Some(active) != item)
        {
            return false;
        }
        let before = (self.thinking, self.title.clone());
        if !thinking {
            *self = Self::default();
        } else {
            let summary_index = payload.get("summaryIndex").and_then(Value::as_u64);
            if !self.thinking
                || item.is_some_and(|id| self.item.as_deref() != Some(id))
                || summary_index.is_some_and(|index| self.summary_index != Some(index))
            {
                *self = Self {
                    thinking: true,
                    item: item.map(str::to_owned),
                    summary_index,
                    ..Self::default()
                };
            }
            if event == "agent.thinking.title" {
                self.title = payload.get("title").and_then(Value::as_str).and_then(title);
            } else if event == "agent.reasoning.summary.delta" {
                self.observe_heading(payload.get("delta").and_then(Value::as_str).unwrap_or(""));
            }
        }
        before != (self.thinking, self.title.clone())
    }

    fn observe_heading(&mut self, delta: &str) {
        if self.heading_closed {
            return;
        }
        // Retain at most the unfinished heading, never the rest of a summary.
        for ch in delta.chars() {
            if self.heading.len() + ch.len_utf8() > MAX_HEADING_BYTES {
                self.heading_closed = true;
                break;
            }
            self.heading.push(ch);
            let prefix = self.heading.trim_start();
            if prefix.starts_with("**") {
                if let Some(end) = prefix[2..].find("**") {
                    self.title = title(&prefix[2..2 + end]);
                    self.heading_closed = true;
                    break;
                }
                if prefix.contains('\n') {
                    self.heading_closed = true;
                    break;
                }
            } else if prefix.starts_with('#') {
                if prefix.contains('\n') {
                    let line = prefix.trim_end_matches('\n');
                    let hashes = line.chars().take_while(|ch| *ch == '#').count();
                    if (1..=3).contains(&hashes) && line.as_bytes().get(hashes) == Some(&b' ') {
                        let text = line[hashes + 1..].trim_end();
                        let without_closing = text.trim_end_matches('#');
                        self.title = title(if without_closing.ends_with(' ') {
                            without_closing
                        } else {
                            text
                        });
                    }
                    self.heading_closed = true;
                    break;
                }
            } else if !prefix.is_empty() && prefix != "*" {
                self.heading_closed = true;
                break;
            }
        }
        if self.heading_closed {
            self.heading.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // New owner: partial native headings and private-body retention have no
    // existing parser owner. This exercises boundaries without DB or Runtime.
    #[test]
    fn native_heading_is_bounded_and_cleared_at_public_output() {
        let mut state = RuntimeThinking::default();
        for delta in ["*", "*检查", "调用链*", "*\nPRIVATE_BODY"] {
            state.observe(
                "agent.reasoning.summary.delta",
                &json!({"itemId":"r1","summaryIndex":0,"delta":delta}),
            );
        }
        assert_eq!(state.title(), Some("检查调用链"));
        assert!(state.heading.is_empty());
        state.observe(
            "activity.completed",
            &json!({"item":{"id":"background","type":"commandExecution"}}),
        );
        assert_eq!(state.phase(), "thinking");
        assert_eq!(state.title(), Some("检查调用链"));
        for update in [
            json!({"sessionUpdate":"tool_call_update","status":"in_progress"}),
            json!({"runtimePhaseBoundary":false,"status":"in_progress"}),
            json!({"status":"completed"}),
        ] {
            assert!(!state.observe("runtime.action", &update));
            assert_eq!(state.title(), Some("检查调用链"));
        }
        state.observe("agent.text.delta", &json!({"delta":"public"}));
        assert_eq!(state.phase(), "executing");
        assert_eq!(state.title(), None);
        for delta in ["plain private prose", "**unfinished\nbody", "**", "# "] {
            let mut state = RuntimeThinking::default();
            state.observe("agent.reasoning.summary.delta", &json!({"delta":delta}));
            state.observe(
                "agent.reasoning.summary.delta",
                &json!({"delta":"x".repeat(2000)}),
            );
            assert_eq!(state.title(), None);
            assert!(state.heading.is_empty());
        }
        for bad in ["", "line\nbreak", "a\u{0000}b", &"字".repeat(81)] {
            assert_eq!(title(bad), None);
        }
        for (heading, expected) in [
            ("# Inspect C#\n", "Inspect C#"),
            ("### Inspect C# ###\n", "Inspect C#"),
        ] {
            state.observe(
                "agent.reasoning.summary.delta",
                &json!({"itemId":heading,"delta":heading}),
            );
            assert_eq!(state.title(), Some(expected));
        }
        state.observe(
            "activity.completed",
            &json!({"item":{"id":"public-message","type":"agentMessage"}}),
        );
        assert_eq!(state.phase(), "executing");
        assert_eq!(state.title(), None);
    }

    #[test]
    fn root_thinking_ignores_children_replay_and_old_item_completion() {
        let mut state = RuntimeThinking::default();
        state.observe("agent.thought.started", &json!({"itemId":"new"}));
        for marker in ["subagentId", "parent_tool_use_id", "replay", "snapshot"] {
            for container in ["", "/data", "/item", "/_meta"] {
                let mut payload = json!({"title":"child", "data":{}, "item":{}, "_meta":{}});
                let object = if container.is_empty() {
                    &mut payload
                } else {
                    payload.pointer_mut(container).unwrap()
                };
                object[marker] = json!(true);
                assert!(!state.observe("agent.thinking.title", &payload));
            }
        }
        assert!(!state.observe("agent.thought.completed", &json!({"itemId":"old"})));
        assert_eq!(state.phase(), "thinking");
        assert!(state.observe("agent.thought.completed", &json!({"itemId":"new"})));
        assert_eq!(state.phase(), "executing");
        assert_eq!(
            copilot_intent(&json!({"type":"assistant.intent","data":{"intent":"Checking files"}})),
            Some(json!({"title":"Checking files"}))
        );
        assert_eq!(
            copilot_intent(
                &json!({"type":"assistant.intent","data":{"intent":"x","parentToolCallId":"child"}})
            ),
            None
        );
        let invalid =
            copilot_intent(&json!({"type":"assistant.intent","data":{"intent":"x".repeat(81)}}))
                .unwrap();
        state.observe("agent.thinking.title", &json!({"title":"old"}));
        state.observe("agent.thinking.title", &invalid);
        assert_eq!(state.phase(), "thinking");
        assert_eq!(state.title(), None);
    }
}
