use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::{
    collections::BTreeSet,
    ffi::{CStr, CString},
    os::fd::{AsRawFd, FromRawFd},
    os::unix::ffi::{OsStrExt, OsStringExt},
};

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    camp_attachment_publication::AuthorityAttachment,
    camp_content::{
        StructuredCampMessageContent, StructuredCampMessageSegment, has_all_members_mention,
        member_mention_ids, normalize_content, render_current_plain_text,
        validate_user_authored_content,
    },
    camp_id::CampId,
    current_user::{CURRENT_USER_ID, CurrentUserResolver},
    db::Database,
};

pub const MAX_PREPARED_ATTACHMENTS: usize = 10;
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_DRAFT_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_DIRECTORY_FILES: u64 = 2_000;
pub const MAX_DIRECTORY_ENTRIES: u64 = 4_000;
pub const MAX_DIRECTORY_DEPTH: usize = 32;
pub const DIRECTORY_MEDIA_TYPE: &str = "inode/directory";

const _: () = {
    assert!(MAX_PREVIEW_BYTES < MAX_ATTACHMENT_BYTES);
    assert!(MAX_ATTACHMENT_BYTES < MAX_DRAFT_ATTACHMENT_BYTES);
};

const DRAFT_RETENTION_DAYS: i64 = 7;
const INSPECTION_PREFIX_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_EDGE: u64 = 16_384;
const MAX_PREVIEW_PIXELS: u64 = 40_000_000;
const ATTACHMENT_METADATA_FILE: &str = ".rovai-attachment.json";
const ATTACHMENT_METADATA_SCHEMA_VERSION: u32 = 1;
#[cfg(all(test, any(windows, feature = "slow-tests")))]
const DIRECTORY_SNAPSHOT_FIXTURE_DIGEST: &str =
    "sha256:69c6a7b4e706d0177bdcc3b806c25daac505628a8d9f22c4976fd5c93ef87501";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAttachmentView {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub file_count: u64,
    pub media_type: String,
    pub byte_size: u64,
    pub preview_kind: String,
    pub state: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedAttachmentSummary {
    pub kind: String,
    pub file_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeAttachmentCopyReceipt {
    pub authority_safe_leaf: String,
    pub kind: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub node_count: u64,
    pub byte_size: u64,
    pub content_digest: String,
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
    pub content: StructuredCampMessageContent,
    pub revision: i64,
    pub attachments: Vec<PreparedAttachmentView>,
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
        let camp_id = CampId::parse(camp_id)?;
        let root = self.root.join(camp_id.as_str());
        ensure_directory(&root)?;
        restrict_discovery(&root)?;
        Ok(root)
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
        let camp_root = self.camp_root(camp_id)?;
        allow_directory_update(&camp_root)?;
        let mut frozen = Vec::with_capacity(requested_paths.len());
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
                restrict_discovery(&attachment_directory)?;
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
            for attachment in &frozen {
                if let Some(directory) = attachment.storage_path.parent() {
                    cleanup_unowned_attachment(&camp_root, directory);
                }
            }
            return Err(error);
        }
        Ok(frozen)
    }

    pub fn cleanup_unowned_agent_sources(&self, camp_id: &str, frozen: &[AuthorityAttachment]) {
        let Ok(camp_root) = self.camp_root(camp_id) else {
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
                       updated_at, expires_at
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
                    ))
                },
            )
            .optional()?;
        let attachments = load_prepared_attachments(database, camp_id)?;
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
            )) => {
                let content = normalize_content(serde_json::from_str(&content)?);
                validate_user_authored_content(&content)?;
                let continuation_intent = project_continuation_intent(
                    database.connection(),
                    camp_id,
                    ContinuationProjectionInput {
                        stored_source_message_id: continuation_source.as_deref(),
                        suppressed_source_message_id: continuation_suppressed_source.as_deref(),
                        recipient_selection_touched,
                        content: &content,
                        reply_to_camp_message_id: reply_to.as_deref(),
                        has_attachments: !attachments.is_empty(),
                    },
                )?;
                CampComposerDraftView {
                    camp_id: camp_id.to_string(),
                    body: render_content(database, &content)?,
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
                        has_attachments: !attachments.is_empty(),
                    },
                )?;
                CampComposerDraftView {
                    camp_id: camp_id.to_string(),
                    body: String::new(),
                    content: Vec::new(),
                    revision: 0,
                    attachments,
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
        self.save_content_with_continuation(database, camp_id, expected_revision, content, None)
    }

    pub fn save_content_with_continuation(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        content: StructuredCampMessageContent,
        continuation_source_message_id: Option<&str>,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        if let Some(source_message_id) = continuation_source_message_id {
            validate_component(source_message_id, "Camp Message")?;
        }
        let content = normalize_content(content);
        validate_user_authored_content(&content)?;
        let content_json = serde_json::to_string(&content)?;
        let body = render_content(database, &content)?;
        let current = load_draft_mutation_state(database.connection(), camp_id)?;
        let current_revision = current.as_ref().map_or(0, |draft| draft.revision);
        if current_revision != expected_revision {
            anyhow::bail!("draft_changed");
        }

        let route_changed = current.as_ref().is_some_and(|draft| {
            recipient_signature(&draft.content) != recipient_signature(&content)
        }) || (current.is_none() && has_explicit_recipient(&content));
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
            && !has_explicit_recipient(&content)
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
            draft.content == content
                && draft.continuation_source_message_id == resolved_continuation_source
                && draft.continuation_suppressed_source_message_id
                    == continuation_suppressed_source_message_id
                && draft.recipient_selection_touched == recipient_selection_touched
        }) {
            return self.load_draft(database, camp_id);
        }
        let has_attachments: bool = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)",
            [camp_id],
            |row| row.get(0),
        )?;
        if current.is_none()
            && content.is_empty()
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
            .map(|draft| draft.content.clone())
            .unwrap_or_default();
        let recipient_selection_required = if author_type == "agent" {
            if active_reply_agent(&transaction, camp_id, &author_id)? {
                ensure_leading_recipient(
                    &mut content,
                    StructuredCampMessageSegment::MemberMention {
                        agent_id: author_id,
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
                content: current.content.clone(),
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
        let mut content = current.content.clone();
        if original_author.0 == "agent"
            && !active_reply_agent(&transaction, camp_id, &original_author.1)?
        {
            content.retain(|segment| {
                !matches!(
                    segment,
                    StructuredCampMessageSegment::MemberMention { agent_id }
                        if agent_id == &original_author.1
                )
            });
        }
        let replacement = match recipient {
            CampComposerReplyRecipient::Member { agent_id } => {
                if !active_reply_agent(&transaction, camp_id, &agent_id)? {
                    anyhow::bail!("mention_target_unavailable");
                }
                StructuredCampMessageSegment::MemberMention { agent_id }
            }
            CampComposerReplyRecipient::AllMembers => {
                StructuredCampMessageSegment::AllMembersMention
            }
        };
        ensure_leading_recipient(&mut content, replacement);
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
                || has_explicit_recipient(&draft.content)
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
                    .map(|draft| draft.content.clone())
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
            "SELECT EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = ?1)",
            [camp_id],
            |row| row.get(0),
        )?;
        let has_payload = !render_current_plain_text(&transaction, &current.content)?
            .trim()
            .is_empty()
            || has_attachments;
        if candidate.available
            || !has_payload
            || current.reply_to_camp_message_id.is_some()
            || current.recipient_selection_touched
            || has_explicit_recipient(&current.content)
        {
            anyhow::bail!("continuation_recipient_required");
        }
        if candidate.agent_id == agent_id {
            anyhow::bail!("continuation_replacement_invalid");
        }
        if !active_reply_agent(&transaction, camp_id, agent_id)? {
            anyhow::bail!("mention_target_unavailable");
        }
        let mut content = current.content.clone();
        ensure_leading_recipient(
            &mut content,
            StructuredCampMessageSegment::MemberMention {
                agent_id: agent_id.to_string(),
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

    pub fn prepare_from_path(
        &self,
        database: &mut Database,
        camp_id: &str,
        expected_revision: i64,
        source_path: &Path,
        requested_display_name: &str,
    ) -> Result<CampComposerDraftView> {
        CampId::parse(camp_id)?;
        ensure_camp_exists(database, camp_id)?;
        ensure_draft_revision(database.connection(), camp_id, expected_revision)?;
        validate_draft_capacity(database, camp_id, 0)?;
        let display_name = normalize_display_name(requested_display_name)?;
        let attachment_id = Uuid::new_v4().to_string();
        let camp_root = self.camp_root(camp_id)?;
        allow_directory_update(&camp_root)?;
        let attachment_directory = camp_root.join(&attachment_id);
        let prepared = (|| -> Result<PreparedAttachment> {
            ensure_directory(&attachment_directory)?;
            let destination = attachment_directory.join(&display_name);
            let prepared = copy_and_inspect(source_path, &destination)?;
            write_attachment_metadata(&attachment_directory, &prepared)?;
            restrict_discovery(&attachment_directory)?;
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
        CampId::parse(camp_id)?;
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
        let parsed_camp_id = CampId::parse(camp_id)?;
        let paths = prepared_paths(database, camp_id)?;
        database.connection().execute(
            "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
            [camp_id],
        )?;
        let camp_root = self.root.join(parsed_camp_id.as_str());
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
                WHERE id = ?1 AND runtime_projection_state = 'available'
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

fn reject_symlink_path(admitted_root: &Path, requested_source: &Path) -> Result<()> {
    let relative = requested_source
        .strip_prefix(admitted_root)
        .context("Attachment source escaped its admitted root")?;
    let mut current = admitted_root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        if fs::symlink_metadata(&current)?.file_type().is_symlink() {
            anyhow::bail!("Attachment source path contains a symbolic link");
        }
    }
    Ok(())
}

pub(crate) fn inspect_runtime_attachment_copy(path: &Path) -> Result<RuntimeAttachmentCopyReceipt> {
    let authority_safe_leaf = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("Runtime Attachment copy has no UTF-8 safe leaf")?
        .to_string();
    validate_runtime_safe_leaf(&authority_safe_leaf)?;
    let mut source = open_source_without_following(path)?;
    let metadata = inspect_open_node(&source)?;
    if metadata.kind == OpenedNodeKind::RegularFile {
        if metadata.link_count != 1 {
            anyhow::bail!("Runtime Attachment copy contains a hard-linked file");
        }
        let (byte_size, digest) = inspect_open_regular_file(&mut source)?;
        return Ok(RuntimeAttachmentCopyReceipt {
            authority_safe_leaf,
            kind: "file".to_string(),
            file_count: 1,
            directory_count: 0,
            node_count: 1,
            byte_size,
            content_digest: format!(
                "sha256:{}",
                digest
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            ),
        });
    }
    if metadata.kind != OpenedNodeKind::Directory {
        anyhow::bail!("Runtime Attachment copy contains an unsupported root node");
    }
    let mut state = DirectorySnapshotState {
        hasher: Sha256::new(),
        file_count: 0,
        directory_count: 1,
        entry_count: 0,
        byte_size: 0,
    };
    state.hasher.update(b"rovai-directory-snapshot-v1\0");
    inspect_open_directory_snapshot(
        &source,
        Path::new(""),
        0,
        fingerprint_volume(&metadata.fingerprint),
        &mut state,
    )?;
    Ok(RuntimeAttachmentCopyReceipt {
        authority_safe_leaf,
        kind: "directory".to_string(),
        file_count: state.file_count,
        directory_count: state.directory_count,
        node_count: state
            .file_count
            .checked_add(state.directory_count)
            .context("Runtime Attachment node count overflow")?,
        byte_size: state.byte_size,
        content_digest: format!("sha256:{:x}", state.hasher.finalize()),
    })
}

#[derive(Debug, Clone)]
struct DraftMutationState {
    content: StructuredCampMessageContent,
    revision: i64,
    reply_to_camp_message_id: Option<String>,
    recipient_selection_required: bool,
    continuation_source_message_id: Option<String>,
    continuation_suppressed_source_message_id: Option<String>,
    recipient_selection_touched: bool,
}

struct ReplyMutation<'a> {
    content: StructuredCampMessageContent,
    reply_to_camp_message_id: Option<&'a str>,
    recipient_selection_required: bool,
    recipient_selection_touched: bool,
}

struct ContinuationMutation<'a> {
    content: StructuredCampMessageContent,
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
                let content = normalize_content(serde_json::from_str(&content)?);
                validate_user_authored_content(&content)?;
                Ok(DraftMutationState {
                    content,
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
    let content = normalize_content(content);
    validate_user_authored_content(&content)?;
    if current.is_some_and(|draft| {
        draft.content == content
            && draft.reply_to_camp_message_id.as_deref() == reply_to_camp_message_id
            && draft.recipient_selection_required == recipient_selection_required
            && draft.recipient_selection_touched == recipient_selection_touched
    }) {
        return Ok(false);
    }
    let content_json = serde_json::to_string(&content)?;
    let body = render_current_plain_text(transaction, &content)?;
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
    let content = normalize_content(content);
    validate_user_authored_content(&content)?;
    if current.is_some_and(|draft| {
        draft.content == content
            && draft.continuation_source_message_id.as_deref() == continuation_source_message_id
            && draft.continuation_suppressed_source_message_id.as_deref()
                == continuation_suppressed_source_message_id
            && draft.recipient_selection_touched == recipient_selection_touched
    }) {
        return Ok(false);
    }
    let content_json = serde_json::to_string(&content)?;
    let body = render_current_plain_text(transaction, &content)?;
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

fn ensure_leading_recipient(
    content: &mut StructuredCampMessageContent,
    recipient: StructuredCampMessageSegment,
) {
    let covered = content.iter().any(|segment| match (&recipient, segment) {
        (
            StructuredCampMessageSegment::MemberMention {
                agent_id: requested,
            },
            StructuredCampMessageSegment::MemberMention { agent_id: existing },
        ) => requested == existing,
        (
            StructuredCampMessageSegment::MemberMention { .. },
            StructuredCampMessageSegment::AllMembersMention,
        )
        | (
            StructuredCampMessageSegment::AllMembersMention,
            StructuredCampMessageSegment::AllMembersMention,
        ) => true,
        _ => false,
    });
    if covered {
        return;
    }
    let has_leading_whitespace = matches!(
        content.first(),
        Some(StructuredCampMessageSegment::Text { text })
            if text.chars().next().is_some_and(char::is_whitespace)
    );
    content.insert(0, recipient);
    if !has_leading_whitespace {
        content.insert(
            1,
            StructuredCampMessageSegment::Text {
                text: " ".to_string(),
            },
        );
    }
    *content = normalize_content(std::mem::take(content));
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

fn project_reply_intent(
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

#[derive(Debug)]
struct PreparedAttachment {
    path: PathBuf,
    kind: String,
    file_count: u64,
    directory_count: u64,
    node_count: u64,
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

fn copy_and_inspect(source_path: &Path, destination: &Path) -> Result<PreparedAttachment> {
    let mut source = open_source_without_following(source_path)?;
    let opened = inspect_open_node(&source)?;
    if opened.kind == OpenedNodeKind::Directory {
        return copy_directory_snapshot(&source, destination);
    }
    if opened.kind != OpenedNodeKind::RegularFile {
        anyhow::bail!("Only regular files and directories can be attached");
    }
    if fingerprint_size(&opened.fingerprint) > MAX_ATTACHMENT_BYTES {
        anyhow::bail!("Attachment exceeds the 25 MiB per-file limit");
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
    let after = inspect_open_node(&source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || byte_size != fingerprint_size(&opened.fingerprint)
        || after.fingerprint != opened.fingerprint
    {
        drop(output);
        let _ = fs::remove_file(&temporary);
        anyhow::bail!("Attachment changed while it was being copied");
    }
    set_read_only(&temporary)?;
    drop(output);
    commit_temporary(&temporary, destination)?;
    sync_parent(destination)?;
    let inspection = inspect_prefix(&prefix, byte_size);
    Ok(PreparedAttachment {
        path: destination.to_path_buf(),
        kind: "file".to_string(),
        file_count: 1,
        directory_count: 0,
        node_count: 1,
        media_type: inspection.media_type,
        byte_size,
        content_digest: format!("sha256:{:x}", hasher.finalize()),
        preview_kind: inspection.preview_kind,
    })
}

#[cfg(any(unix, windows))]
#[derive(Debug)]
struct DirectorySnapshotState {
    hasher: Sha256,
    file_count: u64,
    directory_count: u64,
    entry_count: u64,
    byte_size: u64,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MetadataFingerprint {
    device: u64,
    inode: u64,
    link_count: u64,
    size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[cfg(windows)]
type MetadataFingerprint = crate::platform::windows_file_tree::FileFingerprint;

#[cfg(any(unix, windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenedNodeKind {
    RegularFile,
    Directory,
    #[cfg(unix)]
    Unsupported,
}

#[cfg(any(unix, windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OpenedNodeMetadata {
    kind: OpenedNodeKind,
    fingerprint: MetadataFingerprint,
    link_count: u64,
}

#[cfg(any(unix, windows))]
fn copy_directory_snapshot(source: &File, destination: &Path) -> Result<PreparedAttachment> {
    let root_metadata = inspect_open_node(source)?;
    if root_metadata.kind != OpenedNodeKind::Directory {
        anyhow::bail!("Attachment directory changed before snapshotting");
    }

    ensure_directory(destination)?;
    let mut state = DirectorySnapshotState {
        hasher: Sha256::new(),
        file_count: 0,
        directory_count: 1,
        entry_count: 0,
        byte_size: 0,
    };
    state.hasher.update(b"rovai-directory-snapshot-v1\0");
    copy_open_directory(
        source,
        destination,
        Path::new(""),
        0,
        fingerprint_volume(&root_metadata.fingerprint),
        &mut state,
    )?;
    set_directory_read_only(destination)?;
    sync_parent(destination)?;
    Ok(PreparedAttachment {
        path: destination.to_path_buf(),
        kind: "directory".to_string(),
        file_count: state.file_count,
        directory_count: state.directory_count,
        node_count: state
            .file_count
            .checked_add(state.directory_count)
            .context("Attachment directory node count overflow")?,
        media_type: DIRECTORY_MEDIA_TYPE.to_string(),
        byte_size: state.byte_size,
        content_digest: format!("sha256:{:x}", state.hasher.finalize()),
        preview_kind: "none".to_string(),
    })
}

#[cfg(any(unix, windows))]
fn copy_open_directory(
    source: &File,
    destination: &Path,
    relative_path: &Path,
    depth: usize,
    root_volume: u64,
    state: &mut DirectorySnapshotState,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        anyhow::bail!("Attachment directory exceeds the 32-level depth limit");
    }
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::Directory {
        anyhow::bail!("Attachment directory changed while it was being copied");
    }
    if fingerprint_volume(&before.fingerprint) != root_volume {
        anyhow::bail!("Attachment directory contains a mount or volume escape");
    }
    hash_tree_entry(&mut state.hasher, b'D', relative_path, 0, None)?;
    let names = read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?;
    for name in &names {
        state.entry_count = state
            .entry_count
            .checked_add(1)
            .context("Attachment directory entry count overflow")?;
        if state.entry_count > MAX_DIRECTORY_ENTRIES {
            anyhow::bail!("Attachment directory exceeds the 4000-entry limit");
        }
        let mut child = open_child_without_following(source, name)?;
        let metadata = inspect_open_node(&child)?;
        if fingerprint_volume(&metadata.fingerprint) != root_volume {
            anyhow::bail!("Attachment directory contains a mount or volume escape");
        }
        let child_relative = relative_path.join(name);
        let child_destination = destination.join(name);
        if metadata.kind == OpenedNodeKind::Directory {
            state.directory_count = state
                .directory_count
                .checked_add(1)
                .context("Attachment directory count overflow")?;
            ensure_directory(&child_destination)?;
            copy_open_directory(
                &child,
                &child_destination,
                &child_relative,
                depth + 1,
                root_volume,
                state,
            )?;
            set_directory_read_only(&child_destination)?;
        } else if metadata.kind == OpenedNodeKind::RegularFile {
            state.file_count = state
                .file_count
                .checked_add(1)
                .context("Attachment directory file count overflow")?;
            if state.file_count > MAX_DIRECTORY_FILES {
                anyhow::bail!("Attachment directory exceeds the 2000-file limit");
            }
            let child_size = fingerprint_size(&metadata.fingerprint);
            if child_size > MAX_ATTACHMENT_BYTES {
                anyhow::bail!(
                    "A file in the attachment directory exceeds the 25 MiB per-file limit"
                );
            }
            if state.byte_size.saturating_add(child_size) > MAX_DRAFT_ATTACHMENT_BYTES {
                anyhow::bail!("Attachment directory exceeds the 64 MiB total limit");
            }
            let copied = copy_open_regular_file(&mut child, &child_destination)?;
            state.byte_size = state
                .byte_size
                .checked_add(copied.byte_size)
                .context("Attachment directory size overflow")?;
            hash_tree_entry(
                &mut state.hasher,
                b'F',
                &child_relative,
                copied.byte_size,
                Some(&copied.digest),
            )?;
        } else {
            anyhow::bail!(
                "Attachment directory contains an unsupported item: {}",
                child_relative.to_string_lossy()
            );
        }
    }
    let after = inspect_open_node(source)?;
    if names != read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?
        || after.kind != OpenedNodeKind::Directory
        || before.fingerprint != after.fingerprint
    {
        anyhow::bail!("Attachment directory changed while it was being copied");
    }
    Ok(())
}

#[cfg(any(unix, windows))]
struct CopiedDirectoryFile {
    byte_size: u64,
    digest: [u8; 32],
}

#[cfg(any(unix, windows))]
fn copy_open_regular_file(source: &mut File, destination: &Path) -> Result<CopiedDirectoryFile> {
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::RegularFile {
        anyhow::bail!("Attachment directory item changed type while it was being copied");
    }
    if fingerprint_size(&before.fingerprint) > MAX_ATTACHMENT_BYTES {
        anyhow::bail!("A file in the attachment directory exceeds the 25 MiB per-file limit");
    }
    let temporary = destination.with_file_name(format!(".{}.tmp", Uuid::new_v4()));
    let mut destination_options = OpenOptions::new();
    destination_options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        destination_options.mode(0o600);
    }
    let mut output = destination_options.open(&temporary)?;
    let mut hasher = Sha256::new();
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
                .context("Attachment file size overflow")?;
            if byte_size > MAX_ATTACHMENT_BYTES {
                anyhow::bail!(
                    "A file in the attachment directory exceeds the 25 MiB per-file limit"
                );
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
    let after = inspect_open_node(source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || byte_size != fingerprint_size(&before.fingerprint)
        || before.fingerprint != after.fingerprint
    {
        drop(output);
        let _ = fs::remove_file(&temporary);
        anyhow::bail!("A file in the attachment directory changed while it was being copied");
    }
    set_read_only(&temporary)?;
    drop(output);
    commit_temporary(&temporary, destination)?;
    sync_parent(destination)?;
    Ok(CopiedDirectoryFile {
        byte_size,
        digest: hasher.finalize().into(),
    })
}

fn inspect_open_regular_file(source: &mut File) -> Result<(u64, [u8; 32])> {
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::RegularFile || before.link_count != 1 {
        anyhow::bail!("Runtime Attachment file identity is unsafe");
    }
    if fingerprint_size(&before.fingerprint) > MAX_ATTACHMENT_BYTES {
        anyhow::bail!("Runtime Attachment file exceeds the per-file limit");
    }
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        byte_size = byte_size
            .checked_add(read as u64)
            .context("Runtime Attachment file size overflow")?;
        if byte_size > MAX_ATTACHMENT_BYTES {
            anyhow::bail!("Runtime Attachment file exceeds the per-file limit");
        }
        hasher.update(&buffer[..read]);
    }
    let after = inspect_open_node(source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || after.link_count != 1
        || byte_size != fingerprint_size(&before.fingerprint)
        || before.fingerprint != after.fingerprint
    {
        anyhow::bail!("Runtime Attachment file changed while it was inspected");
    }
    Ok((byte_size, hasher.finalize().into()))
}

fn inspect_open_directory_snapshot(
    source: &File,
    relative_path: &Path,
    depth: usize,
    root_volume: u64,
    state: &mut DirectorySnapshotState,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        anyhow::bail!("Runtime Attachment directory exceeds the depth limit");
    }
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::Directory
        || fingerprint_volume(&before.fingerprint) != root_volume
    {
        anyhow::bail!("Runtime Attachment directory identity is unsafe");
    }
    hash_tree_entry(&mut state.hasher, b'D', relative_path, 0, None)?;
    let names = read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?;
    for name in &names {
        state.entry_count = state
            .entry_count
            .checked_add(1)
            .context("Runtime Attachment directory entry count overflow")?;
        if state.entry_count > MAX_DIRECTORY_ENTRIES {
            anyhow::bail!("Runtime Attachment directory exceeds the entry limit");
        }
        let mut child = open_child_without_following(source, name)?;
        let metadata = inspect_open_node(&child)?;
        if fingerprint_volume(&metadata.fingerprint) != root_volume {
            anyhow::bail!("Runtime Attachment directory contains a mount or volume escape");
        }
        let child_relative = relative_path.join(name);
        if metadata.kind == OpenedNodeKind::Directory {
            state.directory_count = state
                .directory_count
                .checked_add(1)
                .context("Runtime Attachment directory count overflow")?;
            inspect_open_directory_snapshot(
                &child,
                &child_relative,
                depth + 1,
                root_volume,
                state,
            )?;
        } else if metadata.kind == OpenedNodeKind::RegularFile {
            if metadata.link_count != 1 {
                anyhow::bail!("Runtime Attachment directory contains a hard-linked file");
            }
            state.file_count = state
                .file_count
                .checked_add(1)
                .context("Runtime Attachment directory file count overflow")?;
            if state.file_count > MAX_DIRECTORY_FILES {
                anyhow::bail!("Runtime Attachment directory exceeds the file-count limit");
            }
            let (byte_size, digest) = inspect_open_regular_file(&mut child)?;
            state.byte_size = state
                .byte_size
                .checked_add(byte_size)
                .context("Runtime Attachment directory size overflow")?;
            if state.byte_size > MAX_DRAFT_ATTACHMENT_BYTES {
                anyhow::bail!("Runtime Attachment directory exceeds the byte limit");
            }
            hash_tree_entry(
                &mut state.hasher,
                b'F',
                &child_relative,
                byte_size,
                Some(&digest),
            )?;
        } else {
            anyhow::bail!("Runtime Attachment directory contains an unsupported node");
        }
    }
    let after = inspect_open_node(source)?;
    if names != read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?
        || after.kind != OpenedNodeKind::Directory
        || before.fingerprint != after.fingerprint
    {
        anyhow::bail!("Runtime Attachment directory changed while it was inspected");
    }
    Ok(())
}

#[cfg(unix)]
fn open_source_without_following(path: &Path) -> Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    match options.open(path) {
        Ok(file) => Ok(file),
        Err(error) if error.raw_os_error() == Some(libc::ELOOP) => {
            anyhow::bail!("Attachment symlinks are not supported")
        }
        Err(error) => {
            Err(error).with_context(|| format!("failed to open attachment {}", path.display()))
        }
    }
}

#[cfg(windows)]
fn open_source_without_following(path: &Path) -> Result<File> {
    crate::platform::windows_file_tree::open_path_without_following(path)
}

#[cfg(unix)]
fn open_child_without_following(directory: &File, name: &OsString) -> Result<File> {
    let name_bytes = name.as_os_str().as_bytes();
    let c_name = CString::new(name_bytes).context("Attachment name contains a NUL byte")?;
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c_name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if descriptor < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ELOOP) {
            anyhow::bail!("Attachment directory contains a symbolic link");
        }
        return Err(error).with_context(|| {
            format!(
                "failed to open attachment directory item {}",
                name.to_string_lossy()
            )
        });
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(windows)]
fn open_child_without_following(directory: &File, name: &OsString) -> Result<File> {
    crate::platform::windows_file_tree::open_child_without_following(directory, name)
}

#[cfg(unix)]
fn read_directory_names(directory: &File, maximum_names: usize) -> Result<Vec<OsString>> {
    let duplicated = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicated < 0 {
        return Err(std::io::Error::last_os_error())
            .context("failed to duplicate directory handle");
    }
    let stream = unsafe { libc::fdopendir(duplicated) };
    if stream.is_null() {
        let error = std::io::Error::last_os_error();
        unsafe { libc::close(duplicated) };
        return Err(error).context("failed to enumerate attachment directory");
    }
    unsafe { libc::rewinddir(stream) };
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        names.push(OsString::from_vec(bytes.to_vec()));
        if names.len() > maximum_names {
            unsafe { libc::closedir(stream) };
            anyhow::bail!("Attachment directory exceeds the 4000-entry limit");
        }
    }
    let close_result = unsafe { libc::closedir(stream) };
    if close_result != 0 {
        return Err(std::io::Error::last_os_error()).context("failed to close directory handle");
    }
    names.sort_by(|left, right| {
        left.as_os_str()
            .as_bytes()
            .cmp(right.as_os_str().as_bytes())
    });
    let unique = names
        .iter()
        .map(|name| name.as_os_str().as_bytes())
        .collect::<BTreeSet<_>>();
    if unique.len() != names.len() {
        anyhow::bail!("Attachment directory contains duplicate entry names");
    }
    Ok(names)
}

#[cfg(unix)]
fn inspect_open_node(file: &File) -> Result<OpenedNodeMetadata> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    let kind = if metadata.is_file() {
        OpenedNodeKind::RegularFile
    } else if metadata.is_dir() {
        OpenedNodeKind::Directory
    } else {
        OpenedNodeKind::Unsupported
    };
    Ok(OpenedNodeMetadata {
        kind,
        fingerprint: MetadataFingerprint {
            device: metadata.dev(),
            inode: metadata.ino(),
            link_count: metadata.nlink(),
            size: metadata.size(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        },
        link_count: metadata.nlink(),
    })
}

#[cfg(unix)]
fn hash_tree_entry(
    hasher: &mut Sha256,
    kind: u8,
    relative_path: &Path,
    byte_size: u64,
    digest: Option<&[u8; 32]>,
) -> Result<()> {
    let path = relative_path.as_os_str().as_bytes();
    hasher.update([kind]);
    hasher.update((path.len() as u64).to_be_bytes());
    hasher.update(path);
    hasher.update(byte_size.to_be_bytes());
    if let Some(digest) = digest {
        hasher.update(digest);
    }
    Ok(())
}

#[cfg(windows)]
fn inspect_open_node(file: &File) -> Result<OpenedNodeMetadata> {
    use crate::platform::windows_file_tree::NodeKind;

    let metadata = crate::platform::windows_file_tree::inspect_node(file)?;
    Ok(OpenedNodeMetadata {
        kind: match metadata.kind {
            NodeKind::RegularFile => OpenedNodeKind::RegularFile,
            NodeKind::Directory => OpenedNodeKind::Directory,
        },
        fingerprint: metadata.fingerprint,
        link_count: metadata.number_of_links as u64,
    })
}

#[cfg(unix)]
fn fingerprint_volume(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.device
}

#[cfg(windows)]
fn fingerprint_volume(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.volume_serial_number
}

#[cfg(windows)]
fn read_directory_names(directory: &File, maximum_names: usize) -> Result<Vec<OsString>> {
    crate::platform::windows_file_tree::read_directory_names(directory, maximum_names)
}

#[cfg(windows)]
fn hash_tree_entry(
    hasher: &mut Sha256,
    kind: u8,
    relative_path: &Path,
    byte_size: u64,
    digest: Option<&[u8; 32]>,
) -> Result<()> {
    let mut path = Vec::new();
    for component in relative_path.components() {
        let std::path::Component::Normal(name) = component else {
            anyhow::bail!("Attachment directory produced a non-relative canonical path");
        };
        if !path.is_empty() {
            path.push(b'/');
        }
        path.extend_from_slice(
            name.to_str()
                .context("Attachment filename is not valid Unicode")?
                .as_bytes(),
        );
    }
    hasher.update([kind]);
    hasher.update((path.len() as u64).to_be_bytes());
    hasher.update(&path);
    hasher.update(byte_size.to_be_bytes());
    if let Some(digest) = digest {
        hasher.update(digest);
    }
    Ok(())
}

#[cfg(unix)]
fn fingerprint_size(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.size
}

#[cfg(windows)]
fn fingerprint_size(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.size
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
               state, last_error_code, created_at, storage_path
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
                row.get::<_, String>(8)?,
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
                created_at,
                storage_path,
            )| {
                let summary = managed_attachment_summary(Path::new(&storage_path), &media_type)?;
                Ok(PreparedAttachmentView {
                    id,
                    display_name,
                    kind: summary.kind,
                    file_count: summary.file_count,
                    media_type,
                    byte_size: byte_size.max(0) as u64,
                    preview_kind,
                    state,
                    error_message: last_error_code.map(error_message),
                    created_at,
                })
            },
        )
        .collect()
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

fn ensure_camp_exists(database: &Database, camp_id: &str) -> Result<()> {
    database
        .connection()
        .query_row("SELECT 1 FROM camp WHERE id = ?1", [camp_id], |_| Ok(()))
        .optional()?
        .context("Camp does not exist")?;
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

fn validate_runtime_safe_leaf(value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.ends_with([' ', '.'])
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':' | '\0'))
    {
        anyhow::bail!("Authority Attachment safe leaf is invalid for Runtime View");
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if reserved {
        anyhow::bail!("Authority Attachment safe leaf is a reserved Runtime View name");
    }
    Ok(())
}

fn validate_runtime_source_tree(path: &Path, depth: usize) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        anyhow::bail!("Camp Attachment Runtime View source exceeds the depth limit");
    }
    let source = open_source_without_following(path)?;
    let metadata = inspect_open_node(&source)?;
    if metadata.kind == OpenedNodeKind::RegularFile {
        if metadata.link_count != 1 {
            anyhow::bail!("Camp Attachment Runtime View source contains a hard-linked file");
        }
        return Ok(());
    }
    if metadata.kind != OpenedNodeKind::Directory {
        anyhow::bail!("Camp Attachment Runtime View source contains an unsupported node");
    }
    let mut children = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        validate_runtime_source_tree(&child.path(), depth + 1)?;
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

fn allow_directory_update(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(_path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
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

fn set_directory_read_only(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o500))?;
    }
    #[cfg(windows)]
    {
        // FILE_ATTRIBUTE_READONLY has no directory access-control semantics.
        // The Windows managed root supplies the private DACL; freezing its
        // descendant ACLs is owned by the separate private-storage checkpoint.
        let _ = path;
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
    make_owned_tree_removable(path)?;
    fs::remove_dir_all(path)?;
    Ok(())
}

fn make_owned_tree_removable(path: &Path) -> Result<()> {
    allow_directory_update(path)?;
    let children = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
    for child in children {
        let child_path = child.path();
        let metadata = fs::symlink_metadata(&child_path)?;
        if metadata.file_type().is_symlink() {
            anyhow::bail!("Attachment directory contains an unsafe symbolic link");
        }
        if metadata.is_dir() {
            make_owned_tree_removable(&child_path)?;
        } else {
            allow_file_update(&child_path)?;
        }
    }
    Ok(())
}

fn allow_file_update(_path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        crate::platform::windows_file_tree::clear_read_only(_path)?;
    }
    Ok(())
}

#[cfg(unix)]
fn commit_temporary(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination)?;
    Ok(())
}

#[cfg(windows)]
fn commit_temporary(source: &Path, destination: &Path) -> Result<()> {
    crate::platform::windows_file_tree::commit_temporary(source, destination)
}

#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(windows)]
fn sync_parent(_path: &Path) -> Result<()> {
    // Windows documents FlushFileBuffers for writable file handles, not as a
    // directory-fsync primitive. Files are flushed before MOVEFILE_WRITE_THROUGH
    // commits their same-directory rename in commit_temporary.
    Ok(())
}

#[cfg(test)]
mod agent_source_tests {
    use super::*;

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
        allow_file_update(&single.path).unwrap();
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn windows_attachment_directory_rejects_junctions() {
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

        let command = format!(
            "mklink /J \"{}\" \"{}\"",
            junction.display(),
            outside.display()
        );
        let status = Command::new("cmd.exe")
            .args(["/D", "/S", "/C", &command])
            .status()
            .unwrap();
        assert!(status.success(), "failed to create the junction fixture");

        let destination = fixture.join("snapshot");
        let error = copy_and_inspect(&source, &destination)
            .unwrap_err()
            .to_string();
        assert!(error.contains("reparse point"), "unexpected error: {error}");
        assert!(!destination.join("linked-outside/secret.txt").exists());

        fs::remove_dir(&junction).unwrap();
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

    fn insert_test_camp(database: &Database, camp_id: &str) {
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
                        agent_id: "agent_2".into(),
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
                vec![Segment::Text {
                    text: "继续处理".into(),
                }],
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
            replying.content,
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
        assert!(matches!(
            cancelled.content.first(),
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
        assert!(resolved.content.iter().any(|segment| matches!(
            segment,
            Segment::MemberMention { agent_id } if agent_id == "agent_3"
        )));
        assert!(!resolved.content.iter().any(|segment| matches!(
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
        assert!(reply.content.is_empty());
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
                vec![Segment::MemberMention {
                    agent_id: "agent_1".into(),
                }],
                Some("dismiss-source"),
            )
            .unwrap();
        assert!(addressed.continuation_intent.is_none());
        let cleared = store
            .save_content(
                &mut database,
                camp_id,
                addressed.revision,
                vec![Segment::Text {
                    text: "删除显式 Mention 后仍回到 Lead".into(),
                }],
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
                vec![Segment::Text {
                    text: "保留这份草稿".into(),
                }],
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
        assert!(matches!(
            repaired.content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_1"
        ));

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
                vec![Segment::Text {
                    text: "默认交给 Lead".into(),
                }],
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
        assert_eq!(draft.content.len(), 1);

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
                vec![Segment::Text {
                    text: "继续".into(),
                }],
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
        assert!(!has_explicit_recipient(&restored.content));

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
        assert!(matches!(
            cancelled.content.first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_2"
        ));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn structured_draft_rejects_core_owned_current_user_mentions_without_mutation() {
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
                vec![
                    Segment::CurrentUserMention {
                        user_id: CURRENT_USER_ID.to_string(),
                    },
                    Segment::Text {
                        text: "伪造提醒".to_string(),
                    },
                ],
            )
            .unwrap_err();

        assert!(error.to_string().contains("only be generated by Core"));
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
        assert_eq!(attachment.file_count, 3);
        assert_eq!(attachment.media_type, DIRECTORY_MEDIA_TYPE);
        assert_eq!(attachment.preview_kind, "none");
        assert_eq!(
            attachment.byte_size,
            b"directory snapshot".len() as u64
                + b"frozen plan".len() as u64
                + b"TOKEN=example".len() as u64
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
