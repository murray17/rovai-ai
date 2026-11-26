//! Host upload ingress into client-scoped source references. Ordinary uploads
//! keep their source lifetime; generated paste files have deletion eligibility.
use crate::{
    command::*, db::Database, draft_client::DraftClient,
    local_attachment_source::LocalAttachmentSourceRef,
};
use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadIntent {
    #[serde(default, skip_serializing_if = "UploadTarget::is_camp")]
    pub target: UploadTarget,
    pub command_id: String,
    #[serde(rename = "threadId", alias = "campId")]
    pub camp_id: String,
    pub expected_revision: i64,
    pub display_name: String,
    pub byte_size: u64,
    pub sha256: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum UploadTarget {
    #[default]
    Camp,
    PastedText,
    Chat,
    SingleChat {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    SingleChatPending {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "editToken")]
        edit_token: String,
    },
}
impl UploadTarget {
    pub fn is_pasted_text(&self) -> bool {
        matches!(self, Self::PastedText)
    }
    pub fn is_public(&self) -> bool {
        matches!(self, Self::Camp | Self::PastedText | Self::Chat)
    }
    fn is_camp(&self) -> bool {
        matches!(self, Self::Camp)
    }
}

pub fn snapshot(
    database: &Database,
    _data_dir: &std::path::Path,
    client: &DraftClient,
    intent: &UploadIntent,
) -> Result<serde_json::Value> {
    match &intent.target {
        UploadTarget::Camp | UploadTarget::PastedText | UploadTarget::Chat => {
            let recorded = reconcile(database, client, intent.clone())?
                .ok_or_else(|| anyhow::anyhow!("upload receipt is missing"))?;
            let mut source = recorded.result.payload["source"].clone();
            if intent.target.is_pasted_text() {
                source["generatedBy"] = json!("long_text_paste");
            }
            Ok(source)
        }
        UploadTarget::SingleChat { conversation_id }
        | UploadTarget::SingleChatPending {
            conversation_id, ..
        } => {
            let snapshot = crate::single_chat::SingleChatService::for_client(client.clone())
                .snapshot(database, conversation_id)?;
            ensure!(
                snapshot
                    .as_ref()
                    .is_some_and(|view| view.conversation.camp_id == intent.camp_id),
                "single_chat.camp_mismatch"
            );
            Ok(serde_json::to_value(snapshot)?)
        }
    }
}

#[derive(Serialize)]
pub struct BindUpload {
    client: DraftClient,
    intent: UploadIntent,
}
impl sealed::Sealed for BindUpload {}
impl DomainCommand for BindUpload {
    const TYPE: &'static str = "camp.source_attachment.upload.bind";
    fn draft_client(&self) -> Option<&DraftClient> {
        Some(&self.client)
    }
}

fn envelope(client: &DraftClient, intent: UploadIntent) -> Result<CommandEnvelope<BindUpload>> {
    ensure!(
        !client.is_desktop(),
        "upload requires a verified Web editor"
    );
    if matches!(intent.target, UploadTarget::Chat) {
        anyhow::ensure!(
            intent.camp_id.len() <= 540
                && (intent
                    .camp_id
                    .strip_prefix("chat:")
                    .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                    || intent.camp_id.starts_with("chat-draft:")),
            "chat.invalid_draft"
        );
    } else {
        crate::camp_id::ThreadId::parse(&intent.camp_id)?;
    }
    uuid::Uuid::parse_str(&intent.command_id)?;
    ensure!(
        intent.sha256.len() == 64 && intent.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "invalid upload digest"
    );
    Ok(CommandEnvelope {
        command_id: intent.command_id.clone(),
        actor: ActorRef::User {
            user_id: crate::current_user::CURRENT_USER_ID.into(),
        },
        camp_id: (!matches!(intent.target, UploadTarget::Chat)).then(|| intent.camp_id.clone()),
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: BindUpload {
            client: client.clone(),
            intent,
        },
    })
}

pub fn reconcile(
    database: &Database,
    client: &DraftClient,
    intent: UploadIntent,
) -> Result<Option<CommandExecution>> {
    DomainCommandGateway.replay_if_recorded(database, &envelope(client, intent)?)
}

