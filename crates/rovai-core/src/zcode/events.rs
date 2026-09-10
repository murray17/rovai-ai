use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub(super) struct SessionEvents {
    sequence: u64,
    input: Option<String>,
    turn: Option<String>,
    tools: HashMap<String, Value>,
    seen_tools: HashSet<String>,
    background: HashMap<String, BackgroundTool>,
    pending_background: HashSet<String>,
    final_suffix: String,
    final_message: Option<String>,
    terminal_seen: bool,
}

struct BackgroundTool {
    tool: Value,
    task_id: String,
    input_id: String,
    turn_id: String,
}

#[derive(Default)]
pub(super) struct Translated {
    pub messages: Vec<Value>,
    pub terminal: Option<Result<Value>>,
}

impl SessionEvents {
    pub fn new(sequence: u64) -> Self {
        Self {
            sequence,
            input: None,
            turn: None,
            tools: HashMap::new(),
            seen_tools: HashSet::new(),
            background: HashMap::new(),
            pending_background: HashSet::new(),
            final_suffix: String::new(),
            final_message: None,
            terminal_seen: false,
        }
    }

    pub fn begin(&mut self, input: &str) -> Result<()> {
        if self.input.is_some() {
            bail!("ZCode input still active");
        }
        self.input = Some(input.to_string());
        self.turn = None;
        self.tools.clear();
        self.seen_tools.clear();
        self.final_suffix.clear();
        self.final_message = None;
        self.terminal_seen = false;
        Ok(())
    }

    pub fn owns_turn(&self, turn: Option<&str>) -> bool {
        self.input.is_some() && turn.is_some() && self.turn.as_deref() == turn
    }

    pub fn finish(&mut self, session: &str, jobs: &[Value]) -> Result<Vec<Value>> {
        let mut messages = Vec::new();
        for job in jobs {
            if let Some(message) = self.background_result(session, job)? {
                messages.push(message);
            }
        }
        if !self.tools.is_empty() || !self.pending_background.is_empty() {
            bail!("ZCode terminal left Tool results unresolved");
        }
        self.input = None;
        Ok(messages)
    }

    pub fn input_id(&self) -> Option<&str> {
        self.input.as_deref()
    }

    pub fn background_tasks_for_input(&self, input: Option<&str>) -> Vec<String> {
        self.background
            .values()
            .filter(|tool| Some(tool.input_id.as_str()) == input)
            .map(|tool| tool.task_id.clone())
            .collect()
    }

    fn background_result(&mut self, session: &str, job: &Value) -> Result<Option<Value>> {
        let (Some(id), Some(task_id), Some(status)) = (
            job["toolCallId"].as_str(),
            job["taskId"].as_str(),
            job["status"].as_str(),
        ) else {
            return Ok(None);
        };
        if task_id.is_empty() || !matches!(job["taskKind"].as_str(), Some("bash" | "subagent")) {
            return Ok(None);
        }
        if !self.background.contains_key(id) {
            let Some(tool) = self.tools.get(id) else {
                return Ok(None);
            };
            if tool["toolName"] != job["toolName"] {
                return Ok(None);
            }
            if self.background.len() >= 4096 {
                bail!("ZCode background task limit exceeded");
            }
            self.background.insert(
                id.to_string(),
                BackgroundTool {
                    tool: tool.clone(),
                    task_id: task_id.to_string(),
                    input_id: self
                        .input
                        .clone()
                        .context("ZCode background Input missing")?,
                    turn_id: self.turn.clone().context("ZCode background Turn missing")?,
                },
            );
        }
        let tool = &self.background[id];
        if tool.task_id != task_id {
            bail!("ZCode background task identity changed");
        }
        let terminal = matches!(status, "completed" | "failed" | "cancelled" | "lost");
        if !terminal && status != "running" {
            bail!("ZCode background state unsupported");
        }
        let result = json!({"success":status=="completed", "content":job.get("stdoutTail").and_then(Value::as_str).unwrap_or(""),
            "truncated":job["outputTruncated"],"budgetStrategy":"artifact","artifactPath":job["stdoutPersistedOutputPath"],
            "perf":{"detail":{"command":{"status":if terminal && status != "lost" {status} else {"backgrounded"},"exitCode":job["exitCode"],"outputBytes":job["outputBytes"]}}}});
        let mut message = update(session, tool_update(&tool.tool, Some(&result))?);
        message["method"] = json!("_zcode/background");
        message["params"]["background"] = json!({"taskId":task_id,"toolCallId":id,
            "inputId":tool.input_id,"turnId":tool.turn_id,"status":status});
        // 'lost' is an uncertain native task, not proof that its process exited.
        // Keep its Host pinned until an explicit close or a confirmed exit.
        if terminal && status != "lost" {
            self.background.remove(id);
        }
        if self.pending_background.remove(id) {
            self.tools.remove(id);
        }
        Ok(Some(message))
    }

