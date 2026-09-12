use std::{error::Error, fmt, fs, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::Database,
    local_attachment_snapshot::{DIRECTORY_MEDIA_TYPE, normalize_display_name},
};

pub const EMPTY_SOURCE_ATTACHMENTS_JSON: &str = "[]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAttachmentKind {
    File,
    Directory,
}

impl LocalAttachmentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAttachmentSourceRef {
    pub id: String,
    pub source_path: String,
    pub display_name: String,
    pub kind: LocalAttachmentKind,
    pub media_type: Option<String>,
    pub observed_byte_size: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAttachmentAvailability {
    Unknown,
    Available,
    Missing,
    Unreadable,
    KindChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAttachmentSourceView {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub media_type: Option<String>,
    pub byte_size: Option<u64>,
    pub file_count: Option<u64>,
    pub preview_kind: String,
    pub availability: LocalAttachmentAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAttachmentHistoryView {
    pub attachment_id: String,
    pub name: String,
    pub kind: String,
    pub file_count: u64,
    pub media_type: String,
    pub byte_size: u64,
}

impl LocalAttachmentSourceRef {
    pub fn view(&self, availability: LocalAttachmentAvailability) -> LocalAttachmentSourceView {
        LocalAttachmentSourceView {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            kind: self.kind.as_str().to_string(),
            media_type: self.media_type.clone(),
            byte_size: self.observed_byte_size,
            file_count: (self.kind == LocalAttachmentKind::File).then_some(1),
            preview_kind: if self
                .media_type
                .as_deref()
                .is_some_and(|media_type| media_type.starts_with("image/"))
            {
                "image"
            } else {
                "none"
            }
            .to_string(),
            availability,
        }
    }

    pub fn history_view(&self) -> LocalAttachmentHistoryView {
        let is_file = self.kind == LocalAttachmentKind::File;
        LocalAttachmentHistoryView {
            attachment_id: self.id.clone(),
            name: self.display_name.clone(),
            kind: self.kind.as_str().to_string(),
            file_count: u64::from(is_file),
            media_type: self.media_type.clone().unwrap_or_else(|| {
                if is_file {
                    "application/octet-stream".to_string()
                } else {
                    DIRECTORY_MEDIA_TYPE.to_string()
                }
            }),
            byte_size: self.observed_byte_size.unwrap_or(0),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "owner", rename_all = "snake_case", deny_unknown_fields)]
pub enum LocalAttachmentOwnerLocator {
    Composer {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    Pending {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    PendingEdit {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "editToken")]
        edit_token: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    Message {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    SingleChatComposer {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    SingleChatPending {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    SingleChatPendingEdit {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "editToken")]
        edit_token: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    SingleChatMessage {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "conversationMessageId")]
        conversation_message_id: String,
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
}

impl LocalAttachmentOwnerLocator {
    pub fn camp_id(&self) -> &str {
        match self {
            Self::Composer { camp_id, .. }
            | Self::Pending { camp_id, .. }
            | Self::PendingEdit { camp_id, .. }
            | Self::Message { camp_id, .. }
            | Self::SingleChatComposer { camp_id, .. }
            | Self::SingleChatPending { camp_id, .. }
            | Self::SingleChatPendingEdit { camp_id, .. }
            | Self::SingleChatMessage { camp_id, .. } => camp_id,
        }
    }

    pub fn attachment_ref_id(&self) -> &str {
        match self {
            Self::Composer {
                attachment_ref_id, ..
            }
            | Self::Pending {
                attachment_ref_id, ..
            }
            | Self::PendingEdit {
                attachment_ref_id, ..
            }
            | Self::Message {
                attachment_ref_id, ..
            }
            | Self::SingleChatComposer {
                attachment_ref_id, ..
            }
            | Self::SingleChatPending {
                attachment_ref_id, ..
            }
            | Self::SingleChatPendingEdit {
                attachment_ref_id, ..
            }
            | Self::SingleChatMessage {
                attachment_ref_id, ..
            } => attachment_ref_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalAttachmentFailureCode {
    Missing,
    Unreadable,
    KindChanged,
}

impl LocalAttachmentFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "attachment_missing",
            Self::Unreadable => "attachment_unreadable",
            Self::KindChanged => "attachment_kind_changed",
        }
    }
}

#[derive(Debug)]
pub struct LocalAttachmentFailure {
    code: LocalAttachmentFailureCode,
    attachment_id: String,
    source: Option<std::io::Error>,
}

impl LocalAttachmentFailure {
    pub fn code(&self) -> LocalAttachmentFailureCode {
        self.code
    }

    fn io(attachment_id: &str, error: std::io::Error) -> Self {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            LocalAttachmentFailureCode::Missing
        } else {
            LocalAttachmentFailureCode::Unreadable
        };
        Self {
            code,
            attachment_id: attachment_id.to_string(),
            source: Some(error),
        }
    }

    fn kind_changed(attachment_id: &str) -> Self {
        Self {
            code: LocalAttachmentFailureCode::KindChanged,
            attachment_id: attachment_id.to_string(),
            source: None,
        }
    }
}

impl fmt::Display for LocalAttachmentFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: source attachment {} is unavailable",
            self.code.as_str(),
            self.attachment_id
        )
    }
}

impl Error for LocalAttachmentFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn Error + 'static))
    }
}