fn chat_upload_source(
    db: &Database,
    client: &DraftClient,
    owner: &str,
    attachment_id: &str,
) -> Result<Option<LocalAttachmentSourceRef>> {
    let receipt:Option<(String,String)>=db.connection().query_row(
        "SELECT json_extract(result_payload_json,'$.chatComposer'),json_extract(result_payload_json,'$.source') FROM event_log
         WHERE event_type='command.result' AND command_type='camp.source_attachment.upload.bind' AND command_id=?1
           AND command_client_id=?2 AND actor_id=?3 AND result_code='attachment.upload_bound' AND result_status='applied'
           AND json_type(result_payload_json,'$.chatComposer')='text'",
        params![attachment_id,client.id(),crate::current_user::CURRENT_USER_ID],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    if let Some((origin, raw)) = receipt {
        // A second window may rotate a first-send draft while the user is editing it.
        let draft_agent = |key: &str| {
            key.strip_prefix("chat-draft:")
                .and_then(|s| s.rsplit_once(':'))
                .map(|(agent, _)| agent.to_owned())
        };
        if origin == owner
            || draft_agent(owner).is_some_and(|a| draft_agent(&origin).as_ref() == Some(&a))
        {
            return Ok(Some(serde_json::from_str(&raw)?));
        }
    }
    if let Some(chat) = owner.strip_prefix("chat:") {
        let restored:Option<String>=db.connection().query_row("SELECT a.value FROM single_chat_pending_input p JOIN chat_topic t ON t.conversation_id=p.conversation_id, json_each(p.source_attachments_json) a
            WHERE p.conversation_id=?1 AND t.owner_user_id=?2 AND t.deletion_operation_id IS NULL AND p.state='cancelled' AND json_extract(a.value,'$.id')=?3 LIMIT 1",
            params![chat,crate::current_user::CURRENT_USER_ID,attachment_id],|r|r.get(0)).optional()?;
        return restored
            .map(|raw| serde_json::from_str(&raw))
            .transpose()
            .map_err(Into::into);
    }
    Ok(None)
}

pub(crate) fn authorize_chat_source(
    db: &Database,
    client: &DraftClient,
    command: &crate::chat::SendInput,
    source: &LocalAttachmentSourceRef,
) -> Result<()> {
    let owner = command
        .chat_id
        .as_ref()
        .map(|id| format!("chat:{id}"))
        .or_else(|| {
            command
                .draft_id
                .as_ref()
                .map(|id| format!("chat-draft:{id}"))
        })
        .ok_or_else(|| anyhow::anyhow!("chat.invalid_target"))?;
    ensure!(
        chat_upload_source(db, client, &owner, &source.id)?.as_ref() == Some(source),
        "chat.attachment_not_prepared"
    );
    Ok(())
}

/// The upload receipt owns a Web Composer source after public drafts moved to
/// the client. A path supplied by the browser is never an authorization source.
pub fn load_composer_source(
    database: &Database,
    client: &DraftClient,
    camp_id: &str,
    attachment_id: &str,
) -> Result<Option<LocalAttachmentSourceRef>> {
    ensure!(
        !client.is_desktop(),
        "upload requires a verified Web editor"
    );
    uuid::Uuid::parse_str(attachment_id)?;
    if camp_id.starts_with("chat:") || camp_id.starts_with("chat-draft:") {
        return chat_upload_source(database, client, camp_id, attachment_id);
    }
    crate::camp_id::ThreadId::parse(camp_id)?;
    let source: Option<String> = database
        .connection()
        .query_row(
            r#"
        SELECT json_extract(receipt.result_payload_json, '$.source')
        FROM event_log AS receipt
        JOIN camp ON camp.id = receipt.camp_id AND camp.deletion_operation_id IS NULL
        WHERE receipt.event_type = 'command.result'
          AND receipt.command_id = ?1 AND receipt.camp_id = ?2
          AND receipt.command_type = 'camp.source_attachment.upload.bind'
          AND receipt.command_client_id = ?3
          AND receipt.actor_type = 'user' AND receipt.actor_id = ?4
          AND receipt.result_status = 'applied'
          AND receipt.result_code = 'attachment.upload_bound'
          AND json_type(receipt.result_payload_json, '$.source') = 'object'
        "#,
            params![
                attachment_id,
                camp_id,
                client.id(),
                crate::current_user::CURRENT_USER_ID
            ],
            |row| row.get(0),
        )
        .optional()?;
    source
        .map(|json| {
            let source: LocalAttachmentSourceRef = serde_json::from_str(&json)?;
            ensure!(source.id == attachment_id, "upload reference changed");
            Ok(source)
        })
        .transpose()
}

pub fn composer_source_view(source: &LocalAttachmentSourceRef) -> Result<serde_json::Value> {
    use crate::local_attachment_source::{
        LocalAttachmentAvailability, LocalAttachmentFailureCode, validate_source_attachment,
    };
    let availability = match validate_source_attachment(source) {
        Ok(()) => LocalAttachmentAvailability::Available,
        Err(error) => match error.code() {
            LocalAttachmentFailureCode::Missing => LocalAttachmentAvailability::Missing,
            LocalAttachmentFailureCode::Unreadable => LocalAttachmentAvailability::Unreadable,
            LocalAttachmentFailureCode::KindChanged => LocalAttachmentAvailability::KindChanged,
        },
    };
    let mut view = serde_json::to_value(source.view(availability))?;
    if availability == LocalAttachmentAvailability::Available {
        view["sourcePath"] = json!(source.source_path);
        view["byteSize"] = json!(std::fs::metadata(&source.source_path)?.len());
    }
    Ok(view)
}

pub fn bind(
    database: &mut Database,
    _data_dir: &std::path::Path,
    client: &DraftClient,
    intent: UploadIntent,
    source: LocalAttachmentSourceRef,
) -> Result<CommandExecution> {
    let envelope = envelope(client, intent)?;
    ensure!(
        source.id == envelope.payload.intent.command_id,
        "upload reference changed"
    );
    ensure!(
        source.display_name == envelope.payload.intent.display_name
            && source.observed_byte_size == Some(envelope.payload.intent.byte_size),
        "upload observation changed"
    );
    if envelope.payload.intent.target.is_pasted_text() {
        validate_pasted_path(
            database,
            &envelope.payload.intent.camp_id,
            &source.source_path,
        )?;
        ensure!(
            envelope.payload.intent.byte_size <= 25 * 1024 * 1024,
            "upload_too_large"
        );
    }
    DomainCommandGateway.execute(database, &envelope, |transaction| {
        let intent = &envelope.payload.intent;
        match &intent.target {
            UploadTarget::Camp | UploadTarget::PastedText => {
                ensure!(
                    transaction.query_row(
                        "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1 AND deletion_operation_id IS NULL)",
                        [&intent.camp_id],
                        |row| row.get::<_, bool>(0),
                    )?,
                    "camp.not_found"
                );
            }
            UploadTarget::Chat => {
                if let Some(chat)=intent.camp_id.strip_prefix("chat:") {
                    ensure!(transaction.query_row("SELECT EXISTS(SELECT 1 FROM chat_topic WHERE conversation_id=?1 AND owner_user_id=?2 AND archived_at IS NULL AND deletion_operation_id IS NULL)",params![chat,crate::current_user::CURRENT_USER_ID],|r|r.get::<_,bool>(0))?,"chat.unavailable");
                }
            }
            UploadTarget::SingleChat { conversation_id } => {
                ensure!(transaction.query_row("SELECT EXISTS(SELECT 1 FROM conversation WHERE id=?1 AND camp_id=?2 AND kind='single_chat' AND ended_at IS NULL)", rusqlite::params![conversation_id,intent.camp_id], |r| r.get::<_, bool>(0))?, "single_chat.camp_mismatch");
                crate::single_chat::SingleChatService::for_client(client.clone()).commit_source_attachment_in_transaction(transaction, conversation_id, intent.expected_revision, source.clone())?;
            }
            UploadTarget::SingleChatPending { conversation_id, pending_input_id, edit_token } => crate::single_chat::SingleChatService::for_client(client.clone()).commit_pending_source_attachment_in_transaction(transaction, &intent.camp_id, conversation_id, pending_input_id, intent.expected_revision, edit_token, source.clone())?,
        }
        if intent.target.is_pasted_text() {
            transaction.execute("INSERT INTO web_pasted_text_attachment(attachment_id,camp_id,client_id,source_path) VALUES(?1,?2,?3,?4)", params![source.id,intent.camp_id,client.id(),source.source_path])?;
        }
        let payload = if intent.target.is_public() {
            if matches!(intent.target,UploadTarget::Chat) {json!({"attachmentRefId":intent.command_id,"chatComposer":intent.camp_id,"source":source})} else {json!({"attachmentRefId":intent.command_id, "source":source})}
        } else {
            json!({"attachmentRefId":intent.command_id, "draftId":client.draft_id(&intent.camp_id), "revision":intent.expected_revision+1})
        };
        Ok(CommandHandlerResult::applied("attachment.upload_bound", payload, None))
    })
}

/// Destination is resolved by Core, never supplied as a browser path. This read
/// deliberately does not recreate an output directory after Thread deletion.
pub fn pasted_text_root(
    database: &Database,
    client: &DraftClient,
    intent: &UploadIntent,
) -> Result<String> {
    envelope(client, intent.clone())?;
    ensure!(
        intent.target.is_pasted_text() && intent.byte_size <= 25 * 1024 * 1024,
        "invalid pasted text upload"
    );
    ensure!(
        database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM camp WHERE id=?1 AND deletion_operation_id IS NULL)",
            [&intent.camp_id],
            |r| r.get::<_, bool>(0)
        )?,
        "Thread no longer exists"
    );
    crate::storage_layout::resolve_attachment_output_root(database.connection(), &intent.camp_id)
}