    pub fn receive(&mut self, event: &Value) -> Result<Translated> {
        let mut translated = Translated::default();
        let Some(seq) = event.get("seq").and_then(Value::as_u64) else {
            return Ok(translated);
        };
        if seq <= self.sequence {
            return Ok(translated);
        }
        self.sequence = seq;
        let session = event["sessionId"]
            .as_str()
            .context("ZCode event Session missing")?;
        let payload = &event["payload"];
        let kind = event["type"].as_str().unwrap_or("");
        if kind == "session.updated"
            && payload["status"] == "completed"
            && matches!(
                payload["trigger"].as_str(),
                Some("manual" | "auto" | "reactive")
            )
            && let (Some(operation), Some(boundary)) = (
                payload["operationId"].as_str(),
                payload["boundaryId"].as_str(),
            )
            && !operation.is_empty()
            && !boundary.is_empty()
        {
            translated.messages.push(json!({"method":"_zcode/compaction","params":{
                "sessionId":session,"operationId":boundary,"nativeOperationId":operation,"status":"completed",
                "trigger":payload["trigger"],"phase":payload["phase"]}}));
            return Ok(translated);
        }
        if kind == "session.updated"
            && payload["taskId"].is_string()
            && event["turnId"].as_str().is_some_and(|turn| {
                payload["toolCallId"]
                    .as_str()
                    .and_then(|id| self.background.get(id))
                    .map_or_else(|| self.owns_turn(Some(turn)), |tool| tool.turn_id == turn)
            })
            && let Some(message) = self.background_result(session, payload)?
        {
            translated.messages.push(message);
            return Ok(translated);
        }
        if self.input.is_none() || self.terminal_seen {
            return Ok(translated);
        }
        if kind == "turn.started" {
            if payload["inputId"].as_str() != self.input.as_deref() {
                return Ok(translated);
            }
            let turn = event["turnId"]
                .as_str()
                .context("ZCode Turn identity missing")?;
            if self.turn.as_deref().is_some_and(|old| old != turn) {
                bail!("ZCode input changed Turn identity");
            }
            self.turn = Some(turn.to_string());
            translated.messages.push(json!({"method":"_zcode/inputAccepted","params":{"sessionId":session,"inputId":payload["inputId"]}}));
            return Ok(translated);
        }
        if !self.owns_turn(event["turnId"].as_str()) {
            return Ok(translated);
        }
        match (kind, payload["kind"].as_str()) {
            ("model.streaming", Some("text_delta")) => {
                let delta = payload["delta"]
                    .as_str()
                    .context("ZCode text delta invalid")?;
                let message = payload["assistantMessageId"]
                    .as_str()
                    .context("ZCode assistant identity missing")?;
                if self.final_message.as_deref() != Some(message) {
                    self.final_suffix.clear();
                    self.final_message = Some(message.to_string());
                }
                self.final_suffix.push_str(delta);
                if self.final_suffix.len() > 4 * 1024 * 1024 {
                    bail!("ZCode assistant output exceeds limit");
                }
                translated.messages.push(update(
                    session,
                    json!({"sessionUpdate":"agent_message_chunk",
                    "messageId":message,"content":{"type":"text","text":delta}}),
                ));
            }
            // Reasoning and partial tool input are not public assistant text.
            ("model.streaming", Some("tool_call")) => {
                let id = payload["toolCallId"]
                    .as_str()
                    .context("ZCode Tool identity missing")?;
                if self.seen_tools.len() >= 4096 {
                    bail!("ZCode Tool count exceeds limit");
                }
                if self.background.contains_key(id) || !self.seen_tools.insert(id.to_string()) {
                    bail!("ZCode reused Tool identity");
                }
                self.tools.insert(id.to_string(), payload.clone());
                self.final_suffix.clear();
                self.final_message = None;
                translated
                    .messages
                    .push(update(session, tool_update(payload, None)?));
            }
            ("tool.updated", Some("result")) => {
                let id = payload["toolCallId"]
                    .as_str()
                    .context("ZCode Tool result identity missing")?;
                let Some(tool) = self.tools.get(id) else {
                    return Ok(translated);
                };
                let backgrounded = payload
                    .pointer("/result/perf/detail/command/status")
                    .and_then(Value::as_str)
                    == Some("backgrounded");
                if backgrounded || self.background.contains_key(id) {
                    if self.background.contains_key(id) {
                        self.tools.remove(id);
                    } else {
                        self.pending_background.insert(id.to_string());
                    }
                } else {
                    translated.messages.push(update(
                        session,
                        tool_update(tool, Some(&payload["result"]))?,
                    ));
                    self.tools.remove(id);
                }
            }

            ("permission.resolved", _) if payload["decision"] == "deny" => {
                // Official permission denial is terminal for this Tool and may
                // be followed only by a batch event, with no ToolCallResult.
                if let Some(id) = payload["toolCallId"].as_str()
                    && let Some(tool) = self.tools.remove(id)
                {
                    translated.messages.push(update(
                        session,
                        tool_update(
                            &tool,
                            Some(&json!({"success":false,"content":"Permission denied"})),
                        )?,
                    ));
                }
            }
            ("tool.updated", Some("error")) => {
                if let Some(id) = payload["toolCallId"].as_str()
                    && let Some(tool) = self.tools.remove(id)
                {
                    translated.messages.push(update(
                        session,
                        tool_update(
                            &tool,
                            Some(&json!({"success":false,"content":"Native ZCode tool failed"})),
                        )?,
                    ));
                }
            }
            ("turn.completed" | "turn.failed", _) => {
                if payload["inputId"].as_str() != self.input.as_deref() {
                    bail!("ZCode terminal input mismatch");
                }
                if payload.pointer("/usage/source").and_then(Value::as_str) == Some("provider") {
                    translated.messages.push(update(session, json!({"sessionUpdate":"usage_update","_meta":{
                        "zcodeUsage":payload["usage"],"nativeTurnId":event["turnId"],"nativeEventId":event["eventId"]}})));
                }
                translated.terminal = Some(match payload["resultType"].as_str() {
                    Some("success") if kind == "turn.completed" => {
                        let response = payload["response"].as_str().unwrap_or("");
                        if self.final_suffix.is_empty() && !response.is_empty() {
                            translated.messages.push(update(session, json!({"sessionUpdate":"agent_message_chunk",
                                "messageId":format!("{}:final", event["turnId"].as_str().unwrap_or("")),
                                "content":{"type":"text","text":response}})));
                        } else if self.final_suffix != response {
                            bail!("ZCode final response conflicts with streamed suffix");
                        }
                        Ok(json!({"stopReason":"end_turn"}))
                    }
                    Some("cancelled") => Ok(json!({"stopReason":"cancelled"})),
                    _ => Err(anyhow::anyhow!("Official ZCode Turn failed")),
                });
                self.terminal_seen = true;
            }
            _ => {}
        }
        Ok(translated)
    }
}