pub fn parse_source_attachments(value: &str) -> Result<Vec<LocalAttachmentSourceRef>> {
    let refs: Vec<LocalAttachmentSourceRef> =
        serde_json::from_str(value).context("Source Attachment JSON is invalid")?;
    validate_ref_shape(&refs)?;
    Ok(refs)
}

pub fn serialize_source_attachments(refs: &[LocalAttachmentSourceRef]) -> Result<String> {
    validate_ref_shape(refs)?;
    serde_json::to_string(refs).context("Source Attachments could not be serialized")
}

fn validate_ref_shape(refs: &[LocalAttachmentSourceRef]) -> Result<()> {
    let mut ids = std::collections::HashSet::new();
    for source_ref in refs {
        let canonical_id = Uuid::parse_str(&source_ref.id)
            .context("Source Attachment ID is invalid")?
            .hyphenated()
            .to_string();
        anyhow::ensure!(
            canonical_id == source_ref.id,
            "Source Attachment ID is not canonical"
        );
        anyhow::ensure!(
            ids.insert(&source_ref.id),
            "Source Attachment ID is duplicated"
        );
        anyhow::ensure!(
            Path::new(&source_ref.source_path).is_absolute(),
            "Source Attachment path must be absolute"
        );
        anyhow::ensure!(
            normalize_display_name(&source_ref.display_name)? == source_ref.display_name,
            "Source Attachment display name is not normalized"
        );
        if source_ref.kind == LocalAttachmentKind::Directory {
            anyhow::ensure!(
                source_ref.observed_byte_size.is_none(),
                "Directory Source Attachment must not claim a byte size"
            );
        }
    }
    Ok(())
}

pub fn observe_source_attachment(
    source_path: &Path,
    display_name: &str,
    media_type: Option<&str>,
) -> Result<LocalAttachmentSourceRef> {
    anyhow::ensure!(
        source_path.is_absolute(),
        "Source Attachment path must be absolute"
    );
    let metadata = fs::metadata(source_path).context("attachment_unreadable")?;
    let kind = if metadata.is_file() {
        fs::File::open(source_path).context("attachment_unreadable")?;
        LocalAttachmentKind::File
    } else if metadata.is_dir() {
        fs::read_dir(source_path).context("attachment_unreadable")?;
        LocalAttachmentKind::Directory
    } else {
        anyhow::bail!("attachment_kind_changed");
    };
    let media_type = media_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(LocalAttachmentSourceRef {
        id: Uuid::new_v4().to_string(),
        source_path: source_path
            .to_str()
            .context("Source Attachment path must be valid UTF-8")?
            .to_string(),
        display_name: normalize_display_name(display_name)?,
        kind,
        media_type: (kind == LocalAttachmentKind::File)
            .then_some(media_type)
            .flatten(),
        observed_byte_size: (kind == LocalAttachmentKind::File).then_some(metadata.len()),
    })
}

