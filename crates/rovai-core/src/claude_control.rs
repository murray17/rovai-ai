//! Native Claude Code stdio control protocol. Pending permission requests and
//! input receipts live here; ordinary tool activity belongs to the output parser.

use std::{
    collections::{HashMap, HashSet},
    future::poll_fn,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Poll, Waker},
};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    sync::{mpsc, oneshot},
    time::Duration,
};

use crate::claude::ClaudeCodeRuntimeEvent;

pub(crate) const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const EXIT_TIMEOUT: Duration = Duration::from_secs(10);

struct PendingPermission {
    input: Value,
    remember_response_digests: HashSet<String>,
}

struct PendingSteer {
    receipt: oneshot::Sender<Result<String>>,
    write_started: bool,
}

#[derive(Default)]
struct ControlState {
    initialized: bool,
    prompt_sent: bool,
    input_fenced: bool,
    steering: HashMap<String, PendingSteer>,
    input_writer: Option<Waker>,
    closed: bool,
    closing: bool,
    pending: HashMap<String, PendingPermission>,
    questionnaire_requests: HashSet<String>,
    session_state: Option<String>,
    has_result: bool,
    turn_in_progress: bool,
    tasks: HashSet<String>,
}

impl ControlState {
    fn wake_input_writer(&mut self) {
        if let Some(waker) = self.input_writer.take() {
            waker.wake();
        }
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
    steer_id: Option<String>,
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

    pub(crate) fn redact_text(&self, value: &str) -> String {
        self.credential_redactor
            .as_ref()
            .map_or_else(|| value.to_owned(), |redactor| redactor.text(value))
    }

    fn emit(&self, event_type: &'static str, payload: Value) {
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

    pub(crate) fn fence_active_input(&self) {
        let mut state = self.state.lock().unwrap();
        state.input_fenced = true;
        state.wake_input_writer();
    }

    pub(crate) async fn steer(&self, input_id: &str, prompt: &str) -> Result<String> {
        let id = input_id.to_string();
        let (sender, receipt) = oneshot::channel();
        {
            let mut state = self.state.lock().unwrap();
            if !state.prompt_sent || state.closed || state.closing || state.input_fenced {
                return Err(rovai_core::steer::ActiveInputNotAccepted.into());
            }
            state.steering.insert(
                id.clone(),
                PendingSteer {
                    receipt: sender,
                    write_started: false,
                },
            );
            // Register and enqueue under the same lock as the terminal fence.
            self.writer
                .send(ControlWrite {
                    frame: Some(json!({"type":"user","session_id":self.session_id,
                    "parent_tool_use_id":null,"uuid":id,
                    "message":{"role":"user","content":prompt}})),
                    permission_request_id: None,
                    steer_id: Some(id.clone()),
                    acknowledged: None,
                })
                .context("Claude Code input writer is unavailable")?;
        }
        let result = receipt
            .await
            .context("Claude Code input receipt disconnected")?;
        self.state.lock().unwrap().steering.remove(&id);
        result
    }

    async fn write(&self, frame: Value, permission_request_id: Option<String>) -> Result<()> {
        let (acknowledged, received) = oneshot::channel();
        self.writer
            .send(ControlWrite {
                frame: Some(frame),
                permission_request_id,
                steer_id: None,
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

    pub(crate) fn has_unsupported_questionnaire(&self) -> bool {
        !self.state.lock().unwrap().questionnaire_requests.is_empty()
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
                if state.questionnaire_requests.contains(id) {
                    return Ok(true);
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
                if request["tool_name"] == "AskUserQuestion" {
                    state.questionnaire_requests.insert(id.to_string());
                    drop(state);
                    self.enqueue(success_response(
                        id,
                        crate::claude_permission::deny_decision(
                            "暂不支持原生问卷，请通过对话询问用户",
                        ),
                    ))?;
                    self.emit(
                        "runtime.diagnostic",
                        json!({"diagnosticId":"claude-questionnaire",
                            "code":"runtime_questionnaire_unsupported","status":"failed",
                            "summary":"客户端不支持原生问卷，未提交答案"}),
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
                let removed = self.state.lock().unwrap().pending.remove(id).is_some();
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
                steer_id: None,
                acknowledged: None,
            })
            .context("Claude Code stdin writer is unavailable")
    }

    pub(crate) fn observe(&self, frame: &Value) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let kind = frame.get("type").and_then(Value::as_str);
        if frame.get("session_id").and_then(Value::as_str) == Some(&self.session_id) {
            let ids: Vec<&str> =
                if kind == Some("user") && frame.get("isReplay") == Some(&Value::Bool(true)) {
                    frame
                        .get("uuid")
                        .and_then(Value::as_str)
                        .into_iter()
                        .collect()
                } else if kind == Some("result") {
                    frame
                        .get("user_message_uuids")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect()
                } else {
                    Vec::new()
                };
            for id in ids {
                if let Some(pending) = state.steering.remove(id) {
                    let _ = pending.receipt.send(Ok(id.to_string()));
                }
            }
        }
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
                }
                Some("task_started")
                    if matches!(
                        frame.get("task_type").and_then(Value::as_str),
                        Some("local_agent" | "local_workflow")
                    ) =>
                {
                    if let Some(id) = nonempty(frame.get("task_id")) {
                        state.tasks.insert(id.to_string());
                    }
                }
                Some("task_notification") => {
                    if let Some(id) = nonempty(frame.get("task_id")) {
                        state.tasks.remove(id);
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
                    }
                }
                _ => {}
            }
        }
        // A result ends one native foreground segment, not this managed Run.
        // Receipts stay correlated until the output stream actually disconnects.
        if kind == Some("result") {
            state.has_result = true;
            state.turn_in_progress = false;
        } else if matches!(kind, Some("assistant" | "stream_event"))
            && frame.get("parent_tool_use_id").is_none_or(Value::is_null)
        {
            state.turn_in_progress = true;
        }
        state.wake_input_writer();
        drop(state);
        self.maybe_close()
    }

    pub(crate) fn native_work_ended(&self) -> bool {
        self.state.lock().unwrap().run_ended()
    }

    fn maybe_close(&self) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.run_ended() && !state.closing && !state.closed {
            state.closing = true;
            self.writer
                .send(ControlWrite {
                    frame: None,
                    permission_request_id: None,
                    steer_id: None,
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
            for (_, pending) in state.steering.drain() {
                let error = if pending.write_started {
                    anyhow::anyhow!("Claude Code disconnected without this input's receipt")
                } else {
                    rovai_core::steer::ActiveInputNotAccepted.into()
                };
                let _ = pending.receipt.send(Err(error));
            }
            state.wake_input_writer();
            state.pending.drain().map(|(id, _)| id).collect::<Vec<_>>()
        };
        for id in ids {
            self.emit_cancel(&id);
        }
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
            let mut state = control.state.lock().unwrap();
            let steer_permitted = write.steer_id.is_none()
                || (!state.input_fenced
                    && !state.closed
                    && write
                        .steer_id
                        .as_ref()
                        .is_some_and(|id| state.steering.contains_key(id)));
            if !steer_permitted
                && let Some(id) = &write.steer_id
                && let Some(pending) = state.steering.remove(id)
            {
                let _ = pending
                    .receipt
                    .send(Err(rovai_core::steer::ActiveInputNotAccepted.into()));
            }
            steer_permitted
                && !state.closed
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
            let first_bytes = if let Some(id) = &write.steer_id {
                poll_fn(|cx| {
                    // A Pending poll wrote nothing. Recheck the managed Run
                    // boundary on every retry, under the same lock as the
                    // first actual write, never across an asynchronous wait.
                    let mut state = control.state.lock().unwrap();
                    if state.input_fenced || state.closed || !state.steering.contains_key(id) {
                        if let Some(pending) = state.steering.remove(id) {
                            let _ = pending
                                .receipt
                                .send(Err(rovai_core::steer::ActiveInputNotAccepted.into()));
                        }
                        state.input_writer = None;
                        return Poll::Ready(Ok(None));
                    }
                    match Pin::new(&mut stdin).poll_write(cx, &bytes) {
                        Poll::Pending => {
                            state.input_writer = Some(cx.waker().clone());
                            Poll::Pending
                        }
                        Poll::Ready(result) => {
                            state.input_writer = None;
                            Poll::Ready(result.and_then(|count| {
                                if count == 0 {
                                    return Err(std::io::ErrorKind::WriteZero.into());
                                }
                                state.steering.get_mut(id).unwrap().write_started = true;
                                // Invalidate the previously observed result/idle together.
                                // A delayed old idle alone cannot close this new input.
                                state.session_state = None;
                                state.has_result = false;
                                Ok(Some(count))
                            }))
                        }
                    }
                })
                .await?
            } else {
                Some(0)
            };
            let Some(first_bytes) = first_bytes else {
                return Ok(());
            };
            // Once any bytes cross stdin, complete the JSONL frame. Its
            // ownership still needs a native receipt; it is never retryable.
            stdin.write_all(&bytes[first_bytes..]).await?;
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
    #[cfg(feature = "extended-tests")]
    use std::future::Future;

    fn permission(id: &str, tool_id: Value) -> Value {
        json!({"type":"control_request","request_id":id,"request":{
            "subtype":"can_use_tool","tool_use_id":tool_id,"tool_name":"Bash",
            "input":{"command":"rovai send --public-only --body same"}}})
    }

    #[test]
    fn incompatible_initialization_and_missing_tool_identity_never_admit_permission() {
        for mode in [
            "manual",
            "acceptEdits",
            "bypassPermissions",
            "dontAsk",
            "plan",
            "auto",
        ] {
            let (events, mut received) = mpsc::unbounded_channel();
            let (control, _ready, mut writes) =
                ClaudeControl::new("session".into(), mode.into(), Some(events));
            control
                .route(&json!({"type":"control_response","response":{
                "subtype":"success","request_id":control.initialize_id,"response":{}}}))
                .unwrap();
            control.state.lock().unwrap().prompt_sent = true;
            let mut question = permission("question", json!("tool-question"));
            question["request"]["tool_name"] = json!("AskUserQuestion");
            question["request"]["input"] = json!({"questions":[]});
            question["session_id"] = json!("foreign-session");
            control.route(&question).unwrap();
            assert_eq!(
                writes.try_recv().unwrap().frame.unwrap()["response"]["response"]["behavior"],
                "deny"
            );
            assert!(
                !control.has_unsupported_questionnaire(),
                "foreign input cannot poison this Run"
            );
            assert_eq!(
                received.try_recv().unwrap().payload["code"],
                "runtime_permission_incompatible"
            );
            question["session_id"] = json!("session");
            control.route(&question).unwrap();
            control.route(&question).unwrap();
            assert!(control.has_unsupported_questionnaire());
            let denied = writes.try_recv().unwrap().frame.unwrap();
            assert_eq!(denied["response"]["response"]["behavior"], "deny");
            assert!(denied["response"]["response"].get("updatedInput").is_none());
            assert!(writes.try_recv().is_err(), "one receipt per questionnaire");
            assert_eq!(
                received.try_recv().unwrap().payload["code"],
                "runtime_questionnaire_unsupported"
            );
            assert!(
                received.try_recv().is_err(),
                "questionnaires create no permission Action"
            );
        }
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
        let (mut control, ready, writes) =
            ClaudeControl::new("session".into(), "acceptEdits".into(), Some(events));
        Arc::get_mut(&mut control)
            .unwrap()
            .set_credential_redactor(Some(
                rovai_core::runtime_custom_api::CredentialRedactor::from_values(vec![
                    "tool-a".into(),
                    "rovai send".into(),
                ]),
            ));
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
        let steer = tokio::spawn({
            let control = control.clone();
            async move { control.steer("input-attachment", "补充附件路径").await }
        });
        line.clear();
        output.read_line(&mut line).await.unwrap();
        let supplement: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(supplement["message"]["content"], "补充附件路径");
        assert!(!steer.is_finished(), "stdin flush is not native acceptance");
        control.observe(&json!({"type":"user","session_id":"other-session","isReplay":true,"uuid":supplement["uuid"]})).unwrap();
        assert!(
            !steer.is_finished(),
            "another session cannot acknowledge this source"
        );
        control.observe(&json!({"type":"user","session_id":"session","isReplay":true,"uuid":supplement["uuid"]})).unwrap();
        assert_eq!(
            steer.await.unwrap().unwrap(),
            supplement["uuid"].as_str().unwrap()
        );
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
        tokio::time::advance(Duration::from_secs(601)).await;
        assert!(
            !control.state.lock().unwrap().run_ended(),
            "pending user Approval keeps stdin open"
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
        tokio::time::advance(Duration::from_secs(601)).await;
        assert!(
            !control.state.lock().unwrap().run_ended(),
            "tracked tasks keep stdin open"
        );
        line.clear();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), output.read_line(&mut line))
                .await
                .is_err(),
            "an early result must not close stdin"
        );
        control.observe(&json!({"type":"system","subtype":"task_updated","task_id":"background-patch","patch":{"status":"completed"}})).unwrap();
        assert!(!control.state.lock().unwrap().run_ended());
        control.observe(&json!({"type":"system","subtype":"task_notification","task_id":"background-notification"})).unwrap();
        assert!(!control.state.lock().unwrap().run_ended());
        control.observe(&json!({"type":"assistant"})).unwrap();
        assert!(!control.state.lock().unwrap().run_ended());
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
        assert!(
            control
                .steer("late", "late")
                .await
                .unwrap_err()
                .is::<rovai_core::steer::ActiveInputNotAccepted>()
        );

        // Native segments may finish before the next input's replay. The Run
        // and UUID, not the foreground segment, own receipt correlation.
        for result_contains_input in [true, false] {
            let (control, _ready, writes) =
                ClaudeControl::new("review-session".into(), "acceptEdits".into(), None);
            {
                let mut state = control.state.lock().unwrap();
                state.initialized = true;
                state.prompt_sent = true;
                state.turn_in_progress = true;
                state.session_state = Some("running".into());
            }
            let (stdin, output) = tokio::io::duplex(8192);
            let mut output = BufReader::new(output);
            let writer = tokio::spawn(write_control_stream(stdin, control.clone(), writes));
            let steering = control.steer("input-b", "Continue this managed task");
            tokio::pin!(steering);
            poll_fn(|cx| {
                assert!(steering.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            let mut line = String::new();
            output.read_line(&mut line).await.unwrap();
            let input: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(input["uuid"], "input-b", "reuse Core's input identity");
            control.observe(&json!({"type":"result","session_id":"review-session",
                "user_message_uuids": if result_contains_input { json!(["input-b"]) } else { json!([]) }})).unwrap();
            assert!(!control.state.lock().unwrap().closed);
            if !result_contains_input {
                // A different Session and a different UUID cannot confirm B.
                control.observe(&json!({"type":"user","session_id":"other-session","isReplay":true,"uuid":"input-b"})).unwrap();
                control.observe(&json!({"type":"user","session_id":"review-session","isReplay":true,"uuid":"other-input"})).unwrap();
                poll_fn(|cx| {
                    assert!(steering.as_mut().poll(cx).is_pending());
                    Poll::Ready(())
                })
                .await;
            }
            control.observe(&json!({"type":"user","session_id":"review-session","isReplay":true,"uuid":"input-b"})).unwrap();
            assert_eq!(steering.await.unwrap(), "input-b");
            writer.abort();
            let _ = writer.await;
        }
        // Inputs already queued and new inputs remain FIFO across a result.
        let (control, _ready, writes) =
            ClaudeControl::new("queued-session".into(), "acceptEdits".into(), None);
        {
            let mut state = control.state.lock().unwrap();
            state.initialized = true;
            state.prompt_sent = true;
            state.turn_in_progress = true;
            state.session_state = Some("running".into());
        }
        let queued = control.steer("queued-b", "B");
        tokio::pin!(queued);
        poll_fn(|cx| {
            assert!(queued.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        control
            .observe(&json!({"type":"result","session_id":"queued-session"}))
            .unwrap();
        let next = control.steer("queued-c", "C");
        tokio::pin!(next);
        poll_fn(|cx| {
            assert!(next.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        let (stdin, output) = tokio::io::duplex(8192);
        let mut output = BufReader::new(output);
        let writer = tokio::spawn(write_control_stream(stdin, control.clone(), writes));
        for (id, body) in [("queued-b", "B"), ("queued-c", "C")] {
            let mut line = String::new();
            output.read_line(&mut line).await.unwrap();
            let input: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(input["message"]["content"], body);
            assert_eq!(input["uuid"], id);
        }
        // Receipt waiting has no foreground-duration deadline of its own.
        control
            .observe(&json!({"type":"assistant","session_id":"queued-session"}))
            .unwrap();
        tokio::time::advance(Duration::from_secs(601)).await;
        poll_fn(|cx| {
            assert!(queued.as_mut().poll(cx).is_pending());
            assert!(next.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        // A reliable result + idle closes the stream even with missing receipts.
        control
            .observe(&json!({"type":"result","session_id":"queued-session"}))
            .unwrap();
        control.observe(&json!({"type":"system","subtype":"session_state_changed","session_id":"queued-session","state":"idle"})).unwrap();
        writer.await.unwrap().unwrap();
        let mut line = String::new();
        assert_eq!(output.read_line(&mut line).await.unwrap(), 0);
        // Root exit fences new input, but stdout may still contain a final replay.
        control.fence_active_input();
        control.observe(&json!({"type":"user","session_id":"queued-session","isReplay":true,"uuid":"queued-b"})).unwrap();
        assert_eq!(queued.await.unwrap(), "queued-b");
        control.disconnect();
        let error = next.await.unwrap_err();
        assert!(!error.is::<rovai_core::steer::ActiveInputNotAccepted>());
        control.observe(&json!({"type":"user","session_id":"queued-session","isReplay":true,"uuid":"queued-c"})).unwrap();
        assert!(control.state.lock().unwrap().steering.is_empty());

        // A writer can have dequeued the frame while the pipe still accepts
        // zero bytes. Exercise that boundary separately from a partial write.
        #[derive(Default)]
        struct Pipe {
            bytes: Vec<u8>,
            available: usize,
            closed: bool,
        }
        struct GatedWriter(Arc<Mutex<Pipe>>);
        #[derive(Default)]
        struct WriteWake(std::sync::atomic::AtomicBool);
        impl std::task::Wake for WriteWake {
            fn wake(self: Arc<Self>) {
                self.0.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
        impl AsyncWrite for GatedWriter {
            fn poll_write(
                self: std::pin::Pin<&mut Self>,
                _cx: &mut std::task::Context<'_>,
                bytes: &[u8],
            ) -> std::task::Poll<std::io::Result<usize>> {
                let mut pipe = self.0.lock().unwrap();
                if pipe.available == 0 {
                    return std::task::Poll::Pending;
                }
                let size = pipe.available.min(bytes.len());
                pipe.bytes.extend_from_slice(&bytes[..size]);
                pipe.available -= size;
                std::task::Poll::Ready(Ok(size))
            }
            fn poll_flush(
                self: std::pin::Pin<&mut Self>,
                _cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Ready(Ok(()))
            }
            fn poll_shutdown(
                self: std::pin::Pin<&mut Self>,
                _cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                self.0.lock().unwrap().closed = true;
                std::task::Poll::Ready(Ok(()))
            }
        }
        for initial_bytes in [0, 1] {
            for cancelled in [false, true] {
                let (control, _ready, writes) =
                    ClaudeControl::new("blocked-session".into(), "acceptEdits".into(), None);
                {
                    let mut state = control.state.lock().unwrap();
                    state.initialized = true;
                    state.prompt_sent = true;
                    state.turn_in_progress = true;
                    state.session_state = Some("running".into());
                    state.tasks.insert("background".into());
                }
                let pipe = Arc::new(Mutex::new(Pipe {
                    available: initial_bytes,
                    ..Pipe::default()
                }));
                let steering = control.steer("blocked-input", "BLOCKED_INPUT");
                let writer =
                    write_control_stream(GatedWriter(pipe.clone()), control.clone(), writes);
                tokio::pin!(steering, writer);
                let wake = Arc::new(WriteWake::default());
                let write_waker = Waker::from(wake.clone());
                // Explicit polls control the interleaving without scheduler sleeps.
                std::future::poll_fn(|cx| {
                    assert!(std::future::Future::poll(steering.as_mut(), cx).is_pending());
                    assert!(
                        std::future::Future::poll(
                            writer.as_mut(),
                            &mut std::task::Context::from_waker(&write_waker)
                        )
                        .is_pending()
                    );
                    std::task::Poll::Ready(())
                })
                .await;
                assert_eq!(pipe.lock().unwrap().bytes.len(), initial_bytes);
                if cancelled {
                    control.fence_active_input();
                    if initial_bytes == 0 {
                        assert!(
                            wake.0.load(std::sync::atomic::Ordering::Relaxed),
                            "cancellation wakes the blocked writer without pipe readiness"
                        );
                    }
                    std::future::poll_fn(|cx| {
                        assert!(std::future::Future::poll(writer.as_mut(), cx).is_pending());
                        std::task::Poll::Ready(())
                    })
                    .await;
                }
                control.observe(&json!({"type":"result","session_id":"blocked-session","user_message_uuids":[]})).unwrap();
                if initial_bytes == 0 {
                    assert!(
                        wake.0.load(std::sync::atomic::Ordering::Relaxed),
                        "result wakes the blocked writer without pipe readiness"
                    );
                }
                assert!(
                    !control.state.lock().unwrap().run_ended(),
                    "background task is still active"
                );
                assert!(!control.state.lock().unwrap().closed);
                control
                    .observe(&json!({"type":"assistant","session_id":"blocked-session"}))
                    .unwrap();
                pipe.lock().unwrap().available = usize::MAX;
                std::future::poll_fn(|cx| {
                    assert!(std::future::Future::poll(writer.as_mut(), cx).is_pending());
                    std::task::Poll::Ready(())
                })
                .await;
                if initial_bytes == 0 && cancelled {
                    assert!(
                        pipe.lock().unwrap().bytes.is_empty(),
                        "unblocked pipe must not receive the retired frame"
                    );
                } else {
                    let bytes = pipe.lock().unwrap().bytes.clone();
                    let frame: Value = serde_json::from_slice(&bytes).unwrap();
                    assert_eq!(frame["message"]["content"], "BLOCKED_INPUT");
                    assert_eq!(
                        bytes.iter().filter(|&&byte| byte == b'\n').count(),
                        1,
                        "partial frame completes once, never retried"
                    );
                }
                assert!(
                    !pipe.lock().unwrap().closed,
                    "result alone does not close the session"
                );
                control
                    .observe(&json!({"type":"result","session_id":"blocked-session"}))
                    .unwrap();
                control.observe(&json!({"type":"system","subtype":"task_notification","task_id":"background"})).unwrap();
                control.observe(&json!({"type":"system","subtype":"session_state_changed","session_id":"blocked-session","state":"idle"})).unwrap();
                writer.await.unwrap();
                assert!(pipe.lock().unwrap().closed);
                if !cancelled {
                    control.observe(&json!({"type":"user","session_id":"blocked-session","isReplay":true,"uuid":"blocked-input"})).unwrap();
                    assert_eq!(steering.await.unwrap(), "blocked-input");
                } else {
                    control.disconnect();
                    let error = steering.await.unwrap_err();
                    assert_eq!(
                        error.is::<rovai_core::steer::ActiveInputNotAccepted>(),
                        initial_bytes == 0,
                        "zero-byte cancellation is retryable; partial writes stay unknown"
                    );
                }
            }
        }
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
