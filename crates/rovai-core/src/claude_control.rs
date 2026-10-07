//! Native Claude Code stdio control protocol. Only unfinished permission
//! requests live here; ordinary tool activity belongs to the output parser.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    sync::{Notify, mpsc, oneshot},
    time::Duration,
};

use crate::claude::ClaudeCodeRuntimeEvent;

pub(crate) const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const RUN_END_TIMEOUT: Duration = Duration::from_secs(600);
pub(crate) const EXIT_TIMEOUT: Duration = Duration::from_secs(10);

struct PendingPermission {
    input: Value,
    remember_response_digests: HashSet<String>,
}

#[derive(Default)]
struct ControlState {
    initialized: bool,
    prompt_sent: bool,
    closed: bool,
    closing: bool,
    pending: HashMap<String, PendingPermission>,
    session_state: Option<String>,
    has_result: bool,
    turn_in_progress: bool,
    tasks: HashSet<String>,
    end_wait_started_at: Option<tokio::time::Instant>,
}

impl ControlState {
    fn refresh_end_wait(&mut self) {
        self.end_wait_started_at = (self.has_result
            && !self.turn_in_progress
            && self.tasks.is_empty()
            && self.pending.is_empty())
        .then(tokio::time::Instant::now);
    }

    fn run_ended(&self) -> bool {
        self.prompt_sent
            && self.has_result
            && !self.turn_in_progress
            && self.session_state.as_deref() == Some("idle")
            && self.tasks.is_empty()
            && self.pending.is_empty()
    }
}

pub(crate) struct ControlWrite {
    frame: Option<Value>,
    permission_request_id: Option<String>,
    acknowledged: Option<oneshot::Sender<std::result::Result<(), String>>>,
}

pub(crate) struct ClaudeControl {
    credential_redactor: Option<rovai_core::runtime_custom_api::CredentialRedactor>,
    session_id: String,
    permission_mode: String,
    initialize_id: String,
    initialization: Mutex<Option<oneshot::Sender<std::result::Result<Value, String>>>>,
    state: Mutex<ControlState>,
    writer: mpsc::UnboundedSender<ControlWrite>,
    changed: Notify,
    events: Option<mpsc::UnboundedSender<ClaudeCodeRuntimeEvent>>,
}

impl ClaudeControl {
    pub(crate) fn new(
        session_id: String,
        permission_mode: String,
        events: Option<mpsc::UnboundedSender<ClaudeCodeRuntimeEvent>>,
    ) -> (
        Arc<Self>,
        impl std::future::Future<Output = Result<Value>>,
        mpsc::UnboundedReceiver<ControlWrite>,
    ) {
        let (writer, receiver) = mpsc::unbounded_channel();
        let (initialized, initialization) = oneshot::channel();
        let control = Arc::new(Self {
            credential_redactor: None,
            session_id,
            permission_mode,
            initialize_id: format!("rovai-initialize-{}", uuid::Uuid::new_v4()),
            initialization: Mutex::new(Some(initialized)),
            state: Mutex::new(ControlState::default()),
            writer,
            changed: Notify::new(),
            events,
        });
        let ready = async move {
            initialization
                .await
                .context("Claude Code initialization channel closed")?
                .map_err(anyhow::Error::msg)
        };
        (control, ready, receiver)
    }

    pub(crate) fn set_credential_redactor(
        &mut self,
        redactor: Option<rovai_core::runtime_custom_api::CredentialRedactor>,
    ) {
        self.credential_redactor = redactor;
    }

    pub(crate) fn redact_frame(&self, value: &Value) -> Result<Vec<u8>> {
        let mut value = value.clone();
        if let Some(redactor) = &self.credential_redactor {
            redactor.value(&mut value);
        }
        Ok(serde_json::to_vec(&value)?)
    }

    pub(crate) fn redact_text(&self, value: &str) -> String {
        self.credential_redactor
            .as_ref()
            .map_or_else(|| value.to_owned(), |redactor| redactor.text(value))
    }

