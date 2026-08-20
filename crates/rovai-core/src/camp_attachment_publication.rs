use std::path::PathBuf;

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::{
    camp_attachment_view::{MAX_CAMP_VIEW_BYTES, MAX_INSTANCE_VIEW_BYTES},
    camp_id::CampId,
    db::Database,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorityAttachment {
    pub attachment_id: String,
    pub display_name: String,
    pub media_type: String,
    pub byte_size: u64,
    pub content_digest: String,
    pub storage_path: PathBuf,
    pub preview_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedAttachmentPublication {
    pub operation_id: String,
    pub semantic_revision: i64,
    pub attachment_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttachmentPublicationSource {
    Composer { draft_revision: i64 },
    Agent,
}

impl AttachmentPublicationSource {
    fn kind(self) -> &'static str {
        match self {
            Self::Composer { .. } => "composer",
            Self::Agent => "agent",
        }
    }

    fn draft_revision(self) -> Option<i64> {
        match self {
            Self::Composer { draft_revision } => Some(draft_revision),
            Self::Agent => None,
        }
    }
}

#[derive(Debug, Default)]
pub struct CampAttachmentPublicationCoordinator;

impl CampAttachmentPublicationCoordinator {
    pub fn commit_composer_intent(
        &self,
        transaction: &Transaction<'_>,
        camp_id: &str,
        camp_message_id: &str,
        command_id: &str,
        draft_revision: i64,
        attachment_ids: &[String],
    ) -> Result<Option<CommittedAttachmentPublication>> {
        if attachment_ids.is_empty() {
            return Ok(None);
        }
        let authority = load_composer_authority(transaction, camp_id)?;
        let stored_ids = authority
            .iter()
            .map(|attachment| attachment.attachment_id.as_str())
            .collect::<Vec<_>>();
        let requested_ids = attachment_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        if stored_ids != requested_ids {
            anyhow::bail!("Camp Composer Draft attachments changed before publication commit");
        }
        self.commit_intent(
            transaction,
            camp_id,
            camp_message_id,
            command_id,
            AttachmentPublicationSource::Composer { draft_revision },
            &authority,
        )
        .map(Some)
    }

    pub fn commit_agent_intent(
        &self,
        transaction: &Transaction<'_>,
        camp_id: &str,
        camp_message_id: &str,
        command_id: &str,
        authority: &[AuthorityAttachment],
    ) -> Result<Option<CommittedAttachmentPublication>> {
        if authority.is_empty() {
            return Ok(None);
        }
        self.commit_intent(
            transaction,
            camp_id,
            camp_message_id,
            command_id,
            AttachmentPublicationSource::Agent,
            authority,
        )
        .map(Some)
    }

    fn commit_intent(
        &self,
        transaction: &Transaction<'_>,
        camp_id: &str,
        camp_message_id: &str,
        command_id: &str,
        source: AttachmentPublicationSource,
        authority: &[AuthorityAttachment],
    ) -> Result<CommittedAttachmentPublication> {
        CampId::parse(camp_id)?;
        let requested_bytes = authority.iter().try_fold(0_u64, |total, attachment| {
            total
                .checked_add(attachment.byte_size)
                .context("attachment publication byte total overflow")
        })?;
        check_effective_quota(transaction, camp_id, requested_bytes)?;

        let current_revision: i64 = transaction.query_row(
            "SELECT semantic_revision FROM camp_attachment_view WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        let semantic_revision = current_revision
            .checked_add(1)
            .context("Camp Attachment semantic revision overflow")?;
        let operation_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        transaction.execute(
            r#"
            INSERT INTO camp_attachment_view_operation(
                id, camp_id, kind, status, command_id, draft_revision,
                reserved_bytes, cleanup_root_relative_path,
                cleanup_root_identity_digest, previous_view_state,
                error_code, created_at, updated_at, completed_at,
                source_kind, camp_message_id, semantic_revision,
                resolution_state, resolution_ledger_digest, terminal_failure_code
            ) VALUES (
                ?1, ?2, 'publish', 'planned', ?3, ?4, ?5,
                NULL, NULL, NULL, NULL, ?6, ?6, NULL,
                ?7, ?8, ?9, 'unresolved', NULL, NULL
            )
            "#,
            params![
                operation_id,
                camp_id,
                command_id,
                source.draft_revision(),
                requested_bytes as i64,
                now,
                source.kind(),
                camp_message_id,
                semantic_revision,
            ],
        )?;
        for attachment in authority {
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
                    NULL, NULL, NULL, NULL,
                    '.staging/' || ?1 || '/' || ?2,
                    'camps/' || ?7 || '/attachments/' || ?2,
                    NULL, NULL, ?8, ?8
                )
                "#,
                params![
                    operation_id,
                    attachment.attachment_id,
                    attachment.media_type,
                    attachment.byte_size as i64,
                    attachment.content_digest,
                    attachment.storage_path.to_string_lossy(),
                    camp_id,
                    now,
                ],
            )?;
        }
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view
            SET semantic_revision = ?2, updated_at = ?3
            WHERE camp_id = ?1 AND semantic_revision = ?4
            "#,
            params![camp_id, semantic_revision, now, current_revision],
        )?;
        if changed != 1 {
            anyhow::bail!("camp_attachment_publication_revision_conflict");
        }
        Ok(CommittedAttachmentPublication {
            operation_id,
            semantic_revision,
            attachment_ids: authority
                .iter()
                .map(|attachment| attachment.attachment_id.clone())
                .collect(),
        })
    }

    pub fn bind_message_attachments(
        &self,
        transaction: &Transaction<'_>,
        camp_message_id: &str,
        publication: &CommittedAttachmentPublication,
    ) -> Result<()> {
        let changed = transaction.execute(
            r#"
            UPDATE message_attachment
            SET runtime_projection_state = 'pending',
                publication_operation_id = ?2,
                publication_semantic_revision = ?3
            WHERE camp_message_id = ?1
            "#,
            params![
                camp_message_id,
                publication.operation_id,
                publication.semantic_revision
            ],
        )?;
        if changed != publication.attachment_ids.len() {
            anyhow::bail!("attachment publication did not bind every public attachment");
        }
        Ok(())
    }

    pub fn gate_deliveries(
        &self,
        transaction: &Transaction<'_>,
        delivery_ids: &[String],
        operation_id: &str,
    ) -> Result<()> {
        for delivery_id in delivery_ids {
            let changed = transaction.execute(
                r#"
                UPDATE message_delivery
                SET dispatch_phase = 'projection_blocked',
                    pre_dispatch_gate = 'attachment_projection',
                    projection_operation_id = ?2,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND status = 'pending'
                  AND dispatch_phase = 'never_attempted'
                  AND dispatch_attempt_count = 0
                "#,
                params![delivery_id, operation_id, chrono::Utc::now().to_rfc3339()],
            )?;
            if changed != 1 {
                anyhow::bail!("message_delivery_projection_gate_conflict");
            }
        }
        Ok(())
    }
}

