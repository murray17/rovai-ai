use std::{
    fs::{self, File},
    io::{Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(windows)]
use std::fs::OpenOptions;

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    camp_attachment::{
        CampAttachmentStore, DIRECTORY_MEDIA_TYPE, RuntimeAttachmentCopyReceipt,
        inspect_runtime_attachment_copy,
    },
    camp_id::CampId,
    command::canonical_json_digest,
    db::Database,
    message_delivery::settle_attachment_projection_failure,
};

pub const CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION: i64 = 4;
pub const CAMP_ATTACHMENT_VIEW_RECEIPT_VERSION: i64 = 2;
pub const RUNTIME_ATTACHMENT_AUTH_RECEIPT_VERSION: i64 = 1;
pub const MAX_CAMP_VIEW_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MAX_INSTANCE_VIEW_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const MAX_INSTANCE_STAGING_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_CONCURRENT_STAGING_OPERATIONS: i64 = 8;

const ROOT_MARKER: &str = ".runtime-camp-files-root.json";
const ROOT_LOCK: &str = ".runtime-camp-files.lock";
const MANAGED_V2_DIRECTORY: &str = ".managed-v2";
const LEGACY_ROOT_MARKER_SCHEMA_VERSION: i64 = 1;
const ROOT_MARKER_SCHEMA_VERSION: i64 = 2;
const INSTANCE_KEY_DOMAIN: &[u8] = b"rovai-runtime-camp-files-instance-v1\0";
const LEGACY_VIEW_NOT_REQUIRED_REVISION: i64 = -1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeFilesRootMarker {
    schema_version: i64,
    instance_key: String,
    data_dir_identity_digest: String,
    platform: String,
    root_identity_digest: String,
    created_at: String,
}