    fn emit(&self, event_type: &'static str, mut payload: Value) {
        if let Some(redactor) = &self.credential_redactor {
            redactor.value(&mut payload);
        }
        if let Some(events) = &self.events {
            let _ = events.send(ClaudeCodeRuntimeEvent {
                event_type,
                payload,
            });
        }
    }

    pub(crate) async fn initialize(&self) -> Result<()> {
        self.write(
            json!({"type": "control_request", "request_id": self.initialize_id,
            "request": {"subtype": "initialize"}}),
            None,
        )
        .await
    }

    pub(crate) async fn send_prompt(&self, prompt: &str) -> Result<()> {
        {
            let mut state = self.state.lock().unwrap();
            if !state.initialized || state.closed || state.prompt_sent {
                bail!("Claude Code control protocol is not ready for input");
            }
            state.prompt_sent = true;
            // The initialize response's idle describes the empty session, not
            // completion of the user message we are about to write.
            state.session_state = None;
        }
        self.write(
            json!({"type": "user", "session_id": self.session_id,
            "parent_tool_use_id": null, "uuid": uuid::Uuid::new_v4().to_string(),
            "message": {"role": "user", "content": prompt}}),
            None,
        )
        .await
    }

    async fn write(&self, frame: Value, permission_request_id: Option<String>) -> Result<()> {
        let (acknowledged, received) = oneshot::channel();
        self.writer
            .send(ControlWrite {
                frame: Some(frame),
                permission_request_id,
                acknowledged: Some(acknowledged),
            })
            .context("Claude Code stdin writer is unavailable")?;
        tokio::time::timeout(EXIT_TIMEOUT + Duration::from_secs(1), received)
            .await
            .context("Claude Code stdin write timed out")?
            .context("Claude Code stdin writer disconnected")?
            .map_err(anyhow::Error::msg)
    }

    pub(crate) async fn respond(&self, id: Value, decision: Value) -> Result<()> {
        let id = id
            .as_str()
            .context("Claude permission request ID is not a string")?;
        {
            let state = self.state.lock().unwrap();
            if state.closed {
                bail!("Claude Code control channel is closed");
            }
            let pending = state
                .pending
                .get(id)
                .context("Claude permission request is no longer pending")?;
            match decision.get("behavior").and_then(Value::as_str) {
                Some("allow")
                    if decision.get("updatedInput") == Some(&pending.input)
                        && (decision.get("updatedPermissions").is_none()
                            || pending
                                .remember_response_digests
                                .contains(&crate::command::canonical_json_digest(&decision)?)) => {}
                Some("deny") if decision.get("message").and_then(Value::as_str).is_some() => {}
                _ => bail!("Claude permission decision changed the reviewed input or rules"),
            }
        }
        self.write(success_response(id, decision), Some(id.to_string()))
            .await
    }

