use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{command::ActorRef, db::Database};

const MAX_BLOB_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedBlobMetadata {
    pub id: String,
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
    pub state: String,
    pub sensitivity: String,
    pub created_at: String,
    pub verified_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachmentMetadata {
    pub id: String,
    pub camp_id: String,
    pub camp_message_id: Option<String>,
    pub conversation_message_id: Option<String>,
    pub blob_id: String,
    pub display_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentTarget<'a> {
    CampMessage(&'a str),
    ConversationMessage(&'a str),
}

#[derive(Debug, Clone)]
pub struct ManagedBlobStore {
    root: PathBuf,
    max_blob_bytes: u64,
}

impl ManagedBlobStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("managed-blobs"),
            max_blob_bytes: MAX_BLOB_BYTES,
        }
    }

    pub fn put_reader<R: Read>(
        &self,
        database: &mut Database,
        reader: &mut R,
        media_type: &str,
        sensitivity: &str,
    ) -> Result<ManagedBlobMetadata> {
        validate_media_type(media_type)?;
        if !matches!(sensitivity, "normal" | "sensitive") {
            anyhow::bail!("Blob sensitivity must be normal or sensitive");
        }
        let temporary_dir = self.root.join("tmp");
        fs::create_dir_all(&temporary_dir).with_context(|| {
            format!(
                "failed to create Managed Blob temp directory {}",
                temporary_dir.display()
            )
        })?;
        let temporary_path = temporary_dir.join(Uuid::new_v4().to_string());
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .with_context(|| format!("failed to create {}", temporary_path.display()))?;
        let mut hasher = Sha256::new();
        let mut byte_size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        let write_result = (|| -> Result<()> {
            loop {
                let read = reader.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                byte_size = byte_size
                    .checked_add(read as u64)
                    .context("Blob size overflow")?;
                if byte_size > self.max_blob_bytes {
                    anyhow::bail!("Managed Blob exceeds {} bytes", self.max_blob_bytes);
                }
                hasher.update(&buffer[..read]);
                temporary.write_all(&buffer[..read])?;
            }
            temporary.sync_all()?;
            Ok(())
        })();
        if let Err(error) = write_result {
            drop(temporary);
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        drop(temporary);

        let digest = format!("{:x}", hasher.finalize());
        let relative_path = blob_relative_path(&digest);
        let final_path = self.root.join(&relative_path);
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }
        if final_path.exists() {
            fs::remove_file(&temporary_path)?;
            if final_path.metadata()?.len() != byte_size {
                anyhow::bail!("Managed Blob digest collision or corrupted existing content");
            }
        } else {
            fs::rename(&temporary_path, &final_path).with_context(|| {
                format!("failed to atomically move Blob to {}", final_path.display())
            })?;
            sync_parent(&final_path)?;
        }

        let blob_id = format!("blob-sha256-{digest}");
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        if let Some((existing_size, existing_path)) = transaction
            .query_row(
                "SELECT byte_size, storage_relative_path FROM managed_blob WHERE sha256 = ?1",
                [&digest],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            && (existing_size != byte_size as i64 || existing_path != relative_path)
        {
            anyhow::bail!("Managed Blob metadata conflicts with content address");
        }
        transaction.execute(
            r#"
            INSERT INTO managed_blob(
                id, sha256, byte_size, media_type, storage_relative_path,
                state, sensitivity, created_at, verified_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'present', ?6, ?7, ?7, ?7)
            ON CONFLICT(sha256) DO UPDATE SET
                state = 'present', verified_at = excluded.verified_at,
                updated_at = excluded.updated_at
            "#,
            params![
                blob_id,
                digest,
                byte_size as i64,
                media_type,
                relative_path,
                sensitivity,
                now,
            ],
        )?;
        let metadata = load_blob_metadata(&transaction, &blob_id)?
            .context("Managed Blob metadata was not persisted")?;
        transaction.commit()?;
        Ok(metadata)
    }

    pub fn put_bytes(
        &self,
        database: &mut Database,
        bytes: &[u8],
        media_type: &str,
        sensitivity: &str,
    ) -> Result<ManagedBlobMetadata> {
        self.put_reader(
            database,
            &mut std::io::Cursor::new(bytes),
            media_type,
            sensitivity,
        )
    }

    pub fn read_bytes(&self, database: &Database, blob_id: &str) -> Result<Vec<u8>> {
        let metadata = load_blob_metadata(database.connection(), blob_id)?
            .context("Managed Blob does not exist")?;
        if metadata.state != "present" || metadata.byte_size > self.max_blob_bytes {
            anyhow::bail!("Managed Blob is not readable");
        }
        let path = safe_blob_path(&self.root, &metadata.sha256)?;
        let bytes = fs::read(&path)
            .with_context(|| format!("failed to read Managed Blob {}", path.display()))?;
        if bytes.len() as u64 != metadata.byte_size
            || format!("{:x}", Sha256::digest(&bytes)) != metadata.sha256
        {
            anyhow::bail!("Managed Blob content does not match its metadata");
        }
        Ok(bytes)
    }

    pub fn read_text(&self, database: &Database, blob_id: &str) -> Result<String> {
        String::from_utf8(self.read_bytes(database, blob_id)?)
            .context("Managed Blob is not valid UTF-8 text")
    }

    pub fn attach(
        &self,
        database: &mut Database,
        camp_id: &str,
        target: AttachmentTarget<'_>,
        blob_id: &str,
        display_name: &str,
        actor: &ActorRef,
    ) -> Result<MessageAttachmentMetadata> {
        let display_name = normalize_display_name(display_name)?;
        let transaction = database.connection_mut().transaction()?;
        let blob =
            load_blob_metadata(&transaction, blob_id)?.context("Managed Blob does not exist")?;
        if blob.state != "present" {
            anyhow::bail!("Managed Blob is not intact");
        }
        let (camp_message_id, conversation_message_id) = match target {
            AttachmentTarget::CampMessage(message_id) => {
                let count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM camp_message WHERE id = ?1 AND camp_id = ?2",
                    params![message_id, camp_id],
                    |row| row.get(0),
                )?;
                if count != 1 {
                    anyhow::bail!("CampMessage is outside the Camp");
                }
                (Some(message_id), None)
            }
            AttachmentTarget::ConversationMessage(message_id) => {
                let count: i64 = transaction.query_row(
                    r#"
                    SELECT COUNT(*) FROM conversation_message
                    JOIN conversation
                      ON conversation.id = conversation_message.conversation_id
                    WHERE conversation_message.id = ?1
                      AND conversation.camp_id = ?2
                    "#,
                    params![message_id, camp_id],
                    |row| row.get(0),
                )?;
                if count != 1 {
                    anyhow::bail!("ConversationMessage is outside the Camp");
                }
                (None, Some(message_id))
            }
        };
        let (actor_type, actor_id) = actor_parts(actor);
        let attachment_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        transaction.execute(
            r#"
            INSERT INTO message_attachment(
                id, camp_id, camp_message_id, conversation_message_id,
                blob_id, display_name, media_type, byte_size,
                created_by_type, created_by_id, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                attachment_id,
                camp_id,
                camp_message_id,
                conversation_message_id,
                blob_id,
                display_name,
                blob.media_type,
                blob.byte_size as i64,
                actor_type,
                actor_id,
                now,
            ],
        )?;
        let metadata = MessageAttachmentMetadata {
            id: attachment_id,
            camp_id: camp_id.to_string(),
            camp_message_id: camp_message_id.map(str::to_string),
            conversation_message_id: conversation_message_id.map(str::to_string),
            blob_id: blob_id.to_string(),
            display_name,
            media_type: blob.media_type,
            byte_size: blob.byte_size,
            created_at: now,
        };
        transaction.commit()?;
        Ok(metadata)
    }

    pub fn verify(&self, database: &mut Database, blob_id: &str) -> Result<bool> {
        let metadata = load_blob_metadata(database.connection(), blob_id)?
            .context("Managed Blob does not exist")?;
        let path = safe_blob_path(&self.root, &metadata.sha256)?;
        let verification = hash_file(&path);
        let (state, valid) = match verification {
            Ok((digest, size)) if digest == metadata.sha256 && size == metadata.byte_size => {
                ("present", true)
            }
            Ok(_) => ("corrupt", false),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound) =>
            {
                ("missing", false)
            }
            Err(error) => return Err(error),
        };
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            UPDATE managed_blob
            SET state = ?2, verified_at = ?3, updated_at = ?3
            WHERE id = ?1
            "#,
            params![blob_id, state, now],
        )?;
        Ok(valid)
    }

    pub fn collect_unreferenced_before(
        &self,
        database: &mut Database,
        created_before: &str,
    ) -> Result<Vec<String>> {
        chrono::DateTime::parse_from_rfc3339(created_before)
            .context("GC cutoff must be RFC3339")?;
        let candidates = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT managed_blob.id, managed_blob.sha256
                FROM managed_blob
                WHERE managed_blob.created_at < ?1
                  AND NOT EXISTS (
                      SELECT 1 FROM message_attachment
                      WHERE message_attachment.blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM action_execution
                      WHERE action_execution.result_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM context_manifest
                      WHERE context_manifest.rendered_payload_blob_id = managed_blob.id
                  )
                ORDER BY managed_blob.id
                "#,
            )?;
            statement
                .query_map([created_before], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut collected = Vec::new();
        for (blob_id, digest) in candidates {
            let path = safe_blob_path(&self.root, &digest)?;
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            let deleted = database.connection().execute(
                r#"
                DELETE FROM managed_blob
                WHERE id = ?1
                  AND NOT EXISTS (SELECT 1 FROM message_attachment WHERE blob_id = ?1)
                  AND NOT EXISTS (SELECT 1 FROM action_execution WHERE result_blob_id = ?1)
                  AND NOT EXISTS (
                      SELECT 1 FROM context_manifest
                      WHERE rendered_payload_blob_id = ?1
                  )
                "#,
                [&blob_id],
            )?;
            if deleted == 1 {
                collected.push(blob_id);
            }
        }
        Ok(collected)
    }
}

