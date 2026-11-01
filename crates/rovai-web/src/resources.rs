//! Browser read capabilities reuse Core's exact-source authorization. Paths and
//! handles never authorize another source or another editing client.
use super::*;
mod content;
use content::Selection;
use rovai_core::draft_client::DraftClient;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Mutex};

/// A cancelled HTTP future cannot release capacity while its filesystem work
/// still runs on Tokio's blocking pool.
pub(super) async fn blocking<T: Send + 'static>(
    capacity: impl Send + 'static,
    operation: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(move || {
        let _capacity = capacity;
        operation()
    })
    .await?
}

#[derive(Default)]
pub struct Handles(Mutex<HashMap<String, Handle>>);
impl Handles {
    pub fn release_camp(&self, camp_id: &str) {
        // Handles keep authorization and analysis, never an open descriptor.
        // Existing bounded reads close their own descriptors; revoked resource
        // tokens cannot start another read while deletion settles.
        self.0
            .lock()
            .expect("file registry poisoned")
            .retain(|_, handle| handle.source["threadId"] != camp_id);
    }
}
#[derive(Clone)]
struct Handle {
    client: String,
    session: Arc<Session>,
    preview_token: String,
    source: Value,
    path: PathBuf,
    anchor_path: PathBuf,
    root: PathBuf,
    allow_children: bool,
    restore: Option<Value>,
    project_root: Option<PathBuf>,
    name: String,
    token: String,
    version: Value,
    analysis: Option<Arc<content::Analysis>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileRequest {
    action: String,
    request: Value,
}

fn failure(code: &str) -> Value {
    json!({"ok":false,"error":{"code":code,"message":match code {
        "file_too_large" | "decode_failed" => "此文件暂不支持在线预览，可下载到本机查看。",
        "outside_authorized_root" => "此引用超出当前预览来源的文件范围。",
        "source_not_authorized" => "当前来源已失效或未获授权。",
        "file_not_found" | "attachment_missing" => "源文件已不可用，可能已被系统清理。",
        "file_unreadable" | "attachment_unreadable" => "服务器暂时无法读取此文件，请检查文件权限后重试。",
        "not_regular_file" | "attachment_kind_changed" => "此来源当前不是可下载的普通文件。",
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
    if let Some(error) = reply.error {
        anyhow::bail!(match error["code"].as_str() {
            Some("attachment_missing") => "file_not_found",
            Some("attachment_unreadable") => "file_unreadable",
            Some("attachment_kind_changed") => "not_regular_file",
            _ => "source_not_authorized",
        });
    }
    reply
        .result
        .filter(|value| !value.is_null())
        .context("source_not_authorized")
}

struct ResolvedSource {
    path: PathBuf,
    root: PathBuf,
    name: String,
    allow_children: bool,
}

/// A path capability resolved from an authorized source, never a client path.
pub(super) struct DownloadTarget {
    pub path: PathBuf,
    pub name: String,
}

pub(super) async fn download_source(
    state: &WebState,
    session: &Arc<Session>,
    mut source: Value,
) -> Result<DownloadTarget> {
    normalize_thread_scope(&mut source)?;
    if let Some(locator) = source.get_mut("locator") {
        normalize_thread_scope(locator)?;
    }
    let client = DraftClient::verified_web(&session.client_id)?;
    if source["kind"] == "child_of_handle" {
        let parent = state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .get(
                source["parentHandleId"]
                    .as_str()
                    .context("source_not_authorized")?,
            )
            .filter(|handle| handle.client == client.id() && handle.allow_children)
            .cloned()
            .context("source_not_authorized")?;
        reauthorize(state, &client, &parent).await?;
        let candidate = reference_path(
            source["rawReference"]
                .as_str()
                .context("source_not_authorized")?,
            parent.path.parent().context("source_not_authorized")?,
        )?;
        let path = tokio::fs::canonicalize(candidate)
            .await
            .context("file_not_found")?;
        ensure!(path.starts_with(&parent.root), "source_not_authorized");
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .context("source_not_authorized")?
            .to_owned();
        return Ok(DownloadTarget { path, name });
    }
    let resolved = resolve(state, &client, &source).await?;
    Ok(DownloadTarget {
        path: resolved.path,
        name: resolved.name,
    })
}

pub(super) async fn download_preview(
    state: &WebState,
    session: &Arc<Session>,
    id: &str,
) -> Result<DownloadTarget> {
    let client = DraftClient::verified_web(&session.client_id)?;
    let handle = state
        .files
        .0
        .lock()
        .expect("file registry poisoned")
        .get(id)
        // Handles belong to the proved editor identity, as do ordinary preview
        // reads. Reauthentication grants a new Session, never revives its tickets.
        .filter(|handle| handle.client == client.id())
        .cloned()
        .context("source_not_authorized")?;
    reauthorize(state, &client, &handle).await?;
    Ok(DownloadTarget {
        path: handle.path,
        name: handle.name,
    })
}

fn is_core_file_source_kind(kind: Option<&str>) -> bool {
    matches!(
        kind,
        Some("camp_workspace" | "message_reference" | "run_evidence" | "run_activity_file")
    )
}

use rovai_core::file_reference_path::reference_path;

async fn resolve(state: &WebState, client: &DraftClient, source: &Value) -> Result<ResolvedSource> {
    if source["kind"] == "attachment" {
        ensure!(
            source["threadId"] == source["locator"]["threadId"],
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
        let path = tokio::fs::canonicalize(path)
            .await
            .context("file_not_found")?;
        return Ok(ResolvedSource {
            root: path.parent().context("source_not_authorized")?.to_owned(),
            path,
            name: target["displayName"]
                .as_str()
                .context("source_not_authorized")?
                .to_owned(),
            allow_children: true,
        });
    }
    ensure!(
        is_core_file_source_kind(source["kind"].as_str()),
        "source_not_authorized"
    );
    let target = core_value(state, client, "filePreview.resolveSource", source.clone()).await?;
    ensure!(target["kind"] == "file_target", "source_not_authorized");
    let mut root = tokio::fs::canonicalize(
        target["rootPath"]
            .as_str()
            .context("source_not_authorized")?,
    )
    .await?;
    let raw = target["rawReference"]
        .as_str()
        .context("source_not_authorized")?;
    let candidate = reference_path(
        raw,
        std::path::Path::new(
            target["basePath"]
                .as_str()
                .context("source_not_authorized")?,
        ),
    )?;
    let path = tokio::fs::canonicalize(candidate)
        .await
        .context("file_not_found")?;
    if !path.starts_with(&root) {
        // Like Desktop, an exact Core-authorized external file uses its parent
        // only as an ephemeral child/watch boundary, never a persistent grant.
        ensure!(
            tokio::fs::metadata(&path).await?.is_file(),
            "outside_authorized_root"
        );
        root = path.parent().context("source_not_authorized")?.to_owned();
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("source_not_authorized")?
        .to_owned();
    Ok(ResolvedSource {
        path,
        root,
        name,
        allow_children: target["allowChildren"] == true,
    })
}

async fn reauthorize(state: &WebState, client: &DraftClient, handle: &Handle) -> Result<()> {
    let source = resolve(state, client, &handle.source).await?;
    ensure!(
        source.path == handle.anchor_path && source.root == handle.root,
        "source_not_authorized"
    );
    let path = tokio::fs::canonicalize(&handle.path)
        .await
        .context("file_not_found")?;
    ensure!(
        path == handle.path && path.starts_with(&source.root),
        "outside_authorized_root"
    );
    Ok(())
}

async fn content(
    path: &std::path::Path,
    permit: Option<Arc<tokio::sync::OwnedSemaphorePermit>>,
) -> Result<(Vec<u8>, Value, String)> {
    let value = content::read(path, Selection::All, permit).await?;
    Ok((value.bytes, value.version, value.generation))
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

fn preview_key(handle: &Handle) -> String {
    let mut key = Sha256::new();
    key.update(b"rovai-web-preview-v1\0");
    key.update(handle.client.as_bytes());
    key.update(handle.path.as_os_str().as_encoded_bytes());
    format!("web:{:x}", key.finalize())
}

fn page_range(text: &str, offset: u64, maximum: u64) -> Result<(usize, usize)> {
    let offset: usize = offset
        .try_into()
        .map_err(|_| anyhow::anyhow!("read_failed"))?;
    ensure!(
        offset <= text.len() && text.is_char_boundary(offset),
        "read_failed"
    );
    let mut end = offset
        .saturating_add(maximum.min(256 * 1024) as usize)
        .min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    // A page must make progress even when its requested size splits one scalar.
    if end == offset && offset < text.len() {
        end += text[offset..].chars().next().expect("nonempty").len_utf8();
    }
    Ok((offset, end))
}

async fn metadata(
    handle: &Handle,
    handle_id: &str,
    permit: &Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<(Value, Arc<content::Analysis>)> {
    let content = content::read(&handle.path, Selection::Metadata, Some(permit.clone())).await?;
    let (version, generation) = (content.version, content.generation);
    let extension = std::path::Path::new(&handle.name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let (kind, mime) = if let Some(mime) = image_mime(&content.prefix) {
        ("image", mime)
    } else {
        ensure!(!content.has_nul && content.text, "decode_failed");
        // HTML bytes travel only through authenticated, generation-bound reads.
        // The browser renders them in an opaque sandbox; standalone SVG stays text.
        (
            if matches!(extension.as_str(), "html" | "htm") {
                "html"
            } else if content.size > 2 * 1024 * 1024 {
                "paged_text"
            } else if matches!(extension.as_str(), "md" | "markdown") {
                "markdown"
            } else {
                "text"
            },
            if matches!(extension.as_str(), "html" | "htm") {
                "text/html"
            } else {
                "text/plain"
            },
        )
    };
    let preview_key = preview_key(handle);
    let (display_path, presentation) = if let Some(relative) = handle
        .project_root
        .as_ref()
        .and_then(|root| handle.path.strip_prefix(root).ok())
    {
        (
            relative.to_string_lossy().replace('\\', "/"),
            "project_relative",
        )
    } else {
        (handle.path.to_string_lossy().into_owned(), "external")
    };
    let mut result = json!({"handleId":handle_id,"reopenToken":handle.token,"previewKey":preview_key,
        "displayPath":format!("服务器：{display_path}"),"absolutePath":handle.path,"pathPresentation":presentation,"fileName":handle.name,"size":content.size,"mime":mime,"extension":extension,"kind":kind,
        "hasExternalUpdate":false,"contentVersion":version,"contentGeneration":generation,"capabilities":["read","download"]});
    if let Some(restore) = &handle.restore {
        result["restoreRequest"] = restore.clone();
    }
    if handle.allow_children {
        result["capabilities"]
            .as_array_mut()
            .expect("capabilities")
            .push(json!("read_child"));
    }
    Ok((result, content.analysis.expect("metadata analysis")))
}

pub async fn files(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(body): Json<FileRequest>,
) -> Json<Value> {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    let Ok(_permit) = state.uploads.clone().try_acquire_owned() else {
        return Json(failure("read_failed"));
    };
    let result = file_operation(&state, &client, &session, body, Arc::new(_permit)).await;
    Json(result.unwrap_or_else(|error| {
        failure(match error.to_string().as_str() {
            "file_too_large" => "file_too_large",
            "decode_failed" => "decode_failed",
            "file_unreadable" => "attachment_unreadable",
            "not_regular_file" => "not_regular_file",
            "outside_authorized_root" => "outside_authorized_root",
            "file_not_found" => "file_not_found",
            "source_not_authorized" => "source_not_authorized",
            _ => "read_failed",
        })
    }))
}

fn normalize_thread_scope(value: &mut Value) -> Result<()> {
    if let Some(object) = value.as_object_mut() {
        if let Some(id) = object.remove("campId") {
            ensure!(!object.contains_key("threadId"), "source_not_authorized");
            object.insert("threadId".to_string(), id);
        }
    }
    Ok(())
}

async fn file_operation(
    state: &WebState,
    client: &DraftClient,
    session: &Arc<Session>,
    body: FileRequest,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Value> {
    let mut request = body.request;
    normalize_thread_scope(&mut request)?;
    if request["kind"] == "attachment" {
        if let Some(locator) = request.get_mut("locator") {
            normalize_thread_scope(locator)?;
        }
    }
    if body.action == "attachmentLocation" {
        return core_value(state, client, "camp.attachments.location", request).await;
    }
    if matches!(
        body.action.as_str(),
        "removePastedText" | "discardPastedText"
    ) {
        let method = if body.action == "removePastedText" {
            "host.upload.removePastedText"
        } else {
            "host.upload.discardPastedText"
        };
        return core_value(state, client, method, request).await;
    }
    if body.action == "restoreComposerAttachments" {
        return core_value(state, client, "host.upload.restore", request).await;
    }
    if body.action == "updates" {
        let handles: Vec<_> = state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .iter()
            .filter(|(_, handle)| handle.client == client.id())
            .map(|(id, handle)| (id.clone(), handle.clone()))
            .collect();
        let mut updates: HashMap<String, Vec<String>> = HashMap::new();
        for (_, handle) in handles {
            let changed = match tokio::fs::metadata(&handle.path).await {
                Ok(meta) => {
                    meta.len() != handle.version["size"].as_u64().unwrap_or_default()
                        || meta
                            .modified()
                            .ok()
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|time| time.as_millis())
                            != handle.version["mtimeMs"].as_u64().map(u128::from)
                }
                Err(_) => true,
            };
            if changed {
                let key = preview_key(&handle);
                if let Some(camp_id) = handle.source["threadId"].as_str() {
                    updates.entry(camp_id.to_owned()).or_default().push(key);
                }
            }
        }
        return Ok(
            json!({"ok":true,"value":updates.into_iter().map(|(camp_id,preview_keys)|json!({"threadId":camp_id,"previewKeys":preview_keys})).collect::<Vec<_>>()}),
        );
    }
    if matches!(body.action.as_str(), "open" | "restore") {
        if request["kind"] == "run_evidence" && request["action"] == "review" {
            let value = core_value(state, client, "filePreview.resolveSource", request).await?;
            ensure!(value["kind"] == "evidence_review", "source_not_authorized");
            return Ok(json!({"ok":true,"value":value}));
        }
        let id = new_token()?;
        let mut handle = if request["kind"] == "child_of_handle" {
            let parent = state
                .files
                .0
                .lock()
                .expect("file registry poisoned")
                .get(
                    request["parentHandleId"]
                        .as_str()
                        .context("source_not_authorized")?,
                )
                .filter(|h| {
                    h.client == client.id()
                        && request
                            .get("threadId")
                            .is_none_or(|camp| *camp == h.source["threadId"])
                        && h.allow_children
                })
                .cloned()
                .context("source_not_authorized")?;
            reauthorize(state, client, &parent).await?;
            let candidate = reference_path(
                request["rawReference"]
                    .as_str()
                    .context("source_not_authorized")?,
                parent.path.parent().context("source_not_authorized")?,
            )?;
            let path = tokio::fs::canonicalize(candidate)
                .await
                .context("file_not_found")?;
            ensure!(path.starts_with(&parent.root), "outside_authorized_root");
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .context("source_not_authorized")?
                .to_owned();
            // Match Desktop: only project children get a durable independent
            // restore request. External children retain their exact parent source.
            let workspace = json!({"kind":"camp_workspace","threadId":parent.source["threadId"],"rawReference":"."});
            let restore = if let Ok(root) = resolve(state, client, &workspace).await {
                path.strip_prefix(&root.root).ok().and_then(|relative| relative.to_str()).map(|relative|
                    json!({"kind":"camp_workspace","threadId":parent.source["threadId"],"rawReference":relative}))
            } else {
                None
            };
            Handle {
                path,
                name,
                restore,
                preview_token: new_token()?,
                session: session.clone(),
                token: new_token()?,
                version: Value::Null,
                analysis: None,
                ..parent
            }
        } else {
            let resolved = resolve(state, client, &request).await?;
            let workspace =
                json!({"kind":"camp_workspace","threadId":request["threadId"],"rawReference":"."});
            let project_root = if request["kind"] == "attachment" {
                None
            } else {
                resolve(state, client, &workspace)
                    .await
                    .ok()
                    .map(|source| source.root)
            };
            Handle {
                project_root,
                client: client.id().to_owned(),
                source: request.clone(),
                restore: Some(request),
                anchor_path: resolved.path.clone(),
                path: resolved.path,
                root: resolved.root,
                allow_children: resolved.allow_children,
                name: resolved.name,
                preview_token: new_token()?,
                session: session.clone(),
                token: new_token()?,
                version: Value::Null,
                analysis: None,
            }
        };
        let (file, analysis) = metadata(&handle, &id, &permit).await?;
        handle.analysis = Some(analysis);
        handle.version = file["contentVersion"].clone();
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
                        && handle.source["threadId"] == request["threadId"]
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
    reauthorize(state, client, &handle).await?;
    if matches!(body.action.as_str(), "readEditableFile" | "saveTextFile") {
        ensure!(
            handle
                .analysis
                .as_ref()
                .is_some_and(|analysis| Some(analysis.generation.as_str())
                    == request["expectedGeneration"].as_str()),
            "source_not_authorized"
        );
        let source = handle.restore.as_ref().unwrap_or(&handle.source);
        if !matches!(
            source["kind"].as_str(),
            Some("camp_workspace" | "message_reference")
        ) {
            return Ok(rovai_core::file_edit::failure("edit_unavailable"));
        }
        let root = if source["kind"] == "camp_workspace" {
            let resolved = resolve(state, client, source).await?;
            resolved.root
        } else {
            handle.root.clone()
        };
        let reply = state.core.request_for_editor(
            if body.action == "saveTextFile" { "filePreview.saveText" } else { "filePreview.readEditable" },
            json!({"source":source,"path":handle.path,"root":root,"text":request.get("text"),"expectedVersion":request.get("expectedVersion")}),
            client.clone(),
        ).await?;
        return Ok(reply
            .result
            .unwrap_or_else(|| rovai_core::file_edit::failure("source_not_authorized")));
    }
    if matches!(body.action.as_str(), "reload" | "reopen") {
        ensure!(
            Some(handle.token.as_str()) == request["reopenToken"].as_str(),
            "source_not_authorized"
        );
        let (value, analysis) = metadata(&handle, &id, &permit).await?;
        if let Some(current) = state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .get_mut(&id)
        {
            current.version = value["contentVersion"].clone();
            current.analysis = Some(analysis);
        }
        return Ok(
            json!({"ok":true,"value":if body.action=="reopen" { json!({"kind":"file_preview","file":value}) } else { value }}),
        );
    }
    let selection = match body.action.as_str() {
        "readPage" => Selection::Page {
            offset: request["offset"].as_u64().context("read_failed")?,
            maximum: request
                .get("maxBytes")
                .map(|v| v.as_u64().context("read_failed"))
                .transpose()?
                .unwrap_or(256 * 1024)
                .clamp(1, 256 * 1024),
        },
        "resolveLine" => Selection::Line {
            requested: request["line"]
                .as_u64()
                .filter(|line| *line > 0)
                .context("read_failed")?,
        },
        "readHtml" | "readText" => Selection::All,
        _ => anyhow::bail!("source_not_authorized"),
    };
    let known = handle.analysis.filter(|analysis| {
        Some(analysis.generation.as_str()) == request["expectedGeneration"].as_str()
    });
    let content = content::read_known(&handle.path, selection, known, Some(permit)).await?;
    let (bytes, version, generation) = (content.bytes, content.version, content.generation);
    ensure!(
        Some(generation.as_str()) == request["expectedGeneration"].as_str(),
        "read_failed"
    );
    match body.action.as_str() {
        "readPage" => {
            let Selection::Page { offset, maximum } = selection else {
                unreachable!()
            };
            ensure!(content.text, "decode_failed");
            ensure!(offset <= content.size as u64, "read_failed");
            // The window includes up to three extra bytes to finish its last
            // scalar; a non-boundary start is always rejected.
            let text = match std::str::from_utf8(&bytes) {
                Ok(text) => text,
                Err(error) if error.error_len().is_none() => {
                    std::str::from_utf8(&bytes[..error.valid_up_to()])?
                }
                Err(_) => anyhow::bail!("read_failed"),
            };
            let (_, local_end) = page_range(text, 0, maximum)?;
            let end = offset as usize + local_end;
            Ok(
                json!({"ok":true,"value":{"text":&text[..local_end],"startOffset":offset,"endOffset":end,"startLine":content.line,
                "hasPrevious":offset>0,"hasNext":end<content.size,"contentGeneration":generation,"contentVersion":version}}),
            )
        }
        "resolveLine" => {
            ensure!(content.text, "decode_failed");
            Ok(
                json!({"ok":true,"value":{"offset":content.line_offset,"line":content.line,"contentGeneration":generation}}),
            )
        }
        "readHtml" | "readText" => {
            let html = std::path::Path::new(&handle.name)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm")
                });
            if body.action == "readHtml" {
                ensure!(html, "source_not_authorized");
            } else {
                ensure!(
                    bytes.len() <= if html { 4 } else { 2 } * 1024 * 1024,
                    "file_too_large"
                );
            }
            let text = std::str::from_utf8(&bytes).context("decode_failed")?;
            Ok(
                json!({"ok":true,"value":{"text":text,"contentGeneration":generation,"contentVersion":version,
                    "resourceBasePath": if body.action == "readHtml" && handle.allow_children {
                        let relative = handle.path.strip_prefix(&handle.root)?.parent().context("source_not_authorized")?;
                        let mut base = url::Url::parse("http://preview.invalid/")?;
                        { let mut segments = base.path_segments_mut().map_err(|_| anyhow::anyhow!("source_not_authorized"))?;
                          segments.push("preview-assets").push(&handle.preview_token);
                          for part in relative.components() { segments.push(part.as_os_str().to_str().context("source_not_authorized")?); }
                          segments.push(""); }
                        Some(base.path().to_owned())
                    } else { None }
                }}),
            )
        }
        _ => anyhow::bail!("source_not_authorized"),
    }
}

// Binary resources keep the same editor/source/generation fences as JSON reads.
// Only the representation changes; blobs still contain the complete bounded file.
pub async fn binary(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(body): Json<FileRequest>,
) -> Response {
    let Ok(_permit) = state.uploads.clone().try_acquire_owned() else {
        return Json(failure("read_failed")).into_response();
    };
    let permit = Arc::new(_permit);
    let result = async {
        ensure!(
            matches!(
                body.action.as_str(),
                "readBinary" | "readChildImage" | "download"
            ),
            "source_not_authorized"
        );
        let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
        let mut request = body.request;
        normalize_thread_scope(&mut request)?;
        if request["kind"] == "attachment" {
            if let Some(locator) = request.get_mut("locator") {
                normalize_thread_scope(locator)?;
            }
        }
        let handle = state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .get(
                request["handleId"]
                    .as_str()
                    .context("source_not_authorized")?,
            )
            .filter(|handle| handle.client == client.id())
            .cloned()
            .context("source_not_authorized")?;
        reauthorize(&state, &client, &handle).await?;
        let parent = content::read(
            &handle.path,
            if body.action == "readChildImage" {
                Selection::Digest
            } else {
                Selection::All
            },
            Some(permit.clone()),
        )
        .await?;
        let (mut bytes, mut version, mut generation) =
            (parent.bytes, parent.version, parent.generation);
        ensure!(
            Some(generation.as_str()) == request["expectedGeneration"].as_str(),
            "read_failed"
        );
        if body.action == "readChildImage" {
            ensure!(handle.allow_children, "source_not_authorized");
            let candidate = reference_path(
                request["rawReference"]
                    .as_str()
                    .context("source_not_authorized")?,
                handle.path.parent().context("source_not_authorized")?,
            )?;
            let path = tokio::fs::canonicalize(candidate)
                .await
                .context("file_not_found")?;
            ensure!(path.starts_with(&handle.root), "outside_authorized_root");
            (bytes, version, generation) = content(&path, Some(permit.clone())).await?;
        }
        let mime = if body.action == "download" {
            "application/octet-stream"
        } else {
            image_mime(&bytes).context("decode_failed")?
        };
        let mut response = ([(header::CONTENT_TYPE, mime)], bytes).into_response();
        response
            .headers_mut()
            .insert("x-rovai-content-generation", generation.parse()?);
        response
            .headers_mut()
            .insert("x-rovai-content-version", version.to_string().parse()?);
        if body.action == "download" {
            response.headers_mut().insert(
                header::CONTENT_DISPOSITION,
                disposition(&handle.name).parse()?,
            );
        }
        Ok::<_, anyhow::Error>(response)
    }
    .await;
    result.unwrap_or_else(|error| {
        Json(failure(match error.to_string().as_str() {
            "file_too_large" => "file_too_large",
            "decode_failed" => "decode_failed",
            "file_unreadable" => "attachment_unreadable",
            "not_regular_file" => "not_regular_file",
            "outside_authorized_root" => "outside_authorized_root",
            "file_not_found" => "file_not_found",
            "source_not_authorized" => "source_not_authorized",
            _ => "read_failed",
        }))
        .into_response()
    })
}

pub(super) fn disposition(name: &str) -> String {
    let encoded: String = name
        .as_bytes()
        .iter()
        .map(|byte| format!("%{byte:02X}"))
        .collect();
    format!("attachment; filename*=UTF-8''{encoded}")
}

pub async fn attachment(
    State(state): State<WebState>,
    Extension(session): Extension<Arc<Session>>,
    Json(mut locator): Json<Value>,
) -> Response {
    let client = DraftClient::verified_web(&session.client_id).expect("Host editor identity");
    let result = async {
        normalize_thread_scope(&mut locator)?;
        let source = json!({"kind":"attachment","threadId":locator["threadId"],"locator":locator});
        let resolved = resolve(&state, &client, &source).await?;
        let (bytes, _, _) = content(&resolved.path, None).await?;
        let name = resolved.name;
        // Encode every UTF-8 byte: no source name can inject a response header or
        // silently lose its original extension in a browser download.
        let disposition = disposition(&name);
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

// A sandbox document receives only this handle-scoped resource capability. It
// cannot use the editing Session or turn a path into a new file capability.
pub async fn preview_asset(
    State(state): State<WebState>,
    Path((token, relative)): Path<(String, String)>,
) -> Response {
    let result = async {
        let handle = state
            .files
            .0
            .lock()
            .expect("file registry poisoned")
            .values()
            .find(|handle| handle.preview_token == token && handle.allow_children)
            .cloned()
            .context("source_not_authorized")?;
        ensure!(
            state.sessions.is_live(&handle.session),
            "source_not_authorized"
        );
        let client = DraftClient::verified_web(&handle.client)?;
        reauthorize(&state, &client, &handle).await?;
        // Axum decodes the route once. Do not give encoded separators, dot
        // segments, absolute paths or Windows syntax another interpretation.
        ensure!(
            relative.len() <= 8192
                && !relative.is_empty()
                && relative.split('/').all(|part| !part.is_empty()
                    && part != "."
                    && part != ".."
                    && !part
                        .chars()
                        .any(|c| c == '\\' || c == ':' || c.is_control())),
            "outside_authorized_root"
        );
        let candidate = handle.root.join(&relative);
        let path = tokio::fs::canonicalize(&candidate)
            .await
            .context("file_not_found")?;
        ensure!(path.starts_with(&handle.root), "outside_authorized_root");
        let mime = match path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "html" | "htm" => "text/html; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "js" | "mjs" => "text/javascript; charset=utf-8",
            "json" | "map" => "application/json",
            "txt" => "text/plain; charset=utf-8",
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "avif" => "image/avif",
            "ico" => "image/x-icon",
            "woff" => "font/woff",
            "woff2" => "font/woff2",
            "ttf" => "font/ttf",
            "otf" => "font/otf",
            "wasm" => "application/wasm",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            _ => anyhow::bail!("source_not_authorized"),
        };
        let permit = state.uploads.clone().try_acquire_owned()?;
        let (bytes, _, _) = content(&path, Some(Arc::new(permit))).await?;
        ensure!(
            tokio::fs::canonicalize(&candidate).await? == path,
            "outside_authorized_root"
        );
        ensure!(
            state.sessions.is_live(&handle.session),
            "source_not_authorized"
        );
        ensure!(
            state
                .files
                .0
                .lock()
                .expect("file registry poisoned")
                .values()
                .any(|current| current.preview_token == token),
            "source_not_authorized"
        );
        Ok::<_, anyhow::Error>(([(header::CONTENT_TYPE, mime)], bytes).into_response())
    }
    .await;
    result.unwrap_or_else(|_| error(StatusCode::NOT_FOUND, "preview_resource_unavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_file_sources_include_exact_run_activity_files() {
        for kind in [
            "camp_workspace",
            "message_reference",
            "run_evidence",
            "run_activity_file",
        ] {
            assert!(is_core_file_source_kind(Some(kind)));
        }
        assert!(!is_core_file_source_kind(Some("authorized_root")));
        assert!(!is_core_file_source_kind(None));
    }

    // Owns UTF-8/byte offsets at the new HTTP paging seam. The Desktop reader
    // cannot exercise this Rust boundary; no database or real file is needed.
    #[test]
    fn page_boundaries_preserve_scalars_and_progress() {
        let base = std::env::temp_dir().join("workspace");
        for reference in ["./a%20b.md#L3", "./a%20b.md:3:2", "`./a%20b.md:3-5`"] {
            assert_eq!(
                reference_path(reference, &base).unwrap(),
                base.join("a b.md")
            );
        }
        let uri = url::Url::from_file_path(base.join("a b.md")).unwrap();
        assert_eq!(
            reference_path(uri.as_str(), &base).unwrap(),
            base.join("a b.md")
        );
        #[cfg(windows)]
        {
            for reference in [
                r"C:\external\a%20b.md:3:2",
                "C:/external/a%20b.md#L3",
                "file:///C:/external/a%20b.md",
            ] {
                assert_eq!(
                    reference_path(reference, &base).unwrap(),
                    PathBuf::from(r"C:\external\a b.md")
                );
            }
            assert_eq!(
                reference_path(r"C:\external\a%2520b.md", &base).unwrap(),
                PathBuf::from(r"C:\external\a%20b.md")
            );
            assert!(reference_path(r"\\remote\share\a.md", &base).is_err());
            assert!(reference_path("C:relative.md", &base).is_err());
        }
        assert!(reference_path("https://example.com/a.md", &base).is_err());
        assert!(reference_path("file://example.com/a.md", &base).is_err());
        let text = "a你好\n🌸z";
        assert_eq!(page_range(text, 0, 3).unwrap(), (0, 1));
        assert_eq!(page_range(text, 1, 1).unwrap(), (1, 4));
        assert_eq!(page_range(text, 7, 3).unwrap(), (7, 8));
        assert_eq!(page_range(text, 8, 1).unwrap(), (8, 12));
        assert_eq!(page_range(text, 13, 1).unwrap(), (13, 13));
        assert!(page_range(text, 2, 5).is_err());
        assert!(page_range(text, u64::MAX, 1).is_err());
    }
}
