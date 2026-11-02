use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{db::Database, maintenance_budget::MaintenanceBudget};

pub(crate) const MAX_BLOB_BYTES: u64 = 64 * 1024 * 1024;

#[cfg(test)]
thread_local! { static BLOB_READS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
pub(crate) fn take_read_count() -> u64 {
    BLOB_READS.replace(0)
}

pub(crate) const GC_OWNER_EXECUTION_LIFECYCLE: &str = "execution_lifecycle";
pub(crate) const GC_OWNER_CAMP_DELETION: &str = "camp_deletion";
pub(crate) const GC_OWNER_FILE_CHANGE_PROJECTION: &str = "file_change_projection";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateWriteIntent {
    version: u32,
    digest: String,
    owner: String,
    created_at: String,
}

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

    /// Writes content before its authoritative reference transaction. The candidate marker is
    /// durable, so a crash between the file write and the reference commit cannot leak the Blob.
    pub(crate) fn put_bytes_candidate(
        &self,
        database: &mut Database,
        bytes: &[u8],
        media_type: &str,
        sensitivity: &str,
        owner: &str,
    ) -> Result<ManagedBlobMetadata> {
        validate_gc_owner(owner)?;
        validate_media_type(media_type)?;
        if !matches!(sensitivity, "normal" | "sensitive") {
            anyhow::bail!("Blob sensitivity must be normal or sensitive");
        }
        anyhow::ensure!(
            bytes.len() as u64 <= self.max_blob_bytes,
            "Managed Blob exceeds {} bytes",
            self.max_blob_bytes
        );

        let digest = format!("{:x}", Sha256::digest(bytes));
        let blob_id = format!("blob-sha256-{digest}");
        let relative_path = blob_relative_path(&digest);
        let final_path = self.root.join(&relative_path);
        let temporary_dir = self.root.join("tmp");
        fs::create_dir_all(&temporary_dir)?;
        let intent_id = Uuid::new_v4();
        let intent_path = temporary_dir.join(format!("candidate-intent-{intent_id}.json"));
        let intent_staging_path = temporary_dir.join(format!("candidate-intent-write-{intent_id}"));
        let data_path = temporary_dir.join(format!("candidate-data-{intent_id}"));
        let now = chrono::Utc::now().to_rfc3339();
        let intent = serde_json::to_vec(&CandidateWriteIntent {
            version: 1,
            digest: digest.clone(),
            owner: owner.to_string(),
            created_at: now.clone(),
        })?;
        let mut intent_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&intent_staging_path)?;
        intent_file.write_all(&intent)?;
        intent_file.sync_all()?;
        drop(intent_file);
        fs::rename(&intent_staging_path, &intent_path)?;
        sync_parent(&intent_path)?;

        let mut data_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&data_path)?;
        data_file.write_all(bytes)?;
        data_file.sync_all()?;
        drop(data_file);
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }
        if final_path.exists() {
            let (existing_digest, existing_size) = hash_file(&final_path)?;
            anyhow::ensure!(
                existing_digest == digest && existing_size == bytes.len() as u64,
                "Managed Blob digest collision or corrupted existing content"
            );
            fs::remove_file(&data_path)?;
        } else {
            fs::rename(&data_path, &final_path)?;
            sync_parent(&final_path)?;
        }

        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((existing_size, existing_path)) = transaction
            .query_row(
                "SELECT byte_size, storage_relative_path FROM managed_blob WHERE sha256 = ?1",
                [&digest],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            && (existing_size != bytes.len() as i64 || existing_path != relative_path)
        {
            anyhow::bail!("Managed Blob metadata conflicts with content address");
        }
        transaction.execute(
            r#"
            INSERT INTO managed_blob(
                id, sha256, byte_size, media_type, storage_relative_path,
                state, sensitivity, created_at, verified_at, updated_at,
                gc_candidate_at, gc_candidate_owner
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'present', ?6, ?7, ?7, ?7, ?7, ?8)
            ON CONFLICT(sha256) DO UPDATE SET
                state = 'present', verified_at = excluded.verified_at,
                updated_at = excluded.updated_at,
                gc_candidate_at = excluded.gc_candidate_at,
                gc_candidate_owner = excluded.gc_candidate_owner
            "#,
            params![
                blob_id,
                digest,
                bytes.len() as i64,
                media_type,
                relative_path,
                sensitivity,
                now,
                owner,
            ],
        )?;
        let metadata = load_blob_metadata(&transaction, &blob_id)?
            .context("Managed Blob candidate metadata was not persisted")?;
        transaction.commit()?;
        fs::remove_file(&intent_path)?;
        sync_parent(&intent_path)?;
        Ok(metadata)
    }

    /// Enumerate/parse outside the authority lock; only one reference check and
    /// atomic file handoff use it. Unowned staging is deliberately left alone.
    pub(crate) fn recover_gc_state(
        &self,
        database: &tokio::sync::Mutex<Database>,
        budget: &mut MaintenanceBudget,
    ) {
        let entries = match fs::read_dir(self.root.join("tmp")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                budget.report("blob enumeration", error);
                return;
            }
        };
        if let Err(error) = validate_gc_directory(&self.root)
            .and_then(|_| validate_gc_directory(&self.root.join("tmp")))
        {
            budget.report("Blob recovery target", error);
            return;
        }
        for entry in entries {
            if !budget.take() {
                break;
            }
            let result = (|| -> Result<()> {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    return Ok(());
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                let intent = if candidate_intent_id(&name).is_some() {
                    // An intent is tiny. Bound reads even if the file changes after stat.
                    let mut bytes = Vec::new();
                    File::open(entry.path())?
                        .take(16 * 1024 + 1)
                        .read_to_end(&mut bytes)?;
                    anyhow::ensure!(bytes.len() <= 16 * 1024, "oversized Blob intent");
                    let intent: CandidateWriteIntent = serde_json::from_slice(&bytes)?;
                    anyhow::ensure!(
                        intent.version == 1 && valid_digest(&intent.digest),
                        "invalid Blob intent"
                    );
                    validate_gc_owner(&intent.owner)?;
                    chrono::DateTime::parse_from_rfc3339(&intent.created_at)?;
                    Some(intent)
                } else {
                    None
                };
                if intent.is_none() && quarantine_digest(&name).is_none() {
                    return Ok(());
                }
                // Do not wait behind user work or a current writer. Its files
                // remain intact and can be considered by a later maintenance run.
                let Ok(mut database) = database.try_lock() else {
                    return Ok(());
                };
                let discarded =
                    self.recover_gc_entry(&mut database, &entry.path(), &name, intent)?;
                drop(database);
                for path in discarded {
                    if let Err(error) = fs::remove_file(path) {
                        budget.report("blob removal", error);
                    }
                }
                Ok(())
            })();
            if let Err(error) = result {
                budget.report("blob recovery", error);
            }
        }
    }

    fn recover_gc_entry(
        &self,
        database: &mut Database,
        path: &Path,
        name: &str,
        intent: Option<CandidateWriteIntent>,
    ) -> Result<Vec<PathBuf>> {
        let mut discarded = Vec::new();
        if let Some(digest) = quarantine_digest(name) {
            let final_path = safe_blob_path(&self.root, digest)?;
            let metadata_exists: bool = database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM managed_blob WHERE sha256 = ?1)",
                [digest],
                |row| row.get(0),
            )?;
            if metadata_exists {
                if !final_path.try_exists()? {
                    let parent = final_path.parent().context("Blob parent missing")?;
                    fs::create_dir_all(parent)?;
                    validate_gc_directory(parent)?;
                    fs::rename(path, &final_path)?;
                }
                // A new writer may already have recreated the final path. Do not
                // discard another potentially recoverable copy based on existence.
            } else if let Some(path) = quarantine_discard(path)? {
                discarded.push(path);
            }
            return Ok(discarded);
        }
        let (Some(intent_id), Some(intent)) = (candidate_intent_id(name), intent) else {
            return Ok(discarded);
        };
        let data_path = self
            .root
            .join("tmp")
            .join(format!("candidate-data-{intent_id}"));
        let final_path = safe_blob_path(&self.root, &intent.digest)?;
        let blob_id: Option<String> = database
            .connection()
            .query_row(
                "SELECT id FROM managed_blob WHERE sha256 = ?1",
                [&intent.digest],
                |row| row.get(0),
            )
            .optional()?;
        // A journal without committed metadata is not proof that a content-addressed
        // file belongs only to this write. Preserve both it and the unknown artifacts.
        let Some(blob_id) = blob_id else {
            return Ok(discarded);
        };
        if final_path.try_exists()? && data_path.try_exists()? {
            return Ok(discarded);
        }
        if !final_path.try_exists()? && data_path.try_exists()? {
            anyhow::ensure!(
                fs::symlink_metadata(&data_path)?.is_file(),
                "Blob candidate is not a regular file"
            );
            let parent = final_path.parent().context("Blob parent missing")?;
            fs::create_dir_all(parent)?;
            validate_gc_directory(parent)?;
            fs::rename(&data_path, &final_path)?;
        }
        if !final_path.try_exists()? {
            return Ok(discarded);
        }
        let references = managed_blob_reference_columns(database.connection())?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if blob_is_referenced(&transaction, &references, &blob_id)? {
            attach_gc_candidate(&transaction, &blob_id)?;
        } else {
            transaction.execute("UPDATE managed_blob SET gc_candidate_at=COALESCE(gc_candidate_at, ?2), gc_candidate_owner=COALESCE(gc_candidate_owner, ?3), updated_at=?2 WHERE id=?1",
                params![blob_id, intent.created_at, intent.owner])?;
        }
        transaction.commit()?;
        if let Some(path) = quarantine_discard(&data_path)? {
            discarded.push(path);
        }
        if let Some(path) = quarantine_discard(path)? {
            discarded.push(path);
        }
        Ok(discarded)
    }

    pub fn read_bytes(&self, database: &Database, blob_id: &str) -> Result<Vec<u8>> {
        #[cfg(test)]
        BLOB_READS.set(BLOB_READS.get() + 1);
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
                      SELECT 1 FROM action_execution
                      WHERE action_execution.result_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM context_manifest
                      WHERE context_manifest.rendered_payload_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM runtime_input_delivery
                      WHERE runtime_input_delivery.hermes_runtime_payload_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_execution_evidence
                      WHERE agent_run_execution_evidence.content_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_execution_evidence
                      WHERE agent_run_execution_evidence.input_blob_id = managed_blob.id
                         OR agent_run_execution_evidence.result_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_file_change_projection
                      WHERE agent_run_file_change_projection.details_blob_id = managed_blob.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_image
                      WHERE agent_run_image.content_blob_id = managed_blob.id
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
                  AND NOT EXISTS (SELECT 1 FROM action_execution WHERE result_blob_id = ?1)
                  AND NOT EXISTS (
                      SELECT 1 FROM context_manifest
                      WHERE rendered_payload_blob_id = ?1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM runtime_input_delivery
                      WHERE hermes_runtime_payload_blob_id = ?1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_execution_evidence
                      WHERE content_blob_id = ?1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_execution_evidence
                      WHERE input_blob_id = ?1 OR result_blob_id = ?1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_file_change_projection
                      WHERE details_blob_id = ?1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_image WHERE content_blob_id = ?1
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

    pub(crate) fn gc_candidates(
        &self,
        database: &Database,
        detached_before: &str,
        limit: usize,
    ) -> Result<Vec<(String, String)>> {
        chrono::DateTime::parse_from_rfc3339(detached_before)?;
        let candidates = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id, sha256 FROM managed_blob
                WHERE gc_candidate_at IS NOT NULL
                  AND datetime(gc_candidate_at) < datetime(?1)
                  AND gc_candidate_owner IN ('execution_lifecycle', 'file_change_projection', 'camp_deletion')
                ORDER BY gc_candidate_at, id
                LIMIT ?2
                "#,
            )?;
            statement
                .query_map(params![detached_before, limit.max(1) as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(candidates)
    }

    /// One reference recheck and rename under the existing database lock. The
    /// caller removes the uniquely named quarantine only after releasing it.
    pub(crate) fn collect_gc_candidate(
        &self,
        database: &mut Database,
        detached_before: &str,
        blob_id: &str,
        digest: &str,
    ) -> Result<Option<(String, Option<PathBuf>)>> {
        let references = managed_blob_reference_columns(database.connection())?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate_at: Option<String> = transaction
            .query_row(
                "SELECT gc_candidate_at FROM managed_blob WHERE id = ?1 AND sha256 = ?2 AND gc_candidate_owner IN ('execution_lifecycle', 'file_change_projection', 'camp_deletion')",
                params![blob_id, digest],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if candidate_at
            .as_deref()
            .is_none_or(|value| value >= detached_before)
        {
            transaction.commit()?;
            return Ok(None);
        }
        if blob_is_referenced(&transaction, &references, blob_id)? {
            attach_gc_candidate(&transaction, blob_id)?;
            transaction.commit()?;
            return Ok(None);
        }

        let path = safe_blob_path(&self.root, digest)?;
        let quarantine_dir = self.root.join("tmp");
        validate_gc_directory(&self.root)?;
        fs::create_dir_all(&quarantine_dir)?;
        validate_gc_directory(&quarantine_dir)?;
        if let Some(parent) = path.parent().filter(|parent| parent.exists()) {
            validate_gc_directory(parent)?;
        }
        let quarantine = quarantine_dir.join(format!("gc-{digest}-{}", Uuid::new_v4()));
        let moved = match fs::rename(&path, &quarantine) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        let deleted = transaction.execute(
            "DELETE FROM managed_blob WHERE id = ?1 AND gc_candidate_at < ?2",
            params![blob_id, detached_before],
        );
        match deleted {
            Ok(1) => {
                if let Err(error) = transaction.commit() {
                    if moved {
                        let _ = fs::rename(&quarantine, &path);
                    }
                    return Err(error.into());
                }
                return Ok(Some((blob_id.to_owned(), moved.then_some(quarantine))));
            }
            Ok(_) => {
                drop(transaction);
                if moved {
                    fs::rename(&quarantine, &path)?;
                }
            }
            Err(error) => {
                drop(transaction);
                if moved {
                    let _ = fs::rename(&quarantine, &path);
                }
                return Err(error.into());
            }
        }
        Ok(None)
    }

    #[cfg(test)]
    pub(crate) fn collect_gc_candidates_before(
        &self,
        database: &mut Database,
        cutoff: &str,
        limit: usize,
    ) -> Result<Vec<String>> {
        let mut collected = Vec::new();
        for (id, digest) in self.gc_candidates(database, cutoff, limit)? {
            if let Some((id, path)) = self.collect_gc_candidate(database, cutoff, &id, &digest)? {
                if let Some(path) = path {
                    fs::remove_file(path)?;
                }
                collected.push(id);
            }
        }
        Ok(collected)
    }
}

fn validate_gc_directory(path: &Path) -> Result<()> {
    anyhow::ensure!(
        fs::symlink_metadata(path)?.is_dir(),
        "Blob cleanup target is not an owned directory"
    );
    Ok(())
}

fn quarantine_digest(name: &str) -> Option<&str> {
    let tail = name.strip_prefix("gc-")?;
    let digest = tail.get(..64)?;
    if valid_digest(digest)
        && (tail.len() == 64
            || tail
                .get(64..)?
                .strip_prefix('-')
                .is_some_and(|id| Uuid::parse_str(id).is_ok()))
    {
        Some(digest)
    } else {
        None
    }
}

fn quarantine_discard(path: &Path) -> Result<Option<PathBuf>> {
    let discarded = path.with_file_name(format!("discard-{}", Uuid::new_v4()));
    match fs::rename(path, &discarded) {
        Ok(()) => Ok(Some(discarded)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn attach_gc_candidate(transaction: &Transaction<'_>, blob_id: &str) -> Result<()> {
    transaction.execute(
        "UPDATE managed_blob SET gc_candidate_at = NULL, gc_candidate_owner = NULL, updated_at = ?2 WHERE id = ?1",
        params![blob_id, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn detach_gc_candidate(
    transaction: &Connection,
    blob_id: &str,
    owner: &str,
    detached_at: &str,
) -> Result<()> {
    validate_gc_owner(owner)?;
    transaction.execute(
        "UPDATE managed_blob SET gc_candidate_at = ?2, gc_candidate_owner = ?3, updated_at = ?2 WHERE id = ?1",
        params![blob_id, detached_at, owner],
    )?;
    Ok(())
}

fn validate_gc_owner(owner: &str) -> Result<()> {
    if !matches!(
        owner,
        GC_OWNER_EXECUTION_LIFECYCLE | GC_OWNER_FILE_CHANGE_PROJECTION | GC_OWNER_CAMP_DELETION
    ) {
        anyhow::bail!("Managed Blob GC owner is invalid");
    }
    Ok(())
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn managed_blob_reference_columns(connection: &Connection) -> Result<Vec<(String, String)>> {
    let tables = {
        let mut statement = connection.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut references = Vec::new();
    for table in tables {
        let pragma = format!("PRAGMA foreign_key_list({})", quote_identifier(&table));
        let mut statement = connection.prepare(&pragma)?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        for row in rows {
            let (target, from, to) = row?;
            if target == "managed_blob" && to.as_deref().is_none_or(|value| value == "id") {
                references.push((table.clone(), from));
            }
        }
    }
    // This historical scalar reference predates the FK. It is still authoritative.
    let action_result_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('action_execution') WHERE name='result_blob_id')",
        [], |row| row.get(0),
    )?;
    if action_result_exists
        && !references
            .iter()
            .any(|(table, column)| table == "action_execution" && column == "result_blob_id")
    {
        references.push(("action_execution".into(), "result_blob_id".into()));
    }
    Ok(references)
}

// Called before the aggregate releases its actual references. This only selects IDs;
// the deletion transaction never opens, moves or removes files.
pub(crate) fn camp_blob_references(
    connection: &Connection,
    camp_id: &str,
    camp_agent_run_ids: &str,
) -> Result<std::collections::BTreeSet<String>> {
    // Legacy migration fixtures can delete Camps before candidate GC was introduced.
    let gc_available: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('managed_blob') WHERE name='gc_candidate_owner')
         AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='managed_blob' AND instr(sql, '''camp_deletion''')>0)", [], |row| row.get(0),
    )?;
    let mut ids = std::collections::BTreeSet::new();
    if !gc_available {
        return Ok(ids);
    }
    for (table, column) in managed_blob_reference_columns(connection)? {
        let scope = match table.as_str() {
            "agent_run_execution_evidence"
            | "agent_run_file_change_projection"
            | "agent_run_image"
            | "action_execution"
            | "runtime_input_delivery"
            | "context_manifest" => format!("agent_run_id IN ({camp_agent_run_ids})"),
            "native_session_bootstrap_evidence" => {
                "conversation_id IN (SELECT id FROM conversation WHERE camp_id=?1)".to_owned()
            }
            _ => continue, // Other owners are retained and protected by the final reference check.
        };
        let mut query = connection.prepare(&format!(
            "SELECT {} FROM {} WHERE {scope} AND {} IS NOT NULL",
            quote_identifier(&column),
            quote_identifier(&table),
            quote_identifier(&column)
        ))?;
        ids.extend(
            query
                .query_map([camp_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    Ok(ids)
}

fn blob_is_referenced(
    transaction: &Transaction<'_>,
    references: &[(String, String)],
    blob_id: &str,
) -> Result<bool> {
    for (table, column) in references {
        let sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE {} = ?1 LIMIT 1)",
            quote_identifier(table),
            quote_identifier(column)
        );
        if transaction.query_row(&sql, [blob_id], |row| row.get::<_, bool>(0))? {
            return Ok(true);
        }
    }
    Ok(false)
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

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn candidate_intent_id(name: &str) -> Option<&str> {
    let value = name
        .strip_prefix("candidate-intent-")?
        .strip_suffix(".json")?;
    Uuid::parse_str(value).ok().map(|_| value)
}

fn safe_blob_path(root: &Path, digest: &str) -> Result<PathBuf> {
    if !valid_digest(digest) {
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
    #[cfg(windows)]
    let _ = path;
    #[cfg(not(windows))]
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targeted_gc_uses_detach_time_and_rechecks_all_foreign_key_references() {
        let directory =
            std::env::temp_dir().join(format!("rovai-managed-blob-targeted-gc-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        let store = ManagedBlobStore::new(&directory);
        let unowned = store
            .put_bytes(&mut database, b"historical", "text/plain", "normal")
            .unwrap();
        let candidate = store
            .put_bytes_candidate(
                &mut database,
                b"replaceable",
                "text/plain",
                "normal",
                GC_OWNER_EXECUTION_LIFECYCLE,
            )
            .unwrap();
        let later_candidate = store
            .put_bytes_candidate(
                &mut database,
                b"later-replaceable",
                "text/plain",
                "normal",
                GC_OWNER_EXECUTION_LIFECYCLE,
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE managed_blob SET created_at = '2020-01-01T00:00:00Z', gc_candidate_at = '2026-09-22T00:00:00Z' WHERE id = ?1",
                [&candidate.id],
            )
            .unwrap();
        assert!(
            store
                .collect_gc_candidates_before(&mut database, "2026-09-21T00:00:00Z", 16,)
                .unwrap()
                .is_empty(),
            "the grace period starts when the authoritative reference is detached"
        );
        database
            .connection()
            .execute(
                "UPDATE managed_blob SET gc_candidate_at = '2026-09-20T00:00:00Z' WHERE id = ?1",
                [&later_candidate.id],
            )
            .unwrap();

        database
            .connection()
            .execute_batch(
                "CREATE TABLE managed_blob_gc_test_reference(
                    blob_id TEXT NOT NULL REFERENCES managed_blob(id)
                );",
            )
            .unwrap();
        database
            .connection()
            .execute(
                "INSERT INTO managed_blob_gc_test_reference(blob_id) VALUES (?1)",
                [&candidate.id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE managed_blob SET gc_candidate_at = '2026-09-19T00:00:00Z' WHERE id = ?1",
                [&candidate.id],
            )
            .unwrap();
        assert!(
            store
                .collect_gc_candidates_before(&mut database, "2026-09-23T00:00:00Z", 1,)
                .unwrap()
                .is_empty(),
            "an unexpected ManagedBlob foreign key must protect the candidate"
        );
        let marker_cleared: bool = database
            .connection()
            .query_row(
                "SELECT gc_candidate_at IS NULL FROM managed_blob WHERE id = ?1",
                [&candidate.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            marker_cleared,
            "a referenced candidate must leave the GC queue"
        );
        assert_eq!(
            store
                .collect_gc_candidates_before(&mut database, "2026-09-23T00:00:00Z", 1,)
                .unwrap(),
            vec![later_candidate.id],
            "a referenced head candidate must not starve later eligible work"
        );
        assert_eq!(
            store.read_bytes(&database, &candidate.id).unwrap(),
            b"replaceable"
        );

        database
            .connection()
            .execute("DELETE FROM managed_blob_gc_test_reference", [])
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        attach_gc_candidate(&transaction, &candidate.id).unwrap();
        transaction.commit().unwrap();
        assert!(
            store
                .collect_gc_candidates_before(&mut database, "2026-09-23T00:00:00Z", 16,)
                .unwrap()
                .is_empty(),
            "reattaching a Blob cancels pending collection"
        );

        let transaction = database.connection_mut().transaction().unwrap();
        detach_gc_candidate(
            &transaction,
            &candidate.id,
            GC_OWNER_EXECUTION_LIFECYCLE,
            "2026-09-20T00:00:00Z",
        )
        .unwrap();
        transaction.commit().unwrap();
        let selected = store
            .gc_candidates(&database, "2026-09-21T00:00:00Z", 16)
            .unwrap();
        assert_eq!(selected.len(), 1);
        // Selection and removal use separate short locks. A task can attach the
        // selected Blob between them; the removal transaction must recheck it.
        let transaction = database.connection_mut().transaction().unwrap();
        attach_gc_candidate(&transaction, &candidate.id).unwrap();
        transaction.commit().unwrap();
        assert!(
            store
                .collect_gc_candidate(
                    &mut database,
                    "2026-09-21T00:00:00Z",
                    &selected[0].0,
                    &selected[0].1
                )
                .unwrap()
                .is_none()
        );
        assert_eq!(
            store.read_bytes(&database, &candidate.id).unwrap(),
            b"replaceable"
        );
        let transaction = database.connection_mut().transaction().unwrap();
        detach_gc_candidate(
            &transaction,
            &candidate.id,
            GC_OWNER_EXECUTION_LIFECYCLE,
            "2026-09-20T00:00:00Z",
        )
        .unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            store
                .collect_gc_candidates_before(&mut database, "2026-09-21T00:00:00Z", 16,)
                .unwrap(),
            vec![candidate.id.clone()]
        );
        assert!(store.read_bytes(&database, &candidate.id).is_err());
        assert_eq!(
            store.read_bytes(&database, &unowned.id).unwrap(),
            b"historical"
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn gc_recovery_restores_rolled_back_quarantine_and_removes_committed_quarantine() {
        let directory =
            std::env::temp_dir().join(format!("rovai-managed-blob-gc-recovery-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        let store = ManagedBlobStore::new(&directory);
        let candidate = store
            .put_bytes_candidate(
                &mut database,
                b"recoverable",
                "text/plain",
                "normal",
                GC_OWNER_FILE_CHANGE_PROJECTION,
            )
            .unwrap();
        let final_path = safe_blob_path(&store.root, &candidate.sha256).unwrap();
        let temporary_dir = store.root.join("tmp");
        std::fs::create_dir_all(&temporary_dir).unwrap();
        let quarantine = temporary_dir.join(format!("gc-{}", candidate.sha256));

        let broken = temporary_dir.join(format!("candidate-intent-{}.json", Uuid::new_v4()));
        std::fs::write(&broken, b"{broken").unwrap();
        let staging = temporary_dir.join(format!("candidate-intent-write-{}", Uuid::new_v4()));
        std::fs::write(&staging, b"current writer").unwrap();
        let data = temporary_dir.join(format!("candidate-data-{}", Uuid::new_v4()));
        std::fs::write(&data, b"uncommitted data").unwrap();
        std::fs::rename(&final_path, &quarantine).unwrap();
        let guard = tokio::sync::Mutex::new(database);
        let writer = guard.try_lock().unwrap();
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(128, std::time::Duration::from_secs(2)),
        );
        assert!(
            quarantine.exists(),
            "maintenance does not wait for or interfere with a current writer"
        );
        assert_eq!(std::fs::read(&data).unwrap(), b"uncommitted data");
        drop(writer);
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(0, std::time::Duration::from_secs(2)),
        );
        assert!(
            quarantine.exists(),
            "an exhausted allowance does not process a file"
        );
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(128, std::time::Duration::from_secs(2)),
        );
        database = guard.into_inner();
        assert_eq!(
            store.read_bytes(&database, &candidate.id).unwrap(),
            b"recoverable"
        );
        assert_eq!(std::fs::read(&broken).unwrap(), b"{broken");
        assert_eq!(std::fs::read(&staging).unwrap(), b"current writer");
        assert_eq!(std::fs::read(&data).unwrap(), b"uncommitted data");
        assert!(!quarantine.exists());

        std::fs::write(&quarantine, b"retained previous copy").unwrap();
        let guard = tokio::sync::Mutex::new(database);
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(128, std::time::Duration::from_secs(2)),
        );
        database = guard.into_inner();
        assert_eq!(
            std::fs::read(&quarantine).unwrap(),
            b"retained previous copy"
        );
        assert_eq!(
            store.read_bytes(&database, &candidate.id).unwrap(),
            b"recoverable"
        );

        std::fs::rename(&final_path, &quarantine).unwrap();
        database
            .connection()
            .execute("DELETE FROM managed_blob WHERE id = ?1", [&candidate.id])
            .unwrap();
        let guard = tokio::sync::Mutex::new(database);
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(128, std::time::Duration::from_secs(2)),
        );
        database = guard.into_inner();
        assert!(!quarantine.exists());
        assert!(!final_path.exists());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn gc_recovery_preserves_unknown_and_malformed_candidate_write_artifacts() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-managed-blob-write-recovery-{}",
            Uuid::new_v4()
        ));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        let store = ManagedBlobStore::new(&directory);
        let bytes = b"interrupted candidate";
        let digest = format!("{:x}", Sha256::digest(bytes));
        let final_path = safe_blob_path(&store.root, &digest).unwrap();
        std::fs::create_dir_all(final_path.parent().unwrap()).unwrap();
        std::fs::write(&final_path, bytes).unwrap();
        let temporary_dir = store.root.join("tmp");
        std::fs::create_dir_all(&temporary_dir).unwrap();
        let intent_id = Uuid::new_v4();
        let intent_path = temporary_dir.join(format!("candidate-intent-{intent_id}.json"));
        std::fs::write(
            &intent_path,
            serde_json::to_vec(&CandidateWriteIntent {
                version: 1,
                digest,
                owner: GC_OWNER_EXECUTION_LIFECYCLE.to_string(),
                created_at: "2026-09-20T00:00:00Z".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        let guard = tokio::sync::Mutex::new(database);
        store.recover_gc_state(
            &guard,
            &mut MaintenanceBudget::new(128, std::time::Duration::from_secs(2)),
        );
        database = guard.into_inner();
        assert!(intent_path.exists());
        assert!(final_path.exists());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
