#[cfg(all(test, feature = "slow-tests"))]
use crate::local_attachment_snapshot::inspect_prefix;
use crate::local_attachment_snapshot::make_owned_tree_removable;
pub use crate::local_attachment_snapshot::{
    DIRECTORY_MEDIA_TYPE, MAX_ATTACHMENT_BYTES, MAX_DIRECTORY_DEPTH, MAX_DIRECTORY_ENTRIES,
    MAX_DIRECTORY_FILES, MAX_DRAFT_ATTACHMENT_BYTES, MAX_PREPARED_ATTACHMENTS, MAX_PREVIEW_BYTES,
};
use crate::local_attachment_snapshot::{
    LocalAttachmentSnapshot as PreparedAttachment, allow_directory_update, commit_temporary,
    copy_and_inspect, ensure_directory, normalize_display_name, open_source_without_following,
    reject_symlink_path, remove_attachment_directory, set_directory_read_only, set_read_only,
    sync_parent, validate_runtime_safe_leaf, validate_runtime_source_tree,
};
pub(crate) use crate::local_attachment_snapshot::{
    RuntimeAttachmentCopyReceipt, inspect_runtime_attachment_copy,
};
#[cfg(all(test, feature = "slow-tests"))]
use std::fs::File;

use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, OnceLock, Weak},
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    camp_attachment_publication::AuthorityAttachment,
    camp_content::{
        ComposerAtom, ComposerDocument, ComposerSegment, EMPTY_COMPOSER_DOCUMENT_JSON,
        StructuredCampMessageContent, StructuredCampMessageSegment, composer_document_to_content,
        has_all_members_mention, member_mention_ids, normalize_composer_document,
        parse_composer_document_json, render_composer_plain_text, render_current_plain_text,
        serialize_composer_document, validate_composer_document,
    },
    camp_id::CampId,
    current_user::{CURRENT_USER_ID, CurrentUserResolver},
    db::Database,
    local_attachment_source::{
        LocalAttachmentAvailability, LocalAttachmentKind, LocalAttachmentOwnerLocator,
        LocalAttachmentSourceRef, LocalAttachmentSourceView, parse_source_attachments,
        serialize_source_attachments, validate_source_attachment,
    },
};

const DRAFT_RETENTION_DAYS: i64 = 7;
const ATTACHMENT_METADATA_FILE: &str = ".rovai-attachment.json";
const ATTACHMENT_METADATA_SCHEMA_VERSION: u32 = 1;
type CampAuthorityIngressGate = Arc<Mutex<()>>;
type CampAuthorityIngressGateRegistry = Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>;
static CAMP_AUTHORITY_INGRESS_GATES: OnceLock<CampAuthorityIngressGateRegistry> = OnceLock::new();

#[cfg(feature = "slow-tests")]
#[doc(hidden)]
pub struct ComposerPrepareTestPause {
    started: std::sync::atomic::AtomicBool,
    released: Mutex<bool>,
    release: std::sync::Condvar,
}

#[cfg(feature = "slow-tests")]
impl ComposerPrepareTestPause {
    fn new() -> Self {
        Self {
            started: std::sync::atomic::AtomicBool::new(false),
            released: Mutex::new(false),
            release: std::sync::Condvar::new(),
        }
    }

    pub fn started(&self) -> bool {
        self.started.load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn release(&self) {
        *lock_unpoisoned(&self.released) = true;
        self.release.notify_all();
    }
}

#[cfg(feature = "slow-tests")]
type ComposerPrepareTestPauseRegistry = Mutex<HashMap<PathBuf, Arc<ComposerPrepareTestPause>>>;

#[cfg(feature = "slow-tests")]
fn composer_prepare_test_pauses() -> &'static ComposerPrepareTestPauseRegistry {
    static PAUSES: OnceLock<ComposerPrepareTestPauseRegistry> = OnceLock::new();
    PAUSES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(feature = "slow-tests")]
fn composer_prepare_test_key(data_dir: &Path, camp_id: &str) -> PathBuf {
    data_dir.join("camp-attachments").join(camp_id)
}

#[cfg(feature = "slow-tests")]
#[doc(hidden)]
pub fn install_composer_prepare_test_pause(
    data_dir: &Path,
    camp_id: &str,
) -> Arc<ComposerPrepareTestPause> {
    let pause = Arc::new(ComposerPrepareTestPause::new());
    lock_unpoisoned(composer_prepare_test_pauses()).insert(
        composer_prepare_test_key(data_dir, camp_id),
        Arc::clone(&pause),
    );
    pause
}

#[cfg(feature = "slow-tests")]
#[doc(hidden)]
pub fn remove_composer_prepare_test_pause(data_dir: &Path, camp_id: &str) {
    lock_unpoisoned(composer_prepare_test_pauses())
        .remove(&composer_prepare_test_key(data_dir, camp_id));
}

#[cfg(feature = "slow-tests")]
fn pause_composer_prepare_for_test(camp_root: &Path) {
    let pause = lock_unpoisoned(composer_prepare_test_pauses())
        .get(camp_root)
        .cloned();
    let Some(pause) = pause else {
        return;
    };
    pause
        .started
        .store(true, std::sync::atomic::Ordering::Release);
    let mut released = lock_unpoisoned(&pause.released);
    while !*released {
        released = pause
            .release
            .wait(released)
            .unwrap_or_else(|error| error.into_inner());
    }
}

