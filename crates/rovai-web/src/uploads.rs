use super::*;
use axum::extract::Multipart;
use rovai_core::{
    draft_client::DraftClient, local_attachment_source::observe_source_attachment,
    web_upload::UploadIntent,
};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Mutex, time::Instant};
use tokio::io::AsyncWriteExt;

pub const MAX_BYTES: usize = 30 * 1024 * 1024;
const MAX_PASTED_TEXT_BYTES: usize = 25 * 1024 * 1024;
const RECEIVE_IDLE: Duration = Duration::from_secs(60);
const MAX_INTENT_BYTES: usize = 8 * 1024;

/// Only negative transport outcomes live here. Core receipts remain the sole
/// authority for successful bindings, including after a Host restart.
#[derive(Default)]
pub(super) struct Attempts(Mutex<HashMap<String, AttemptState>>);
struct AttemptState {
    active: bool,
    may_bind: bool,
    touched: Instant,
}
struct Attempt {
    registry: Arc<Attempts>,
    key: String,
    may_bind: bool,
}
impl Attempt {
    fn begin(registry: &Arc<Attempts>, client: &str, command: &str) -> Result<Self> {
        ensure!(
            command.len() == 36 && command.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'),
            "invalid_upload"
        );
        let key = format!("{client}:{command}");
        let mut entries = registry.0.lock().expect("upload attempts poisoned");
        ensure!(
            !entries.get(&key).is_some_and(|state| state.active),
            "upload_binding_unknown"
        );
        // Cancelling a replay must not turn an earlier ambiguous bind into a
        // definitive negative. Only a Core receipt/settlement can do that.
        let may_bind = entries.get(&key).is_some_and(|state| state.may_bind);
        while entries.len() >= 256 {
            let oldest = entries
                .iter()
                .filter(|(_, state)| !state.active)
                .min_by_key(|(_, state)| state.touched)
                .map(|(key, _)| key.clone());
            if let Some(key) = oldest {
                entries.remove(&key);
            } else {
                anyhow::bail!("upload_capacity");
            }
        }
        entries.insert(
            key.clone(),
            AttemptState {
                active: true,
                may_bind,
                touched: Instant::now(),
            },
        );
        Ok(Self {
            registry: registry.clone(),
            key,
            may_bind,
        })
    }
}
impl Drop for Attempt {
    fn drop(&mut self) {
        self.registry
            .0
            .lock()
            .expect("upload attempts poisoned")
            .insert(
                self.key.clone(),
                AttemptState {
                    active: false,
                    may_bind: self.may_bind,
                    touched: Instant::now(),
                },
            );
    }
}
impl Attempts {
    fn unbound(&self, client: &str, command: &str) -> bool {
        self.0
            .lock()
            .expect("upload attempts poisoned")
            .get(&format!("{client}:{command}"))
            .is_some_and(|state| !state.active && !state.may_bind)
    }
}

// Before binding this guard owns cleanup, including a disconnected multipart
// request. Once submitted, only a definitive Core receipt permits deletion.
struct TemporaryUpload {
    directory: PathBuf,
    generated_path: Option<PathBuf>,
    retain: bool,
}
impl TemporaryUpload {
    fn create() -> Result<Self> {
        let directory = std::env::temp_dir().join(format!("rovai-web-upload-{}", new_token()?));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new().mode(0o700).create(&directory)?;
        }
        #[cfg(not(unix))]
        rovai_core::platform::prepare_private_directory(&directory)?;
        Ok(Self {
            directory,
            generated_path: None,
            retain: false,
        })
    }
    fn path(&self) -> PathBuf {
        self.generated_path
            .clone()
            .unwrap_or_else(|| self.directory.join("source"))
    }
    async fn pasted_text(
        state: &WebState,
        session: &Session,
        intent: &UploadIntent,
    ) -> Result<Self> {
        let reply = state
            .core
            .request_for_editor(
                "host.upload.pastedTextRoot",
                json!(intent),
                DraftClient::verified_web(&session.client_id)?,
            )
            .await?;
        ensure!(reply.error.is_none(), "invalid_upload");
        let root = reply
            .result
            .and_then(|v| v.as_str().map(PathBuf::from))
            .context("invalid_upload")?;
        // Core authorizes the destination; Host never recreates a deleted Thread.
        for ancestor in root.ancestors() {
            ensure!(
                !tokio::fs::symlink_metadata(ancestor)
                    .await?
                    .file_type()
                    .is_symlink(),
                "invalid_upload"
            );
        }
        let path = root.join(format!("{}.txt", uuid::Uuid::new_v4()));
        Ok(Self {
            directory: root,
            generated_path: Some(path),
            retain: false,
        })
    }
}
impl Drop for TemporaryUpload {
    fn drop(&mut self) {
        if !self.retain {
            if let Some(path) = self.generated_path.take() {
                // One-shot cleanup for an unbound request, including cancellation.
                // A possibly-bound file is retained until its receipt is known.
                tokio::spawn(async move {
                    let _ = tokio::fs::remove_file(path).await;
                });
            } else {
                let _ = std::fs::remove_dir_all(&self.directory);
            }
        }
    }
}