fn validate_pasted_path(database: &Database, camp_id: &str, path: &str) -> Result<()> {
    let root =
        crate::storage_layout::resolve_attachment_output_root(database.connection(), camp_id)?;
    validate_pasted_path_in_root(&root, path)
}

fn validate_pasted_path_in_root(root: &str, path: &str) -> Result<()> {
    let path = std::path::Path::new(path);
    ensure!(
        path.parent() == Some(std::path::Path::new(&root))
            && path.extension().is_some_and(|s| s == "txt")
            && path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok()),
        "invalid generated source path"
    );
    crate::camp_attachment_view::reject_existing_symlink_components(std::path::Path::new(&root))?;
    Ok(())
}

pub fn is_pasted_text(
    database: &Database,
    client: &DraftClient,
    camp_id: &str,
    id: &str,
) -> Result<bool> {
    Ok(database.connection().query_row("SELECT EXISTS(SELECT 1 FROM web_pasted_text_attachment WHERE camp_id=?1 AND attachment_id=?2 AND client_id=?3)",params![camp_id,id,client.id()],|r|r.get(0))?)
}

/// The application holds its pasted-text operation guard before the database
/// lock, through this durable write and publication. Removal shares that guard,
/// but releases the database lock during unlink. Failed publication never resets
/// protection and there is no per-send association.
pub fn protect_for_send(
    database: &mut Database,
    sources: &[LocalAttachmentSourceRef],
) -> Result<()> {
    if sources.is_empty() {
        return Ok(());
    }
    let tx = database.connection_mut().transaction()?;
    for source in sources {
        tx.execute("UPDATE web_pasted_text_attachment SET entered_send_flow=1 WHERE source_path=?1 AND entered_send_flow=0",[&source.source_path])?;
    }
    tx.commit()?;
    Ok(())
}

