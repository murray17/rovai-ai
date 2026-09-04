use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use uuid::Uuid;

use crate::{
    camp_attachment::PreparedAttachmentView,
    db::Database,
    local_attachment_snapshot::{
        DIRECTORY_MEDIA_TYPE, LocalAttachmentSnapshot, MAX_DRAFT_ATTACHMENT_BYTES,
        MAX_PREPARED_ATTACHMENTS, MAX_PREVIEW_BYTES, allow_directory_update, copy_and_inspect,
        ensure_directory, inspect_runtime_attachment_copy, normalize_display_name,
        remove_attachment_directory, set_directory_read_only, snapshot_local_attachment,
    },
};

const SINGLE_CHAT_ATTACHMENT_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Clone)]
pub struct SingleChatAttachmentStore {
    root: PathBuf,
}

#[derive(Debug)]
pub struct SingleChatAttachmentPreparePlan {
    camp_id: String,
    conversation_id: String,
    expected_conversation_version: i64,
    source_path: PathBuf,
    display_name: String,
    attachment_id: String,
}

#[derive(Debug)]
pub struct PreparedSingleChatAttachment {
    camp_id: String,
    conversation_id: String,
    expected_conversation_version: i64,
    attachment_id: String,
    attachment_directory: PathBuf,
    snapshot: LocalAttachmentSnapshot,
}