struct ReceivedUpload {
    temporary: TemporaryUpload,
    hash: String,
    size: u64,
    prefix: Vec<u8>,
    pasted_preview: Option<String>,
}
async fn receive(
    mut field: axum::extract::multipart::Field<'_>,
    state: &WebState,
    session: &Arc<Session>,
    intent: Option<&UploadIntent>,
) -> Result<ReceivedUpload> {
    let pasted = intent.is_some_and(|intent| intent.target.is_pasted_text());
    let temporary = if pasted {
        TemporaryUpload::pasted_text(state, session, intent.unwrap()).await?
    } else {
        TemporaryUpload::create()?
    };
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options.open(temporary.path()).await?;
    let mut preview = pasted.then(TextPreview::default);
    let max_bytes = if pasted {
        MAX_PASTED_TEXT_BYTES
    } else {
        MAX_BYTES
    };
    let mut file = tokio::io::BufWriter::with_capacity(64 * 1024, file);
    let mut digest = Sha256::new();
    let mut size = 0u64;
    let mut prefix = Vec::with_capacity(12);
    let mut revoked = session.revoked.subscribe();
    loop {
        ensure!(state.sessions.is_live(session), "session_required");
        let chunk = tokio::select! {
            biased;
            _ = revoked.changed() => anyhow::bail!("session_required"),
            next = tokio::time::timeout(RECEIVE_IDLE, field.chunk()) => next.context("upload_timeout")?
                .map_err(|error| anyhow::anyhow!(if error.status() == StatusCode::PAYLOAD_TOO_LARGE { "upload_envelope_too_large" } else { "invalid_upload" }))?,
        };
        let Some(chunk) = chunk else { break };

        size += chunk.len() as u64;
        ensure!(size <= max_bytes as u64, "upload_too_large");
        if let Some(preview) = &mut preview {
            preview.push(&chunk)?;
        }
        prefix.extend_from_slice(&chunk[..chunk.len().min(12 - prefix.len())]);
        digest.update(&chunk);
        tokio::time::timeout(RECEIVE_IDLE, file.write_all(&chunk)).await??;
    }
    tokio::time::timeout(RECEIVE_IDLE, file.flush()).await??;
    drop(file);
    Ok(ReceivedUpload {
        temporary,
        hash: format!("{:x}", digest.finalize()),
        size,
        prefix,
        pasted_preview: preview.map(TextPreview::finish).transpose()?,
    })
}

// Validate UTF-8 as chunks arrive and keep only the card's display prefix.
// The file itself preserves every byte, including whitespace and line endings.
#[derive(Default)]
struct TextPreview {
    tail: Vec<u8>,
    text: String,
    count: usize,
    space: bool,
}
impl TextPreview {
    fn push(&mut self, bytes: &[u8]) -> Result<()> {
        self.tail.extend_from_slice(bytes);
        let end = match std::str::from_utf8(&self.tail) {
            Ok(_) => self.tail.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => anyhow::bail!("invalid_upload"),
        };
        for ch in std::str::from_utf8(&self.tail[..end])?.chars() {
            if self.count >= 160 {
                break;
            }
            if ch.is_whitespace()
                || ch.is_control()
                || matches!(ch, '\u{feff}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                self.space = self.count > 0;
                continue;
            }
            if self.space {
                self.text.push(' ');
                self.count += 1;
            }
            if self.count == 160 {
                break;
            }
            self.text.push(ch);
            self.count += 1;
            self.space = false;
        }
        self.tail.drain(..end);
        Ok(())
    }
    fn finish(self) -> Result<String> {
        ensure!(self.tail.is_empty(), "invalid_upload");
        Ok(self.text.trim_end().to_owned())
    }
}