/// Only the originating verified editor can remove its generated draft file.
/// No row means no deletion authority, even if an old upload receipt remains.
/// The caller must hold the same pasted-text operation guard used by publication.
pub async fn remove_pasted_text(
    database: &tokio::sync::Mutex<Database>,
    client: &DraftClient,
    camp_id: &str,
    id: &str,
) -> Result<&'static str> {
    ensure!(!client.is_desktop(), "verified Web editor required");
    crate::camp_id::ThreadId::parse(camp_id)?;
    uuid::Uuid::parse_str(id)?;
    let (entry, root) = {
        let database = database.lock().await;
        let entry: Option<(String, bool)> = database.connection().query_row("SELECT source_path,entered_send_flow FROM web_pasted_text_attachment WHERE camp_id=?1 AND attachment_id=?2 AND client_id=?3",params![camp_id,id,client.id()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let root =
            crate::storage_layout::resolve_attachment_output_root(database.connection(), camp_id)?;
        (entry, root)
    };
    let Some((path, protected)) = entry else {
        return Ok("retained");
    };
    if !protected {
        validate_pasted_path_in_root(&root, &path)?;
        #[cfg(test)]
        crate::application::wait_for_pasted_text_unlink_test_barrier(id).await;
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    database.lock().await.connection().execute(
        "DELETE FROM web_pasted_text_attachment WHERE attachment_id=?1 AND client_id=?2",
        params![id, client.id()],
    )?;
    Ok(if protected { "retained" } else { "deleted" })
}

pub fn discard_pasted_text(
    database: &Database,
    client: &DraftClient,
    camp_id: &str,
    ids: &[String],
) -> Result<()> {
    ensure!(
        !client.is_desktop() && ids.len() <= 10,
        "invalid generated registration release"
    );
    for id in ids {
        // A generic discard cannot discard an unprotected file's cleanup authority.
        database.connection().execute("DELETE FROM web_pasted_text_attachment WHERE camp_id=?1 AND attachment_id=?2 AND client_id=?3 AND entered_send_flow=1",params![camp_id,id,client.id()])?;
    }
    Ok(())
}