    /// Routes controls synchronously. Approval waiting happens in Core; this
    /// function never awaits a user decision or a stdin write.
    pub(crate) fn route(&self, frame: &Value) -> Result<bool> {
        match frame.get("type").and_then(Value::as_str) {
            Some("control_response") => {
                let response = frame
                    .get("response")
                    .context("Claude control response has no response")?;
                if response.get("request_id").and_then(Value::as_str) != Some(&self.initialize_id) {
                    bail!("Claude Code returned an unknown control response ID");
                }
                let sender = self
                    .initialization
                    .lock()
                    .unwrap()
                    .take()
                    .context("Claude Code repeated its initialize response")?;
                let result = if response.get("subtype").and_then(Value::as_str) == Some("success")
                    && response.get("response").is_some_and(Value::is_object)
                {
                    let mode = response["response"]
                        .get("current_permission_mode")
                        .and_then(Value::as_str);
                    if mode.is_some_and(|mode| mode != self.permission_mode) {
                        Err("Claude Code initialized with a different permission mode".to_string())
                    } else {
                        self.state.lock().unwrap().initialized = true;
                        Ok(response["response"].clone())
                    }
                } else {
                    Err("Claude Code rejected protocol initialization".to_string())
                };
                let _ = sender.send(result);
            }
            Some("control_request") => {
                let id = nonempty(frame.get("request_id"))
                    .context("Claude control request has no request_id")?;
                let request = frame
                    .get("request")
                    .context("Claude control request has no request")?;
                let mut state = self.state.lock().unwrap();
                if state.closed {
                    bail!("Claude Code requested permission after channel closure");
                }
                if state.pending.contains_key(id) {
                    bail!("Claude Code repeated a pending request_id");
                }
                if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
                    drop(state);
                    self.enqueue(json!({"type":"control_response","response":{
                        "subtype":"error","request_id":id,"error":"Unsupported Claude control request"}}))?;
                    return Ok(true);
                }
                let compatible = self.events.is_some()
                    && state.initialized
                    && state.prompt_sent
                    && nonempty(request.get("tool_use_id")).is_some()
                    && nonempty(request.get("tool_name")).is_some()
                    && request.get("input").is_some_and(Value::is_object)
                    && frame
                        .get("session_id")
                        .is_none_or(|value| value.as_str() == Some(&self.session_id));
                if !compatible {
                    drop(state);
                    self.enqueue(success_response(
                        id,
                        crate::claude_permission::deny_decision(
                            "Claude Code 原生权限请求缺少可靠工具 ID 或有效会话绑定，操作已拒绝",
                        ),
                    ))?;
                    self.emit(
                        "runtime.diagnostic",
                        json!({"diagnosticId":"claude-permission",
                        "code":"runtime_permission_incompatible","status":"failed",
                        "summary":"Claude Code 原生权限请求不兼容，操作已拒绝"}),
                    );
                    return Ok(true);
                }
                state.pending.insert(
                    id.to_string(),
                    PendingPermission {
                        input: request["input"].clone(),
                        remember_response_digests:
                            crate::claude_permission::remembered_permission_options(
                                request,
                                &request["input"],
                            )?
                            .into_iter()
                            .map(|option| option.native_response_digest)
                            .collect(),
                    },
                );
                state.refresh_end_wait();
                drop(state);
                self.emit(
                    "claude.permission_request",
                    json!({
                        "nativeSessionId": self.session_id, "controlRequest": frame,
                    }),
                );
            }
            Some("control_cancel_request") => {
                let id = nonempty(frame.get("request_id"))
                    .context("Claude control cancellation has no request_id")?;
                let removed = {
                    let mut state = self.state.lock().unwrap();
                    let removed = state.pending.remove(id).is_some();
                    if removed {
                        state.refresh_end_wait();
                    }
                    removed
                };
                if removed {
                    self.emit_cancel(id);
                }
                self.maybe_close()?;
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    fn emit_cancel(&self, id: &str) {
        self.emit(
            "claude.permission_cancelled",
            json!({"nativeSessionId":self.session_id,"requestId":id}),
        );
    }

    fn enqueue(&self, frame: Value) -> Result<()> {
        self.writer
            .send(ControlWrite {
                frame: Some(frame),
                permission_request_id: None,
                acknowledged: None,
            })
            .context("Claude Code stdin writer is unavailable")
    }

    pub(crate) fn observe(&self, frame: &Value) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let kind = frame.get("type").and_then(Value::as_str);
        if kind == Some("system") {
            match frame.get("subtype").and_then(Value::as_str) {
                Some("session_state_changed") => {
                    if frame.get("session_id").and_then(Value::as_str) != Some(&self.session_id) {
                        bail!("Claude Code session state is outside the active session");
                    }
                    let value = frame
                        .get("state")
                        .and_then(Value::as_str)
                        .filter(|s| matches!(*s, "idle" | "running" | "requires_action"))
                        .context("Claude Code emitted an unsupported session state")?;
                    state.session_state = Some(value.to_string());
                    state.refresh_end_wait();
                }
                Some("task_started")
                    if matches!(
                        frame.get("task_type").and_then(Value::as_str),
                        Some("local_agent" | "local_workflow")
                    ) =>
                {
                    if let Some(id) = nonempty(frame.get("task_id")) {
                        state.tasks.insert(id.to_string());
                        state.refresh_end_wait();
                    }
                }
                Some("task_notification") => {
                    if let Some(id) = nonempty(frame.get("task_id")) {
                        state.tasks.remove(id);
                        state.refresh_end_wait();
                    }
                }
                Some("task_updated")
                    if matches!(
                        frame.pointer("/patch/status").and_then(Value::as_str),
                        Some("completed" | "failed" | "stopped" | "cancelled")
                    ) =>
                {
                    if let Some(id) = nonempty(frame.get("task_id")) {
                        state.tasks.remove(id);
                        state.refresh_end_wait();
                    }
                }
                _ => {}
            }
        }
        if kind == Some("result") {
            state.has_result = true;
            state.turn_in_progress = false;
            state.refresh_end_wait();
        } else if matches!(kind, Some("assistant" | "stream_event"))
            && frame.get("parent_tool_use_id").is_none_or(Value::is_null)
        {
            state.turn_in_progress = true;
            state.refresh_end_wait();
        }
        drop(state);
        self.maybe_close()
    }

    pub(crate) fn run_end_deadline(&self) -> Option<tokio::time::Instant> {
        let state = self.state.lock().unwrap();
        if state.closed
            || state.turn_in_progress
            || !state.pending.is_empty()
            || !state.tasks.is_empty()
        {
            return None;
        }
        state.end_wait_started_at.map(|at| {
            at + if state.session_state.is_none() {
                EXIT_TIMEOUT
            } else {
                RUN_END_TIMEOUT
            }
        })
    }

    pub(crate) async fn wait_for_state_change(&self) {
        self.changed.notified().await;
    }

    fn maybe_close(&self) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.run_ended() && !state.closing && !state.closed {
            state.closing = true;
            self.writer
                .send(ControlWrite {
                    frame: None,
                    permission_request_id: None,
                    acknowledged: None,
                })
                .context("Claude Code stdin writer is unavailable")?;
        }
        Ok(())
    }