pub fn validate_source_attachments(
    refs: &[LocalAttachmentSourceRef],
) -> std::result::Result<(), LocalAttachmentFailure> {
    for source_ref in refs {
        validate_source_attachment(source_ref)?;
    }
    Ok(())
}

pub fn validate_source_attachment(
    source_ref: &LocalAttachmentSourceRef,
) -> std::result::Result<(), LocalAttachmentFailure> {
    let path = Path::new(&source_ref.source_path);
    let metadata =
        fs::metadata(path).map_err(|error| LocalAttachmentFailure::io(&source_ref.id, error))?;
    let actual_kind = if metadata.is_file() {
        fs::File::open(path).map_err(|error| LocalAttachmentFailure::io(&source_ref.id, error))?;
        LocalAttachmentKind::File
    } else if metadata.is_dir() {
        fs::read_dir(path).map_err(|error| LocalAttachmentFailure::io(&source_ref.id, error))?;
        LocalAttachmentKind::Directory
    } else {
        return Err(LocalAttachmentFailure::kind_changed(&source_ref.id));
    };
    if actual_kind != source_ref.kind {
        return Err(LocalAttachmentFailure::kind_changed(&source_ref.id));
    }
    Ok(())
}

pub fn load_source_attachment(
    database: &Database,
    locator: &LocalAttachmentOwnerLocator,
) -> Result<Option<LocalAttachmentSourceRef>> {
    load_source_attachment_for_client(
        database,
        locator,
        &crate::draft_client::DraftClient::default(),
    )
}

