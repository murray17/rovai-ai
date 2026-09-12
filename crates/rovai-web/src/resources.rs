//! Browser read capabilities reuse Core's exact-source authorization. Paths and
//! handles never authorize another source or another editing client.
use super::*;
use base64::Engine;
use rovai_core::draft_client::DraftClient;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
pub struct Handles(Mutex<HashMap<String, Handle>>);
#[derive(Clone)]
struct Handle {
    client: String,
    source: Value,
    path: PathBuf,
    name: String,
    token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileRequest {
    action: String,
    request: Value,
}

fn failure(code: &str) -> Value {
    json!({"ok":false,"error":{"code":code,"message":match code {
        "file_too_large" => "文件超出浏览器预览范围，请下载查看。",
        "outside_authorized_root" => "此文件不在 Host 已授权的工作区内。",
        "source_not_authorized" => "当前来源已失效或未获授权。",
        "file_not_found" => "源文件已不可用，可能已被系统清理。",
        _ => "文件已变化或暂不可读，请重新打开。"
    },"retryable":true}})
}

async fn core_value(
    state: &WebState,
    client: &DraftClient,
    method: &str,
    params: Value,
) -> Result<Value> {
    let reply = state
        .core
        .request_for_editor(method, params, client.clone())
        .await?;
    ensure!(reply.error.is_none(), "source_not_authorized");
    reply
        .result
        .filter(|value| !value.is_null())
        .context("source_not_authorized")
}

async fn resolve(
    state: &WebState,
    client: &DraftClient,
    source: &Value,
) -> Result<(PathBuf, String)> {
    if source["kind"] == "attachment" {
        ensure!(
            source["campId"] == source["locator"]["campId"],
            "source_not_authorized"
        );
        let target = core_value(
            state,
            client,
            "host.attachment.resolve",
            source["locator"].clone(),
        )
        .await?;
        ensure!(target["kind"] == "file", "not_regular_file");
        let path = PathBuf::from(target["path"].as_str().context("source_not_authorized")?);
        return Ok((
            tokio::fs::canonicalize(path)
                .await
                .context("file_not_found")?,
            target["displayName"]
                .as_str()
                .context("source_not_authorized")?
                .to_owned(),
        ));
    }
    ensure!(
        matches!(
            source["kind"].as_str(),
            Some("camp_workspace" | "message_reference" | "run_evidence")
        ),
        "source_not_authorized"
    );
    let target = core_value(state, client, "filePreview.resolveSource", source.clone()).await?;
    ensure!(target["kind"] == "file_target", "source_not_authorized");
    let root = tokio::fs::canonicalize(
        target["rootPath"]
            .as_str()
            .context("source_not_authorized")?,
    )
    .await?;
    ensure!(state.workspaces.contains(&root), "outside_authorized_root");
    let raw = target["rawReference"]
        .as_str()
        .context("source_not_authorized")?;
    ensure!(!raw.contains(['\0', '\r', '\n']), "source_not_authorized");
    let relative = PathBuf::from(raw);
    let candidate = if raw.starts_with("file:") {
        url::Url::parse(raw)?
            .to_file_path()
            .map_err(|_| anyhow::anyhow!("source_not_authorized"))?
    } else if relative.is_absolute() {
        relative
    } else {
        PathBuf::from(
            target["basePath"]
                .as_str()
                .context("source_not_authorized")?,
        )
        .join(relative)
    };
    let path = tokio::fs::canonicalize(candidate)
        .await
        .context("file_not_found")?;
    ensure!(path.starts_with(&root), "outside_authorized_root");
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("source_not_authorized")?
        .to_owned();
    Ok((path, name))
}

async fn content(path: &std::path::Path) -> Result<(Vec<u8>, Value, String)> {
    use tokio::io::AsyncReadExt;
    let resolved_path = path.to_path_buf();
    let file = tokio::task::spawn_blocking(move || {
        rovai_core::local_attachment_snapshot::open_resolved_file_without_following(&resolved_path)
    })
    .await??;
    let mut file = tokio::fs::File::from_std(file);
    let meta = file.metadata().await?;
    ensure!(meta.is_file(), "not_regular_file");
    ensure!(meta.len() <= uploads::MAX_BYTES as u64, "file_too_large");
    let mut bytes = Vec::new();
    (&mut file)
        .take(uploads::MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .await?;
    ensure!(bytes.len() <= uploads::MAX_BYTES, "file_too_large");
    let after = file.metadata().await?;
    ensure!(
        meta.len() == after.len() && meta.modified()? == after.modified()?,
        "read_failed"
    );
    let generation: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let version = json!({"size":bytes.len(), "mtimeMs":meta.modified()?.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()});
    Ok((bytes, version, generation))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

async fn metadata(handle: &Handle, handle_id: &str) -> Result<Value> {
    let (bytes, version, generation) = content(&handle.path).await?;
    let extension = std::path::Path::new(&handle.name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let (kind, mime) = if let Some(mime) = image_mime(&bytes) {
        ("image", mime)
    } else {
        ensure!(bytes.len() <= 2 * 1024 * 1024, "file_too_large");
        ensure!(
            !bytes.contains(&0) && std::str::from_utf8(&bytes).is_ok(),
            "decode_failed"
        );
        // Uploaded HTML and SVG always use the text reader. No iframe,
        // executable URL or asset proxy is created by the Web adapter.
        (
            if matches!(extension.as_str(), "md" | "markdown") {
                "markdown"
            } else {
                "text"
            },
            "text/plain",
        )
    };
    let mut key = Sha256::new();
    key.update(b"rovai-web-preview-v1\0");
    key.update(handle.client.as_bytes());
    key.update(handle.path.as_os_str().as_encoded_bytes());
    let preview_key = format!("web:{:x}", key.finalize());
    Ok(
        json!({"handleId":handle_id,"reopenToken":handle.token,"previewKey":preview_key,"restoreRequest":handle.source,
        "displayPath":handle.name,"pathPresentation":"file_name_only","fileName":handle.name,"size":bytes.len(),"mime":mime,"extension":extension,"kind":kind,
        "hasExternalUpdate":false,"contentVersion":version,"contentGeneration":generation,"capabilities":["read"]}),
    )
}

pub async fn files(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(body): Json<FileRequest>,
) -> Json<Value> {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    let result = file_operation(&state, &client, body).await;
    Json(result.unwrap_or_else(|error| {
        failure(match error.to_string().as_str() {
            "file_too_large" => "file_too_large",
            "outside_authorized_root" => "outside_authorized_root",
            "file_not_found" => "file_not_found",
            "source_not_authorized" => "source_not_authorized",
            _ => "read_failed",
        })
    }))
}

async fn file_operation(
    state: &WebState,
    client: &DraftClient,
    body: FileRequest,
) -> Result<Value> {
    let request = body.request;
    if matches!(body.action.as_str(), "open" | "restore") {
        if request["kind"] == "run_evidence" && request["action"] == "review" {
            let value = core_value(state, client, "filePreview.resolveSource", request).await?;
            ensure!(value["kind"] == "evidence_review", "source_not_authorized");
            return Ok(json!({"ok":true,"value":value}));
        }
        let (path, name) = resolve(state, client, &request).await?;
        let id = new_token()?;
        let handle = Handle {
            client: client.id().to_owned(),
            source: request,
            path,
            name,
            token: new_token()?,
        };
        let file = metadata(&handle, &id).await?;
        let mut handles = state.files.0.lock().expect("file registry poisoned");
        ensure!(
            handles.len() < 128
                && handles
                    .values()
                    .filter(|handle| handle.client == client.id())
                    .count()
                    < 32,
            "too_many_open_files"
        );
        handles.insert(id, handle);
        return Ok(json!({"ok":true,"value":{"kind":"file_preview","file":file}}));
    }
    let (id, handle) = {
        let handles = state.files.0.lock().expect("file registry poisoned");
        if body.action == "reopen" {
            handles
                .iter()
                .find(|(_, handle)| {
                    handle.client == client.id()
                        && Some(handle.token.as_str()) == request["reopenToken"].as_str()
                        && handle.source["campId"] == request["campId"]
                })
                .map(|(id, handle)| (id.clone(), handle.clone()))
        } else {
            request["handleId"].as_str().and_then(|id| {
                handles
                    .get(id)
                    .filter(|handle| handle.client == client.id())
                    .map(|handle| (id.to_owned(), handle.clone()))
            })
        }
        .context("source_not_authorized")?
    };
    if body.action == "release" {
        state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .remove(&id);
        return Ok(json!({"released":true}));
    }
    let (path, _) = resolve(state, client, &handle.source).await?;
    ensure!(path == handle.path, "source_not_authorized");
    if matches!(body.action.as_str(), "reload" | "reopen") {
        ensure!(
            Some(handle.token.as_str()) == request["reopenToken"].as_str(),
            "source_not_authorized"
        );
        let value = metadata(&handle, &id).await?;
        return Ok(
            json!({"ok":true,"value":if body.action=="reopen" { json!({"kind":"file_preview","file":value}) } else { value }}),
        );
    }
    let (bytes, version, generation) = content(&path).await?;
    ensure!(
        Some(generation.as_str()) == request["expectedGeneration"].as_str(),
        "read_failed"
    );
    match body.action.as_str() {
        "readText" => {
            ensure!(bytes.len() <= 2 * 1024 * 1024, "file_too_large");
            let text = std::str::from_utf8(&bytes).context("decode_failed")?;
            Ok(
                json!({"ok":true,"value":{"text":text,"contentGeneration":generation,"contentVersion":version}}),
            )
        }
        "readBinary" => {
            let mime = image_mime(&bytes).context("decode_failed")?;
            Ok(
                json!({"ok":true,"value":{"base64":base64::engine::general_purpose::STANDARD.encode(bytes),"mime":mime,"contentGeneration":generation,"contentVersion":version}}),
            )
        }
        _ => anyhow::bail!("source_not_authorized"),
    }
}

pub async fn attachment(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(locator): Json<Value>,
) -> Response {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    let result = async {
        let source = json!({"kind":"attachment","campId":locator["campId"],"locator":locator});
        let (path, name) = resolve(&state, &client, &source).await?;
        let (bytes, _, _) = content(&path).await?;
        // Encode every UTF-8 byte: no source name can inject a response header or
        // silently lose its original extension in a browser download.
        let encoded: String = name
            .as_bytes()
            .iter()
            .map(|byte| format!("%{byte:02X}"))
            .collect();
        let disposition = format!("attachment; filename*=UTF-8''{encoded}");
        Ok::<_, anyhow::Error>(
            (
                [
                    (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
                    (header::CONTENT_DISPOSITION, disposition),
                ],
                bytes,
            )
                .into_response(),
        )
    }
    .await;
    result.unwrap_or_else(|_| error(StatusCode::NOT_FOUND, "attachment_unavailable"))
}
