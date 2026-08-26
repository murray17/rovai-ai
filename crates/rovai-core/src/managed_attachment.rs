use std::{
    collections::HashMap,
    fs::{self, File},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    camp_attachment::{
        CampAttachmentStore, MAX_DRAFT_ATTACHMENT_BYTES, MAX_PREPARED_ATTACHMENTS,
        RuntimeAttachmentCopyReceipt, cleanup_consumed_prepared_attachment_paths,
        copy_agent_sources_to_managed_staging, harden_managed_attachment_tree,
        inspect_runtime_attachment_copy, remove_managed_attachment_tree,
    },
    camp_attachment_publication::AuthorityAttachment,
    camp_attachment_view::{MAX_CAMP_VIEW_BYTES, MAX_INSTANCE_VIEW_BYTES},
    camp_id::CampId,
    db::Database,
};

const INGEST_PLAN_SCHEMA_VERSION: i64 = 1;
const MANAGED_DIRECTORY: &str = ".managed-v2";
const STAGING_DIRECTORY: &str = ".managed-v2-staging";
type ManagedCampRootGate = Arc<Mutex<()>>;
static MANAGED_CAMP_ROOT_GATES: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> =
    OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedAttachmentIngestSource {
    Composer,
    AgentWorkspace,
}

impl ManagedAttachmentIngestSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Composer => "composer",
            Self::AgentWorkspace => "agent_workspace",
        }
    }

    fn origin(self) -> &'static str {
        self.as_str()
    }
}

#[derive(Debug, Clone)]
struct ComposerSource {
    storage_path: PathBuf,
    media_type: String,
    byte_size: u64,
    content_digest: String,
}

#[derive(Debug, Clone)]
pub struct ManagedAttachmentIngestPlan {
    intent_id: String,
    camp_id: String,
    source: ManagedAttachmentIngestSource,
    entries: Vec<IngestPlanEntry>,
    composer_sources: Vec<ComposerSource>,
}

impl ManagedAttachmentIngestPlan {
    pub fn intent_id(&self) -> &str {
        &self.intent_id
    }

    pub fn camp_id(&self) -> &str {
        &self.camp_id
    }

    pub fn attachment_ids(&self) -> Vec<String> {
        self.entries
            .iter()
            .map(|entry| entry.attachment_id.clone())
            .collect()
    }