#[derive(Debug)]
pub struct CampAttachmentViewStore {
    root: PathBuf,
    root_identity_digest: String,
    instance_key: String,
    lock_file: File,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedCampAttachmentPublication {
    pub operation_id: String,
    pub camp_id: String,
    pub command_id: String,
    pub attachment_ids: Vec<String>,
}

#[derive(Debug)]
pub enum CampAttachmentPublicationStaging {
    None,
    Ready(PreparedCampAttachmentPublication),
    Copy(CampAttachmentPublicationCopyPlan),
}

#[derive(Debug, Clone)]
pub struct CampAttachmentPublicationCopyPlan {
    operation_id: String,
    camp_id: String,
    command_id: String,
    draft_revision: i64,
    operation_root: PathBuf,
    rows: Vec<AuthorityAttachmentRow>,
}

impl CampAttachmentPublicationCopyPlan {
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
}

#[derive(Debug)]
pub struct CopiedCampAttachmentPublication {
    plan: CampAttachmentPublicationCopyPlan,
    entries: Vec<CopiedPublicationEntry>,
}

#[derive(Debug)]
struct CopiedPublicationEntry {
    attachment_id: String,
    receipt: RuntimeAttachmentCopyReceipt,
    staging_identity_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedCampAttachmentCleanup {
    pub operation_id: String,
    pub camp_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticAttachmentEntryV1 {
    pub attachment_id: String,
    pub kind: String,
    pub byte_size: i64,
    pub file_count: i64,
    pub directory_count: i64,
    pub node_count: i64,
    pub content_digest: String,
    pub root_relative_payload_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampAttachmentViewReceiptV2 {
    pub schema_version: i64,
    pub camp_id: String,
    pub attachment_root_relative_path: String,
    pub catalog_revision: i64,
    pub catalog_entry_count: i64,
    pub semantic_catalog_digest: String,
    pub referenced_entries: Vec<SemanticAttachmentEntryV1>,
    pub referenced_entries_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CampAttachmentVisibilityMode {
    LiveAppendV1,
    GenerationFencedV1,
}

impl CampAttachmentVisibilityMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LiveAppendV1 => "live_append_v1",
            Self::GenerationFencedV1 => "generation_fenced_v1",
        }
    }

    pub fn compatibility_generation(self, generation: i64) -> Option<i64> {
        match self {
            Self::LiveAppendV1 => None,
            Self::GenerationFencedV1 => Some(generation),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeAttachmentAuthReceiptV1 {
    pub schema_version: i64,
    pub camp_id: String,
    pub published_attachment_root: String,
    pub root_identity_digest: String,
    pub dispatch_generation: i64,
    pub catalog_digest_at_dispatch: String,
    pub visibility_mode: String,
    pub compatibility_generation: Option<i64>,
    pub manifest_view_receipt_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampAttachmentRuntimeAuthorization {
    pub camp_id: String,
    pub attachment_root: PathBuf,
    pub root_identity_digest: String,
    pub generation: i64,
    pub catalog_digest: String,
    pub visibility_mode: CampAttachmentVisibilityMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReadyCampViewReceipt {
    generation: i64,
    root_relative_path: String,
    root_identity_digest: String,
    entry_count: i64,
    aggregate_bytes: i64,
    catalog_digest: String,
    catalog_revision: i64,
    semantic_catalog_digest: String,
    semantic_revision: i64,
    resolved_revision: i64,
    resolution_digest: String,
}

#[derive(Debug)]
struct CampAttachmentViewVerification {
    camp_id: String,
    root: PathBuf,
    receipt: ReadyCampViewReceipt,
    filesystem_ids: std::collections::BTreeSet<String>,
    entries: Vec<CommittedViewEntryRow>,
}

#[derive(Debug)]
pub struct CampAttachmentRuntimeAuthorizationVerification {
    view: CampAttachmentViewVerification,
    workspace: Option<PathBuf>,
    visibility_mode: CampAttachmentVisibilityMode,
}

impl CampAttachmentRuntimeAuthorizationVerification {
    pub fn verify(self) -> Result<VerifiedCampAttachmentRuntimeAuthorization> {
        if let Some(workspace) = self.workspace.as_deref() {
            let canonical_workspace = fs::canonicalize(workspace)
                .context("AgentRun workspace cannot be canonicalized")?;
            reject_overlap(&self.view.root, &canonical_workspace)?;
        }
        inspect_ready_camp_view(&self.view)?;
        Ok(VerifiedCampAttachmentRuntimeAuthorization { verification: self })
    }
}

#[derive(Debug)]
pub struct VerifiedCampAttachmentRuntimeAuthorization {
    verification: CampAttachmentRuntimeAuthorizationVerification,
}

#[derive(Debug)]
pub struct CampAttachmentPublicationCompletionVerification {
    operation_id: String,
    view: CampAttachmentViewVerification,
}

impl CampAttachmentPublicationCompletionVerification {
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }

    pub fn camp_id(&self) -> &str {
        &self.view.camp_id
    }

    pub fn verify(self) -> Result<VerifiedCampAttachmentPublicationCompletion> {
        inspect_ready_camp_view(&self.view)?;
        Ok(VerifiedCampAttachmentPublicationCompletion { verification: self })
    }
}

#[derive(Debug)]
pub struct VerifiedCampAttachmentPublicationCompletion {
    verification: CampAttachmentPublicationCompletionVerification,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthorityAttachmentRow {
    attachment_id: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    storage_path: PathBuf,
}

#[derive(Debug, Clone)]
struct CommittedViewEntryRow {
    attachment_id: String,
    kind: String,
    byte_size: u64,
    file_count: u64,
    directory_count: u64,
    node_count: u64,
    content_digest: String,
    authority_safe_leaf: String,
    root_relative_final_path: String,
    entry_identity_digest: String,
    media_type: String,
    authority_byte_size: u64,
    authority_content_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicalCatalogEntryReceipt<'a> {
    attachment_id: &'a str,
    kind: &'a str,
    byte_size: i64,
    file_count: i64,
    directory_count: i64,
    node_count: i64,
    content_digest: &'a str,
    authority_safe_leaf: &'a str,
    root_relative_final_path: &'a str,
    entry_identity_digest: &'a str,
    published_generation: i64,
    publication_operation_id: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticCatalogEntryReceipt<'a> {
    attachment_id: &'a str,
    kind: &'a str,
    byte_size: i64,
    file_count: i64,
    directory_count: i64,
    node_count: i64,
    content_digest: &'a str,
    root_relative_payload_path: String,
}

impl CampAttachmentViewStore {
    #[cfg(any(test, feature = "slow-tests"))]
    pub fn for_test(database: &Database) -> Result<Self> {
        let root = database.runtime_camp_files_root().to_path_buf();
        Self::for_test_root_with_identity(
            root,
            database
                .runtime_camp_files_root_identity_digest()
                .to_string(),
        )
    }

    #[cfg(any(test, feature = "slow-tests"))]
    pub fn for_isolated_test_root(root: &Path) -> Result<Self> {
        ensure_private_directory(root)?;
        let root = fs::canonicalize(root)?;
        let root_identity_digest = directory_identity_digest(&root)?;
        Self::for_test_root_with_identity(root, root_identity_digest)
    }

    #[cfg(any(test, feature = "slow-tests"))]
    fn for_test_root_with_identity(root: PathBuf, root_identity_digest: String) -> Result<Self> {
        ensure_private_directory(&root)?;
        let mut lock_file = private_open_read_write(&root.join(ROOT_LOCK))?;
        if !try_lock_exclusive(&lock_file)? {
            anyhow::bail!("test Runtime Files Root is already locked");
        }
        write_lock_owner(&mut lock_file)?;
        ensure_private_directory(&root.join(".staging"))?;
        ensure_private_directory(&root.join("camps"))?;
        Ok(Self {
            root,
            root_identity_digest,
            instance_key: "test-instance".to_string(),
            lock_file,
        })
    }

    #[cfg(any(test, feature = "slow-tests"))]
    #[doc(hidden)]
    pub fn mark_legacy_view_broken_for_test(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<()> {
        CampId::parse(camp_id)?;
        database.connection().execute(
            r#"
            UPDATE camp_attachment_view
            SET state = 'integrity_failed', last_error_code = 'legacy_fixture_broken'
            WHERE camp_id = ?1
            "#,
            [camp_id],
        )?;
        Ok(())
    }

    pub fn admit(root: &Path, data_dir: &Path, other_managed_roots: &[PathBuf]) -> Result<Self> {
        validate_normalized_absolute(root, "runtime_camp_files_root_invalid")?;
        validate_normalized_absolute(data_dir, "runtime_camp_files_root_invalid")?;
        reject_existing_symlink_components(root)?;
        reject_existing_symlink_components(data_dir)?;

        let canonical_data_dir = fs::canonicalize(data_dir)
            .context("runtime_camp_files_root_invalid: data_dir is unavailable")?;
        let instance_key = instance_key(&canonical_data_dir)?;
        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir()
                .context("runtime_camp_files_root_invalid: current user Home is unavailable")?;
            let canonical_home = fs::canonicalize(home)
                .context("runtime_camp_files_root_invalid: current user Home is unavailable")?;
            let expected = canonical_home
                .join(".rovai")
                .join("instances")
                .join(&instance_key)
                .join("runtime-files");
            if normalize_existing_or_lexical(root)? != normalize_existing_or_lexical(&expected)? {
                anyhow::bail!(
                    "runtime_camp_files_root_invalid: macOS root does not match the current Home and data-dir instance key"
                );
            }
            reject_overlap(root, &canonical_data_dir)?;
        }
        #[cfg(windows)]
        {
            let expected = canonical_data_dir.join("runtime-files");
            if normalize_existing_or_lexical(root)? != normalize_existing_or_lexical(&expected)? {
                anyhow::bail!(
                    "runtime_camp_files_root_invalid: Windows root must be data_dir\\runtime-files"
                );
            }
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        reject_overlap(root, &canonical_data_dir)?;
        for managed_root in other_managed_roots {
            validate_normalized_absolute(managed_root, "runtime_camp_files_root_invalid")?;
            reject_existing_symlink_components(managed_root)?;
            reject_overlap(root, managed_root)?;
        }

        reject_runtime_root_marker_ancestor(root)?;

        let canonical_root = crate::platform::private_storage::prepare_private_directory(root)
            .context("runtime_camp_files_root_invalid: cannot create or admit root")?;
        reject_existing_symlink_components(root)?;
        set_directory_mode(&canonical_root, 0o700)?;
        validate_current_user_local_root(&canonical_root)?;
        reject_nested_runtime_root_markers(&canonical_root)?;
        #[cfg(not(windows))]
        reject_overlap(&canonical_root, &canonical_data_dir)?;

        let lock_path = canonical_root.join(ROOT_LOCK);
        let mut lock_file = private_open_read_write(&lock_path)?;
        if !try_lock_exclusive(&lock_file)? {
            anyhow::bail!("runtime_camp_files_root_locked: another Core owns this root");
        }

        let data_dir_identity_digest = directory_identity_digest(&canonical_data_dir)?;
        let root_identity_digest = directory_identity_digest(&canonical_root)?;
        admit_runtime_root_marker(
            &canonical_root,
            &instance_key,
            &data_dir_identity_digest,
            &root_identity_digest,
        )?;
        write_lock_owner(&mut lock_file)?;
        ensure_private_directory(&canonical_root.join(".staging"))?;
        ensure_private_directory(&canonical_root.join("camps"))?;
        Ok(Self {
            root: canonical_root,
            root_identity_digest,
            instance_key,
            lock_file,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn root_identity_digest(&self) -> &str {
        &self.root_identity_digest
    }

    pub fn instance_key(&self) -> &str {
        &self.instance_key
    }

    pub fn reconcile(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
    ) -> Result<()> {
        self.recover_incomplete_operations(database)?;
        let camp_ids = {
            let mut statement = database
                .connection()
                .prepare("SELECT id FROM camp ORDER BY id")?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        self.remove_orphan_camp_directories(database, &camp_ids)?;
        for camp_id in camp_ids {
            if let Err(error) = self.reconcile_camp(database, attachment_store, &camp_id) {
                let Some(error_code) =
                    fail_closed_camp_reconciliation_error(database.connection(), &camp_id)?
                else {
                    return Err(error);
                };
                eprintln!(
                    "Camp {camp_id} Published Attachment View remains fail closed after startup reconciliation: {error_code}"
                );
            }
        }
        Ok(())
    }

    pub fn ensure_empty_camp_ready(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        CampId::parse(camp_id)?;
        let published_count: i64 = database.connection().query_row(
            "SELECT COUNT(*) FROM message_attachment WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        if published_count != 0 {
            anyhow::bail!(
                "camp_attachment_view_not_ready: published entries require reconciliation"
            );
        }
        let attachment_root = self.prepare_camp_directories(camp_id)?;
        set_directory_mode(&attachment_root, 0o500)?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            INSERT INTO camp_attachment_view(
                camp_id, state, generation, root_relative_path,
                root_identity_digest, entry_count, aggregate_bytes,
                catalog_digest, catalog_revision, semantic_catalog_digest,
                active_operation_id, last_error_code,
                created_at, updated_at
            ) VALUES (?1, 'ready', 1, ?2, ?3, 0, 0, ?4, 0, ?4, NULL, NULL, ?5, ?5)
            ON CONFLICT(camp_id) DO UPDATE SET
                state = 'ready', generation = MAX(generation, 1),
                root_relative_path = excluded.root_relative_path,
                root_identity_digest = excluded.root_identity_digest,
                entry_count = 0, aggregate_bytes = 0,
                catalog_digest = excluded.catalog_digest,
                catalog_revision = 0,
                semantic_catalog_digest = excluded.semantic_catalog_digest,
                active_operation_id = NULL, last_error_code = NULL,
                updated_at = excluded.updated_at
            "#,
            params![
                camp_id,
                camp_attachment_root_relative(camp_id),
                self.root_identity_digest,
                empty_catalog_digest()?,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn plan_publication(
        &self,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
        draft_revision: i64,
    ) -> Result<CampAttachmentPublicationStaging> {
        CampId::parse(camp_id)?;
        Uuid::parse_str(command_id).context("publication command ID must be a UUID")?;
        let existing_operation = database
            .connection()
            .query_row(
                r#"
                SELECT id, status FROM camp_attachment_view_operation
                WHERE kind = 'publish' AND command_id = ?1 AND camp_id = ?2
                "#,
                params![command_id, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((operation_id, status)) = existing_operation {
            if status == "staged" {
                return self
                    .load_prepared_publication(database.connection(), &operation_id)
                    .map(CampAttachmentPublicationStaging::Ready);
            }
            if status == "rolled_back" {
                let staging = self.staging_operation_root(&operation_id)?;
                if path_entry_exists(&staging)? {
                    anyhow::bail!(
                        "camp_attachment_view_recovery_required: rolled-back operation retained staging"
                    );
                }
                database.connection().execute(
                    "DELETE FROM camp_attachment_view_operation WHERE id = ?1 AND status = 'rolled_back'",
                    [&operation_id],
                )?;
            } else if status == "recovery_required" {
                anyhow::bail!("camp_attachment_view_recovery_required");
            } else if status == "committed" {
                self.complete_publication(database, &operation_id)?;
                return Ok(CampAttachmentPublicationStaging::None);
            } else if status == "completed" {
                return Ok(CampAttachmentPublicationStaging::None);
            } else {
                anyhow::bail!("camp_attachment_view_busy");
            }
        }

        let rows = load_prepared_authority_rows(database.connection(), camp_id)?;
        if rows.is_empty() {
            self.verify_camp_ready_receipt(database, camp_id)?;
            return Ok(CampAttachmentPublicationStaging::None);
        }
        let requested_bytes = rows.iter().try_fold(0_u64, |total, row| {
            total
                .checked_add(row.byte_size)
                .context("publication byte total overflow")
        })?;
        self.check_publication_quotas(database.connection(), camp_id, requested_bytes)?;
        let operation_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let conflicting_status = transaction
            .query_row(
                r#"
                SELECT status FROM camp_attachment_view_operation
                WHERE camp_id = ?1 AND kind = 'publish'
                  AND status NOT IN ('completed','rolled_back')
                ORDER BY created_at, id
                LIMIT 1
                "#,
                [camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if conflicting_status.as_deref() == Some("recovery_required") {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        if conflicting_status.is_some() {
            anyhow::bail!("camp_attachment_view_busy");
        }
        let current_revision: i64 = transaction.query_row(
            "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        if current_revision != draft_revision {
            anyhow::bail!("draft_changed");
        }
        transaction.execute(
            r#"
            INSERT INTO camp_attachment_view_operation(
                id, camp_id, kind, status, command_id, draft_revision,
                reserved_bytes, error_code, created_at, updated_at, completed_at
            ) VALUES (?1, ?2, 'publish', 'copying', ?3, ?4, ?5, NULL, ?6, ?6, NULL)
            "#,
            params![
                operation_id,
                camp_id,
                command_id,
                draft_revision,
                requested_bytes as i64,
                now
            ],
        )?;
        for row in &rows {
            transaction.execute(
                r#"
                INSERT INTO camp_attachment_view_operation_entry(
                    operation_id, attachment_id, state, media_type,
                    expected_byte_size, expected_content_digest,
                    authority_storage_path, authority_safe_leaf,
                    kind, file_count, directory_count, node_count,
                    root_relative_staging_path, root_relative_final_path,
                    staging_identity_digest, final_identity_digest,
                    created_at, updated_at
                ) VALUES (
                    ?1, ?2, 'planned', ?3, ?4, ?5, ?6, NULL,
                    NULL, NULL, NULL, NULL, ?7, ?8, NULL, NULL, ?9, ?9
                )
                "#,
                params![
                    operation_id,
                    row.attachment_id,
                    row.media_type,
                    row.byte_size as i64,
                    row.content_digest,
                    row.storage_path.to_string_lossy(),
                    staging_entry_relative(&operation_id, &row.attachment_id),
                    final_entry_relative(camp_id, &row.attachment_id),
                    now,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(CampAttachmentPublicationStaging::Copy(
            CampAttachmentPublicationCopyPlan {
                operation_root: self.staging_operation_root(&operation_id)?,
                operation_id,
                camp_id: camp_id.to_string(),
                command_id: command_id.to_string(),
                draft_revision,
                rows,
            },
        ))
    }

    pub fn plan_queued_publication(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<Option<CampAttachmentPublicationCopyPlan>> {
        CampId::parse(camp_id)?;
        let transaction = database.connection_mut().transaction()?;
        let head = transaction
            .query_row(
                r#"
                SELECT id, command_id, COALESCE(draft_revision, 0), status
                FROM camp_attachment_view_operation
                WHERE camp_id = ?1 AND kind = 'publish'
                  AND resolution_state = 'unresolved'
                ORDER BY semantic_revision, created_at, id
                LIMIT 1
                "#,
                [camp_id],
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
        let Some((operation_id, command_id, draft_revision, status)) = head else {
            transaction.commit()?;
            return Ok(None);
        };
        if !matches!(status.as_str(), "planned" | "recovery_required") {
            anyhow::bail!("camp_attachment_view_busy");
        }
        let rows = load_operation_authority_rows(&transaction, &operation_id)?;
        if rows.is_empty() {
            anyhow::bail!("camp_attachment_view_recovery_required: publication has no entries");
        }
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'copying', error_code = NULL, updated_at = ?2
            WHERE id = ?1 AND status IN ('planned','recovery_required')
              AND resolution_state = 'unresolved'
            "#,
            params![operation_id, chrono::Utc::now().to_rfc3339()],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_busy");
        }
        transaction.commit()?;
        Ok(Some(CampAttachmentPublicationCopyPlan {
            operation_root: self.staging_operation_root(&operation_id)?,
            operation_id,
            camp_id: camp_id.to_string(),
            command_id,
            draft_revision,
            rows,
        }))
    }

    pub fn copy_publication(
        attachment_store: &CampAttachmentStore,
        plan: CampAttachmentPublicationCopyPlan,
    ) -> Result<CopiedCampAttachmentPublication> {
        ensure_private_directory(&plan.operation_root)?;
        #[cfg(test)]
        pause_publication_copy_for_test(&plan.operation_id);
        let mut entries = Vec::with_capacity(plan.rows.len());
        for row in &plan.rows {
            let entry_root = plan.operation_root.join(&row.attachment_id);
            let payload = entry_root.join("payload");
            ensure_private_directory(&entry_root)?;
            ensure_private_directory(&payload)?;
            let receipt = attachment_store.copy_verified_authority_attachment_for_runtime(
                &row.storage_path,
                &row.media_type,
                row.byte_size,
                &row.content_digest,
                &payload,
            )?;
            make_staging_entry_private(&entry_root)?;
            sync_tree(&entry_root)?;
            entries.push(CopiedPublicationEntry {
                attachment_id: row.attachment_id.clone(),
                receipt,
                staging_identity_digest: entry_identity_digest(&entry_root)?,
            });
        }
        sync_directory(&plan.operation_root)?;
        Ok(CopiedCampAttachmentPublication { plan, entries })
    }

    pub fn finish_publication_staging(
        &self,
        database: &mut Database,
        copied: CopiedCampAttachmentPublication,
    ) -> Result<PreparedCampAttachmentPublication> {
        let CopiedCampAttachmentPublication { plan, entries } = copied;
        let transaction = database.connection_mut().transaction()?;
        let operation: (String, String, Option<i64>, String, String) = transaction.query_row(
            r#"
            SELECT status, command_id, draft_revision, camp_id, source_kind
            FROM camp_attachment_view_operation WHERE id = ?1 AND kind = 'publish'
            "#,
            [&plan.operation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
        if operation.0 != "copying"
            || operation.1 != plan.command_id
            || operation.3 != plan.camp_id
            || (operation.4 == "legacy" && operation.2 != Some(plan.draft_revision))
        {
            anyhow::bail!("camp_attachment_view_recovery_required: CopyPlan journal changed");
        }
        if operation.4 == "legacy" {
            let current_revision: i64 = transaction.query_row(
                "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                [&plan.camp_id],
                |row| row.get(0),
            )?;
            if current_revision != plan.draft_revision
                || load_prepared_authority_rows(&transaction, &plan.camp_id)? != plan.rows
            {
                anyhow::bail!("draft_changed");
            }
        } else if load_operation_authority_rows(&transaction, &plan.operation_id)? != plan.rows {
            anyhow::bail!("camp_attachment_view_recovery_required: Authority journal changed");
        }
        if entries.len() != plan.rows.len()
            || entries
                .iter()
                .zip(&plan.rows)
                .any(|(entry, row)| entry.attachment_id != row.attachment_id)
        {
            anyhow::bail!("camp_attachment_view_recovery_required: copied Entry set changed");
        }
        for entry in &entries {
            persist_copied_operation_entry(
                &transaction,
                &plan.operation_id,
                &entry.attachment_id,
                &entry.receipt,
                &entry.staging_identity_digest,
            )?;
        }
        let changed = transaction.execute(
            "UPDATE camp_attachment_view_operation SET status = 'staged', updated_at = ?2 WHERE id = ?1 AND status = 'copying'",
            params![plan.operation_id, chrono::Utc::now().to_rfc3339()],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        transaction.commit()?;
        Ok(PreparedCampAttachmentPublication {
            operation_id: plan.operation_id,
            camp_id: plan.camp_id,
            command_id: plan.command_id,
            attachment_ids: plan.rows.into_iter().map(|row| row.attachment_id).collect(),
        })
    }

    #[cfg(test)]
    pub fn stage_publication(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
        command_id: &str,
        draft_revision: i64,
    ) -> Result<Option<PreparedCampAttachmentPublication>> {
        let plan = self.plan_publication(database, camp_id, command_id, draft_revision)?;
        match plan {
            CampAttachmentPublicationStaging::None => Ok(None),
            CampAttachmentPublicationStaging::Ready(publication) => Ok(Some(publication)),
            CampAttachmentPublicationStaging::Copy(plan) => {
                let operation_id = plan.operation_id.clone();
                let result = match Self::copy_publication(attachment_store, plan) {
                    Ok(copied) => self.finish_publication_staging(database, copied),
                    Err(error) => Err(error).context("camp_attachment_view_source_invalid"),
                };
                match result {
                    Ok(publication) => Ok(Some(publication)),
                    Err(error) => {
                        self.rollback_publication(
                            database,
                            &operation_id,
                            "camp_attachment_view_source_invalid",
                        )?;
                        Err(error)
                    }
                }
            }
        }
    }

    pub fn promote_publication(
        &self,
        database: &mut Database,
        publication: &PreparedCampAttachmentPublication,
    ) -> Result<()> {
        self.verify_publication_state(database.connection(), publication, "gated")?;
        let attachment_root = self.prepare_camp_directories(&publication.camp_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            INSERT INTO camp_attachment_view(
                camp_id, state, generation, root_relative_path,
                root_identity_digest, entry_count, aggregate_bytes,
                catalog_digest, catalog_revision, semantic_catalog_digest,
                active_operation_id, last_error_code,
                created_at, updated_at
            ) VALUES (?1, 'mutating', 1, ?2, ?3, 0, 0, ?4, 0, ?4, ?5, NULL, ?6, ?6)
            ON CONFLICT(camp_id) DO UPDATE SET
                state = 'mutating', active_operation_id = excluded.active_operation_id,
                last_error_code = NULL, updated_at = excluded.updated_at
            "#,
            params![
                publication.camp_id,
                camp_attachment_root_relative(&publication.camp_id),
                self.root_identity_digest,
                empty_catalog_digest()?,
                publication.operation_id,
                now,
            ],
        )?;
        database.connection().execute(
            "UPDATE camp_attachment_view_operation SET status = 'promoting', updated_at = ?2 WHERE id = ?1 AND status = 'gated'",
            params![publication.operation_id, now],
        )?;
        set_directory_mode(&attachment_root, 0o700)?;
        let promote_result = (|| -> Result<()> {
            for attachment_id in &publication.attachment_ids {
                validate_attachment_id(attachment_id)?;
                let source = self.root.join(staging_entry_relative(
                    &publication.operation_id,
                    attachment_id,
                ));
                let destination = attachment_root.join(attachment_id);
                if destination.exists() {
                    anyhow::bail!("Camp Attachment View destination already exists");
                }
                prepare_runtime_entry_for_atomic_promote(&source)?;
                fs::rename(&source, &destination)
                    .context("camp_attachment_view_storage_unavailable: atomic promote failed")?;
                set_directory_mode(&destination, 0o500)?;
                let final_identity_digest = entry_identity_digest(&destination)?;
                let changed = database.connection().execute(
                    r#"
                    UPDATE camp_attachment_view_operation_entry
                    SET state = 'promoted', final_identity_digest = ?3, updated_at = ?4
                    WHERE operation_id = ?1 AND attachment_id = ?2 AND state = 'copied'
                    "#,
                    params![
                        publication.operation_id,
                        attachment_id,
                        final_identity_digest,
                        chrono::Utc::now().to_rfc3339(),
                    ],
                )?;
                if changed != 1 {
                    anyhow::bail!("camp_attachment_view_recovery_required");
                }
            }
            sync_directory(&attachment_root)?;
            Ok(())
        })();
        let restriction_result = set_directory_mode(&attachment_root, 0o500);
        if let Err(error) = promote_result {
            let _ = restriction_result;
            self.rollback_publication(
                database,
                &publication.operation_id,
                "camp_attachment_view_publish_failed",
            )?;
            return Err(error);
        }
        restriction_result?;
        let changed = database.connection().execute(
            "UPDATE camp_attachment_view_operation SET status = 'promoted', updated_at = ?2 WHERE id = ?1 AND status = 'promoting'",
            params![publication.operation_id, chrono::Utc::now().to_rfc3339()],
        )?;
        if changed != 1 {
            self.rollback_publication(
                database,
                &publication.operation_id,
                "camp_attachment_view_recovery_required",
            )?;
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        Ok(())
    }

    pub fn gate_publication(
        &self,
        database: &mut Database,
        publication: &PreparedCampAttachmentPublication,
    ) -> Result<()> {
        self.verify_publication_state(database.connection(), publication, "staged")?;
        let source_kind: String = database.connection().query_row(
            "SELECT source_kind FROM camp_attachment_view_operation WHERE id = ?1",
            [&publication.operation_id],
            |row| row.get(0),
        )?;
        if source_kind == "legacy"
            && !self.publication_matches_current_draft(database.connection(), publication)?
        {
            self.rollback_publication(database, &publication.operation_id, "draft_changed")?;
            anyhow::bail!("draft_changed");
        }
        let changed = database.connection().execute(
            "UPDATE camp_attachment_view_operation SET status = 'gated', updated_at = ?2 WHERE id = ?1 AND status = 'staged'",
            params![publication.operation_id, chrono::Utc::now().to_rfc3339()],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_busy");
        }
        Ok(())
    }

    fn publication_matches_current_draft(
        &self,
        connection: &Connection,
        publication: &PreparedCampAttachmentPublication,
    ) -> Result<bool> {
        let draft_revision = connection
            .query_row(
                "SELECT draft_revision FROM camp_attachment_view_operation WHERE id = ?1 AND camp_id = ?2 AND kind = 'publish'",
                params![publication.operation_id, publication.camp_id],
                |row| row.get::<_, Option<i64>>(0),
            )?
            .context("camp_attachment_view_recovery_required: publish operation has no Draft revision")?;
        let current_revision = connection
            .query_row(
                "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                [&publication.camp_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if current_revision != Some(draft_revision) {
            return Ok(false);
        }
        let current_attachment_ids =
            load_prepared_authority_rows(connection, &publication.camp_id)?
                .into_iter()
                .map(|row| row.attachment_id)
                .collect::<Vec<_>>();
        Ok(current_attachment_ids == publication.attachment_ids)
    }

    pub fn prepare_publication_completion(
        &self,
        database: &mut Database,
        operation_id: &str,
    ) -> Result<CampAttachmentPublicationCompletionVerification> {
        validate_operation_id(operation_id)?;
        let (camp_id, operation_kind): (String, String) = database.connection().query_row(
            "SELECT camp_id, kind FROM camp_attachment_view_operation WHERE id = ?1 AND status = 'committed'",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let preparation = (|| {
            let operation_attachment_ids =
                load_all_operation_attachment_ids(database.connection(), operation_id)?
                    .into_iter()
                    .collect::<std::collections::BTreeSet<_>>();
            if operation_attachment_ids.is_empty() && operation_kind != "controlled_rebuild" {
                anyhow::bail!(
                    "camp_attachment_view_recovery_required: committed publication has no entries"
                );
            }
            let mut view = prepare_ready_camp_view_verification(
                database.connection(),
                &self.root,
                &self.root_identity_digest,
                &camp_id,
            )?;
            view.entries
                .retain(|entry| operation_attachment_ids.contains(&entry.attachment_id));
            if view.entries.len() != operation_attachment_ids.len() {
                anyhow::bail!(
                    "camp_attachment_view_recovery_required: committed publication entries are incomplete"
                );
            }
            Ok(CampAttachmentPublicationCompletionVerification {
                operation_id: operation_id.to_string(),
                view,
            })
        })();
        match preparation {
            Ok(verification) => Ok(verification),
            Err(error) => {
                self.fail_publication_completion(database, operation_id, &camp_id)?;
                Err(error).context("camp_attachment_view_integrity_failed")
            }
        }
    }

    pub fn complete_verified_publication(
        &self,
        database: &mut Database,
        verified: VerifiedCampAttachmentPublicationCompletion,
    ) -> Result<()> {
        let verification = verified.verification;
        confirm_ready_camp_view(database.connection(), &verification.view)?;
        let operation_id = verification.operation_id;
        let camp_id = verification.view.camp_id;
        let operation_camp_id: String = database.connection().query_row(
            "SELECT camp_id FROM camp_attachment_view_operation WHERE id = ?1 AND status = 'committed'",
            [&operation_id],
            |row| row.get(0),
        )?;
        if operation_camp_id != camp_id {
            anyhow::bail!("camp_attachment_view_recovery_required: publication Camp changed");
        }
        self.remove_operation_staging(database.connection(), &operation_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'completed', resolution_state = 'available',
                reserved_bytes = 0, completed_at = ?2, updated_at = ?2
            WHERE id = ?1 AND status = 'committed'
            "#,
            params![operation_id, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required: operation was not committed");
        }
        Ok(())
    }

    pub fn fail_publication_completion(
        &self,
        database: &mut Database,
        operation_id: &str,
        camp_id: &str,
    ) -> Result<()> {
        validate_operation_id(operation_id)?;
        CampId::parse(camp_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            UPDATE camp_attachment_view
            SET state = 'integrity_failed', active_operation_id = ?2,
                last_error_code = 'camp_attachment_view_integrity_failed',
                updated_at = ?3
            WHERE camp_id = ?1
            "#,
            params![camp_id, operation_id, now],
        )?;
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'recovery_required',
                error_code = 'camp_attachment_view_integrity_failed',
                updated_at = ?2
            WHERE id = ?1 AND camp_id = ?3 AND status = 'committed'
            "#,
            params![operation_id, now, camp_id],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required: operation was not committed");
        }
        Ok(())
    }

    pub fn complete_publication(&self, database: &mut Database, operation_id: &str) -> Result<()> {
        let verification = self.prepare_publication_completion(database, operation_id)?;
        let camp_id = verification.camp_id().to_string();
        match verification.verify() {
            Ok(verified) => self.complete_verified_publication(database, verified),
            Err(error) => {
                self.fail_publication_completion(database, operation_id, &camp_id)?;
                Err(error).context("camp_attachment_view_integrity_failed")
            }
        }
    }

    pub fn finish_semantic_publication(
        &self,
        database: &mut Database,
        operation_id: &str,
    ) -> Result<()> {
        validate_operation_id(operation_id)?;
        let resolution_state: String = database.connection().query_row(
            "SELECT resolution_state FROM camp_attachment_view_operation WHERE id = ?1 AND status = 'committed'",
            [operation_id],
            |row| row.get(0),
        )?;
        if resolution_state != "available" {
            anyhow::bail!("camp_attachment_view_recovery_required: publication is unresolved");
        }
        self.remove_operation_staging(database.connection(), operation_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'completed', completed_at = ?2, updated_at = ?2
            WHERE id = ?1 AND status = 'committed' AND resolution_state = 'available'
            "#,
            params![operation_id, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        Ok(())
    }

    pub fn resolve_semantic_publication_success(
        &self,
        database: &mut Database,
        operation_id: &str,
    ) -> Result<Vec<String>> {
        let transaction = database.connection_mut().transaction()?;
        let delivery_ids = resolve_semantic_publication_success(&transaction, operation_id)?;
        transaction.commit()?;
        Ok(delivery_ids)
    }

    pub fn resolve_semantic_publication_terminal_failure(
        &self,
        database: &mut Database,
        operation_id: &str,
        failure_code: &str,
    ) -> Result<Vec<(String, String)>> {
        validate_operation_id(operation_id)?;
        if failure_code.trim().is_empty() {
            anyhow::bail!("attachment publication terminal failure requires a code");
        }
        let status: String = database.connection().query_row(
            "SELECT status FROM camp_attachment_view_operation WHERE id = ?1 AND resolution_state = 'unresolved'",
            [operation_id],
            |row| row.get(0),
        )?;
        if matches!(status.as_str(), "promoting" | "promoted" | "committing") {
            self.rollback_publication_inner(
                database,
                operation_id,
                "attachment_projection_failed",
            )?;
        }
        self.remove_operation_staging(database.connection(), operation_id)?;
        let transaction = database.connection_mut().transaction()?;
        let recipients = resolve_semantic_publication_terminal_failure(
            &transaction,
            operation_id,
            failure_code,
        )?;
        transaction.commit()?;
        Ok(recipients)
    }

    pub fn mark_semantic_publication_recovery_required(
        &self,
        database: &mut Database,
        operation_id: &str,
        error_code: &str,
    ) -> Result<()> {
        validate_operation_id(operation_id)?;
        let status: String = database.connection().query_row(
            "SELECT status FROM camp_attachment_view_operation WHERE id = ?1 AND resolution_state = 'unresolved'",
            [operation_id],
            |row| row.get(0),
        )?;
        if matches!(status.as_str(), "promoting" | "promoted" | "committing") {
            self.rollback_publication_inner(
                database,
                operation_id,
                "camp_attachment_view_recovery_required",
            )?;
        }
        if matches!(
            status.as_str(),
            "planned" | "copying" | "staged" | "gated" | "promoting" | "promoted" | "committing"
        ) {
            self.remove_operation_staging(database.connection(), operation_id)?;
            database.connection().execute(
                r#"
                UPDATE camp_attachment_view_operation_entry
                SET state = 'planned', authority_safe_leaf = NULL, kind = NULL,
                    file_count = NULL, directory_count = NULL, node_count = NULL,
                    staging_identity_digest = NULL, final_identity_digest = NULL,
                    updated_at = ?2
                WHERE operation_id = ?1 AND state IN ('planned','copied','promoted','rolled_back')
                "#,
                params![operation_id, chrono::Utc::now().to_rfc3339()],
            )?;
        }
        let now = chrono::Utc::now().to_rfc3339();
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'recovery_required', error_code = ?2, updated_at = ?3
            WHERE id = ?1 AND resolution_state = 'unresolved'
              AND status IN ('planned','copying','staged','gated','promoting',
                             'promoted','committing','rolled_back','recovery_required')
            "#,
            params![operation_id, error_code, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        database.connection().execute(
            r#"
            UPDATE message_attachment
            SET runtime_projection_state = 'recovery_required'
            WHERE publication_operation_id = ?1
              AND runtime_projection_state = 'pending'
            "#,
            [operation_id],
        )?;
        Ok(())
    }

    pub fn rollback_publication(
        &self,
        database: &mut Database,
        operation_id: &str,
        error_code: &str,
    ) -> Result<()> {
        let result = self.rollback_publication_inner(database, operation_id, error_code);
        if let Err(error) = result {
            let now = chrono::Utc::now().to_rfc3339();
            let camp_id = database
                .connection()
                .query_row(
                    "SELECT camp_id FROM camp_attachment_view_operation WHERE id = ?1",
                    [operation_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            database.connection().execute(
                r#"
                UPDATE camp_attachment_view_operation
                SET status = 'recovery_required', error_code = ?2, updated_at = ?3
                WHERE id = ?1 AND status <> 'completed'
                "#,
                params![operation_id, error_code, now],
            )?;
            if let Some(camp_id) = camp_id {
                database.connection().execute(
                    r#"
                    UPDATE camp_attachment_view
                    SET state = 'integrity_failed', active_operation_id = ?2,
                        last_error_code = 'camp_attachment_view_recovery_required',
                        updated_at = ?3
                    WHERE camp_id = ?1
                    "#,
                    params![camp_id, operation_id, now],
                )?;
            }
            return Err(error).context("camp_attachment_view_recovery_required");
        }
        Ok(())
    }

    fn rollback_publication_inner(
        &self,
        database: &mut Database,
        operation_id: &str,
        error_code: &str,
    ) -> Result<()> {
        validate_operation_id(operation_id)?;
        let operation = database
            .connection()
            .query_row(
                "SELECT camp_id, status, kind FROM camp_attachment_view_operation WHERE id = ?1",
                [operation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((camp_id, status, kind)) = operation else {
            return Ok(());
        };
        if matches!(status.as_str(), "committed" | "completed") {
            return Ok(());
        }
        database.connection().execute(
            "UPDATE camp_attachment_view_operation SET status = 'rolling_back', error_code = ?2, updated_at = ?3 WHERE id = ?1",
            params![operation_id, error_code, chrono::Utc::now().to_rfc3339()],
        )?;
        let operation_entries =
            load_operation_cleanup_entries(database.connection(), operation_id)?;
        let attachment_root = self.camp_attachment_root(&camp_id)?;
        if attachment_root.exists() {
            set_directory_mode(&attachment_root, 0o700)?;
            let cleanup = (|| -> Result<()> {
                for (attachment_id, staging_identity, final_identity) in
                    operation_entries.iter().rev()
                {
                    let final_path = attachment_root.join(attachment_id);
                    let staging_path = self
                        .staging_operation_root(operation_id)?
                        .join(attachment_id);
                    if path_entry_exists(&final_path)? {
                        let actual_identity = entry_identity_digest(&final_path)?;
                        if final_entry_is_committed_to_other_operation(
                            database.connection(),
                            &camp_id,
                            attachment_id,
                            operation_id,
                            &actual_identity,
                        )? {
                            continue;
                        }
                        if path_entry_exists(&staging_path)? {
                            anyhow::bail!(
                                "camp_attachment_view_recovery_required: staging and final targets both exist"
                            );
                        }
                        let owned_identity =
                            final_identity.as_deref().or(staging_identity.as_deref());
                        if owned_identity != Some(actual_identity.as_str()) {
                            anyhow::bail!(
                                "camp_attachment_view_recovery_required: rollback target identity changed"
                            );
                        }
                        remove_managed_tree(&final_path)?;
                    }
                }
                sync_directory(&attachment_root)
            })();
            let restore = set_directory_mode(&attachment_root, 0o500);
            cleanup?;
            restore?;
        }
        self.remove_operation_staging(database.connection(), operation_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            "UPDATE camp_attachment_view_operation_entry SET state = 'rolled_back', updated_at = ?2 WHERE operation_id = ?1 AND state <> 'committed'",
            params![operation_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'rolled_back',
                resolution_state = CASE
                    WHEN source_kind = 'legacy' THEN 'failed'
                    ELSE resolution_state
                END,
                reserved_bytes = CASE
                    WHEN source_kind = 'legacy' THEN 0
                    ELSE reserved_bytes
                END,
                completed_at = ?2, updated_at = ?2
            WHERE id = ?1
            "#,
            params![operation_id, now],
        )?;
        let (view_state, last_error): (&str, Option<&str>) = match kind.as_str() {
            "publish" => ("ready", None),
            "initial_backfill" => ("initializing", Some(error_code)),
            "controlled_rebuild" => ("integrity_failed", Some(error_code)),
            "camp_delete_cleanup" => ("cleanup_pending", Some(error_code)),
            _ => anyhow::bail!("Camp Attachment View operation kind is invalid"),
        };
        let view_updated = transaction.execute(
            r#"
            UPDATE camp_attachment_view
            SET state = ?4, active_operation_id = NULL,
                last_error_code = ?5, updated_at = ?2
            WHERE camp_id = ?1 AND (active_operation_id = ?3 OR active_operation_id IS NULL)
            "#,
            params![camp_id, now, operation_id, view_state, last_error],
        )?;
        if view_updated != 1 {
            anyhow::bail!(
                "camp_attachment_view_recovery_required: rollback View state was not recorded"
            );
        }
        transaction.commit()?;
        Ok(())
    }

    fn remove_operation_staging(&self, connection: &Connection, operation_id: &str) -> Result<()> {
        let staging = self.staging_operation_root(operation_id)?;
        if !path_entry_exists(&staging)? {
            return Ok(());
        }
        validate_managed_directory(&staging, None)?;
        let expected = load_all_operation_attachment_ids(connection, operation_id)?
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        for name in read_exact_utf8_names(&staging)? {
            if !expected.contains(&name) {
                anyhow::bail!(
                    "camp_attachment_view_recovery_required: staging contains an unknown entry"
                );
            }
        }
        remove_managed_tree(&staging)
    }

    pub fn prepare_camp_runtime_authorization(
        &self,
        database: &Database,
        camp_id: &str,
        workspace: Option<&Path>,
        visibility_mode: CampAttachmentVisibilityMode,
    ) -> Result<CampAttachmentRuntimeAuthorizationVerification> {
        if has_unresolved_publication(database.connection(), camp_id)? {
            anyhow::bail!("camp_attachment_view_not_ready");
        }
        let view = prepare_ready_camp_view_verification(
            database.connection(),
            &self.root,
            &self.root_identity_digest,
            camp_id,
        )?;
        Ok(CampAttachmentRuntimeAuthorizationVerification {
            view,
            workspace: workspace.map(Path::to_path_buf),
            visibility_mode,
        })
    }

    pub fn complete_verified_camp_runtime_authorization(
        &self,
        database: &Database,
        verified: VerifiedCampAttachmentRuntimeAuthorization,
    ) -> Result<CampAttachmentRuntimeAuthorization> {
        let verification = verified.verification;
        confirm_ready_camp_view(database.connection(), &verification.view)?;
        let camp_id = verification.view.camp_id;
        let receipt = verification.view.receipt;
        let attachment_root = self.camp_attachment_root(&camp_id)?;
        validate_runtime_attachment_root(&attachment_root)?;
        Ok(CampAttachmentRuntimeAuthorization {
            camp_id,
            attachment_root,
            root_identity_digest: receipt.root_identity_digest,
            generation: receipt.generation,
            catalog_digest: receipt.catalog_digest,
            visibility_mode: verification.visibility_mode,
        })
    }

    pub fn camp_runtime_authorization(
        &self,
        database: &Database,
        camp_id: &str,
        workspace: Option<&Path>,
        visibility_mode: CampAttachmentVisibilityMode,
    ) -> Result<CampAttachmentRuntimeAuthorization> {
        let verification =
            self.prepare_camp_runtime_authorization(database, camp_id, workspace, visibility_mode)?;
        let verified = verification.verify()?;
        self.complete_verified_camp_runtime_authorization(database, verified)
    }

    pub fn camp_root_runtime_authorization(
        &self,
        database: &Database,
        camp_id: &str,
        workspace: Option<&Path>,
    ) -> Result<CampAttachmentRuntimeAuthorization> {
        CampId::parse(camp_id)?;
        if database.runtime_camp_files_root_identity_digest() != self.root_identity_digest {
            anyhow::bail!("runtime_camp_files_root_invalid: admitted root identity changed");
        }
        if directory_identity_digest(&self.root)? != self.root_identity_digest {
            anyhow::bail!("runtime_camp_files_root_invalid: current root identity changed");
        }
        if let Some(workspace) = workspace {
            let canonical_workspace = fs::canonicalize(workspace)
                .context("AgentRun workspace cannot be canonicalized")?;
            reject_overlap(&self.root, &canonical_workspace)?;
        }
        let attachment_root = self.camp_attachment_root(camp_id)?;
        validate_camp_root_authorization(&attachment_root)?;
        Ok(CampAttachmentRuntimeAuthorization {
            camp_id: camp_id.to_string(),
            attachment_root,
            root_identity_digest: self.root_identity_digest.clone(),
            generation: 0,
            catalog_digest: camp_root_authorization_digest(camp_id, &self.root_identity_digest)?,
            visibility_mode: CampAttachmentVisibilityMode::LiveAppendV1,
        })
    }

    pub fn verify_camp_ready(&self, database: &Database, camp_id: &str) -> Result<()> {
        if has_unresolved_publication(database.connection(), camp_id)? {
            anyhow::bail!("camp_attachment_view_not_ready");
        }
        verify_ready_camp_view(
            database.connection(),
            &self.root,
            &self.root_identity_digest,
            camp_id,
        )
        .with_context(|| format!("camp_attachment_view_integrity_failed: Camp {camp_id}"))
    }

    pub fn verify_camp_ready_receipt(&self, database: &Database, camp_id: &str) -> Result<()> {
        if has_unresolved_publication(database.connection(), camp_id)? {
            anyhow::bail!("camp_attachment_view_not_ready");
        }
        prepare_ready_camp_view_verification(
            database.connection(),
            &self.root,
            &self.root_identity_digest,
            camp_id,
        )
        .map(|_| ())
        .with_context(|| format!("camp_attachment_view_integrity_failed: Camp {camp_id}"))
    }

    pub fn camp_has_active_runtime(&self, database: &Database, camp_id: &str) -> Result<bool> {
        CampId::parse(camp_id)?;
        database
            .connection()
            .query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE camp_turn.camp_id = ?1
                      AND agent_run.status = 'running'
                      AND agent_run.execution_lease_owner IS NOT NULL
                )
                "#,
                [camp_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn prepare_camp_delete_cleanup(
        &self,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
    ) -> Result<Option<PreparedCampAttachmentCleanup>> {
        CampId::parse(camp_id)?;
        Uuid::parse_str(command_id).context("Camp delete command ID must be a UUID")?;
        let existing = database
            .connection()
            .query_row(
                r#"
                SELECT id FROM camp_attachment_view_operation
                WHERE kind = 'camp_delete_cleanup' AND command_id = ?1 AND camp_id = ?2
                "#,
                params![command_id, camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(operation_id) = existing {
            return Ok(Some(PreparedCampAttachmentCleanup {
                operation_id,
                camp_id: camp_id.to_string(),
                command_id: command_id.to_string(),
            }));
        }
        let view = database
            .connection()
            .query_row(
                r#"
                SELECT state, root_relative_path, root_identity_digest
                FROM camp_attachment_view WHERE camp_id = ?1
                "#,
                [camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((previous_view_state, attachment_relative_path, root_identity_digest)) = view
        else {
            return Ok(None);
        };
        if root_identity_digest != self.root_identity_digest
            || attachment_relative_path != camp_attachment_root_relative(camp_id)
        {
            anyhow::bail!(
                "camp_attachment_view_integrity_failed: Camp cleanup root identity is invalid"
            );
        }
        let cleanup_relative_path = PathBuf::from("camps").join(camp_id);
        validate_root_relative_path(&cleanup_relative_path)?;
        let camp_root = self.camp_root(camp_id)?;
        let cleanup_identity_digest = if path_entry_exists(&camp_root)? {
            validate_managed_directory(&camp_root, None)?;
            Some(entry_identity_digest(&camp_root)?)
        } else {
            None
        };
        let operation_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            r#"
            INSERT INTO camp_attachment_view_operation(
                id, camp_id, kind, status, command_id, draft_revision,
                reserved_bytes, cleanup_root_relative_path,
                cleanup_root_identity_digest, previous_view_state,
                error_code, created_at, updated_at, completed_at
            ) VALUES (
                ?1, ?2, 'camp_delete_cleanup', 'planned', ?3, NULL,
                0, ?4, ?5, ?6, NULL, ?7, ?7, NULL
            )
            "#,
            params![
                operation_id,
                camp_id,
                command_id,
                cleanup_relative_path.to_string_lossy(),
                cleanup_identity_digest,
                previous_view_state,
                now,
            ],
        )?;
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view
            SET state = 'cleanup_pending', active_operation_id = ?2,
                last_error_code = NULL, updated_at = ?3
            WHERE camp_id = ?1 AND active_operation_id IS NULL
            "#,
            params![camp_id, operation_id, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_busy");
        }
        transaction.commit()?;
        Ok(Some(PreparedCampAttachmentCleanup {
            operation_id,
            camp_id: camp_id.to_string(),
            command_id: command_id.to_string(),
        }))
    }

    pub fn cancel_camp_delete_cleanup(
        &self,
        database: &mut Database,
        cleanup: &PreparedCampAttachmentCleanup,
    ) -> Result<()> {
        CampId::parse(&cleanup.camp_id)?;
        validate_operation_id(&cleanup.operation_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let previous_state = transaction
            .query_row(
                r#"
                SELECT previous_view_state
                FROM camp_attachment_view_operation
                WHERE id = ?1 AND camp_id = ?2 AND kind = 'camp_delete_cleanup'
                  AND status IN ('planned','recovery_required')
                "#,
                params![cleanup.operation_id, cleanup.camp_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let Some(previous_state) = previous_state else {
            transaction.commit()?;
            return Ok(());
        };
        transaction.execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'rolled_back', resolution_state = 'failed', error_code = NULL,
                completed_at = ?2, updated_at = ?2
            WHERE id = ?1 AND status IN ('planned','recovery_required')
            "#,
            params![cleanup.operation_id, now],
        )?;
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view
            SET state = ?3, active_operation_id = NULL,
                last_error_code = NULL, updated_at = ?4
            WHERE camp_id = ?1 AND active_operation_id = ?2
            "#,
            params![cleanup.camp_id, cleanup.operation_id, previous_state, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn commit_camp_delete_cleanup(
        &self,
        database: &mut Database,
        cleanup: &PreparedCampAttachmentCleanup,
    ) -> Result<()> {
        let camp_exists: bool = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
            [&cleanup.camp_id],
            |row| row.get(0),
        )?;
        if camp_exists {
            anyhow::bail!("camp_attachment_view_recovery_required: Camp deletion did not commit");
        }
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'committed', updated_at = ?3
            WHERE id = ?1 AND camp_id = ?2 AND kind = 'camp_delete_cleanup'
              AND status IN ('planned','recovery_required')
            "#,
            params![
                cleanup.operation_id,
                cleanup.camp_id,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        if changed != 1 {
            let status = database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [&cleanup.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if !status.is_some_and(|status| matches!(status.as_str(), "committed" | "completed")) {
                anyhow::bail!("camp_attachment_view_recovery_required");
            }
        }
        Ok(())
    }

    pub fn complete_camp_delete_cleanup(
        &self,
        database: &mut Database,
        cleanup: &PreparedCampAttachmentCleanup,
    ) -> Result<()> {
        CampId::parse(&cleanup.camp_id)?;
        validate_operation_id(&cleanup.operation_id)?;
        let operation = database
            .connection()
            .query_row(
                r#"
                SELECT status, cleanup_root_relative_path, cleanup_root_identity_digest
                FROM camp_attachment_view_operation
                WHERE id = ?1 AND camp_id = ?2 AND kind = 'camp_delete_cleanup'
                "#,
                params![cleanup.operation_id, cleanup.camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .context("camp_attachment_view_recovery_required: cleanup operation is missing")?;
        if operation.0 == "completed" {
            return Ok(());
        }
        if operation.0 != "committed" {
            anyhow::bail!("camp_attachment_view_recovery_required: cleanup is not committed");
        }
        let expected_relative = PathBuf::from("camps").join(&cleanup.camp_id);
        let relative = PathBuf::from(
            operation
                .1
                .context("camp_attachment_view_recovery_required: cleanup path is missing")?,
        );
        validate_root_relative_path(&relative)?;
        if relative != expected_relative {
            anyhow::bail!("camp_attachment_view_recovery_required: cleanup path changed");
        }
        let camp_root = self.root.join(&relative);
        if path_entry_exists(&camp_root)? {
            let expected_identity = operation
                .2
                .context("camp_attachment_view_recovery_required: cleanup identity is missing")?;
            if entry_identity_digest(&camp_root)? != expected_identity {
                anyhow::bail!("camp_attachment_view_recovery_required: cleanup identity changed");
            }
            let camps_root = self.root.join("camps");
            set_directory_mode(&camps_root, 0o700)?;
            let cleanup_result = (|| -> Result<()> {
                remove_managed_tree(&camp_root)?;
                sync_directory(&camps_root)
            })();
            let restore_result = set_directory_mode(&camps_root, 0o100);
            cleanup_result?;
            restore_result?;
        } else if operation.2.is_some() {
            // A preceding cleanup attempt may have removed the exact tree before
            // crashing. Absence is the only safe adopt state after Camp deletion.
        }
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            "DELETE FROM camp_attachment_view_entry WHERE camp_id = ?1",
            [&cleanup.camp_id],
        )?;
        transaction.execute(
            "DELETE FROM camp_attachment_view WHERE camp_id = ?1",
            [&cleanup.camp_id],
        )?;
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET status = 'completed', completed_at = ?2, updated_at = ?2
            WHERE id = ?1 AND status = 'committed'
            "#,
            params![cleanup.operation_id, now],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_view_recovery_required");
        }
        transaction.commit()?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn remove_camp_view(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        CampId::parse(camp_id)?;
        let camp_root = self.camp_root(camp_id)?;
        if path_entry_exists(&camp_root)? {
            let camps_root = self.root.join("camps");
            set_directory_mode(&camps_root, 0o700)?;
            remove_managed_tree(&camp_root)?;
            sync_directory(&camps_root)?;
            set_directory_mode(&camps_root, 0o100)?;
        }
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            "DELETE FROM camp_attachment_view_entry WHERE camp_id = ?1",
            [camp_id],
        )?;
        transaction.execute(
            "DELETE FROM camp_attachment_view WHERE camp_id = ?1",
            [camp_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn reconcile_camp(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
    ) -> Result<()> {
        self.restore_recoverable_authority_attachments(database, attachment_store, camp_id)?;
        let desired = load_published_authority_rows(database.connection(), camp_id)?;
        let desired_ids = desired
            .iter()
            .map(|row| row.attachment_id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let existing_ids = load_view_entry_ids(database.connection(), camp_id)?;
        let view_state = database
            .connection()
            .query_row(
                "SELECT state, generation FROM camp_attachment_view WHERE camp_id = ?1",
                [camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let missing = desired
            .iter()
            .filter(|row| !existing_ids.contains(&row.attachment_id))
            .cloned()
            .collect::<Vec<_>>();
        let is_initial_backfill = view_state
            .as_ref()
            .is_some_and(|(state, generation)| state == "initializing" && *generation == 0)
            && existing_ids.is_empty();

        if view_state
            .as_ref()
            .is_some_and(|(state, _)| matches!(state.as_str(), "integrity_failed" | "rebuilding"))
        {
            return self.rebuild_integrity_failed_camp(
                database,
                attachment_store,
                camp_id,
                &desired,
                "camp_attachment_view_integrity_failed",
            );
        }

        if desired_ids != existing_ids && !is_initial_backfill {
            return self.rebuild_integrity_failed_camp(
                database,
                attachment_store,
                camp_id,
                &desired,
                "camp_attachment_view_catalog_mismatch",
            );
        }

        if missing.is_empty() && !is_initial_backfill {
            if view_state.as_ref().is_some_and(|row| row.0 == "ready") {
                let verification = if has_unresolved_publication(database.connection(), camp_id)? {
                    verify_ready_camp_view(
                        database.connection(),
                        &self.root,
                        &self.root_identity_digest,
                        camp_id,
                    )
                } else {
                    self.verify_camp_ready(database, camp_id)
                };
                match verification {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        eprintln!(
                            "Camp {camp_id} Published Attachment View integrity incident: {error:#}"
                        );
                        return self.rebuild_integrity_failed_camp(
                            database,
                            attachment_store,
                            camp_id,
                            &desired,
                            "camp_attachment_view_integrity_failed",
                        );
                    }
                }
            }
            let attachment_root = self.prepare_camp_directories(camp_id)?;
            set_directory_mode(&attachment_root, 0o500)?;
            let (entry_count, aggregate_bytes, catalog_digest) =
                catalog_state(database.connection(), camp_id)?;
            let (_, _, semantic_catalog_digest) =
                semantic_catalog_state(database.connection(), camp_id)?;
            let catalog_revision: i64 = database.connection().query_row(
                "SELECT COALESCE(MAX(published_catalog_revision), 0) FROM camp_attachment_view_entry WHERE camp_id = ?1",
                [camp_id],
                |row| row.get(0),
            )?;
            let now = chrono::Utc::now().to_rfc3339();
            database.connection().execute(
                r#"
                INSERT INTO camp_attachment_view(
                    camp_id, state, generation, root_relative_path,
                    root_identity_digest, entry_count, aggregate_bytes,
                    catalog_digest, catalog_revision, semantic_catalog_digest,
                    active_operation_id, last_error_code,
                    created_at, updated_at
                ) VALUES (?1, 'ready', 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9, ?9)
                ON CONFLICT(camp_id) DO UPDATE SET
                    state = 'ready', generation = MAX(generation, 1),
                    root_relative_path = excluded.root_relative_path,
                    root_identity_digest = excluded.root_identity_digest,
                    entry_count = excluded.entry_count,
                    aggregate_bytes = excluded.aggregate_bytes,
                    catalog_digest = excluded.catalog_digest,
                    semantic_catalog_digest = excluded.semantic_catalog_digest,
                    active_operation_id = NULL, last_error_code = NULL,
                    updated_at = excluded.updated_at
                "#,
                params![
                    camp_id,
                    camp_attachment_root_relative(camp_id),
                    self.root_identity_digest,
                    entry_count,
                    aggregate_bytes,
                    catalog_digest,
                    catalog_revision,
                    semantic_catalog_digest,
                    now,
                ],
            )?;
            return self.verify_camp_ready(database, camp_id);
        }

        let missing = self.retain_runtime_readable_authority_attachments(
            database,
            attachment_store,
            camp_id,
            &missing,
        )?;
        let requested_bytes = missing.iter().try_fold(0_u64, |total, row| {
            total
                .checked_add(row.byte_size)
                .context("backfill byte total overflow")
        })?;
        self.check_backfill_final_quotas(database.connection(), camp_id, requested_bytes)?;
        let operation_id = Uuid::new_v4().to_string();
        self.stage_backfill_operation(
            database,
            attachment_store,
            camp_id,
            &operation_id,
            "initial_backfill",
            &missing,
        )?;
        let publication = PreparedCampAttachmentPublication {
            operation_id: operation_id.clone(),
            camp_id: camp_id.to_string(),
            command_id: operation_id.clone(),
            attachment_ids: missing
                .iter()
                .map(|row| row.attachment_id.clone())
                .collect(),
        };
        let transaction = database.connection_mut().transaction()?;
        mark_operation_committing(&transaction, &operation_id, camp_id)?;
        commit_operation_entries(
            &transaction,
            &operation_id,
            camp_id,
            &publication.attachment_ids,
        )?;
        transaction.commit()?;
        self.complete_publication(database, &operation_id)?;
        self.complete_superseded_committed_operations(database, camp_id)?;
        self.record_integrity_degradation(database, camp_id)
    }

    fn rebuild_integrity_failed_camp(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
        desired: &[AuthorityAttachmentRow],
        reason: &str,
    ) -> Result<()> {
        let desired = self.retain_runtime_readable_authority_attachments(
            database,
            attachment_store,
            camp_id,
            desired,
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            UPDATE camp_attachment_view
            SET state = 'integrity_failed', active_operation_id = NULL,
                last_error_code = ?2, updated_at = ?3
            WHERE camp_id = ?1
            "#,
            params![camp_id, reason, now],
        )?;
        let requested_bytes = desired.iter().try_fold(0_u64, |total, row| {
            total
                .checked_add(row.byte_size)
                .context("controlled rebuild byte total overflow")
        })?;
        self.check_backfill_final_quotas(database.connection(), camp_id, requested_bytes)?;
        let operation_id = Uuid::new_v4().to_string();
        self.stage_backfill_operation(
            database,
            attachment_store,
            camp_id,
            &operation_id,
            "controlled_rebuild",
            &desired,
        )?;

        let publication = PreparedCampAttachmentPublication {
            operation_id: operation_id.clone(),
            camp_id: camp_id.to_string(),
            command_id: operation_id.clone(),
            attachment_ids: desired
                .iter()
                .map(|row| row.attachment_id.clone())
                .collect(),
        };
        let transaction = database.connection_mut().transaction()?;
        mark_operation_committing(&transaction, &operation_id, camp_id)?;
        commit_operation_entries(
            &transaction,
            &operation_id,
            camp_id,
            &publication.attachment_ids,
        )?;
        transaction.commit()?;
        self.complete_publication(database, &operation_id)?;
        self.complete_superseded_committed_operations(database, camp_id)?;
        self.record_integrity_degradation(database, camp_id)
    }

    fn restore_recoverable_authority_attachments(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
    ) -> Result<()> {
        let recoverable = load_recoverable_authority_rows(database.connection(), camp_id)?;
        for row in recoverable {
            if let Err(error) = attachment_store.verify_authority_attachment_for_runtime(
                &row.storage_path,
                &row.media_type,
                row.byte_size,
                &row.content_digest,
            ) {
                eprintln!(
                    "Camp {camp_id} Attachment {} remains unavailable to Runtime: {error:#}",
                    row.attachment_id
                );
                continue;
            }
            let changed = database.connection().execute(
                r#"
                UPDATE message_attachment
                SET runtime_projection_state = 'available'
                WHERE camp_id = ?1 AND id = ?2
                  AND runtime_projection_state = 'recovery_required'
                  AND (
                      publication_operation_id IS NULL
                      OR EXISTS(
                          SELECT 1 FROM camp_attachment_view_operation AS operation
                          WHERE operation.id = message_attachment.publication_operation_id
                            AND operation.camp_id = message_attachment.camp_id
                            AND operation.resolution_state = 'available'
                      )
                  )
                "#,
                params![camp_id, row.attachment_id],
            )?;
            if changed != 1 {
                anyhow::bail!("Camp Attachment recoverable state changed during verification");
            }
        }
        Ok(())
    }

    fn retain_runtime_readable_authority_attachments(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
        rows: &[AuthorityAttachmentRow],
    ) -> Result<Vec<AuthorityAttachmentRow>> {
        let mut readable = Vec::with_capacity(rows.len());
        let mut unavailable_ids = Vec::new();
        for row in rows {
            match attachment_store.verify_authority_attachment_for_runtime(
                &row.storage_path,
                &row.media_type,
                row.byte_size,
                &row.content_digest,
            ) {
                Ok(_) => readable.push(row.clone()),
                Err(error) => {
                    eprintln!(
                        "Camp {camp_id} Attachment {} is omitted from Runtime after integrity verification failed: {error:#}",
                        row.attachment_id
                    );
                    unavailable_ids.push(row.attachment_id.clone());
                }
            }
        }
        if unavailable_ids.is_empty() {
            return Ok(readable);
        }
        let transaction = database.connection_mut().transaction()?;
        for attachment_id in &unavailable_ids {
            let changed = transaction.execute(
                r#"
                UPDATE message_attachment
                SET runtime_projection_state = 'recovery_required'
                WHERE camp_id = ?1 AND id = ?2
                  AND runtime_projection_state = 'available'
                "#,
                params![camp_id, attachment_id],
            )?;
            if changed != 1 {
                anyhow::bail!("Camp Attachment availability changed during integrity degradation");
            }
        }
        transaction.commit()?;
        Ok(readable)
    }

    fn record_integrity_degradation(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        let degraded_count: i64 = database.connection().query_row(
            r#"
            SELECT COUNT(*)
            FROM message_attachment AS attachment
            LEFT JOIN camp_attachment_view_operation AS operation
              ON operation.id = attachment.publication_operation_id
             AND operation.camp_id = attachment.camp_id
            WHERE attachment.camp_id = ?1
              AND attachment.runtime_projection_state = 'recovery_required'
              AND (
                  attachment.publication_operation_id IS NULL
                  OR operation.resolution_state = 'available'
              )
            "#,
            [camp_id],
            |row| row.get(0),
        )?;
        if degraded_count == 0 {
            return Ok(());
        }
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view
            SET last_error_code = 'camp_attachment_integrity_degraded',
                updated_at = ?2
            WHERE camp_id = ?1 AND state = 'ready'
              AND active_operation_id IS NULL
            "#,
            params![camp_id, chrono::Utc::now().to_rfc3339()],
        )?;
        if changed != 1 {
            anyhow::bail!("Camp Attachment degraded View did not become ready");
        }
        Ok(())
    }

    fn stage_backfill_operation(
        &self,
        database: &mut Database,
        attachment_store: &CampAttachmentStore,
        camp_id: &str,
        operation_id: &str,
        operation_kind: &str,
        rows: &[AuthorityAttachmentRow],
    ) -> Result<()> {
        if !matches!(operation_kind, "initial_backfill" | "controlled_rebuild") {
            anyhow::bail!("Camp Attachment View backfill operation kind is invalid");
        }
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            r#"
            INSERT INTO camp_attachment_view_operation(
                id, camp_id, kind, status, command_id, draft_revision,
                reserved_bytes, error_code, created_at, updated_at, completed_at
            ) VALUES (?1, ?2, ?3, 'copying', ?1, NULL, 0, NULL, ?4, ?4, NULL)
            "#,
            params![operation_id, camp_id, operation_kind, now],
        )?;
        for row in rows {
            transaction.execute(
                r#"
                INSERT INTO camp_attachment_view_operation_entry(
                    operation_id, attachment_id, state, media_type,
                    expected_byte_size, expected_content_digest,
                    authority_storage_path, authority_safe_leaf,
                    kind, file_count, directory_count, node_count,
                    root_relative_staging_path, root_relative_final_path,
                    staging_identity_digest, final_identity_digest,
                    created_at, updated_at
                ) VALUES (?1, ?2, 'planned', ?3, ?4, ?5, ?6, NULL,
                          NULL, NULL, NULL, NULL, ?7, ?8, NULL, NULL, ?9, ?9)
                "#,
                params![
                    operation_id,
                    row.attachment_id,
                    row.media_type,
                    row.byte_size as i64,
                    row.content_digest,
                    row.storage_path.to_string_lossy(),
                    staging_entry_relative(operation_id, &row.attachment_id),
                    final_entry_relative(camp_id, &row.attachment_id),
                    now,
                ],
            )?;
        }
        transaction.commit()?;
        let active_state = if operation_kind == "initial_backfill" {
            "initializing"
        } else {
            "rebuilding"
        };
        let changed = database.connection().execute(
            r#"
            UPDATE camp_attachment_view
            SET state = ?4, active_operation_id = ?2, last_error_code = NULL,
                updated_at = ?3
            WHERE camp_id = ?1
              AND state IN ('initializing','integrity_failed','rebuilding')
            "#,
            params![
                camp_id,
                operation_id,
                chrono::Utc::now().to_rfc3339(),
                active_state
            ],
        )?;
        if changed != 1 {
            self.rollback_publication(
                database,
                operation_id,
                "camp_attachment_view_recovery_required",
            )?;
            anyhow::bail!("camp_attachment_view_recovery_required");
        }

        let build_result = (|| -> Result<()> {
            let attachment_root =
                self.prepare_backfill_target(camp_id, operation_kind == "controlled_rebuild")?;
            let operation_root = self.staging_operation_root(operation_id)?;
            ensure_private_directory(&operation_root)?;
            for row in rows {
                if row.byte_size > MAX_INSTANCE_STAGING_BYTES {
                    anyhow::bail!("camp_attachment_view_quota_exceeded");
                }
                self.check_backfill_staging_quota(
                    database.connection(),
                    operation_id,
                    row.byte_size,
                )?;
                database.connection().execute(
                    "UPDATE camp_attachment_view_operation SET reserved_bytes = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'copying'",
                    params![
                        operation_id,
                        row.byte_size as i64,
                        chrono::Utc::now().to_rfc3339()
                    ],
                )?;
                let entry_root = operation_root.join(&row.attachment_id);
                let payload = entry_root.join("payload");
                ensure_private_directory(&entry_root)?;
                ensure_private_directory(&payload)?;
                let receipt = attachment_store.copy_verified_authority_attachment_for_runtime(
                    &row.storage_path,
                    &row.media_type,
                    row.byte_size,
                    &row.content_digest,
                    &payload,
                )?;
                make_staging_entry_private(&entry_root)?;
                sync_tree(&entry_root)?;
                let staging_identity = entry_identity_digest(&entry_root)?;
                persist_copied_operation_entry(
                    database.connection(),
                    operation_id,
                    &row.attachment_id,
                    &receipt,
                    &staging_identity,
                )?;
                prepare_runtime_entry_for_atomic_promote(&entry_root)?;
                let inspected = inspect_runtime_attachment_copy(
                    &entry_root
                        .join("payload")
                        .join(&receipt.authority_safe_leaf),
                )?;
                if inspected != receipt {
                    anyhow::bail!("camp_attachment_view_digest_mismatch");
                }
                set_directory_mode(&attachment_root, 0o700)?;
                let destination = attachment_root.join(&row.attachment_id);
                let promote = (|| -> Result<String> {
                    if path_entry_exists(&destination)? {
                        anyhow::bail!("Camp Attachment View destination already exists");
                    }
                    fs::rename(&entry_root, &destination).context(
                        "camp_attachment_view_storage_unavailable: atomic promote failed",
                    )?;
                    set_directory_mode(&destination, 0o500)?;
                    sync_directory(&attachment_root)?;
                    entry_identity_digest(&destination)
                })();
                let restore = set_directory_mode(&attachment_root, 0o500);
                let final_identity = promote?;
                restore?;
                let promoted = database.connection().execute(
                    r#"
                    UPDATE camp_attachment_view_operation_entry
                    SET state = 'promoted', final_identity_digest = ?3, updated_at = ?4
                    WHERE operation_id = ?1 AND attachment_id = ?2 AND state = 'copied'
                    "#,
                    params![
                        operation_id,
                        row.attachment_id,
                        final_identity,
                        chrono::Utc::now().to_rfc3339()
                    ],
                )?;
                if promoted != 1 {
                    anyhow::bail!("camp_attachment_view_recovery_required");
                }
                database.connection().execute(
                    "UPDATE camp_attachment_view_operation SET reserved_bytes = 0, updated_at = ?2 WHERE id = ?1 AND status = 'copying'",
                    params![operation_id, chrono::Utc::now().to_rfc3339()],
                )?;
            }
            self.remove_operation_staging(database.connection(), operation_id)?;
            let transition_time = chrono::Utc::now().to_rfc3339();
            let transaction = database.connection_mut().transaction()?;
            for (from, to) in [
                ("copying", "staged"),
                ("staged", "gated"),
                ("gated", "promoting"),
                ("promoting", "promoted"),
            ] {
                let advanced = transaction.execute(
                    "UPDATE camp_attachment_view_operation SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2",
                    params![operation_id, from, to, transition_time],
                )?;
                if advanced != 1 {
                    anyhow::bail!("camp_attachment_view_recovery_required");
                }
            }
            let changed = transaction.execute(
                r#"
                UPDATE camp_attachment_view
                SET state = 'mutating', active_operation_id = ?2, updated_at = ?3
                WHERE camp_id = ?1 AND active_operation_id = ?2
                  AND state IN ('initializing','rebuilding')
                "#,
                params![camp_id, operation_id, transition_time],
            )?;
            if changed != 1 {
                anyhow::bail!("camp_attachment_view_recovery_required");
            }
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = build_result {
            self.rollback_publication(
                database,
                operation_id,
                "camp_attachment_view_backfill_failed",
            )?;
            return Err(error).context("camp_attachment_view_backfill_failed");
        }
        Ok(())
    }

    fn prepare_backfill_target(&self, camp_id: &str, replace_existing: bool) -> Result<PathBuf> {
        let camps_root = self.root.join("camps");
        set_directory_mode(&camps_root, 0o700)?;
        let camp_root = self.camp_root(camp_id)?;
        let preparation = (|| -> Result<PathBuf> {
            if path_entry_exists(&camp_root)? {
                validate_managed_directory(&camp_root, None)?;
                set_directory_mode(&camp_root, 0o700)?;
            } else {
                ensure_private_directory(&camp_root)?;
            }
            let attachment_root = camp_root.join("attachments");
            if path_entry_exists(&attachment_root)? {
                validate_managed_directory(&attachment_root, None)?;
                let existing = read_typed_attachment_directory_ids(&attachment_root)?;
                if replace_existing {
                    set_directory_mode(&attachment_root, 0o700)?;
                    for attachment_id in existing {
                        remove_managed_tree(&attachment_root.join(attachment_id))?;
                    }
                    sync_directory(&attachment_root)?;
                } else if !existing.is_empty() {
                    anyhow::bail!(
                        "camp_attachment_view_recovery_required: initial View target is not empty"
                    );
                }
            } else {
                ensure_private_directory(&attachment_root)?;
            }
            set_directory_mode(&attachment_root, 0o500)?;
            Ok(attachment_root)
        })();
        let restore_camp = match path_entry_exists(&camp_root) {
            Ok(true) => set_directory_mode(&camp_root, 0o100),
            Ok(false) => Ok(()),
            Err(error) => Err(error),
        };
        let restore_camps = set_directory_mode(&camps_root, 0o100);
        let restore_errors = [restore_camp, restore_camps]
            .into_iter()
            .filter_map(Result::err)
            .map(|error| format!("{error:#}"))
            .collect::<Vec<_>>();
        match preparation {
            Ok(attachment_root) if restore_errors.is_empty() => Ok(attachment_root),
            Ok(_) => anyhow::bail!(
                "camp_attachment_view_recovery_required: failed to restore backfill parent permissions: {}",
                restore_errors.join("; ")
            ),
            Err(error) if restore_errors.is_empty() => Err(error),
            Err(error) => Err(error.context(format!(
                "camp_attachment_view_recovery_required: additionally failed to restore backfill parent permissions: {}",
                restore_errors.join("; ")
            ))),
        }
    }

    fn recover_incomplete_operations(&self, database: &mut Database) -> Result<()> {
        // Builds after Migration 102 could cancel a cleanup without settling
        // its writer intent. Repair only that terminal legacy shape before the
        // unresolved-operation scan so affected Camps can admit new Runs.
        database.connection().execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET resolution_state = 'failed'
            WHERE kind = 'camp_delete_cleanup'
              AND status = 'rolled_back'
              AND resolution_state = 'unresolved'
            "#,
            [],
        )?;
        let operations = {
            let mut statement = database.connection().prepare(
                "SELECT id, camp_id, status, kind, command_id, source_kind, resolution_state FROM camp_attachment_view_operation WHERE status NOT IN ('completed','rolled_back') ORDER BY created_at, id",
            )?;
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (operation_id, camp_id, status, kind, command_id, source_kind, resolution_state) in
            operations
        {
            if kind == "camp_delete_cleanup" {
                let cleanup = PreparedCampAttachmentCleanup {
                    operation_id,
                    camp_id: camp_id.clone(),
                    command_id,
                };
                let camp_exists: bool = database.connection().query_row(
                    "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
                    [&camp_id],
                    |row| row.get(0),
                )?;
                if camp_exists {
                    if status == "committed" {
                        anyhow::bail!(
                            "camp_attachment_view_recovery_required: committed cleanup still has a Camp"
                        );
                    }
                    self.cancel_camp_delete_cleanup(database, &cleanup)?;
                } else {
                    self.commit_camp_delete_cleanup(database, &cleanup)?;
                    self.complete_camp_delete_cleanup(database, &cleanup)?;
                }
                continue;
            }
            if kind == "publish" && source_kind != "legacy" {
                if resolution_state == "available" && status == "committed" {
                    self.finish_semantic_publication(database, &operation_id)?;
                } else if resolution_state == "unresolved" {
                    self.mark_semantic_publication_recovery_required(
                        database,
                        &operation_id,
                        "camp_attachment_view_recovery_required",
                    )?;
                }
                continue;
            }
            let status = if kind == "publish"
                && status == "recovery_required"
                && publication_operation_has_business_commit(
                    database.connection(),
                    &operation_id,
                    &camp_id,
                )? {
                let changed = database.connection().execute(
                    r#"
                    UPDATE camp_attachment_view_operation
                    SET status = 'committed', updated_at = ?2
                    WHERE id = ?1 AND status = 'recovery_required'
                    "#,
                    params![operation_id, chrono::Utc::now().to_rfc3339()],
                )?;
                if changed != 1 {
                    anyhow::bail!("camp_attachment_view_recovery_required");
                }
                "committed".to_string()
            } else {
                status
            };
            if status == "committed" {
                match verify_ready_camp_view(
                    database.connection(),
                    &self.root,
                    &self.root_identity_digest,
                    &camp_id,
                ) {
                    Ok(()) => self.complete_publication(database, &operation_id)?,
                    Err(error) => {
                        eprintln!(
                            "Camp {camp_id} committed Attachment View operation requires a controlled rebuild: {error:#}"
                        );
                        database.connection().execute(
                            r#"
                            UPDATE camp_attachment_view
                            SET state = 'integrity_failed', active_operation_id = NULL,
                                last_error_code = 'camp_attachment_view_integrity_failed',
                                updated_at = ?2
                            WHERE camp_id = ?1
                            "#,
                            params![camp_id, chrono::Utc::now().to_rfc3339()],
                        )?;
                    }
                }
            } else {
                self.rollback_publication(
                    database,
                    &operation_id,
                    "camp_attachment_view_recovery_required",
                )?;
            }
        }
        Ok(())
    }

    fn complete_superseded_committed_operations(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<()> {
        verify_ready_camp_view(
            database.connection(),
            &self.root,
            &self.root_identity_digest,
            camp_id,
        )?;
        let operation_ids = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id FROM camp_attachment_view_operation
                WHERE camp_id = ?1 AND status = 'committed'
                  AND source_kind = 'legacy'
                ORDER BY created_at, id
                "#,
            )?;
            statement
                .query_map([camp_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for operation_id in operation_ids {
            self.remove_operation_staging(database.connection(), &operation_id)?;
            let now = chrono::Utc::now().to_rfc3339();
            database.connection().execute(
                r#"
                UPDATE camp_attachment_view_operation
                SET status = 'completed', resolution_state = 'available',
                    reserved_bytes = 0, completed_at = ?2, updated_at = ?2
                WHERE id = ?1 AND status = 'committed'
                  AND source_kind = 'legacy'
                "#,
                params![operation_id, now],
            )?;
        }
        Ok(())
    }

    fn remove_orphan_camp_directories(
        &self,
        database: &mut Database,
        camp_ids: &[String],
    ) -> Result<()> {
        let camps_root = self.root.join("camps");
        set_directory_mode(&camps_root, 0o700)?;
        let known = camp_ids
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        for entry in fs::read_dir(&camps_root)?.collect::<std::io::Result<Vec<_>>>()? {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                anyhow::bail!("camp_attachment_view_integrity_failed: non-UTF8 Camp directory");
            };
            if CampId::parse(name).is_err() {
                anyhow::bail!("camp_attachment_view_integrity_failed: unknown Camp directory");
            }
            if !known.contains(name) {
                remove_managed_tree(&entry.path())?;
                database.connection().execute(
                    "DELETE FROM camp_attachment_view_entry WHERE camp_id = ?1",
                    [name],
                )?;
                database.connection().execute(
                    "DELETE FROM camp_attachment_view WHERE camp_id = ?1",
                    [name],
                )?;
            }
        }
        set_directory_mode(&camps_root, 0o100)?;
        Ok(())
    }

    fn check_publication_quotas(
        &self,
        connection: &Connection,
        camp_id: &str,
        requested_bytes: u64,
    ) -> Result<()> {
        let active_staging: i64 = connection.query_row(
            r#"
            SELECT COUNT(*) FROM camp_attachment_view_operation
            WHERE status IN ('planned','copying','staged','gated','promoting','promoted','committing')
            "#,
            [],
            |row| row.get(0),
        )?;
        if active_staging >= MAX_CONCURRENT_STAGING_OPERATIONS {
            anyhow::bail!("camp_attachment_view_busy");
        }
        let staging_bytes: i64 = connection.query_row(
            r#"
            SELECT COALESCE(SUM(reserved_bytes), 0)
            FROM camp_attachment_view_operation
            WHERE status IN ('planned','copying','staged','gated','promoting','promoted','committing')
            "#,
            [],
            |row| row.get(0),
        )?;
        let camp_bytes: i64 = connection.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM camp_attachment_view_entry WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        let instance_bytes: i64 = connection.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM camp_attachment_view_entry",
            [],
            |row| row.get(0),
        )?;
        let requested = i64::try_from(requested_bytes).context("publication size overflow")?;
        if staging_bytes.saturating_add(requested) > MAX_INSTANCE_STAGING_BYTES as i64
            || camp_bytes.saturating_add(requested) > MAX_CAMP_VIEW_BYTES as i64
            || instance_bytes.saturating_add(requested) > MAX_INSTANCE_VIEW_BYTES as i64
        {
            anyhow::bail!("camp_attachment_view_quota_exceeded");
        }
        Ok(())
    }

    fn check_backfill_final_quotas(
        &self,
        connection: &Connection,
        camp_id: &str,
        final_camp_bytes: u64,
    ) -> Result<()> {
        let active_operations: i64 = connection.query_row(
            r#"
            SELECT COUNT(*) FROM camp_attachment_view_operation
            WHERE status IN ('planned','copying','staged','gated','promoting','promoted','committing')
            "#,
            [],
            |row| row.get(0),
        )?;
        if active_operations >= MAX_CONCURRENT_STAGING_OPERATIONS {
            anyhow::bail!("camp_attachment_view_busy");
        }
        let current_camp_bytes: i64 = connection.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM camp_attachment_view_entry WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        let current_instance_bytes: i64 = connection.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM camp_attachment_view_entry",
            [],
            |row| row.get(0),
        )?;
        let final_camp = i64::try_from(final_camp_bytes).context("backfill size overflow")?;
        let other_camps = current_instance_bytes
            .checked_sub(current_camp_bytes)
            .context("backfill instance quota accounting underflow")?;
        if final_camp > MAX_CAMP_VIEW_BYTES as i64
            || other_camps.saturating_add(final_camp) > MAX_INSTANCE_VIEW_BYTES as i64
        {
            anyhow::bail!("camp_attachment_view_quota_exceeded");
        }
        Ok(())
    }

    fn check_backfill_staging_quota(
        &self,
        connection: &Connection,
        operation_id: &str,
        requested_bytes: u64,
    ) -> Result<()> {
        let other_reserved_bytes: i64 = connection.query_row(
            r#"
            SELECT COALESCE(SUM(reserved_bytes), 0)
            FROM camp_attachment_view_operation
            WHERE id <> ?1
              AND status IN ('planned','copying','staged','gated','promoting','promoted','committing')
            "#,
            [operation_id],
            |row| row.get(0),
        )?;
        let requested = i64::try_from(requested_bytes).context("backfill size overflow")?;
        if other_reserved_bytes.saturating_add(requested) > MAX_INSTANCE_STAGING_BYTES as i64 {
            anyhow::bail!("camp_attachment_view_quota_exceeded");
        }
        Ok(())
    }

    fn verify_publication_state(
        &self,
        connection: &Connection,
        publication: &PreparedCampAttachmentPublication,
        expected_status: &str,
    ) -> Result<()> {
        let status: String = connection.query_row(
            "SELECT status FROM camp_attachment_view_operation WHERE id = ?1 AND camp_id = ?2 AND command_id = ?3",
            params![publication.operation_id, publication.camp_id, publication.command_id],
            |row| row.get(0),
        )?;
        if status != expected_status
            || load_operation_attachment_ids(connection, &publication.operation_id, "copied")?
                != publication.attachment_ids
        {
            anyhow::bail!("camp_attachment_view_publish_failed: publication journal mismatch");
        }
        self.verify_staged_publication_entries(connection, publication)?;
        Ok(())
    }

    fn verify_staged_publication_entries(
        &self,
        connection: &Connection,
        publication: &PreparedCampAttachmentPublication,
    ) -> Result<()> {
        let mut statement = connection.prepare(
            r#"
            SELECT attachment_id, expected_byte_size, expected_content_digest,
                   authority_safe_leaf, kind, file_count, directory_count,
                   node_count, root_relative_staging_path,
                   root_relative_final_path, staging_identity_digest
            FROM camp_attachment_view_operation_entry
            WHERE operation_id = ?1 AND state = 'copied'
            ORDER BY rowid
            "#,
        )?;
        let rows = statement
            .query_map([&publication.operation_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(statement);
        if rows.len() != publication.attachment_ids.len() {
            anyhow::bail!("Staged publication entry count changed");
        }
        for row in rows {
            validate_attachment_id(&row.0)?;
            let expected_staging = staging_entry_relative(&publication.operation_id, &row.0);
            let expected_final = final_entry_relative(&publication.camp_id, &row.0);
            if row.8 != expected_staging || row.9 != expected_final {
                anyhow::bail!("Staged publication path receipt is inconsistent");
            }
            let entry_root = self.root.join(&expected_staging);
            validate_managed_directory(&entry_root, Some(0o700))?;
            if row.10.as_deref() != Some(entry_identity_digest(&entry_root)?.as_str()) {
                anyhow::bail!("Staged publication identity changed");
            }
            let names = read_exact_utf8_names(&entry_root)?;
            if names.as_slice() != ["payload"] {
                anyhow::bail!("Staged publication contains an unexpected node");
            }
            let payload_root = entry_root.join("payload");
            validate_managed_directory(&payload_root, Some(0o700))?;
            let safe_leaf = row.3.context("Staged publication has no safe leaf")?;
            if read_exact_utf8_names(&payload_root)?.as_slice() != [safe_leaf.as_str()] {
                anyhow::bail!("Staged publication payload differs from its receipt");
            }
            validate_staging_tree_modes(&payload_root.join(&safe_leaf))?;
            let inspected = inspect_runtime_attachment_copy(&payload_root.join(&safe_leaf))?;
            if inspected.authority_safe_leaf != safe_leaf
                || Some(inspected.kind.as_str()) != row.4.as_deref()
                || inspected.byte_size != nonnegative_u64(row.1, "staged byte size")?
                || inspected.content_digest != row.2
                || Some(inspected.file_count) != row.5.map(|value| value.max(0) as u64)
                || Some(inspected.directory_count) != row.6.map(|value| value.max(0) as u64)
                || Some(inspected.node_count) != row.7.map(|value| value.max(0) as u64)
            {
                anyhow::bail!("Staged publication content receipt changed");
            }
        }
        Ok(())
    }

    fn load_prepared_publication(
        &self,
        connection: &Connection,
        operation_id: &str,
    ) -> Result<PreparedCampAttachmentPublication> {
        let (camp_id, command_id): (String, String) = connection.query_row(
            "SELECT camp_id, command_id FROM camp_attachment_view_operation WHERE id = ?1",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let attachment_ids = load_all_operation_attachment_ids(connection, operation_id)?;
        Ok(PreparedCampAttachmentPublication {
            operation_id: operation_id.to_string(),
            camp_id,
            command_id,
            attachment_ids,
        })
    }

    fn prepare_camp_directories(&self, camp_id: &str) -> Result<PathBuf> {
        let camps_root = self.root.join("camps");
        set_directory_mode(&camps_root, 0o700)?;
        let camp_root = self.camp_root(camp_id)?;
        ensure_private_directory(&camp_root)?;
        let attachment_root = camp_root.join("attachments");
        ensure_private_directory(&attachment_root)?;
        set_directory_mode(&camp_root, 0o100)?;
        set_directory_mode(&camps_root, 0o100)?;
        Ok(attachment_root)
    }

    fn camp_root(&self, camp_id: &str) -> Result<PathBuf> {
        CampId::parse(camp_id)?;
        Ok(self.root.join("camps").join(camp_id))
    }

    fn camp_attachment_root(&self, camp_id: &str) -> Result<PathBuf> {
        Ok(self.camp_root(camp_id)?.join("attachments"))
    }

    fn staging_operation_root(&self, operation_id: &str) -> Result<PathBuf> {
        validate_operation_id(operation_id)?;
        Ok(self.root.join(".staging").join(operation_id))
    }
}

#[cfg(test)]
#[derive(Debug)]
struct PublicationCopyTestPause {
    started: std::sync::atomic::AtomicBool,
    released: std::sync::Mutex<bool>,
    release: std::sync::Condvar,
}

#[cfg(test)]
impl PublicationCopyTestPause {
    fn new() -> Self {
        Self {
            started: std::sync::atomic::AtomicBool::new(false),
            released: std::sync::Mutex::new(false),
            release: std::sync::Condvar::new(),
        }
    }

    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.release.notify_all();
    }
}

#[cfg(test)]
fn publication_copy_test_pauses() -> &'static std::sync::Mutex<
    std::collections::BTreeMap<String, std::sync::Arc<PublicationCopyTestPause>>,
> {
    static PAUSES: std::sync::OnceLock<
        std::sync::Mutex<
            std::collections::BTreeMap<String, std::sync::Arc<PublicationCopyTestPause>>,
        >,
    > = std::sync::OnceLock::new();
    PAUSES.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
}

#[cfg(test)]
fn pause_publication_copy_for_test(operation_id: &str) {
    let pause = publication_copy_test_pauses()
        .lock()
        .unwrap()
        .get(operation_id)
        .cloned();
    let Some(pause) = pause else {
        return;
    };
    pause
        .started
        .store(true, std::sync::atomic::Ordering::Release);
    let mut released = pause.released.lock().unwrap();
    while !*released {
        released = pause.release.wait(released).unwrap();
    }
}

#[cfg(test)]
fn view_verification_test_pauses() -> &'static std::sync::Mutex<
    std::collections::BTreeMap<String, std::sync::Arc<PublicationCopyTestPause>>,
> {
    static PAUSES: std::sync::OnceLock<
        std::sync::Mutex<
            std::collections::BTreeMap<String, std::sync::Arc<PublicationCopyTestPause>>,
        >,
    > = std::sync::OnceLock::new();
    PAUSES.get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
}

#[cfg(test)]
fn pause_view_verification_for_test(camp_id: &str) {
    let pause = view_verification_test_pauses()
        .lock()
        .unwrap()
        .get(camp_id)
        .cloned();
    let Some(pause) = pause else {
        return;
    };
    pause
        .started
        .store(true, std::sync::atomic::Ordering::Release);
    let mut released = pause.released.lock().unwrap();
    while !*released {
        released = pause.release.wait(released).unwrap();
    }
}

fn publication_operation_has_business_commit(
    connection: &Connection,
    operation_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let (entry_count, committed_entry_count, published_entry_count): (i64, i64, i64) =
        connection.query_row(
            r#"
            SELECT COUNT(*),
                   COALESCE(SUM(CASE WHEN operation_entry.state = 'committed' THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN EXISTS(
                       SELECT 1 FROM message_attachment
                       WHERE message_attachment.camp_id = ?2
                         AND message_attachment.id = operation_entry.attachment_id
                   ) THEN 1 ELSE 0 END), 0)
            FROM camp_attachment_view_operation_entry AS operation_entry
            WHERE operation_entry.operation_id = ?1
            "#,
            params![operation_id, camp_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    Ok(entry_count > 0
        && committed_entry_count == entry_count
        && published_entry_count == entry_count)
}

impl Drop for CampAttachmentViewStore {
    fn drop(&mut self) {
        unlock(&self.lock_file);
    }
}

pub fn commit_publication_in_message_transaction(
    transaction: &Transaction<'_>,
    operation_id: Option<&str>,
    camp_id: &str,
    prepared_attachment_ids: &[String],
) -> Result<()> {
    if prepared_attachment_ids.is_empty() {
        if operation_id.is_some() {
            anyhow::bail!("Camp Attachment View publication was provided for an empty Draft");
        }
        return Ok(());
    }
    let operation_id = operation_id.context(
        "camp_attachment_view_not_ready: Published Attachments require a staged View operation",
    )?;
    mark_operation_committing(transaction, operation_id, camp_id)?;
    commit_operation_entries(transaction, operation_id, camp_id, prepared_attachment_ids)
}

pub fn resolve_semantic_publication_success(
    transaction: &Transaction<'_>,
    operation_id: &str,
) -> Result<Vec<String>> {
    validate_operation_id(operation_id)?;
    let (camp_id, semantic_revision, resolution_state): (String, i64, String) = transaction
        .query_row(
            r#"
            SELECT camp_id, semantic_revision, resolution_state
            FROM camp_attachment_view_operation
            WHERE id = ?1 AND kind = 'publish'
            "#,
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    if resolution_state == "available" {
        return load_projection_delivery_ids(transaction, operation_id);
    }
    if resolution_state != "unresolved" {
        anyhow::bail!("camp_attachment_view_recovery_required: publication already resolved");
    }
    let attachment_ids = load_operation_attachment_ids(transaction, operation_id, "promoted")?;
    mark_operation_committing(transaction, operation_id, &camp_id)?;
    commit_operation_entries(transaction, operation_id, &camp_id, &attachment_ids)?;

    let now = chrono::Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE message_attachment
        SET runtime_projection_state = 'available'
        WHERE camp_id = ?1 AND publication_operation_id = ?2
          AND publication_semantic_revision = ?3
          AND runtime_projection_state IN ('pending','recovery_required')
        "#,
        params![camp_id, operation_id, semantic_revision],
    )?;
    if changed != attachment_ids.len() {
        anyhow::bail!("camp_attachment_view_publish_failed: public attachment state changed");
    }
    let entry_digest = canonical_json_digest(&json!({
        "operationId": operation_id,
        "semanticRevision": semantic_revision,
        "attachmentIds": attachment_ids,
        "outcome": "available",
    }))?;
    let previous_resolution_digest: String = transaction.query_row(
        "SELECT resolution_digest FROM camp_attachment_view WHERE camp_id = ?1",
        [&camp_id],
        |row| row.get(0),
    )?;
    let resolution_digest = canonical_json_digest(&json!({
        "previous": previous_resolution_digest,
        "revision": semantic_revision,
        "entryDigest": entry_digest,
    }))?;
    transaction.execute(
        r#"
        INSERT INTO camp_attachment_publication_resolution(
            camp_id, semantic_revision, operation_id, outcome,
            entry_digest, tombstone_digest, failure_code, resolved_at
        ) VALUES (?1, ?2, ?3, 'available', ?4, NULL, NULL, ?5)
        "#,
        params![camp_id, semantic_revision, operation_id, entry_digest, now],
    )?;
    let view_changed = transaction.execute(
        r#"
        UPDATE camp_attachment_view
        SET resolved_revision = ?2, resolution_digest = ?3, updated_at = ?4
        WHERE camp_id = ?1 AND resolved_revision = ?5
          AND semantic_revision >= ?2
        "#,
        params![
            camp_id,
            semantic_revision,
            resolution_digest,
            now,
            semantic_revision - 1
        ],
    )?;
    if view_changed != 1 {
        anyhow::bail!("camp_attachment_publication_resolution_conflict");
    }
    let operation_changed = transaction.execute(
        r#"
        UPDATE camp_attachment_view_operation
        SET resolution_state = 'available', resolution_ledger_digest = ?2,
            reserved_bytes = 0, updated_at = ?3
        WHERE id = ?1 AND resolution_state = 'unresolved' AND status = 'committed'
        "#,
        params![operation_id, resolution_digest, now],
    )?;
    if operation_changed != 1 {
        anyhow::bail!("camp_attachment_publication_resolution_conflict");
    }
    transaction.execute(
        r#"
        UPDATE message_delivery
        SET dispatch_phase = 'never_attempted', pre_dispatch_gate = NULL,
            projection_operation_id = NULL,
            version = version + 1, updated_at = ?2
        WHERE projection_operation_id = ?1 AND status = 'pending'
          AND dispatch_phase = 'projection_blocked'
          AND pre_dispatch_gate = 'attachment_projection'
          AND dispatch_attempt_count = 0
        "#,
        params![operation_id, now],
    )?;
    load_projection_delivery_ids_from_message(transaction, operation_id)
}

pub fn resolve_semantic_publication_terminal_failure(
    transaction: &Transaction<'_>,
    operation_id: &str,
    failure_code: &str,
) -> Result<Vec<(String, String)>> {
    validate_operation_id(operation_id)?;
    let (camp_id, semantic_revision, resolution_state): (String, i64, String) = transaction
        .query_row(
            r#"
            SELECT camp_id, semantic_revision, resolution_state
            FROM camp_attachment_view_operation
            WHERE id = ?1 AND kind = 'publish' AND source_kind <> 'legacy'
            "#,
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    if resolution_state == "failed" {
        return Ok(Vec::new());
    }
    if resolution_state != "unresolved" {
        anyhow::bail!("camp_attachment_view_recovery_required: publication already resolved");
    }
    let attachment_ids = {
        let mut statement = transaction.prepare(
            r#"
            SELECT attachment_id
            FROM camp_attachment_view_operation_entry
            WHERE operation_id = ?1
            ORDER BY attachment_id
            "#,
        )?;
        statement
            .query_map([operation_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if attachment_ids.is_empty() {
        anyhow::bail!("camp_attachment_view_recovery_required: publication has no entries");
    }
    let now = chrono::Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE message_attachment
        SET runtime_projection_state = 'failed'
        WHERE camp_id = ?1 AND publication_operation_id = ?2
          AND publication_semantic_revision = ?3
          AND runtime_projection_state IN ('pending','recovery_required')
        "#,
        params![camp_id, operation_id, semantic_revision],
    )?;
    if changed != attachment_ids.len() {
        anyhow::bail!("camp_attachment_view_publish_failed: public attachment state changed");
    }
    let tombstone_digest = canonical_json_digest(&json!({
        "operationId": operation_id,
        "semanticRevision": semantic_revision,
        "attachmentIds": attachment_ids,
        "outcome": "failed",
        "failureCode": failure_code,
    }))?;
    let previous_resolution_digest: String = transaction.query_row(
        "SELECT resolution_digest FROM camp_attachment_view WHERE camp_id = ?1",
        [&camp_id],
        |row| row.get(0),
    )?;
    let resolution_digest = canonical_json_digest(&json!({
        "previous": previous_resolution_digest,
        "revision": semantic_revision,
        "tombstoneDigest": tombstone_digest,
    }))?;
    transaction.execute(
        r#"
        INSERT INTO camp_attachment_publication_resolution(
            camp_id, semantic_revision, operation_id, outcome,
            entry_digest, tombstone_digest, failure_code, resolved_at
        ) VALUES (?1, ?2, ?3, 'failed', NULL, ?4, ?5, ?6)
        "#,
        params![
            camp_id,
            semantic_revision,
            operation_id,
            tombstone_digest,
            failure_code,
            now,
        ],
    )?;
    let view_changed = transaction.execute(
        r#"
        UPDATE camp_attachment_view
        SET state = 'ready', resolved_revision = ?2,
            resolution_digest = ?3, active_operation_id = NULL,
            last_error_code = NULL, updated_at = ?4
        WHERE camp_id = ?1 AND resolved_revision = ?5
          AND semantic_revision >= ?2
        "#,
        params![
            camp_id,
            semantic_revision,
            resolution_digest,
            now,
            semantic_revision - 1,
        ],
    )?;
    if view_changed != 1 {
        anyhow::bail!("camp_attachment_publication_resolution_conflict");
    }
    transaction.execute(
        r#"
        UPDATE camp_attachment_view_operation_entry
        SET state = CASE WHEN state = 'committed' THEN state ELSE 'rolled_back' END,
            updated_at = ?2
        WHERE operation_id = ?1
        "#,
        params![operation_id, now],
    )?;
    let operation_changed = transaction.execute(
        r#"
        UPDATE camp_attachment_view_operation
        SET status = 'completed', resolution_state = 'failed',
            resolution_ledger_digest = ?2, terminal_failure_code = ?3,
            error_code = ?3, reserved_bytes = 0,
            completed_at = ?4, updated_at = ?4
        WHERE id = ?1 AND resolution_state = 'unresolved'
        "#,
        params![operation_id, resolution_digest, failure_code, now],
    )?;
    if operation_changed != 1 {
        anyhow::bail!("camp_attachment_publication_resolution_conflict");
    }
    settle_attachment_projection_failure(transaction, operation_id, failure_code, &now)
}

fn load_projection_delivery_ids(
    transaction: &Transaction<'_>,
    operation_id: &str,
) -> Result<Vec<String>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id FROM message_delivery
        WHERE projection_operation_id = ?1
        ORDER BY recipient_agent_id, queue_sequence, id
        "#,
    )?;
    Ok(statement
        .query_map([operation_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn load_projection_delivery_ids_from_message(
    transaction: &Transaction<'_>,
    operation_id: &str,
) -> Result<Vec<String>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT delivery.id
        FROM message_delivery AS delivery
        JOIN message_attachment AS attachment
          ON attachment.camp_message_id = delivery.message_id
        WHERE attachment.publication_operation_id = ?1
          AND delivery.status = 'pending'
          AND delivery.dispatch_phase = 'never_attempted'
        GROUP BY delivery.id, delivery.recipient_agent_id, delivery.queue_sequence
        ORDER BY delivery.recipient_agent_id, delivery.queue_sequence, delivery.id
        "#,
    )?;
    Ok(statement
        .query_map([operation_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn load_camp_attachment_view_receipt(
    connection: &Connection,
    camp_id: &str,
    mut referenced_attachment_ids: Vec<String>,
) -> Result<(CampAttachmentViewReceiptV2, String)> {
    CampId::parse(camp_id)?;
    referenced_attachment_ids.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    referenced_attachment_ids.dedup();
    if referenced_attachment_ids.is_empty() {
        let receipt = CampAttachmentViewReceiptV2 {
            schema_version: CAMP_ATTACHMENT_VIEW_RECEIPT_VERSION,
            camp_id: camp_id.to_string(),
            attachment_root_relative_path: camp_attachment_root_relative(camp_id),
            catalog_revision: LEGACY_VIEW_NOT_REQUIRED_REVISION,
            catalog_entry_count: 0,
            semantic_catalog_digest: canonical_json_digest(&Value::Array(Vec::new()))?,
            referenced_entries: Vec::new(),
            referenced_entries_digest: canonical_json_digest(&Value::Array(Vec::new()))?,
        };
        let digest = canonical_json_digest(&serde_json::to_value(&receipt)?)?;
        return Ok((receipt, digest));
    }
    let mut referenced_entries = Vec::with_capacity(referenced_attachment_ids.len());
    for attachment_id in &referenced_attachment_ids {
        validate_attachment_id(attachment_id)?;
        let entry = connection
            .query_row(
                r#"
                SELECT attachment_id, kind, byte_size, file_count,
                       directory_count, node_count, content_digest,
                       root_relative_final_path || '/payload/' || authority_safe_leaf
                FROM camp_attachment_view_entry
                WHERE camp_id = ?1 AND attachment_id = ?2
                  AND EXISTS(
                      SELECT 1 FROM message_attachment AS attachment
                      WHERE attachment.camp_id = camp_attachment_view_entry.camp_id
                        AND attachment.id = camp_attachment_view_entry.attachment_id
                        AND attachment.runtime_projection_state = 'available'
                  )
                "#,
                params![camp_id, attachment_id],
                |row| {
                    Ok(SemanticAttachmentEntryV1 {
                        attachment_id: row.get(0)?,
                        kind: row.get(1)?,
                        byte_size: row.get(2)?,
                        file_count: row.get(3)?,
                        directory_count: row.get(4)?,
                        node_count: row.get(5)?,
                        content_digest: row.get(6)?,
                        root_relative_payload_path: row.get(7)?,
                    })
                },
            )
            .optional()?
            .context("camp_attachment_view_not_ready: referenced entry is missing")?;
        referenced_entries.push(entry);
    }
    let row = connection
        .query_row(
            r#"
            SELECT state, root_relative_path, catalog_revision,
                   semantic_catalog_digest
            FROM camp_attachment_view WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?
        .context("camp_attachment_view_not_ready")?;
    if row.0 != "ready" || row.2 < 0 {
        anyhow::bail!("camp_attachment_view_not_ready");
    }
    if row.1 != camp_attachment_root_relative(camp_id) {
        anyhow::bail!("camp_attachment_view_not_ready: semantic root path is inconsistent");
    }
    let (semantic_entry_count, _, semantic_catalog_digest) =
        semantic_catalog_state_through_revision(connection, camp_id, Some(row.2))?;
    if semantic_catalog_digest != row.3 {
        anyhow::bail!("camp_attachment_view_not_ready: semantic catalog is inconsistent");
    }
    let referenced_entries_digest = canonical_json_digest(&json!(referenced_entries))?;
    let receipt = CampAttachmentViewReceiptV2 {
        schema_version: CAMP_ATTACHMENT_VIEW_RECEIPT_VERSION,
        camp_id: camp_id.to_string(),
        attachment_root_relative_path: row.1,
        catalog_revision: row.2,
        catalog_entry_count: semantic_entry_count,
        semantic_catalog_digest: row.3,
        referenced_entries,
        referenced_entries_digest,
    };
    let digest = canonical_json_digest(&serde_json::to_value(&receipt)?)?;
    Ok((receipt, digest))
}

pub fn resolve_published_attachment_path(
    connection: &Connection,
    camp_id: &str,
    attachment_id: &str,
) -> Result<String> {
    CampId::parse(camp_id)?;
    validate_attachment_id(attachment_id)?;
    let relative: String = connection
        .query_row(
            r#"
            SELECT entry.root_relative_final_path || '/payload/' || entry.authority_safe_leaf
            FROM camp_attachment_view_entry AS entry
            JOIN camp_attachment_view AS view ON view.camp_id = entry.camp_id
            WHERE entry.camp_id = ?1 AND entry.attachment_id = ?2
              AND view.state = 'ready' AND view.root_identity_digest = rovai_runtime_camp_files_root_identity_digest()
              AND EXISTS(
                  SELECT 1 FROM message_attachment AS attachment
                  WHERE attachment.camp_id = entry.camp_id
                    AND attachment.id = entry.attachment_id
                    AND attachment.runtime_projection_state = 'available'
              )
            "#,
            params![camp_id, attachment_id],
            |row| row.get(0),
        )
        .optional()?
        .context("camp_attachment_view_not_ready: Published Attachment entry is unavailable")?;
    Ok(resolve_root_relative_runtime_path(connection, &relative)?
        .to_string_lossy()
        .into_owned())
}

pub fn resolve_camp_attachment_root(connection: &Connection, camp_id: &str) -> Result<String> {
    CampId::parse(camp_id)?;
    Ok(
        resolve_root_relative_runtime_path(connection, &camp_attachment_root_relative(camp_id))?
            .to_string_lossy()
            .into_owned(),
    )
}

pub fn resolve_published_attachment_root(connection: &Connection, camp_id: &str) -> Result<String> {
    CampId::parse(camp_id)?;
    let relative: String = connection
        .query_row(
            r#"
            SELECT root_relative_path
            FROM camp_attachment_view
            WHERE camp_id = ?1 AND state = 'ready'
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .optional()?
        .context("camp_attachment_view_not_ready")?;
    if relative != camp_attachment_root_relative(camp_id) {
        anyhow::bail!("camp_attachment_view_not_ready: semantic root path is inconsistent");
    }
    Ok(resolve_root_relative_runtime_path(connection, &relative)?
        .to_string_lossy()
        .into_owned())
}

pub fn runtime_attachment_auth_receipt(
    connection: &Connection,
    camp_id: &str,
    manifest_view_receipt_digest: &str,
    visibility_mode: CampAttachmentVisibilityMode,
) -> Result<(RuntimeAttachmentAuthReceiptV1, String)> {
    CampId::parse(camp_id)?;
    if has_unresolved_publication(connection, camp_id)? {
        anyhow::bail!("camp_attachment_view_not_ready");
    }
    let current = connection
        .query_row(
            r#"
            SELECT state, generation, root_identity_digest, catalog_digest,
                   root_relative_path
            FROM camp_attachment_view WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
        .context("camp_attachment_view_not_ready")?;
    if current.0 != "ready" || current.1 < 1 || current.4 != camp_attachment_root_relative(camp_id)
    {
        anyhow::bail!("camp_attachment_view_not_ready");
    }
    let compatibility_generation = match visibility_mode {
        CampAttachmentVisibilityMode::LiveAppendV1 => None,
        CampAttachmentVisibilityMode::GenerationFencedV1 => Some(current.1),
    };
    let auth = RuntimeAttachmentAuthReceiptV1 {
        schema_version: RUNTIME_ATTACHMENT_AUTH_RECEIPT_VERSION,
        camp_id: camp_id.to_string(),
        published_attachment_root: resolve_root_relative_runtime_path(connection, &current.4)?
            .to_string_lossy()
            .into_owned(),
        root_identity_digest: current.2,
        dispatch_generation: current.1,
        catalog_digest_at_dispatch: current.3,
        visibility_mode: visibility_mode.as_str().to_string(),
        compatibility_generation,
        manifest_view_receipt_digest: manifest_view_receipt_digest.to_string(),
    };
    let digest = canonical_json_digest(&serde_json::to_value(&auth)?)?;
    Ok((auth, digest))
}

pub fn runtime_camp_root_attachment_auth_receipt(
    connection: &Connection,
    camp_id: &str,
    manifest_view_receipt_digest: &str,
) -> Result<(RuntimeAttachmentAuthReceiptV1, String)> {
    CampId::parse(camp_id)?;
    let root_identity_digest = connection
        .query_row(
            "SELECT rovai_runtime_camp_files_root_identity_digest()",
            [],
            |row| row.get::<_, String>(0),
        )
        .context("runtime_camp_files_root_invalid: connection has no admitted root identity")?;
    let auth = RuntimeAttachmentAuthReceiptV1 {
        schema_version: RUNTIME_ATTACHMENT_AUTH_RECEIPT_VERSION,
        camp_id: camp_id.to_string(),
        published_attachment_root: resolve_camp_attachment_root(connection, camp_id)?,
        root_identity_digest: root_identity_digest.clone(),
        dispatch_generation: 0,
        catalog_digest_at_dispatch: camp_root_authorization_digest(camp_id, &root_identity_digest)?,
        visibility_mode: CampAttachmentVisibilityMode::LiveAppendV1
            .as_str()
            .to_string(),
        compatibility_generation: None,
        manifest_view_receipt_digest: manifest_view_receipt_digest.to_string(),
    };
    let digest = canonical_json_digest(&serde_json::to_value(&auth)?)?;
    Ok((auth, digest))
}

fn camp_root_authorization_digest(camp_id: &str, root_identity_digest: &str) -> Result<String> {
    canonical_json_digest(&json!({
        "schemaVersion": 1,
        "campId": camp_id,
        "rootIdentityDigest": root_identity_digest,
        "scope": "camp_attachment_root",
    }))
}

pub fn validate_frozen_camp_attachment_view_receipt(
    receipt: &CampAttachmentViewReceiptV2,
) -> Result<()> {
    CampId::parse(&receipt.camp_id)?;
    if receipt.schema_version != CAMP_ATTACHMENT_VIEW_RECEIPT_VERSION
        || receipt.attachment_root_relative_path != camp_attachment_root_relative(&receipt.camp_id)
    {
        anyhow::bail!("camp_attachment_view_generation_mismatch: receipt version or counters");
    }
    let mut referenced = receipt.referenced_entries.clone();
    referenced.sort_by(|left, right| {
        left.attachment_id
            .as_bytes()
            .cmp(right.attachment_id.as_bytes())
    });
    referenced.dedup_by(|left, right| left.attachment_id == right.attachment_id);
    if referenced != receipt.referenced_entries
        || canonical_json_digest(&json!(referenced))? != receipt.referenced_entries_digest
    {
        anyhow::bail!("camp_attachment_view_generation_mismatch: referenced attachment set digest");
    }
    for entry in &receipt.referenced_entries {
        validate_attachment_id(&entry.attachment_id)?;
        validate_root_relative_path(Path::new(&entry.root_relative_payload_path))?;
    }
    if receipt.catalog_revision == LEGACY_VIEW_NOT_REQUIRED_REVISION {
        if receipt.catalog_entry_count != 0
            || !receipt.referenced_entries.is_empty()
            || receipt.semantic_catalog_digest != canonical_json_digest(&Value::Array(Vec::new()))?
        {
            anyhow::bail!(
                "camp_attachment_view_generation_mismatch: no-legacy receipt is inconsistent"
            );
        }
        return Ok(());
    }
    if receipt.catalog_revision < 0 || receipt.catalog_entry_count < 0 {
        anyhow::bail!("camp_attachment_view_generation_mismatch: receipt version or counters");
    }
    Ok(())
}

pub fn validate_append_only_view_receipt(
    connection: &Connection,
    receipt: &CampAttachmentViewReceiptV2,
) -> Result<()> {
    validate_frozen_camp_attachment_view_receipt(receipt)?;
    if receipt.catalog_revision == LEGACY_VIEW_NOT_REQUIRED_REVISION {
        return Ok(());
    }
    let current = connection
        .query_row(
            r#"
            SELECT state, catalog_revision, root_relative_path,
                   semantic_catalog_digest
            FROM camp_attachment_view WHERE camp_id = ?1
            "#,
            [&receipt.camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?
        .context("camp_attachment_view_generation_mismatch")?;
    if current.0 != "ready"
        || current.1 < receipt.catalog_revision
        || current.2 != receipt.attachment_root_relative_path
    {
        anyhow::bail!(
            "camp_attachment_view_generation_mismatch: current semantic root, state, or revision"
        );
    }
    for expected in &receipt.referenced_entries {
        let actual = connection
            .query_row(
                r#"
                SELECT attachment_id, kind, byte_size, file_count,
                       directory_count, node_count, content_digest,
                       root_relative_final_path || '/payload/' || authority_safe_leaf,
                       published_catalog_revision
                FROM camp_attachment_view_entry
                WHERE camp_id = ?1 AND attachment_id = ?2
                "#,
                params![receipt.camp_id, expected.attachment_id],
                |row| {
                    Ok((
                        SemanticAttachmentEntryV1 {
                            attachment_id: row.get(0)?,
                            kind: row.get(1)?,
                            byte_size: row.get(2)?,
                            file_count: row.get(3)?,
                            directory_count: row.get(4)?,
                            node_count: row.get(5)?,
                            content_digest: row.get(6)?,
                            root_relative_payload_path: row.get(7)?,
                        },
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()?
            .context("camp_attachment_view_generation_mismatch")?;
        if actual.0 != *expected || actual.1 > receipt.catalog_revision {
            anyhow::bail!(
                "camp_attachment_view_generation_mismatch: referenced attachment semantic identity changed"
            );
        }
    }
    let (entry_count, _, semantic_catalog_digest) = semantic_catalog_state_through_revision(
        connection,
        &receipt.camp_id,
        Some(receipt.catalog_revision),
    )?;
    if entry_count != receipt.catalog_entry_count
        || semantic_catalog_digest != receipt.semantic_catalog_digest
    {
        anyhow::bail!(
            "camp_attachment_view_generation_mismatch: frozen catalog is not an append-only ancestor"
        );
    }
    if current.1 == receipt.catalog_revision && current.3 != receipt.semantic_catalog_digest {
        anyhow::bail!(
            "camp_attachment_view_generation_mismatch: current semantic catalog digest changed"
        );
    }
    Ok(())
}

pub fn instance_key(canonical_user_data_path: &Path) -> Result<String> {
    let value = canonical_user_data_path
        .to_str()
        .context("userData path is not valid UTF-8")?;
    let mut hasher = Sha256::new();
    hasher.update(INSTANCE_KEY_DOMAIN);
    hasher.update(value.as_bytes());
    Ok(format!("v1-{:x}", hasher.finalize()))
}

pub(crate) fn runtime_root_identity_digest_for_database(root: &Path) -> Result<String> {
    if root.exists() {
        directory_identity_digest(root)
    } else {
        let mut hasher = Sha256::new();
        hasher.update(b"rovai-runtime-camp-files-unmaterialized-root-v1\0");
        hasher.update(root.to_string_lossy().as_bytes());
        Ok(format!("sha256:{:x}", hasher.finalize()))
    }
}

pub(crate) fn preflight_empty_runtime_root_for_v99(root: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("v99 runtime_camp_files_root_invalid: Runtime Files Root is unsafe");
    }
    for entry in fs::read_dir(root)?.collect::<std::io::Result<Vec<_>>>()? {
        let name = entry.file_name().into_string().map_err(|_| {
            anyhow::anyhow!("v99 runtime_camp_files_root_invalid: non-UTF8 root entry")
        })?;
        let entry_metadata = fs::symlink_metadata(entry.path())?;
        match name.as_str() {
            ROOT_MARKER | ROOT_LOCK if entry_metadata.is_file() => {}
            ".staging" | "camps"
                if entry_metadata.is_dir() && !entry_metadata.file_type().is_symlink() =>
            {
                if !preflight_directory_is_empty(&entry.path())? {
                    anyhow::bail!(
                        "v99 runtime_camp_files_root_invalid: managed root entry {name} is unsafe or non-empty"
                    );
                }
            }
            ROOT_MARKER | ROOT_LOCK | ".staging" | "camps" => {
                anyhow::bail!(
                    "v99 runtime_camp_files_root_invalid: managed root entry {name} is unsafe or non-empty"
                );
            }
            _ => {
                anyhow::bail!(
                    "v99 runtime_camp_files_root_invalid: Runtime Files Root contains unknown entry {name}"
                );
            }
        }
    }
    Ok(())
}

fn preflight_directory_is_empty(path: &Path) -> Result<bool> {
    #[cfg(unix)]
    let original_mode = {
        use std::os::unix::fs::PermissionsExt;
        fs::symlink_metadata(path)?.permissions().mode() & 0o777
    };
    #[cfg(unix)]
    if original_mode & 0o500 != 0o500 {
        set_directory_mode(path, original_mode | 0o500)?;
    }
    let inspection = fs::read_dir(path)
        .and_then(|mut entries| entries.next().transpose())
        .map(|entry| entry.is_none());
    #[cfg(unix)]
    let restore = if original_mode & 0o500 != 0o500 {
        set_directory_mode(path, original_mode)
    } else {
        Ok(())
    };
    #[cfg(unix)]
    restore?;
    inspection.map_err(Into::into)
}

fn commit_operation_entries(
    transaction: &Transaction<'_>,
    operation_id: &str,
    camp_id: &str,
    attachment_ids: &[String],
) -> Result<()> {
    validate_operation_id(operation_id)?;
    CampId::parse(camp_id)?;
    let (operation_kind, status): (String, String) = transaction.query_row(
        "SELECT kind, status FROM camp_attachment_view_operation WHERE id = ?1 AND camp_id = ?2",
        params![operation_id, camp_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if status != "committing" {
        anyhow::bail!("camp_attachment_view_publish_failed: operation was not promoted");
    }
    let operation_ids = load_operation_attachment_ids(transaction, operation_id, "promoted")?;
    if operation_ids != attachment_ids {
        anyhow::bail!("camp_attachment_view_publish_failed: Draft and View entries differ");
    }
    let (current_generation, current_catalog_revision, current_semantic_digest): (
        i64,
        i64,
        String,
    ) = transaction.query_row(
        r#"
        SELECT generation, catalog_revision, semantic_catalog_digest
        FROM camp_attachment_view
        WHERE camp_id = ?1 AND state = 'mutating' AND active_operation_id = ?2
        "#,
        params![camp_id, operation_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let (current_semantic_entry_count, _, computed_semantic_digest) =
        semantic_catalog_state(transaction, camp_id)?;
    if computed_semantic_digest != current_semantic_digest {
        anyhow::bail!("camp_attachment_view_integrity_failed: semantic catalog receipt changed");
    }
    let next_generation = current_generation
        .checked_add(1)
        .context("Camp Attachment View generation overflow")?;
    let next_catalog_revision = if operation_kind == "controlled_rebuild" {
        current_catalog_revision
    } else {
        current_catalog_revision
            .checked_add(1)
            .context("Camp Attachment View catalog revision overflow")?
    };
    if operation_kind == "controlled_rebuild" {
        let (entry_count, _, semantic_digest) = semantic_catalog_state(transaction, camp_id)?;
        if entry_count != current_semantic_entry_count || semantic_digest != current_semantic_digest
        {
            anyhow::bail!(
                "camp_attachment_view_integrity_failed: semantic catalog changed before rebuild commit"
            );
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    for attachment_id in attachment_ids {
        if operation_kind == "controlled_rebuild" {
            let updated = transaction.execute(
                r#"
                UPDATE camp_attachment_view_entry AS current
                SET entry_identity_digest = (
                        SELECT staged.final_identity_digest
                        FROM camp_attachment_view_operation_entry AS staged
                        WHERE staged.operation_id = ?1
                          AND staged.attachment_id = ?3
                          AND staged.state = 'promoted'
                    ),
                    published_generation = ?4,
                    publication_operation_id = ?1
                WHERE current.camp_id = ?2 AND current.attachment_id = ?3
                  AND EXISTS (
                      SELECT 1 FROM camp_attachment_view_operation_entry AS staged
                      WHERE staged.operation_id = ?1
                        AND staged.attachment_id = current.attachment_id
                        AND staged.state = 'promoted'
                        AND staged.kind = current.kind
                        AND staged.expected_byte_size = current.byte_size
                        AND staged.file_count = current.file_count
                        AND staged.directory_count = current.directory_count
                        AND staged.node_count = current.node_count
                        AND staged.expected_content_digest = current.content_digest
                        AND staged.authority_safe_leaf = current.authority_safe_leaf
                        AND staged.root_relative_final_path = current.root_relative_final_path
                  )
                "#,
                params![operation_id, camp_id, attachment_id, next_generation],
            )?;
            if updated != 1 {
                anyhow::bail!(
                    "camp_attachment_view_integrity_failed: rebuild changed semantic Entry identity"
                );
            }
        } else {
            let inserted = transaction.execute(
                r#"
                INSERT INTO camp_attachment_view_entry(
                    camp_id, attachment_id, kind, byte_size, file_count,
                    directory_count, node_count, content_digest,
                    authority_safe_leaf, root_relative_final_path,
                    entry_identity_digest, published_generation,
                    published_catalog_revision,
                    publication_operation_id, created_at
                )
                SELECT ?2, entry.attachment_id, entry.kind, entry.expected_byte_size,
                       entry.file_count, entry.directory_count, entry.node_count,
                       entry.expected_content_digest, entry.authority_safe_leaf,
                       entry.root_relative_final_path, entry.final_identity_digest,
                       ?4, ?5, ?1, ?6
                FROM camp_attachment_view_operation_entry AS entry
                WHERE entry.operation_id = ?1 AND entry.attachment_id = ?3
                  AND entry.state = 'promoted'
                "#,
                params![
                    operation_id,
                    camp_id,
                    attachment_id,
                    next_generation,
                    next_catalog_revision,
                    now
                ],
            )?;
            if inserted != 1 {
                anyhow::bail!("camp_attachment_view_publish_failed: View Entry was not inserted");
            }
        }
        let updated = transaction.execute(
            "UPDATE camp_attachment_view_operation_entry SET state = 'committed', updated_at = ?3 WHERE operation_id = ?1 AND attachment_id = ?2 AND state = 'promoted'",
            params![operation_id, attachment_id, now],
        )?;
        if updated != 1 {
            anyhow::bail!("camp_attachment_view_publish_failed: operation entry was not committed");
        }
    }
    let (entry_count, aggregate_bytes, catalog_digest) = catalog_state(transaction, camp_id)?;
    let (semantic_entry_count, _, semantic_catalog_digest) =
        semantic_catalog_state(transaction, camp_id)?;
    if operation_kind == "controlled_rebuild"
        && (semantic_entry_count != current_semantic_entry_count
            || semantic_catalog_digest != current_semantic_digest)
    {
        anyhow::bail!(
            "camp_attachment_view_integrity_failed: controlled rebuild changed semantic catalog"
        );
    }
    let view_updated = transaction.execute(
        r#"
        UPDATE camp_attachment_view
        SET state = 'ready', generation = ?3, entry_count = ?4,
            aggregate_bytes = ?5, catalog_digest = ?6,
            catalog_revision = ?7, semantic_catalog_digest = ?8,
            root_identity_digest = rovai_runtime_camp_files_root_identity_digest(),
            active_operation_id = NULL, last_error_code = NULL, updated_at = ?9
        WHERE camp_id = ?1 AND active_operation_id = ?2 AND state = 'mutating'
        "#,
        params![
            camp_id,
            operation_id,
            next_generation,
            entry_count,
            aggregate_bytes,
            catalog_digest,
            next_catalog_revision,
            semantic_catalog_digest,
            now,
        ],
    )?;
    if view_updated != 1 {
        anyhow::bail!("camp_attachment_view_publish_failed: View generation was not committed");
    }
    let operation_updated = transaction.execute(
        "UPDATE camp_attachment_view_operation SET status = 'committed', updated_at = ?2 WHERE id = ?1 AND status = 'committing'",
        params![operation_id, now],
    )?;
    if operation_updated != 1 {
        anyhow::bail!("camp_attachment_view_publish_failed: operation was not committed");
    }
    Ok(())
}

fn mark_operation_committing(
    transaction: &Transaction<'_>,
    operation_id: &str,
    camp_id: &str,
) -> Result<()> {
    validate_operation_id(operation_id)?;
    CampId::parse(camp_id)?;
    let changed = transaction.execute(
        r#"
        UPDATE camp_attachment_view_operation
        SET status = 'committing', updated_at = ?3
        WHERE id = ?1 AND camp_id = ?2 AND status = 'promoted'
        "#,
        params![operation_id, camp_id, chrono::Utc::now().to_rfc3339()],
    )?;
    if changed != 1 {
        anyhow::bail!("camp_attachment_view_publish_failed: operation was not promoted");
    }
    Ok(())
}

fn catalog_state(connection: &Connection, camp_id: &str) -> Result<(i64, i64, String)> {
    catalog_state_through_generation(connection, camp_id, None)
}

fn catalog_state_through_generation(
    connection: &Connection,
    camp_id: &str,
    maximum_generation: Option<i64>,
) -> Result<(i64, i64, String)> {
    let mut statement = connection.prepare(
        r#"
        SELECT entry.attachment_id, entry.kind, entry.byte_size, entry.file_count,
               entry.directory_count, entry.node_count, entry.content_digest,
               entry.authority_safe_leaf, entry.root_relative_final_path,
               entry.entry_identity_digest, entry.published_generation,
               entry.publication_operation_id
        FROM camp_attachment_view_entry AS entry
        JOIN message_attachment AS attachment
          ON attachment.camp_id = entry.camp_id
         AND attachment.id = entry.attachment_id
        JOIN camp_attachment_view AS view
          ON view.camp_id = entry.camp_id
        WHERE entry.camp_id = ?1
          AND (
              attachment.runtime_projection_state IN ('available', 'pending')
              OR (
                  attachment.runtime_projection_state = 'recovery_required'
                  AND entry.publication_operation_id = view.active_operation_id
              )
          )
          AND (?2 IS NULL OR entry.published_generation <= ?2)
        ORDER BY CAST(entry.attachment_id AS BLOB)
        "#,
    )?;
    let rows = statement
        .query_map(params![camp_id, maximum_generation], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let aggregate_bytes = rows.iter().try_fold(0_i64, |total, row| {
        total
            .checked_add(row.2)
            .context("Camp View byte total overflow")
    })?;
    let values = rows
        .iter()
        .map(|row| {
            serde_json::to_value(PhysicalCatalogEntryReceipt {
                attachment_id: &row.0,
                kind: &row.1,
                byte_size: row.2,
                file_count: row.3,
                directory_count: row.4,
                node_count: row.5,
                content_digest: &row.6,
                authority_safe_leaf: &row.7,
                root_relative_final_path: &row.8,
                entry_identity_digest: &row.9,
                published_generation: row.10,
                publication_operation_id: &row.11,
            })
        })
        .collect::<serde_json::Result<Vec<_>>>()?;
    Ok((
        rows.len() as i64,
        aggregate_bytes,
        canonical_json_digest(&Value::Array(values))?,
    ))
}

fn empty_catalog_digest() -> Result<String> {
    canonical_json_digest(&Value::Array(Vec::new()))
}

fn semantic_catalog_state(connection: &Connection, camp_id: &str) -> Result<(i64, i64, String)> {
    semantic_catalog_state_through_revision(connection, camp_id, None)
}

fn semantic_catalog_state_through_revision(
    connection: &Connection,
    camp_id: &str,
    maximum_revision: Option<i64>,
) -> Result<(i64, i64, String)> {
    let mut statement = connection.prepare(
        r#"
        SELECT attachment_id, kind, byte_size, file_count, directory_count,
               node_count, content_digest, root_relative_final_path,
               authority_safe_leaf
        FROM camp_attachment_view_entry
        WHERE camp_id = ?1
          AND (?2 IS NULL OR published_catalog_revision <= ?2)
        ORDER BY CAST(attachment_id AS BLOB)
        "#,
    )?;
    let rows = statement
        .query_map(params![camp_id, maximum_revision], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let aggregate_bytes = rows.iter().try_fold(0_i64, |total, row| {
        total
            .checked_add(row.2)
            .context("Camp semantic View byte total overflow")
    })?;
    let values = rows
        .iter()
        .map(|row| {
            serde_json::to_value(SemanticCatalogEntryReceipt {
                attachment_id: &row.0,
                kind: &row.1,
                byte_size: row.2,
                file_count: row.3,
                directory_count: row.4,
                node_count: row.5,
                content_digest: &row.6,
                root_relative_payload_path: format!("{}/payload/{}", row.7, row.8),
            })
        })
        .collect::<serde_json::Result<Vec<_>>>()?;
    Ok((
        rows.len() as i64,
        aggregate_bytes,
        canonical_json_digest(&Value::Array(values))?,
    ))
}

pub(crate) fn backfill_semantic_catalog_receipts_v100(connection: &Connection) -> Result<()> {
    connection.execute(
        "UPDATE camp_attachment_view_entry SET published_catalog_revision = 1",
        [],
    )?;
    let camp_ids = {
        let mut statement = connection
            .prepare("SELECT camp_id FROM camp_attachment_view ORDER BY CAST(camp_id AS BLOB)")?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for camp_id in camp_ids {
        CampId::parse(&camp_id)?;
        let (entry_count, aggregate_bytes, semantic_catalog_digest) =
            semantic_catalog_state(connection, &camp_id)?;
        let catalog_revision = i64::from(entry_count > 0);
        let changed = connection.execute(
            r#"
            UPDATE camp_attachment_view
            SET catalog_revision = ?2, semantic_catalog_digest = ?3
            WHERE camp_id = ?1 AND entry_count = ?4 AND aggregate_bytes = ?5
            "#,
            params![
                camp_id,
                catalog_revision,
                semantic_catalog_digest,
                entry_count,
                aggregate_bytes
            ],
        )?;
        if changed != 1 {
            anyhow::bail!(
                "v100 camp_attachment_view_integrity_failed: persisted View aggregate differs from semantic catalog"
            );
        }
    }
    Ok(())
}

fn verify_ready_camp_view(
    connection: &Connection,
    root: &Path,
    root_identity_digest: &str,
    camp_id: &str,
) -> Result<()> {
    let verification =
        prepare_ready_camp_view_verification(connection, root, root_identity_digest, camp_id)?;
    inspect_ready_camp_view(&verification)?;
    confirm_ready_camp_view(connection, &verification)
}

fn prepare_ready_camp_view_verification(
    connection: &Connection,
    root: &Path,
    root_identity_digest: &str,
    camp_id: &str,
) -> Result<CampAttachmentViewVerification> {
    CampId::parse(camp_id)?;
    let receipt = load_ready_camp_view_receipt(connection, root_identity_digest, camp_id)?;

    let desired = load_published_authority_rows(connection, camp_id)?;
    let desired_ids = desired
        .iter()
        .map(|row| row.attachment_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let persisted_ids = load_view_entry_ids(connection, camp_id)?;
    if desired_ids != persisted_ids {
        anyhow::bail!("Published Attachment and View Entry catalogs differ");
    }

    let entries = load_committed_view_entries(connection, camp_id)?;
    for entry in &entries {
        verify_committed_view_entry_receipt(camp_id, entry)?;
    }
    let (entry_count, aggregate_bytes, catalog_digest) = catalog_state(connection, camp_id)?;
    if entry_count != receipt.entry_count
        || aggregate_bytes != receipt.aggregate_bytes
        || catalog_digest != receipt.catalog_digest
    {
        anyhow::bail!("Camp Attachment View aggregate receipt is inconsistent");
    }
    let (_, _, semantic_catalog_digest) = semantic_catalog_state(connection, camp_id)?;
    if semantic_catalog_digest != receipt.semantic_catalog_digest {
        anyhow::bail!("Camp Attachment View semantic receipt is inconsistent");
    }
    verify_resolution_ledger(connection, camp_id, &receipt)?;
    Ok(CampAttachmentViewVerification {
        camp_id: camp_id.to_string(),
        root: root.to_path_buf(),
        receipt,
        filesystem_ids: persisted_ids,
        entries,
    })
}

fn load_ready_camp_view_receipt(
    connection: &Connection,
    root_identity_digest: &str,
    camp_id: &str,
) -> Result<ReadyCampViewReceipt> {
    let view = connection
        .query_row(
            r#"
            SELECT state, generation, root_relative_path, root_identity_digest,
                   entry_count, aggregate_bytes, catalog_digest,
                   catalog_revision, semantic_catalog_digest,
                   active_operation_id, semantic_revision,
                   resolved_revision, resolution_digest
            FROM camp_attachment_view WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, String>(12)?,
                ))
            },
        )
        .optional()?
        .context("Camp Attachment View state is missing")?;
    if view.0 != "ready"
        || view.1 < 1
        || view.2 != camp_attachment_root_relative(camp_id)
        || view.3 != root_identity_digest
        || view.4 < 0
        || view.5 < 0
        || view.7 < 0
        || view.9.is_some()
        || view.10 < 0
        || view.11 < 0
        || view.11 > view.10
    {
        anyhow::bail!("Camp Attachment View state receipt is inconsistent");
    }
    Ok(ReadyCampViewReceipt {
        generation: view.1,
        root_relative_path: view.2,
        root_identity_digest: view.3,
        entry_count: view.4,
        aggregate_bytes: view.5,
        catalog_digest: view.6,
        catalog_revision: view.7,
        semantic_catalog_digest: view.8,
        semantic_revision: view.10,
        resolved_revision: view.11,
        resolution_digest: view.12,
    })
}

fn verify_resolution_ledger(
    connection: &Connection,
    camp_id: &str,
    receipt: &ReadyCampViewReceipt,
) -> Result<()> {
    let empty_digest = empty_catalog_digest()?;
    let rows = {
        let mut statement = connection.prepare(
            r#"
            SELECT semantic_revision, operation_id, outcome,
                   entry_digest, tombstone_digest, failure_code
            FROM camp_attachment_publication_resolution
            WHERE camp_id = ?1
            ORDER BY semantic_revision
            "#,
        )?;
        statement
            .query_map([camp_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if receipt.resolved_revision == 0 {
        if !rows.is_empty() || receipt.resolution_digest != empty_digest {
            anyhow::bail!("Camp Attachment empty resolution ledger is inconsistent");
        }
        return Ok(());
    }
    let mut previous_revision = 0_i64;
    let mut digest = empty_digest;
    for (revision, operation_id, outcome, entry_digest, tombstone_digest, failure_code) in rows {
        if operation_id.is_none() {
            // A migration checkpoint seals the catalog prefix that existed at
            // its revision; later semantic publications append to that prefix.
            let (_, _, checkpoint_catalog_digest) =
                semantic_catalog_state_through_revision(connection, camp_id, Some(revision))?;
            if previous_revision != 0
                || outcome != "available"
                || revision < 1
                || entry_digest.as_deref() != Some(checkpoint_catalog_digest.as_str())
                || tombstone_digest.is_some()
                || failure_code.is_some()
            {
                anyhow::bail!("Camp Attachment migration resolution checkpoint is inconsistent");
            }
            previous_revision = revision;
            digest = entry_digest.expect("checked migration checkpoint digest");
            continue;
        }
        if revision != previous_revision + 1 {
            anyhow::bail!("Camp Attachment resolution ledger is not contiguous");
        }
        let operation_id = operation_id.expect("checked operation ID");
        let (operation_revision, operation_resolution, operation_digest, operation_failure): (
            i64,
            String,
            Option<String>,
            Option<String>,
        ) = connection.query_row(
            r#"
            SELECT semantic_revision, resolution_state,
                   resolution_ledger_digest, terminal_failure_code
            FROM camp_attachment_view_operation
            WHERE id = ?1 AND camp_id = ?2
            "#,
            params![operation_id, camp_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if operation_revision != revision || operation_resolution != outcome {
            anyhow::bail!("Camp Attachment resolution operation receipt is inconsistent");
        }
        let attachment_ids = load_all_operation_attachment_ids(connection, &operation_id)?;
        let projected_attachment_ids = {
            let mut statement = connection.prepare(
                r#"
                SELECT id FROM message_attachment
                WHERE publication_operation_id = ?1
                  AND publication_semantic_revision = ?2
                  AND (
                      (?3 = 'available' AND runtime_projection_state IN (
                          'available', 'recovery_required'
                      ))
                      OR (?3 = 'failed' AND runtime_projection_state = 'failed')
                  )
                ORDER BY id
                "#,
            )?;
            statement
                .query_map(params![operation_id, revision, outcome], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut expected_projected_ids = attachment_ids.clone();
        expected_projected_ids.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
        if projected_attachment_ids != expected_projected_ids {
            anyhow::bail!("Camp Attachment public resolution state is inconsistent");
        }
        digest = match outcome.as_str() {
            "available" => {
                let expected_entry_digest = canonical_json_digest(&json!({
                    "operationId": operation_id,
                    "semanticRevision": revision,
                    "attachmentIds": attachment_ids,
                    "outcome": "available",
                }))?;
                if entry_digest.as_deref() != Some(expected_entry_digest.as_str())
                    || tombstone_digest.is_some()
                    || failure_code.is_some()
                {
                    anyhow::bail!("Camp Attachment available resolution receipt is inconsistent");
                }
                canonical_json_digest(&json!({
                    "previous": digest,
                    "revision": revision,
                    "entryDigest": expected_entry_digest,
                }))?
            }
            "failed" => {
                let mut attachment_ids = attachment_ids;
                attachment_ids.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
                let failure_code = failure_code
                    .as_deref()
                    .context("Camp Attachment failed resolution has no failure code")?;
                let expected_tombstone_digest = canonical_json_digest(&json!({
                    "operationId": operation_id,
                    "semanticRevision": revision,
                    "attachmentIds": attachment_ids,
                    "outcome": "failed",
                    "failureCode": failure_code,
                }))?;
                if tombstone_digest.as_deref() != Some(expected_tombstone_digest.as_str())
                    || entry_digest.is_some()
                    || operation_failure.as_deref() != Some(failure_code)
                {
                    anyhow::bail!("Camp Attachment failed resolution tombstone is inconsistent");
                }
                canonical_json_digest(&json!({
                    "previous": digest,
                    "revision": revision,
                    "tombstoneDigest": expected_tombstone_digest,
                }))?
            }
            _ => anyhow::bail!("Camp Attachment resolution outcome is invalid"),
        };
        if operation_digest.as_deref() != Some(digest.as_str()) {
            anyhow::bail!("Camp Attachment operation resolution digest is inconsistent");
        }
        previous_revision = revision;
    }
    if previous_revision != receipt.resolved_revision || digest != receipt.resolution_digest {
        anyhow::bail!("Camp Attachment resolution ledger aggregate is inconsistent");
    }
    Ok(())
}

fn inspect_ready_camp_view(verification: &CampAttachmentViewVerification) -> Result<()> {
    #[cfg(test)]
    pause_view_verification_for_test(&verification.camp_id);
    if directory_identity_digest(&verification.root)? != verification.receipt.root_identity_digest {
        anyhow::bail!("Runtime Files Root identity changed");
    }

    let camps_root = verification.root.join("camps");
    let camp_root = camps_root.join(&verification.camp_id);
    let attachment_root = camp_root.join("attachments");
    validate_managed_directory(&camps_root, Some(0o100))?;
    validate_managed_directory(&camp_root, Some(0o100))?;
    validate_managed_directory(&attachment_root, Some(0o500))?;

    let filesystem_ids = read_typed_attachment_directory_ids(&attachment_root)?;
    if filesystem_ids != verification.filesystem_ids {
        anyhow::bail!("Runtime Attachment filesystem catalog differs from SQLite");
    }

    for entry in &verification.entries {
        verify_committed_view_entry(&verification.root, &verification.camp_id, entry)?;
    }
    Ok(())
}

fn confirm_ready_camp_view(
    connection: &Connection,
    verification: &CampAttachmentViewVerification,
) -> Result<()> {
    let current = load_ready_camp_view_receipt(
        connection,
        &verification.receipt.root_identity_digest,
        &verification.camp_id,
    )?;
    if current != verification.receipt {
        anyhow::bail!("Camp Attachment View changed during physical verification");
    }
    let persisted_ids = load_view_entry_ids(connection, &verification.camp_id)?;
    if persisted_ids != verification.filesystem_ids {
        anyhow::bail!("Camp Attachment View catalog changed during physical verification");
    }
    Ok(())
}

fn load_committed_view_entries(
    connection: &Connection,
    camp_id: &str,
) -> Result<Vec<CommittedViewEntryRow>> {
    let mut statement = connection.prepare(
        r#"
        SELECT entry.attachment_id, entry.kind, entry.byte_size,
               entry.file_count, entry.directory_count, entry.node_count,
               entry.content_digest, entry.authority_safe_leaf,
               entry.root_relative_final_path, entry.entry_identity_digest,
               attachment.media_type, attachment.byte_size, attachment.content_digest
        FROM camp_attachment_view_entry AS entry
        JOIN message_attachment AS attachment
          ON attachment.camp_id = entry.camp_id
         AND attachment.id = entry.attachment_id
        WHERE entry.camp_id = ?1
          AND attachment.runtime_projection_state IN ('available', 'pending')
        ORDER BY CAST(entry.attachment_id AS BLOB)
        "#,
    )?;
    let raw = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, String>(12)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    raw.into_iter()
        .map(|row| {
            Ok(CommittedViewEntryRow {
                attachment_id: row.0,
                kind: row.1,
                byte_size: nonnegative_u64(row.2, "View byte size")?,
                file_count: nonnegative_u64(row.3, "View file count")?,
                directory_count: nonnegative_u64(row.4, "View directory count")?,
                node_count: nonnegative_u64(row.5, "View node count")?,
                content_digest: row.6,
                authority_safe_leaf: row.7,
                root_relative_final_path: row.8,
                entry_identity_digest: row.9,
                media_type: row.10,
                authority_byte_size: nonnegative_u64(row.11, "Authority byte size")?,
                authority_content_digest: row.12,
            })
        })
        .collect()
}

fn verify_committed_view_entry(
    root: &Path,
    camp_id: &str,
    entry: &CommittedViewEntryRow,
) -> Result<()> {
    verify_committed_view_entry_receipt(camp_id, entry)?;
    let expected_relative = final_entry_relative(camp_id, &entry.attachment_id);
    let entry_root = root.join(&expected_relative);
    validate_managed_directory(&entry_root, Some(0o500))?;
    if entry_identity_digest(&entry_root)? != entry.entry_identity_digest {
        anyhow::bail!("View Entry identity changed");
    }
    let entry_names = read_exact_utf8_names(&entry_root)?;
    if entry_names.as_slice() != ["payload"] {
        anyhow::bail!("View Entry contains an unexpected node");
    }
    let payload_root = entry_root.join("payload");
    validate_managed_directory(&payload_root, Some(0o500))?;
    let payload_names = read_exact_utf8_names(&payload_root)?;
    if payload_names.as_slice() != [entry.authority_safe_leaf.as_str()] {
        anyhow::bail!("View Entry payload leaf differs from its receipt");
    }
    let payload = payload_root.join(&entry.authority_safe_leaf);
    validate_runtime_tree_modes(&payload)?;
    let inspected = inspect_runtime_attachment_copy(&payload)?;
    if inspected.authority_safe_leaf != entry.authority_safe_leaf
        || inspected.kind != entry.kind
        || inspected.file_count != entry.file_count
        || inspected.directory_count != entry.directory_count
        || inspected.node_count != entry.node_count
        || inspected.byte_size != entry.byte_size
        || inspected.content_digest != entry.content_digest
    {
        anyhow::bail!("View Entry content receipt differs from the filesystem");
    }
    Ok(())
}

fn verify_committed_view_entry_receipt(camp_id: &str, entry: &CommittedViewEntryRow) -> Result<()> {
    validate_attachment_id(&entry.attachment_id)?;
    let expected_relative = final_entry_relative(camp_id, &entry.attachment_id);
    if entry.root_relative_final_path != expected_relative
        || entry.byte_size != entry.authority_byte_size
        || entry.content_digest != entry.authority_content_digest
        || (entry.media_type == DIRECTORY_MEDIA_TYPE) != (entry.kind == "directory")
    {
        anyhow::bail!("View Entry authority receipt is inconsistent");
    }
    Ok(())
}

fn read_typed_attachment_directory_ids(path: &Path) -> Result<std::collections::BTreeSet<String>> {
    read_exact_utf8_names(path)?
        .into_iter()
        .filter(|name| name != MANAGED_V2_DIRECTORY)
        .map(|name| {
            validate_attachment_id(&name)?;
            Ok(name)
        })
        .collect()
}

fn read_exact_utf8_names(path: &Path) -> Result<Vec<String>> {
    let mut names = fs::read_dir(path)?
        .map(|entry| {
            let entry = entry?;
            entry
                .file_name()
                .into_string()
                .map_err(|_| anyhow::anyhow!("Runtime Attachment View contains a non-UTF8 name"))
        })
        .collect::<Result<Vec<_>>>()?;
    names.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    Ok(names)
}

fn nonnegative_u64(value: i64, label: &str) -> Result<u64> {
    u64::try_from(value).with_context(|| format!("{label} is negative"))
}

fn validate_managed_directory(path: &Path, unix_mode: Option<u32>) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Runtime Attachment View directory identity is unsafe");
    }
    #[cfg(unix)]
    if let Some(expected) = unix_mode {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o777 != expected {
            anyhow::bail!("Runtime Attachment View directory mode is not {expected:o}");
        }
    }
    #[cfg(not(unix))]
    let _ = unix_mode;
    Ok(())
}

fn validate_runtime_tree_modes(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Runtime Attachment View contains a symlink");
    }
    if metadata.is_dir() {
        validate_managed_directory(path, Some(0o500))?;
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            validate_runtime_tree_modes(&child.path())?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        anyhow::bail!("Runtime Attachment View contains an unsupported node");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o777 != 0o400 || metadata.nlink() != 1 {
            anyhow::bail!("Runtime Attachment View file mode or link count is unsafe");
        }
    }
    Ok(())
}

fn load_prepared_authority_rows(
    connection: &Connection,
    camp_id: &str,
) -> Result<Vec<AuthorityAttachmentRow>> {
    load_authority_rows(
        connection,
        r#"
        SELECT id, media_type, byte_size, content_digest, storage_path
        FROM prepared_attachment
        WHERE camp_id = ?1 AND state = 'ready'
        ORDER BY ordinal, id
        "#,
        camp_id,
    )
}

fn load_published_authority_rows(
    connection: &Connection,
    camp_id: &str,
) -> Result<Vec<AuthorityAttachmentRow>> {
    load_authority_rows(
        connection,
        r#"
        SELECT id, media_type, byte_size, content_digest, storage_path
        FROM message_attachment
        WHERE camp_id = ?1 AND runtime_projection_state = 'available'
        ORDER BY CAST(id AS BLOB)
        "#,
        camp_id,
    )
}

fn load_recoverable_authority_rows(
    connection: &Connection,
    camp_id: &str,
) -> Result<Vec<AuthorityAttachmentRow>> {
    load_authority_rows(
        connection,
        r#"
        SELECT attachment.id, attachment.media_type, attachment.byte_size,
               attachment.content_digest, attachment.storage_path
        FROM message_attachment AS attachment
        LEFT JOIN camp_attachment_view_operation AS operation
          ON operation.id = attachment.publication_operation_id
         AND operation.camp_id = attachment.camp_id
        WHERE attachment.camp_id = ?1
          AND attachment.runtime_projection_state = 'recovery_required'
          AND (
              attachment.publication_operation_id IS NULL
              OR operation.resolution_state = 'available'
          )
        ORDER BY CAST(attachment.id AS BLOB)
        "#,
        camp_id,
    )
}

fn fail_closed_camp_reconciliation_error(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<String>> {
    let view_state = connection
        .query_row(
            r#"
            SELECT state, active_operation_id, last_error_code
            FROM camp_attachment_view WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((state, active_operation_id, error_code)) = view_state else {
        return Ok(None);
    };
    if state != "integrity_failed" || active_operation_id.is_some() || error_code.is_none() {
        return Ok(None);
    }
    let unfinished_operations: i64 = connection.query_row(
        r#"
        SELECT COUNT(*) FROM camp_attachment_view_operation
        WHERE camp_id = ?1 AND status NOT IN ('completed', 'rolled_back')
        "#,
        [camp_id],
        |row| row.get(0),
    )?;
    if unfinished_operations != 0 {
        return Ok(None);
    }
    Ok(error_code)
}

fn has_unresolved_publication(connection: &Connection, camp_id: &str) -> Result<bool> {
    connection
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM camp_attachment_view_operation
                WHERE camp_id = ?1 AND resolution_state = 'unresolved'
            )
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn load_operation_authority_rows(
    connection: &Connection,
    operation_id: &str,
) -> Result<Vec<AuthorityAttachmentRow>> {
    let mut statement = connection.prepare(
        r#"
        SELECT attachment_id, media_type, expected_byte_size,
               expected_content_digest, authority_storage_path
        FROM camp_attachment_view_operation_entry
        WHERE operation_id = ?1
        ORDER BY rowid
        "#,
    )?;
    statement
        .query_map([operation_id], |row| {
            let size = row.get::<_, i64>(2)?;
            if size < 0 {
                return Err(rusqlite::Error::IntegralValueOutOfRange(2, size));
            }
            Ok(AuthorityAttachmentRow {
                attachment_id: row.get(0)?,
                media_type: row.get(1)?,
                byte_size: size as u64,
                content_digest: row.get(3)?,
                storage_path: PathBuf::from(row.get::<_, String>(4)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn load_authority_rows(
    connection: &Connection,
    sql: &str,
    camp_id: &str,
) -> Result<Vec<AuthorityAttachmentRow>> {
    let mut statement = connection.prepare(sql)?;
    statement
        .query_map([camp_id], |row| {
            let size = row.get::<_, i64>(2)?;
            if size < 0 {
                return Err(rusqlite::Error::IntegralValueOutOfRange(2, size));
            }
            Ok(AuthorityAttachmentRow {
                attachment_id: row.get(0)?,
                media_type: row.get(1)?,
                byte_size: size as u64,
                content_digest: row.get(3)?,
                storage_path: PathBuf::from(row.get::<_, String>(4)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn persist_copied_operation_entry(
    connection: &Connection,
    operation_id: &str,
    attachment_id: &str,
    receipt: &RuntimeAttachmentCopyReceipt,
    staging_identity_digest: &str,
) -> Result<()> {
    let changed = connection.execute(
        r#"
        UPDATE camp_attachment_view_operation_entry
        SET state = 'copied', authority_safe_leaf = ?3, kind = ?4,
            file_count = ?5, directory_count = ?6, node_count = ?7,
            staging_identity_digest = ?8, updated_at = ?9
        WHERE operation_id = ?1 AND attachment_id = ?2 AND state = 'planned'
          AND expected_byte_size = ?10 AND expected_content_digest = ?11
        "#,
        params![
            operation_id,
            attachment_id,
            receipt.authority_safe_leaf,
            receipt.kind,
            receipt.file_count as i64,
            receipt.directory_count as i64,
            receipt.node_count as i64,
            staging_identity_digest,
            chrono::Utc::now().to_rfc3339(),
            receipt.byte_size as i64,
            receipt.content_digest,
        ],
    )?;
    if changed != 1 {
        anyhow::bail!("camp_attachment_view_source_invalid: copied receipt did not match journal");
    }
    Ok(())
}

fn load_operation_attachment_ids(
    connection: &Connection,
    operation_id: &str,
    state: &str,
) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT attachment_id FROM camp_attachment_view_operation_entry WHERE operation_id = ?1 AND state = ?2 ORDER BY rowid",
    )?;
    Ok(statement
        .query_map(params![operation_id, state], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn load_all_operation_attachment_ids(
    connection: &Connection,
    operation_id: &str,
) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT attachment_id FROM camp_attachment_view_operation_entry WHERE operation_id = ?1 ORDER BY rowid",
    )?;
    Ok(statement
        .query_map([operation_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

type OperationCleanupEntry = (String, Option<String>, Option<String>);

fn load_operation_cleanup_entries(
    connection: &Connection,
    operation_id: &str,
) -> Result<Vec<OperationCleanupEntry>> {
    let mut statement = connection.prepare(
        r#"
        SELECT attachment_id, staging_identity_digest, final_identity_digest
        FROM camp_attachment_view_operation_entry
        WHERE operation_id = ?1 AND state <> 'committed' ORDER BY rowid
        "#,
    )?;
    Ok(statement
        .query_map([operation_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn final_entry_is_committed_to_other_operation(
    connection: &Connection,
    camp_id: &str,
    attachment_id: &str,
    operation_id: &str,
    actual_identity_digest: &str,
) -> Result<bool> {
    let committed_entry = connection
        .query_row(
            r#"
            SELECT entry.entry_identity_digest, entry.publication_operation_id
            FROM camp_attachment_view_entry AS entry
            JOIN camp_attachment_view_operation AS operation
              ON operation.id = entry.publication_operation_id
             AND operation.camp_id = entry.camp_id
            JOIN message_attachment AS attachment
              ON attachment.id = entry.attachment_id
             AND attachment.camp_id = entry.camp_id
            WHERE entry.camp_id = ?1 AND entry.attachment_id = ?2
              AND entry.publication_operation_id <> ?3
              AND operation.status IN ('committed','completed')
            "#,
            params![camp_id, attachment_id, operation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(committed_entry.is_some_and(|(identity, _)| identity == actual_identity_digest))
}

fn load_view_entry_ids(
    connection: &Connection,
    camp_id: &str,
) -> Result<std::collections::BTreeSet<String>> {
    let mut statement = connection.prepare(
        r#"
        SELECT entry.attachment_id
        FROM camp_attachment_view_entry AS entry
        JOIN message_attachment AS attachment
          ON attachment.camp_id = entry.camp_id
         AND attachment.id = entry.attachment_id
        WHERE entry.camp_id = ?1
          AND attachment.runtime_projection_state IN ('available', 'pending')
        ORDER BY entry.attachment_id
        "#,
    )?;
    Ok(statement
        .query_map([camp_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<std::collections::BTreeSet<_>>>()?)
}

fn runtime_files_root_from_connection(connection: &Connection) -> Result<PathBuf> {
    connection
        .query_row("SELECT rovai_runtime_camp_files_root()", [], |row| {
            row.get::<_, String>(0)
        })
        .map(PathBuf::from)
        .context("runtime_camp_files_root_invalid: connection has no admitted Runtime Files Root")
}

fn resolve_root_relative_runtime_path(connection: &Connection, relative: &str) -> Result<PathBuf> {
    let relative = Path::new(relative);
    validate_root_relative_path(relative)?;
    let mut resolved = runtime_files_root_from_connection(connection)?;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            unreachable!("validated Runtime Files paths contain only normal components");
        };
        resolved.push(name);
    }
    Ok(resolved)
}

fn camp_attachment_root_relative(camp_id: &str) -> String {
    format!("camps/{camp_id}/attachments")
}

fn final_entry_relative(camp_id: &str, attachment_id: &str) -> String {
    format!("camps/{camp_id}/attachments/{attachment_id}")
}

fn staging_entry_relative(operation_id: &str, attachment_id: &str) -> String {
    format!(".staging/{operation_id}/{attachment_id}")
}

fn validate_operation_id(value: &str) -> Result<()> {
    Uuid::parse_str(value).context("Camp Attachment View operation ID is invalid")?;
    Ok(())
}

fn validate_attachment_id(value: &str) -> Result<()> {
    Uuid::parse_str(value).context("Published Attachment ID is invalid")?;
    Ok(())
}

fn validate_normalized_absolute(path: &Path, code: &str) -> Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        anyhow::bail!("{code}: path must be a normalized absolute path");
    }
    Ok(())
}

fn validate_root_relative_path(path: &Path) -> Result<()> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        anyhow::bail!("Camp Attachment View journal path is invalid");
    }
    Ok(())
}

fn path_entry_exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn reject_existing_symlink_components(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                anyhow::bail!(
                    "runtime_camp_files_root_invalid: symlink component {}",
                    current.display()
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn reject_runtime_root_marker_ancestor(root: &Path) -> Result<()> {
    let mut ancestor = root.parent();
    while let Some(path) = ancestor {
        let marker = path.join(ROOT_MARKER);
        if let Ok(metadata) = fs::symlink_metadata(&marker) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                anyhow::bail!(
                    "runtime_camp_files_root_invalid: ancestor Runtime Files marker is unsafe"
                );
            }
            if metadata.len() <= 16 * 1024
                && serde_json::from_slice::<RuntimeFilesRootMarker>(&fs::read(&marker)?).is_ok()
            {
                anyhow::bail!(
                    "runtime_camp_files_root_invalid: root is nested below another Runtime Files Root"
                );
            }
        }
        ancestor = path.parent();
    }
    Ok(())
}

fn admit_runtime_root_marker(
    canonical_root: &Path,
    instance_key: &str,
    data_dir_identity_digest: &str,
    root_identity_digest: &str,
) -> Result<()> {
    let marker_path = canonical_root.join(ROOT_MARKER);
    let expected_platform = std::env::consts::OS.to_string();
    if marker_path.exists() {
        let metadata = fs::symlink_metadata(&marker_path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 16 * 1024 {
            anyhow::bail!("runtime_camp_files_root_invalid: root marker is unsafe");
        }
        let marker: RuntimeFilesRootMarker = serde_json::from_slice(&fs::read(&marker_path)?)
            .context("runtime_camp_files_root_invalid: root marker is invalid")?;
        if marker.instance_key != instance_key
            || marker.platform != expected_platform
            || !matches!(
                marker.schema_version,
                LEGACY_ROOT_MARKER_SCHEMA_VERSION | ROOT_MARKER_SCHEMA_VERSION
            )
        {
            anyhow::bail!("runtime_camp_files_root_invalid: root marker identity mismatch");
        }
        if marker.schema_version == ROOT_MARKER_SCHEMA_VERSION {
            if marker.data_dir_identity_digest != data_dir_identity_digest
                || marker.root_identity_digest != root_identity_digest
            {
                anyhow::bail!("runtime_camp_files_root_invalid: root marker identity mismatch");
            }
            return Ok(());
        }

        // Schema 1 persisted macOS `st_dev`, whose APFS mount assignment may
        // change across reboot. `CampAttachmentViewStore::admit` reaches this
        // migration only after the deterministic instance path, current-user
        // ownership, local filesystem, no-symlink tree, and exclusive root
        // lock have all been admitted. The View is derived and is fully
        // reconciled against SQLite/Authority after Database open.
        #[cfg(not(target_os = "macos"))]
        if marker.data_dir_identity_digest != data_dir_identity_digest
            || marker.root_identity_digest != root_identity_digest
        {
            anyhow::bail!("runtime_camp_files_root_invalid: root marker identity mismatch");
        }
        let migrated = RuntimeFilesRootMarker {
            schema_version: ROOT_MARKER_SCHEMA_VERSION,
            instance_key: marker.instance_key,
            data_dir_identity_digest: data_dir_identity_digest.to_string(),
            platform: marker.platform,
            root_identity_digest: root_identity_digest.to_string(),
            created_at: marker.created_at,
        };
        crate::platform::private_storage::atomic_write_private_json(&marker_path, &migrated)?;
        sync_directory(canonical_root)?;
        return Ok(());
    }

    let unknown = fs::read_dir(canonical_root)?
        .collect::<std::io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|entry| entry.file_name() != ROOT_LOCK)
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        anyhow::bail!("runtime_camp_files_root_invalid: unmarked root is not empty");
    }
    let marker = RuntimeFilesRootMarker {
        schema_version: ROOT_MARKER_SCHEMA_VERSION,
        instance_key: instance_key.to_string(),
        data_dir_identity_digest: data_dir_identity_digest.to_string(),
        platform: expected_platform,
        root_identity_digest: root_identity_digest.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    write_new_private_json(&marker_path, &marker)
}

fn reject_nested_runtime_root_markers(root: &Path) -> Result<()> {
    fn walk(root: &Path, directory: &Path) -> Result<()> {
        let metadata = fs::symlink_metadata(directory)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            anyhow::bail!("runtime_camp_files_root_invalid: managed root tree is unsafe");
        }
        #[cfg(unix)]
        let original_mode = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o777
        };
        #[cfg(unix)]
        if original_mode & 0o500 != 0o500 {
            set_directory_mode(directory, original_mode | 0o500)?;
        }
        let inspection = (|| -> Result<()> {
            for entry in fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()? {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink() {
                    anyhow::bail!(
                        "runtime_camp_files_root_invalid: managed root contains a symlink"
                    );
                }
                if path != root.join(ROOT_MARKER)
                    && entry.file_name() == ROOT_MARKER
                    && metadata.is_file()
                    && metadata.len() <= 16 * 1024
                    && serde_json::from_slice::<RuntimeFilesRootMarker>(&fs::read(&path)?).is_ok()
                {
                    anyhow::bail!(
                        "runtime_camp_files_root_invalid: nested Runtime Files Root marker"
                    );
                }
                if metadata.is_dir() {
                    walk(root, &path)?;
                } else if !metadata.is_file() {
                    anyhow::bail!(
                        "runtime_camp_files_root_invalid: managed root contains an unsupported node"
                    );
                }
            }
            Ok(())
        })();
        #[cfg(unix)]
        {
            let restore = if original_mode & 0o500 != 0o500 {
                set_directory_mode(directory, original_mode)
            } else {
                Ok(())
            };
            restore?;
        }
        inspection
    }
    walk(root, root)
}

fn validate_current_user_local_root(_root: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::metadata(_root)?;
        let effective_user = unsafe { libc::geteuid() };
        if metadata.uid() != effective_user {
            anyhow::bail!("runtime_camp_files_root_invalid: root is not owned by the current user");
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let path = CString::new(_root.as_os_str().as_bytes())
            .context("runtime_camp_files_root_invalid: root contains NUL")?;
        let mut filesystem: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statfs(path.as_ptr(), &mut filesystem) } != 0 {
            return Err(std::io::Error::last_os_error())
                .context("runtime_camp_files_root_invalid: root filesystem is unavailable");
        }
        if filesystem.f_flags as u64 & libc::MNT_LOCAL as u64 == 0 {
            anyhow::bail!("runtime_camp_files_root_invalid: root must use a local filesystem");
        }
    }
    Ok(())
}

fn reject_overlap(left: &Path, right: &Path) -> Result<()> {
    let left = normalize_existing_or_lexical(left)?;
    let right = normalize_existing_or_lexical(right)?;
    if left.starts_with(&right) || right.starts_with(&left) {
        anyhow::bail!(
            "runtime_camp_files_root_invalid: managed roots overlap ({} and {})",
            left.display(),
            right.display()
        );
    }
    Ok(())
}

fn normalize_existing_or_lexical(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path).map_err(Into::into);
    }
    let parent = path.parent().context("path has no parent")?;
    if parent == path {
        return Ok(path.to_path_buf());
    }
    let canonical_parent = normalize_existing_or_lexical(parent)?;
    Ok(canonical_parent.join(path.file_name().context("path has no file name")?))
}

fn directory_identity_digest(path: &Path) -> Result<String> {
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_dir() {
        anyhow::bail!("managed root is not a directory");
    }
    #[cfg(target_os = "macos")]
    let identity_digest = {
        let path_digest = format!(
            "sha256:{:x}",
            Sha256::digest(canonical.to_string_lossy().as_bytes())
        );
        let facts = macos_filesystem_identity_facts(&canonical, &metadata)?;
        persistent_directory_identity_digest(&path_digest, &facts)?
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        json!({
            "pathDigest": format!("sha256:{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes())),
            "device": metadata.dev(),
            "inode": metadata.ino(),
            "owner": metadata.uid(),
        })
    };
    #[cfg(not(any(unix, target_os = "macos")))]
    let identity = json!({
        "pathDigest": format!("sha256:{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes())),
    });
    #[cfg(not(target_os = "macos"))]
    let identity_digest = canonical_json_digest(&identity)?;
    Ok(identity_digest)
}

fn entry_identity_digest(path: &Path) -> Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Camp Attachment View entry is a symlink");
    }
    #[cfg(target_os = "macos")]
    let identity_digest = {
        let facts = macos_filesystem_identity_facts(path, &metadata)?;
        persistent_entry_identity_digest(
            if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
            metadata.len(),
            &facts,
        )?
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        json!({
            "device": metadata.dev(),
            "inode": metadata.ino(),
            "kind": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len(),
        })
    };
    #[cfg(not(any(unix, target_os = "macos")))]
    let identity = json!({
        "kind": if metadata.is_dir() { "directory" } else { "file" },
        "size": metadata.len(),
    });
    #[cfg(not(target_os = "macos"))]
    let identity_digest = canonical_json_digest(&identity)?;
    Ok(identity_digest)
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, PartialEq, Eq)]
struct UnixFilesystemIdentityFacts {
    stable_volume_identity: String,
    volatile_device: u64,
    inode: u64,
    owner: u32,
}

#[cfg(target_os = "macos")]
fn macos_filesystem_identity_facts(
    path: &Path,
    metadata: &fs::Metadata,
) -> Result<UnixFilesystemIdentityFacts> {
    use std::os::unix::fs::MetadataExt;
    Ok(UnixFilesystemIdentityFacts {
        stable_volume_identity: macos_volume_identity(path)?,
        volatile_device: metadata.dev(),
        inode: metadata.ino(),
        owner: metadata.uid(),
    })
}

#[cfg(target_os = "macos")]
fn persistent_directory_identity_digest(
    path_digest: &str,
    facts: &UnixFilesystemIdentityFacts,
) -> Result<String> {
    let _volatile_device = facts.volatile_device;
    canonical_json_digest(&json!({
        "pathDigest": path_digest,
        "volumeIdentity": facts.stable_volume_identity,
        "inode": facts.inode,
        "owner": facts.owner,
    }))
}

#[cfg(target_os = "macos")]
fn persistent_entry_identity_digest(
    kind: &str,
    size: u64,
    facts: &UnixFilesystemIdentityFacts,
) -> Result<String> {
    let _volatile_device = facts.volatile_device;
    let _owner = facts.owner;
    canonical_json_digest(&json!({
        "volumeIdentity": facts.stable_volume_identity,
        "inode": facts.inode,
        "kind": kind,
        "size": size,
    }))
}

#[cfg(target_os = "macos")]
fn macos_volume_identity(path: &Path) -> Result<String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    const ATTR_BIT_MAP_COUNT: u16 = 5;
    const ATTR_VOL_UUID: u32 = 0x0004_0000;
    const ATTR_VOL_INFO: u32 = 0x8000_0000;

    #[repr(C)]
    struct AttributeList {
        bitmap_count: u16,
        reserved: u16,
        common_attributes: u32,
        volume_attributes: u32,
        directory_attributes: u32,
        file_attributes: u32,
        fork_attributes: u32,
    }

    #[repr(C)]
    struct VolumeUuidBuffer {
        length: u32,
        uuid: [u8; 16],
    }

    unsafe extern "C" {
        #[link_name = "getattrlist"]
        fn macos_getattrlist(
            path: *const libc::c_char,
            attributes: *mut libc::c_void,
            buffer: *mut libc::c_void,
            buffer_size: libc::size_t,
            options: libc::c_uint,
        ) -> libc::c_int;
    }

    let path =
        CString::new(path.as_os_str().as_bytes()).context("managed root path contains NUL")?;
    let mut attributes = AttributeList {
        bitmap_count: ATTR_BIT_MAP_COUNT,
        reserved: 0,
        common_attributes: 0,
        volume_attributes: ATTR_VOL_INFO | ATTR_VOL_UUID,
        directory_attributes: 0,
        file_attributes: 0,
        fork_attributes: 0,
    };
    let mut buffer = VolumeUuidBuffer {
        length: 0,
        uuid: [0; 16],
    };
    let status = unsafe {
        // SAFETY: `path` is NUL-terminated, the C layouts match Darwin's
        // `attrlist` and fixed ATTR_VOL_UUID response, and both mutable
        // buffers remain live for the duration of the call.
        macos_getattrlist(
            path.as_ptr(),
            std::ptr::from_mut(&mut attributes).cast(),
            std::ptr::from_mut(&mut buffer).cast(),
            std::mem::size_of::<VolumeUuidBuffer>(),
            0,
        )
    };
    if status != 0 {
        return Err(std::io::Error::last_os_error())
            .context("managed root volume identity is unavailable");
    }
    if usize::try_from(buffer.length).ok() != Some(std::mem::size_of::<VolumeUuidBuffer>())
        || buffer.uuid.iter().all(|byte| *byte == 0)
    {
        anyhow::bail!("managed root volume identity is invalid");
    }
    Ok(format!(
        "volume:{}",
        Uuid::from_bytes(buffer.uuid).hyphenated()
    ))
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    crate::platform::private_storage::prepare_private_directory(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("managed Runtime View directory is unsafe");
    }
    set_directory_mode(path, 0o700)
}

fn validate_runtime_attachment_root(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("camp_attachment_view_integrity_failed");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o777 != 0o500 {
            anyhow::bail!("camp_attachment_view_integrity_failed");
        }
    }
    Ok(())
}

fn validate_camp_root_authorization(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("runtime_camp_files_root_invalid: Camp Attachment root is unsafe");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode() & 0o777;
        if !matches!(mode, 0o500 | 0o700) {
            anyhow::bail!("runtime_camp_files_root_invalid: Camp Attachment root is not private");
        }
    }
    Ok(())
}

fn harden_runtime_entry(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Camp Attachment View entry contains a symlink");
    }
    if metadata.is_dir() {
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            harden_runtime_entry(&child.path())?;
        }
        set_directory_mode(path, 0o500)
    } else if metadata.is_file() {
        set_file_mode(path, 0o400)
    } else {
        anyhow::bail!("Camp Attachment View entry contains an unsupported node");
    }
}

fn make_staging_entry_private(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Camp Attachment View staging contains a symlink");
    }
    if metadata.is_dir() {
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            make_staging_entry_private(&child.path())?;
        }
        set_directory_mode(path, 0o700)
    } else if metadata.is_file() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                anyhow::bail!("Camp Attachment View staging contains a hard-linked file");
            }
        }
        set_file_mode(path, 0o600)
    } else {
        anyhow::bail!("Camp Attachment View staging contains an unsupported node");
    }
}

fn validate_staging_tree_modes(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Camp Attachment View staging contains a symlink");
    }
    if metadata.is_dir() {
        validate_managed_directory(path, Some(0o700))?;
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            validate_staging_tree_modes(&child.path())?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        anyhow::bail!("Camp Attachment View staging contains an unsupported node");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o777 != 0o600 || metadata.nlink() != 1 {
            anyhow::bail!("Camp Attachment View staging file mode or link count is unsafe");
        }
    }
    Ok(())
}

fn prepare_runtime_entry_for_atomic_promote(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Camp Attachment View entry root must be a directory");
    }
    for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
        harden_runtime_entry(&child.path())?;
    }
    // Darwin requires the directory being moved between parents to remain owner-writable.
    // Its descendants are already read-only; the destination root is restricted immediately
    // after the atomic rename and before the publication journal advances.
    set_directory_mode(path, 0o700)
}

fn remove_managed_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("refusing to remove a symlink from the Runtime View root");
    }
    if metadata.is_dir() {
        set_directory_mode(path, 0o700)?;
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            remove_managed_tree(&child.path())?;
        }
        fs::remove_dir(path)?;
    } else if metadata.is_file() {
        set_file_mode(path, 0o600)?;
        fs::remove_file(path)?;
    } else {
        anyhow::bail!("refusing to remove an unsupported Runtime View node");
    }
    Ok(())
}

fn sync_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("cannot sync a symlink in Runtime View staging");
    }
    if metadata.is_dir() {
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            sync_tree(&child.path())?;
        }
        sync_directory(path)
    } else if metadata.is_file() {
        #[cfg(windows)]
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        #[cfg(not(windows))]
        let file = File::open(path)?;
        file.sync_all().map_err(Into::into)
    } else {
        anyhow::bail!("cannot sync an unsupported Runtime View node");
    }
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(windows)]
    let _ = path;
    #[cfg(not(windows))]
    File::open(path)?.sync_all()?;
    Ok(())
}

fn set_directory_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

fn set_file_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_readonly(mode & 0o200 == 0);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn private_open_read_write(path: &Path) -> Result<File> {
    crate::platform::private_storage::open_private_read_write_file(path)
}

fn write_new_private_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = crate::platform::private_storage::create_private_new_file(path)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    sync_directory(path.parent().context("marker has no parent")?)
}

fn write_lock_owner(file: &mut File) -> Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    serde_json::to_writer(
        &mut *file,
        &json!({
            "schemaVersion": 1,
            "processId": std::process::id(),
            "acquiredAt": chrono::Utc::now().to_rfc3339(),
        }),
    )?;
    file.write_all(b"\n")?;
    file.sync_data()?;
    Ok(())
}

#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> std::io::Result<bool> {
    use std::os::fd::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        Ok(false)
    } else {
        Err(error)
    }
}

#[cfg(not(unix))]
fn try_lock_exclusive(file: &File) -> std::io::Result<bool> {
    match file.try_lock() {
        Ok(()) => Ok(true),
        Err(std::fs::TryLockError::WouldBlock) => Ok(false),
        Err(std::fs::TryLockError::Error(error)) => Err(error),
    }
}

#[cfg(unix)]
fn unlock(file: &File) {
    use std::os::fd::AsRawFd;
    let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
}

#[cfg(not(unix))]
fn unlock(file: &File) {
    let _ = file.unlock();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_attachment::CampAttachmentStore,
        collaboration::{
            CollaborationService, CreateCampCommand, DeleteCampCommand, SendUserCampDraftCommand,
        },
        command::{ActorRef, CommandEnvelope, CommandResultStatus},
    };

    fn fixture() -> (
        crate::test_support::OwnedTestDatabase,
        PathBuf,
        String,
        CampAttachmentViewStore,
    ) {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let data_dir = database.directory().to_path_buf();
        let workspace = data_dir.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let command_id = Uuid::new_v4().to_string();
        let camp = CollaborationService::default()
            .create_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: command_id.clone(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampCommand::for_test(workspace.display().to_string()),
                },
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        let view = CampAttachmentViewStore::for_test(&database).unwrap();
        view.ensure_empty_camp_ready(&mut database, &camp_id)
            .unwrap();
        (database, data_dir, camp_id, view)
    }

    #[test]
    fn no_legacy_references_need_no_legacy_view_row_or_state() {
        let connection = Connection::open_in_memory().unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        let (receipt, digest) =
            load_camp_attachment_view_receipt(&connection, camp_id, Vec::new()).unwrap();

        assert_eq!(receipt.catalog_revision, LEGACY_VIEW_NOT_REQUIRED_REVISION);
        assert_eq!(receipt.catalog_entry_count, 0);
        assert!(receipt.referenced_entries.is_empty());
        assert_eq!(
            canonical_json_digest(&serde_json::to_value(&receipt).unwrap()).unwrap(),
            digest
        );
        validate_append_only_view_receipt(&connection, &receipt).unwrap();
    }

    #[test]
    fn legacy_rebuild_target_preserves_managed_v2_resources() {
        let (_database, _data_dir, camp_id, view) = fixture();
        let attachment_root = view.camp_attachment_root(&camp_id).unwrap();
        set_directory_mode(&attachment_root, 0o700).unwrap();
        let managed_root = attachment_root.join(MANAGED_V2_DIRECTORY);
        ensure_private_directory(&managed_root).unwrap();
        fs::write(managed_root.join("sentinel"), b"managed-v2").unwrap();
        let legacy_id = Uuid::new_v4().to_string();
        let legacy_root = attachment_root.join(&legacy_id);
        ensure_private_directory(&legacy_root).unwrap();
        fs::write(legacy_root.join("legacy"), b"legacy-v1").unwrap();
        set_directory_mode(&attachment_root, 0o500).unwrap();

        assert_eq!(
            view.prepare_backfill_target(&camp_id, true).unwrap(),
            attachment_root
        );
        assert_eq!(
            fs::read(managed_root.join("sentinel")).unwrap(),
            b"managed-v2"
        );
        assert!(!legacy_root.exists());
    }

    fn publish_current_draft(
        database: &mut Database,
        data_dir: &Path,
        camp_id: &str,
        view: &CampAttachmentViewStore,
        draft_revision: i64,
    ) -> PreparedCampAttachmentPublication {
        let publication = commit_current_draft(database, data_dir, camp_id, view, draft_revision);
        view.complete_publication(database, &publication.operation_id)
            .unwrap();
        publication
    }

    fn commit_current_draft(
        database: &mut Database,
        data_dir: &Path,
        camp_id: &str,
        view: &CampAttachmentViewStore,
        draft_revision: i64,
    ) -> PreparedCampAttachmentPublication {
        let command_id = Uuid::new_v4().to_string();
        let publication = view
            .stage_publication(
                database,
                &CampAttachmentStore::new(data_dir),
                camp_id,
                &command_id,
                draft_revision,
            )
            .unwrap()
            .expect("Draft attachments should create a publication operation");
        view.gate_publication(database, &publication).unwrap();
        view.promote_publication(database, &publication).unwrap();
        let execution = CollaborationService::default()
            .send_user_camp_draft_with_publication(
                database,
                &CommandEnvelope {
                    command_id,
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.to_string()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.to_string(),
                        draft_revision,
                        execution: None,
                    },
                },
                Some(&publication.operation_id),
            )
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Applied);
        publication
    }

    fn cleanup_fixture(
        database: &mut Database,
        data_dir: &Path,
        camp_id: &str,
        view: &CampAttachmentViewStore,
    ) {
        view.remove_camp_view(database, camp_id).unwrap();
        CampAttachmentStore::new(data_dir)
            .remove_camp(camp_id)
            .unwrap();
        set_directory_mode(&view.root().join("camps"), 0o700).unwrap();
        if data_dir.join("camp-attachments").exists() {
            set_directory_mode(&data_dir.join("camp-attachments"), 0o700).unwrap();
        }
    }

    fn commit_semantic_composer_attachment(
        database: &mut Database,
        data_dir: &Path,
        camp_id: &str,
        body: &str,
    ) -> (String, String) {
        let attachment_store = CampAttachmentStore::new(data_dir);
        let source = data_dir.join(format!("{}.txt", Uuid::new_v4()));
        fs::write(&source, body.as_bytes()).unwrap();
        let saved = attachment_store.save_body(database, camp_id, body).unwrap();
        let draft = attachment_store
            .prepare_from_path(
                database,
                camp_id,
                saved.revision,
                &source,
                "semantic-publication.txt",
            )
            .unwrap();
        let attachment_id = draft.attachments[0].id.clone();
        let command_id = Uuid::new_v4().to_string();
        let execution = CollaborationService::default()
            .send_user_camp_draft(
                database,
                &CommandEnvelope {
                    command_id,
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.to_string()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.to_string(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Applied);
        let operation_id = database
            .connection()
            .query_row(
                "SELECT publication_operation_id FROM message_attachment WHERE id = ?1",
                [&attachment_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        (operation_id, attachment_id)
    }

    fn finish_semantic_composer_attachment(
        database: &mut Database,
        data_dir: &Path,
        camp_id: &str,
        view: &CampAttachmentViewStore,
        operation_id: &str,
    ) {
        view.reconcile(database, &CampAttachmentStore::new(data_dir))
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "recovery_required"
        );
        let plan = view
            .plan_queued_publication(database, camp_id)
            .unwrap()
            .unwrap();
        assert_eq!(plan.operation_id(), operation_id);
        let copied =
            CampAttachmentViewStore::copy_publication(&CampAttachmentStore::new(data_dir), plan)
                .unwrap();
        let publication = view.finish_publication_staging(database, copied).unwrap();
        view.gate_publication(database, &publication).unwrap();
        view.promote_publication(database, &publication).unwrap();
        assert!(
            view.resolve_semantic_publication_success(database, operation_id)
                .unwrap()
                .is_empty()
        );
        view.finish_semantic_publication(database, operation_id)
            .unwrap();
    }

    #[test]
    fn semantic_publication_success_commits_a_verified_resolution_ledger() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let (operation_id, attachment_id) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "semantic success",
        );
        finish_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            &operation_id,
        );

        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT runtime_projection_state FROM message_attachment WHERE id = ?1",
                    [&attachment_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "available"
        );
        view.verify_camp_ready(&database, &camp_id).unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn migration_resolution_checkpoint_remains_valid_after_semantic_append() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let (legacy_operation_id, legacy_attachment_id) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "legacy semantic publication",
        );
        finish_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            &legacy_operation_id,
        );

        let semantic_catalog_digest = database
            .connection()
            .query_row(
                "SELECT semantic_catalog_digest FROM camp_attachment_view WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                r#"
                UPDATE message_attachment
                SET publication_operation_id = NULL,
                    publication_semantic_revision = NULL
                WHERE id = ?1
                "#,
                [&legacy_attachment_id],
            )
            .unwrap();
        transaction
            .execute(
                r#"
                UPDATE camp_attachment_view_operation
                SET source_kind = 'legacy', semantic_revision = NULL,
                    resolution_ledger_digest = NULL
                WHERE id = ?1
                "#,
                [&legacy_operation_id],
            )
            .unwrap();
        transaction
            .execute(
                r#"
                UPDATE camp_attachment_publication_resolution
                SET operation_id = NULL, entry_digest = ?2
                WHERE camp_id = ?1 AND semantic_revision = 1
                "#,
                params![camp_id, semantic_catalog_digest],
            )
            .unwrap();
        transaction
            .execute(
                "UPDATE camp_attachment_view SET resolution_digest = ?2 WHERE camp_id = ?1",
                params![camp_id, semantic_catalog_digest],
            )
            .unwrap();
        transaction.commit().unwrap();
        view.verify_camp_ready(&database, &camp_id).unwrap();

        let (operation_id, _) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "post-migration semantic publication",
        );
        finish_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            &operation_id,
        );

        view.verify_camp_ready(&database, &camp_id).unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn same_camp_semantic_publications_project_fifo_and_retain_follower_reservation() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let (first_operation, first_attachment) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "first semantic publication",
        );
        let (second_operation, second_attachment) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "second semantic publication",
        );
        let queued = database
            .connection()
            .prepare(
                r#"
                SELECT id, semantic_revision, reserved_bytes
                FROM camp_attachment_view_operation
                WHERE id IN (?1, ?2)
                ORDER BY semantic_revision
                "#,
            )
            .unwrap()
            .query_map(params![first_operation, second_operation], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(queued.len(), 2);
        assert_eq!(queued[0].0, first_operation);
        assert_eq!(queued[0].1, 1);
        assert!(queued[0].2 > 0);
        assert_eq!(queued[1].0, second_operation);
        assert_eq!(queued[1].1, 2);
        assert!(queued[1].2 > 0);

        let first_plan = view
            .plan_queued_publication(&mut database, &camp_id)
            .unwrap()
            .unwrap();
        assert_eq!(first_plan.operation_id(), first_operation);
        assert!(
            view.plan_queued_publication(&mut database, &camp_id)
                .unwrap_err()
                .to_string()
                .contains("camp_attachment_view_busy"),
            "the follower must not overtake a copying FIFO head"
        );
        let first_copy = CampAttachmentViewStore::copy_publication(
            &CampAttachmentStore::new(&data_dir),
            first_plan,
        )
        .unwrap();
        let first_publication = view
            .finish_publication_staging(&mut database, first_copy)
            .unwrap();
        view.gate_publication(&mut database, &first_publication)
            .unwrap();
        view.promote_publication(&mut database, &first_publication)
            .unwrap();
        view.resolve_semantic_publication_success(&mut database, &first_operation)
            .unwrap();
        view.finish_semantic_publication(&mut database, &first_operation)
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT reserved_bytes FROM camp_attachment_view_operation WHERE id = ?1",
                    [&second_operation],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            queued[1].2,
            "resolving the head must not release the follower reservation"
        );

        let second_plan = view
            .plan_queued_publication(&mut database, &camp_id)
            .unwrap()
            .unwrap();
        assert_eq!(second_plan.operation_id(), second_operation);
        let second_copy = CampAttachmentViewStore::copy_publication(
            &CampAttachmentStore::new(&data_dir),
            second_plan,
        )
        .unwrap();
        let second_publication = view
            .finish_publication_staging(&mut database, second_copy)
            .unwrap();
        view.gate_publication(&mut database, &second_publication)
            .unwrap();
        view.promote_publication(&mut database, &second_publication)
            .unwrap();
        view.resolve_semantic_publication_success(&mut database, &second_operation)
            .unwrap();
        view.finish_semantic_publication(&mut database, &second_operation)
            .unwrap();

        assert!(
            view.plan_queued_publication(&mut database, &camp_id)
                .unwrap()
                .is_none()
        );
        assert!(
            resolve_published_attachment_path(database.connection(), &camp_id, &first_attachment)
                .is_ok()
        );
        assert!(
            resolve_published_attachment_path(database.connection(), &camp_id, &second_attachment)
                .is_ok()
        );
        view.verify_camp_ready(&database, &camp_id).unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn terminal_projection_failure_tombstones_public_attachment_and_releases_intent() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let (operation_id, attachment_id) = commit_semantic_composer_attachment(
            &mut database,
            &data_dir,
            &camp_id,
            "semantic failure",
        );
        let authority_path = database
            .connection()
            .query_row(
                "SELECT storage_path FROM message_attachment WHERE id = ?1",
                [&attachment_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        set_file_mode(Path::new(&authority_path), 0o600).unwrap();
        fs::write(&authority_path, b"tampered after semantic commit").unwrap();
        let plan = view
            .plan_queued_publication(&mut database, &camp_id)
            .unwrap()
            .unwrap();
        assert!(
            CampAttachmentViewStore::copy_publication(&CampAttachmentStore::new(&data_dir), plan,)
                .is_err()
        );
        assert!(
            view.resolve_semantic_publication_terminal_failure(
                &mut database,
                &operation_id,
                "camp_attachment_view_source_invalid",
            )
            .unwrap()
            .is_empty()
        );

        let state: (String, String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT attachment.runtime_projection_state,
                       operation.resolution_state, operation.reserved_bytes
                FROM message_attachment AS attachment
                JOIN camp_attachment_view_operation AS operation
                  ON operation.id = attachment.publication_operation_id
                WHERE attachment.id = ?1
                "#,
                [&attachment_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("failed".to_string(), "failed".to_string(), 0));
        assert!(!has_unresolved_publication(database.connection(), &camp_id).unwrap());
        assert!(
            resolve_published_attachment_path(database.connection(), &camp_id, &attachment_id)
                .is_err()
        );
        view.verify_camp_ready(&database, &camp_id).unwrap();

        database
            .connection()
            .execute(
                r#"
                UPDATE camp_attachment_publication_resolution
                SET tombstone_digest = 'tampered'
                WHERE operation_id = ?1
                "#,
                [&operation_id],
            )
            .unwrap();
        assert!(view.verify_camp_ready(&database, &camp_id).is_err());
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn instance_key_uses_full_domain_separated_sha256() {
        let path = Path::new("/tmp/rovai-user-data");
        let key = instance_key(path).unwrap();
        assert!(key.starts_with("v1-"));
        assert_eq!(key.len(), 67);
        assert_eq!(key, instance_key(path).unwrap());
        assert_eq!(
            key,
            "v1-17c29d9f4108e665a3b940fb164f2c5914e24a1d4da69e31710e08ad461023a7"
        );
        assert_ne!(
            key,
            instance_key(Path::new("/tmp/rovai-user-data-2")).unwrap()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn persistent_view_identities_and_legacy_marker_survive_device_drift() {
        let before = UnixFilesystemIdentityFacts {
            stable_volume_identity: "volume:01234567-89ab-cdef-0123-456789abcdef".to_string(),
            volatile_device: 16_777_234,
            inode: 42,
            owner: 501,
        };
        let after = UnixFilesystemIdentityFacts {
            volatile_device: 16_777_229,
            ..before.clone()
        };
        let replaced_volume = UnixFilesystemIdentityFacts {
            stable_volume_identity: "volume:fedcba98-7654-3210-fedc-ba9876543210".to_string(),
            ..after.clone()
        };
        let legacy_before = canonical_json_digest(&json!({
            "pathDigest": "sha256:path",
            "device": before.volatile_device,
            "inode": before.inode,
            "owner": before.owner,
        }))
        .unwrap();
        let legacy_after = canonical_json_digest(&json!({
            "pathDigest": "sha256:path",
            "device": after.volatile_device,
            "inode": after.inode,
            "owner": after.owner,
        }))
        .unwrap();

        assert_ne!(legacy_before, legacy_after);
        assert_eq!(
            persistent_directory_identity_digest("sha256:path", &before).unwrap(),
            persistent_directory_identity_digest("sha256:path", &after).unwrap()
        );
        assert_eq!(
            persistent_entry_identity_digest("directory", 0, &before).unwrap(),
            persistent_entry_identity_digest("directory", 0, &after).unwrap()
        );
        assert_ne!(
            persistent_directory_identity_digest("sha256:path", &after).unwrap(),
            persistent_directory_identity_digest("sha256:path", &replaced_volume).unwrap()
        );

        let fixture = std::env::temp_dir().join(format!(
            "rovai-runtime-root-device-drift-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir(&fixture).unwrap();
        let marker = RuntimeFilesRootMarker {
            schema_version: 1,
            instance_key: "v1-rebooted-instance".to_string(),
            data_dir_identity_digest: legacy_before.clone(),
            platform: std::env::consts::OS.to_string(),
            root_identity_digest: legacy_before,
            created_at: "2026-08-24T00:00:00Z".to_string(),
        };
        write_new_private_json(&fixture.join(ROOT_MARKER), &marker).unwrap();

        admit_runtime_root_marker(
            &fixture,
            "v1-rebooted-instance",
            "sha256:stable-data-dir",
            "sha256:stable-root",
        )
        .unwrap();
        let migrated: RuntimeFilesRootMarker =
            serde_json::from_slice(&fs::read(fixture.join(ROOT_MARKER)).unwrap()).unwrap();
        assert_eq!(migrated.schema_version, ROOT_MARKER_SCHEMA_VERSION);
        assert_eq!(migrated.data_dir_identity_digest, "sha256:stable-data-dir");
        assert_eq!(migrated.root_identity_digest, "sha256:stable-root");
        assert_eq!(migrated.created_at, marker.created_at);

        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn relative_journal_paths_never_admit_parent_or_absolute_components() {
        assert!(validate_root_relative_path(Path::new("camps/camp/attachments/id")).is_ok());
        assert!(validate_root_relative_path(Path::new("../escape")).is_err());
        assert!(validate_root_relative_path(Path::new("/escape")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn runtime_root_admission_rejects_aliases_overlap_and_unowned_markers() {
        use std::os::unix::fs::symlink;

        let fixture = std::env::temp_dir().join(format!(
            "rovai-runtime-root-admission-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&fixture).unwrap();

        let symlink_target = fixture.join("symlink-target");
        let symlink_root = fixture.join("symlink-root");
        fs::create_dir(&symlink_target).unwrap();
        symlink(&symlink_target, &symlink_root).unwrap();
        assert!(reject_existing_symlink_components(&symlink_root).is_err());

        let overlap_root = fixture.join("overlap");
        let overlap_child = overlap_root.join("child");
        fs::create_dir_all(&overlap_child).unwrap();
        assert!(reject_overlap(&overlap_root, &overlap_child).is_err());

        let unmarked_root = fixture.join("unmarked");
        fs::create_dir(&unmarked_root).unwrap();
        fs::write(unmarked_root.join("unknown"), b"do not adopt").unwrap();
        let unmarked_identity = directory_identity_digest(&unmarked_root).unwrap();
        let error =
            admit_runtime_root_marker(&unmarked_root, "v1-test", "sha256:data", &unmarked_identity)
                .unwrap_err();
        assert!(error.to_string().contains("unmarked root is not empty"));

        let marked_root = fixture.join("marked");
        fs::create_dir(&marked_root).unwrap();
        let marked_identity = directory_identity_digest(&marked_root).unwrap();
        admit_runtime_root_marker(&marked_root, "v1-owner", "sha256:data", &marked_identity)
            .unwrap();
        admit_runtime_root_marker(&marked_root, "v1-owner", "sha256:data", &marked_identity)
            .unwrap();
        let error = admit_runtime_root_marker(
            &marked_root,
            "v1-owner",
            "sha256:data",
            "sha256:replacement-root",
        )
        .unwrap_err();
        assert!(error.to_string().contains("root marker identity mismatch"));
        let error = admit_runtime_root_marker(
            &marked_root,
            "v1-different-owner",
            "sha256:data",
            &marked_identity,
        )
        .unwrap_err();
        assert!(error.to_string().contains("root marker identity mismatch"));

        let ancestor_root = fixture.join("ancestor");
        fs::create_dir(&ancestor_root).unwrap();
        let ancestor_identity = directory_identity_digest(&ancestor_root).unwrap();
        admit_runtime_root_marker(
            &ancestor_root,
            "v1-ancestor",
            "sha256:data",
            &ancestor_identity,
        )
        .unwrap();
        assert!(reject_runtime_root_marker_ancestor(&ancestor_root.join("nested")).is_err());

        let outer_root = fixture.join("outer");
        let nested_root = outer_root.join("nested");
        fs::create_dir_all(&nested_root).unwrap();
        let nested_identity = directory_identity_digest(&nested_root).unwrap();
        admit_runtime_root_marker(&nested_root, "v1-nested", "sha256:data", &nested_identity)
            .unwrap();
        assert!(reject_nested_runtime_root_markers(&outer_root).is_err());

        fs::remove_dir_all(&fixture).unwrap();
    }

    #[test]
    fn follow_up_without_new_attachments_preserves_published_view() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("published.txt");
        fs::write(&source, b"published once").unwrap();
        let initial = attachment_store
            .save_body(&mut database, &camp_id, "Initial message with attachment")
            .unwrap();
        let initial = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                initial.revision,
                &source,
                "published.txt",
            )
            .unwrap();
        publish_current_draft(&mut database, &data_dir, &camp_id, &view, initial.revision);

        let follow_up = attachment_store
            .save_body(
                &mut database,
                &camp_id,
                "Follow-up without a new attachment",
            )
            .unwrap();
        let publication = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &Uuid::new_v4().to_string(),
                follow_up.revision,
            )
            .expect("a no-attachment follow-up should preserve the ready published View");

        assert!(publication.is_none());
        view.verify_camp_ready(&database, &camp_id).unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_attachment_view_entry WHERE camp_id = ?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn publication_keeps_drafts_private_and_projects_files_and_directories_read_only() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Inspect the shared files")
            .unwrap();
        let file_source = data_dir.join("source.txt");
        fs::write(&file_source, b"published file").unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &file_source,
                "Readable File.txt",
            )
            .unwrap();
        let directory_source = data_dir.join("source-directory");
        fs::create_dir_all(directory_source.join("nested/empty")).unwrap();
        fs::write(
            directory_source.join("nested/data.txt"),
            b"directory payload",
        )
        .unwrap();
        fs::write(directory_source.join(".note"), b"dotfile").unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                draft.revision,
                &directory_source,
                "Shared Directory",
            )
            .unwrap();
        let attachment_ids = draft
            .attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect::<Vec<_>>();
        let command_id = Uuid::new_v4().to_string();
        let publication = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_id,
                draft.revision,
            )
            .unwrap()
            .unwrap();

        let attachment_root = view.camp_attachment_root(&camp_id).unwrap();
        assert!(read_exact_utf8_names(&attachment_root).unwrap().is_empty());
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM message_attachment", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert!(
            view.staging_operation_root(&publication.operation_id)
                .unwrap()
                .is_dir()
        );

        view.gate_publication(&mut database, &publication).unwrap();
        view.promote_publication(&mut database, &publication)
            .unwrap();
        assert_eq!(
            read_typed_attachment_directory_ids(&attachment_root).unwrap(),
            attachment_ids.iter().cloned().collect()
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM message_attachment", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0,
            "promote must not publish the Camp Message before the SQLite linearization point"
        );

        let execution = CollaborationService::default()
            .send_user_camp_draft_with_publication(
                &mut database,
                &CommandEnvelope {
                    command_id: command_id.clone(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                },
                Some(&publication.operation_id),
            )
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Applied);
        view.complete_publication(&mut database, &publication.operation_id)
            .unwrap();
        view.verify_camp_ready(&database, &camp_id).unwrap();
        assert!(
            view.stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_id,
                draft.revision,
            )
            .unwrap()
            .is_none(),
            "a completed publication command must flow to CommandGateway replay"
        );
        let replay = CollaborationService::default()
            .send_user_camp_draft(
                &mut database,
                &CommandEnvelope {
                    command_id: command_id.clone(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(replay.result.payload, execution.result.payload);
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM message_attachment", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            2
        );

        for attachment_id in &attachment_ids {
            let resolved =
                resolve_published_attachment_path(database.connection(), &camp_id, attachment_id)
                    .unwrap();
            assert!(resolved.starts_with(attachment_root.to_str().unwrap()));
            assert!(!resolved.contains("camp-attachments"));
            assert!(
                !view
                    .root()
                    .join(final_entry_relative(&camp_id, attachment_id))
                    .join(".rovai-attachment.json")
                    .exists()
            );
            validate_runtime_tree_modes(Path::new(&resolved)).unwrap();
        }
        let projected_directory =
            resolve_published_attachment_path(database.connection(), &camp_id, &attachment_ids[1])
                .unwrap();
        assert_eq!(
            fs::read(Path::new(&projected_directory).join("nested/data.txt")).unwrap(),
            b"directory payload"
        );
        assert!(
            Path::new(&projected_directory)
                .join("nested/empty")
                .is_dir()
        );
        assert_eq!(
            fs::read(Path::new(&projected_directory).join(".note")).unwrap(),
            b"dotfile"
        );

        let private_source = data_dir.join("private.txt");
        fs::write(&private_source, b"draft remains private").unwrap();
        let private_draft = attachment_store
            .save_body(&mut database, &camp_id, "Unsent draft")
            .unwrap();
        let private_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                private_draft.revision,
                &private_source,
                "private.txt",
            )
            .unwrap();
        assert!(
            !attachment_root
                .join(&private_draft.attachments[0].id)
                .exists()
        );
        assert_eq!(read_exact_utf8_names(&attachment_root).unwrap().len(), 2);

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn publication_copy_phase_releases_the_shared_database_mutex() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("copy-without-database-lock.txt");
        fs::write(&source, vec![b'x'; 1024 * 1024]).unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Copy outside the DB mutex")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "copy-without-database-lock.txt",
            )
            .unwrap();
        let plan = match view
            .plan_publication(
                &mut database,
                &camp_id,
                &Uuid::new_v4().to_string(),
                draft.revision,
            )
            .unwrap()
        {
            CampAttachmentPublicationStaging::Copy(plan) => plan,
            other => panic!("expected copy plan, got {other:?}"),
        };
        let operation_id = plan.operation_id().to_string();
        let pause = std::sync::Arc::new(PublicationCopyTestPause::new());
        publication_copy_test_pauses()
            .lock()
            .unwrap()
            .insert(operation_id.clone(), pause.clone());
        let database = std::sync::Arc::new(tokio::sync::Mutex::new(database));
        let copy_task = tokio::task::spawn_blocking(move || {
            CampAttachmentViewStore::copy_publication(&attachment_store, plan)
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !pause.started.load(std::sync::atomic::Ordering::Acquire) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("copy phase should reach the controlled barrier");

        let acquired_while_copying = match tokio::time::timeout(
            std::time::Duration::from_millis(250),
            database.lock(),
        )
        .await
        {
            Ok(mut database) => {
                assert_eq!(
                    database
                        .connection()
                        .query_row(
                            "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                            [&operation_id],
                            |row| row.get::<_, String>(0),
                        )
                        .unwrap(),
                    "copying"
                );
                CampAttachmentStore::new(&data_dir)
                    .save_body(&mut database, &camp_id, "Draft changed during copy")
                    .unwrap();
                true
            }
            Err(_) => false,
        };
        pause.release();
        publication_copy_test_pauses()
            .lock()
            .unwrap()
            .remove(&operation_id);
        let copied = copy_task.await.unwrap().unwrap();
        assert!(
            acquired_while_copying,
            "the shared Database mutex stayed locked during filesystem copy"
        );

        let mut database = database.lock().await;
        let error = view
            .finish_publication_staging(&mut database, copied)
            .unwrap_err();
        assert!(error.to_string().contains("draft_changed"));
        view.rollback_publication(&mut database, &operation_id, "draft_changed")
            .unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_authorization_scan_releases_database_mutex_and_rejects_receipt_drift() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("verify-without-database-lock.txt");
        fs::write(&source, vec![b'v'; 1024 * 1024]).unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Verify outside the DB mutex")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "verify-without-database-lock.txt",
            )
            .unwrap();
        publish_current_draft(&mut database, &data_dir, &camp_id, &view, draft.revision);

        let verification = view
            .prepare_camp_runtime_authorization(
                &database,
                &camp_id,
                None,
                CampAttachmentVisibilityMode::GenerationFencedV1,
            )
            .unwrap();
        let pause = std::sync::Arc::new(PublicationCopyTestPause::new());
        view_verification_test_pauses()
            .lock()
            .unwrap()
            .insert(camp_id.clone(), pause.clone());
        let database = std::sync::Arc::new(tokio::sync::Mutex::new(database));
        let verification_task = tokio::task::spawn_blocking(move || verification.verify());
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !pause.started.load(std::sync::atomic::Ordering::Acquire) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Runtime authorization verification should reach the controlled barrier");

        let original_generation = {
            let database =
                tokio::time::timeout(std::time::Duration::from_millis(250), database.lock())
                    .await
                    .expect("filesystem verification must not retain the shared Database mutex");
            let generation = database
                .connection()
                .query_row(
                    "SELECT generation FROM camp_attachment_view WHERE camp_id = ?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            database
                .connection()
                .execute(
                    "UPDATE camp_attachment_view SET generation = ?2 WHERE camp_id = ?1",
                    params![camp_id, generation + 1],
                )
                .unwrap();
            generation
        };
        pause.release();
        view_verification_test_pauses()
            .lock()
            .unwrap()
            .remove(&camp_id);
        let verified = verification_task.await.unwrap().unwrap();

        let mut database = database.lock().await;
        let error = view
            .complete_verified_camp_runtime_authorization(&database, verified)
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("changed during physical verification")
        );
        database
            .connection()
            .execute(
                "UPDATE camp_attachment_view SET generation = ?2 WHERE camp_id = ?1",
                params![camp_id, original_generation],
            )
            .unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn publication_completion_verifies_only_new_entries_but_dispatch_verifies_the_full_view() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);

        let first_source = data_dir.join("existing-entry.txt");
        let first_body = b"existing published body";
        fs::write(&first_source, first_body).unwrap();
        let first_draft = attachment_store
            .save_body(&mut database, &camp_id, "First publication")
            .unwrap();
        let first_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                first_draft.revision,
                &first_source,
                "existing-entry.txt",
            )
            .unwrap();
        let first_attachment_id = first_draft.attachments[0].id.clone();
        publish_current_draft(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            first_draft.revision,
        );

        let second_source = data_dir.join("new-entry.txt");
        fs::write(&second_source, b"new published body").unwrap();
        let second_draft = attachment_store
            .save_body(&mut database, &camp_id, "Second publication")
            .unwrap();
        let second_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                second_draft.revision,
                &second_source,
                "new-entry.txt",
            )
            .unwrap();
        let second_publication = commit_current_draft(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            second_draft.revision,
        );

        let first_projected = resolve_published_attachment_path(
            database.connection(),
            &camp_id,
            &first_attachment_id,
        )
        .unwrap();
        set_file_mode(Path::new(&first_projected), 0o600).unwrap();
        fs::write(&first_projected, b"tampered published body").unwrap();
        set_file_mode(Path::new(&first_projected), 0o400).unwrap();

        view.complete_publication(&mut database, &second_publication.operation_id)
            .expect("publication completion should verify only entries promoted by this operation");

        let verification = view
            .prepare_camp_runtime_authorization(
                &database,
                &camp_id,
                None,
                CampAttachmentVisibilityMode::GenerationFencedV1,
            )
            .unwrap();
        let error = verification
            .verify()
            .expect_err("dispatch must still verify every published entry");
        assert!(
            format!("{error:#}").contains("content receipt"),
            "unexpected verification error: {error:#}"
        );

        set_file_mode(Path::new(&first_projected), 0o600).unwrap();
        fs::write(&first_projected, first_body).unwrap();
        set_file_mode(Path::new(&first_projected), 0o400).unwrap();
        view.verify_camp_ready(&database, &camp_id).unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn same_camp_allows_only_one_nonterminal_publish_operation() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("single-publication.txt");
        fs::write(&source, b"single Camp publication slot").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Single publication")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "single-publication.txt",
            )
            .unwrap();
        let first = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &Uuid::new_v4().to_string(),
                draft.revision,
            )
            .unwrap()
            .unwrap();
        let error = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &Uuid::new_v4().to_string(),
                draft.revision,
            )
            .unwrap_err();
        assert!(format!("{error:#}").contains("camp_attachment_view_busy"));
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_attachment_view_operation WHERE camp_id = ?1 AND kind = 'publish' AND status NOT IN ('completed','rolled_back')",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        view.rollback_publication(&mut database, &first.operation_id, "test_cleanup")
            .unwrap();
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn legacy_duplicate_publication_rolls_back_without_poisoning_committed_view() {
        let (mut database, data_dir, camp_id, view) = fixture();
        database
            .connection()
            .execute_batch(
                "DROP TRIGGER IF EXISTS camp_attachment_view_single_open_publish_insert;",
            )
            .unwrap();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("legacy-duplicate.txt");
        fs::write(&source, b"legacy duplicate publication").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Legacy duplicate")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "legacy-duplicate.txt",
            )
            .unwrap();
        let command_a = Uuid::new_v4().to_string();
        let command_b = Uuid::new_v4().to_string();
        let publication_a = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_a,
                draft.revision,
            )
            .unwrap()
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_attachment_view_operation SET status = 'completed' WHERE id = ?1",
                [&publication_a.operation_id],
            )
            .unwrap();
        let publication_b = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_b,
                draft.revision,
            )
            .unwrap()
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_attachment_view_operation SET status = 'staged' WHERE id = ?1",
                [&publication_a.operation_id],
            )
            .unwrap();
        view.gate_publication(&mut database, &publication_a)
            .unwrap();
        view.promote_publication(&mut database, &publication_a)
            .unwrap();
        let execution = CollaborationService::default()
            .send_user_camp_draft_with_publication(
                &mut database,
                &CommandEnvelope {
                    command_id: command_a,
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                },
                Some(&publication_a.operation_id),
            )
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Applied);
        view.complete_publication(&mut database, &publication_a.operation_id)
            .unwrap();

        let error = view
            .gate_publication(&mut database, &publication_b)
            .unwrap_err();
        assert!(format!("{error:#}").contains("draft_changed"));
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [&publication_b.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "rolled_back"
        );
        view.verify_camp_ready(&database, &camp_id).unwrap();

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn camp_delete_cleanup_journal_rolls_back_or_recovers_from_the_business_commit() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let cancelled = view
            .prepare_camp_delete_cleanup(&mut database, &camp_id, &Uuid::new_v4().to_string())
            .unwrap()
            .unwrap();
        view.cancel_camp_delete_cleanup(&mut database, &cancelled)
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT view.state, operation.status, operation.resolution_state
                    FROM camp_attachment_view AS view
                    JOIN camp_attachment_view_operation AS operation
                      ON operation.camp_id = view.camp_id
                    WHERE view.camp_id = ?1 AND operation.id = ?2
                    "#,
                    params![camp_id, cancelled.operation_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .unwrap(),
            (
                "ready".to_string(),
                "rolled_back".to_string(),
                "failed".to_string(),
            )
        );
        assert!(
            !crate::camp_attachment_publication::database_has_unresolved_writer_intent(
                &database, &camp_id,
            )
            .unwrap()
        );

        // Simulate the stale writer intent produced by builds that rolled back
        // Camp cleanup without settling its publication resolution. Startup
        // reconciliation must repair the terminal operation before admission.
        database
            .connection()
            .execute(
                "UPDATE camp_attachment_view_operation SET resolution_state = 'unresolved' WHERE id = ?1",
                [&cancelled.operation_id],
            )
            .unwrap();
        assert!(
            crate::camp_attachment_publication::database_has_unresolved_writer_intent(
                &database, &camp_id,
            )
            .unwrap()
        );
        view.reconcile(&mut database, &CampAttachmentStore::new(&data_dir))
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT resolution_state FROM camp_attachment_view_operation WHERE id = ?1",
                    [&cancelled.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "failed"
        );
        assert!(
            !crate::camp_attachment_publication::database_has_unresolved_writer_intent(
                &database, &camp_id,
            )
            .unwrap()
        );

        let delete_command_id = Uuid::new_v4().to_string();
        let cleanup = view
            .prepare_camp_delete_cleanup(&mut database, &camp_id, &delete_command_id)
            .unwrap()
            .unwrap();
        let version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let deleted = CollaborationService::default()
            .delete_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: delete_command_id,
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: DeleteCampCommand {
                        camp_id: camp_id.clone(),
                        expected_version: version,
                        force: true,
                    },
                },
            )
            .unwrap();
        assert_eq!(deleted.result.status, CommandResultStatus::Applied);

        // Simulate a crash after the Camp transaction commits but before the
        // cleanup operation advances from planned. Startup reconciliation must
        // use Camp absence as the durable outcome and finish the exact tree.
        view.reconcile(&mut database, &CampAttachmentStore::new(&data_dir))
            .unwrap();
        assert!(!view.camp_root(&camp_id).unwrap().exists());
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [&cleanup.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "completed"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_attachment_view WHERE camp_id = ?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        set_directory_mode(&view.root().join("camps"), 0o700).unwrap();
    }

    #[test]
    fn committed_publication_integrity_failure_rebuilds_instead_of_rolling_back() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("commit-recovery.txt");
        fs::write(&source, b"committed authority body").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Commit recovery")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "commit-recovery.txt",
            )
            .unwrap();
        let attachment_id = draft.attachments[0].id.clone();
        let command_id = Uuid::new_v4().to_string();
        let publication = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_id,
                draft.revision,
            )
            .unwrap()
            .unwrap();
        view.gate_publication(&mut database, &publication).unwrap();
        view.promote_publication(&mut database, &publication)
            .unwrap();
        CollaborationService::default()
            .send_user_camp_draft_with_publication(
                &mut database,
                &CommandEnvelope {
                    command_id,
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                },
                Some(&publication.operation_id),
            )
            .unwrap();

        let projected =
            resolve_published_attachment_path(database.connection(), &camp_id, &attachment_id)
                .unwrap();
        set_file_mode(Path::new(&projected), 0o600).unwrap();
        fs::write(&projected, b"tampered after business commit").unwrap();
        set_file_mode(Path::new(&projected), 0o400).unwrap();
        let error = view
            .complete_publication(&mut database, &publication.operation_id)
            .unwrap_err();
        assert!(format!("{error:#}").contains("camp_attachment_view_integrity_failed"));
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [&publication.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "recovery_required"
        );

        view.reconcile(&mut database, &attachment_store).unwrap();
        view.verify_camp_ready(&database, &camp_id).unwrap();
        assert_eq!(fs::read(&projected).unwrap(), b"committed authority body");
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT status FROM camp_attachment_view_operation WHERE id = ?1",
                    [&publication.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "completed"
        );

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn rollback_append_only_validation_and_controlled_rebuild_preserve_committed_entries() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let first_source = data_dir.join("first.txt");
        fs::write(&first_source, b"first published body").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "First")
            .unwrap();
        let first_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &first_source,
                "first.txt",
            )
            .unwrap();
        let first_id = first_draft.attachments[0].id.clone();
        publish_current_draft(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            first_draft.revision,
        );
        let (frozen_receipt, _) = load_camp_attachment_view_receipt(
            database.connection(),
            &camp_id,
            vec![first_id.clone()],
        )
        .unwrap();

        let second_source = data_dir.join("second.txt");
        fs::write(&second_source, b"second published body").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Second")
            .unwrap();
        let second_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &second_source,
                "second.txt",
            )
            .unwrap();
        publish_current_draft(
            &mut database,
            &data_dir,
            &camp_id,
            &view,
            second_draft.revision,
        );
        validate_append_only_view_receipt(database.connection(), &frozen_receipt).unwrap();

        let rollback_source = data_dir.join("rollback.txt");
        fs::write(&rollback_source, b"must never publish").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Rollback")
            .unwrap();
        let rollback_draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &rollback_source,
                "rollback.txt",
            )
            .unwrap();
        let rollback_id = rollback_draft.attachments[0].id.clone();
        let operation = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &Uuid::new_v4().to_string(),
                rollback_draft.revision,
            )
            .unwrap()
            .unwrap();
        view.gate_publication(&mut database, &operation).unwrap();
        view.promote_publication(&mut database, &operation).unwrap();
        view.rollback_publication(
            &mut database,
            &operation.operation_id,
            "test_precommit_crash",
        )
        .unwrap();
        assert!(
            !view
                .camp_attachment_root(&camp_id)
                .unwrap()
                .join(rollback_id)
                .exists()
        );
        view.verify_camp_ready(&database, &camp_id).unwrap();

        let first_path =
            resolve_published_attachment_path(database.connection(), &camp_id, &first_id).unwrap();
        let generation_before: i64 = database
            .connection()
            .query_row(
                "SELECT generation FROM camp_attachment_view WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let (_, auth_digest_before_rebuild) = runtime_attachment_auth_receipt(
            database.connection(),
            &camp_id,
            "sha256:frozen-manifest",
            CampAttachmentVisibilityMode::GenerationFencedV1,
        )
        .unwrap();
        let semantic_before: (i64, String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT catalog_revision, semantic_catalog_digest,
                       (SELECT published_catalog_revision
                        FROM camp_attachment_view_entry
                        WHERE camp_id = ?1 AND attachment_id = ?2)
                FROM camp_attachment_view WHERE camp_id = ?1
                "#,
                params![camp_id, first_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        set_file_mode(Path::new(&first_path), 0o600).unwrap();
        fs::write(&first_path, b"tampered projection").unwrap();
        set_file_mode(Path::new(&first_path), 0o400).unwrap();
        view.reconcile(&mut database, &attachment_store).unwrap();
        view.verify_camp_ready(&database, &camp_id).unwrap();
        assert_eq!(fs::read(&first_path).unwrap(), b"first published body");
        let generation_after: i64 = database
            .connection()
            .query_row(
                "SELECT generation FROM camp_attachment_view WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(generation_after > generation_before);
        let semantic_after: (i64, String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT catalog_revision, semantic_catalog_digest,
                       (SELECT published_catalog_revision
                        FROM camp_attachment_view_entry
                        WHERE camp_id = ?1 AND attachment_id = ?2)
                FROM camp_attachment_view WHERE camp_id = ?1
                "#,
                params![camp_id, first_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(semantic_after, semantic_before);
        validate_append_only_view_receipt(database.connection(), &frozen_receipt).unwrap();
        let (_, rebuilt_auth_digest) = runtime_attachment_auth_receipt(
            database.connection(),
            &camp_id,
            "sha256:frozen-manifest",
            CampAttachmentVisibilityMode::GenerationFencedV1,
        )
        .unwrap();
        assert_ne!(rebuilt_auth_digest, auth_digest_before_rebuild);

        let mut semantically_tampered_receipt = frozen_receipt.clone();
        semantically_tampered_receipt.referenced_entries[0].content_digest =
            "sha256:tampered".to_string();
        semantically_tampered_receipt.referenced_entries_digest =
            canonical_json_digest(&json!(semantically_tampered_receipt.referenced_entries))
                .unwrap();
        assert!(
            validate_append_only_view_receipt(
                database.connection(),
                &semantically_tampered_receipt
            )
            .is_err()
        );

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn startup_reconcile_degrades_missing_authority_without_blocking_camp() {
        let (mut database, data_dir, affected_camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("missing-authority.txt");
        let valid_source = data_dir.join("still-readable.txt");
        fs::write(&source, b"published before authority loss").unwrap();
        fs::write(&valid_source, b"peer attachment remains readable").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &affected_camp_id, "Affected")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &affected_camp_id,
                saved.revision,
                &source,
                "missing-authority.txt",
            )
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &affected_camp_id,
                draft.revision,
                &valid_source,
                "still-readable.txt",
            )
            .unwrap();
        let attachment_id = draft
            .attachments
            .iter()
            .find(|attachment| attachment.display_name == "missing-authority.txt")
            .unwrap()
            .id
            .clone();
        let valid_attachment_id = draft
            .attachments
            .iter()
            .find(|attachment| attachment.display_name == "still-readable.txt")
            .unwrap()
            .id
            .clone();
        publish_current_draft(
            &mut database,
            &data_dir,
            &affected_camp_id,
            &view,
            draft.revision,
        );
        let (frozen_receipt, _) = load_camp_attachment_view_receipt(
            database.connection(),
            &affected_camp_id,
            vec![attachment_id.clone(), valid_attachment_id.clone()],
        )
        .unwrap();

        let unaffected_workspace = data_dir.join("unaffected-workspace");
        fs::create_dir_all(&unaffected_workspace).unwrap();
        let unaffected = CollaborationService::default()
            .create_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampCommand::for_test(
                        unaffected_workspace.display().to_string(),
                    ),
                },
            )
            .unwrap();
        let unaffected_camp_id = unaffected.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        view.ensure_empty_camp_ready(&mut database, &unaffected_camp_id)
            .unwrap();

        let projected = resolve_published_attachment_path(
            database.connection(),
            &affected_camp_id,
            &attachment_id,
        )
        .unwrap();
        set_file_mode(Path::new(&projected), 0o600).unwrap();
        fs::write(&projected, b"force controlled rebuild").unwrap();
        set_file_mode(Path::new(&projected), 0o400).unwrap();
        let authority_path: String = database
            .connection()
            .query_row(
                "SELECT storage_path FROM message_attachment WHERE id = ?1",
                [&attachment_id],
                |row| row.get(0),
            )
            .unwrap();
        let authority_path = PathBuf::from(authority_path);
        let authority_container = authority_path.parent().unwrap();
        set_directory_mode(authority_container, 0o700).unwrap();
        fs::remove_file(&authority_path).unwrap();
        set_directory_mode(authority_container, 0o500).unwrap();

        view.reconcile(&mut database, &attachment_store).unwrap();

        view.verify_camp_ready(&database, &affected_camp_id)
            .unwrap();
        view.verify_camp_ready(&database, &unaffected_camp_id)
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT state, active_operation_id, last_error_code
                    FROM camp_attachment_view WHERE camp_id = ?1
                    "#,
                    [&affected_camp_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .unwrap(),
            (
                "ready".to_string(),
                None,
                Some("camp_attachment_integrity_degraded".to_string()),
            )
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT runtime_projection_state FROM message_attachment WHERE id = ?1",
                    [&attachment_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "recovery_required"
        );
        assert!(
            resolve_published_attachment_path(
                database.connection(),
                &affected_camp_id,
                &attachment_id,
            )
            .is_err()
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT runtime_projection_state FROM message_attachment WHERE id = ?1",
                    [&valid_attachment_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "available"
        );
        let valid_projected = resolve_published_attachment_path(
            database.connection(),
            &affected_camp_id,
            &valid_attachment_id,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(valid_projected).unwrap(),
            "peer attachment remains readable"
        );
        runtime_attachment_auth_receipt(
            database.connection(),
            &affected_camp_id,
            "sha256:degraded-camp-manifest",
            CampAttachmentVisibilityMode::GenerationFencedV1,
        )
        .unwrap();
        validate_append_only_view_receipt(database.connection(), &frozen_receipt).unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    r#"
                    SELECT COUNT(*) FROM camp_attachment_view_operation
                    WHERE camp_id = ?1 AND status NOT IN ('completed', 'rolled_back')
                    "#,
                    [&affected_camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        set_directory_mode(authority_container, 0o700).unwrap();
        fs::write(&authority_path, b"published before authority loss").unwrap();
        set_file_mode(&authority_path, 0o400).unwrap();
        set_directory_mode(authority_container, 0o500).unwrap();
        view.reconcile(&mut database, &attachment_store).unwrap();
        view.verify_camp_ready(&database, &affected_camp_id)
            .unwrap();
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT runtime_projection_state FROM message_attachment WHERE id = ?1",
                    [&attachment_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "available"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT last_error_code FROM camp_attachment_view WHERE camp_id = ?1",
                    [&affected_camp_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .unwrap(),
            None
        );
        let restored_projected = resolve_published_attachment_path(
            database.connection(),
            &affected_camp_id,
            &attachment_id,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(restored_projected).unwrap(),
            "published before authority loss"
        );
        validate_append_only_view_receipt(database.connection(), &frozen_receipt).unwrap();

        cleanup_fixture(&mut database, &data_dir, &affected_camp_id, &view);
        cleanup_fixture(&mut database, &data_dir, &unaffected_camp_id, &view);
    }

    #[test]
    fn empty_camp_controlled_rebuild_completes_without_synthetic_entries() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let generation_before: i64 = database
            .connection()
            .query_row(
                "SELECT generation FROM camp_attachment_view WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_attachment_view SET root_identity_digest = 'legacy-root-identity' WHERE camp_id = ?1",
                [&camp_id],
            )
            .unwrap();

        view.reconcile(&mut database, &CampAttachmentStore::new(&data_dir))
            .unwrap();

        view.verify_camp_ready(&database, &camp_id).unwrap();
        let (state, generation, entry_count, root_identity): (String, i64, i64, String) = database
            .connection()
            .query_row(
                r#"
                    SELECT state, generation, entry_count, root_identity_digest
                    FROM camp_attachment_view WHERE camp_id = ?1
                    "#,
                [&camp_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(state, "ready");
        assert!(generation > generation_before);
        assert_eq!(entry_count, 0);
        assert_eq!(root_identity, view.root_identity_digest());
        let (operation_id, status): (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT id, status FROM camp_attachment_view_operation
                WHERE camp_id = ?1 AND kind = 'controlled_rebuild'
                ORDER BY created_at DESC, id DESC LIMIT 1
                "#,
                [&camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_attachment_view_operation_entry WHERE operation_id = ?1",
                    [&operation_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[cfg(unix)]
    #[test]
    fn authority_hardlink_is_rejected_and_the_same_command_can_retry_after_cleanup() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let attachment_store = CampAttachmentStore::new(&data_dir);
        let source = data_dir.join("hardlink-source.txt");
        fs::write(&source, b"hardlink preflight").unwrap();
        let saved = attachment_store
            .save_body(&mut database, &camp_id, "Hardlink")
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut database,
                &camp_id,
                saved.revision,
                &source,
                "hardlink.txt",
            )
            .unwrap();
        let storage_path: String = database
            .connection()
            .query_row(
                "SELECT storage_path FROM prepared_attachment WHERE id = ?1",
                [&draft.attachments[0].id],
                |row| row.get(0),
            )
            .unwrap();
        let extra_link = data_dir.join("authority-hardlink");
        fs::hard_link(&storage_path, &extra_link).unwrap();
        let command_id = Uuid::new_v4().to_string();
        let error = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_id,
                draft.revision,
            )
            .unwrap_err();
        assert!(format!("{error:#}").contains("camp_attachment_view_source_invalid"));
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM prepared_attachment", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM agent_run", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        fs::remove_file(extra_link).unwrap();
        let retry = view
            .stage_publication(
                &mut database,
                &attachment_store,
                &camp_id,
                &command_id,
                draft.revision,
            )
            .unwrap()
            .unwrap();
        view.rollback_publication(&mut database, &retry.operation_id, "test_cleanup")
            .unwrap();

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn quota_arithmetic_uses_final_rebuild_size_and_sequential_staging_size() {
        let (mut database, data_dir, camp_id, view) = fixture();
        assert!(
            view.check_backfill_final_quotas(database.connection(), &camp_id, MAX_CAMP_VIEW_BYTES)
                .is_ok()
        );
        assert!(
            view.check_backfill_final_quotas(
                database.connection(),
                &camp_id,
                MAX_CAMP_VIEW_BYTES + 1
            )
            .unwrap_err()
            .to_string()
            .contains("quota_exceeded")
        );
        assert!(
            view.check_backfill_staging_quota(
                database.connection(),
                &Uuid::new_v4().to_string(),
                MAX_INSTANCE_STAGING_BYTES
            )
            .is_ok()
        );
        assert!(
            view.check_backfill_staging_quota(
                database.connection(),
                &Uuid::new_v4().to_string(),
                MAX_INSTANCE_STAGING_BYTES + 1
            )
            .unwrap_err()
            .to_string()
            .contains("quota_exceeded")
        );

        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }

    #[test]
    fn runtime_root_lock_rejects_a_second_owner() {
        let (mut database, data_dir, camp_id, view) = fixture();
        let error = CampAttachmentViewStore::for_test(&database).unwrap_err();
        assert!(error.to_string().contains("already locked"));
        cleanup_fixture(&mut database, &data_dir, &camp_id, &view);
    }
}