pub fn load_source_attachment_for_client(
    database: &Database,
    locator: &LocalAttachmentOwnerLocator,
    client: &crate::draft_client::DraftClient,
) -> Result<Option<LocalAttachmentSourceRef>> {
    let connection = database.connection();
    if !client.is_desktop()
        && matches!(
            locator,
            LocalAttachmentOwnerLocator::SingleChatComposer { .. }
                | LocalAttachmentOwnerLocator::SingleChatPendingEdit { .. }
        )
    {
        anyhow::bail!("Private Draft client scope is not admitted yet");
    }
    let json = match locator {
        LocalAttachmentOwnerLocator::Composer { camp_id, .. } => connection
            .query_row(
                "SELECT source_attachments_json FROM camp_composer_draft WHERE camp_id = ?1 AND client_id = ?2",
                params![camp_id, client.id()],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::Pending {
            camp_id,
            pending_input_id,
            ..
        } => connection
            .query_row(
                "SELECT source_attachments_json FROM pending_camp_input WHERE camp_id = ?1 AND id = ?2",
                params![camp_id, pending_input_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::PendingEdit {
            camp_id,
            pending_input_id,
            edit_token,
            ..
        } => connection
            .query_row(
                "SELECT working_source_attachments_json FROM pending_input_edit_session WHERE camp_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3 AND client_id = ?4",
                params![camp_id, pending_input_id, edit_token, client.id()],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::Message {
            camp_id,
            message_id,
            ..
        } => connection
            .query_row(
                "SELECT source_attachments_json FROM camp_message WHERE camp_id = ?1 AND id = ?2",
                params![camp_id, message_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::SingleChatComposer {
            camp_id,
            conversation_id,
            ..
        } => connection
            .query_row(
                r#"
                SELECT draft.source_attachments_json
                FROM single_chat_composer_draft AS draft
                JOIN conversation ON conversation.id = draft.conversation_id
                WHERE conversation.camp_id = ?1
                  AND conversation.id = ?2
                  AND conversation.kind = 'single_chat'
                "#,
                params![camp_id, conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::SingleChatPending {
            camp_id,
            conversation_id,
            pending_input_id,
            ..
        } => connection
            .query_row(
                r#"
                SELECT input.source_attachments_json
                FROM single_chat_pending_input AS input
                JOIN conversation ON conversation.id = input.conversation_id
                WHERE conversation.camp_id = ?1
                  AND conversation.id = ?2
                  AND conversation.kind = 'single_chat'
                  AND input.conversation_id = conversation.id
                  AND input.id = ?3
                "#,
                params![camp_id, conversation_id, pending_input_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::SingleChatPendingEdit {
            camp_id,
            conversation_id,
            pending_input_id,
            edit_token,
            ..
        } => connection
            .query_row(
                r#"
                SELECT edit.working_source_attachments_json
                FROM single_chat_pending_input_edit_session AS edit
                JOIN conversation ON conversation.id = edit.conversation_id
                WHERE conversation.camp_id = ?1
                  AND conversation.id = ?2
                  AND conversation.kind = 'single_chat'
                  AND edit.conversation_id = conversation.id
                  AND edit.pending_input_id = ?3
                  AND edit.edit_token = ?4
                "#,
                params![camp_id, conversation_id, pending_input_id, edit_token],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        LocalAttachmentOwnerLocator::SingleChatMessage {
            camp_id,
            conversation_id,
            conversation_message_id,
            ..
        } => connection
            .query_row(
                r#"
                SELECT message.source_attachments_json
                FROM conversation_message AS message
                JOIN conversation ON conversation.id = message.conversation_id
                WHERE conversation.camp_id = ?1
                  AND conversation.id = ?2
                  AND conversation.kind = 'single_chat'
                  AND message.conversation_id = conversation.id
                  AND message.id = ?3
                  AND message.author_type = 'user'
                "#,
                params![camp_id, conversation_id, conversation_message_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };
    let Some(json) = json else {
        return Ok(None);
    };
    Ok(parse_source_attachments(&json)?
        .into_iter()
        .find(|candidate| candidate.id == locator.attachment_ref_id()))
}

pub fn load_agent_run_source_attachments(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Vec<LocalAttachmentSourceRef>> {
    let invocation_kind = database
        .connection()
        .query_row(
            "SELECT invocation_kind FROM agent_run WHERE id = ?1 AND execution_epoch = ?2",
            params![agent_run_id, execution_epoch],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if invocation_kind.as_deref() == Some("single_chat") {
        let json = database
            .connection()
            .query_row(
                r#"
                SELECT message.source_attachments_json
                FROM agent_run AS run
                JOIN conversation_message AS message
                  ON message.id = run.trigger_conversation_message_id
                JOIN conversation ON conversation.id = message.conversation_id
                WHERE run.id = ?1
                  AND run.execution_epoch = ?2
                  AND run.invocation_kind = 'single_chat'
                  AND run.trigger_conversation_message_id = message.id
                  AND run.conversation_id = message.conversation_id
                  AND run.destination_conversation_id = message.conversation_id
                  AND conversation.id = message.conversation_id
                  AND conversation.kind = 'single_chat'
                  AND message.author_type = 'user'
                "#,
                params![agent_run_id, execution_epoch],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        return json
            .map(|value| parse_source_attachments(&value))
            .transpose()
            .map(Option::unwrap_or_default);
    }
    let json = database
        .connection()
        .query_row(
            r#"
            SELECT message.source_attachments_json
            FROM agent_run AS run
            JOIN camp_message AS message ON message.id = run.trigger_camp_message_id
            WHERE run.id = ?1 AND run.execution_epoch = ?2
            "#,
            params![agent_run_id, execution_epoch],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    json.map(|value| parse_source_attachments(&value))
        .transpose()
        .map(Option::unwrap_or_default)
}

pub fn resolve_source_attachments_for_run(
    source_refs: &[LocalAttachmentSourceRef],
) -> Result<Vec<String>> {
    let mut resolved = Vec::with_capacity(source_refs.len());
    for source_ref in source_refs {
        validate_source_attachment(source_ref).map_err(anyhow::Error::new)?;
        resolved.push(source_ref.source_path.clone());
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ref_json_is_closed_and_pathless_view_is_stable() {
        let source_ref = LocalAttachmentSourceRef {
            id: Uuid::new_v4().to_string(),
            source_path: "/tmp/example.txt".to_string(),
            display_name: "example.txt".to_string(),
            kind: LocalAttachmentKind::File,
            media_type: Some("text/plain".to_string()),
            observed_byte_size: Some(7),
        };
        let json = serialize_source_attachments(std::slice::from_ref(&source_ref)).unwrap();
        assert_eq!(
            parse_source_attachments(&json).unwrap(),
            std::slice::from_ref(&source_ref)
        );
        let view =
            serde_json::to_value(source_ref.view(LocalAttachmentAvailability::Unknown)).unwrap();
        assert!(view.get("sourcePath").is_none());
        assert_eq!(view["availability"], "unknown");

        let mut malformed = serde_json::to_value([source_ref]).unwrap();
        malformed[0]["unexpected"] = serde_json::json!(true);
        assert!(parse_source_attachments(&malformed.to_string()).is_err());
    }

    #[test]
    fn resolver_returns_exact_stored_paths_for_files_and_directories() {
        let root = std::env::temp_dir().join(format!("rovai-source-resolver-{}", Uuid::new_v4()));
        let directory = root.join("directory");
        fs::create_dir_all(&directory).unwrap();
        let file = root.join("file.txt");
        fs::write(&file, b"content").unwrap();
        let refs = [
            observe_source_attachment(&file, "file.txt", Some("text/plain")).unwrap(),
            observe_source_attachment(&directory, "directory", None).unwrap(),
        ];

        let resolved = resolve_source_attachments_for_run(&refs).unwrap();
        assert_eq!(
            resolved,
            refs.iter()
                .map(|source_ref| source_ref.source_path.clone())
                .collect::<Vec<_>>()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn resolver_preserves_a_top_level_symlink_path_after_following_its_kind() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("rovai-source-symlink-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.txt");
        fs::write(&target, b"target").unwrap();
        let link = root.join("link.txt");
        symlink(&target, &link).unwrap();
        let source_ref = observe_source_attachment(&link, "link.txt", None).unwrap();

        let resolved = resolve_source_attachments_for_run(&[source_ref]).unwrap();
        assert_eq!(resolved, [link.to_string_lossy().into_owned()]);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn resolver_does_not_scan_links_or_special_nodes_inside_directories() {
        use std::os::unix::{fs::symlink, net::UnixListener};

        // Unix-domain socket paths are very short on some platforms, so keep this fixture under
        // the canonical short temporary root rather than the per-user macOS temporary directory.
        let root = std::path::PathBuf::from("/tmp").join(format!("rvs-{}", Uuid::new_v4()));
        let directory = root.join("directory");
        fs::create_dir_all(&directory).unwrap();
        symlink(
            directory.join("missing.txt"),
            directory.join("dangling-link.txt"),
        )
        .unwrap();
        let socket_path = directory.join("socket");
        let socket = UnixListener::bind(&socket_path).unwrap();
        let source_ref = observe_source_attachment(&directory, "directory", None).unwrap();

        let resolved = resolve_source_attachments_for_run(&[source_ref]).unwrap();
        assert_eq!(resolved, [directory.to_string_lossy().into_owned()]);
        drop(socket);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolver_rechecks_missing_and_kind_changed_without_hashing_content() {
        let root =
            std::env::temp_dir().join(format!("rovai-source-validation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("mutable.txt");
        fs::write(&path, b"before").unwrap();
        let source_ref =
            observe_source_attachment(&path, "mutable.txt", Some("text/plain")).unwrap();

        fs::write(&path, b"after with different bytes").unwrap();
        resolve_source_attachments_for_run(std::slice::from_ref(&source_ref)).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            resolve_source_attachments_for_run(std::slice::from_ref(&source_ref))
                .unwrap_err()
                .downcast_ref::<LocalAttachmentFailure>()
                .unwrap()
                .code(),
            LocalAttachmentFailureCode::Missing
        );
        fs::create_dir(&path).unwrap();
        assert_eq!(
            resolve_source_attachments_for_run(std::slice::from_ref(&source_ref))
                .unwrap_err()
                .downcast_ref::<LocalAttachmentFailure>()
                .unwrap()
                .code(),
            LocalAttachmentFailureCode::KindChanged
        );
        fs::remove_dir_all(root).unwrap();
    }
}
