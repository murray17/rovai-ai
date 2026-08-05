use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    camp_content::{
        StructuredCampMessageContent, StructuredCampMessageSegment, normalize_content,
        render_current_plain_text, validate_content,
    },
    db::Database,
};

pub const MAX_PREPARED_ATTACHMENTS: usize = 10;
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_DRAFT_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
const DRAFT_RETENTION_DAYS: i64 = 7;
const INSPECTION_PREFIX_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_EDGE: u64 = 16_384;
const MAX_PREVIEW_PIXELS: u64 = 40_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAttachmentView {
    pub id: String,
    pub display_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub preview_kind: String,
    pub state: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerDraftView {
    pub camp_id: String,
    pub body: String,
    pub content: StructuredCampMessageContent,
    pub revision: i64,
    pub attachments: Vec<PreparedAttachmentView>,
    pub updated_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentPreviewSource {
    pub path: PathBuf,
    pub media_type: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone)]
pub struct CampAttachmentStore {
    root: PathBuf,
}

impl CampAttachmentStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("camp-attachments"),
        }
    }

    pub fn camp_root(&self, camp_id: &str) -> Result<PathBuf> {
        validate_component(camp_id, "Camp")?;
        let root = self.root.join(camp_id);
        ensure_directory(&root)?;
        restrict_discovery(&root)?;
        Ok(root)
    }

    pub fn load_draft(&self, database: &Database, camp_id: &str) -> Result<CampComposerDraftView> {
        validate_component(camp_id, "Camp")?;
        ensure_active_camp(database, camp_id)?;
        let draft = database
            .connection()
            .query_row(
                r#"
                SELECT structured_content_json, revision, updated_at, expires_at
                FROM camp_composer_draft
                WHERE camp_id = ?1
                "#,
                [camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let attachments = load_prepared_attachments(database, camp_id)?;
        Ok(match draft {
            Some((content, revision, updated_at, expires_at)) => {
                let content = normalize_content(serde_json::from_str(&content)?);
                validate_content(&content)?;
                CampComposerDraftView {
                    camp_id: camp_id.to_string(),
                    body: render_content(database, &content)?,
                    content,
                    revision,
                    attachments,
                    updated_at: Some(updated_at),
                    expires_at: Some(expires_at),
                }
            }
            None => CampComposerDraftView {
                camp_id: camp_id.to_string(),
                body: String::new(),
                content: Vec::new(),
                revision: 0,
                attachments,
                updated_at: None,
                expires_at: None,
            },
        })
    }

    pub fn save_body(
        &self,
        database: &mut Database,
        camp_id: &str,
        body: &str,
    ) -> Result<CampComposerDraftView> {
        let current = self.load_draft(database, camp_id)?;
        let content = (!body.is_empty())
            .then(|| StructuredCampMessageSegment::Text {
                text: body.to_string(),
            })
            .into_iter()
            .collect();
        self.save_content(database, camp_id, current.revision, content)
    }

    pub fn save_content(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        content: StructuredCampMessageContent,
    ) -> Result<CampComposerDraftView> {
        validate_component(camp_id, "Camp")?;
        ensure_active_camp(database, camp_id)?;
        let content = normalize_content(content);
        validate_content(&content)?;
        let content_json = serde_json::to_string(&content)?;
        let body = render_content(database, &content)?;
        let current = database
            .connection()
            .query_row(
                r#"
                SELECT structured_content_json, revision
                FROM camp_composer_draft
                WHERE camp_id = ?1
                "#,
                [camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let current_revision = current.as_ref().map_or(0, |(_, revision)| *revision);
        if current_revision != expected_revision {
            anyhow::bail!("draft_changed");
        }
        if current
            .as_ref()
            .is_some_and(|(stored, _)| stored == &content_json)
        {
            return self.load_draft(database, camp_id);
        }
        let has_attachments: bool = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)",
            [camp_id],
            |row| row.get(0),
        )?;
        if current.is_none() && content.is_empty() && !has_attachments {
            return self.load_draft(database, camp_id);
        }
        let (now, expires_at) = draft_times();
        if expected_revision == 0 {
            database.connection().execute(
                r#"
                INSERT INTO camp_composer_draft(
                    camp_id, body, structured_content_json, revision,
                    created_at, updated_at, expires_at
                ) VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)
                "#,
                params![camp_id, body, content_json, now, expires_at],
            )?;
        } else {
            let updated = database.connection().execute(
                r#"
                UPDATE camp_composer_draft
                SET body = ?3,
                    structured_content_json = ?4,
                    revision = revision + 1,
                    updated_at = ?5,
                    expires_at = ?6
                WHERE camp_id = ?1 AND revision = ?2
                "#,
                params![
                    camp_id,
                    expected_revision,
                    body,
                    content_json,
                    now,
                    expires_at
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("draft_changed");
            }
        }
        self.load_draft(database, camp_id)
    }

    pub fn prepare_from_path(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        source_path: &Path,
        requested_display_name: &str,
    ) -> Result<CampComposerDraftView> {
        validate_component(camp_id, "Camp")?;
        ensure_active_camp(database, camp_id)?;
        ensure_draft_revision(database.connection(), camp_id, expected_revision)?;
        validate_draft_capacity(database, camp_id, 0)?;
        let display_name = normalize_display_name(requested_display_name)?;
        let attachment_id = Uuid::new_v4().to_string();
        let camp_root = self.camp_root(camp_id)?;
        allow_directory_update(&camp_root)?;
        let attachment_directory = camp_root.join(&attachment_id);
        let prepared = (|| -> Result<PreparedFile> {
            ensure_directory(&attachment_directory)?;
            let destination = attachment_directory.join(&display_name);
            copy_and_inspect(source_path, &destination)
        })();
        let _ = restrict_discovery(&camp_root);
        let prepared = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                cleanup_unowned_attachment(&camp_root, &attachment_directory);
                return Err(error);
            }
        };

        let persistence = (|| -> Result<()> {
            let transaction = database.connection_mut().transaction()?;
            ensure_draft_revision(&transaction, camp_id, expected_revision)?;
            validate_draft_capacity_tx(&transaction, camp_id, prepared.byte_size)?;
            let (now, expires_at) = draft_times();
            transaction.execute(
                r#"
                INSERT INTO camp_composer_draft(camp_id, body, created_at, updated_at, expires_at)
                VALUES (?1, '', ?2, ?2, ?3)
                ON CONFLICT(camp_id) DO UPDATE SET
                    revision = camp_composer_draft.revision + 1,
                    updated_at = excluded.updated_at,
                    expires_at = excluded.expires_at
                "#,
                params![camp_id, now, expires_at],
            )?;
            let ordinal: i64 = transaction.query_row(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM prepared_attachment WHERE camp_id = ?1",
                [camp_id],
                |row| row.get(0),
            )?;
            transaction.execute(
                r#"
                INSERT INTO prepared_attachment(
                    id, camp_id, ordinal, display_name, media_type, byte_size,
                    content_digest, storage_path, preview_kind, state,
                    last_error_code, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ready',
                    NULL, ?10, ?10
                )
                "#,
                params![
                    attachment_id,
                    camp_id,
                    ordinal,
                    display_name,
                    prepared.media_type,
                    prepared.byte_size as i64,
                    prepared.content_digest,
                    prepared.path.to_string_lossy(),
                    prepared.preview_kind,
                    now,
                ],
            )?;
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = persistence {
            cleanup_unowned_attachment(&camp_root, &attachment_directory);
            return Err(error);
        }
        self.load_draft(database, camp_id)
    }

    pub fn remove_prepared(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        attachment_id: &str,
    ) -> Result<CampComposerDraftView> {
        validate_component(camp_id, "Camp")?;
        validate_component(attachment_id, "Prepared Attachment")?;
        ensure_draft_revision(database.connection(), camp_id, expected_revision)?;
        let path = database
            .connection()
            .query_row(
                r#"
                SELECT storage_path FROM prepared_attachment
                WHERE id = ?1 AND camp_id = ?2
                "#,
                params![attachment_id, camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .context("Prepared Attachment does not exist in this Camp")?;
        let transaction = database.connection_mut().transaction()?;
        ensure_draft_revision(&transaction, camp_id, expected_revision)?;
        transaction.execute(
            "DELETE FROM prepared_attachment WHERE id = ?1 AND camp_id = ?2",
            params![attachment_id, camp_id],
        )?;
        normalize_ordinals(&transaction, camp_id)?;
        let (now, expires_at) = draft_times();
        transaction.execute(
            r#"
            UPDATE camp_composer_draft
            SET revision = revision + 1, updated_at = ?2, expires_at = ?3
            WHERE camp_id = ?1
            "#,
            params![camp_id, now, expires_at],
        )?;
        transaction.commit()?;
        let camp_root = self.camp_root(camp_id)?;
        let cleanup = (|| -> Result<()> {
            allow_directory_update(&camp_root)?;
            let removal = remove_attachment_file_parent(Path::new(&path));
            let restriction = restrict_discovery(&camp_root);
            removal?;
            restriction?;
            Ok(())
        })();
        if let Err(error) = cleanup {
            eprintln!(
                "Prepared Attachment {attachment_id} was removed from Draft {camp_id}, \
                 but its superseded file could not be cleaned immediately: {error:#}"
            );
        }
        self.load_draft(database, camp_id)
    }

    pub fn discard_draft(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        validate_component(camp_id, "Camp")?;
        let paths = prepared_paths(database, camp_id)?;
        database.connection().execute(
            "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
            [camp_id],
        )?;
        let camp_root = self.root.join(camp_id);
        if !paths.is_empty() && camp_root.exists() {
            allow_directory_update(&camp_root)?;
        }
        let removal = (|| -> Result<()> {
            for path in paths {
                remove_attachment_file_parent(Path::new(&path))?;
            }
            Ok(())
        })();
        let restriction = camp_root
            .exists()
            .then(|| restrict_discovery(&camp_root))
            .transpose();
        removal?;
        restriction?;
        Ok(())
    }

    pub fn verify_send(
        &self,
        database: &Database,
        camp_id: &str,
        prepared_attachment_ids: &[String],
    ) -> Result<()> {
        ensure_active_camp(database, camp_id)?;
        let stored = load_prepared_rows(database, camp_id)?;
        let stored_ids = stored.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
        let requested_ids = prepared_attachment_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        if stored_ids != requested_ids {
            anyhow::bail!("Camp Composer Draft attachments changed before send");
        }
        if stored.len() > MAX_PREPARED_ATTACHMENTS {
            anyhow::bail!("Camp Composer Draft exceeds the attachment count limit");
        }
        let mut total = 0_u64;
        for row in stored {
            total = total
                .checked_add(row.byte_size)
                .context("Attachment total size overflow")?;
            validate_owned_file(
                &self.root,
                Path::new(&row.storage_path),
                row.byte_size,
                &row.content_digest,
            )?;
        }
        if total > MAX_DRAFT_ATTACHMENT_BYTES {
            anyhow::bail!("Camp Composer Draft exceeds the total attachment size limit");
        }
        Ok(())
    }

    pub fn preview_source(
        &self,
        database: &Database,
        attachment_id: &str,
    ) -> Result<Option<AttachmentPreviewSource>> {
        validate_component(attachment_id, "Attachment")?;
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT storage_path, media_type, byte_size, preview_kind
                FROM prepared_attachment
                WHERE id = ?1
                UNION ALL
                SELECT storage_path, media_type, byte_size, preview_kind
                FROM message_attachment
                WHERE id = ?1
                LIMIT 1
                "#,
                [attachment_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((path, media_type, byte_size, preview_kind)) = row else {
            return Ok(None);
        };
        if preview_kind != "image" || byte_size < 0 || byte_size as u64 > MAX_PREVIEW_BYTES {
            return Ok(None);
        }
        let path = PathBuf::from(path);
        validate_owned_path(&self.root, &path)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() != byte_size as u64
        {
            return Ok(None);
        }
        Ok(Some(AttachmentPreviewSource {
            path,
            media_type,
            byte_size: byte_size as u64,
        }))
    }

    pub fn remove_camp(&self, camp_id: &str) -> Result<()> {
        validate_component(camp_id, "Camp")?;
        let root = self.root.join(camp_id);
        if !root.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(&root)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            anyhow::bail!("Camp Attachment Directory is unsafe");
        }
        allow_directory_update(&root)?;
        fs::remove_dir_all(root)?;
        Ok(())
    }

    pub fn cleanup_expired(&self, database: &mut Database) -> Result<usize> {
        let now = Utc::now().to_rfc3339();
        let camps = {
            let mut statement = database
                .connection()
                .prepare("SELECT camp_id FROM camp_composer_draft WHERE expires_at <= ?1")?;
            statement
                .query_map([&now], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for camp_id in &camps {
            self.discard_draft(database, camp_id)?;
        }
        Ok(camps.len())
    }
}

pub fn consume_prepared_attachments(
    transaction: &Transaction<'_>,
    camp_id: &str,
    camp_message_id: &str,
    prepared_attachment_ids: &[String],
    now: &str,
) -> Result<()> {
    let rows = load_prepared_rows_tx(transaction, camp_id)?;
    let stored_ids = rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
    let requested_ids = prepared_attachment_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if stored_ids != requested_ids {
        anyhow::bail!("Camp Composer Draft attachments changed before commit");
    }
    for (position, row) in rows.into_iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO message_attachment(
                id, camp_id, camp_message_id, conversation_message_id,
                position, display_name, media_type, byte_size,
                content_digest, storage_path, preview_kind,
                created_by_type, created_by_id, created_at
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, 'user', 'local-user', ?11
            )
            "#,
            params![
                row.id,
                camp_id,
                camp_message_id,
                position as i64,
                row.display_name,
                row.media_type,
                row.byte_size as i64,
                row.content_digest,
                row.storage_path,
                row.preview_kind,
                now,
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
        [camp_id],
    )?;
    Ok(())
}

#[derive(Debug)]
struct PreparedFile {
    path: PathBuf,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    preview_kind: String,
}

#[derive(Debug)]
struct PreparedRow {
    id: String,
    display_name: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    storage_path: String,
    preview_kind: String,
}

fn copy_and_inspect(source_path: &Path, destination: &Path) -> Result<PreparedFile> {
    let source_metadata = fs::symlink_metadata(source_path)
        .with_context(|| format!("failed to inspect attachment {}", source_path.display()))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        anyhow::bail!("Only regular files can be attached");
    }
    if source_metadata.len() > MAX_ATTACHMENT_BYTES {
        anyhow::bail!("Attachment exceeds the 25 MiB per-file limit");
    }
    let mut source_options = OpenOptions::new();
    source_options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        source_options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut source = source_options
        .open(source_path)
        .with_context(|| format!("failed to open attachment {}", source_path.display()))?;
    let opened_metadata = source.metadata()?;
    if !opened_metadata.is_file()
        || opened_metadata.len() != source_metadata.len()
        || opened_metadata.len() > MAX_ATTACHMENT_BYTES
    {
        anyhow::bail!("Attachment changed while it was being opened");
    }
    let temporary = destination.with_file_name(format!(".{}.tmp", Uuid::new_v4()));
    let mut destination_options = OpenOptions::new();
    destination_options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        destination_options.mode(0o600);
    }
    let mut output = destination_options.create_new(true).open(&temporary)?;
    let mut hasher = Sha256::new();
    let mut prefix = Vec::with_capacity(INSPECTION_PREFIX_BYTES);
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let copied = (|| -> Result<()> {
        loop {
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            byte_size = byte_size
                .checked_add(read as u64)
                .context("Attachment size overflow")?;
            if byte_size > MAX_ATTACHMENT_BYTES {
                anyhow::bail!("Attachment exceeds the 25 MiB per-file limit");
            }
            if prefix.len() < INSPECTION_PREFIX_BYTES {
                let remaining = INSPECTION_PREFIX_BYTES - prefix.len();
                prefix.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        Ok(())
    })();
    if let Err(error) = copied {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if byte_size != opened_metadata.len() {
        drop(output);
        let _ = fs::remove_file(&temporary);
        anyhow::bail!("Attachment changed while it was being copied");
    }
    set_read_only(&temporary)?;
    drop(output);
    fs::rename(&temporary, destination)?;
    sync_parent(destination)?;
    let inspection = inspect_prefix(&prefix, byte_size);
    Ok(PreparedFile {
        path: destination.to_path_buf(),
        media_type: inspection.media_type,
        byte_size,
        content_digest: format!("sha256:{:x}", hasher.finalize()),
        preview_kind: inspection.preview_kind,
    })
}

#[derive(Debug)]
struct PrefixInspection {
    media_type: String,
    preview_kind: String,
}

fn inspect_prefix(prefix: &[u8], byte_size: u64) -> PrefixInspection {
    let image = image_dimensions(prefix);
    if let Some((media_type, width, height)) = image {
        let safe_dimensions = width > 0
            && height > 0
            && width <= MAX_PREVIEW_EDGE
            && height <= MAX_PREVIEW_EDGE
            && width.saturating_mul(height) <= MAX_PREVIEW_PIXELS;
        return PrefixInspection {
            media_type: media_type.to_string(),
            preview_kind: if safe_dimensions && byte_size <= MAX_PREVIEW_BYTES {
                "image"
            } else {
                "none"
            }
            .to_string(),
        };
    }
    let media_type = if prefix.starts_with(b"%PDF-") {
        "application/pdf"
    } else if prefix.starts_with(b"PK\x03\x04") {
        "application/zip"
    } else if std::str::from_utf8(prefix).is_ok() && !prefix.contains(&0) {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    };
    PrefixInspection {
        media_type: media_type.to_string(),
        preview_kind: "none".to_string(),
    }
}

fn image_dimensions(bytes: &[u8]) -> Option<(&'static str, u64, u64)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        return Some((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().ok()?) as u64,
            u32::from_be_bytes(bytes[20..24].try_into().ok()?) as u64,
        ));
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 10 {
        return Some((
            "image/gif",
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u64,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u64,
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        return jpeg_dimensions(bytes).map(|(width, height)| ("image/jpeg", width, height));
    }
    if bytes.len() >= 30 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return webp_dimensions(bytes).map(|(width, height)| ("image/webp", width, height));
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    let mut offset = 2_usize;
    while offset + 4 <= bytes.len() {
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if length < 2 || offset + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 8
        {
            let height =
                u16::from_be_bytes(bytes.get(offset + 3..offset + 5)?.try_into().ok()?) as u64;
            let width =
                u16::from_be_bytes(bytes.get(offset + 5..offset + 7)?.try_into().ok()?) as u64;
            return Some((width, height));
        }
        offset += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    match bytes.get(12..16)? {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]) as u64;
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]) as u64;
            Some((width, height))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
            Some((
                ((bits & 0x3fff) + 1) as u64,
                (((bits >> 14) & 0x3fff) + 1) as u64,
            ))
        }
        b"VP8 " if bytes.len() >= 30 && &bytes[23..26] == b"\x9d\x01\x2a" => Some((
            (u16::from_le_bytes(bytes[26..28].try_into().ok()?) & 0x3fff) as u64,
            (u16::from_le_bytes(bytes[28..30].try_into().ok()?) & 0x3fff) as u64,
        )),
        _ => None,
    }
}

fn load_prepared_attachments(
    database: &Database,
    camp_id: &str,
) -> Result<Vec<PreparedAttachmentView>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, display_name, media_type, byte_size, preview_kind,
               state, last_error_code, created_at
        FROM prepared_attachment
        WHERE camp_id = ?1
        ORDER BY ordinal, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let byte_size = row.get::<_, i64>(3)?;
            Ok(PreparedAttachmentView {
                id: row.get(0)?,
                display_name: row.get(1)?,
                media_type: row.get(2)?,
                byte_size: byte_size.max(0) as u64,
                preview_kind: row.get(4)?,
                state: row.get(5)?,
                error_message: row.get::<_, Option<String>>(6)?.map(error_message),
                created_at: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub(crate) fn render_content(
    database: &Database,
    content: &[StructuredCampMessageSegment],
) -> Result<String> {
    render_current_plain_text(database.connection(), content)
}

fn load_prepared_rows(database: &Database, camp_id: &str) -> Result<Vec<PreparedRow>> {
    load_prepared_rows_connection(database.connection(), camp_id)
}

fn load_prepared_rows_tx(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<PreparedRow>> {
    load_prepared_rows_connection(transaction, camp_id)
}

fn load_prepared_rows_connection(
    connection: &rusqlite::Connection,
    camp_id: &str,
) -> Result<Vec<PreparedRow>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, display_name, media_type, byte_size,
               content_digest, storage_path, preview_kind
        FROM prepared_attachment
        WHERE camp_id = ?1 AND state = 'ready'
        ORDER BY ordinal, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let byte_size = row.get::<_, i64>(3)?;
            Ok(PreparedRow {
                id: row.get(0)?,
                display_name: row.get(1)?,
                media_type: row.get(2)?,
                byte_size: byte_size.max(0) as u64,
                content_digest: row.get(4)?,
                storage_path: row.get(5)?,
                preview_kind: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn validate_draft_capacity(database: &Database, camp_id: &str, added: u64) -> Result<()> {
    validate_draft_capacity_connection(database.connection(), camp_id, added)
}

fn validate_draft_capacity_tx(
    transaction: &Transaction<'_>,
    camp_id: &str,
    added: u64,
) -> Result<()> {
    validate_draft_capacity_connection(transaction, camp_id, added)
}

fn validate_draft_capacity_connection(
    connection: &rusqlite::Connection,
    camp_id: &str,
    added: u64,
) -> Result<()> {
    let (count, total): (i64, i64) = connection.query_row(
        r#"
        SELECT COUNT(*), COALESCE(SUM(byte_size), 0)
        FROM prepared_attachment
        WHERE camp_id = ?1
        "#,
        [camp_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if count as usize >= MAX_PREPARED_ATTACHMENTS {
        anyhow::bail!("A message can contain at most 10 attachments");
    }
    let total = total.max(0) as u64;
    if total.saturating_add(added) > MAX_DRAFT_ATTACHMENT_BYTES {
        anyhow::bail!("Attachments exceed the 64 MiB total limit");
    }
    Ok(())
}

fn ensure_draft_revision(
    connection: &rusqlite::Connection,
    camp_id: &str,
    expected_revision: i64,
) -> Result<()> {
    if expected_revision < 0 {
        anyhow::bail!("draftRevision must not be negative");
    }
    let revision = connection
        .query_row(
            "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
            [camp_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if revision.unwrap_or(0) != expected_revision {
        anyhow::bail!("draft_changed");
    }
    Ok(())
}

fn normalize_ordinals(transaction: &Transaction<'_>, camp_id: &str) -> Result<()> {
    let ids = {
        let mut statement = transaction.prepare(
            "SELECT id FROM prepared_attachment WHERE camp_id = ?1 ORDER BY ordinal, id",
        )?;
        statement
            .query_map([camp_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (ordinal, id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE prepared_attachment SET ordinal = ?2 WHERE id = ?1",
            params![id, ordinal as i64],
        )?;
    }
    Ok(())
}

fn prepared_paths(database: &Database, camp_id: &str) -> Result<Vec<String>> {
    let mut statement = database
        .connection()
        .prepare("SELECT storage_path FROM prepared_attachment WHERE camp_id = ?1")?;
    Ok(statement
        .query_map([camp_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn ensure_active_camp(database: &Database, camp_id: &str) -> Result<()> {
    let status = database
        .connection()
        .query_row("SELECT status FROM camp WHERE id = ?1", [camp_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?
        .context("Camp does not exist")?;
    if status != "active" {
        anyhow::bail!("Archived Camp cannot own a Composer Draft");
    }
    Ok(())
}

fn normalize_display_name(value: &str) -> Result<String> {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\'
                        | ':'
                        | '\0'
                        | '\u{202a}'
                        | '\u{202b}'
                        | '\u{202c}'
                        | '\u{202d}'
                        | '\u{202e}'
                        | '\u{2066}'
                        | '\u{2067}'
                        | '\u{2068}'
                        | '\u{2069}'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches([' ', '.']).trim();
    if normalized.is_empty() {
        anyhow::bail!("Attachment file name is empty");
    }
    Ok(normalized.chars().take(120).collect())
}

fn validate_owned_file(
    root: &Path,
    path: &Path,
    expected_size: u64,
    expected_digest: &str,
) -> Result<()> {
    validate_owned_path(root, path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != expected_size
        || !expected_digest.starts_with("sha256:")
    {
        anyhow::bail!("Prepared Attachment is unavailable");
    }
    Ok(())
}

fn validate_owned_path(root: &Path, path: &Path) -> Result<()> {
    if !path.is_absolute() {
        anyhow::bail!("Attachment path is outside the Camp Attachment Directory");
    }
    let canonical_root =
        fs::canonicalize(root).context("Camp Attachment Directory is unavailable")?;
    let canonical_path = fs::canonicalize(path).context("Camp Attachment Path is unavailable")?;
    if !canonical_path.starts_with(canonical_root) {
        anyhow::bail!("Attachment path is outside the Camp Attachment Directory");
    }
    Ok(())
}

fn validate_component(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        anyhow::bail!("{label} identity is invalid");
    }
    Ok(())
}

fn draft_times() -> (String, String) {
    let now = Utc::now();
    (
        now.to_rfc3339(),
        (now + Duration::days(DRAFT_RETENTION_DAYS)).to_rfc3339(),
    )
}

fn error_message(code: String) -> String {
    match code.as_str() {
        "attachment_missing" => "附件文件已不可用，请移除后重新添加。".to_string(),
        _ => "附件准备失败，请移除后重新添加。".to_string(),
    }
}

fn ensure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Attachment directory is unsafe");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn allow_directory_update(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn restrict_discovery(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Known opaque child paths remain traversable, while the Camp directory
        // itself cannot be listed to discover attachments beyond a frozen input.
        fs::set_permissions(path, fs::Permissions::from_mode(0o100))?;
    }
    Ok(())
}

fn set_read_only(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o400))?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn remove_attachment_file_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .context("Attachment file has no owning directory")?;
    remove_attachment_directory(parent)
}

fn cleanup_unowned_attachment(camp_root: &Path, attachment_directory: &Path) {
    let _ = allow_directory_update(camp_root);
    let _ = remove_attachment_directory(attachment_directory);
    let _ = restrict_discovery(camp_root);
}

fn remove_attachment_directory(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Attachment directory is unsafe");
    }
    allow_directory_update(path)?;
    fs::remove_dir_all(path)?;
    Ok(())
}

fn sync_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camp_content::StructuredCampMessageSegment as Segment;

    fn insert_test_camp(database: &Database, camp_id: &str) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, name_origin, collaboration_mode,
                    project_binding_kind, project_path, status,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    ?1, 'Draft test', 'user', 'peer',
                    'quick_chat', '/quick-chat-draft-test', 'active',
                    0, 1, '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
                )
                "#,
                [camp_id],
            )
            .unwrap();
    }

    #[test]
    fn structured_draft_save_uses_exact_monotonic_revisions() {
        let directory =
            std::env::temp_dir().join(format!("rovai-draft-revision-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "camp-draft-revision";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);

        let first_content = vec![Segment::Text {
            text: "让@普通文字 ".into(),
        }];
        let first = store
            .save_content(&mut database, camp_id, 0, first_content.clone())
            .unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(first.content, first_content);

        let unchanged = store
            .save_content(
                &mut database,
                camp_id,
                first.revision,
                first.content.clone(),
            )
            .unwrap();
        assert_eq!(unchanged.revision, first.revision);

        let second = store
            .save_content(
                &mut database,
                camp_id,
                first.revision,
                vec![
                    Segment::Text { text: "让".into() },
                    Segment::MemberMention {
                        agent_profile_id: "agent_2".into(),
                    },
                ],
            )
            .unwrap();
        assert_eq!(second.revision, 2);
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET display_name = '木瓦（已改名）', version = version + 1,
                    updated_at = '2026-08-03T00:01:00Z'
                WHERE id = 'agent_2'
                "#,
                [],
            )
            .unwrap();
        let renamed = store.load_draft(&database, camp_id).unwrap();
        assert_eq!(renamed.body, "让@木瓦（已改名）");
        assert_eq!(renamed.revision, second.revision);

        assert!(
            store
                .save_content(&mut database, camp_id, first.revision, first.content)
                .unwrap_err()
                .to_string()
                .contains("draft_changed")
        );

        let cleared = store
            .save_content(&mut database, camp_id, second.revision, Vec::new())
            .unwrap();
        assert_eq!(cleared.revision, 3);
        assert!(cleared.body.is_empty());
        assert!(cleared.content.is_empty());
        let persisted_revision: i64 = database
            .connection()
            .query_row(
                "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                [camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted_revision, 3);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn attachment_mutations_share_the_exact_draft_revision() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-attachment-revision-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "camp-draft-attachment-revision";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);
        let saved = store
            .save_content(
                &mut database,
                camp_id,
                0,
                vec![Segment::Text {
                    text: "附件正文".to_string(),
                }],
            )
            .unwrap();
        let source = directory.join("source.txt");
        std::fs::write(&source, b"revision-bound attachment").unwrap();

        let attached = store
            .prepare_from_path(
                &mut database,
                camp_id,
                saved.revision,
                &source,
                "source.txt",
            )
            .unwrap();
        assert_eq!(attached.revision, saved.revision + 1);
        assert_eq!(attached.attachments.len(), 1);
        assert!(
            store
                .prepare_from_path(&mut database, camp_id, saved.revision, &source, "stale.txt",)
                .unwrap_err()
                .to_string()
                .contains("draft_changed")
        );
        let removed = store
            .remove_prepared(
                &mut database,
                camp_id,
                attached.revision,
                &attached.attachments[0].id,
            )
            .unwrap();
        assert_eq!(removed.revision, attached.revision + 1);
        assert!(removed.attachments.is_empty());
        assert_eq!(removed.content, saved.content);

        store.remove_camp(camp_id).unwrap();
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn sniffs_safe_raster_previews_without_decoding_full_images() {
        let mut png = vec![0_u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&640_u32.to_be_bytes());
        png[20..24].copy_from_slice(&480_u32.to_be_bytes());
        let result = inspect_prefix(&png, 1024);
        assert_eq!(result.media_type, "image/png");
        assert_eq!(result.preview_kind, "image");

        png[16..20].copy_from_slice(&50_000_u32.to_be_bytes());
        assert_eq!(inspect_prefix(&png, 1024).preview_kind, "none");
    }

    #[test]
    fn treats_svg_and_html_as_non_previewable_text() {
        for bytes in [
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".as_slice(),
            b"<script>alert(1)</script>".as_slice(),
        ] {
            let result = inspect_prefix(bytes, bytes.len() as u64);
            assert_eq!(result.media_type, "text/plain; charset=utf-8");
            assert_eq!(result.preview_kind, "none");
        }
    }

    #[test]
    fn normalizes_unsafe_file_names() {
        assert_eq!(
            normalize_display_name("../a\u{202e}:b.png").unwrap(),
            "_a__b.png"
        );
        assert!(normalize_display_name("..").is_err());
    }

    #[test]
    fn byte_limit_constants_are_consistent() {
        const {
            assert!(MAX_PREVIEW_BYTES < MAX_ATTACHMENT_BYTES);
            assert!(MAX_ATTACHMENT_BYTES < MAX_DRAFT_ATTACHMENT_BYTES);
        }
    }
}