async fn receive_intent(mut field: axum::extract::multipart::Field<'_>) -> Result<String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = tokio::time::timeout(RECEIVE_IDLE, field.chunk()).await?? {
        ensure!(
            bytes.len() + chunk.len() <= MAX_INTENT_BYTES,
            "invalid_upload"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8(bytes)?)
}

pub async fn upload(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let Ok(_permit) = state.uploads.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "upload_capacity");
    };
    let command = headers
        .get("x-rovai-upload-command-id")
        .and_then(|value| value.to_str().ok());
    let mut attempt = match command
        .map(|id| Attempt::begin(&state.upload_attempts, &session.client_id, id))
        .transpose()
    {
        Ok(attempt) => attempt,
        Err(failure) if failure.to_string() == "upload_binding_unknown" => {
            return error(StatusCode::CONFLICT, "upload_binding_unknown");
        }
        Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_upload"),
    };
    let mut intent = None;
    let mut contents = None;
    loop {
        let field = match tokio::time::timeout(RECEIVE_IDLE, multipart.next_field()).await {
            Ok(Ok(Some(field))) => field,
            Ok(Ok(None)) => break,
            Ok(Err(failure)) if failure.status() == StatusCode::PAYLOAD_TOO_LARGE => {
                return error(StatusCode::PAYLOAD_TOO_LARGE, "upload_envelope_too_large");
            }
            _ => return error(StatusCode::BAD_REQUEST, "invalid_upload"),
        };
        match field.name() {
            Some("intent") if intent.is_none() => {
                let Ok(text) = receive_intent(field).await else {
                    return error(StatusCode::BAD_REQUEST, "invalid_upload");
                };
                intent = serde_json::from_str::<UploadIntent>(&text).ok();
                if intent.is_none() {
                    return error(StatusCode::BAD_REQUEST, "invalid_upload");
                }
            }
            Some("file") if contents.is_none() => {
                contents = match receive(field, &state, &session, intent.as_ref()).await {
                    Ok(upload) => Some(upload),
                    Err(failure) => {
                        return match failure.to_string().as_str() {
                            "upload_too_large" => {
                                error(StatusCode::PAYLOAD_TOO_LARGE, "upload_too_large")
                            }
                            "upload_envelope_too_large" => {
                                error(StatusCode::PAYLOAD_TOO_LARGE, "upload_envelope_too_large")
                            }
                            _ => error(StatusCode::BAD_REQUEST, "invalid_upload"),
                        };
                    }
                };
            }
            _ => return error(StatusCode::BAD_REQUEST, "invalid_upload"),
        }
    }
    let (Some(intent), Some(contents)) = (intent, contents) else {
        return error(StatusCode::BAD_REQUEST, "invalid_upload");
    };
    if intent.target.is_pasted_text() && contents.pasted_preview.is_none() {
        return error(StatusCode::BAD_REQUEST, "invalid_upload");
    }
    if command.is_some_and(|id| id != intent.command_id) {
        return error(StatusCode::BAD_REQUEST, "invalid_upload");
    }
    if contents.hash != intent.sha256
        || contents.size != intent.byte_size
        || !state.sessions.is_live(&session)
    {
        return error(StatusCode::BAD_REQUEST, "upload_changed_or_session_expired");
    }
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    // A replay discards its unbound spool through the guard; it never rebinds it.
    if let Ok(reply) = state
        .core
        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
        .await
    {
        if reply.error.is_some() {
            return error(StatusCode::CONFLICT, "upload_conflict");
        }
        if reply
            .result
            .as_ref()
            .is_some_and(|result| !result["receipt"].is_null())
        {
            return upload_draft(&state, &intent, &client).await;
        }
    } else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "core_unavailable");
    }
    // Cancellation of the HTTP handler must not remove a possibly-bound source.
    // The task owns cleanup until Core returns a definitive binding result.
    let task = tokio::spawn(async move {
        let _permit = _permit;
        let mut temporary = contents.temporary;
        let path = temporary.path();
        async {
            let media = if intent.target.is_pasted_text() {
                Some("text/plain;charset=utf-8")
            } else if contents.prefix.starts_with(b"\x89PNG\r\n\x1a\n") {
                Some("image/png")
            } else if contents.prefix.starts_with(b"\xff\xd8\xff") {
                Some("image/jpeg")
            } else if contents.prefix.starts_with(b"RIFF")
                && contents.prefix.get(8..12) == Some(b"WEBP")
            {
                Some("image/webp")
            } else {
                None
            };
            let mut source = observe_source_attachment(&path, &intent.display_name, media)?;
            source.id = intent.command_id.clone();
            source.pasted_text_preview = contents.pasted_preview;
            if let Some(attempt) = &mut attempt {
                attempt.may_bind = true;
            }
            temporary.retain = true;
            let reply = state
                .core
                .request_for_editor(
                    "host.upload.bind",
                    json!({"intent":intent,"source":source}),
                    client.clone(),
                )
                .await;
            match reply {
                Ok(reply) if reply.error.is_none() => {
                    let result = reply.result.context("upload binding result missing")?;
                    // A replay belongs to its original file, so this duplicate
                    // never became a source and can be cleaned.
                    if result["replayed"] == true {
                        temporary.retain = false;
                    }
                    Ok::<_, anyhow::Error>(
                        Json(json!({"draft":project_upload(&intent, result["draft"].clone())}))
                            .into_response(),
                    )
                }
                Ok(_) => {
                    // Core can report a post-commit error. Consult the canonical
                    // receipt before deciding whether the file is still unbound.
                    if let Ok(receipt) = state
                        .core
                        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
                        .await
                    {
                        if receipt.error.is_none()
                            && receipt
                                .result
                                .as_ref()
                                .is_some_and(|value| value["receipt"].is_null())
                        {
                            temporary.retain = false;
                            if let Some(attempt) = &mut attempt {
                                attempt.may_bind = false;
                            }
                            return Ok(error(StatusCode::CONFLICT, "draft_changed"));
                        }
                        if receipt.error.is_none() {
                            return Ok(upload_draft(&state, &intent, &client).await);
                        }
                    }
                    Ok(error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "upload_binding_unknown",
                    ))
                }
                Err(_) => Ok(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "upload_binding_unknown",
                )),
            }
        }
        .await
    });
    match task.await {
        Ok(Ok(response)) => response,
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "upload_binding_unknown"),
    }
}