    pub(crate) fn disconnect(&self) {
        let ids = {
            let mut state = self.state.lock().unwrap();
            state.closed = true;
            state.end_wait_started_at = None;
            state.pending.drain().map(|(id, _)| id).collect::<Vec<_>>()
        };
        for id in ids {
            self.emit_cancel(&id);
        }
        self.changed.notify_one();
        if let Some(sender) = self.initialization.lock().unwrap().take() {
            let _ = sender.send(Err("Claude Code disconnected before initialization".into()));
        }
    }
}

fn nonempty(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
}

fn success_response(id: &str, decision: Value) -> Value {
    json!({"type":"control_response","response":{
        "subtype":"success","request_id":id,"response":decision}})
}

pub(crate) async fn write_control_stream<W: AsyncWrite + Unpin>(
    mut stdin: W,
    control: Arc<ClaudeControl>,
    mut receiver: mpsc::UnboundedReceiver<ControlWrite>,
) -> Result<()> {
    while let Some(write) = receiver.recv().await {
        let Some(frame) = write.frame else {
            let close = {
                let mut state = control.state.lock().unwrap();
                if state.run_ended() {
                    state.closed = true;
                    true
                } else {
                    state.closing = false;
                    false
                }
            };
            if close {
                stdin
                    .shutdown()
                    .await
                    .context("failed to close Claude Code stdin at session end")?;
                return Ok(());
            }
            continue;
        };
        let permitted = {
            let state = control.state.lock().unwrap();
            !state.closed
                && write
                    .permission_request_id
                    .as_ref()
                    .is_none_or(|id| state.pending.contains_key(id))
        };
        if !permitted {
            if let Some(ack) = write.acknowledged {
                let _ = ack.send(Err(
                    "Claude permission request was cancelled or disconnected".into(),
                ));
            }
            continue;
        }
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        let result = tokio::time::timeout(EXIT_TIMEOUT, async {
            stdin.write_all(&bytes).await?;
            stdin.flush().await
        })
        .await
        .map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Claude Code stdin write timed out",
            )
        })
        .and_then(|result| result);
        if let Some(id) = write.permission_request_id.as_ref() {
            let mut state = control.state.lock().unwrap();
            state.pending.remove(id);
            state.refresh_end_wait();
            control.changed.notify_one();
        }
        if let Some(ack) = write.acknowledged {
            let _ = ack.send(result.as_ref().map(|_| ()).map_err(ToString::to_string));
        }
        result.context("failed to write Claude Code control JSON")?;
        control.maybe_close()?;
    }
    bail!("Claude Code stdin writer lost its control channel")
}

