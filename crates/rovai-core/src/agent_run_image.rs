//! Local-only images from adapted, structured Runtime results. These are not messages or attachments.
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{agent_profile::AdapterKind, db::Database, managed_blob::ManagedBlobStore};

pub const IMAGE_EVENT: &str = "runtime.images.observed";
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_RUN_BYTES: usize = 100 * 1024 * 1024;
const MAX_RUN_IMAGES: usize = 20;
// Structured stream frames may contain multiple base64 images; log limits must not reject them.
pub const MAX_IMAGE_EVENT_BYTES: usize = MAX_RUN_BYTES.div_ceil(3) * 4 + 2 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeImageCandidate {
    pub data: Option<String>,
    pub path: Option<String>,
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeImageObservation {
    pub tool_call_id: String,
    pub tool_name: Option<String>,
    pub images: Vec<RuntimeImageCandidate>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunImageView {
    pub id: String,
    pub display_name: String,
    pub media_type: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunImagesView {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub created_at: String,
    pub images: Vec<AgentRunImageView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunImageContent {
    pub media_type: String,
    pub data: String,
}

// Only called on protocol-defined image blocks, never arbitrary text, locations, or rawOutput.
fn image_block(block: &Value) -> Option<RuntimeImageCandidate> {
    if block.get("type")?.as_str()? != "image" {
        return None;
    }
    let data = block
        .get("data")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let path = block.get("uri").and_then(Value::as_str);
    if data.is_none() && path.is_none() {
        return None;
    }
    if data.is_some_and(|data| data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4) {
        return None;
    }
    Some(RuntimeImageCandidate {
        data: data.map(str::to_owned),
        path: path.map(str::to_owned),
        media_type: block
            .get("mimeType")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

pub fn claude_tool_images(
    block: &Value,
    tool_name: Option<String>,
) -> Option<RuntimeImageObservation> {
    if block.get("type")?.as_str()? != "tool_result" {
        return None;
    }
    let tool_call_id = block.get("tool_use_id")?.as_str()?.to_owned();
    let images = block
        .get("content")?
        .as_array()?
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? != "image" {
                return None;
            }
            let source = block.get("source")?;
            if source.get("type")?.as_str()? != "base64" {
                return None;
            }
            let data = source.get("data")?.as_str()?;
            if data.is_empty() || data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
                return None;
            }
            Some(RuntimeImageCandidate {
                data: Some(data.to_owned()),
                path: None,
                media_type: source
                    .get("media_type")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
        .take(MAX_RUN_IMAGES)
        .collect::<Vec<_>>();
    (!images.is_empty()).then_some(RuntimeImageObservation {
        tool_call_id,
        tool_name,
        images,
    })
}

pub fn codex_tool_images(message: &Value) -> Option<RuntimeImageObservation> {
    if message.get("method")?.as_str()? != "item/completed" {
        return None;
    }
    let item = message.pointer("/params/item")?;
    // Codex app-server ImageGenerationItem: result is PNG base64; savedPath is optional metadata.
    // Keep result even when a path is present (including ephemeral generated-image directories).
    if item.get("type")?.as_str()? == "imageGeneration" {
        let data = item
            .get("result")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let path = item.get("savedPath").and_then(Value::as_str);
        if (data.is_none() && path.is_none())
            || data.is_some_and(|value| value.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4)
        {
            return None;
        }
        return Some(RuntimeImageObservation {
            tool_call_id: item.get("id")?.as_str()?.to_owned(),
            tool_name: Some("imageGeneration".into()),
            images: vec![RuntimeImageCandidate {
                data: data.map(str::to_owned),
                path: path.map(str::to_owned),
                media_type: Some("image/png".into()),
            }],
        });
    }
    if item.get("type")?.as_str()? != "mcpToolCall" {
        return None;
    }
    let tool_call_id = item.get("id")?.as_str()?.to_owned();
    let images = item
        .pointer("/result/content")?
        .as_array()?
        .iter()
        .filter_map(image_block)
        .take(MAX_RUN_IMAGES)
        .collect::<Vec<_>>();
    (!images.is_empty()).then_some(RuntimeImageObservation {
        tool_call_id,
        tool_name: item.get("tool").and_then(Value::as_str).map(str::to_owned),
        images,
    })
}

/// AGY 1.1.22 GetCascadeTrajectorySteps result, correlated to the completed stream step.
/// Its stream-json tool_info contains arguments, not the generated media result.
pub fn antigravity_tool_images(
    response: &Value,
    conversation_id: &str,
    step_index: u64,
) -> Option<RuntimeImageObservation> {
    let step = response.get("steps")?.as_array()?.iter().find(|step| {
        step.get("type").and_then(Value::as_str) == Some("CORTEX_STEP_TYPE_GENERATE_IMAGE")
            && step.get("status").and_then(Value::as_str) == Some("CORTEX_STEP_STATUS_DONE")
            && step
                .pointer("/metadata/sourceTrajectoryStepInfo/cascadeId")
                .and_then(Value::as_str)
                == Some(conversation_id)
            && step
                .pointer("/metadata/sourceTrajectoryStepInfo/stepIndex")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                == step_index
    })?;
    let media = step.pointer("/generateImage/generatedMedia")?;
    let data = media
        .get("inlineData")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let path = media
        .get("uri")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    if (data.is_none() && path.is_none())
        || data.is_some_and(|value| value.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4)
    {
        return None;
    }
    Some(RuntimeImageObservation {
        tool_call_id: format!("agy:{conversation_id}:step:{step_index}"),
        tool_name: Some("generate_image".into()),
        images: vec![RuntimeImageCandidate {
            data: data.map(str::to_owned),
            path: path.map(str::to_owned),
            media_type: media
                .get("mimeType")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }],
    })
}

/// Prompt-owned, bounded accumulation; sparse completion never discards earlier images.
#[derive(Debug, Default)]
pub struct AcpImageAccumulator {
    tools: HashMap<String, (Option<String>, Vec<RuntimeImageCandidate>)>,
    seen: HashSet<(String, String)>,
    retained_bytes: usize,
}

impl AcpImageAccumulator {
    pub fn observe(
        &mut self,
        adapter_kind: AdapterKind,
        message: &Value,
    ) -> Option<RuntimeImageObservation> {
        if message.get("method")?.as_str()? != "session/update" {
            return None;
        }
        let update = message.pointer("/params/update")?;
        if !matches!(
            update.get("sessionUpdate")?.as_str()?,
            "tool_call" | "tool_call_update"
        ) {
            return None;
        }
        let tool_id = update.get("toolCallId")?.as_str()?;
        if tool_id.is_empty() {
            return None;
        }
        let images = update
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|wrapper| {
                (wrapper.get("type")?.as_str()? == "content").then_some(())?;
                image_block(wrapper.get("content")?)
            })
            .chain(
                (adapter_kind == AdapterKind::TraeCnCli)
                    .then(|| trae_tool_image(update))
                    .flatten(),
            )
            .chain(
                update
                    .pointer("/rawOutput/binaryResultsForLlm")
                    .filter(|_| adapter_kind == AdapterKind::CopilotCli)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(image_block),
            );
        for image in images {
            let key = image
                .data
                .as_deref()
                .map(|data| format!("{:x}", Sha256::digest(data)))
                .or_else(|| image.path.clone())?;
            let size = image.data.as_ref().map_or(0, String::len);
            if self.seen.len() >= MAX_RUN_IMAGES
                || self.retained_bytes.saturating_add(size) > MAX_RUN_BYTES.div_ceil(3) * 4
                || !self.seen.insert((tool_id.to_owned(), key))
            {
                continue;
            }
            self.retained_bytes += size;
            let (name, images) = self.tools.entry(tool_id.to_owned()).or_default();
            if name.is_none() {
                *name = update
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            images.push(image);
        }
        if !matches!(
            update.get("status").and_then(Value::as_str),
            Some("completed" | "failed")
        ) {
            return None;
        }
        let (tool_name, images) = self.tools.remove(tool_id)?;
        self.retained_bytes = self.retained_bytes.saturating_sub(
            images
                .iter()
                .filter_map(|image| image.data.as_ref())
                .map(String::len)
                .sum(),
        );
        Some(RuntimeImageObservation {
            tool_call_id: tool_id.to_owned(),
            tool_name,
            images,
        })
    }
}

// TRAE 0.120.52 Read image results omit ACP Image blocks. Only this verified builtin
// output shape is admitted; rawInput, locations and text paths remain non-sources.
fn trae_tool_image(update: &Value) -> Option<RuntimeImageCandidate> {
    if update.pointer("/_meta/type")?.as_str()? != "builtin" {
        return None;
    }
    let result = update.pointer("/rawOutput/Output")?;
    let media_type = result.get("mime_type")?.as_str()?;
    if !media_type.starts_with("image/") {
        return None;
    }
    let data = result.get("content")?.as_str()?;
    if data.is_empty() || data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return None;
    }
    Some(RuntimeImageCandidate {
        data: Some(data.to_owned()),
        path: result
            .get("file_path")
            .and_then(Value::as_str)
            .map(str::to_owned),
        media_type: Some(media_type.to_owned()),
    })
}

fn local_path(source: &str, execution_root: &Path) -> Option<PathBuf> {
    if source.starts_with("file:") {
        return url::Url::parse(source).ok()?.to_file_path().ok();
    }
    if source.contains("://") || source.starts_with("data:") {
        return None;
    }
    let path = Path::new(source);
    (!source.is_empty()).then(|| {
        if path.is_absolute() {
            path.to_owned()
        } else {
            execution_root.join(path)
        }
    })
}

fn is_run_temporary(path: &Path, run_tmp: Option<&Path>) -> bool {
    let Some(run_tmp) = run_tmp else { return false };
    // Canonicalization classifies lifecycle only. Stable paths and symlinks are permitted anywhere.
    path.starts_with(run_tmp)
        || fs::canonicalize(path)
            .ok()
            .zip(fs::canonicalize(run_tmp).ok())
            .is_some_and(|(path, root)| path.starts_with(root))
}

fn image_media_type(hint: Option<&str>, path: Option<&Path>) -> String {
    let media_type = hint.filter(|hint| {
        matches!(
            *hint,
            "image/png"
                | "image/jpeg"
                | "image/webp"
                | "image/gif"
                | "image/avif"
                | "image/svg+xml"
                | "image/bmp"
                | "image/x-icon"
                | "image/vnd.microsoft.icon"
        )
    });
    media_type
        .map(str::to_owned)
        .or_else(|| {
            Some(
                match path?.extension()?.to_str()?.to_ascii_lowercase().as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "webp" => "image/webp",
                    "gif" => "image/gif",
                    "avif" => "image/avif",
                    "svg" => "image/svg+xml",
                    "bmp" => "image/bmp",
                    "ico" => "image/x-icon",
                    _ => return None,
                }
                .to_owned(),
            )
        })
        .unwrap_or_else(|| "application/octet-stream".into())
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path)?; // Deliberately follows symlinks.
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        anyhow::bail!("Runtime image is not a bounded ordinary file");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        anyhow::bail!("Runtime image is no longer an ordinary file");
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        anyhow::bail!("Runtime image exceeds the read limit");
    }
    Ok(bytes)
}

pub fn record_images(
    database: &mut Database,
    blobs: &ManagedBlobStore,
    agent_run_id: &str,
    execution_epoch: i64,
    run_tmp: Option<&Path>,
    observation: &RuntimeImageObservation,
) -> Result<usize> {
    let root = database
        .connection()
        .query_row(
            "SELECT json_extract(workspace_json, '$.executionRoot') FROM agent_run
         WHERE id = ?1 AND execution_epoch = ?2 AND status IN ('running', 'waiting')
           AND cancel_requested_at IS NULL",
            params![agent_run_id, execution_epoch],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(root) = root else { return Ok(0) };
    if observation.tool_call_id.is_empty() {
        return Ok(0);
    }
    let (mut count, mut total_bytes): (usize, usize) = database.connection().query_row(
        "SELECT COUNT(*), COALESCE(SUM(byte_size), 0) FROM agent_run_image WHERE agent_run_id = ?1",
        [agent_run_id],
        |row| {
            Ok((
                row.get::<_, i64>(0)? as usize,
                row.get::<_, i64>(1)? as usize,
            ))
        },
    )?;
    let mut inserted = 0;
    for candidate in observation.images.iter().take(MAX_RUN_IMAGES) {
        if count >= MAX_RUN_IMAGES {
            break;
        }
        // One bad image (including a transient read/storage failure) cannot fail the Run or its siblings.
        let result = (|| -> Result<usize> {
            let path = candidate
                .path
                .as_deref()
                .and_then(|source| local_path(source, Path::new(&root)));
            // Hints select a decoder input type; an extension/MIME is not an admission requirement.
            let media_type = image_media_type(candidate.media_type.as_deref(), path.as_deref());
            let (bytes, source_path, key, size) = if let Some(data) = candidate.data.as_deref() {
                if data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
                    return Ok(0);
                }
                let bytes = STANDARD.decode(data)?;
                let key = format!("bytes:{:x}", Sha256::digest(&bytes));
                let size = bytes.len();
                (Some(bytes), None, key, size)
            } else {
                let path = path.context("Runtime image has no local path")?;
                let metadata = fs::metadata(&path)?;
                if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
                    return Ok(0);
                }
                let key = format!("path:{}", path.display());
                if is_run_temporary(&path, run_tmp) {
                    let bytes = read_regular_file(&path)?;
                    let size = bytes.len();
                    (Some(bytes), None, key, size)
                } else {
                    (None, Some(path), key, metadata.len() as usize)
                }
            };
            if size == 0
                || size > MAX_IMAGE_BYTES
                || total_bytes.saturating_add(size) > MAX_RUN_BYTES
            {
                return Ok(0);
            }
            if database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_run_image
                 WHERE agent_run_id=?1 AND execution_epoch=?2 AND tool_call_id=?3 AND source_key=?4)",
                params![agent_run_id, execution_epoch, observation.tool_call_id, key],
                |row| row.get::<_, bool>(0),
            )? { return Ok(0) }
            let blob_id = bytes
                .as_deref()
                .map(|bytes| blobs.put_bytes(database, bytes, &media_type, "sensitive"))
                .transpose()?
                .map(|blob| blob.id);
            let display_name = candidate
                .path
                .as_deref()
                .and_then(|source| local_path(source, Path::new(&root)))
                .and_then(|path| {
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                })
                .unwrap_or_else(|| format!("运行图片 {}", count + 1));
            let changed = database.connection().execute(
                "INSERT OR IGNORE INTO agent_run_image
                 (id, agent_run_id, execution_epoch, tool_call_id, source_key, source_path,
                  content_blob_id, display_name, media_type, byte_size, ordinal, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    format!("run-image-{}", Uuid::new_v4()),
                    agent_run_id,
                    execution_epoch,
                    observation.tool_call_id,
                    key,
                    source_path.map(|path| path.to_string_lossy().into_owned()),
                    blob_id,
                    display_name,
                    media_type,
                    size as i64,
                    count as i64,
                    chrono::Utc::now().to_rfc3339()
                ],
            )?;
            if changed == 1 {
                count += 1;
                total_bytes += size;
            }
            Ok(changed)
        })();
        if let Ok(changed) = result {
            inserted += changed;
        }
    }
    Ok(inserted)
}

pub fn list_camp_images(connection: &Connection, camp_id: &str) -> Result<Vec<AgentRunImagesView>> {
    let mut statement = connection.prepare(
        "SELECT image.agent_run_id, image.execution_epoch, image.created_at, image.id,
                image.display_name, image.media_type, image.byte_size
         FROM agent_run_image image JOIN agent_run run ON run.id=image.agent_run_id
         JOIN camp_turn turn ON turn.id=run.camp_turn_id WHERE turn.camp_id=?1
         ORDER BY run.started_at, run.id, image.execution_epoch, image.ordinal, image.id",
    )?;
    let mut groups: Vec<AgentRunImagesView> = Vec::new();
    let mut rows = statement.query([camp_id])?;
    while let Some(row) = rows.next()? {
        let agent_run_id: String = row.get(0)?;
        let execution_epoch: i64 = row.get(1)?;
        if groups.last().is_none_or(|group| {
            group.agent_run_id != agent_run_id || group.execution_epoch != execution_epoch
        }) {
            groups.push(AgentRunImagesView {
                agent_run_id,
                execution_epoch,
                created_at: row.get(2)?,
                images: Vec::new(),
            });
        }
        groups
            .last_mut()
            .expect("image group exists")
            .images
            .push(AgentRunImageView {
                id: row.get(3)?,
                display_name: row.get(4)?,
                media_type: row.get(5)?,
                byte_size: row.get::<_, i64>(6)? as u64,
            });
    }
    Ok(groups)
}

/// The shared image UI genuinely decodes these bytes before displaying them; MIME is not validation.
/// No absolute source path is returned to Renderer, and a different Camp cannot read this image.
pub fn read_image(
    database: &Database,
    blobs: &ManagedBlobStore,
    camp_id: &str,
    image_id: &str,
) -> Result<Option<AgentRunImageContent>> {
    let source = database
        .connection()
        .query_row(
            "SELECT image.source_path, image.content_blob_id, image.media_type
         FROM agent_run_image image JOIN agent_run run ON run.id=image.agent_run_id
         JOIN camp_turn turn ON turn.id=run.camp_turn_id WHERE turn.camp_id=?1 AND image.id=?2",
            params![camp_id, image_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((path, blob_id, media_type)) = source else {
        return Ok(None);
    };
    let bytes = if let Some(blob_id) = blob_id {
        blobs.read_bytes(database, &blob_id)
    } else if let Some(path) = path {
        read_regular_file(Path::new(&path))
    } else {
        return Ok(None);
    };
    Ok(bytes
        .ok()
        .filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES)
        .map(|bytes| AgentRunImageContent {
            media_type,
            data: STANDARD.encode(bytes),
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn update(kind: &str, status: &str, content: Value) -> Value {
        json!({"method":"session/update","params":{"update":{
            "sessionUpdate":kind,"toolCallId":"tool-1","status":status,"content":content
        }}})
    }

    fn image(data: &str) -> Value {
        json!({"type":"content","content":{"type":"image","mimeType":"image/png","data":data}})
    }

    // Owner: structured Runtime image ingestion, not the text/evidence normalizers.
    #[test]
    fn sparse_acp_terminal_accumulates_images_in_order_and_deduplicates_replay() {
        for terminal in ["completed", "failed"] {
            let mut accumulator = AcpImageAccumulator::default();
            assert!(
                accumulator
                    .observe(
                        AdapterKind::OpencodeCli,
                        &update("tool_call", "in_progress", json!([image("YQ==")]))
                    )
                    .is_none()
            );
            assert!(
                accumulator
                    .observe(
                        AdapterKind::OpencodeCli,
                        &update(
                            "tool_call_update",
                            "in_progress",
                            json!([image("YQ=="), image("Yg==")])
                        )
                    )
                    .is_none()
            );
            let completed = update("tool_call_update", terminal, Value::Null);
            let observation = accumulator
                .observe(AdapterKind::OpencodeCli, &completed)
                .unwrap();
            assert_eq!(
                observation
                    .images
                    .iter()
                    .map(|image| image.data.as_deref().unwrap())
                    .collect::<Vec<_>>(),
                ["YQ==", "Yg=="]
            );
            assert!(accumulator.tools.is_empty());
            assert_eq!(accumulator.retained_bytes, 0);
            assert!(
                accumulator
                    .observe(AdapterKind::OpencodeCli, &completed)
                    .is_none()
            );
            assert!(
                accumulator
                    .observe(
                        AdapterKind::OpencodeCli,
                        &update("tool_call_update", terminal, json!([image("YQ==")]))
                    )
                    .is_none()
            );
        }
        let mut accumulator = AcpImageAccumulator::default();
        assert_eq!(
            accumulator
                .observe(
                    AdapterKind::OpencodeCli,
                    &update("tool_call", "completed", json!([image("YQ==")]))
                )
                .unwrap()
                .images
                .len(),
            1
        );
    }

    #[test]
    fn adapters_accept_only_structured_results_not_paths_in_text_or_inputs() {
        let mut accumulator = AcpImageAccumulator::default();
        let ignored = json!({"method":"session/update","params":{"update":{
            "sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed",
            "locations":[{"path":"/tmp/looks-like.png"}],"rawOutput":{"filePath":"/tmp/out.png"},
            "content":[{"type":"content","content":{"type":"text","text":"![image](/tmp/result.png)"}}]
        }}});
        assert!(
            accumulator
                .observe(AdapterKind::OpencodeCli, &ignored)
                .is_none()
        );
        let mut trae: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/runtime-images/trae-0.120.52-read-image.json"
        ))
        .unwrap();
        for adapter in [
            AdapterKind::OpencodeCli,
            AdapterKind::QoderCli,
            AdapterKind::QwenCode,
        ] {
            assert!(
                AcpImageAccumulator::default()
                    .observe(adapter, &trae)
                    .is_none(),
                "TRAE rawOutput is not a cross-vendor heuristic"
            );
        }
        trae["params"]["update"]["status"] = json!("in_progress");
        assert!(accumulator.observe(AdapterKind::TraeCnCli, &trae).is_none());
        let copilot: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/runtime-images/copilot-1.0.79-view-image.json"
        ))
        .unwrap();
        assert!(
            AcpImageAccumulator::default()
                .observe(AdapterKind::OpencodeCli, &copilot)
                .is_none()
        );
        assert!(
            AcpImageAccumulator::default()
                .observe(AdapterKind::TraeCnCli, &copilot)
                .is_none()
        );
        let images = accumulator
            .observe(AdapterKind::CopilotCli, &copilot)
            .unwrap();
        assert_eq!(images.images.len(), 1);
        assert_eq!(
            images.images[0].data.as_deref(),
            Some("aW1hZ2UtZml4dHVyZQ==")
        );
        assert!(images.images[0].path.is_none());
        assert!(
            accumulator
                .observe(AdapterKind::CopilotCli, &copilot)
                .is_none()
        );
        trae["params"]["update"]["rawOutput"] = Value::Null;
        trae["params"]["update"]["status"] = json!("completed");
        let captured = accumulator.observe(AdapterKind::TraeCnCli, &trae).unwrap();
        assert_eq!(captured.images.len(), 1);
        assert_eq!(
            captured.images[0].data.as_deref(),
            Some("aW1hZ2UtZml4dHVyZQ==")
        );
        assert_eq!(
            captured.images[0].path.as_deref(),
            Some("/fixture/blue-paper-boat.png")
        );
        assert!(accumulator.observe(AdapterKind::TraeCnCli, &trae).is_none());
        let claude = json!({"type":"tool_result","tool_use_id":"tool-c","content":[
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":"YQ=="}},
            {"type":"text","text":"/tmp/result.png"},
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":"Yg=="}},
            {"type":"image","source":{"type":"url","url":"https://example.com/result.png"}}
        ]});
        assert_eq!(
            claude_tool_images(&claude, Some("Read".into()))
                .unwrap()
                .images
                .len(),
            2
        );
        let mut codex = json!({"method":"item/completed","params":{"item":{
            "type":"mcpToolCall","id":"tool-m","tool":"screenshot","result":{"content":[
                {"type":"image","mimeType":"image/png","data":"YQ=="},
                {"type":"text","text":"/tmp/result.png"}
            ]}
        }}});
        assert_eq!(codex_tool_images(&codex).unwrap().images.len(), 1);
        codex["method"] = json!("item/started");
        assert!(codex_tool_images(&codex).is_none());
        codex["method"] = json!("item/completed");
        codex["params"]["item"]["type"] = json!("commandExecution");
        assert!(codex_tool_images(&codex).is_none());
        let generated = json!({"method":"item/completed","params":{"item":{
            "type":"imageGeneration","id":"native-1","status":"completed",
            "result":"YQ==","savedPath":"/tmp/generated.png","revisedPrompt":"not a result"
        }}});
        let native = codex_tool_images(&generated).unwrap();
        assert_eq!(native.images[0].data.as_deref(), Some("YQ=="));
        assert_eq!(native.images[0].path.as_deref(), Some("/tmp/generated.png"));
        let conversation_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let mut agy: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/runtime-images/antigravity-1.1.22-generate-image.json"
        ))
        .unwrap();
        let generated = antigravity_tool_images(&agy, conversation_id, 2).unwrap();
        assert_eq!(
            generated.images[0].path.as_deref(),
            Some("file:///fixture/blue-paper-boat.jpg")
        );
        assert!(
            generated.images[0].data.is_none(),
            "empty protobuf bytes are not an inline image"
        );
        assert_eq!(
            generated.images[0].media_type.as_deref(),
            Some("image/jpeg")
        );
        assert!(antigravity_tool_images(&agy, "other-conversation", 2).is_none());
        assert!(antigravity_tool_images(&agy, conversation_id, 3).is_none());
        agy["steps"][0]["status"] = json!("CORTEX_STEP_STATUS_ERROR");
        assert!(antigravity_tool_images(&agy, conversation_id, 2).is_none());
        agy["steps"][0]["status"] = json!("CORTEX_STEP_STATUS_DONE");
        agy["steps"][0]["generateImage"]["generatedMedia"]["inlineData"] = json!("YQ==");
        let generated = antigravity_tool_images(&agy, conversation_id, 2).unwrap();
        assert_eq!(generated.images[0].data.as_deref(), Some("YQ=="));
        assert!(
            generated.images[0].path.is_some(),
            "inline bytes and optional path both survive extraction"
        );
        agy["steps"][0]["type"] = json!("CORTEX_STEP_TYPE_RUN_COMMAND");
        assert!(antigravity_tool_images(&agy, conversation_id, 2).is_none());
        assert_eq!(
            image_media_type(None, Some(Path::new("/outside/no-extension"))),
            "application/octet-stream"
        );
    }

    fn seed(database: &Database, root: &Path) {
        database.connection().execute_batch(
            "INSERT INTO camp(id,title,project_binding_kind,project_path,last_message_sequence,version,created_at,updated_at)
             VALUES('image-camp','Images','directory','/fixture',0,1,'2026-08-31','2026-08-31');
             INSERT INTO conversation(id,camp_id,agent_id,created_at,updated_at)
             VALUES('image-conversation','image-camp','agent_1','2026-08-31','2026-08-31');
             INSERT INTO camp_turn(id,camp_id,trigger_type,trigger_id,status,created_at,updated_at)
             VALUES('image-turn','image-camp','system_event','image-trigger','running','2026-08-31','2026-08-31');",
        ).unwrap();
        database.connection().execute(
            "INSERT INTO agent_run(id,camp_turn_id,conversation_id,initial_camp_context_through_sequence,
             initial_conversation_context_through_sequence,responsibility_key,start_reason,purpose,completion_role,
             effective_config_json,workspace_json,status,idempotency_key,runtime_adapter_kind,execution_epoch,
             created_at,started_at,updated_at) VALUES('image-run','image-turn','image-conversation',0,0,
             'image-responsibility','initial','test','required','{}',?1,'running','image-run','qoder-cli',1,
             '2026-08-31','2026-08-31','2026-08-31')",
            [json!({"executionRoot":root}).to_string()],
        ).unwrap();
    }

    // One fixture owns the mixed-storage lifecycle, fences, quota, Camp scoping, and Blob GC roots.
    #[test]
    fn mixed_storage_survives_temporary_cleanup_without_copying_stable_paths() {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let root = database.directory().join("workspace");
        let tmp = database.directory().join("run-tmp");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&tmp).unwrap();
        seed(&database, &root);
        let blobs = ManagedBlobStore::new(database.directory());
        let stable = database.directory().join("outside.png");
        let temporary = tmp.join("temporary.png");
        fs::write(&stable, b"stable bytes").unwrap();
        fs::write(&temporary, b"temporary bytes").unwrap();
        let observation = RuntimeImageObservation {
            tool_call_id: "mixed".into(),
            tool_name: None,
            images: vec![
                RuntimeImageCandidate {
                    data: Some(STANDARD.encode(b"inline wins")),
                    path: Some(stable.to_string_lossy().into_owned()),
                    media_type: Some("image/png".into()),
                },
                RuntimeImageCandidate {
                    data: None,
                    path: Some(stable.to_string_lossy().into_owned()),
                    media_type: Some("image/png".into()),
                },
                RuntimeImageCandidate {
                    data: None,
                    path: Some(temporary.to_string_lossy().into_owned()),
                    media_type: Some("image/png".into()),
                },
                RuntimeImageCandidate {
                    data: None,
                    path: Some(root.to_string_lossy().into_owned()),
                    media_type: Some("image/png".into()),
                },
                RuntimeImageCandidate {
                    data: None,
                    path: Some("https://example.com/image.png".into()),
                    media_type: Some("image/png".into()),
                },
                RuntimeImageCandidate {
                    data: Some("invalid-base64".into()),
                    path: None,
                    media_type: Some("image/png".into()),
                },
            ],
        };
        assert_eq!(
            record_images(
                &mut database,
                &blobs,
                "image-run",
                1,
                Some(&tmp),
                &observation
            )
            .unwrap(),
            3
        );
        assert_eq!(
            record_images(
                &mut database,
                &blobs,
                "image-run",
                1,
                Some(&tmp),
                &observation
            )
            .unwrap(),
            0
        );
        assert_eq!(
            record_images(
                &mut database,
                &blobs,
                "image-run",
                2,
                Some(&tmp),
                &observation
            )
            .unwrap(),
            0
        );
        let groups = list_camp_images(database.connection(), "image-camp").unwrap();
        let images = &groups[0].images;
        assert_eq!(images.len(), 3);
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM managed_blob", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        fs::remove_file(&temporary).unwrap();
        assert_eq!(
            STANDARD
                .decode(
                    read_image(&database, &blobs, "image-camp", &images[0].id)
                        .unwrap()
                        .unwrap()
                        .data
                )
                .unwrap(),
            b"inline wins"
        );
        assert_eq!(
            STANDARD
                .decode(
                    read_image(&database, &blobs, "image-camp", &images[2].id)
                        .unwrap()
                        .unwrap()
                        .data
                )
                .unwrap(),
            b"temporary bytes"
        );
        assert!(
            read_image(&database, &blobs, "other-camp", &images[0].id)
                .unwrap()
                .is_none()
        );
        fs::write(&stable, b"changed stable bytes").unwrap();
        assert_eq!(
            STANDARD
                .decode(
                    read_image(&database, &blobs, "image-camp", &images[1].id)
                        .unwrap()
                        .unwrap()
                        .data
                )
                .unwrap(),
            b"changed stable bytes"
        );
        fs::remove_file(&stable).unwrap();
        assert!(
            read_image(&database, &blobs, "image-camp", &images[1].id)
                .unwrap()
                .is_none()
        );
        assert!(
            blobs
                .collect_unreferenced_before(&mut database, "2999-01-01T00:00:00Z")
                .unwrap()
                .is_empty()
        );
        // Sparse stable files exercise the byte budget without allocating/decoding 100 MiB in a test.
        let mut large = RuntimeImageObservation {
            tool_call_id: "quota-bytes".into(),
            tool_name: None,
            images: vec![],
        };
        for index in 0..5 {
            let path = root.join(format!("large-{index}.png"));
            fs::File::create(&path)
                .unwrap()
                .set_len(MAX_IMAGE_BYTES as u64)
                .unwrap();
            large.images.push(RuntimeImageCandidate {
                data: None,
                path: Some(path.to_string_lossy().into_owned()),
                media_type: None,
            });
        }
        assert_eq!(
            record_images(&mut database, &blobs, "image-run", 1, Some(&tmp), &large).unwrap(),
            4
        );
        let mut small = RuntimeImageObservation {
            tool_call_id: "quota-count".into(),
            tool_name: None,
            images: vec![],
        };
        for index in 0..20 {
            let path = root.join(format!("small-{index}"));
            fs::write(&path, b"x").unwrap();
            small.images.push(RuntimeImageCandidate {
                data: None,
                path: Some(path.to_string_lossy().into_owned()),
                media_type: None,
            });
        }
        assert_eq!(
            record_images(&mut database, &blobs, "image-run", 1, Some(&tmp), &small).unwrap(),
            13
        );
        assert_eq!(
            record_images(&mut database, &blobs, "image-run", 1, Some(&tmp), &small).unwrap(),
            0
        );
        assert_eq!(
            list_camp_images(database.connection(), "image-camp").unwrap()[0]
                .images
                .len(),
            MAX_RUN_IMAGES
        );
        // Runtime observations never turn into a public message, an attachment, or a delivery.
        for table in ["camp_message", "managed_attachment", "channel_delivery"] {
            assert_eq!(
                database
                    .connection()
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        database.connection().execute("UPDATE agent_run SET status='failed',ended_at='2026-08-31T01:00:00Z' WHERE id='image-run'",[]).unwrap();
        let mut fresh = observation.clone();
        fresh.tool_call_id = "after-terminal".into();
        assert_eq!(
            record_images(&mut database, &blobs, "image-run", 1, Some(&tmp), &fresh).unwrap(),
            0
        );
        database
            .connection()
            .execute("DELETE FROM agent_run WHERE id='image-run'", [])
            .unwrap();
        assert!(
            list_camp_images(database.connection(), "image-camp")
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            blobs
                .collect_unreferenced_before(&mut database, "2999-01-01T00:00:00Z")
                .unwrap()
                .len(),
            2
        );
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_symlink_targets_are_readable_and_temp_aliases_are_persisted() {
        let directory =
            std::env::temp_dir().join(format!("rovai-image-path-test-{}", Uuid::new_v4()));
        let tmp = directory.join("tmp");
        fs::create_dir_all(&tmp).unwrap();
        let target = tmp.join("image.png");
        fs::write(&target, b"image bytes").unwrap();
        let link = directory.join("outside-link.png");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(read_regular_file(&link).unwrap(), b"image bytes");
        assert!(is_run_temporary(&link, Some(&tmp)));
        assert!(!is_run_temporary(
            &link,
            Some(&directory.join("other-run-tmp"))
        ));
        assert!(read_regular_file(&tmp).is_err());
        assert_eq!(
            local_path("../outside.png", &tmp).unwrap(),
            tmp.join("../outside.png")
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