fn load_blob_metadata(
    connection: &rusqlite::Connection,
    blob_id: &str,
) -> Result<Option<ManagedBlobMetadata>> {
    connection
        .query_row(
            r#"
            SELECT id, sha256, byte_size, media_type, state,
                   sensitivity, created_at, verified_at
            FROM managed_blob WHERE id = ?1
            "#,
            [blob_id],
            |row| {
                Ok(ManagedBlobMetadata {
                    id: row.get(0)?,
                    sha256: row.get(1)?,
                    byte_size: row.get::<_, i64>(2)? as u64,
                    media_type: row.get(3)?,
                    state: row.get(4)?,
                    sensitivity: row.get(5)?,
                    created_at: row.get(6)?,
                    verified_at: row.get(7)?,
                })
            },
        )
        .optional()
        .context("failed to read Managed Blob metadata")
}

fn normalize_display_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 || value.chars().any(char::is_control) {
        anyhow::bail!("Attachment display name is invalid");
    }
    let path = Path::new(value);
    if path.components().count() != 1
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        anyhow::bail!("Attachment display name must not contain a path");
    }
    Ok(value.to_string())
}

fn validate_media_type(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 127
        || value.chars().any(char::is_control)
        || !value.contains('/')
    {
        anyhow::bail!("Blob media type is invalid");
    }
    Ok(())
}

fn blob_relative_path(digest: &str) -> String {
    format!("sha256/{}/{}", &digest[..2], digest)
}

fn safe_blob_path(root: &Path, digest: &str) -> Result<PathBuf> {
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        anyhow::bail!("Managed Blob digest is invalid");
    }
    Ok(root.join(blob_relative_path(digest)))
}

fn hash_file(path: &Path) -> Result<(String, u64)> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn sync_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn actor_parts(actor: &ActorRef) -> (&'static str, &str) {
    match actor {
        ActorRef::User { user_id } => ("user", user_id),
        ActorRef::Agent {
            agent_profile_id, ..
        } => ("agent", agent_profile_id),
        ActorRef::System { component_id } => ("system", component_id),
    }
}