pub(crate) struct ControlReadGuard(pub(crate) Arc<ClaudeControl>);
impl Drop for ControlReadGuard {
    fn drop(&mut self) {
        self.0.disconnect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission(id: &str, tool_id: Value) -> Value {
        json!({"type":"control_request","request_id":id,"request":{
            "subtype":"can_use_tool","tool_use_id":tool_id,"tool_name":"Bash",
            "input":{"command":"rovai send --public-only --body same"}}})
    }

    #[test]
    fn incompatible_initialization_and_missing_tool_identity_never_admit_permission() {
        for response in [
            json!({"subtype":"error","error":"unsupported"}),
            json!({"subtype":"success","response":{"current_permission_mode":"bypassPermissions"}}),
        ] {
            let (control, _ready, mut writes) =
                ClaudeControl::new("session".into(), "acceptEdits".into(), None);
            let mut response = response;
            response["request_id"] = json!(control.initialize_id);
            control
                .route(&json!({"type":"control_response","response":response}))
                .unwrap();
            control
                .route(&permission("before-init", json!("tool")))
                .unwrap();
            let denial = writes.try_recv().unwrap().frame.unwrap();
            assert_eq!(denial["response"]["request_id"], "before-init");
            assert_eq!(denial["response"]["response"]["behavior"], "deny");
        }
        for id in [Value::Null, json!(""), json!(" "), json!(5)] {
            let (events, mut received) = mpsc::unbounded_channel();
            let (control, _ready, mut writes) =
                ClaudeControl::new("session".into(), "acceptEdits".into(), Some(events));
            control
                .route(&json!({"type":"control_response","response":{
                "subtype":"success","request_id":control.initialize_id,"response":{}}}))
                .unwrap();
            control.state.lock().unwrap().prompt_sent = true;
            control.route(&permission("missing-id", id)).unwrap();
            assert_eq!(
                writes.try_recv().unwrap().frame.unwrap()["response"]["response"]["behavior"],
                "deny"
            );
            assert_eq!(
                received.try_recv().unwrap().payload["code"],
                "runtime_permission_incompatible"
            );
            assert!(received.try_recv().is_err());
        }
    }

    // Owns the writer/reader seam: concurrent decisions, cancellation of a
    // queued write, and EOF fencing cannot be proved by the conversion parser.
    #[cfg(feature = "extended-tests")]
    #[tokio::test(start_paused = true)]
    async fn native_decisions_are_serialized_by_id_and_close_only_after_the_last_idle_result() {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let (events, mut received) = mpsc::unbounded_channel();
        let (control, ready, writes) =
            ClaudeControl::new("session".into(), "acceptEdits".into(), Some(events));
        let (stdin, output) = tokio::io::duplex(8192);
        let mut output = BufReader::new(output);
        let writer = tokio::spawn(write_control_stream(stdin, control.clone(), writes));
        let initialize = tokio::spawn({
            let control = control.clone();
            async move {
                control.initialize().await?;
                ready.await
            }
        });
        let mut line = String::new();
        output.read_line(&mut line).await.unwrap();
        let init: Value = serde_json::from_str(&line).unwrap();
        control.route(&json!({"type":"control_response","response":{
            "subtype":"success","request_id":init["request_id"],"response":{"current_permission_mode":"acceptEdits"}}})).unwrap();
        initialize.await.unwrap().unwrap();
        let prompt = tokio::spawn({
            let control = control.clone();
            async move { control.send_prompt("中文\nline two").await }
        });
        line.clear();
        output.read_line(&mut line).await.unwrap();
        let user: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(user["message"]["content"], "中文\nline two");
        prompt.await.unwrap().unwrap();
        control.observe(&json!({"type":"system","subtype":"session_state_changed","session_id":"session","state":"running"})).unwrap();
        // Cross the retired cache's cumulative limit before two identical inputs.
        for index in 0..256 {
            control.observe(&json!({"type":"assistant","message":{"content":[{
                "type":"tool_use","id":format!("ordinary-{index}"),"name":"Read","input":{"file_path":"file"}}]}})).unwrap();
        }
        let suggestion = json!({"type":"addRules", "behavior":"allow", "destination":"localSettings",
            "rules":[{"toolName":"Bash", "ruleContent":"rovai send *"}]});
        for (id, tool) in [("request-a", "tool-a"), ("request-b", "tool-b")] {
            let mut frame = permission(id, json!(tool));
            if id == "request-a" {
                frame["request"]["permission_suggestions"] = json!([suggestion]);
            }
            control.route(&frame).unwrap();
            let event = received.recv().await.unwrap();
            assert_eq!(
                event.payload["controlRequest"]["request"]["tool_use_id"],
                tool
            );
        }
        control.observe(&json!({"type":"result"})).unwrap();
        tokio::time::advance(RUN_END_TIMEOUT + Duration::from_secs(1)).await;
        assert!(
            control.run_end_deadline().is_none(),
            "user Approval pauses the end timer"
        );
        let allow = json!({"behavior":"allow","updatedInput":{"command":"rovai send --public-only --body same"}});
        let mut remember = allow.clone();
        remember["updatedPermissions"] = json!([suggestion]);
        assert!(
            control
                .respond(json!("request-b"), remember.clone())
                .await
                .is_err(),
            "another native request cannot borrow a suggested rule"
        );
        let mut changed_rule = remember.clone();
        changed_rule["updatedPermissions"][0]["rules"][0]["ruleContent"] = json!("*");
        assert!(
            control
                .respond(json!("request-a"), changed_rule)
                .await
                .is_err(),
            "a remembered rule cannot be widened after review"
        );
        let mut changed_destination = remember.clone();
        changed_destination["updatedPermissions"][0]["destination"] = json!("userSettings");
        assert!(
            control
                .respond(json!("request-a"), changed_destination)
                .await
                .is_err(),
            "a remembered rule cannot change its destination after review"
        );
        let (a, b) = tokio::join!(
            control.respond(json!("request-a"), remember.clone()),
            control.respond(
                json!("request-b"),
                crate::claude_permission::deny_decision("Denied")
            )
        );
        a.unwrap();
        b.unwrap();
        let mut ids = HashSet::new();
        for _ in 0..2 {
            line.clear();
            output.read_line(&mut line).await.unwrap();
            let frame: Value = serde_json::from_str(&line).unwrap();
            if frame["response"]["request_id"] == "request-a" {
                assert_eq!(frame["response"]["response"], remember);
            }
            ids.insert(
                frame["response"]["request_id"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        assert_eq!(
            ids,
            HashSet::from(["request-a".to_string(), "request-b".to_string()])
        );
        assert!(
            control
                .respond(json!("tool-a"), allow.clone())
                .await
                .is_err()
        );
        let mut suppressed = permission("cancelled", json!("tool-c"));
        suppressed["request"]["permission_suggestions"] = json!([suggestion]);
        suppressed["request"]["suppress_always_allow_rule"] = json!(true);
        control.route(&suppressed).unwrap();
        let _ = received.recv().await;
        assert!(
            control.respond(json!("cancelled"), remember).await.is_err(),
            "the writer also honors the native suppression"
        );
        control
            .route(&json!({"type":"control_cancel_request","request_id":"cancelled"}))
            .unwrap();
        assert_eq!(
            received.recv().await.unwrap().event_type,
            "claude.permission_cancelled"
        );
        assert!(
            control
                .respond(json!("cancelled"), allow.clone())
                .await
                .is_err()
        );
        for id in ["background-patch", "background-notification"] {
            control.observe(&json!({"type":"system","subtype":"task_started","task_type":"local_agent","task_id":id})).unwrap();
        }
        control.observe(&json!({"type":"result"})).unwrap();
        tokio::time::advance(RUN_END_TIMEOUT + Duration::from_secs(1)).await;
        assert!(
            control.run_end_deadline().is_none(),
            "tracked tasks pause the end timer"
        );
        line.clear();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), output.read_line(&mut line))
                .await
                .is_err(),
            "an early result must not close stdin"
        );
        control.observe(&json!({"type":"system","subtype":"task_updated","task_id":"background-patch","patch":{"status":"completed"}})).unwrap();
        assert!(control.run_end_deadline().is_none());
        control.observe(&json!({"type":"system","subtype":"task_notification","task_id":"background-notification"})).unwrap();
        assert!(control.run_end_deadline().unwrap() > tokio::time::Instant::now());
        control.observe(&json!({"type":"assistant"})).unwrap();
        assert!(control.run_end_deadline().is_none());
        control.observe(&json!({"type":"result"})).unwrap();
        line.clear();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), output.read_line(&mut line))
                .await
                .is_err(),
            "the final result still needs session idle"
        );
        control.observe(&json!({"type":"system","subtype":"session_state_changed","session_id":"session","state":"idle"})).unwrap();
        tokio::time::timeout(EXIT_TIMEOUT, writer)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        line.clear();
        assert_eq!(output.read_line(&mut line).await.unwrap(), 0);
        assert!(control.respond(json!("request-a"), allow).await.is_err());
    }

    #[cfg(feature = "extended-tests")]
    #[tokio::test]
    async fn cancelled_queued_decisions_and_disconnect_never_write_late_allowances() {
        let (events, mut received) = mpsc::unbounded_channel();
        let (control, _ready, mut writes) =
            ClaudeControl::new("session".into(), "acceptEdits".into(), Some(events));
        control
            .route(&json!({"type":"control_response","response":{
            "subtype":"success","request_id":control.initialize_id,"response":{}}}))
            .unwrap();
        control.state.lock().unwrap().prompt_sent = true;
        let suggestion = json!({"type":"addRules", "behavior":"allow", "destination":"localSettings",
            "rules":[{"toolName":"Bash", "ruleContent":"rovai send *"}]});
        let allow = json!({"behavior":"allow","updatedInput":{"command":"rovai send --public-only --body same"},
            "updatedPermissions":[suggestion]});
        for disconnected in [false, true] {
            let mut frame = permission("pending", json!("tool"));
            frame["request"]["permission_suggestions"] = json!([suggestion]);
            control.route(&frame).unwrap();
            let _ = received.recv().await;
            let response = tokio::spawn({
                let control = control.clone();
                let allow = allow.clone();
                async move { control.respond(json!("pending"), allow).await }
            });
            // Wait for the exact queued decision before withdrawing its ID.
            let queued = writes.recv().await.unwrap();
            if disconnected {
                control.disconnect();
            } else {
                control
                    .route(&json!({"type":"control_cancel_request","request_id":"pending"}))
                    .unwrap();
            }
            assert_eq!(
                received.recv().await.unwrap().event_type,
                "claude.permission_cancelled"
            );
            let (stdin, mut output) = tokio::io::duplex(1024);
            let (sender, receiver) = mpsc::unbounded_channel();
            sender.send(queued).unwrap();
            drop(sender);
            assert!(
                write_control_stream(stdin, control.clone(), receiver)
                    .await
                    .is_err()
            );
            assert!(response.await.unwrap().is_err());
            let mut bytes = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut output, &mut bytes)
                .await
                .unwrap();
            assert!(bytes.is_empty());
        }
    }
}