fn update(session: &str, update: Value) -> Value {
    json!({"method":"session/update","params":{"sessionId":session,"update":update}})
}

fn tool_update(tool: &Value, result: Option<&Value>) -> Result<Value> {
    let name = tool["toolName"]
        .as_str()
        .context("ZCode Tool name missing")?;
    let input = &tool["input"];
    let kind = match name {
        "Read" => "read",
        "Write" => "write",
        "Edit" => "edit",
        "Bash" => "execute",
        "Grep" | "Glob" => "search",
        _ => "other",
    };
    let path = matches!(name, "Read" | "Write" | "Edit")
        .then(|| input["file_path"].as_str())
        .flatten();
    let mut update = json!({"sessionUpdate":if result.is_some(){"tool_call_update"}else{"tool_call"},
        "toolCallId":tool["toolCallId"],"toolName":name,"title":name,"kind":kind,"rawInput":input,
        "status":"in_progress","locations":path.map(|path| vec![json!({"path":path})]).unwrap_or_default()});
    if let Some(result) = result {
        let exit_code = result
            .pointer("/perf/detail/command/exitCode")
            .and_then(Value::as_i64);
        let succeeded = result["success"] == true
            && !exit_code.is_some_and(|code| code != 0)
            && result.pointer("/perf/detail/command/timedOut") != Some(&json!(true));
        update["status"] = json!(if result
            .pointer("/perf/detail/command/status")
            .and_then(Value::as_str)
            == Some("backgrounded")
        {
            "in_progress"
        } else if succeeded {
            "completed"
        } else {
            "failed"
        });
        update["rawOutput"] = json!({"exitCode":exit_code,"output":result["content"],
            "truncated": result["truncated"],"artifactPath":result["artifactPath"],
            "budgetStrategy":result["budgetStrategy"],"commandStatus":result.pointer("/perf/detail/command/status"),
            "outputBytes":result.pointer("/perf/detail/command/outputBytes")});
        update["content"] = json!([{"type":"content","content":{"type":"text","text":result["content"].as_str().unwrap_or("")}}]);
        if succeeded
            && name == "Edit"
            && let Some(path) = path
            && let Some(patch) = structured_patch(path, &result["display"])
        {
            update["_meta"] =
                json!({"zcodeDiff":[{"path":path,"changeKind":"update","diff":patch}]});
        }
    }
    Ok(update)
}