pub fn has_unresolved_writer_intent(transaction: &Transaction<'_>, camp_id: &str) -> Result<bool> {
    transaction
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

fn load_composer_authority(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<AuthorityAttachment>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, display_name, media_type, byte_size, content_digest,
               storage_path, preview_kind
        FROM prepared_attachment
        WHERE camp_id = ?1 AND state = 'ready'
        ORDER BY ordinal, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let byte_size = row.get::<_, i64>(3)?;
            if byte_size < 0 {
                return Err(rusqlite::Error::IntegralValueOutOfRange(3, byte_size));
            }
            Ok(AuthorityAttachment {
                attachment_id: row.get(0)?,
                display_name: row.get(1)?,
                media_type: row.get(2)?,
                byte_size: byte_size as u64,
                content_digest: row.get(4)?,
                storage_path: PathBuf::from(row.get::<_, String>(5)?),
                preview_kind: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn check_effective_quota(
    transaction: &Transaction<'_>,
    camp_id: &str,
    requested_bytes: u64,
) -> Result<()> {
    let (camp_materialized, instance_materialized): (i64, i64) = transaction.query_row(
        r#"
        SELECT
            COALESCE((SELECT aggregate_bytes FROM camp_attachment_view WHERE camp_id = ?1), 0),
            COALESCE((SELECT SUM(aggregate_bytes) FROM camp_attachment_view), 0)
        "#,
        [camp_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let camp_reserved: i64 = transaction.query_row(
        r#"
        SELECT COALESCE(SUM(reserved_bytes), 0)
        FROM camp_attachment_view_operation
        WHERE camp_id = ?1 AND resolution_state = 'unresolved'
        "#,
        [camp_id],
        |row| row.get(0),
    )?;
    let instance_reserved: i64 = transaction.query_row(
        r#"
        SELECT COALESCE(SUM(reserved_bytes), 0)
        FROM camp_attachment_view_operation
        WHERE resolution_state = 'unresolved'
        "#,
        [],
        |row| row.get(0),
    )?;
    let camp_effective = u64::try_from(camp_materialized)?
        .checked_add(u64::try_from(camp_reserved)?)
        .and_then(|value| value.checked_add(requested_bytes))
        .context("Camp attachment quota overflow")?;
    let instance_effective = u64::try_from(instance_materialized)?
        .checked_add(u64::try_from(instance_reserved)?)
        .and_then(|value| value.checked_add(requested_bytes))
        .context("instance attachment quota overflow")?;
    if camp_effective > MAX_CAMP_VIEW_BYTES || instance_effective > MAX_INSTANCE_VIEW_BYTES {
        anyhow::bail!("camp_attachment_view_quota_exceeded");
    }
    Ok(())
}

pub fn publication_for_message(
    transaction: &Transaction<'_>,
    camp_message_id: &str,
) -> Result<Option<String>> {
    transaction
        .query_row(
            r#"
            SELECT DISTINCT publication_operation_id
            FROM message_attachment
            WHERE camp_message_id = ?1 AND publication_operation_id IS NOT NULL
            "#,
            [camp_message_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

pub fn frozen_sources_are_owned(
    database: &Database,
    frozen: &[AuthorityAttachment],
) -> Result<bool> {
    if frozen.is_empty() {
        return Ok(false);
    }
    let placeholders = std::iter::repeat_n("?", frozen.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT COUNT(*) FROM message_attachment WHERE id IN ({placeholders})");
    let ids = frozen
        .iter()
        .map(|attachment| attachment.attachment_id.as_str())
        .collect::<Vec<_>>();
    let count: i64 =
        database
            .connection()
            .query_row(&sql, rusqlite::params_from_iter(ids), |row| row.get(0))?;
    Ok(count == frozen.len() as i64)
}

pub fn database_has_unresolved_writer_intent(database: &Database, camp_id: &str) -> Result<bool> {
    database
        .connection()
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

pub fn unresolved_publication_camp_ids(database: &Database) -> Result<Vec<String>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT DISTINCT camp_id
        FROM camp_attachment_view_operation
        WHERE resolution_state = 'unresolved'
        ORDER BY camp_id
        "#,
    )?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