    pub fn composer_source_paths(&self) -> Vec<PathBuf> {
        self.composer_sources
            .iter()
            .map(|source| source.storage_path.clone())
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct PreparedManagedAttachmentIngest {
    intent_id: String,
    camp_id: String,
    source: ManagedAttachmentIngestSource,
    entries: Vec<MaterializedIngestEntry>,
    composer_source_paths: Vec<PathBuf>,
}

impl PreparedManagedAttachmentIngest {
    pub fn intent_id(&self) -> &str {
        &self.intent_id
    }

    pub fn attachments(&self) -> Vec<AuthorityAttachment> {
        self.entries
            .iter()
            .map(|entry| AuthorityAttachment {
                attachment_id: entry.attachment_id.clone(),
                display_name: entry.display_name.clone(),
                media_type: entry.media_type.clone(),
                byte_size: entry.byte_size,
                content_digest: entry.content_digest.clone(),
                storage_path: entry.final_path.clone(),
                preview_kind: entry.preview_kind.clone(),
            })
            .collect()
    }

    pub fn composer_source_paths(&self) -> &[PathBuf] {
        &self.composer_source_paths
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IngestPlanDocument {
    schema_version: i64,
    entries: Vec<IngestPlanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IngestPlanEntry {
    attachment_id: String,
    ordinal: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    materialized: Option<MaterializedIngestEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterializedIngestEvidence {
    display_name: String,
    media_type: String,
    preview_kind: String,
    kind: String,
    byte_size: u64,
    file_count: u64,
    directory_count: u64,
    node_count: u64,
    content_digest: String,
    root_relative_payload_path: String,
}

#[derive(Debug, Clone)]
struct MaterializedIngestEntry {
    attachment_id: String,
    ordinal: i64,
    display_name: String,
    media_type: String,
    preview_kind: String,
    kind: String,
    byte_size: u64,
    file_count: u64,
    directory_count: u64,
    node_count: u64,
    content_digest: String,
    root_relative_payload_path: String,
    final_path: PathBuf,
}

#[derive(Debug, Clone)]
struct StagedEntry {
    attachment: AuthorityAttachment,
    receipt: RuntimeAttachmentCopyReceipt,
}

#[derive(Debug, Clone)]
pub struct ManagedAttachmentStore {
    runtime_root: PathBuf,
}

impl ManagedAttachmentStore {
    pub fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }

    pub fn for_database(database: &Database) -> Self {
        Self::new(database.runtime_camp_files_root())
    }

    pub fn begin_composer_ingest(
        &self,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
        draft_revision: i64,
        requested_attachment_ids: &[String],
    ) -> Result<Option<ManagedAttachmentIngestPlan>> {
        CampId::parse(camp_id)?;
        if requested_attachment_ids.is_empty() {
            return Ok(None);
        }
        let sources = load_composer_sources(
            database.connection(),
            camp_id,
            draft_revision,
            requested_attachment_ids,
        )?;
        let reserved_bytes = sources.iter().try_fold(0_u64, |total, source| {
            total
                .checked_add(source.byte_size)
                .context("Managed Attachment reservation overflow")
        })?;
        let entries = requested_attachment_ids
            .iter()
            .enumerate()
            .map(|(ordinal, attachment_id)| IngestPlanEntry {
                attachment_id: attachment_id.clone(),
                ordinal: ordinal as i64,
                materialized: None,
            })
            .collect::<Vec<_>>();
        let intent_id = begin_ingest_intent(
            database,
            camp_id,
            command_id,
            ManagedAttachmentIngestSource::Composer,
            Some(draft_revision),
            reserved_bytes,
            &entries,
        )?;
        Ok(Some(ManagedAttachmentIngestPlan {
            intent_id,
            camp_id: camp_id.to_string(),
            source: ManagedAttachmentIngestSource::Composer,
            entries,
            composer_sources: sources,
        }))
    }

    pub fn begin_current_composer_ingest(
        &self,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
        draft_revision: i64,
    ) -> Result<Option<ManagedAttachmentIngestPlan>> {
        let attachment_ids = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id FROM prepared_attachment
                WHERE camp_id = ?1 AND state = 'ready'
                ORDER BY ordinal, id
                "#,
            )?;
            statement
                .query_map([camp_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        self.begin_composer_ingest(
            database,
            camp_id,
            command_id,
            draft_revision,
            &attachment_ids,
        )
    }

    pub fn begin_agent_ingest(
        &self,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
        attachment_count: usize,
    ) -> Result<Option<ManagedAttachmentIngestPlan>> {
        CampId::parse(camp_id)?;
        if attachment_count == 0 {
            return Ok(None);
        }
        if attachment_count > MAX_PREPARED_ATTACHMENTS {
            anyhow::bail!("At most 10 files may be attached to one message");
        }
        if let Some((intent_id, entries)) =
            load_or_resume_agent_intent(database, camp_id, command_id, attachment_count)?
        {
            return Ok(Some(ManagedAttachmentIngestPlan {
                intent_id,
                camp_id: camp_id.to_string(),
                source: ManagedAttachmentIngestSource::AgentWorkspace,
                entries,
                composer_sources: Vec::new(),
            }));
        }
        let entries = (0..attachment_count)
            .map(|ordinal| IngestPlanEntry {
                attachment_id: Uuid::new_v4().to_string(),
                ordinal: ordinal as i64,
                materialized: None,
            })
            .collect::<Vec<_>>();
        let intent_id = begin_ingest_intent(
            database,
            camp_id,
            command_id,
            ManagedAttachmentIngestSource::AgentWorkspace,
            None,
            MAX_DRAFT_ATTACHMENT_BYTES,
            &entries,
        )?;
        Ok(Some(ManagedAttachmentIngestPlan {
            intent_id,
            camp_id: camp_id.to_string(),
            source: ManagedAttachmentIngestSource::AgentWorkspace,
            entries,
            composer_sources: Vec::new(),
        }))
    }

    pub fn materialize_composer(
        &self,
        authority_store: &CampAttachmentStore,
        plan: &ManagedAttachmentIngestPlan,
    ) -> Result<PreparedManagedAttachmentIngest> {
        if plan.source != ManagedAttachmentIngestSource::Composer
            || plan.entries.len() != plan.composer_sources.len()
        {
            anyhow::bail!("Managed Attachment Composer plan is inconsistent");
        }
        let staging_root = self.staging_intent_root(&plan.intent_id)?;
        create_private_directory(&staging_root)?;
        let staged = plan
            .entries
            .iter()
            .zip(&plan.composer_sources)
            .map(|(entry, source)| {
                let attachment_root = staging_root.join(&entry.attachment_id);
                let payload_root = attachment_root.join("payload");
                create_private_directory(&payload_root)?;
                let receipt = authority_store.copy_verified_authority_attachment_for_runtime(
                    &source.storage_path,
                    &source.media_type,
                    source.byte_size,
                    &source.content_digest,
                    &payload_root,
                )?;
                harden_managed_attachment_tree(&attachment_root)?;
                Ok(StagedEntry {
                    attachment: AuthorityAttachment {
                        attachment_id: entry.attachment_id.clone(),
                        display_name: receipt.authority_safe_leaf.clone(),
                        media_type: source.media_type.clone(),
                        byte_size: receipt.byte_size,
                        content_digest: receipt.content_digest.clone(),
                        storage_path: payload_root.join(&receipt.authority_safe_leaf),
                        preview_kind: preview_kind_for_media_type(&source.media_type),
                    },
                    receipt,
                })
            })
            .collect::<Result<Vec<_>>>();
        let staged = match staged {
            Ok(staged) => staged,
            Err(error) => {
                let _ = remove_managed_attachment_tree(&staging_root);
                return Err(error);
            }
        };
        self.promote(plan, staged)
    }

    pub fn materialize_agent(
        &self,
        plan: &ManagedAttachmentIngestPlan,
        requested_paths: &[String],
        execution_workspace: &Path,
        run_tmp: &Path,
    ) -> Result<PreparedManagedAttachmentIngest> {
        if plan.source != ManagedAttachmentIngestSource::AgentWorkspace {
            anyhow::bail!("Managed Attachment Agent plan has the wrong source kind");
        }
        let staging_root = self.staging_intent_root(&plan.intent_id)?;
        let staged = copy_agent_sources_to_managed_staging(
            requested_paths,
            &plan.attachment_ids(),
            execution_workspace,
            run_tmp,
            &staging_root,
        )?
        .into_iter()
        .map(|staged| StagedEntry {
            attachment: staged.attachment,
            receipt: staged.receipt,
        })
        .collect();
        self.promote(plan, staged)
    }

    fn promote(
        &self,
        plan: &ManagedAttachmentIngestPlan,
        staged: Vec<StagedEntry>,
    ) -> Result<PreparedManagedAttachmentIngest> {
        if staged.len() != plan.entries.len() {
            anyhow::bail!("Managed Attachment staging result is incomplete");
        }
        let managed_root = self.ensure_managed_camp_root(&plan.camp_id)?;
        let staging_root = self.staging_intent_root(&plan.intent_id)?;
        let mut promoted_roots = Vec::with_capacity(staged.len());
        let promoted = (|| -> Result<Vec<MaterializedIngestEntry>> {
            let mut entries = Vec::with_capacity(staged.len());
            for (planned, staged) in plan.entries.iter().zip(staged) {
                if planned.attachment_id != staged.attachment.attachment_id {
                    anyhow::bail!("Managed Attachment staging identity changed");
                }
                let final_root = managed_root.join(&planned.attachment_id);
                fs::create_dir(&final_root).with_context(|| {
                    format!(
                        "Managed Attachment final path already exists: {}",
                        final_root.display()
                    )
                })?;
                allow_directory_update(&final_root)?;
                promoted_roots.push(final_root.clone());
                let staged_root = staging_root.join(&planned.attachment_id);
                let staged_payload = staged_root.join("payload");
                let final_payload = final_root.join("payload");
                // Staging is hardened after copy/inspection. Temporarily make only
                // its opaque container writable so the payload can be moved into
                // the already-reserved final directory; payload contents remain
                // read-only throughout.
                allow_directory_update(&staged_root)?;
                // macOS requires the moved directory itself to be owner-writable
                // for this cross-directory rename. Only the payload container is
                // opened; its file/tree contents remain hardened and the final
                // tree is hardened again immediately after the move.
                allow_directory_update(&staged_payload)?;
                fs::rename(&staged_payload, &final_payload).with_context(|| {
                    format!(
                        "Failed to promote Managed Attachment payload from {} to {}",
                        staged_payload.display(),
                        final_payload.display()
                    )
                })?;
                harden_managed_attachment_tree(&final_root)?;
                sync_directory(&final_root)?;
                sync_directory(&managed_root)?;
                let final_path = final_payload.join(&staged.receipt.authority_safe_leaf);
                let verified = inspect_runtime_attachment_copy(&final_path)?;
                if verified != staged.receipt {
                    anyhow::bail!("Managed Attachment final digest or tree identity changed");
                }
                let root_relative_payload_path = managed_payload_relative(
                    &plan.camp_id,
                    &planned.attachment_id,
                    &staged.receipt.authority_safe_leaf,
                )?;
                entries.push(MaterializedIngestEntry {
                    attachment_id: planned.attachment_id.clone(),
                    ordinal: planned.ordinal,
                    display_name: staged.attachment.display_name,
                    media_type: staged.attachment.media_type,
                    preview_kind: staged.attachment.preview_kind,
                    kind: staged.receipt.kind,
                    byte_size: staged.receipt.byte_size,
                    file_count: staged.receipt.file_count,
                    directory_count: staged.receipt.directory_count,
                    node_count: staged.receipt.node_count,
                    content_digest: staged.receipt.content_digest,
                    root_relative_payload_path,
                    final_path,
                });
                let _ = remove_managed_attachment_tree(&staged_root);
            }
            let _ = remove_managed_attachment_tree(&staging_root);
            Ok(entries)
        })();
        let entries = match promoted {
            Ok(entries) => entries,
            Err(error) => {
                for root in promoted_roots {
                    let _ = remove_managed_attachment_tree(&root);
                }
                let _ = remove_managed_attachment_tree(&staging_root);
                return Err(error);
            }
        };
        Ok(PreparedManagedAttachmentIngest {
            intent_id: plan.intent_id.clone(),
            camp_id: plan.camp_id.clone(),
            source: plan.source,
            entries,
            composer_source_paths: plan.composer_source_paths(),
        })
    }

    pub fn record_promoted(
        &self,
        database: &mut Database,
        prepared: &PreparedManagedAttachmentIngest,
    ) -> Result<()> {
        let plan = IngestPlanDocument {
            schema_version: INGEST_PLAN_SCHEMA_VERSION,
            entries: prepared
                .entries
                .iter()
                .map(|entry| IngestPlanEntry {
                    attachment_id: entry.attachment_id.clone(),
                    ordinal: entry.ordinal,
                    materialized: Some(MaterializedIngestEvidence {
                        display_name: entry.display_name.clone(),
                        media_type: entry.media_type.clone(),
                        preview_kind: entry.preview_kind.clone(),
                        kind: entry.kind.clone(),
                        byte_size: entry.byte_size,
                        file_count: entry.file_count,
                        directory_count: entry.directory_count,
                        node_count: entry.node_count,
                        content_digest: entry.content_digest.clone(),
                        root_relative_payload_path: entry.root_relative_payload_path.clone(),
                    }),
                })
                .collect(),
        };
        let reserved_bytes = prepared.entries.iter().try_fold(0_u64, |total, entry| {
            total
                .checked_add(entry.byte_size)
                .context("Managed Attachment promoted byte total overflow")
        })?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = database.connection().execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET reserved_bytes = ?2, plan_json = ?3, promoted_at = ?4, updated_at = ?4
            WHERE id = ?1 AND camp_id = ?5 AND source_kind = ?6
              AND state = 'pending' AND promoted_at IS NULL
            "#,
            params![
                prepared.intent_id,
                i64::try_from(reserved_bytes)?,
                serde_json::to_string(&plan)?,
                now,
                prepared.camp_id,
                prepared.source.as_str(),
            ],
        )?;
        if changed != 1 {
            anyhow::bail!("Managed Attachment ingest changed before promote was recorded");
        }
        Ok(())
    }

    pub fn abandon(
        &self,
        database: &mut Database,
        intent_id: &str,
        failure_code: &str,
    ) -> Result<()> {
        validate_intent_id(intent_id)?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET state = 'abandoned', cleanup_state = 'pending', failure_code = ?2,
                completed_at = ?3, updated_at = ?3
            WHERE id = ?1 AND state = 'pending'
            "#,
            params![intent_id, safe_failure_code(failure_code), now],
        )?;
        self.cleanup_intent_files(database, intent_id)
    }

    pub fn cleanup_committed_composer_sources(
        &self,
        authority_store: &CampAttachmentStore,
        prepared: &PreparedManagedAttachmentIngest,
    ) -> Result<()> {
        if prepared.source != ManagedAttachmentIngestSource::Composer {
            return Ok(());
        }
        cleanup_consumed_prepared_attachment_paths(
            authority_store,
            &prepared.camp_id,
            prepared.composer_source_paths(),
        )
    }

    pub fn intent_is_committed(&self, database: &Database, intent_id: &str) -> Result<bool> {
        validate_intent_id(intent_id)?;
        Ok(database
            .connection()
            .query_row(
                "SELECT state = 'committed' FROM managed_attachment_ingest_intent WHERE id = ?1",
                [intent_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(false))
    }

    pub fn reconcile(&self, database: &mut Database) -> Result<usize> {
        let intents = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id
                FROM managed_attachment_ingest_intent
                WHERE state = 'pending' OR cleanup_state = 'pending'
                ORDER BY created_at, id
                "#,
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut reconciled = 0;
        for intent_id in &intents {
            let state: String = database.connection().query_row(
                "SELECT state FROM managed_attachment_ingest_intent WHERE id = ?1",
                [intent_id],
                |row| row.get(0),
            )?;
            if state == "pending" {
                let now = chrono::Utc::now().to_rfc3339();
                database.connection().execute(
                    r#"
                    UPDATE managed_attachment_ingest_intent
                    SET state = 'abandoned', promoted_at = NULL,
                        cleanup_state = 'pending',
                        failure_code = 'managed_attachment_ingest_failed',
                        completed_at = ?2, updated_at = ?2
                    WHERE id = ?1 AND state = 'pending'
                    "#,
                    params![intent_id, now],
                )?;
            }
            match self.cleanup_intent_files(database, intent_id) {
                Ok(()) => reconciled += 1,
                Err(error) => eprintln!(
                    "Managed Attachment cleanup remains pending for intent {intent_id}: {error:#}"
                ),
            }
        }
        Ok(reconciled)
    }

    fn cleanup_intent_files(&self, database: &mut Database, intent_id: &str) -> Result<()> {
        let (camp_id, plan_json, state): (String, String, String) =
            database.connection().query_row(
                r#"
                SELECT camp_id, plan_json, state
                FROM managed_attachment_ingest_intent WHERE id = ?1
                "#,
                [intent_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        if state == "committed" {
            return Ok(());
        }
        let document: IngestPlanDocument = serde_json::from_str(&plan_json)
            .context("Managed Attachment ingest plan is invalid")?;
        validate_plan_document(&document)?;
        let staging_root = self.staging_intent_root(intent_id)?;
        remove_managed_attachment_tree(&staging_root)?;
        let managed_root = self.managed_camp_root(&camp_id)?;
        for entry in document.entries {
            let final_root = managed_root.join(entry.attachment_id);
            remove_managed_attachment_tree(&final_root)?;
        }
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET cleanup_state = 'completed', updated_at = ?2
            WHERE id = ?1 AND state <> 'committed'
            "#,
            params![intent_id, now],
        )?;
        Ok(())
    }

    fn ensure_managed_camp_root(&self, camp_id: &str) -> Result<PathBuf> {
        CampId::parse(camp_id)?;
        let camps_root = self.runtime_root.join("camps");
        let camp_root = camps_root.join(camp_id);
        let attachment_root = camp_root.join("attachments");
        let gate = managed_camp_root_gate(&attachment_root);
        let _admission = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        validate_existing_directory(&camps_root, "Runtime Camp parent")?;
        validate_existing_directory(&camp_root, "Runtime Camp root")?;
        validate_existing_directory(&attachment_root, "Runtime Attachment root")?;
        let managed_root = attachment_root.join(MANAGED_DIRECTORY);
        if managed_root.exists() {
            validate_existing_directory(&managed_root, "Managed Attachment root")?;
            return Ok(managed_root);
        }
        allow_directory_update(&attachment_root)?;
        let result = (|| -> Result<()> {
            create_private_directory(&managed_root)?;
            sync_directory(&attachment_root)
        })();
        let restriction = restrict_runtime_attachment_root(&attachment_root);
        result?;
        restriction?;
        Ok(managed_root)
    }

    fn managed_camp_root(&self, camp_id: &str) -> Result<PathBuf> {
        CampId::parse(camp_id)?;
        Ok(self
            .runtime_root
            .join("camps")
            .join(camp_id)
            .join("attachments")
            .join(MANAGED_DIRECTORY))
    }

    fn staging_intent_root(&self, intent_id: &str) -> Result<PathBuf> {
        validate_intent_id(intent_id)?;
        Ok(self.runtime_root.join(STAGING_DIRECTORY).join(intent_id))
    }
}

#[derive(Debug, Default)]
pub struct ManagedAttachmentService;

#[derive(Debug, Clone, Copy)]
pub struct CommitManagedAttachmentIngest<'a> {
    pub intent_id: &'a str,
    pub camp_id: &'a str,
    pub camp_message_id: &'a str,
    pub expected_source: ManagedAttachmentIngestSource,
    pub created_by_type: &'a str,
    pub created_by_id: &'a str,
    pub now: &'a str,
}

impl ManagedAttachmentService {
    pub fn commit_ingest(
        &self,
        transaction: &Transaction<'_>,
        input: CommitManagedAttachmentIngest<'_>,
    ) -> Result<Vec<String>> {
        let CommitManagedAttachmentIngest {
            intent_id,
            camp_id,
            camp_message_id,
            expected_source,
            created_by_type,
            created_by_id,
            now,
        } = input;
        CampId::parse(camp_id)?;
        validate_intent_id(intent_id)?;
        let (intent_camp_id, source_kind, draft_revision, state, promoted_at, plan_json): (
            String,
            String,
            Option<i64>,
            String,
            Option<String>,
            String,
        ) = transaction.query_row(
            r#"
            SELECT camp_id, source_kind, draft_revision, state, promoted_at, plan_json
            FROM managed_attachment_ingest_intent WHERE id = ?1
            "#,
            [intent_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?;
        if intent_camp_id != camp_id
            || source_kind != expected_source.as_str()
            || state != "pending"
            || promoted_at.is_none()
        {
            anyhow::bail!("Managed Attachment ingest is not ready for this CampMessage");
        }
        let document: IngestPlanDocument = serde_json::from_str(&plan_json)
            .context("Managed Attachment ingest plan is invalid")?;
        validate_plan_document(&document)?;
        if expected_source == ManagedAttachmentIngestSource::Composer {
            let expected_revision = draft_revision
                .context("Composer Managed Attachment intent has no Draft revision")?;
            let actual_revision: i64 = transaction.query_row(
                "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                [camp_id],
                |row| row.get(0),
            )?;
            if actual_revision != expected_revision {
                anyhow::bail!("Camp Composer Draft revision changed before Managed ingest commit");
            }
            let stored_ids = {
                let mut statement = transaction.prepare(
                    r#"
                    SELECT id FROM prepared_attachment
                    WHERE camp_id = ?1 AND state = 'ready'
                    ORDER BY ordinal, id
                    "#,
                )?;
                statement
                    .query_map([camp_id], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            let planned_ids = document
                .entries
                .iter()
                .map(|entry| entry.attachment_id.clone())
                .collect::<Vec<_>>();
            if stored_ids != planned_ids {
                anyhow::bail!(
                    "Camp Composer Draft attachments changed before Managed ingest commit"
                );
            }
        }
        let current_revision: i64 = transaction.query_row(
            "SELECT attachment_revision FROM camp WHERE id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        let available_revision = current_revision
            .checked_add(1)
            .context("Camp attachment revision overflow")?;
        let changed = transaction.execute(
            r#"
            UPDATE camp SET attachment_revision = ?2, version = version + 1, updated_at = ?3
            WHERE id = ?1 AND attachment_revision = ?4
            "#,
            params![camp_id, available_revision, now, current_revision],
        )?;
        if changed != 1 {
            anyhow::bail!("Camp attachment revision changed before Managed ingest commit");
        }
        let mut attachment_ids = Vec::with_capacity(document.entries.len());
        for entry in document.entries {
            let materialized = entry
                .materialized
                .context("Managed Attachment ingest entry was not promoted")?;
            validate_materialized_evidence(camp_id, &entry.attachment_id, &materialized)?;
            transaction.execute(
                r#"
                INSERT INTO managed_attachment(
                    camp_id, id, kind, root_relative_payload_path,
                    media_type, byte_size, file_count, directory_count, node_count,
                    content_digest, preview_kind, origin, state, safe_reason_code,
                    available_revision, created_by_type, created_by_id, created_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, 'available', NULL, ?13, ?14, ?15, ?16
                )
                "#,
                params![
                    camp_id,
                    entry.attachment_id,
                    materialized.kind,
                    materialized.root_relative_payload_path,
                    materialized.media_type,
                    i64::try_from(materialized.byte_size)?,
                    i64::try_from(materialized.file_count)?,
                    i64::try_from(materialized.directory_count)?,
                    i64::try_from(materialized.node_count)?,
                    materialized.content_digest,
                    materialized.preview_kind,
                    expected_source.origin(),
                    available_revision,
                    created_by_type,
                    created_by_id,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO camp_message_attachment_ref(
                    camp_id, camp_message_id, ordinal, attachment_id,
                    display_name_snapshot, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
                params![
                    camp_id,
                    camp_message_id,
                    entry.ordinal,
                    entry.attachment_id,
                    materialized.display_name,
                    now,
                ],
            )?;
            attachment_ids.push(entry.attachment_id);
        }
        let updated = transaction.execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET state = 'committed', cleanup_state = 'none',
                committed_camp_message_id = ?2, completed_at = ?3, updated_at = ?3
            WHERE id = ?1 AND state = 'pending'
            "#,
            params![intent_id, camp_message_id, now],
        )?;
        if updated != 1 {
            anyhow::bail!("Managed Attachment ingest changed before commit");
        }
        Ok(attachment_ids)
    }

    pub fn reference_existing(
        &self,
        transaction: &Transaction<'_>,
        camp_id: &str,
        camp_message_id: &str,
        attachment_ids: &[String],
        now: &str,
    ) -> Result<()> {
        for (ordinal, attachment_id) in attachment_ids.iter().enumerate() {
            let relative_path: String = transaction
                .query_row(
                    r#"
                    SELECT root_relative_payload_path
                    FROM managed_attachment
                    WHERE camp_id = ?1 AND id = ?2 AND state = 'available'
                    "#,
                    params![camp_id, attachment_id],
                    |row| row.get(0),
                )
                .optional()?
                .context("Managed Attachment is unavailable in this Camp")?;
            let display_name = validate_root_relative_path(&relative_path)?
                .file_name()
                .and_then(|value| value.to_str())
                .context("Managed Attachment locator has no UTF-8 display name")?
                .to_string();
            transaction.execute(
                r#"
                INSERT INTO camp_message_attachment_ref(
                    camp_id, camp_message_id, ordinal, attachment_id,
                    display_name_snapshot, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
                params![
                    camp_id,
                    camp_message_id,
                    ordinal as i64,
                    attachment_id,
                    display_name,
                    now,
                ],
            )?;
        }
        Ok(())
    }
}

pub fn resolve_managed_attachment_path(
    connection: &Connection,
    camp_id: &str,
    attachment_id: &str,
) -> Result<String> {
    CampId::parse(camp_id)?;
    Uuid::parse_str(attachment_id).context("Managed Attachment ID is invalid")?;
    let relative: String = connection
        .query_row(
            r#"
            SELECT root_relative_payload_path
            FROM managed_attachment
            WHERE camp_id = ?1 AND id = ?2 AND state = 'available'
            "#,
            params![camp_id, attachment_id],
            |row| row.get(0),
        )
        .optional()?
        .context("Managed Attachment is unavailable")?;
    let relative = validate_root_relative_path(&relative)?;
    let root: String =
        connection.query_row("SELECT rovai_runtime_camp_files_root()", [], |row| {
            row.get(0)
        })?;
    Ok(PathBuf::from(root)
        .join(relative)
        .to_string_lossy()
        .into_owned())
}

fn begin_ingest_intent(
    database: &mut Database,
    camp_id: &str,
    command_id: &str,
    source: ManagedAttachmentIngestSource,
    draft_revision: Option<i64>,
    reserved_bytes: u64,
    entries: &[IngestPlanEntry],
) -> Result<String> {
    if command_id.trim().is_empty() {
        anyhow::bail!("Managed Attachment command ID is empty");
    }
    let document = IngestPlanDocument {
        schema_version: INGEST_PLAN_SCHEMA_VERSION,
        entries: entries.to_vec(),
    };
    validate_plan_document(&document)?;
    let transaction = database.connection_mut().transaction()?;
    if let Some(existing) = load_existing_intent(
        &transaction,
        camp_id,
        command_id,
        source,
        draft_revision,
        reserved_bytes,
        &document,
    )? {
        transaction.commit()?;
        return Ok(existing);
    }
    check_quota(&transaction, camp_id, reserved_bytes)?;
    let intent_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        INSERT INTO managed_attachment_ingest_intent(
            id, camp_id, command_id, source_kind, draft_revision,
            state, reserved_bytes, plan_json, cleanup_state,
            committed_camp_message_id, failure_code,
            created_at, updated_at, promoted_at, completed_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, 'none',
            NULL, NULL, ?8, ?8, NULL, NULL
        )
        "#,
        params![
            intent_id,
            camp_id,
            command_id,
            source.as_str(),
            draft_revision,
            i64::try_from(reserved_bytes)?,
            serde_json::to_string(&document)?,
            now,
        ],
    )?;
    transaction.commit()?;
    Ok(intent_id)
}

fn load_existing_intent(
    transaction: &Transaction<'_>,
    camp_id: &str,
    command_id: &str,
    source: ManagedAttachmentIngestSource,
    draft_revision: Option<i64>,
    reserved_bytes: u64,
    document: &IngestPlanDocument,
) -> Result<Option<String>> {
    let row = transaction
        .query_row(
            r#"
            SELECT id, source_kind, draft_revision, state, promoted_at,
                   cleanup_state, plan_json
            FROM managed_attachment_ingest_intent
            WHERE camp_id = ?1 AND command_id = ?2 AND source_kind = ?3
            "#,
            params![camp_id, command_id, source.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((id, stored_source, stored_revision, state, promoted_at, cleanup_state, plan_json)) =
        row
    else {
        return Ok(None);
    };
    let stored: IngestPlanDocument = serde_json::from_str(&plan_json)?;
    let stored_base = IngestPlanDocument {
        schema_version: stored.schema_version,
        entries: stored
            .entries
            .iter()
            .cloned()
            .map(|mut entry| {
                entry.materialized = None;
                entry
            })
            .collect(),
    };
    if stored_source != source.as_str()
        || stored_revision != draft_revision
        || stored_base != *document
    {
        anyhow::bail!("Managed Attachment command already has a different ingest outcome");
    }
    if state == "pending" && promoted_at.is_none() && stored == *document {
        return Ok(Some(id));
    }
    if state == "abandoned" && cleanup_state == "completed" {
        check_quota(transaction, camp_id, reserved_bytes)?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = transaction.execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET state = 'pending', reserved_bytes = ?2, plan_json = ?3,
                cleanup_state = 'none', failure_code = NULL,
                promoted_at = NULL, completed_at = NULL, updated_at = ?4
            WHERE id = ?1 AND state = 'abandoned' AND cleanup_state = 'completed'
            "#,
            params![
                id,
                i64::try_from(reserved_bytes)?,
                serde_json::to_string(document)?,
                now,
            ],
        )?;
        if changed == 1 {
            return Ok(Some(id));
        }
    }
    anyhow::bail!("Managed Attachment command already has a different ingest outcome");
}

fn load_or_resume_agent_intent(
    database: &mut Database,
    camp_id: &str,
    command_id: &str,
    attachment_count: usize,
) -> Result<Option<(String, Vec<IngestPlanEntry>)>> {
    let transaction = database.connection_mut().transaction()?;
    let row = transaction
        .query_row(
            r#"
            SELECT id, state, promoted_at, cleanup_state, plan_json
            FROM managed_attachment_ingest_intent
            WHERE camp_id = ?1 AND command_id = ?2 AND source_kind = 'agent_workspace'
            "#,
            params![camp_id, command_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((intent_id, state, promoted_at, cleanup_state, plan_json)) = row else {
        transaction.commit()?;
        return Ok(None);
    };
    let stored: IngestPlanDocument =
        serde_json::from_str(&plan_json).context("Managed Attachment ingest plan is invalid")?;
    validate_plan_document(&stored)?;
    let had_materialized_evidence = stored
        .entries
        .iter()
        .any(|entry| entry.materialized.is_some());
    let document = IngestPlanDocument {
        schema_version: stored.schema_version,
        entries: stored
            .entries
            .into_iter()
            .map(|mut entry| {
                entry.materialized = None;
                entry
            })
            .collect(),
    };
    if document.entries.len() != attachment_count {
        anyhow::bail!("Managed Attachment command already has a different ingest outcome");
    }
    if state == "pending" && promoted_at.is_none() && !had_materialized_evidence {
        transaction.commit()?;
        return Ok(Some((intent_id, document.entries)));
    }
    if state == "abandoned" && cleanup_state == "completed" {
        check_quota(&transaction, camp_id, MAX_DRAFT_ATTACHMENT_BYTES)?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = transaction.execute(
            r#"
            UPDATE managed_attachment_ingest_intent
            SET state = 'pending', reserved_bytes = ?2, plan_json = ?3,
                cleanup_state = 'none', failure_code = NULL,
                promoted_at = NULL, completed_at = NULL, updated_at = ?4
            WHERE id = ?1 AND state = 'abandoned' AND cleanup_state = 'completed'
            "#,
            params![
                intent_id,
                i64::try_from(MAX_DRAFT_ATTACHMENT_BYTES)?,
                serde_json::to_string(&document)?,
                now,
            ],
        )?;
        if changed == 1 {
            transaction.commit()?;
            return Ok(Some((intent_id, document.entries)));
        }
    }
    anyhow::bail!("Managed Attachment command already has a different ingest outcome")
}

fn load_composer_sources(
    connection: &Connection,
    camp_id: &str,
    draft_revision: i64,
    requested_attachment_ids: &[String],
) -> Result<Vec<ComposerSource>> {
    let actual_revision: i64 = connection.query_row(
        "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
        [camp_id],
        |row| row.get(0),
    )?;
    if actual_revision != draft_revision {
        anyhow::bail!("Camp Composer Draft revision changed before Managed ingest");
    }
    let rows = {
        let mut statement = connection.prepare(
            r#"
            SELECT id, storage_path, media_type, byte_size, content_digest
            FROM prepared_attachment
            WHERE camp_id = ?1 AND state = 'ready'
            ORDER BY ordinal, id
            "#,
        )?;
        statement
            .query_map([camp_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let stored_ids = rows.iter().map(|row| row.0.as_str()).collect::<Vec<_>>();
    let requested_ids = requested_attachment_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if stored_ids != requested_ids {
        anyhow::bail!("Camp Composer Draft attachments changed before Managed ingest");
    }
    rows.into_iter()
        .map(|(_, storage_path, media_type, byte_size, content_digest)| {
            Ok(ComposerSource {
                storage_path: PathBuf::from(storage_path),
                media_type,
                byte_size: u64::try_from(byte_size)
                    .context("Prepared Attachment byte size is invalid")?,
                content_digest,
            })
        })
        .collect()
}

fn check_quota(transaction: &Transaction<'_>, camp_id: &str, requested: u64) -> Result<()> {
    let camp_used: i64 = transaction.query_row(
        r#"
        SELECT COALESCE((
            SELECT SUM(byte_size) FROM managed_attachment
            WHERE camp_id = ?1 AND state <> 'pending_delete'
        ), 0) + COALESCE((
            SELECT SUM(reserved_bytes) FROM managed_attachment_ingest_intent
            WHERE camp_id = ?1 AND state = 'pending'
        ), 0)
        "#,
        [camp_id],
        |row| row.get(0),
    )?;
    let instance_used: i64 = transaction.query_row(
        r#"
        SELECT COALESCE((
            SELECT SUM(byte_size) FROM managed_attachment
            WHERE state <> 'pending_delete'
        ), 0) + COALESCE((
            SELECT SUM(reserved_bytes) FROM managed_attachment_ingest_intent
            WHERE state = 'pending'
        ), 0)
        "#,
        [],
        |row| row.get(0),
    )?;
    if u64::try_from(camp_used)?.saturating_add(requested) > MAX_CAMP_VIEW_BYTES {
        anyhow::bail!("Camp Managed Attachment quota exceeded");
    }
    if u64::try_from(instance_used)?.saturating_add(requested) > MAX_INSTANCE_VIEW_BYTES {
        anyhow::bail!("Instance Managed Attachment quota exceeded");
    }
    Ok(())
}

fn validate_plan_document(document: &IngestPlanDocument) -> Result<()> {
    if document.schema_version != INGEST_PLAN_SCHEMA_VERSION
        || document.entries.is_empty()
        || document.entries.len() > MAX_PREPARED_ATTACHMENTS
    {
        anyhow::bail!("Managed Attachment ingest plan version or size is invalid");
    }
    for (ordinal, entry) in document.entries.iter().enumerate() {
        Uuid::parse_str(&entry.attachment_id).context("Managed Attachment ID is invalid")?;
        if entry.ordinal != ordinal as i64 {
            anyhow::bail!("Managed Attachment ingest ordinals are not contiguous");
        }
    }
    Ok(())
}

fn validate_materialized_evidence(
    camp_id: &str,
    attachment_id: &str,
    evidence: &MaterializedIngestEvidence,
) -> Result<()> {
    if !matches!(evidence.kind.as_str(), "file" | "directory")
        || !matches!(evidence.preview_kind.as_str(), "image" | "none")
        || evidence.node_count == 0
        || evidence.content_digest.trim().is_empty()
        || evidence.display_name.trim().is_empty()
        || evidence.root_relative_payload_path
            != managed_payload_relative(camp_id, attachment_id, &evidence.display_name)?
    {
        anyhow::bail!("Managed Attachment promoted evidence is invalid");
    }
    Ok(())
}

fn managed_payload_relative(camp_id: &str, attachment_id: &str, leaf: &str) -> Result<String> {
    CampId::parse(camp_id)?;
    Uuid::parse_str(attachment_id).context("Managed Attachment ID is invalid")?;
    if leaf.is_empty()
        || Path::new(leaf).components().count() != 1
        || !matches!(
            Path::new(leaf).components().next(),
            Some(Component::Normal(_))
        )
    {
        anyhow::bail!("Managed Attachment payload leaf is unsafe");
    }
    Ok(format!(
        "camps/{camp_id}/attachments/{MANAGED_DIRECTORY}/{attachment_id}/payload/{leaf}"
    ))
}

fn validate_root_relative_path(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_))
                || matches!(component, Component::CurDir | Component::ParentDir)
        })
    {
        anyhow::bail!("Managed Attachment locator is unsafe");
    }
    Ok(path.to_path_buf())
}

fn validate_intent_id(intent_id: &str) -> Result<()> {
    Uuid::parse_str(intent_id).context("Managed Attachment ingest intent ID is invalid")?;
    Ok(())
}

fn preview_kind_for_media_type(media_type: &str) -> String {
    if media_type.starts_with("image/") {
        "image".to_string()
    } else {
        "none".to_string()
    }
}

fn safe_failure_code(value: &str) -> &str {
    match value {
        "draft_revision_changed"
        | "source_invalid"
        | "copy_failed"
        | "promote_failed"
        | "message_commit_failed" => value,
        _ => "managed_attachment_ingest_failed",
    }
}

fn create_private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Managed Attachment directory is unsafe");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn validate_existing_directory(path: &Path, label: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("{label} is unavailable: {}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("{label} is unsafe");
    }
    Ok(())
}

fn managed_camp_root_gate(identity: &Path) -> ManagedCampRootGate {
    let registry = MANAGED_CAMP_ROOT_GATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registry = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = registry.get(identity).and_then(Weak::upgrade) {
        return gate;
    }
    let gate = Arc::new(Mutex::new(()));
    registry.insert(identity.to_path_buf(), Arc::downgrade(&gate));
    gate
}

fn allow_directory_update(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn restrict_runtime_attachment_root(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o500))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_attachment::{CampAttachmentStore, insert_test_camp},
        camp_attachment_view::CampAttachmentViewStore,
    };

    fn fixture() -> (Database, PathBuf, String) {
        let directory =
            std::env::temp_dir().join(format!("rovai-managed-attachment-v2-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let runtime_root = directory.join("runtime-files");
        let view = CampAttachmentViewStore::for_isolated_test_root(&runtime_root).unwrap();
        let mut database = Database::open_with_runtime_camp_files_root(
            &directory,
            view.root(),
            view.root_identity_digest(),
        )
        .unwrap();
        let camp_id = CampId::new().to_string();
        insert_test_camp(&database, &camp_id);
        view.ensure_empty_camp_ready(&mut database, &camp_id)
            .unwrap();
        drop(view);
        (database, directory, camp_id)
    }

    #[test]
    fn composer_ingest_promotes_once_and_commits_only_v2_rows() {
        let (mut database, directory, camp_id) = fixture();
        let draft_store = CampAttachmentStore::new(&directory);
        let source = directory.join("managed-v2-source.txt");
        fs::write(&source, b"managed-v2").unwrap();
        let draft = draft_store
            .prepare_from_path(&mut database, &camp_id, 0, &source, "managed-v2.txt")
            .unwrap();
        let ids = draft
            .attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect::<Vec<_>>();
        let managed_store = ManagedAttachmentStore::for_database(&database);
        let plan = managed_store
            .begin_composer_ingest(
                &mut database,
                &camp_id,
                "managed-v2-composer-command",
                draft.revision,
                &ids,
            )
            .unwrap()
            .unwrap();
        let prepared = managed_store
            .materialize_composer(&draft_store, &plan)
            .unwrap();
        managed_store
            .record_promoted(&mut database, &prepared)
            .unwrap();

        let message_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id,
                    body, structured_content_json, content_digest,
                    address_mode, addressed_agent_ids_json,
                    tombstoned_at, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, 1, 'user', 'current-user', '', '[]', 'sha256:test',
                    'default', '[]', NULL, 1, ?3, ?3
                )
                "#,
                params![message_id, camp_id, now],
            )
            .unwrap();
        ManagedAttachmentService
            .commit_ingest(
                &transaction,
                CommitManagedAttachmentIngest {
                    intent_id: prepared.intent_id(),
                    camp_id: &camp_id,
                    camp_message_id: &message_id,
                    expected_source: ManagedAttachmentIngestSource::Composer,
                    created_by_type: "user",
                    created_by_id: "current-user",
                    now: &now,
                },
            )
            .unwrap();
        transaction.commit().unwrap();

        let counts: (i64, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM managed_attachment),
                       (SELECT COUNT(*) FROM camp_message_attachment_ref),
                       (SELECT COUNT(*) FROM message_attachment)
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 0));
        let path =
            resolve_managed_attachment_path(database.connection(), &camp_id, &ids[0]).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"managed-v2");

        let second_message_id = Uuid::new_v4().to_string();
        let transaction = database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id,
                    body, structured_content_json, content_digest,
                    address_mode, addressed_agent_ids_json,
                    tombstoned_at, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, 2, 'agent', 'agent_1', 'reuse', '[]', 'sha256:reuse',
                    'broadcast', '[]', NULL, 1, ?3, ?3
                )
                "#,
                params![second_message_id, camp_id, now],
            )
            .unwrap();
        ManagedAttachmentService
            .reference_existing(&transaction, &camp_id, &second_message_id, &ids, &now)
            .unwrap();
        transaction.commit().unwrap();
        let reuse_counts: (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM managed_attachment),
                       (SELECT COUNT(*) FROM camp_message_attachment_ref)
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(reuse_counts, (1, 2));
        assert_eq!(
            resolve_managed_attachment_path(database.connection(), &camp_id, &ids[0]).unwrap(),
            path
        );
        assert_eq!(fs::read(&path).unwrap(), b"managed-v2");

        remove_managed_attachment_tree(Path::new(&path).parent().unwrap().parent().unwrap())
            .unwrap();
        assert_eq!(
            resolve_managed_attachment_path(database.connection(), &camp_id, &ids[0]).unwrap(),
            path,
            "DB-only Context path projection must not probe the local payload"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT state FROM managed_attachment WHERE camp_id = ?1 AND id = ?2",
                    params![camp_id, ids[0]],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "available"
        );

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn startup_reconcile_abandons_staging_and_promoted_precommit_intents() {
        let (mut database, directory, camp_id) = fixture();
        let draft_store = CampAttachmentStore::new(&directory);
        let source = directory.join("managed-v2-crash-source.txt");
        fs::write(&source, b"survives until semantic commit").unwrap();
        let draft = draft_store
            .prepare_from_path(&mut database, &camp_id, 0, &source, "crash.txt")
            .unwrap();
        let ids = draft
            .attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect::<Vec<_>>();
        let store = ManagedAttachmentStore::for_database(&database);

        let staging_plan = store
            .begin_composer_ingest(
                &mut database,
                &camp_id,
                "managed-v2-crash-after-staging",
                draft.revision,
                &ids,
            )
            .unwrap()
            .unwrap();
        let staging_root = store.staging_intent_root(staging_plan.intent_id()).unwrap();
        create_private_directory(&staging_root).unwrap();
        fs::write(staging_root.join("partial"), b"partial staging").unwrap();
        assert_eq!(store.reconcile(&mut database).unwrap(), 1);
        assert!(!staging_root.exists());
        let resumed_staging_plan = store
            .begin_composer_ingest(
                &mut database,
                &camp_id,
                "managed-v2-crash-after-staging",
                draft.revision,
                &ids,
            )
            .unwrap()
            .unwrap();
        assert_eq!(resumed_staging_plan.intent_id(), staging_plan.intent_id());
        store
            .abandon(
                &mut database,
                resumed_staging_plan.intent_id(),
                "copy_failed",
            )
            .unwrap();

        let promoted_plan = store
            .begin_composer_ingest(
                &mut database,
                &camp_id,
                "managed-v2-crash-after-promote",
                draft.revision,
                &ids,
            )
            .unwrap()
            .unwrap();
        let promoted = store
            .materialize_composer(&draft_store, &promoted_plan)
            .unwrap();
        store.record_promoted(&mut database, &promoted).unwrap();
        let final_path = promoted.attachments()[0].storage_path.clone();
        assert!(final_path.is_file());
        assert_eq!(store.reconcile(&mut database).unwrap(), 1);
        assert!(!final_path.exists());

        let agent_plan = store
            .begin_agent_ingest(&mut database, &camp_id, "managed-v2-crash-agent-retry", 1)
            .unwrap()
            .unwrap();
        let agent_attachment_ids = agent_plan.attachment_ids();
        let agent_staging_root = store.staging_intent_root(agent_plan.intent_id()).unwrap();
        create_private_directory(&agent_staging_root).unwrap();
        fs::write(agent_staging_root.join("partial"), b"partial agent staging").unwrap();
        assert_eq!(store.reconcile(&mut database).unwrap(), 1);
        let resumed_agent_plan = store
            .begin_agent_ingest(&mut database, &camp_id, "managed-v2-crash-agent-retry", 1)
            .unwrap()
            .unwrap();
        assert_eq!(resumed_agent_plan.intent_id(), agent_plan.intent_id());
        assert_eq!(resumed_agent_plan.attachment_ids(), agent_attachment_ids);
        store
            .abandon(&mut database, resumed_agent_plan.intent_id(), "copy_failed")
            .unwrap();

        let mut statement = database
            .connection()
            .prepare(
                r#"
                SELECT state, cleanup_state
                FROM managed_attachment_ingest_intent
                ORDER BY command_id
                "#,
            )
            .unwrap();
        let states = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            states,
            vec![
                ("abandoned".to_string(), "completed".to_string()),
                ("abandoned".to_string(), "completed".to_string()),
                ("abandoned".to_string(), "completed".to_string()),
            ]
        );
        drop(statement);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                    [&camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            draft.revision,
            "precommit recovery must preserve the current Draft"
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM managed_attachment", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );

        drop(database);
        let _ = fs::remove_dir_all(directory);
    }
}