#[cfg(all(test, any(windows, feature = "slow-tests")))]
const DIRECTORY_SNAPSHOT_FIXTURE_DIGEST: &str =
    "sha256:69c6a7b4e706d0177bdcc3b806c25daac505628a8d9f22c4976fd5c93ef87501";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedAttachmentSummary {
    pub kind: String,
    pub file_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StagedAgentAttachment {
    pub attachment: crate::camp_attachment_publication::AuthorityAttachment,
    pub receipt: RuntimeAttachmentCopyReceipt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedAttachmentMetadata {
    schema_version: u32,
    kind: String,
    file_count: u64,
    byte_size: u64,
    content_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerDraftView {
    pub camp_id: String,
    pub body: String,
    pub content: ComposerDocument,
    pub revision: i64,
    pub attachments: Vec<LocalAttachmentSourceView>,
    pub reply_intent: Option<CampComposerReplyIntentView>,
    pub continuation_intent: Option<CampComposerContinuationIntentView>,
    pub updated_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerContinuationIntentView {
    pub source_camp_message_id: String,
    pub recipient: CampComposerContinuationRecipientView,
    pub recipient_selection_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerContinuationRecipientView {
    pub agent_id: String,
    pub display_name: String,
    pub recipient_availability: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerReplyIntentView {
    pub reply_to_camp_message_id: String,
    pub target_state: String,
    pub author: Option<CampComposerReplyAuthorView>,
    pub excerpt: Option<String>,
    pub recipient_selection_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampComposerReplyAuthorView {
    pub author_type: String,
    pub author_id: String,
    pub display_name: String,
    pub recipient_availability: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CampComposerReplyRecipient {
    Member {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    AllMembers,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentPreviewSource {
    pub path: PathBuf,
    pub media_type: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentPreviewCandidate {
    attachment_id: String,
    camp_id: String,
    display_name: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    path: PathBuf,
    storage_model: AttachmentStorageModel,
    scope_root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopAttachmentOpenCandidate {
    attachment_id: String,
    camp_id: String,
    display_name: String,
    media_type: String,
    byte_size: u64,
    content_digest: String,
    path: PathBuf,
    storage_model: AttachmentStorageModel,
    scope_root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttachmentStorageModel {
    AuthorityV1,
    ManagedV2,
}

#[derive(Debug)]
pub struct ComposerAttachmentPreparePlan {
    camp_id: String,
    expected_revision: i64,
    source_path: PathBuf,
    display_name: String,
    attachment_id: String,
}

#[derive(Debug)]
pub struct PreparedComposerAttachment {
    camp_id: String,
    expected_revision: i64,
    display_name: String,
    attachment_id: String,
    attachment_directory: PathBuf,
    prepared: PreparedAttachment,
}

#[derive(Debug)]
pub struct CampAttachmentCleanupPlan {
    camp_id: String,
    attachment_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAttachmentOpenRisk {
    Normal,
    Confirm,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAttachmentTarget {
    pub attachment_id: String,
    pub display_name: String,
    pub kind: String,
    pub media_type: String,
    pub path: PathBuf,
    pub open_risk: DesktopAttachmentOpenRisk,
}

pub fn preview_source_attachment(
    source_ref: &LocalAttachmentSourceRef,
) -> Result<Option<AttachmentPreviewSource>> {
    validate_source_attachment(source_ref).map_err(anyhow::Error::new)?;
    if source_ref.kind != LocalAttachmentKind::File
        || !source_ref
            .media_type
            .as_deref()
            .is_some_and(|media_type| media_type.starts_with("image/"))
    {
        return Ok(None);
    }
    let path = PathBuf::from(&source_ref.source_path);
    let byte_size = fs::metadata(&path)?.len();
    Ok(Some(AttachmentPreviewSource {
        path,
        media_type: source_ref
            .media_type
            .clone()
            .expect("image Source Attachment has a media type"),
        byte_size,
    }))
}

pub fn desktop_target_for_source_attachment(
    source_ref: &LocalAttachmentSourceRef,
) -> Result<DesktopAttachmentTarget> {
    validate_source_attachment(source_ref).map_err(anyhow::Error::new)?;
    let path = PathBuf::from(&source_ref.source_path);
    let inspected_path = fs::canonicalize(&path)?;
    let kind = source_ref.kind.as_str().to_string();
    let media_type = source_ref
        .media_type
        .clone()
        .unwrap_or_else(|| match source_ref.kind {
            LocalAttachmentKind::File => "application/octet-stream".to_string(),
            LocalAttachmentKind::Directory => DIRECTORY_MEDIA_TYPE.to_string(),
        });
    let open_risk = desktop_attachment_open_risk(
        &inspected_path,
        &source_ref.display_name,
        &media_type,
        &kind,
    )?;
    Ok(DesktopAttachmentTarget {
        attachment_id: source_ref.id.clone(),
        display_name: source_ref.display_name.clone(),
        kind,
        media_type,
        path,
        open_risk,
    })
}

pub fn legacy_attachment_belongs_to_owner(
    database: &Database,
    locator: &LocalAttachmentOwnerLocator,
) -> Result<bool> {
    let belongs = match locator {
        LocalAttachmentOwnerLocator::Composer {
            camp_id,
            attachment_ref_id,
        } => database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1 AND id = ?2)",
            params![camp_id, attachment_ref_id],
            |row| row.get(0),
        )?,
        LocalAttachmentOwnerLocator::Message {
            camp_id,
            message_id,
            attachment_ref_id,
        } => database.connection().query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM message_attachment
                WHERE camp_id = ?1 AND camp_message_id = ?2 AND id = ?3
                UNION ALL
                SELECT 1 FROM camp_message_attachment_ref
                WHERE camp_id = ?1 AND camp_message_id = ?2 AND attachment_id = ?3
            )
            "#,
            params![camp_id, message_id, attachment_ref_id],
            |row| row.get(0),
        )?,
        LocalAttachmentOwnerLocator::Pending { .. }
        | LocalAttachmentOwnerLocator::PendingEdit { .. } => false,
    };
    Ok(belongs)
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
        let gate = self.authority_ingress_gate(camp_id)?;
        let admission = lock_unpoisoned(&gate);
        self.camp_root_with_admission(camp_id, &admission)
    }

    fn camp_root_with_admission(
        &self,
        camp_id: &str,
        _admission: &MutexGuard<'_, ()>,
    ) -> Result<PathBuf> {
        let camp_id = CampId::parse(camp_id)?;
        let root = self.root.join(camp_id.as_str());
        ensure_directory(&root)?;
        restrict_discovery(&root)?;
        Ok(root)
    }

    fn authority_ingress_gate(&self, camp_id: &str) -> Result<CampAuthorityIngressGate> {
        let camp_id = CampId::parse(camp_id)?;
        let identity = self.root.join(camp_id.as_str());
        let registry = CAMP_AUTHORITY_INGRESS_GATES.get_or_init(|| Mutex::new(HashMap::new()));
        let mut registry = lock_unpoisoned(registry);
        registry.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = registry.get(&identity).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(Mutex::new(()));
        registry.insert(identity, Arc::downgrade(&gate));
        Ok(gate)
    }

    pub fn freeze_agent_sources(
        &self,
        camp_id: &str,
        requested_paths: &[String],
        execution_workspace: &Path,
        run_tmp: &Path,
    ) -> Result<Vec<AuthorityAttachment>> {
        CampId::parse(camp_id)?;
        if requested_paths.len() > MAX_PREPARED_ATTACHMENTS {
            anyhow::bail!("At most 10 files may be attached to one message");
        }
        let workspace_root = fs::canonicalize(execution_workspace)
            .context("AgentRun execution workspace is unavailable")?;
        let run_tmp_root = fs::canonicalize(run_tmp).context("ROVAI_RUN_TMP is unavailable")?;
        let gate = self.authority_ingress_gate(camp_id)?;
        let admission = lock_unpoisoned(&gate);
        let camp_root = self.camp_root_with_admission(camp_id, &admission)?;
        allow_directory_update(&camp_root)?;
        let mut frozen = Vec::with_capacity(requested_paths.len());
        let mut created_directories = Vec::with_capacity(requested_paths.len());
        let freeze_result = (|| -> Result<()> {
            let mut total_bytes = 0_u64;
            for requested in requested_paths {
                let requested = Path::new(requested);
                let source = if requested.is_absolute() {
                    requested.to_path_buf()
                } else {
                    workspace_root.join(requested)
                };
                if source.components().any(|component| {
                    matches!(
                        component,
                        std::path::Component::ParentDir | std::path::Component::CurDir
                    )
                }) {
                    anyhow::bail!("Attachment source contains an unsafe path component");
                }
                let canonical_source = fs::canonicalize(&source)
                    .with_context(|| format!("Attachment source is unavailable: {requested:?}"))?;
                let (admitted_root, checked_source) =
                    if canonical_source.starts_with(&workspace_root) {
                        let relative = if requested.is_absolute() {
                            source
                                .strip_prefix(execution_workspace)
                                .or_else(|_| source.strip_prefix(&workspace_root))
                                .context("Attachment source uses an unsafe workspace root alias")?
                        } else {
                            requested
                        };
                        (&workspace_root, workspace_root.join(relative))
                    } else if canonical_source.starts_with(&run_tmp_root) {
                        let relative = source
                            .strip_prefix(run_tmp)
                            .or_else(|_| source.strip_prefix(&run_tmp_root))
                            .context("Attachment source uses an unsafe ROVAI_RUN_TMP root alias")?;
                        (&run_tmp_root, run_tmp_root.join(relative))
                    } else {
                        anyhow::bail!(
                            "Attachment source is outside the AgentRun workspace and ROVAI_RUN_TMP"
                        );
                    };
                reject_symlink_path(admitted_root, &checked_source)?;
                let source_name = canonical_source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .context("Attachment source has no UTF-8 display name")?;
                let display_name = normalize_display_name(source_name)?;
                let attachment_id = Uuid::new_v4().to_string();
                let attachment_directory = camp_root.join(&attachment_id);
                created_directories.push(attachment_directory.clone());
                ensure_directory(&attachment_directory)?;
                let destination = attachment_directory.join(&display_name);
                let prepared = copy_and_inspect(&canonical_source, &destination)?;
                total_bytes = total_bytes
                    .checked_add(prepared.byte_size)
                    .context("Agent attachment byte total overflow")?;
                if total_bytes > MAX_DRAFT_ATTACHMENT_BYTES {
                    anyhow::bail!("Attachments exceed the 64 MiB aggregate limit");
                }
                write_attachment_metadata(&attachment_directory, &prepared)?;
                set_directory_read_only(&attachment_directory)?;
                frozen.push(AuthorityAttachment {
                    attachment_id,
                    display_name,
                    media_type: prepared.media_type,
                    byte_size: prepared.byte_size,
                    content_digest: prepared.content_digest,
                    storage_path: prepared.path,
                    preview_kind: prepared.preview_kind,
                });
            }
            Ok(())
        })();
        let _ = restrict_discovery(&camp_root);
        if let Err(error) = freeze_result {
            for directory in &created_directories {
                cleanup_unowned_attachment(&camp_root, directory);
            }
            return Err(error);
        }
        Ok(frozen)
    }

    pub fn cleanup_unowned_agent_sources(&self, camp_id: &str, frozen: &[AuthorityAttachment]) {
        let Ok(gate) = self.authority_ingress_gate(camp_id) else {
            return;
        };
        let admission = lock_unpoisoned(&gate);
        let Ok(camp_root) = self.camp_root_with_admission(camp_id, &admission) else {
            return;
        };
        let _ = allow_directory_update(&camp_root);
        for attachment in frozen {
            if let Some(directory) = attachment.storage_path.parent() {
                cleanup_unowned_attachment(&camp_root, directory);
            }
        }
        let _ = restrict_discovery(&camp_root);
    }

    pub fn load_draft(&self, database: &Database, camp_id: &str) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        let draft = database
            .connection()
            .query_row(
                r#"
                SELECT structured_content_json, revision,
                       reply_to_camp_message_id, recipient_selection_required,
                       continuation_source_message_id,
                       continuation_suppressed_source_message_id,
                       recipient_selection_touched,
                       updated_at, expires_at, source_attachments_json
                FROM camp_composer_draft
                WHERE camp_id = ?1
                "#,
                [camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, bool>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, bool>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            )
            .optional()?;
        let prepared_attachments = load_prepared_attachments(database, camp_id)?;
        Ok(match draft {
            Some((
                content,
                revision,
                reply_to,
                recipient_required,
                continuation_source,
                continuation_suppressed_source,
                recipient_selection_touched,
                updated_at,
                expires_at,
                source_attachments_json,
            )) => {
                let source_attachments = parse_source_attachments(&source_attachments_json)?;
                anyhow::ensure!(
                    prepared_attachments.is_empty() || source_attachments.is_empty(),
                    "Camp Composer Draft mixes legacy Prepared and Source Attachments"
                );
                let attachments = if prepared_attachments.is_empty() {
                    source_attachments
                        .iter()
                        .map(|source_ref| source_ref.view(LocalAttachmentAvailability::Unknown))
                        .collect()
                } else {
                    prepared_attachments.clone()
                };
                let content = parse_composer_document_json(&content)?;
                let structured_content = composer_document_to_content(&content)?;
                let continuation_intent = project_continuation_intent(
                    database.connection(),
                    camp_id,
                    ContinuationProjectionInput {
                        stored_source_message_id: continuation_source.as_deref(),
                        suppressed_source_message_id: continuation_suppressed_source.as_deref(),
                        recipient_selection_touched,
                        content: &structured_content,
                        reply_to_camp_message_id: reply_to.as_deref(),
                        has_attachments: !attachments.is_empty(),
                    },
                )?;
                CampComposerDraftView {
                    camp_id: camp_id.to_string(),
                    body: render_composer_document_for_connection(database.connection(), &content)?,
                    content,
                    revision,
                    attachments,
                    reply_intent: project_reply_intent(
                        database,
                        camp_id,
                        reply_to.as_deref(),
                        recipient_required,
                    )?,
                    continuation_intent,
                    updated_at: Some(updated_at),
                    expires_at: Some(expires_at),
                }
            }
            None => {
                let continuation_intent = project_continuation_intent(
                    database.connection(),
                    camp_id,
                    ContinuationProjectionInput {
                        stored_source_message_id: None,
                        suppressed_source_message_id: None,
                        recipient_selection_touched: false,
                        content: &[],
                        reply_to_camp_message_id: None,
                        has_attachments: !prepared_attachments.is_empty(),
                    },
                )?;
                CampComposerDraftView {
                    camp_id: camp_id.to_string(),
                    body: String::new(),
                    content: ComposerDocument::default(),
                    revision: 0,
                    attachments: prepared_attachments,
                    reply_intent: None,
                    continuation_intent,
                    updated_at: None,
                    expires_at: None,
                }
            }
        })
    }

    pub fn save_body(
        &self,
        database: &mut Database,
        camp_id: &str,
        body: &str,
    ) -> Result<CampComposerDraftView> {
        let current = self.load_draft(database, camp_id)?;
        let content = ComposerDocument {
            version: crate::camp_content::COMPOSER_DOCUMENT_VERSION,
            segments: (!body.is_empty())
                .then(|| crate::camp_content::ComposerSegment::Text {
                    text: body.to_string(),
                })
                .into_iter()
                .collect(),
        };
        self.save_content(database, camp_id, current.revision, content)
    }

    pub fn save_content(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        content: ComposerDocument,
    ) -> Result<CampComposerDraftView> {
        self.save_content_with_continuation(database, camp_id, expected_revision, content, None)
    }

    pub fn save_content_with_continuation(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        content: ComposerDocument,
        continuation_source_message_id: Option<&str>,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        if let Some(source_message_id) = continuation_source_message_id {
            validate_component(source_message_id, "Camp Message")?;
        }
        let content = normalize_composer_document(content);
        validate_composer_document(&content)?;
        let structured_content = composer_document_to_content(&content)?;
        let content_json = serialize_composer_document(&content)?;
        let body = render_composer_document_for_connection(database.connection(), &content)?;
        let current = load_draft_mutation_state(database.connection(), camp_id)?;
        let current_revision = current.as_ref().map_or(0, |draft| draft.revision);
        if current_revision != expected_revision {
            anyhow::bail!("draft_changed");
        }

        let route_changed = current.as_ref().is_some_and(|draft| {
            recipient_signature(&draft.structured_content)
                != recipient_signature(&structured_content)
        }) || (current.is_none()
            && has_explicit_recipient(&structured_content));
        let recipient_selection_touched = current
            .as_ref()
            .is_some_and(|draft| draft.recipient_selection_touched)
            || route_changed;
        let continuation_suppressed_source_message_id = current
            .as_ref()
            .and_then(|draft| draft.continuation_suppressed_source_message_id.clone());
        let mut resolved_continuation_source = current
            .as_ref()
            .and_then(|draft| draft.continuation_source_message_id.clone());
        if recipient_selection_touched {
            resolved_continuation_source = None;
        } else if resolved_continuation_source.is_none()
            && current
                .as_ref()
                .and_then(|draft| draft.reply_to_camp_message_id.as_ref())
                .is_none()
            && !has_explicit_recipient(&structured_content)
            && let Some(requested_source) = continuation_source_message_id
        {
            let latest = latest_continuation_candidate(database.connection(), camp_id)?
                .context("continuation_source_invalid")?;
            if latest.source_message_id != requested_source
                || continuation_suppressed_source_message_id.as_deref() == Some(requested_source)
            {
                anyhow::bail!("continuation_source_invalid");
            }
            resolved_continuation_source = Some(requested_source.to_string());
        }

        if current.as_ref().is_some_and(|draft| {
            draft.document == content
                && draft.continuation_source_message_id == resolved_continuation_source
                && draft.continuation_suppressed_source_message_id
                    == continuation_suppressed_source_message_id
                && draft.recipient_selection_touched == recipient_selection_touched
        }) {
            return self.load_draft(database, camp_id);
        }
        let has_attachments: bool = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)
                 OR EXISTS(
                    SELECT 1 FROM camp_composer_draft
                    WHERE camp_id = ?1 AND source_attachments_json <> '[]'
                 )",
            [camp_id],
            |row| row.get(0),
        )?;
        if current.is_none()
            && content.segments.is_empty()
            && !has_attachments
            && resolved_continuation_source.is_none()
        {
            return self.load_draft(database, camp_id);
        }
        let (now, expires_at) = draft_times();
        if expected_revision == 0 {
            database.connection().execute(
                r#"
                INSERT INTO camp_composer_draft(
                    camp_id, body, structured_content_json, revision,
                    continuation_source_message_id,
                    continuation_suppressed_source_message_id,
                    recipient_selection_touched,
                    created_at, updated_at, expires_at
                ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7, ?8)
                "#,
                params![
                    camp_id,
                    body,
                    content_json,
                    resolved_continuation_source,
                    continuation_suppressed_source_message_id,
                    recipient_selection_touched,
                    now,
                    expires_at
                ],
            )?;
        } else {
            let updated = database.connection().execute(
                r#"
                UPDATE camp_composer_draft
                SET body = ?3,
                    structured_content_json = ?4,
                    continuation_source_message_id = ?5,
                    continuation_suppressed_source_message_id = ?6,
                    recipient_selection_touched = ?7,
                    revision = revision + 1,
                    updated_at = ?8,
                    expires_at = ?9
                WHERE camp_id = ?1 AND revision = ?2
                "#,
                params![
                    camp_id,
                    expected_revision,
                    body,
                    content_json,
                    resolved_continuation_source,
                    continuation_suppressed_source_message_id,
                    recipient_selection_touched,
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

    pub fn start_reply(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        reply_to_camp_message_id: &str,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        validate_component(reply_to_camp_message_id, "Camp Message")?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = transaction
            .query_row(
                r#"
                SELECT author_type, author_id
                FROM camp_message
                WHERE id = ?1 AND camp_id = ?2 AND tombstoned_at IS NULL
                "#,
                params![reply_to_camp_message_id, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((author_type, author_id)) = target else {
            anyhow::bail!("camp_message.invalid_reply");
        };
        let current = load_draft_mutation_state(&transaction, camp_id)?;
        require_expected_revision(current.as_ref(), expected_revision)?;
        let mut content = current
            .as_ref()
            .map(|draft| draft.document.clone())
            .unwrap_or_default();
        let recipient_selection_required = if author_type == "agent" {
            if active_reply_agent(&transaction, camp_id, &author_id)? {
                ensure_leading_composer_recipient(
                    &mut content,
                    ComposerAtom::Member {
                        agent_id: author_id,
                        label_fallback: None,
                    },
                );
                false
            } else {
                true
            }
        } else {
            false
        };
        persist_reply_mutation(
            &transaction,
            camp_id,
            expected_revision,
            current.as_ref(),
            ReplyMutation {
                content,
                reply_to_camp_message_id: Some(reply_to_camp_message_id),
                recipient_selection_required,
                recipient_selection_touched: current
                    .as_ref()
                    .is_some_and(|draft| draft.recipient_selection_touched),
            },
        )?;
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn cancel_reply(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_draft_mutation_state(&transaction, camp_id)?;
        require_expected_revision(current.as_ref(), expected_revision)?;
        let Some(current) = current.as_ref() else {
            transaction.commit()?;
            return self.load_draft(database, camp_id);
        };
        persist_reply_mutation(
            &transaction,
            camp_id,
            expected_revision,
            Some(current),
            ReplyMutation {
                content: current.document.clone(),
                reply_to_camp_message_id: None,
                recipient_selection_required: false,
                recipient_selection_touched: current.recipient_selection_touched,
            },
        )?;
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn resolve_reply_recipient(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        recipient: CampComposerReplyRecipient,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_draft_mutation_state(&transaction, camp_id)?;
        require_expected_revision(current.as_ref(), expected_revision)?;
        let current = current.as_ref().context("camp_message.invalid_reply")?;
        let reply_to = current
            .reply_to_camp_message_id
            .as_deref()
            .context("camp_message.invalid_reply")?;
        let original_author = transaction
            .query_row(
                "SELECT author_type, author_id FROM camp_message WHERE id = ?1 AND camp_id = ?2",
                params![reply_to, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .context("camp_message.invalid_reply")?;
        let mut content = current.document.clone();
        if original_author.0 == "agent"
            && !active_reply_agent(&transaction, camp_id, &original_author.1)?
        {
            content.segments.retain(|segment| {
                !matches!(
                    segment,
                    ComposerSegment::Atom {
                        atom: ComposerAtom::Member { agent_id, .. }
                    } if agent_id == &original_author.1
                )
            });
        }
        let replacement = match recipient {
            CampComposerReplyRecipient::Member { agent_id } => {
                if !active_reply_agent(&transaction, camp_id, &agent_id)? {
                    anyhow::bail!("mention_target_unavailable");
                }
                ComposerAtom::Member {
                    agent_id,
                    label_fallback: None,
                }
            }
            CampComposerReplyRecipient::AllMembers => ComposerAtom::AllMembers,
        };
        ensure_leading_composer_recipient(&mut content, replacement);
        persist_reply_mutation(
            &transaction,
            camp_id,
            expected_revision,
            Some(current),
            ReplyMutation {
                content,
                reply_to_camp_message_id: Some(reply_to),
                recipient_selection_required: false,
                recipient_selection_touched: true,
            },
        )?;
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn dismiss_continuation(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        source_camp_message_id: &str,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        validate_component(source_camp_message_id, "Camp Message")?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_draft_mutation_state(&transaction, camp_id)?;
        require_expected_revision(current.as_ref(), expected_revision)?;
        if current.as_ref().is_some_and(|draft| {
            draft.reply_to_camp_message_id.is_some()
                || draft.recipient_selection_touched
                || has_explicit_recipient(&draft.structured_content)
        }) {
            anyhow::bail!("continuation_source_invalid");
        }
        let candidate = continuation_candidate_for_state(
            &transaction,
            camp_id,
            current
                .as_ref()
                .and_then(|draft| draft.continuation_source_message_id.as_deref()),
        )?
        .context("continuation_source_invalid")?;
        if candidate.source_message_id != source_camp_message_id {
            anyhow::bail!("continuation_source_invalid");
        }
        persist_continuation_mutation(
            &transaction,
            camp_id,
            expected_revision,
            current.as_ref(),
            ContinuationMutation {
                content: current
                    .as_ref()
                    .map(|draft| draft.document.clone())
                    .unwrap_or_default(),
                continuation_source_message_id: None,
                continuation_suppressed_source_message_id: Some(source_camp_message_id),
                recipient_selection_touched: current
                    .as_ref()
                    .is_some_and(|draft| draft.recipient_selection_touched),
            },
        )?;
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn resolve_continuation_recipient(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        agent_id: &str,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load_draft_mutation_state(&transaction, camp_id)?;
        require_expected_revision(current.as_ref(), expected_revision)?;
        let current = current
            .as_ref()
            .context("continuation_recipient_required")?;
        let source_message_id = current
            .continuation_source_message_id
            .as_deref()
            .context("continuation_recipient_required")?;
        let candidate =
            continuation_candidate_for_state(&transaction, camp_id, Some(source_message_id))?
                .context("continuation_recipient_required")?;
        let has_attachments: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)
                 OR EXISTS(
                    SELECT 1 FROM camp_composer_draft
                    WHERE camp_id = ?1 AND source_attachments_json <> '[]'
                 )",
            [camp_id],
            |row| row.get(0),
        )?;
        let has_payload =
            !render_composer_document_for_connection(&transaction, &current.document)?
                .trim()
                .is_empty()
                || has_attachments;
        if candidate.available
            || !has_payload
            || current.reply_to_camp_message_id.is_some()
            || current.recipient_selection_touched
            || has_explicit_recipient(&current.structured_content)
        {
            anyhow::bail!("continuation_recipient_required");
        }
        if candidate.agent_id == agent_id {
            anyhow::bail!("continuation_replacement_invalid");
        }
        if !active_reply_agent(&transaction, camp_id, agent_id)? {
            anyhow::bail!("mention_target_unavailable");
        }
        let mut content = current.document.clone();
        ensure_leading_composer_recipient(
            &mut content,
            ComposerAtom::Member {
                agent_id: agent_id.to_string(),
                label_fallback: None,
            },
        );
        persist_continuation_mutation(
            &transaction,
            camp_id,
            expected_revision,
            Some(current),
            ContinuationMutation {
                content,
                continuation_source_message_id: None,
                continuation_suppressed_source_message_id: Some(source_message_id),
                recipient_selection_touched: true,
            },
        )?;
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn plan_prepare_from_path(
        &self,
        database: &Database,
        camp_id: &str,
        expected_revision: i64,
        source_path: &Path,
        requested_display_name: &str,
    ) -> Result<ComposerAttachmentPreparePlan> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        ensure_draft_revision(database.connection(), camp_id, expected_revision)?;
        let has_source_attachments: bool = database.connection().query_row(
            "SELECT EXISTS(
                SELECT 1 FROM camp_composer_draft
                WHERE camp_id = ?1 AND source_attachments_json <> '[]'
             )",
            [camp_id],
            |row| row.get(0),
        )?;
        anyhow::ensure!(
            !has_source_attachments,
            "legacy_draft.source_attachments_present"
        );
        validate_draft_capacity(database, camp_id, 0)?;
        Ok(ComposerAttachmentPreparePlan {
            camp_id: camp_id.to_string(),
            expected_revision,
            source_path: source_path.to_path_buf(),
            display_name: normalize_display_name(requested_display_name)?,
            attachment_id: Uuid::new_v4().to_string(),
        })
    }

    pub fn commit_source_attachment(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        source_ref: LocalAttachmentSourceRef,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_draft_revision(&transaction, camp_id, expected_revision)?;
        let has_prepared: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)",
            [camp_id],
            |row| row.get(0),
        )?;
        anyhow::ensure!(!has_prepared, "legacy_draft.attachments_locked");
        let mut refs = transaction
            .query_row(
                "SELECT source_attachments_json FROM camp_composer_draft WHERE camp_id = ?1",
                [camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|value| parse_source_attachments(&value))
            .transpose()?
            .unwrap_or_default();
        refs.push(source_ref);
        let refs_json = serialize_source_attachments(&refs)?;
        let (now, expires_at) = draft_times();
        if expected_revision == 0 {
            transaction.execute(
                r#"
                INSERT INTO camp_composer_draft(
                    camp_id, body, structured_content_json, revision,
                    source_attachments_json, created_at, updated_at, expires_at
                ) VALUES (?1, '', ?2, 1, ?3, ?4, ?4, ?5)
                "#,
                params![
                    camp_id,
                    EMPTY_COMPOSER_DOCUMENT_JSON,
                    refs_json,
                    now,
                    expires_at
                ],
            )?;
        } else {
            let updated = transaction.execute(
                r#"
                UPDATE camp_composer_draft
                SET source_attachments_json = ?3, revision = revision + 1,
                    updated_at = ?4, expires_at = ?5
                WHERE camp_id = ?1 AND revision = ?2
                "#,
                params![camp_id, expected_revision, refs_json, now, expires_at],
            )?;
            if updated != 1 {
                anyhow::bail!("draft_changed");
            }
        }
        transaction.commit()?;
        self.load_draft(database, camp_id)
    }

    pub fn prepare_from_path_filesystem(
        &self,
        plan: ComposerAttachmentPreparePlan,
    ) -> Result<PreparedComposerAttachment> {
        let gate = self.authority_ingress_gate(&plan.camp_id)?;
        let admission = lock_unpoisoned(&gate);
        let camp_root = self.camp_root_with_admission(&plan.camp_id, &admission)?;
        allow_directory_update(&camp_root)?;
        #[cfg(feature = "slow-tests")]
        pause_composer_prepare_for_test(&camp_root);
        let attachment_directory = camp_root.join(&plan.attachment_id);
        let prepared = (|| -> Result<PreparedAttachment> {
            ensure_directory(&attachment_directory)?;
            let destination = attachment_directory.join(&plan.display_name);
            let prepared = copy_and_inspect(&plan.source_path, &destination)?;
            write_attachment_metadata(&attachment_directory, &prepared)?;
            set_directory_read_only(&attachment_directory)?;
            Ok(prepared)
        })();
        let _ = restrict_discovery(&camp_root);
        let prepared = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                cleanup_unowned_attachment(&camp_root, &attachment_directory);
                return Err(error);
            }
        };
        Ok(PreparedComposerAttachment {
            camp_id: plan.camp_id,
            expected_revision: plan.expected_revision,
            display_name: plan.display_name,
            attachment_id: plan.attachment_id,
            attachment_directory,
            prepared,
        })
    }

    pub fn commit_prepared_attachment(
        &self,
        database: &mut Database,
        prepared: &PreparedComposerAttachment,
    ) -> Result<()> {
        let transaction = database.connection_mut().transaction()?;
        ensure_draft_revision(&transaction, &prepared.camp_id, prepared.expected_revision)?;
        let has_source_attachments: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM camp_composer_draft
                WHERE camp_id = ?1 AND source_attachments_json <> '[]'
             )",
            [&prepared.camp_id],
            |row| row.get(0),
        )?;
        anyhow::ensure!(
            !has_source_attachments,
            "legacy_draft.source_attachments_present"
        );
        validate_draft_capacity_tx(&transaction, &prepared.camp_id, prepared.prepared.byte_size)?;
        let (now, expires_at) = draft_times();
        transaction.execute(
            r#"
            INSERT INTO camp_composer_draft(
                camp_id, body, structured_content_json, created_at, updated_at, expires_at
            )
            VALUES (?1, '', ?2, ?3, ?3, ?4)
            ON CONFLICT(camp_id) DO UPDATE SET
                revision = camp_composer_draft.revision + 1,
                updated_at = excluded.updated_at,
                expires_at = excluded.expires_at
            "#,
            params![
                prepared.camp_id,
                EMPTY_COMPOSER_DOCUMENT_JSON,
                now,
                expires_at
            ],
        )?;
        let ordinal: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM prepared_attachment WHERE camp_id = ?1",
            [&prepared.camp_id],
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
                prepared.attachment_id,
                prepared.camp_id,
                ordinal,
                prepared.display_name,
                prepared.prepared.media_type,
                prepared.prepared.byte_size as i64,
                prepared.prepared.content_digest,
                prepared.prepared.path.to_string_lossy(),
                prepared.prepared.preview_kind,
                now,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn cleanup_uncommitted_prepared_attachment(&self, prepared: PreparedComposerAttachment) {
        let Ok(gate) = self.authority_ingress_gate(&prepared.camp_id) else {
            return;
        };
        let _admission = lock_unpoisoned(&gate);
        let camp_root = self.root.join(&prepared.camp_id);
        cleanup_unowned_attachment(&camp_root, &prepared.attachment_directory);
    }

    #[cfg(test)]
    pub fn prepare_from_path(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        source_path: &Path,
        requested_display_name: &str,
    ) -> Result<CampComposerDraftView> {
        let plan = self.plan_prepare_from_path(
            database,
            camp_id,
            expected_revision,
            source_path,
            requested_display_name,
        )?;
        let prepared = self.prepare_from_path_filesystem(plan)?;
        if let Err(error) = self.commit_prepared_attachment(database, &prepared) {
            self.cleanup_uncommitted_prepared_attachment(prepared);
            return Err(error);
        }
        self.load_draft(database, camp_id)
    }

    pub fn remove_prepared_from_database(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        attachment_id: &str,
    ) -> Result<(CampComposerDraftView, CampAttachmentCleanupPlan)> {
        CampId::parse(camp_id)?;
        validate_component(attachment_id, "Prepared Attachment")?;
        ensure_draft_revision(database.connection(), camp_id, expected_revision)?;
        let source_json = database
            .connection()
            .query_row(
                "SELECT source_attachments_json FROM camp_composer_draft WHERE camp_id = ?1",
                [camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(source_json) = source_json {
            let mut source_refs = parse_source_attachments(&source_json)?;
            let previous_len = source_refs.len();
            source_refs.retain(|source_ref| source_ref.id != attachment_id);
            if source_refs.len() != previous_len {
                let transaction = database
                    .connection_mut()
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                ensure_draft_revision(&transaction, camp_id, expected_revision)?;
                let (now, expires_at) = draft_times();
                let updated = transaction.execute(
                    r#"
                    UPDATE camp_composer_draft
                    SET source_attachments_json = ?3, revision = revision + 1,
                        updated_at = ?4, expires_at = ?5
                    WHERE camp_id = ?1 AND revision = ?2
                    "#,
                    params![
                        camp_id,
                        expected_revision,
                        serialize_source_attachments(&source_refs)?,
                        now,
                        expires_at
                    ],
                )?;
                if updated != 1 {
                    anyhow::bail!("draft_changed");
                }
                transaction.commit()?;
                return Ok((
                    self.load_draft(database, camp_id)?,
                    CampAttachmentCleanupPlan {
                        camp_id: camp_id.to_string(),
                        attachment_paths: Vec::new(),
                    },
                ));
            }
        }
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
        Ok((
            self.load_draft(database, camp_id)?,
            CampAttachmentCleanupPlan {
                camp_id: camp_id.to_string(),
                attachment_paths: vec![PathBuf::from(path)],
            },
        ))
    }

    #[cfg(test)]
    pub fn remove_prepared(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        attachment_id: &str,
    ) -> Result<CampComposerDraftView> {
        let (draft, cleanup) = self.remove_prepared_from_database(
            database,
            camp_id,
            expected_revision,
            attachment_id,
        )?;
        if let Err(error) = self.cleanup_detached_attachments(cleanup) {
            eprintln!(
                "Prepared Attachment {attachment_id} was removed from Draft {camp_id}, \
                 but its superseded file could not be cleaned immediately: {error:#}"
            );
        }
        Ok(draft)
    }

    pub fn discard_draft_from_database(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<CampAttachmentCleanupPlan> {
        CampId::parse(camp_id)?;
        let paths = prepared_paths(database, camp_id)?;
        database.connection().execute(
            "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
            [camp_id],
        )?;
        Ok(CampAttachmentCleanupPlan {
            camp_id: camp_id.to_string(),
            attachment_paths: paths.into_iter().map(PathBuf::from).collect(),
        })
    }

    pub fn cleanup_detached_attachments(&self, plan: CampAttachmentCleanupPlan) -> Result<()> {
        let parsed_camp_id = CampId::parse(&plan.camp_id)?;
        let gate = self.authority_ingress_gate(&plan.camp_id)?;
        let _admission = lock_unpoisoned(&gate);
        let camp_root = self.root.join(parsed_camp_id.as_str());
        if !plan.attachment_paths.is_empty() && camp_root.exists() {
            allow_directory_update(&camp_root)?;
        }
        let removal = (|| -> Result<()> {
            for path in plan.attachment_paths {
                remove_attachment_file_parent(&path)?;
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

    pub fn discard_draft(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        let cleanup = self.discard_draft_from_database(database, camp_id)?;
        self.cleanup_detached_attachments(cleanup)
    }

    pub fn verify_send(
        &self,
        database: &Database,
        camp_id: &str,
        prepared_attachment_ids: &[String],
    ) -> Result<()> {
        ensure_camp_exists(database, camp_id)?;
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
            validate_owned_attachment(
                &self.root,
                Path::new(&row.storage_path),
                &row.media_type,
                row.byte_size,
                &row.content_digest,
            )?;
        }
        if total > MAX_DRAFT_ATTACHMENT_BYTES {
            anyhow::bail!("Camp Composer Draft exceeds the total attachment size limit");
        }
        Ok(())
    }

    pub fn preview_candidate(
        &self,
        database: &Database,
        attachment_id: &str,
    ) -> Result<Option<AttachmentPreviewCandidate>> {
        validate_managed_attachment_id(attachment_id)?;
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT camp_id, display_name, storage_path, media_type, byte_size,
                       preview_kind, content_digest, 'authority_v1'
                FROM prepared_attachment
                WHERE id = ?1
                UNION ALL
                SELECT camp_id, display_name, storage_path, media_type, byte_size,
                       preview_kind, content_digest, 'authority_v1'
                FROM message_attachment
                WHERE id = ?1
                UNION ALL
                SELECT managed.camp_id,
                       (SELECT reference.display_name_snapshot
                        FROM camp_message_attachment_ref AS reference
                        WHERE reference.camp_id = managed.camp_id
                          AND reference.attachment_id = managed.id
                        ORDER BY reference.created_at, reference.camp_message_id
                        LIMIT 1),
                       managed.root_relative_payload_path,
                       managed.media_type, managed.byte_size,
                       managed.preview_kind, managed.content_digest, 'managed_v2'
                FROM managed_attachment AS managed
                WHERE managed.id = ?1 AND managed.state = 'available'
                LIMIT 1
                "#,
                [attachment_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            camp_id,
            display_name,
            path,
            media_type,
            byte_size,
            preview_kind,
            content_digest,
            storage_model,
        )) = row
        else {
            return Ok(None);
        };
        if preview_kind != "image" || byte_size < 0 || byte_size as u64 > MAX_PREVIEW_BYTES {
            return Ok(None);
        }
        let storage_model = match storage_model.as_str() {
            "authority_v1" => AttachmentStorageModel::AuthorityV1,
            "managed_v2" => AttachmentStorageModel::ManagedV2,
            _ => anyhow::bail!("Attachment storage model is invalid"),
        };
        let scope_root = if storage_model == AttachmentStorageModel::ManagedV2 {
            database.runtime_camp_files_root().to_path_buf()
        } else {
            self.root.clone()
        };
        let path = if storage_model == AttachmentStorageModel::ManagedV2 {
            scope_root.join(validate_managed_runtime_locator(&path)?)
        } else {
            PathBuf::from(path)
        };
        Ok(Some(AttachmentPreviewCandidate {
            attachment_id: attachment_id.to_string(),
            camp_id,
            display_name,
            media_type,
            byte_size: byte_size as u64,
            content_digest,
            path,
            storage_model,
            scope_root,
        }))
    }

    pub fn verify_preview_candidate(
        &self,
        candidate: AttachmentPreviewCandidate,
    ) -> Result<AttachmentPreviewSource> {
        let camp_id = CampId::parse(&candidate.camp_id)?;
        let gate = self.authority_ingress_gate(camp_id.as_str())?;
        let _admission = lock_unpoisoned(&gate);
        let normalized_name = normalize_display_name(&candidate.display_name)?;
        if normalized_name != candidate.display_name {
            anyhow::bail!("Attachment preview display name is not canonical");
        }
        let expected_path = match candidate.storage_model {
            AttachmentStorageModel::AuthorityV1 => self
                .root
                .join(camp_id.as_str())
                .join(&candidate.attachment_id)
                .join(&candidate.display_name),
            AttachmentStorageModel::ManagedV2 => candidate
                .scope_root
                .join("camps")
                .join(camp_id.as_str())
                .join("attachments")
                .join(".managed-v2")
                .join(&candidate.attachment_id)
                .join("payload")
                .join(&candidate.display_name),
        };
        if candidate.path != expected_path {
            anyhow::bail!("Attachment preview path does not match its managed identity");
        }
        reject_symlink_path(&candidate.scope_root, &candidate.path)?;
        let verified = if candidate.storage_model == AttachmentStorageModel::ManagedV2 {
            let inspected = inspect_runtime_attachment_copy(&candidate.path)?;
            if inspected.byte_size != candidate.byte_size
                || inspected.content_digest != candidate.content_digest
                || (candidate.media_type == DIRECTORY_MEDIA_TYPE) != (inspected.kind == "directory")
            {
                anyhow::bail!("Managed Attachment preview receipt changed");
            }
            inspected
        } else {
            self.verify_authority_attachment_for_runtime(
                &candidate.path,
                &candidate.media_type,
                candidate.byte_size,
                &candidate.content_digest,
            )?
        };
        if verified.kind != "file" {
            anyhow::bail!("Attachment preview target is not a file");
        }
        Ok(AttachmentPreviewSource {
            path: candidate.path,
            media_type: candidate.media_type,
            byte_size: candidate.byte_size,
        })
    }

    pub fn desktop_open_candidate(
        &self,
        database: &Database,
        camp_id: &str,
        attachment_id: &str,
    ) -> Result<Option<DesktopAttachmentOpenCandidate>> {
        let camp_id = CampId::parse(camp_id)?;
        validate_managed_attachment_id(attachment_id)?;
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT display_name, media_type, byte_size, content_digest,
                       storage_path, 'authority_v1'
                FROM message_attachment
                WHERE camp_id = ?1 AND id = ?2
                UNION ALL
                SELECT (SELECT reference.display_name_snapshot
                        FROM camp_message_attachment_ref AS reference
                        WHERE reference.camp_id = managed.camp_id
                          AND reference.attachment_id = managed.id
                        ORDER BY reference.created_at, reference.camp_message_id
                        LIMIT 1),
                       managed.media_type, managed.byte_size, managed.content_digest,
                       managed.root_relative_payload_path, 'managed_v2'
                FROM managed_attachment AS managed
                WHERE managed.camp_id = ?1 AND managed.id = ?2
                  AND managed.state = 'available'
                LIMIT 1
                "#,
                params![camp_id.as_str(), attachment_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            display_name,
            media_type,
            byte_size,
            content_digest,
            storage_path,
            storage_model,
        )) = row
        else {
            return Ok(None);
        };
        if byte_size < 0 {
            anyhow::bail!("Published Attachment byte size is invalid");
        }
        let storage_model = match storage_model.as_str() {
            "authority_v1" => AttachmentStorageModel::AuthorityV1,
            "managed_v2" => AttachmentStorageModel::ManagedV2,
            _ => anyhow::bail!("Attachment storage model is invalid"),
        };
        let scope_root = if storage_model == AttachmentStorageModel::ManagedV2 {
            database.runtime_camp_files_root().to_path_buf()
        } else {
            self.root.clone()
        };
        let path = if storage_model == AttachmentStorageModel::ManagedV2 {
            scope_root.join(validate_managed_runtime_locator(&storage_path)?)
        } else {
            PathBuf::from(storage_path)
        };
        Ok(Some(DesktopAttachmentOpenCandidate {
            attachment_id: attachment_id.to_string(),
            camp_id: camp_id.to_string(),
            display_name,
            media_type,
            byte_size: byte_size as u64,
            content_digest,
            path,
            storage_model,
            scope_root,
        }))
    }

    pub fn verify_desktop_open_candidate(
        &self,
        candidate: DesktopAttachmentOpenCandidate,
    ) -> Result<DesktopAttachmentTarget> {
        let gate = self.authority_ingress_gate(&candidate.camp_id)?;
        let _admission = lock_unpoisoned(&gate);
        let normalized_name = normalize_display_name(&candidate.display_name)?;
        if normalized_name != candidate.display_name {
            anyhow::bail!("Published Attachment display name is not canonical");
        }
        let expected_path = match candidate.storage_model {
            AttachmentStorageModel::AuthorityV1 => self
                .root
                .join(&candidate.camp_id)
                .join(&candidate.attachment_id)
                .join(&candidate.display_name),
            AttachmentStorageModel::ManagedV2 => candidate
                .scope_root
                .join("camps")
                .join(&candidate.camp_id)
                .join("attachments")
                .join(".managed-v2")
                .join(&candidate.attachment_id)
                .join("payload")
                .join(&candidate.display_name),
        };
        if candidate.path != expected_path {
            anyhow::bail!("Published Attachment path does not match its managed identity");
        }
        reject_symlink_path(&candidate.scope_root, &candidate.path)?;
        let verified = if candidate.storage_model == AttachmentStorageModel::ManagedV2 {
            let inspected = inspect_runtime_attachment_copy(&candidate.path)?;
            if inspected.byte_size != candidate.byte_size
                || inspected.content_digest != candidate.content_digest
                || (candidate.media_type == DIRECTORY_MEDIA_TYPE) != (inspected.kind == "directory")
            {
                anyhow::bail!("Managed Attachment open receipt changed");
            }
            inspected
        } else {
            self.verify_authority_attachment_for_runtime(
                &candidate.path,
                &candidate.media_type,
                candidate.byte_size,
                &candidate.content_digest,
            )?
        };
        let expected_directory = candidate.media_type == DIRECTORY_MEDIA_TYPE;
        if (verified.kind == "directory") != expected_directory {
            anyhow::bail!("Published Attachment kind does not match its persisted media type");
        }
        let open_risk = desktop_attachment_open_risk(
            &candidate.path,
            &candidate.display_name,
            &candidate.media_type,
            &verified.kind,
        )?;
        let attachment_directory = candidate
            .path
            .parent()
            .context("Published Attachment has no managed container")?;
        set_directory_read_only(attachment_directory)?;
        Ok(DesktopAttachmentTarget {
            attachment_id: candidate.attachment_id,
            display_name: candidate.display_name,
            kind: verified.kind,
            media_type: candidate.media_type,
            path: candidate.path,
            open_risk,
        })
    }

    pub(crate) fn copy_verified_authority_attachment_for_runtime(
        &self,
        storage_path: &Path,
        media_type: &str,
        expected_size: u64,
        expected_digest: &str,
        destination_payload: &Path,
    ) -> Result<RuntimeAttachmentCopyReceipt> {
        validate_owned_attachment(
            &self.root,
            storage_path,
            media_type,
            expected_size,
            expected_digest,
        )?;
        validate_runtime_source_tree(storage_path, 0)?;
        let authority_safe_leaf = storage_path
            .file_name()
            .and_then(|name| name.to_str())
            .context("Authority Attachment has no UTF-8 safe leaf")?
            .to_string();
        validate_runtime_safe_leaf(&authority_safe_leaf)?;
        ensure_directory(destination_payload)?;
        let destination = destination_payload.join(&authority_safe_leaf);
        let copied = copy_and_inspect(storage_path, &destination)?;
        validate_runtime_source_tree(storage_path, 0)?;
        if copied.byte_size != expected_size
            || copied.content_digest != expected_digest
            || (media_type == DIRECTORY_MEDIA_TYPE) != (copied.kind == "directory")
        {
            anyhow::bail!("Camp Attachment Runtime View copy did not match Authority receipt");
        }
        Ok(RuntimeAttachmentCopyReceipt {
            authority_safe_leaf,
            kind: copied.kind,
            file_count: copied.file_count,
            directory_count: copied.directory_count,
            node_count: copied.node_count,
            byte_size: copied.byte_size,
            content_digest: copied.content_digest,
        })
    }

    pub(crate) fn verify_authority_attachment_for_runtime(
        &self,
        storage_path: &Path,
        media_type: &str,
        expected_size: u64,
        expected_digest: &str,
    ) -> Result<RuntimeAttachmentCopyReceipt> {
        validate_owned_attachment(
            &self.root,
            storage_path,
            media_type,
            expected_size,
            expected_digest,
        )?;
        validate_runtime_source_tree(storage_path, 0)?;
        let inspected = inspect_runtime_attachment_copy(storage_path)?;
        if inspected.byte_size != expected_size
            || inspected.content_digest != expected_digest
            || (media_type == DIRECTORY_MEDIA_TYPE) != (inspected.kind == "directory")
        {
            anyhow::bail!("Authority Attachment does not match its persisted Runtime receipt");
        }
        Ok(inspected)
    }

    pub fn remove_camp(&self, camp_id: &str) -> Result<()> {
        let camp_id = CampId::parse(camp_id)?;
        let gate = self.authority_ingress_gate(camp_id.as_str())?;
        let _admission = lock_unpoisoned(&gate);
        let root = self.root.join(camp_id.as_str());
        if !root.exists() {
            return Ok(());
        }
        let metadata = fs::symlink_metadata(&root)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            anyhow::bail!("Camp Attachment Directory is unsafe");
        }
        make_owned_tree_removable(&root)?;
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

pub(crate) fn copy_agent_sources_to_managed_staging(
    requested_paths: &[String],
    attachment_ids: &[String],
    execution_workspace: &Path,
    run_tmp: &Path,
    staging_root: &Path,
) -> Result<Vec<StagedAgentAttachment>> {
    if requested_paths.len() != attachment_ids.len() {
        anyhow::bail!("Managed Attachment plan does not match requested Agent files");
    }
    if requested_paths.len() > MAX_PREPARED_ATTACHMENTS {
        anyhow::bail!("At most 10 files may be attached to one message");
    }
    let workspace_root = fs::canonicalize(execution_workspace)
        .context("AgentRun execution workspace is unavailable")?;
    let run_tmp_root = fs::canonicalize(run_tmp).context("ROVAI_RUN_TMP is unavailable")?;
    ensure_directory(staging_root)?;
    let copied = (|| -> Result<Vec<StagedAgentAttachment>> {
        let mut staged = Vec::with_capacity(requested_paths.len());
        let mut total_bytes = 0_u64;
        for (requested, attachment_id) in requested_paths.iter().zip(attachment_ids) {
            validate_component(attachment_id, "Managed Attachment")?;
            let requested = Path::new(requested);
            let source = if requested.is_absolute() {
                requested.to_path_buf()
            } else {
                workspace_root.join(requested)
            };
            if source.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            }) {
                anyhow::bail!("Attachment source contains an unsafe path component");
            }
            let canonical_source = fs::canonicalize(&source)
                .with_context(|| format!("Attachment source is unavailable: {requested:?}"))?;
            let (admitted_root, checked_source) = if canonical_source.starts_with(&workspace_root) {
                let relative = if requested.is_absolute() {
                    source
                        .strip_prefix(execution_workspace)
                        .or_else(|_| source.strip_prefix(&workspace_root))
                        .context("Attachment source uses an unsafe workspace root alias")?
                } else {
                    requested
                };
                (&workspace_root, workspace_root.join(relative))
            } else if canonical_source.starts_with(&run_tmp_root) {
                let relative = source
                    .strip_prefix(run_tmp)
                    .or_else(|_| source.strip_prefix(&run_tmp_root))
                    .context("Attachment source uses an unsafe ROVAI_RUN_TMP root alias")?;
                (&run_tmp_root, run_tmp_root.join(relative))
            } else {
                anyhow::bail!(
                    "Attachment source is outside the AgentRun workspace and ROVAI_RUN_TMP"
                );
            };
            reject_symlink_path(admitted_root, &checked_source)?;
            let source_name = canonical_source
                .file_name()
                .and_then(|name| name.to_str())
                .context("Attachment source has no UTF-8 display name")?;
            let display_name = normalize_display_name(source_name)?;
            let attachment_root = staging_root.join(attachment_id);
            let payload_root = attachment_root.join("payload");
            ensure_directory(&payload_root)?;
            let destination = payload_root.join(&display_name);
            let prepared = copy_and_inspect(&canonical_source, &destination)?;
            total_bytes = total_bytes
                .checked_add(prepared.byte_size)
                .context("Agent attachment byte total overflow")?;
            if total_bytes > MAX_DRAFT_ATTACHMENT_BYTES {
                anyhow::bail!("Attachments exceed the 64 MiB aggregate limit");
            }
            set_directory_read_only(&payload_root)?;
            set_directory_read_only(&attachment_root)?;
            staged.push(StagedAgentAttachment {
                attachment: crate::camp_attachment_publication::AuthorityAttachment {
                    attachment_id: attachment_id.clone(),
                    display_name: display_name.clone(),
                    media_type: prepared.media_type,
                    byte_size: prepared.byte_size,
                    content_digest: prepared.content_digest.clone(),
                    storage_path: prepared.path,
                    preview_kind: prepared.preview_kind,
                },
                receipt: RuntimeAttachmentCopyReceipt {
                    authority_safe_leaf: display_name,
                    kind: prepared.kind,
                    file_count: prepared.file_count,
                    directory_count: prepared.directory_count,
                    node_count: prepared.node_count,
                    byte_size: prepared.byte_size,
                    content_digest: prepared.content_digest,
                },
            });
        }
        Ok(staged)
    })();
    match copied {
        Ok(staged) => Ok(staged),
        Err(error) => {
            let _ = remove_attachment_directory(staging_root);
            Err(error)
        }
    }
}

pub(crate) fn harden_managed_attachment_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Managed Attachment contains a symlink");
    }
    if metadata.is_dir() {
        for child in fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()? {
            harden_managed_attachment_tree(&child.path())?;
        }
        return set_directory_read_only(path);
    }
    if metadata.is_file() {
        return set_read_only(path);
    }
    anyhow::bail!("Managed Attachment contains an unsupported node")
}

pub(crate) fn remove_managed_attachment_tree(path: &Path) -> Result<()> {
    remove_attachment_directory(path)
}

pub(crate) fn cleanup_consumed_prepared_attachment_paths(
    store: &CampAttachmentStore,
    camp_id: &str,
    paths: &[PathBuf],
) -> Result<()> {
    store.cleanup_detached_attachments(CampAttachmentCleanupPlan {
        camp_id: camp_id.to_string(),
        attachment_paths: paths.to_vec(),
    })
}

#[derive(Debug, Clone)]
struct DraftMutationState {
    document: ComposerDocument,
    structured_content: StructuredCampMessageContent,
    revision: i64,
    reply_to_camp_message_id: Option<String>,
    recipient_selection_required: bool,
    continuation_source_message_id: Option<String>,
    continuation_suppressed_source_message_id: Option<String>,
    recipient_selection_touched: bool,
}

struct ReplyMutation<'a> {
    content: ComposerDocument,
    reply_to_camp_message_id: Option<&'a str>,
    recipient_selection_required: bool,
    recipient_selection_touched: bool,
}

struct ContinuationMutation<'a> {
    content: ComposerDocument,
    continuation_source_message_id: Option<&'a str>,
    continuation_suppressed_source_message_id: Option<&'a str>,
    recipient_selection_touched: bool,
}

fn load_draft_mutation_state(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<DraftMutationState>> {
    let stored = connection
        .query_row(
            r#"
            SELECT structured_content_json, revision,
                   reply_to_camp_message_id, recipient_selection_required,
                   continuation_source_message_id,
                   continuation_suppressed_source_message_id,
                   recipient_selection_touched
            FROM camp_composer_draft
            WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()?;
    stored
        .map(
            |(
                content,
                revision,
                reply_to_camp_message_id,
                required,
                continuation_source_message_id,
                continuation_suppressed_source_message_id,
                recipient_selection_touched,
            )| {
                let document = parse_composer_document_json(&content)?;
                let structured_content = composer_document_to_content(&document)?;
                Ok(DraftMutationState {
                    document,
                    structured_content,
                    revision,
                    reply_to_camp_message_id,
                    recipient_selection_required: required,
                    continuation_source_message_id,
                    continuation_suppressed_source_message_id,
                    recipient_selection_touched,
                })
            },
        )
        .transpose()
}

fn require_expected_revision(
    current: Option<&DraftMutationState>,
    expected_revision: i64,
) -> Result<()> {
    if current.map_or(0, |draft| draft.revision) != expected_revision {
        anyhow::bail!("draft_changed");
    }
    Ok(())
}

fn persist_reply_mutation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    expected_revision: i64,
    current: Option<&DraftMutationState>,
    mutation: ReplyMutation<'_>,
) -> Result<bool> {
    let ReplyMutation {
        content,
        reply_to_camp_message_id,
        recipient_selection_required,
        recipient_selection_touched,
    } = mutation;
    let content = normalize_composer_document(content);
    validate_composer_document(&content)?;
    if current.is_some_and(|draft| {
        draft.document == content
            && draft.reply_to_camp_message_id.as_deref() == reply_to_camp_message_id
            && draft.recipient_selection_required == recipient_selection_required
            && draft.recipient_selection_touched == recipient_selection_touched
    }) {
        return Ok(false);
    }
    let content_json = serialize_composer_document(&content)?;
    let body = render_composer_document_for_connection(transaction, &content)?;
    let (now, expires_at) = draft_times();
    if expected_revision == 0 {
        transaction.execute(
            r#"
            INSERT INTO camp_composer_draft(
                camp_id, body, structured_content_json, revision,
                reply_to_camp_message_id, recipient_selection_required,
                recipient_selection_touched,
                created_at, updated_at, expires_at
            ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7, ?8)
            "#,
            params![
                camp_id,
                body,
                content_json,
                reply_to_camp_message_id,
                recipient_selection_required,
                recipient_selection_touched,
                now,
                expires_at,
            ],
        )?;
    } else {
        let updated = transaction.execute(
            r#"
            UPDATE camp_composer_draft
            SET body = ?3,
                structured_content_json = ?4,
                reply_to_camp_message_id = ?5,
                recipient_selection_required = ?6,
                recipient_selection_touched = ?7,
                revision = revision + 1,
                updated_at = ?8,
                expires_at = ?9
            WHERE camp_id = ?1 AND revision = ?2
            "#,
            params![
                camp_id,
                expected_revision,
                body,
                content_json,
                reply_to_camp_message_id,
                recipient_selection_required,
                recipient_selection_touched,
                now,
                expires_at,
            ],
        )?;
        if updated != 1 {
            anyhow::bail!("draft_changed");
        }
    }
    Ok(true)
}

fn persist_continuation_mutation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    expected_revision: i64,
    current: Option<&DraftMutationState>,
    mutation: ContinuationMutation<'_>,
) -> Result<bool> {
    let ContinuationMutation {
        content,
        continuation_source_message_id,
        continuation_suppressed_source_message_id,
        recipient_selection_touched,
    } = mutation;
    let content = normalize_composer_document(content);
    validate_composer_document(&content)?;
    if current.is_some_and(|draft| {
        draft.document == content
            && draft.continuation_source_message_id.as_deref() == continuation_source_message_id
            && draft.continuation_suppressed_source_message_id.as_deref()
                == continuation_suppressed_source_message_id
            && draft.recipient_selection_touched == recipient_selection_touched
    }) {
        return Ok(false);
    }
    let content_json = serialize_composer_document(&content)?;
    let body = render_composer_document_for_connection(transaction, &content)?;
    let (now, expires_at) = draft_times();
    if expected_revision == 0 {
        transaction.execute(
            r#"
            INSERT INTO camp_composer_draft(
                camp_id, body, structured_content_json, revision,
                continuation_source_message_id,
                continuation_suppressed_source_message_id,
                recipient_selection_touched,
                created_at, updated_at, expires_at
            ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7, ?8)
            "#,
            params![
                camp_id,
                body,
                content_json,
                continuation_source_message_id,
                continuation_suppressed_source_message_id,
                recipient_selection_touched,
                now,
                expires_at,
            ],
        )?;
    } else {
        let updated = transaction.execute(
            r#"
            UPDATE camp_composer_draft
            SET body = ?3,
                structured_content_json = ?4,
                continuation_source_message_id = ?5,
                continuation_suppressed_source_message_id = ?6,
                recipient_selection_touched = ?7,
                revision = revision + 1,
                updated_at = ?8,
                expires_at = ?9
            WHERE camp_id = ?1 AND revision = ?2
            "#,
            params![
                camp_id,
                expected_revision,
                body,
                content_json,
                continuation_source_message_id,
                continuation_suppressed_source_message_id,
                recipient_selection_touched,
                now,
                expires_at,
            ],
        )?;
        if updated != 1 {
            anyhow::bail!("draft_changed");
        }
    }
    Ok(true)
}

#[derive(Debug, Clone)]
struct ContinuationCandidate {
    source_message_id: String,
    agent_id: String,
    display_name: String,
    available: bool,
}

struct ContinuationProjectionInput<'a> {
    stored_source_message_id: Option<&'a str>,
    suppressed_source_message_id: Option<&'a str>,
    recipient_selection_touched: bool,
    content: &'a [StructuredCampMessageSegment],
    reply_to_camp_message_id: Option<&'a str>,
    has_attachments: bool,
}

fn recipient_signature(content: &[StructuredCampMessageSegment]) -> (bool, Vec<String>) {
    (
        has_all_members_mention(content),
        member_mention_ids(content),
    )
}

fn has_explicit_recipient(content: &[StructuredCampMessageSegment]) -> bool {
    has_all_members_mention(content) || !member_mention_ids(content).is_empty()
}

fn latest_continuation_candidate(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<ContinuationCandidate>> {
    let latest_user_message_id = connection
        .query_row(
            r#"
            SELECT id
            FROM camp_message
            WHERE camp_id = ?1
              AND author_type = 'user'
              AND tombstoned_at IS NULL
            ORDER BY sequence DESC
            LIMIT 1
            "#,
            [camp_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(message_id) = latest_user_message_id else {
        return Ok(None);
    };
    continuation_candidate_from_message(connection, camp_id, &message_id, true)
}

fn continuation_candidate_for_state(
    connection: &Connection,
    camp_id: &str,
    stored_source_message_id: Option<&str>,
) -> Result<Option<ContinuationCandidate>> {
    match stored_source_message_id {
        Some(source_message_id) => {
            continuation_candidate_from_message(connection, camp_id, source_message_id, false)
        }
        None => latest_continuation_candidate(connection, camp_id),
    }
}

fn continuation_candidate_from_message(
    connection: &Connection,
    camp_id: &str,
    source_message_id: &str,
    require_current_non_lead: bool,
) -> Result<Option<ContinuationCandidate>> {
    let message = connection
        .query_row(
            r#"
            SELECT address_mode, addressed_agent_ids_json
            FROM camp_message
            WHERE id = ?1 AND camp_id = ?2
              AND author_type = 'user'
              AND tombstoned_at IS NULL
            "#,
            params![source_message_id, camp_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((address_mode, addressed_agent_ids_json)) = message else {
        return Ok(None);
    };
    if address_mode != "explicit" {
        return Ok(None);
    }
    let agent_ids: Vec<String> = serde_json::from_str(&addressed_agent_ids_json)?;
    if agent_ids.len() != 1 {
        return Ok(None);
    }
    let agent_id = agent_ids
        .into_iter()
        .next()
        .expect("one continuation recipient");
    if require_current_non_lead {
        let default_lead_agent_id = connection.query_row(
            "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
            [camp_id],
            |row| row.get::<_, Option<String>>(0),
        )?;
        if default_lead_agent_id.as_deref() == Some(agent_id.as_str()) {
            return Ok(None);
        }
    }
    let display_name = connection
        .query_row(
            "SELECT display_name FROM agent_profile WHERE id = ?1",
            [&agent_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| agent_id.clone());
    Ok(Some(ContinuationCandidate {
        source_message_id: source_message_id.to_string(),
        available: active_reply_agent(connection, camp_id, &agent_id)?,
        agent_id,
        display_name,
    }))
}

fn project_continuation_intent(
    connection: &Connection,
    camp_id: &str,
    input: ContinuationProjectionInput<'_>,
) -> Result<Option<CampComposerContinuationIntentView>> {
    let ContinuationProjectionInput {
        stored_source_message_id,
        suppressed_source_message_id,
        recipient_selection_touched,
        content,
        reply_to_camp_message_id,
        has_attachments,
    } = input;
    if recipient_selection_touched {
        return Ok(None);
    }
    let has_payload = !render_current_plain_text(connection, content)?
        .trim()
        .is_empty()
        || has_attachments;
    if stored_source_message_id.is_none() && has_payload {
        return Ok(None);
    }
    let Some(candidate) =
        continuation_candidate_for_state(connection, camp_id, stored_source_message_id)?
    else {
        return Ok(None);
    };
    if suppressed_source_message_id == Some(candidate.source_message_id.as_str())
        || (stored_source_message_id.is_none() && !candidate.available)
    {
        return Ok(None);
    }
    let recipient_selection_required = stored_source_message_id.is_some()
        && !candidate.available
        && reply_to_camp_message_id.is_none()
        && !has_explicit_recipient(content)
        && has_payload;
    Ok(Some(CampComposerContinuationIntentView {
        source_camp_message_id: candidate.source_message_id,
        recipient: CampComposerContinuationRecipientView {
            agent_id: candidate.agent_id,
            display_name: candidate.display_name,
            recipient_availability: if candidate.available {
                "available".to_string()
            } else {
                "unavailable".to_string()
            },
        },
        recipient_selection_required,
    }))
}

fn ensure_leading_composer_recipient(document: &mut ComposerDocument, recipient: ComposerAtom) {
    let covered = document
        .segments
        .iter()
        .any(|segment| match (&recipient, segment) {
            (
                ComposerAtom::Member {
                    agent_id: requested,
                    ..
                },
                ComposerSegment::Atom {
                    atom:
                        ComposerAtom::Member {
                            agent_id: existing, ..
                        },
                },
            ) => requested == existing,
            (
                ComposerAtom::Member { .. },
                ComposerSegment::Atom {
                    atom: ComposerAtom::AllMembers,
                },
            )
            | (
                ComposerAtom::AllMembers,
                ComposerSegment::Atom {
                    atom: ComposerAtom::AllMembers,
                },
            ) => true,
            _ => false,
        });
    if covered {
        return;
    }
    let has_leading_whitespace = matches!(
        document.segments.first(),
        Some(ComposerSegment::Text { text })
            if text.chars().next().is_some_and(char::is_whitespace)
    );
    document
        .segments
        .insert(0, ComposerSegment::Atom { atom: recipient });
    if !has_leading_whitespace {
        document.segments.insert(
            1,
            ComposerSegment::Text {
                text: " ".to_string(),
            },
        );
    }
    *document = normalize_composer_document(std::mem::take(document));
}

fn active_reply_agent(connection: &Connection, camp_id: &str, agent_id: &str) -> Result<bool> {
    connection
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.agent_id = ?2
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
            )
            "#,
            params![camp_id, agent_id],
            |row| row.get(0),
        )
        .context("failed to resolve reply author availability")
}

pub(crate) fn project_reply_intent(
    database: &Database,
    camp_id: &str,
    reply_to_camp_message_id: Option<&str>,
    recipient_selection_required: bool,
) -> Result<Option<CampComposerReplyIntentView>> {
    let Some(reply_to_camp_message_id) = reply_to_camp_message_id else {
        return Ok(None);
    };
    let target = database
        .connection()
        .query_row(
            r#"
            SELECT author_type, author_id, body
            FROM camp_message
            WHERE id = ?1 AND camp_id = ?2 AND tombstoned_at IS NULL
            "#,
            params![reply_to_camp_message_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((author_type, author_id, body)) = target else {
        return Ok(Some(CampComposerReplyIntentView {
            reply_to_camp_message_id: reply_to_camp_message_id.to_string(),
            target_state: "message_unavailable".to_string(),
            author: None,
            excerpt: None,
            recipient_selection_required,
        }));
    };
    let (display_name, recipient_availability) = match author_type.as_str() {
        "agent" => {
            let display_name = database
                .connection()
                .query_row(
                    "SELECT display_name FROM agent_profile WHERE id = ?1",
                    [&author_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .unwrap_or_else(|| author_id.clone());
            let availability = if active_reply_agent(database.connection(), camp_id, &author_id)? {
                "available"
            } else {
                "unavailable"
            };
            (display_name, availability.to_string())
        }
        "user" => {
            let display_name = if author_id == CURRENT_USER_ID {
                CurrentUserResolver::resolve("zh-CN")
                    .display_name
                    .to_string()
            } else {
                author_id.clone()
            };
            (display_name, "not_applicable".to_string())
        }
        "system" => ("系统".to_string(), "not_applicable".to_string()),
        _ => (author_id.clone(), "not_applicable".to_string()),
    };
    let excerpt = body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect();
    Ok(Some(CampComposerReplyIntentView {
        reply_to_camp_message_id: reply_to_camp_message_id.to_string(),
        target_state: "available".to_string(),
        author: Some(CampComposerReplyAuthorView {
            author_type,
            author_id,
            display_name,
            recipient_availability,
        }),
        excerpt: Some(excerpt),
        recipient_selection_required,
    }))
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
                ?8, ?9, ?10, 'user', ?11, ?12
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
                CURRENT_USER_ID,
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

pub fn consume_prepared_attachments_for_managed_ingest(
    transaction: &Transaction<'_>,
    camp_id: &str,
    prepared_attachment_ids: &[String],
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
    transaction.execute(
        "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
        [camp_id],
    )?;
    Ok(())
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

fn desktop_attachment_open_risk(
    path: &Path,
    display_name: &str,
    media_type: &str,
    kind: &str,
) -> Result<DesktopAttachmentOpenRisk> {
    let extension = Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "app"
            | "pkg"
            | "dmg"
            | "exe"
            | "msi"
            | "msp"
            | "com"
            | "scr"
            | "cpl"
            | "bat"
            | "cmd"
            | "ps1"
            | "psm1"
            | "vbs"
            | "vbe"
            | "js"
            | "jse"
            | "wsf"
            | "wsh"
            | "hta"
            | "reg"
            | "lnk"
            | "url"
            | "webloc"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "command"
            | "py"
            | "pyw"
            | "rb"
            | "pl"
            | "jar"
            | "desktop"
    ) || matches!(
        media_type,
        "application/x-executable"
            | "application/x-mach-binary"
            | "application/x-msdownload"
            | "application/x-sh"
            | "application/x-shellscript"
            | "application/vnd.microsoft.portable-executable"
            | "application/vnd.apple.installer+xml"
    ) {
        return Ok(DesktopAttachmentOpenRisk::Confirm);
    }
    if kind != "file" {
        return Ok(DesktopAttachmentOpenRisk::Normal);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::symlink_metadata(path)?.permissions().mode() & 0o111 != 0 {
            return Ok(DesktopAttachmentOpenRisk::Confirm);
        }
    }
    let mut source = open_source_without_following(path)?;
    let mut prefix = [0_u8; 4 * 1024];
    let read = source.read(&mut prefix)?;
    let prefix = &prefix[..read];
    let executable_magic = prefix.starts_with(b"#!")
        || prefix.starts_with(b"MZ")
        || prefix.starts_with(b"\x7fELF")
        || matches!(
            prefix.get(..4),
            Some(
                b"\xfe\xed\xfa\xce"
                    | b"\xce\xfa\xed\xfe"
                    | b"\xfe\xed\xfa\xcf"
                    | b"\xcf\xfa\xed\xfe"
                    | b"\xca\xfe\xba\xbe"
                    | b"\xbe\xba\xfe\xca"
                    | b"\xca\xfe\xba\xbf"
                    | b"\xbf\xba\xfe\xca"
            )
        );
    Ok(if executable_magic {
        DesktopAttachmentOpenRisk::Confirm
    } else {
        DesktopAttachmentOpenRisk::Normal
    })
}

fn load_prepared_attachments(
    database: &Database,
    camp_id: &str,
) -> Result<Vec<LocalAttachmentSourceView>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, display_name, media_type, byte_size, preview_kind,
               state, last_error_code, storage_path
        FROM prepared_attachment
        WHERE camp_id = ?1
        ORDER BY ordinal, id
        "#,
    )?;
    let rows = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                display_name,
                media_type,
                byte_size,
                preview_kind,
                state,
                last_error_code,
                storage_path,
            )| {
                let summary = managed_attachment_summary(Path::new(&storage_path), &media_type)?;
                Ok(LocalAttachmentSourceView {
                    id,
                    display_name,
                    kind: summary.kind,
                    file_count: Some(summary.file_count),
                    media_type: Some(media_type),
                    byte_size: Some(byte_size.max(0) as u64),
                    preview_kind,
                    availability: if state == "ready" && last_error_code.is_none() {
                        LocalAttachmentAvailability::Available
                    } else {
                        LocalAttachmentAvailability::Unreadable
                    },
                })
            },
        )
        .collect()
}

fn render_composer_document_for_connection(
    connection: &Connection,
    document: &ComposerDocument,
) -> Result<String> {
    render_composer_plain_text(document, |agent_id| {
        connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [agent_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    })
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

fn ensure_camp_exists(database: &Database, camp_id: &str) -> Result<()> {
    database
        .connection()
        .query_row("SELECT 1 FROM camp WHERE id = ?1", [camp_id], |_| Ok(()))
        .optional()?
        .context("Camp does not exist")?;
    Ok(())
}

pub(crate) fn managed_attachment_summary(
    storage_path: &Path,
    media_type: &str,
) -> Result<ManagedAttachmentSummary> {
    if media_type != DIRECTORY_MEDIA_TYPE {
        return Ok(ManagedAttachmentSummary {
            kind: "file".to_string(),
            file_count: 1,
        });
    }
    let metadata = read_attachment_metadata(storage_path)?;
    if metadata.schema_version != ATTACHMENT_METADATA_SCHEMA_VERSION
        || metadata.kind != "directory"
        || metadata.file_count > MAX_DIRECTORY_FILES
    {
        anyhow::bail!("Attachment directory metadata is invalid");
    }
    Ok(ManagedAttachmentSummary {
        kind: metadata.kind,
        file_count: metadata.file_count,
    })
}

fn write_attachment_metadata(
    attachment_directory: &Path,
    prepared: &PreparedAttachment,
) -> Result<()> {
    let metadata = ManagedAttachmentMetadata {
        schema_version: ATTACHMENT_METADATA_SCHEMA_VERSION,
        kind: prepared.kind.clone(),
        file_count: prepared.file_count,
        byte_size: prepared.byte_size,
        content_digest: prepared.content_digest.clone(),
    };
    let destination = attachment_directory.join(ATTACHMENT_METADATA_FILE);
    let temporary = attachment_directory.join(format!(".{}.metadata.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(&metadata)?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&temporary)?;
    let write_result = (|| -> Result<()> {
        output.write_all(&bytes)?;
        output.sync_all()?;
        set_read_only(&temporary)?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    commit_temporary(&temporary, &destination)?;
    sync_parent(&destination)?;
    Ok(())
}

fn read_attachment_metadata(storage_path: &Path) -> Result<ManagedAttachmentMetadata> {
    let attachment_directory = storage_path
        .parent()
        .context("Attachment path has no owning directory")?;
    let metadata_path = attachment_directory.join(ATTACHMENT_METADATA_FILE);
    let file_metadata =
        fs::symlink_metadata(&metadata_path).context("Attachment metadata is unavailable")?;
    if file_metadata.file_type().is_symlink()
        || !file_metadata.is_file()
        || file_metadata.len() > 4 * 1024
    {
        anyhow::bail!("Attachment metadata is unsafe");
    }
    let bytes = fs::read(&metadata_path)?;
    serde_json::from_slice(&bytes).context("Attachment metadata is invalid")
}

fn validate_owned_attachment(
    root: &Path,
    path: &Path,
    media_type: &str,
    expected_size: u64,
    expected_digest: &str,
) -> Result<()> {
    validate_owned_path(root, path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !expected_digest.starts_with("sha256:") {
        anyhow::bail!("Prepared Attachment is unavailable");
    }
    if media_type == DIRECTORY_MEDIA_TYPE {
        if !metadata.is_dir() {
            anyhow::bail!("Prepared Attachment directory is unavailable");
        }
        let managed = read_attachment_metadata(path)?;
        if managed.schema_version != ATTACHMENT_METADATA_SCHEMA_VERSION
            || managed.kind != "directory"
            || managed.byte_size != expected_size
            || managed.content_digest != expected_digest
        {
            anyhow::bail!("Prepared Attachment directory metadata does not match");
        }
        validate_managed_directory_tree(path, &managed)?;
    } else if !metadata.is_file() || metadata.len() != expected_size {
        anyhow::bail!("Prepared Attachment is unavailable");
    }
    Ok(())
}

fn validate_managed_directory_tree(
    path: &Path,
    expected: &ManagedAttachmentMetadata,
) -> Result<()> {
    let mut files = 0_u64;
    let mut entries = 0_u64;
    let mut bytes = 0_u64;
    validate_managed_directory_node(path, 0, &mut files, &mut entries, &mut bytes)?;
    if files != expected.file_count || bytes != expected.byte_size {
        anyhow::bail!("Prepared Attachment directory changed after snapshotting");
    }
    Ok(())
}

fn validate_managed_directory_node(
    path: &Path,
    depth: usize,
    files: &mut u64,
    entries: &mut u64,
    bytes: &mut u64,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        anyhow::bail!("Prepared Attachment directory exceeds the depth limit");
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Prepared Attachment directory is unsafe");
    }
    let mut children = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        *entries = entries
            .checked_add(1)
            .context("Prepared Attachment directory entry count overflow")?;
        if *entries > MAX_DIRECTORY_ENTRIES {
            anyhow::bail!("Prepared Attachment directory exceeds the entry limit");
        }
        let child_path = child.path();
        let child_metadata = fs::symlink_metadata(&child_path)?;
        if child_metadata.file_type().is_symlink() {
            anyhow::bail!("Prepared Attachment directory contains a symbolic link");
        }
        if child_metadata.is_dir() {
            validate_managed_directory_node(&child_path, depth + 1, files, entries, bytes)?;
        } else if child_metadata.is_file() {
            *files = files
                .checked_add(1)
                .context("Prepared Attachment directory file count overflow")?;
            *bytes = bytes
                .checked_add(child_metadata.len())
                .context("Prepared Attachment directory size overflow")?;
            if *files > MAX_DIRECTORY_FILES
                || child_metadata.len() > MAX_ATTACHMENT_BYTES
                || *bytes > MAX_DRAFT_ATTACHMENT_BYTES
            {
                anyhow::bail!("Prepared Attachment directory exceeds its limits");
            }
        } else {
            anyhow::bail!("Prepared Attachment directory contains an unsupported item");
        }
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

fn validate_managed_attachment_id(value: &str) -> Result<()> {
    let parsed = Uuid::parse_str(value).context("Attachment ID is invalid")?;
    if parsed.hyphenated().to_string() != value {
        anyhow::bail!("Attachment ID is not canonical");
    }
    Ok(())
}

fn validate_managed_runtime_locator(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        anyhow::bail!("Managed Attachment locator is unsafe");
    }
    Ok(path.to_path_buf())
}

fn draft_times() -> (String, String) {
    let now = Utc::now();
    (
        now.to_rfc3339(),
        (now + Duration::days(DRAFT_RETENTION_DAYS)).to_rfc3339(),
    )
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn restrict_discovery(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Known opaque child paths remain traversable, while the Camp directory
        // itself cannot be listed to discover attachments beyond a frozen input.
        fs::set_permissions(_path, fs::Permissions::from_mode(0o100))?;
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

#[cfg(any(test, feature = "slow-tests"))]
#[doc(hidden)]
pub fn insert_test_camp(database: &Database, camp_id: &str) {
    database
        .connection()
        .execute(
            r#"
        INSERT INTO camp(
            id, title, name_origin, collaboration_mode,
            project_binding_kind, project_path,
            last_message_sequence, version, created_at, updated_at
        ) VALUES (
            ?1, 'Draft test', 'user', 'peer',
            'quick_chat', '/quick-chat-draft-test',
            0, 1, '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
        )
        "#,
            [camp_id],
        )
        .unwrap();
}

#[cfg(test)]
mod agent_source_tests {
    use super::*;

    #[test]
    fn authority_ingress_gate_is_shared_per_camp_and_exclusive() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-authority-ingress-gate-test-{}",
            Uuid::new_v4()
        ));
        let first_store = CampAttachmentStore::new(&directory);
        let second_store = CampAttachmentStore::new(&directory);
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        let other_camp_id = "rvcamp_01m0evhykseprr56s0b940zrr3";

        let first = first_store.authority_ingress_gate(camp_id).unwrap();
        let same_camp = second_store.authority_ingress_gate(camp_id).unwrap();
        let other_camp = second_store.authority_ingress_gate(other_camp_id).unwrap();
        assert!(Arc::ptr_eq(&first, &same_camp));
        assert!(!Arc::ptr_eq(&first, &other_camp));

        let first_admission = lock_unpoisoned(&first);
        assert!(same_camp.try_lock().is_err());
        let other_admission = other_camp.try_lock().unwrap();
        drop(other_admission);
        drop(first_admission);
        assert!(same_camp.try_lock().is_ok());
    }

    #[test]
    fn agent_sources_are_frozen_only_from_the_exact_run_workspace_or_tmp() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-agent-attachment-source-test-{}",
            Uuid::new_v4()
        ));
        let workspace = directory.join("workspace");
        let run_tmp = directory.join("run-tmp");
        let outside = directory.join("outside");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&run_tmp).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(workspace.join("workspace.txt"), b"workspace source").unwrap();
        fs::write(run_tmp.join("generated.txt"), b"run tmp source").unwrap();
        fs::write(outside.join("secret.txt"), b"outside source").unwrap();

        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        let store = CampAttachmentStore::new(&directory);
        let frozen = store
            .freeze_agent_sources(
                camp_id,
                &[
                    "workspace.txt".to_string(),
                    run_tmp.join("generated.txt").to_string_lossy().into_owned(),
                ],
                &workspace,
                &run_tmp,
            )
            .unwrap();
        assert_eq!(frozen.len(), 2);
        assert_eq!(
            fs::read(&frozen[0].storage_path).unwrap(),
            b"workspace source"
        );
        assert_eq!(
            fs::read(&frozen[1].storage_path).unwrap(),
            b"run tmp source"
        );
        fs::write(workspace.join("workspace.txt"), b"changed later").unwrap();
        assert_eq!(
            fs::read(&frozen[0].storage_path).unwrap(),
            b"workspace source"
        );

        assert!(
            store
                .freeze_agent_sources(
                    camp_id,
                    &["../outside/secret.txt".to_string()],
                    &workspace,
                    &run_tmp,
                )
                .is_err()
        );
        assert!(
            store
                .freeze_agent_sources(
                    camp_id,
                    &[outside.join("secret.txt").to_string_lossy().into_owned()],
                    &workspace,
                    &run_tmp,
                )
                .is_err()
        );

        #[cfg(unix)]
        {
            let linked_secret = workspace.join("linked-secret.txt");
            std::os::unix::fs::symlink(outside.join("secret.txt"), &linked_secret).unwrap();
            assert!(
                store
                    .freeze_agent_sources(
                        camp_id,
                        &["linked-secret.txt".to_string()],
                        &workspace,
                        &run_tmp,
                    )
                    .is_err()
            );
            fs::remove_file(linked_secret).unwrap();
        }

        store.cleanup_unowned_agent_sources(camp_id, &frozen);
        make_owned_tree_removable(&directory).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn desktop_open_risk_classifies_installers_scripts_and_executable_magic() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-attachment-open-risk-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&fixture).unwrap();
        let normal = fixture.join("notes.txt");
        let installer = fixture.join("setup.pkg");
        let script = fixture.join("generated-output");
        let executable = fixture.join("binary");
        let app = fixture.join("Review.app");
        fs::write(&normal, b"review notes").unwrap();
        fs::write(&installer, b"package bytes").unwrap();
        fs::write(&script, b"#!/bin/sh\nprintf ok\n").unwrap();
        fs::write(&executable, b"\x7fELFfixture").unwrap();
        fs::create_dir(&app).unwrap();

        for (path, name, kind, expected) in [
            (
                &normal,
                "notes.txt",
                "file",
                DesktopAttachmentOpenRisk::Normal,
            ),
            (
                &installer,
                "setup.pkg",
                "file",
                DesktopAttachmentOpenRisk::Confirm,
            ),
            (
                &script,
                "generated-output",
                "file",
                DesktopAttachmentOpenRisk::Confirm,
            ),
            (
                &executable,
                "binary",
                "file",
                DesktopAttachmentOpenRisk::Confirm,
            ),
            (
                &app,
                "Review.app",
                "directory",
                DesktopAttachmentOpenRisk::Confirm,
            ),
        ] {
            assert_eq!(
                desktop_attachment_open_risk(path, name, "application/octet-stream", kind).unwrap(),
                expected,
                "unexpected risk for {name}"
            );
        }

        fs::remove_dir_all(fixture).unwrap();
    }
}

#[cfg(all(test, windows))]
mod windows_attachment_tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn windows_attachment_directory_snapshot_is_deterministic() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-windows-attachment-snapshot-{}",
            Uuid::new_v4()
        ));
        let source = fixture.join("项目资料");
        fs::create_dir_all(source.join("docs/empty")).unwrap();
        fs::write(source.join("README.md"), b"directory snapshot").unwrap();
        fs::write(source.join("docs/plan.txt"), b"frozen plan").unwrap();
        fs::write(source.join(".env.example"), b"TOKEN=example").unwrap();

        let first = copy_and_inspect(&source, &fixture.join("snapshot-one")).unwrap();
        let second = copy_and_inspect(&source, &fixture.join("snapshot-two")).unwrap();
        assert_eq!(first.kind, "directory");
        assert_eq!(first.file_count, 3);
        assert_eq!(first.byte_size, second.byte_size);
        assert_eq!(first.content_digest, second.content_digest);
        assert_eq!(first.content_digest, DIRECTORY_SNAPSHOT_FIXTURE_DIGEST);
        assert_eq!(
            fs::read(first.path.join("docs/plan.txt")).unwrap(),
            b"frozen plan"
        );
        assert!(first.path.join("docs/empty").is_dir());

        let single =
            copy_and_inspect(&source.join("README.md"), &fixture.join("single.txt")).unwrap();
        assert_eq!(single.kind, "file");
        assert_eq!(fs::read(&single.path).unwrap(), b"directory snapshot");

        make_owned_tree_removable(&first.path).unwrap();
        make_owned_tree_removable(&second.path).unwrap();
        crate::local_attachment_snapshot::remove_local_snapshot_tree(&single.path).unwrap();
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn windows_attachment_directory_rejects_junctions_and_cleans_only_owned_tree() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-windows-attachment-reparse-{}",
            Uuid::new_v4()
        ));
        let source = fixture.join("source");
        let outside = fixture.join("outside");
        let junction = source.join("linked-outside");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), b"must not be copied").unwrap();

        let status = Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create the junction fixture");

        let destination = fixture.join("snapshot");
        let error = copy_and_inspect(&source, &destination).unwrap_err();
        assert_eq!(
            error.downcast_ref::<crate::local_attachment_snapshot::LocalAttachmentError>(),
            Some(&crate::local_attachment_snapshot::LocalAttachmentError::Unsupported)
        );
        let error = error.to_string();
        assert!(error.contains("reparse point"), "unexpected error: {error}");
        assert!(!destination.join("linked-outside/secret.txt").exists());

        copy_and_inspect(&outside.join("secret.txt"), &source.join("frozen.txt")).unwrap();
        crate::local_attachment_snapshot::remove_local_snapshot_tree(&source).unwrap();
        assert!(!source.exists());
        assert_eq!(
            fs::read(outside.join("secret.txt")).unwrap(),
            b"must not be copied"
        );
        if destination.exists() {
            make_owned_tree_removable(&destination).unwrap();
        }
        fs::remove_dir_all(fixture).unwrap();
    }
}

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;
    use crate::camp_content::StructuredCampMessageSegment as Segment;

    fn composer_document(content: StructuredCampMessageContent) -> ComposerDocument {
        crate::camp_content::composer_document_from_content(&content).unwrap()
    }

    fn structured_content(document: &ComposerDocument) -> StructuredCampMessageContent {
        composer_document_to_content(document).unwrap()
    }

    fn insert_test_member(database: &Database, camp_id: &str, agent_id: &str) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_member(
                    camp_id, agent_id, status, capability_overrides_json,
                    version, joined_at
                ) VALUES (?1, ?2, 'active', '{}', 1, '2026-08-14T00:00:00Z')
                "#,
                params![camp_id, agent_id],
            )
            .unwrap();
    }

    fn insert_test_message(
        database: &Database,
        camp_id: &str,
        message_id: &str,
        sequence: i64,
        author_type: &str,
        author_id: &str,
        body: &str,
    ) {
        let content = serde_json::to_string(&vec![Segment::Text {
            text: body.to_string(),
        }])
        .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    'sha256:test-reply-parent', 'default', '[]', 1,
                    '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'
                )
                "#,
                params![
                    message_id,
                    camp_id,
                    sequence,
                    author_type,
                    author_id,
                    body,
                    content,
                ],
            )
            .unwrap();
    }

    #[test]
    fn agent_freeze_aggregate_failure_cleans_every_operation_owned_directory() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-agent-freeze-aggregate-cleanup-{}",
            Uuid::new_v4()
        ));
        let data_directory = fixture.join("data");
        let workspace = fixture.join("workspace");
        let run_tmp = fixture.join("run-tmp");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&run_tmp).unwrap();
        for (name, bytes) in [
            ("first.bin", MAX_ATTACHMENT_BYTES),
            ("second.bin", MAX_ATTACHMENT_BYTES),
            ("overflow.bin", 15 * 1024 * 1024),
        ] {
            File::create(workspace.join(name))
                .unwrap()
                .set_len(bytes)
                .unwrap();
        }

        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        let store = CampAttachmentStore::new(&data_directory);
        let error = store
            .freeze_agent_sources(
                camp_id,
                &[
                    "first.bin".to_string(),
                    "second.bin".to_string(),
                    "overflow.bin".to_string(),
                ],
                &workspace,
                &run_tmp,
            )
            .unwrap_err();
        assert!(
            error.to_string().contains("aggregate limit"),
            "unexpected error: {error:#}"
        );

        let camp_root = data_directory.join("camp-attachments").join(camp_id);
        allow_directory_update(&camp_root).unwrap();
        assert!(
            fs::read_dir(&camp_root).unwrap().next().is_none(),
            "a failed multi-file freeze must not retain an unowned Authority child"
        );

        make_owned_tree_removable(&data_directory).unwrap();
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn desktop_open_target_is_published_camp_scoped_and_runtime_state_independent() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-desktop-attachment-open-test-{}",
            Uuid::new_v4()
        ));
        let data_directory = fixture.join("data");
        fs::create_dir_all(&fixture).unwrap();
        let source = fixture.join("preview.png");
        let mut png = vec![0_u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&640_u32.to_be_bytes());
        png[20..24].copy_from_slice(&480_u32.to_be_bytes());
        fs::write(&source, &png).unwrap();

        let mut database = Database::open(&data_directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        let other_camp_id = "rvcamp_01m0evhykseprr56s0b940zrr3";
        insert_test_camp(&database, camp_id);
        insert_test_camp(&database, other_camp_id);
        let store = CampAttachmentStore::new(&data_directory);
        let draft = store
            .prepare_from_path(&mut database, camp_id, 0, &source, "preview.png")
            .unwrap();
        let attachment_id = draft.attachments[0].id.clone();

        assert!(
            store
                .desktop_open_candidate(&database, camp_id, &attachment_id)
                .unwrap()
                .is_none(),
            "Prepared Attachments must not be Desktop open targets"
        );

        let message_id = "message-desktop-open";
        insert_test_message(
            &database,
            camp_id,
            message_id,
            1,
            "user",
            CURRENT_USER_ID,
            "图片",
        );
        let transaction = database.connection_mut().transaction().unwrap();
        consume_prepared_attachments(
            &transaction,
            camp_id,
            message_id,
            std::slice::from_ref(&attachment_id),
            "2026-08-20T00:00:00Z",
        )
        .unwrap();
        transaction.commit().unwrap();
        database
            .connection()
            .execute(
                "UPDATE message_attachment SET runtime_projection_state = 'failed' WHERE id = ?1",
                [&attachment_id],
            )
            .unwrap();

        assert!(
            store
                .desktop_open_candidate(&database, other_camp_id, &attachment_id)
                .unwrap()
                .is_none(),
            "an Attachment must not authorize a different Camp"
        );
        let candidate = store
            .desktop_open_candidate(&database, camp_id, &attachment_id)
            .unwrap()
            .unwrap();
        let authority_path = candidate.path.clone();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let attachment_directory = authority_path.parent().unwrap();
            let new_mode = fs::symlink_metadata(attachment_directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(
                new_mode, 0o500,
                "new managed containers must be Finder-enumerable without granting mutation"
            );
            fs::set_permissions(attachment_directory, fs::Permissions::from_mode(0o100)).unwrap();
        }
        let target = store
            .verify_desktop_open_candidate(candidate.clone())
            .unwrap();
        assert_eq!(target.attachment_id, attachment_id);
        assert_eq!(target.kind, "file");
        assert_eq!(target.open_risk, DesktopAttachmentOpenRisk::Normal);
        assert_eq!(target.path, authority_path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::symlink_metadata(authority_path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(
                mode, 0o500,
                "Desktop authorization must upgrade a legacy traversal-only container to a Finder-enumerable read-only directory"
            );
        }
        let preview_candidate = store
            .preview_candidate(&database, &attachment_id)
            .unwrap()
            .unwrap();
        store.verify_preview_candidate(preview_candidate).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&authority_path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(&authority_path).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(&authority_path, permissions).unwrap();
        }
        let mut changed = png.clone();
        changed[23] ^= 1;
        fs::write(&authority_path, changed).unwrap();
        assert!(
            store.verify_desktop_open_candidate(candidate).is_err(),
            "an Authority payload that no longer matches its digest must fail closed"
        );

        store.remove_camp(camp_id).unwrap();
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    fn insert_test_explicit_user_message(
        database: &Database,
        camp_id: &str,
        message_id: &str,
        sequence: i64,
        agent_ids: &[&str],
    ) {
        let content = agent_ids
            .iter()
            .map(|agent_id| Segment::MemberMention {
                agent_id: (*agent_id).to_string(),
            })
            .collect::<Vec<_>>();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, 'user', ?4, '显式消息', ?5,
                    'sha256:test-continuation-source', 'explicit', ?6, 1,
                    '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'
                )
                "#,
                params![
                    message_id,
                    camp_id,
                    sequence,
                    CURRENT_USER_ID,
                    serde_json::to_string(&content).unwrap(),
                    serde_json::to_string(
                        &agent_ids
                            .iter()
                            .map(|id| (*id).to_string())
                            .collect::<Vec<_>>()
                    )
                    .unwrap(),
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp SET last_message_sequence = ?2 WHERE id = ?1",
                params![camp_id, sequence],
            )
            .unwrap();
    }

    #[test]
    fn structured_draft_save_uses_exact_monotonic_revisions() {
        let directory =
            std::env::temp_dir().join(format!("rovai-draft-revision-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);

        let first_content = vec![Segment::Text {
            text: "让@普通文字 ".into(),
        }];
        let first = store
            .save_content(
                &mut database,
                camp_id,
                0,
                composer_document(first_content.clone()),
            )
            .unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(structured_content(&first.content), first_content);

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
                composer_document(vec![
                    Segment::Text { text: "让".into() },
                    Segment::MemberMention {
                        agent_id: "agent_2".into(),
                    },
                ]),
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
            .save_content(
                &mut database,
                camp_id,
                second.revision,
                ComposerDocument::default(),
            )
            .unwrap();
        assert_eq!(cleared.revision, 3);
        assert!(cleared.body.is_empty());
        assert!(cleared.content.segments.is_empty());
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
    fn reply_mutations_keep_reference_and_recipient_resolution_in_one_exact_draft() {
        let directory =
            std::env::temp_dir().join(format!("rovai-draft-reply-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_2");
        insert_test_member(&database, camp_id, "agent_3");
        insert_test_message(
            &database,
            camp_id,
            "reply-agent-message",
            1,
            "agent",
            "agent_2",
            "第一行\n第二行",
        );
        insert_test_message(
            &database,
            camp_id,
            "reply-user-message",
            2,
            "user",
            CURRENT_USER_ID,
            "用户消息",
        );
        let store = CampAttachmentStore::new(&directory);
        let saved = store
            .save_content(
                &mut database,
                camp_id,
                0,
                composer_document(vec![Segment::Text {
                    text: "继续处理".into(),
                }]),
            )
            .unwrap();

        let replying = store
            .start_reply(
                &mut database,
                camp_id,
                saved.revision,
                "reply-agent-message",
            )
            .unwrap();
        assert_eq!(replying.revision, saved.revision + 1);
        assert_eq!(
            structured_content(&replying.content),
            vec![
                Segment::MemberMention {
                    agent_id: "agent_2".into()
                },
                Segment::Text {
                    text: " 继续处理".into()
                }
            ]
        );
        let intent = replying.reply_intent.as_ref().unwrap();
        assert_eq!(intent.reply_to_camp_message_id, "reply-agent-message");
        assert_eq!(intent.target_state, "available");
        assert_eq!(intent.excerpt.as_deref(), Some("第一行 第二行"));
        assert_eq!(
            intent.author.as_ref().unwrap().recipient_availability,
            "available"
        );
        assert!(!intent.recipient_selection_required);

        let idempotent = store
            .start_reply(
                &mut database,
                camp_id,
                replying.revision,
                "reply-agent-message",
            )
            .unwrap();
        assert_eq!(idempotent.revision, replying.revision);

        let cancelled = store
            .cancel_reply(&mut database, camp_id, idempotent.revision)
            .unwrap();
        assert!(cancelled.reply_intent.is_none());
        let cancelled_content = structured_content(&cancelled.content);
        assert!(matches!(
            cancelled_content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_2"
        ));

        let user_reply = store
            .start_reply(
                &mut database,
                camp_id,
                cancelled.revision,
                "reply-user-message",
            )
            .unwrap();
        assert_eq!(
            user_reply
                .reply_intent
                .as_ref()
                .unwrap()
                .author
                .as_ref()
                .unwrap()
                .recipient_availability,
            "not_applicable"
        );
        assert_eq!(user_reply.content, cancelled.content);

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let unavailable = store
            .start_reply(
                &mut database,
                camp_id,
                user_reply.revision,
                "reply-agent-message",
            )
            .unwrap();
        assert!(
            unavailable
                .reply_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );
        assert_eq!(
            unavailable
                .reply_intent
                .as_ref()
                .unwrap()
                .author
                .as_ref()
                .unwrap()
                .recipient_availability,
            "unavailable"
        );

        let resolved = store
            .resolve_reply_recipient(
                &mut database,
                camp_id,
                unavailable.revision,
                CampComposerReplyRecipient::Member {
                    agent_id: "agent_3".into(),
                },
            )
            .unwrap();
        assert!(
            !resolved
                .reply_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );
        let resolved_content = structured_content(&resolved.content);
        assert!(resolved_content.iter().any(|segment| matches!(
            segment,
            Segment::MemberMention { agent_id } if agent_id == "agent_3"
        )));
        assert!(!resolved_content.iter().any(|segment| matches!(
            segment,
            Segment::MemberMention { agent_id } if agent_id == "agent_2"
        )));

        let conflict = store
            .cancel_reply(&mut database, camp_id, unavailable.revision)
            .unwrap_err();
        assert!(conflict.to_string().contains("draft_changed"));
        let invalid = store
            .start_reply(&mut database, camp_id, resolved.revision, "missing-message")
            .unwrap_err();
        assert!(invalid.to_string().contains("camp_message.invalid_reply"));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_reply_author_never_inserts_an_invalid_mention() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-unavailable-reply-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_2");
        insert_test_message(
            &database,
            camp_id,
            "away-agent-message",
            1,
            "agent",
            "agent_2",
            "已经离队的作者",
        );
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let store = CampAttachmentStore::new(&directory);
        let reply = store
            .start_reply(&mut database, camp_id, 0, "away-agent-message")
            .unwrap();
        assert!(reply.content.segments.is_empty());
        assert_eq!(reply.revision, 1);
        assert!(
            reply
                .reply_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );

        store.discard_draft(&mut database, camp_id).unwrap();
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .reply_intent
                .is_none()
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn continuation_candidate_uses_only_the_latest_successful_user_route() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-continuation-source-test-{}",
            Uuid::new_v4()
        ));
        let database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "continuation-source",
            1,
            &["agent_2"],
        );
        insert_test_message(
            &database,
            camp_id,
            "later-agent-message",
            2,
            "agent",
            "agent_1",
            "Agent 后续消息",
        );
        let store = CampAttachmentStore::new(&directory);
        let candidate = store.load_draft(&database, camp_id).unwrap();
        let intent = candidate.continuation_intent.unwrap();
        assert_eq!(intent.source_camp_message_id, "continuation-source");
        assert_eq!(intent.recipient.agent_id, "agent_2");

        insert_test_message(
            &database,
            camp_id,
            "latest-default-user-message",
            3,
            "user",
            CURRENT_USER_ID,
            "默认发送",
        );
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "latest-lead-user-message",
            4,
            &["agent_1"],
        );
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "latest-multi-user-message",
            5,
            &["agent_1", "agent_2"],
        );
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn continuation_dismissal_and_manual_recipient_changes_do_not_reappear() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-continuation-dismiss-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(&database, camp_id, "dismiss-source", 1, &["agent_2"]);
        let store = CampAttachmentStore::new(&directory);
        let draft = store.load_draft(&database, camp_id).unwrap();
        let dismissed = store
            .dismiss_continuation(&mut database, camp_id, draft.revision, "dismiss-source")
            .unwrap();
        assert!(dismissed.continuation_intent.is_none());
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );

        store.discard_draft(&mut database, camp_id).unwrap();
        let candidate = store.load_draft(&database, camp_id).unwrap();
        let addressed = store
            .save_content_with_continuation(
                &mut database,
                camp_id,
                candidate.revision,
                composer_document(vec![Segment::MemberMention {
                    agent_id: "agent_1".into(),
                }]),
                Some("dismiss-source"),
            )
            .unwrap();
        assert!(addressed.continuation_intent.is_none());
        let cleared = store
            .save_content(
                &mut database,
                camp_id,
                addressed.revision,
                composer_document(vec![Segment::Text {
                    text: "删除显式 Mention 后仍回到 Lead".into(),
                }]),
            )
            .unwrap();
        assert!(cleared.continuation_intent.is_none());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_continuation_keeps_payload_and_requires_explicit_repair() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-continuation-repair-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(&database, camp_id, "repair-source", 1, &["agent_2"]);
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .save_content_with_continuation(
                &mut database,
                camp_id,
                0,
                composer_document(vec![Segment::Text {
                    text: "保留这份草稿".into(),
                }]),
                Some("repair-source"),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let unavailable = store.load_draft(&database, camp_id).unwrap();
        assert_eq!(unavailable.content, draft.content);
        assert!(
            unavailable
                .continuation_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );
        let repaired = store
            .resolve_continuation_recipient(&mut database, camp_id, unavailable.revision, "agent_1")
            .unwrap();
        assert!(repaired.continuation_intent.is_none());
        let repaired_content = structured_content(&repaired.content);
        assert!(matches!(
            repaired_content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_1"
        ));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_continuation_treats_source_attachment_only_draft_as_payload() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-source-attachment-continuation-repair-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "source-attachment-repair-source",
            1,
            &["agent_2"],
        );
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .save_content_with_continuation(
                &mut database,
                camp_id,
                0,
                ComposerDocument::default(),
                Some("source-attachment-repair-source"),
            )
            .unwrap();
        let source_path = directory.join("source-only.txt");
        fs::write(&source_path, b"source attachment only").unwrap();
        let source_ref = crate::local_attachment_source::observe_source_attachment(
            &source_path,
            "source-only.txt",
            Some("text/plain"),
        )
        .unwrap();
        let attached = store
            .commit_source_attachment(&mut database, camp_id, draft.revision, source_ref)
            .unwrap();
        assert!(attached.content.segments.is_empty());
        assert_eq!(attached.attachments.len(), 1);

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let unavailable = store.load_draft(&database, camp_id).unwrap();
        assert!(
            unavailable
                .continuation_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );
        let repaired = store
            .resolve_continuation_recipient(&mut database, camp_id, unavailable.revision, "agent_1")
            .unwrap();
        assert!(repaired.continuation_intent.is_none());
        let repaired_content = structured_content(&repaired.content);
        assert!(matches!(
            repaired_content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_1"
        ));
        assert_eq!(repaired.attachments.len(), 1);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_blank_candidate_never_appears_after_the_draft_becomes_meaningful() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-continuation-blank-unavailable-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "blank-unavailable-source",
            1,
            &["agent_2"],
        );
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let store = CampAttachmentStore::new(&directory);
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );
        let draft = store
            .save_content(
                &mut database,
                camp_id,
                0,
                composer_document(vec![Segment::Text {
                    text: "默认交给 Lead".into(),
                }]),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'present' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        assert!(
            store
                .load_draft(&database, camp_id)
                .unwrap()
                .continuation_intent
                .is_none()
        );
        assert_eq!(draft.content.segments.len(), 1);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reply_temporarily_hides_continuation_but_cancel_keeps_its_mention_rules() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-draft-continuation-reply-priority-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        insert_test_member(&database, camp_id, "agent_1");
        insert_test_member(&database, camp_id, "agent_2");
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [camp_id],
            )
            .unwrap();
        insert_test_explicit_user_message(
            &database,
            camp_id,
            "reply-priority-source",
            1,
            &["agent_2"],
        );
        insert_test_message(
            &database,
            camp_id,
            "reply-priority-agent",
            2,
            "agent",
            "agent_2",
            "Agent 消息",
        );
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .save_content_with_continuation(
                &mut database,
                camp_id,
                0,
                composer_document(vec![Segment::Text {
                    text: "继续".into(),
                }]),
                Some("reply-priority-source"),
            )
            .unwrap();
        let replying_to_self = store
            .start_reply(
                &mut database,
                camp_id,
                draft.revision,
                "reply-priority-source",
            )
            .unwrap();
        assert!(replying_to_self.reply_intent.is_some());
        let restored = store
            .cancel_reply(&mut database, camp_id, replying_to_self.revision)
            .unwrap();
        assert!(restored.continuation_intent.is_some());
        assert!(!has_explicit_recipient(&structured_content(
            &restored.content
        )));

        let replying_to_agent = store
            .start_reply(
                &mut database,
                camp_id,
                restored.revision,
                "reply-priority-agent",
            )
            .unwrap();
        let cancelled = store
            .cancel_reply(&mut database, camp_id, replying_to_agent.revision)
            .unwrap();
        assert!(cancelled.continuation_intent.is_some());
        let cancelled_content = structured_content(&cancelled.content);
        assert!(matches!(
            cancelled_content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_2"
        ));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn structured_draft_rejects_invalid_atom_identity_without_mutation() {
        let directory =
            std::env::temp_dir().join(format!("rovai-draft-user-mention-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);

        let error = store
            .save_content(
                &mut database,
                camp_id,
                0,
                ComposerDocument {
                    version: crate::camp_content::COMPOSER_DOCUMENT_VERSION,
                    segments: vec![ComposerSegment::Atom {
                        atom: ComposerAtom::Member {
                            agent_id: " agent_2".to_string(),
                            label_fallback: None,
                        },
                    }],
                },
            )
            .unwrap_err();

        assert!(error.to_string().contains("canonical identity"));
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_composer_draft WHERE camp_id = ?1",
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

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
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);
        let saved = store
            .save_content(
                &mut database,
                camp_id,
                0,
                composer_document(vec![Segment::Text {
                    text: "附件正文".to_string(),
                }]),
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
    fn legacy_prepared_draft_exhausts_before_source_refs_can_be_added() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-legacy-draft-source-cutover-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&directory);
        let legacy_source = directory.join("legacy.txt");
        let current_source = directory.join("current.txt");
        fs::write(&legacy_source, b"legacy").unwrap();
        fs::write(&current_source, b"current").unwrap();

        // This internal helper constructs the pre-upgrade Draft fixture; no public
        // Core method creates new Prepared Attachments after the cutover.
        let legacy = store
            .prepare_from_path(&mut database, camp_id, 0, &legacy_source, "legacy.txt")
            .unwrap();
        let source_ref = crate::local_attachment_source::observe_source_attachment(
            &current_source,
            "current.txt",
            Some("text/plain"),
        )
        .unwrap();
        assert!(
            store
                .commit_source_attachment(
                    &mut database,
                    camp_id,
                    legacy.revision,
                    source_ref.clone(),
                )
                .unwrap_err()
                .to_string()
                .contains("legacy_draft.attachments_locked")
        );

        let exhausted = store
            .remove_prepared(
                &mut database,
                camp_id,
                legacy.revision,
                &legacy.attachments[0].id,
            )
            .unwrap();
        assert!(exhausted.attachments.is_empty());
        let current = store
            .commit_source_attachment(&mut database, camp_id, exhausted.revision, source_ref)
            .unwrap();
        assert_eq!(current.attachments.len(), 1);
        assert_eq!(current.attachments[0].display_name, "current.txt");
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM prepared_attachment WHERE camp_id = ?1",
                    [camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        store.remove_camp(camp_id).unwrap();
        drop(database);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn directory_attachment_is_one_frozen_hierarchical_snapshot() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-directory-attachment-test-{}",
            Uuid::new_v4()
        ));
        let data_directory = fixture.join("data");
        let source = fixture.join("项目资料");
        fs::create_dir_all(source.join("docs/empty")).unwrap();
        fs::write(source.join("README.md"), b"directory snapshot").unwrap();
        fs::write(source.join("docs/plan.txt"), b"frozen plan").unwrap();
        fs::write(source.join(".env.example"), b"TOKEN=example").unwrap();

        let mut database = Database::open(&data_directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&data_directory);
        let draft = store
            .prepare_from_path(&mut database, camp_id, 0, &source, "项目资料")
            .unwrap();
        assert_eq!(draft.attachments.len(), 1);
        let attachment = &draft.attachments[0];
        assert_eq!(attachment.kind, "directory");
        assert_eq!(attachment.file_count, Some(3));
        assert_eq!(attachment.media_type.as_deref(), Some(DIRECTORY_MEDIA_TYPE));
        assert_eq!(attachment.preview_kind, "none");
        assert_eq!(
            attachment.byte_size,
            Some(
                b"directory snapshot".len() as u64
                    + b"frozen plan".len() as u64
                    + b"TOKEN=example".len() as u64
            )
        );

        let (storage_path, digest): (String, String) = database
            .connection()
            .query_row(
                "SELECT storage_path, content_digest FROM prepared_attachment WHERE id = ?1",
                [&attachment.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let storage_path = PathBuf::from(storage_path);
        assert!(storage_path.is_dir());
        assert_eq!(
            fs::read(storage_path.join("docs/plan.txt")).unwrap(),
            b"frozen plan"
        );
        assert!(storage_path.join("docs/empty").is_dir());
        assert_eq!(
            managed_attachment_summary(&storage_path, DIRECTORY_MEDIA_TYPE).unwrap(),
            ManagedAttachmentSummary {
                kind: "directory".to_string(),
                file_count: 3,
            }
        );
        assert!(digest.starts_with("sha256:"));
        assert_eq!(digest, DIRECTORY_SNAPSHOT_FIXTURE_DIGEST);

        fs::write(source.join("docs/plan.txt"), b"changed original").unwrap();
        assert_eq!(
            fs::read(storage_path.join("docs/plan.txt")).unwrap(),
            b"frozen plan"
        );
        store
            .verify_send(&database, camp_id, std::slice::from_ref(&attachment.id))
            .unwrap();

        store.remove_camp(camp_id).unwrap();
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn directory_attachment_rejects_symlinks_without_copying_their_target() {
        use std::os::unix::fs::symlink;

        let fixture =
            std::env::temp_dir().join(format!("rovai-directory-symlink-test-{}", Uuid::new_v4()));
        let data_directory = fixture.join("data");
        let source = fixture.join("source");
        fs::create_dir_all(&source).unwrap();
        let outside = fixture.join("outside-secret.txt");
        fs::write(&outside, b"must not be copied").unwrap();
        symlink(&outside, source.join("linked-secret.txt")).unwrap();

        let mut database = Database::open(&data_directory).unwrap();
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        insert_test_camp(&database, camp_id);
        let store = CampAttachmentStore::new(&data_directory);
        let error = store
            .prepare_from_path(&mut database, camp_id, 0, &source, "source")
            .unwrap_err()
            .to_string();
        assert!(error.contains("symbolic link"), "unexpected error: {error}");
        let prepared_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM prepared_attachment WHERE camp_id = ?1",
                [camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prepared_count, 0);

        store.remove_camp(camp_id).unwrap();
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
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
}