async fn upload_draft(state: &WebState, intent: &UploadIntent, client: &DraftClient) -> Response {
    match state
        .core
        .request_for_editor(
            "host.upload.reconcile",
            json!(intent),
            client.clone(),
        )
        .await
    {
        Ok(reply) if reply.error.is_none() => Json(json!({"draft":project_upload(intent, reply.result.unwrap_or_default()["draft"].take())})).into_response(),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "upload_binding_unknown"),
    }
}

pub async fn reconcile(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(intent): Json<UploadIntent>,
) -> Response {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    match state
        .core
        .request_for_editor("host.upload.reconcile", json!(intent), client.clone())
        .await
    {
        Ok(reply) if reply.error.is_none() => {
            if reply
                .result
                .as_ref()
                .is_some_and(|value| !value["receipt"].is_null())
            {
                upload_draft(&state, &intent, &client).await
            } else {
                Json(json!({"state":if state.upload_attempts.unbound(&session.client_id, &intent.command_id) { "unbound" } else { "unknown" }})).into_response()
            }
        }
        _ => error(StatusCode::CONFLICT, "upload_conflict"),
    }
}

fn project_upload(intent: &UploadIntent, value: serde_json::Value) -> serde_json::Value {
    use rovai_core::web_upload::UploadTarget;
    let operation = match intent.target {
        UploadTarget::Camp | UploadTarget::PastedText | UploadTarget::Chat => return value,
        UploadTarget::SingleChat { .. } | UploadTarget::SingleChatPending { .. } => {
            operations::Operation::SingleChatGet
        }
    };
    operation.project(value)
}
