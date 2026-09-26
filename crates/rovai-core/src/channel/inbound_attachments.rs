//! Durable Channel downloads use the existing inbound queue and Camp-owned output.
//! No CampMessage/Delivery may be published until every resource has a source ref.
use super::*;
use crate::local_attachment_source::{LocalAttachmentSourceRef, observe_agent_source_attachments};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

const MAX_BYTES: u64 = 100 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboundResource {
    pub file_key: String,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_code: Option<String>,
}

pub(super) fn validate_resources(resources: &[InboundResource]) -> Result<()> {
    anyhow::ensure!(
        resources.len() <= 20,
        "channel message has too many resources"
    );
    let mut keys = BTreeSet::new();
    for resource in resources {
        anyhow::ensure!(
            resource
                .download_code
                .as_ref()
                .is_none_or(|code| !code.is_empty() && code.len() <= 4096),
            "invalid channel resource download code"
        );
        anyhow::ensure!(
            !resource.file_key.is_empty() && resource.file_key.len() <= 512,
            "invalid channel resource key"
        );
        anyhow::ensure!(
            keys.insert(&resource.file_key),
            "duplicate channel resource"
        );
        anyhow::ensure!(
            !resource.name.is_empty() && resource.name.len() <= 1024,
            "invalid channel resource name"
        );
        anyhow::ensure!(
            matches!(
                resource.kind.as_str(),
                "image" | "file" | "audio" | "video" | "sticker" | "folder"
            ),
            "invalid channel resource kind"
        );
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InboundAttachments {
    #[serde(default)]
    message_id: String,
    #[serde(default)]
    resources: Vec<InboundResource>,
    #[serde(default)]
    pub(super) sources: Vec<LocalAttachmentSourceRef>,
    #[serde(default)]
    attempts: u32,
    #[serde(default)]
    retry_at: Option<String>,
}

impl InboundAttachments {
    pub(super) fn new(message_id: &str, resources: &[InboundResource]) -> Self {
        Self {
            message_id: message_id.into(),
            resources: resources.to_vec(),
            ..Self::default()
        }
    }

    pub(super) fn ready(&self) -> bool {
        self.resources.len() == self.sources.len()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAttachments {
    pub request_id: String,
    pub app_id: String,
    pub message_id: String,
    pub resources: Vec<InboundResource>,
    pub attempt: u32,
    pub retry_at: Option<String>,
}

pub(super) fn for_request(
    db: &rusqlite::Connection,
    request_id: &str,
) -> Result<InboundAttachments> {
    let encoded: String = db.query_row(
        "SELECT aggregate.frozen_payload_json FROM channel_turn_request AS request
         JOIN channel_inbound_aggregate AS aggregate ON aggregate.id = request.aggregate_id
         WHERE request.id = ?1",
        [request_id],
        |row| row.get(0),
    )?;
    let frozen: FrozenInboundPayload = serde_json::from_str(&encoded)?;
    Ok(frozen.inbound_attachments)
}

pub(super) fn pending(
    db: &rusqlite::Connection,
    provider: &str,
    app_ids: &[String],
) -> Result<Vec<PendingAttachments>> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare(
        "SELECT request.id, request.ack_app_id, aggregate.frozen_payload_json
         FROM channel_turn_request AS request
         JOIN channel_inbound_aggregate AS aggregate ON aggregate.id = request.aggregate_id
         JOIN camp ON camp.id = request.camp_id
         WHERE request.status = 'queued' AND aggregate.provider = ?2
           AND request.ack_app_id IN (SELECT value FROM json_each(?1))
           AND camp.deletion_operation_id IS NULL
           AND json_array_length(aggregate.frozen_payload_json, '$.inboundAttachments.resources') >
               json_array_length(aggregate.frozen_payload_json, '$.inboundAttachments.sources')
         ORDER BY request.created_at, request.id LIMIT 20",
    )?;
    let rows = statement.query_map(params![serde_json::to_string(app_ids)?, provider], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut pending = Vec::new();
    for row in rows {
        let (request_id, app_id, encoded) = row?;
        let frozen: FrozenInboundPayload = serde_json::from_str(&encoded)?;
        let state = frozen.inbound_attachments;
        pending.push(PendingAttachments {
            request_id,
            app_id,
            message_id: state.message_id,
            resources: state.resources,
            attempt: state.attempts,
            retry_at: state.retry_at,
        });
    }
    Ok(pending)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteAttachmentsCommand {
    pub request_id: String,
    pub app_id: String,
    pub attempt: u32,
    #[serde(default)]
    pub files: Vec<String>,
    pub failure_code: Option<String>,
}
impl sealed::Sealed for CompleteAttachmentsCommand {}
impl DomainCommand for CompleteAttachmentsCommand {
    const TYPE: &'static str = "channel.inbound.attachments.complete";
}

pub fn complete(
    database: &mut Database,
    envelope: &CommandEnvelope<CompleteAttachmentsCommand>,
) -> Result<CommandExecution> {
    let output_base = database.runtime_camp_files_root().to_path_buf();
    DomainCommandGateway.execute(database, envelope, |transaction| {
        let Some(provider) = channel_host_provider(&envelope.actor) else {
            return Ok(rejected("channel.host_required", "Only a trusted Channel Host can complete downloads"));
        };
        let command = &envelope.payload;
        let row = transaction.query_row(
            "SELECT request.camp_id, request.aggregate_id, aggregate.frozen_payload_json
             FROM channel_turn_request AS request
             JOIN channel_inbound_aggregate AS aggregate ON aggregate.id = request.aggregate_id
             JOIN camp ON camp.id = request.camp_id
             JOIN channel_conversation_binding AS binding ON binding.id = request.binding_id
             WHERE request.id = ?1 AND request.ack_app_id = ?2 AND request.status = 'queued'
               AND aggregate.provider = ?3 AND binding.status = 'active'
               AND camp.deletion_operation_id IS NULL",
            params![command.request_id, command.app_id, provider],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).optional()?;
        let Some((camp_id, aggregate_id, encoded)) = row else {
            return Ok(rejected("channel.attachments.closed", "The message is no longer awaiting attachments"));
        };
        let mut frozen: Value = serde_json::from_str(&encoded)?;
        let mut state = for_request(transaction, &command.request_id)?;
        if state.ready() || state.attempts != command.attempt {
            return Ok(CommandHandlerResult::applied("channel.attachments.replayed", json!({}), None));
        }
        let now = Utc::now();
        if state.retry_at.as_deref().is_some_and(|at| at > now.to_rfc3339().as_str()) {
            return Ok(rejected("channel.attachments.retry_not_due", "Attachment retry is not due"));
        }
        let imported = if let Some(code) = &command.failure_code {
            Err(anyhow::anyhow!("{}", code))
        } else {
            import_files(&output_base, provider, &camp_id, &command.request_id, &state.resources, &command.files)
        };
        match imported {
            Ok(sources) => { state.sources = sources; state.retry_at = None; }
            Err(error) => {
                state.attempts += 1;
                let code = match error.to_string().as_str() {
                    "channel.attachments.too_large" => "channel.attachments.too_large",
                    "channel.attachments.unsupported" => "channel.attachments.unsupported",
                    "channel.attachments.permission_denied" => "channel.attachments.permission_denied",
                    _ => "channel.attachments.download_failed",
                };
                if state.attempts >= MAX_ATTEMPTS || code != "channel.attachments.download_failed" {
                    state.retry_at = None;
                    fail_queued_request(transaction, &command.request_id, &command.app_id, code, &now.to_rfc3339())?;
                    transaction.execute("DELETE FROM channel_delivery WHERE request_id = ?1 AND delivery_kind = 'queue_ack' AND status = 'pending'", [&command.request_id])?;
                    transaction.execute(
                        "UPDATE channel_delivery SET payload_json = json_set(payload_json, '$.text', ?2)
                         WHERE request_id = ?1 AND delivery_kind = 'attention' AND status = 'pending'",
                        params![command.request_id, failure_message(code)])?;
                } else {
                    state.retry_at = Some((now + Duration::seconds(5 * i64::from(state.attempts))).to_rfc3339());
                }
            }
        }
        frozen["inboundAttachments"] = serde_json::to_value(&state)?;
        transaction.execute("UPDATE channel_inbound_aggregate SET frozen_payload_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![aggregate_id, serde_json::to_string(&frozen)?, now.to_rfc3339()])?;
        Ok(CommandHandlerResult::applied("channel.attachments.completed", json!({
            "ready": state.ready(), "retryAt": state.retry_at,
        }), None))
    })
}

fn failure_message(code: &str) -> &'static str {
    match code {
        "channel.attachments.too_large" => {
            "附件超过限制（每条消息合计 100 MB），本条消息未交给队员。请缩小附件后重新发送。"
        }
        "channel.attachments.unsupported" => {
            "暂不支持下载此类附件，本条消息未交给队员。请改为普通图片或文件重新发送。"
        }
        "channel.attachments.permission_denied" => {
            "机器人无法读取这条消息的附件，本条消息未交给队员。请检查机器人的消息资源权限后重新发送。"
        }
        _ => "附件下载失败，重试后仍未完成，本条消息未交给队员。请稍后重新发送。",
    }
}

fn import_files(
    base: &Path,
    provider: &str,
    camp_id: &str,
    request_id: &str,
    resources: &[InboundResource],
    files: &[String],
) -> Result<Vec<LocalAttachmentSourceRef>> {
    use crate::local_attachment_snapshot::normalize_display_name;
    anyhow::ensure!(
        resources.len() == files.len(),
        "channel attachments are incomplete"
    );
    let root = crate::storage_layout::camp_attachment_output_root(base, camp_id)?
        .join(provider)
        .join(format!("{:x}", Sha256::digest(request_id.as_bytes())));
    let mut total = 0_u64;
    let mut sources = Vec::new();
    for (ordinal, (resource, file)) in resources.iter().zip(files).enumerate() {
        anyhow::ensure!(
            !matches!(resource.kind.as_str(), "sticker" | "folder"),
            "channel.attachments.unsupported"
        );
        let source = Path::new(file);
        anyhow::ensure!(
            source.is_absolute() && source.is_file(),
            "attachment source must be a local file"
        );
        let size = fs::metadata(source)?.len();
        total = total
            .checked_add(size)
            .context("channel.attachments.too_large")?;
        anyhow::ensure!(total <= MAX_BYTES, "channel.attachments.too_large");
        // A separate ordinal directory preserves duplicate original filenames.
        let directory = root.join(ordinal.to_string());
        crate::camp_attachment_view::reject_existing_symlink_components(&directory)?;
        fs::create_dir_all(&directory)?;
        let name = normalize_display_name(&resource.name)?;
        let safe_name = name.replace(['<', '>', '"', '|', '?', '*'], "_");
        let target = directory.join(format!("file-{safe_name}"));
        crate::camp_attachment_view::reject_existing_symlink_components(&target)?;
        let staging = directory.join(format!("{}.part", Uuid::new_v4()));
        let staged = copy_bounded(source, &staging, size);
        if let Err(error) = staged {
            let _ = fs::remove_file(&staging);
            return Err(error);
        }
        // Retries do not replace a previously promoted (possibly edited) file.
        if target.exists() {
            fs::remove_file(&staging)?;
        } else if let Err(error) = fs::rename(&staging, &target) {
            let _ = fs::remove_file(&staging);
            return Err(error.into());
        }
        let mut observed =
            observe_agent_source_attachments(&[target.to_string_lossy().into_owned()], &directory)?;
        let mut source_ref = observed.remove(0);
        source_ref.display_name = name;
        sources.push(source_ref);
    }
    Ok(sources)
}

fn copy_bounded(source: &Path, target: &PathBuf, expected: u64) -> Result<()> {
    let mut reader = fs::File::open(source)?.take(expected + 1);
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    let actual = std::io::copy(&mut reader, &mut writer)?;
    anyhow::ensure!(
        actual == expected,
        "channel attachment changed during import"
    );
    writer.flush()?;
    writer.sync_all()?;
    Ok(())
}