/// A native structured patch is sufficient evidence without reading the disk
/// or interpreting old_string/new_string as an observed mutation.
fn structured_patch(path: &str, display: &Value) -> Option<String> {
    if display["kind"] != "file_diff"
        || display["filePath"].as_str() != Some(path)
        || display["truncated"] != false
        || path.contains(['\n', '\r', '\0'])
    {
        return None;
    }
    let hunks = display["structuredPatch"].as_array()?;
    if hunks.is_empty() || hunks.len() > 4096 {
        return None;
    }
    let mut patch = format!("--- {path}\n+++ {path}\n");
    let (mut added, mut deleted) = (0u64, 0u64);
    let (mut old_end, mut new_end) = (0u64, 0u64);
    for hunk in hunks {
        let (old, old_len, new, new_len) = (
            hunk["oldStart"].as_u64()?,
            hunk["oldLines"].as_u64()?,
            hunk["newStart"].as_u64()?,
            hunk["newLines"].as_u64()?,
        );
        if old < old_end || new < new_end {
            return None;
        }
        old_end = old.checked_add(old_len)?;
        new_end = new.checked_add(new_len)?;
        patch.push_str(&format!("@@ -{old},{old_len} +{new},{new_len} @@\n"));
        let (mut seen_old, mut seen_new) = (0u64, 0u64);
        for line in hunk["lines"].as_array()? {
            let line = line.as_str()?;
            if line.contains(['\n', '\r', '\0']) {
                return None;
            }
            match line.as_bytes().first()? {
                b' ' => {
                    seen_old += 1;
                    seen_new += 1;
                }
                b'-' => {
                    seen_old += 1;
                    deleted += 1;
                }
                b'+' => {
                    seen_new += 1;
                    added += 1;
                }
                b'\\' if line == "\\ No newline at end of file" => {}
                _ => return None,
            }
            patch.push_str(line);
            patch.push('\n');
            if patch.len() > 512 * 1024 {
                return None;
            }
        }
        if seen_old != old_len || seen_new != new_len {
            return None;
        }
    }
    (display["additions"].as_u64() == Some(added)
        && display["deletions"].as_u64() == Some(deleted)
        && added + deleted > 0)
        .then_some(patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    // New protocol owner: foreign/replayed events must never become effects of
    // the active input, and only a correlated success terminal permits Final.
    #[test]
    fn native_input_fences_replay_tools_compaction_and_terminal() {
        let mut state = SessionEvents::new(10);
        state.begin("input-1").unwrap();
        let event = |seq, turn, kind, payload| json!({"sessionId":"s1","seq":seq,"eventId":format!("e{seq}"),"turnId":turn,"type":kind,"payload":payload});
        assert!(
            state
                .receive(&event(11, "old", "turn.started", json!({"inputId":"old"})))
                .unwrap()
                .messages
                .is_empty()
        );
        let start = event(12, "t1", "turn.started", json!({"inputId":"input-1"}));
        assert_eq!(
            state.receive(&start).unwrap().messages[0]["method"],
            "_zcode/inputAccepted"
        );
        assert!(state.receive(&start).unwrap().messages.is_empty());
        assert!(
            state
                .receive(&event(
                    13,
                    "old",
                    "model.streaming",
                    json!({"kind":"text_delta","delta":"foreign"})
                ))
                .unwrap()
                .messages
                .is_empty()
        );
        let tool = json!({"kind":"tool_call","toolCallId":"tool1","toolName":"Bash","input":{"command":"exit 7"}});
        assert_eq!(
            state
                .receive(&event(14, "t1", "model.streaming", tool))
                .unwrap()
                .messages[0]["params"]["update"]["status"],
            "in_progress"
        );
        let failed = state.receive(&event(15,"t1","tool.updated",json!({"kind":"result","toolCallId":"tool1","result":{"success":true,"content":"","perf":{"detail":{"command":{"exitCode":7}}}}}))).unwrap();
        assert_eq!(failed.messages[0]["params"]["update"]["status"], "failed");
        let compact = state.receive(&event(16,"t1","session.updated",json!({"status":"completed","trigger":"reactive","phase":"reactive","operationId":"op1","boundaryId":"b1"}))).unwrap();
        assert_eq!(compact.messages[0]["params"]["operationId"], "b1");
        assert!(state.receive(&event(17,"t1","session.updated",json!({"status":"failed","trigger":"auto","operationId":"op2","boundaryId":"b2"}))).unwrap().messages.is_empty());
        let terminal = state
            .receive(&event(
                18,
                "t1",
                "turn.completed",
                json!({"inputId":"input-1","resultType":"success","response":"Final"}),
            ))
            .unwrap();
        assert_eq!(
            terminal.messages[0]["params"]["update"]["content"]["text"],
            "Final"
        );
        assert_eq!(
            terminal.terminal.unwrap().unwrap()["stopReason"],
            "end_turn"
        );
        state.finish("s1", &[]).unwrap();
        assert!(
            state
                .receive(&event(
                    19,
                    "t1",
                    "tool.updated",
                    json!({"kind":"result","toolCallId":"late"})
                ))
                .unwrap()
                .messages
                .is_empty()
        );
        state.begin("input-2").unwrap();
        state
            .receive(&event(
                20,
                "t2",
                "turn.started",
                json!({"inputId":"input-2"}),
            ))
            .unwrap();
        state.receive(&event(21,"t2","model.streaming",json!({"kind":"tool_call","toolCallId":"background","toolName":"Bash","input":{"command":"sleep 1"}}))).unwrap();
        let pending = state.receive(&event(22,"t2","tool.updated",json!({"kind":"result","toolCallId":"background","result":{"success":true,"perf":{"detail":{"command":{"status":"backgrounded"}}}}}))).unwrap();
        assert!(
            pending.messages.is_empty(),
            "No task identity may be inferred from a Tool result alone"
        );
        assert!(state.finish("s1", &[]).is_err());
        state
            .receive(&event(
                23,
                "t2",
                "turn.completed",
                json!({"inputId":"input-2","resultType":"success","response":"Started"}),
            ))
            .unwrap();
        assert!(state.begin("input-3").is_err());
        let job = json!({"taskId":"task-bg", "toolCallId":"background","toolName":"Bash","taskKind":"bash","status":"running"});
        let finished = state.finish("s1", std::slice::from_ref(&job)).unwrap();
        assert_eq!(finished[0]["params"]["update"]["status"], "in_progress");
        assert!(finished[0]["params"]["update"]["rawOutput"]["exitCode"].is_null());
        assert_eq!(state.background.len(), 1);
        state.begin("input-3").unwrap();
        state
            .receive(&event(
                24,
                "t3",
                "turn.started",
                json!({"inputId":"input-3"}),
            ))
            .unwrap();
        for (seq, id, failure_kind, payload) in [
            (
                25,
                "denied",
                "permission.resolved",
                json!({"decision":"deny","toolCallId":"denied"}),
            ),
            (
                28,
                "error",
                "tool.updated",
                json!({"kind":"error","toolCallId":"error","error":{"message":"Failure"}}),
            ),
        ] {
            state.receive(&event(seq, "t3", "model.streaming", json!({"kind":"tool_call","toolCallId":id,"toolName":"Write","input":{"file_path":"/workspace/denied.txt"}}))).unwrap();
            let failed = state
                .receive(&event(seq + 1, "t3", failure_kind, payload.clone()))
                .unwrap();
            assert_eq!(failed.messages.len(), 1);
            assert_eq!(failed.messages[0]["params"]["update"]["status"], "failed");
            assert!(
                state
                    .receive(&event(seq + 2, "t3", failure_kind, payload))
                    .unwrap()
                    .messages
                    .is_empty()
            );
        }
        state
            .receive(&event(
                31,
                "t3",
                "turn.completed",
                json!({"inputId":"input-3","resultType":"success","response":"Denied"}),
            ))
            .unwrap();
        state.finish("s1", &[]).unwrap();
        let mut wrong = job.clone();
        wrong["status"] = json!("failed");
        assert!(
            state
                .receive(&event(32, "foreign-turn", "session.updated", wrong.clone()))
                .unwrap()
                .messages
                .is_empty()
        );
        let failed = state
            .receive(&event(33, "t2", "session.updated", wrong))
            .unwrap();
        assert_eq!(
            failed.messages[0]["params"]["background"]["inputId"],
            "input-2"
        );
        assert_eq!(
            failed.messages[0]["params"]["background"]["taskId"],
            "task-bg"
        );
        assert_eq!(failed.messages[0]["params"]["update"]["status"], "failed");
        assert!(state.background.is_empty());
    }

    // This owner validates original hunk boundaries; the downstream shared
    // Diff admission test owns workspace paths and frozen adapter identity.
    #[test]
    fn edit_diff_requires_complete_native_patch_and_matching_tool_path() {
        let path = "/workspace/file.txt";
        let patch = json!({"kind":"file_diff","filePath":path,"truncated":false,"additions":1,"deletions":1,
            "structuredPatch":[{"oldStart":1,"oldLines":2,"newStart":1,"newLines":2,"lines":[" alpha","-beta","+gamma"]}]});
        assert!(
            structured_patch(path, &patch)
                .unwrap()
                .contains("@@ -1,2 +1,2 @@")
        );
        let update = tool_update(
            &json!({"toolName":"Edit","toolCallId":"edit","input":{"file_path":path}}),
            Some(&json!({"success":true,"display":patch})),
        )
        .unwrap();
        let payload = json!({"runtimeDiff":{"adapterKind":"zcode-app","protocolFamily":crate::zcode::PROTOCOL,
            "sourceEventKind":"tool.updated.result","semanticKind":"zcode_edit_patch","entries":update["_meta"]["zcodeDiff"]}});
        assert!(
            crate::runtime_diff::admit_runtime_diff(
                &payload,
                std::path::Path::new("/workspace"),
                Some("zcode-app")
            )
            .is_some_and(|result| result.is_ok())
        );
        let mut cases = Vec::new();
        let mut truncated = patch.clone();
        truncated["truncated"] = json!(true);
        cases.push(truncated);
        let mut path_mismatch = patch.clone();
        path_mismatch["filePath"] = json!("/other");
        cases.push(path_mismatch);
        let mut bad_counts = patch.clone();
        bad_counts["deletions"] = json!(2);
        cases.push(bad_counts);
        let mut bad_hunk = patch.clone();
        bad_hunk["structuredPatch"][0]["oldLines"] = json!(3);
        cases.push(bad_hunk);
        let mut injected = patch.clone();
        injected["structuredPatch"][0]["lines"][0] = json!(" context\n+invented");
        cases.push(injected);
        for case in cases {
            assert!(structured_patch(path, &case).is_none());
        }
        for name in ["Read", "Write", "Bash", "Unknown"] {
            let tool = json!({"toolName":name,"toolCallId":"call","input":{"file_path":path}});
            let update =
                tool_update(&tool, Some(&json!({"success":true,"display":patch}))).unwrap();
            assert!(update.get("_meta").is_none());
        }
    }
}