#[derive(Debug)]
pub struct SingleChatAttachmentCleanupPlan {
    paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SingleChatAttachmentPreviewSource {
    pub path: PathBuf,
    pub media_type: String,
    pub byte_size: u64,
}

#[derive(Debug)]
pub struct SingleChatAttachmentPreviewCandidate {
    camp_id: String,
    conversation_id: String,
    attachment_id: String,
    display_name: String,
    kind: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    preview_kind: String,
    path: PathBuf,
}

#[derive(Debug)]
struct StoredSingleChatAttachment {
    camp_id: String,
    conversation_id: String,
    attachment_id: String,
    display_name: String,
    kind: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    path: PathBuf,
}

#[derive(Debug)]
pub struct SingleChatRuntimeAttachmentProjectionPlan {
    attachments: Vec<StoredSingleChatAttachment>,
}

impl SingleChatAttachmentStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("single-chat-attachments"),
        }
    }

    pub fn plan_prepare_from_path(
        &self,
        database: &Database,
        conversation_id: &str,
        expected_conversation_version: i64,
        source_path: &Path,
        requested_display_name: &str,
    ) -> Result<SingleChatAttachmentPreparePlan> {
        let camp_id = require_active_conversation(
            database.connection(),
            conversation_id,
            expected_conversation_version,
        )?;
        validate_capacity(database.connection(), conversation_id, 0)?;
        Ok(SingleChatAttachmentPreparePlan {
            camp_id,
            conversation_id: conversation_id.to_string(),
            expected_conversation_version,
            source_path: source_path.to_path_buf(),
            display_name: normalize_display_name(requested_display_name)?,
            attachment_id: Uuid::new_v4().to_string(),
        })
    }

    pub fn prepare_from_path_filesystem(
        &self,
        plan: SingleChatAttachmentPreparePlan,
    ) -> Result<PreparedSingleChatAttachment> {
        let conversation_root = self.conversation_root(&plan.camp_id, &plan.conversation_id)?;
        ensure_directory(&conversation_root)?;
        allow_directory_update(&conversation_root)?;
        let attachment_directory = conversation_root.join(&plan.attachment_id);
        let prepared = (|| {
            ensure_directory(&attachment_directory)?;
            let snapshot = snapshot_local_attachment(&plan.source_path, &attachment_directory)?;
            if snapshot.display_name != plan.display_name {
                let requested = attachment_directory.join(&plan.display_name);
                fs::rename(&snapshot.path, &requested)?;
                let mut snapshot = snapshot;
                snapshot.path = requested;
                snapshot.display_name = plan.display_name.clone();
                set_directory_read_only(&attachment_directory)?;
                return Ok(snapshot);
            }
            set_directory_read_only(&attachment_directory)?;
            Ok(snapshot)
        })();
        restrict_directory_discovery(&conversation_root)?;
        let snapshot = match prepared {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let _ = allow_directory_update(&conversation_root);
                let _ = remove_attachment_directory(&attachment_directory);
                let _ = restrict_directory_discovery(&conversation_root);
                return Err(error);
            }
        };
        Ok(PreparedSingleChatAttachment {
            camp_id: plan.camp_id,
            conversation_id: plan.conversation_id,
            expected_conversation_version: plan.expected_conversation_version,
            attachment_id: plan.attachment_id,
            attachment_directory,
            snapshot,
        })
    }

    pub fn commit_prepared_attachment(
        &self,
        database: &mut Database,
        prepared: &PreparedSingleChatAttachment,
    ) -> Result<()> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let camp_id = require_active_conversation(
            &transaction,
            &prepared.conversation_id,
            prepared.expected_conversation_version,
        )?;
        if camp_id != prepared.camp_id {
            anyhow::bail!("Single Chat attachment Camp changed before commit");
        }
        validate_capacity(
            &transaction,
            &prepared.conversation_id,
            prepared.snapshot.byte_size,
        )?;
        let ordinal: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1
             FROM single_chat_prepared_attachment WHERE conversation_id = ?1",
            [&prepared.conversation_id],
            |row| row.get(0),
        )?;
        let now = Utc::now();
        transaction.execute(
            r#"
            INSERT INTO single_chat_prepared_attachment(
                id, camp_id, conversation_id, ordinal,
                display_name, kind, file_count, media_type, byte_size,
                content_digest, storage_path, preview_kind,
                created_at, updated_at, expires_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)
            "#,
            params![
                prepared.attachment_id,
                prepared.camp_id,
                prepared.conversation_id,
                ordinal,
                prepared.snapshot.display_name,
                prepared.snapshot.kind,
                prepared.snapshot.file_count as i64,
                prepared.snapshot.media_type,
                prepared.snapshot.byte_size as i64,
                prepared.snapshot.content_digest,
                prepared.snapshot.path.to_string_lossy(),
                prepared.snapshot.preview_kind,
                now.to_rfc3339(),
                (now + Duration::days(SINGLE_CHAT_ATTACHMENT_RETENTION_DAYS)).to_rfc3339(),
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn cleanup_uncommitted(&self, prepared: PreparedSingleChatAttachment) {
        let Ok(conversation_root) =
            self.conversation_root(&prepared.camp_id, &prepared.conversation_id)
        else {
            return;
        };
        let _ = allow_directory_update(&conversation_root);
        let _ = remove_attachment_directory(&prepared.attachment_directory);
        let _ = restrict_directory_discovery(&conversation_root);
    }

    pub fn load_prepared(
        &self,
        database: &Database,
        conversation_id: &str,
    ) -> Result<Vec<PreparedAttachmentView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, display_name, kind, file_count, media_type,
                   byte_size, preview_kind, created_at
            FROM single_chat_prepared_attachment
            WHERE conversation_id = ?1
            ORDER BY ordinal, id
            "#,
        )?;
        Ok(statement
            .query_map([conversation_id], |row| {
                Ok(PreparedAttachmentView {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    kind: row.get(2)?,
                    file_count: row.get::<_, i64>(3)?.max(0) as u64,
                    media_type: row.get(4)?,
                    byte_size: row.get::<_, i64>(5)?.max(0) as u64,
                    preview_kind: row.get(6)?,
                    state: "ready".to_string(),
                    error_message: None,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn remove_prepared_from_database(
        &self,
        database: &mut Database,
        conversation_id: &str,
        expected_conversation_version: i64,
        attachment_id: &str,
    ) -> Result<SingleChatAttachmentCleanupPlan> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_active_conversation(&transaction, conversation_id, expected_conversation_version)?;
        let path = transaction
            .query_row(
                "SELECT storage_path FROM single_chat_prepared_attachment
                 WHERE id = ?1 AND conversation_id = ?2",
                params![attachment_id, conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .context("Single Chat prepared attachment does not exist")?;
        transaction.execute(
            "DELETE FROM single_chat_prepared_attachment
             WHERE id = ?1 AND conversation_id = ?2",
            params![attachment_id, conversation_id],
        )?;
        normalize_ordinals(&transaction, conversation_id)?;
        transaction.commit()?;
        Ok(SingleChatAttachmentCleanupPlan {
            paths: vec![PathBuf::from(path)],
        })
    }

    pub fn cleanup_detached(&self, cleanup: SingleChatAttachmentCleanupPlan) -> Result<()> {
        for path in cleanup.paths {
            self.cleanup_storage_path(&path)?;
        }
        Ok(())
    }

    pub fn prepared_cleanup_plan(
        &self,
        database: &Database,
        conversation_id: &str,
    ) -> Result<SingleChatAttachmentCleanupPlan> {
        let mut statement = database.connection().prepare(
            "SELECT storage_path FROM single_chat_prepared_attachment WHERE conversation_id = ?1",
        )?;
        Ok(SingleChatAttachmentCleanupPlan {
            paths: statement
                .query_map([conversation_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .map(PathBuf::from)
                .collect(),
        })
    }

    pub fn preview_candidate(
        &self,
        database: &Database,
        attachment_id: &str,
    ) -> Result<Option<SingleChatAttachmentPreviewCandidate>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT camp_id, conversation_id, id, display_name, kind,
                       media_type, byte_size, content_digest, preview_kind, storage_path
                FROM single_chat_prepared_attachment WHERE id = ?1
                UNION ALL
                SELECT camp_id, conversation_id, id, display_name, kind,
                       media_type, byte_size, content_digest, preview_kind, storage_path
                FROM single_chat_message_attachment WHERE id = ?1
                LIMIT 1
                "#,
                [attachment_id],
                |row| {
                    Ok(SingleChatAttachmentPreviewCandidate {
                        camp_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        attachment_id: row.get(2)?,
                        display_name: row.get(3)?,
                        kind: row.get(4)?,
                        media_type: row.get(5)?,
                        byte_size: row.get::<_, i64>(6)?.max(0) as u64,
                        content_digest: row.get(7)?,
                        preview_kind: row.get(8)?,
                        path: PathBuf::from(row.get::<_, String>(9)?),
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn verify_preview_candidate(
        &self,
        candidate: SingleChatAttachmentPreviewCandidate,
    ) -> Result<Option<SingleChatAttachmentPreviewSource>> {
        if candidate.preview_kind != "image"
            || candidate.kind != "file"
            || candidate.byte_size > MAX_PREVIEW_BYTES
        {
            return Ok(None);
        }
        self.verify_stored_attachment(&StoredSingleChatAttachment {
            camp_id: candidate.camp_id,
            conversation_id: candidate.conversation_id,
            attachment_id: candidate.attachment_id,
            display_name: candidate.display_name,
            kind: candidate.kind,
            media_type: candidate.media_type.clone(),
            byte_size: candidate.byte_size,
            content_digest: candidate.content_digest,
            path: candidate.path.clone(),
        })?;
        Ok(Some(SingleChatAttachmentPreviewSource {
            path: candidate.path,
            media_type: candidate.media_type,
            byte_size: candidate.byte_size,
        }))
    }

    pub fn plan_runtime_projection(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<SingleChatRuntimeAttachmentProjectionPlan> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT attachment.camp_id, attachment.conversation_id, attachment.id,
                   attachment.display_name, attachment.kind, attachment.media_type,
                   attachment.byte_size, attachment.content_digest, attachment.storage_path
            FROM agent_run
            JOIN single_chat_message_attachment AS attachment
              ON attachment.conversation_message_id = agent_run.trigger_conversation_message_id
             AND attachment.conversation_id = agent_run.conversation_id
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
              AND agent_run.invocation_kind = 'single_chat'
            ORDER BY attachment.position, attachment.id
            "#,
        )?;
        let attachments = statement
            .query_map(params![agent_run_id, execution_epoch], |row| {
                Ok(StoredSingleChatAttachment {
                    camp_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    attachment_id: row.get(2)?,
                    display_name: row.get(3)?,
                    kind: row.get(4)?,
                    media_type: row.get(5)?,
                    byte_size: row.get::<_, i64>(6)?.max(0) as u64,
                    content_digest: row.get(7)?,
                    path: PathBuf::from(row.get::<_, String>(8)?),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(SingleChatRuntimeAttachmentProjectionPlan { attachments })
    }

    pub fn project_runtime_attachments_filesystem(
        &self,
        plan: SingleChatRuntimeAttachmentProjectionPlan,
        run_tmp: &Path,
    ) -> Result<Option<PathBuf>> {
        if plan.attachments.is_empty() {
            return Ok(None);
        }
        let projection_root = run_tmp.join("single-chat-input-attachments");
        if projection_root.exists() {
            remove_attachment_directory(&projection_root)?;
        }
        ensure_directory(&projection_root)?;
        let projected = (|| -> Result<()> {
            for attachment in &plan.attachments {
                self.verify_stored_attachment(attachment)?;
                let attachment_root = projection_root.join(&attachment.attachment_id);
                ensure_directory(&attachment_root)?;
                let copied = copy_and_inspect(
                    &attachment.path,
                    &attachment_root.join(&attachment.display_name),
                )?;
                if copied.kind != attachment.kind
                    || copied.media_type != attachment.media_type
                    || copied.byte_size != attachment.byte_size
                    || copied.content_digest != attachment.content_digest
                {
                    anyhow::bail!("Single Chat Runtime attachment projection changed");
                }
                set_directory_read_only(&attachment_root)?;
            }
            Ok(())
        })();
        if let Err(error) = projected {
            let _ = remove_attachment_directory(&projection_root);
            return Err(error);
        }
        Ok(Some(projection_root))
    }

    pub fn cleanup_expired(&self, database: &mut Database) -> Result<usize> {
        let now = Utc::now().to_rfc3339();
        let paths = {
            let mut statement = database.connection().prepare(
                "SELECT storage_path FROM single_chat_prepared_attachment WHERE expires_at <= ?1",
            )?;
            statement
                .query_map([&now], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        database.connection().execute(
            "DELETE FROM single_chat_prepared_attachment WHERE expires_at <= ?1",
            [&now],
        )?;
        let count = paths.len();
        self.cleanup_detached(SingleChatAttachmentCleanupPlan {
            paths: paths.into_iter().map(PathBuf::from).collect(),
        })?;
        Ok(count)
    }

    pub fn remove_camp(&self, camp_id: &str) -> Result<()> {
        validate_component(camp_id, "Camp")?;
        let camp_root = self.root.join(camp_id);
        if camp_root.exists() {
            remove_attachment_directory(&camp_root)?;
        }
        Ok(())
    }

    fn verify_stored_attachment(&self, attachment: &StoredSingleChatAttachment) -> Result<()> {
        let expected = self
            .conversation_root(&attachment.camp_id, &attachment.conversation_id)?
            .join(&attachment.attachment_id)
            .join(&attachment.display_name);
        if attachment.path != expected || !attachment.path.is_absolute() {
            anyhow::bail!("Single Chat attachment path does not match its identity");
        }
        let canonical_root =
            fs::canonicalize(&self.root).context("Single Chat Attachment root is unavailable")?;
        let canonical_path =
            fs::canonicalize(&attachment.path).context("Single Chat attachment is unavailable")?;
        if !canonical_path.starts_with(&canonical_root) {
            anyhow::bail!("Single Chat attachment escaped its private root");
        }
        let receipt = inspect_runtime_attachment_copy(&attachment.path)?;
        if receipt.kind != attachment.kind
            || receipt.byte_size != attachment.byte_size
            || receipt.content_digest != attachment.content_digest
            || (attachment.media_type == DIRECTORY_MEDIA_TYPE) != (receipt.kind == "directory")
        {
            anyhow::bail!("Single Chat attachment no longer matches its receipt");
        }
        Ok(())
    }

    fn cleanup_storage_path(&self, path: &Path) -> Result<()> {
        let attachment_directory = path
            .parent()
            .context("Single Chat attachment has no owning directory")?;
        let canonical_root =
            fs::canonicalize(&self.root).context("Single Chat Attachment root is unavailable")?;
        let canonical_directory = fs::canonicalize(attachment_directory)
            .context("Single Chat attachment directory is unavailable")?;
        if !canonical_directory.starts_with(&canonical_root) {
            anyhow::bail!("Single Chat attachment cleanup escaped its private root");
        }
        let conversation_root = attachment_directory
            .parent()
            .context("Single Chat attachment has no Conversation directory")?;
        allow_directory_update(conversation_root)?;
        remove_attachment_directory(attachment_directory)?;
        restrict_directory_discovery(conversation_root)?;
        Ok(())
    }

    fn conversation_root(&self, camp_id: &str, conversation_id: &str) -> Result<PathBuf> {
        validate_component(camp_id, "Camp")?;
        validate_component(conversation_id, "Conversation")?;
        Ok(self.root.join(camp_id).join(conversation_id))
    }
}

fn require_active_conversation(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    expected_version: i64,
) -> Result<String> {
    validate_component(conversation_id, "Conversation")?;
    connection
        .query_row(
            "SELECT camp_id FROM conversation
             WHERE id = ?1 AND version = ?2
               AND kind = 'single_chat' AND ended_at IS NULL",
            params![conversation_id, expected_version],
            |row| row.get(0),
        )
        .optional()?
        .context("Single Chat changed before its attachments were updated")
}

fn validate_capacity(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    additional_bytes: u64,
) -> Result<()> {
    let (count, byte_size): (i64, i64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(byte_size), 0)
         FROM single_chat_prepared_attachment WHERE conversation_id = ?1",
        [conversation_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if count < 0 || count as usize >= MAX_PREPARED_ATTACHMENTS {
        anyhow::bail!("At most 10 files may be attached to one Single Chat message");
    }
    let total = (byte_size.max(0) as u64)
        .checked_add(additional_bytes)
        .context("Single Chat attachment byte total overflow")?;
    if total > MAX_DRAFT_ATTACHMENT_BYTES {
        anyhow::bail!("Single Chat attachments exceed the 64 MiB aggregate limit");
    }
    Ok(())
}

fn normalize_ordinals(transaction: &Transaction<'_>, conversation_id: &str) -> Result<()> {
    let ids = {
        let mut statement = transaction.prepare(
            "SELECT id FROM single_chat_prepared_attachment
             WHERE conversation_id = ?1 ORDER BY ordinal, id",
        )?;
        statement
            .query_map([conversation_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (ordinal, id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE single_chat_prepared_attachment SET ordinal = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, ordinal as i64, Utc::now().to_rfc3339()],
        )?;
    }
    Ok(())
}

fn validate_component(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        anyhow::bail!("{label} identity is invalid");
    }
    Ok(())
}

fn restrict_directory_discovery(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o100))?;
    }
    Ok(())
}
