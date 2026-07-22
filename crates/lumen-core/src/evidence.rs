use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

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
            let existing_size = final_path.metadata()?.len();
            if existing_size != byte_size {
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
                    JOIN conversation ON conversation.id = conversation_message.conversation_id
                    WHERE conversation_message.id = ?1 AND conversation.camp_id = ?2
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
        let (actor_type, actor_id, _) = actor_parts(actor);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionEvidenceInput {
    pub criterion_id: String,
    pub references: Vec<EntityReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteTaskCommand {
    pub task_id: String,
    pub expected_version: i64,
    pub semantic_attestation: bool,
    pub criterion_evidence: Vec<CriterionEvidenceInput>,
}

impl sealed::Sealed for CompleteTaskCommand {}
impl DomainCommand for CompleteTaskCommand {
    const TYPE: &'static str = "task.complete";
}

#[derive(Debug, Default)]
pub struct EvidenceService {
    gateway: DomainCommandGateway,
}

impl EvidenceService {
    pub fn complete_task(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CompleteTaskCommand>,
    ) -> Result<CommandExecution> {
        validate_completion_input(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            let task = transaction
                .query_row(
                    r#"
                    SELECT camp_id, status, acceptance_criteria_json,
                           generation, version
                    FROM task
                    WHERE id = ?1 AND camp_id IS NOT NULL
                    "#,
                    [&envelope.payload.task_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, status, criteria_json, generation, version)) = task else {
                return Ok(rejected("task.not_found", "Task does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(camp_id.as_str()) {
                return Ok(rejected("task.camp_mismatch", "Task is outside the Camp"));
            }
            if !matches!(status.as_str(), "pending" | "in_progress") {
                return Ok(rejected(
                    "task.not_completable",
                    "Task is not pending or in progress",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(rejected("task.version_conflict", "Task version is stale"));
            }
            let prospective_run = match validate_completion_actor(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &camp_id,
                &envelope.payload.task_id,
            )? {
                CompletionActor::Allowed { prospective_run } => prospective_run,
                CompletionActor::Rejected(result) => return Ok(result),
            };
            if !dependencies_complete(transaction, &envelope.payload.task_id)? {
                return Ok(rejected(
                    "task.dependencies_incomplete",
                    "Task has incomplete or cancelled dependencies",
                ));
            }
            if completion_has_blockers(
                transaction,
                &envelope.payload.task_id,
                prospective_run.as_deref(),
            )? {
                return Ok(rejected(
                    "task.completion_blocked",
                    "Task still has active work, authorization, delivery or unresolved effects",
                ));
            }
            let criteria: Vec<AcceptanceCriterion> = serde_json::from_str(&criteria_json)
                .context("Task Acceptance Criteria are invalid")?;
            let submitted = envelope
                .payload
                .criterion_evidence
                .iter()
                .map(|binding| (binding.criterion_id.as_str(), binding))
                .collect::<BTreeMap<_, _>>();
            let expected_ids = criteria
                .iter()
                .map(|criterion| criterion.id.as_str())
                .collect::<BTreeSet<_>>();
            let submitted_ids = submitted.keys().copied().collect::<BTreeSet<_>>();
            if expected_ids != submitted_ids {
                return Ok(rejected(
                    "task.criteria_evidence_incomplete",
                    "Evidence must cover each Acceptance Criterion exactly once",
                ));
            }
            for binding in envelope.payload.criterion_evidence.iter() {
                for reference in &binding.references {
                    if let Err(reason) = EvidenceValidator::validate(
                        transaction,
                        &camp_id,
                        reference,
                        prospective_run.as_deref(),
                    ) {
                        return Ok(CommandHandlerResult::rejected(
                            "task.evidence_ineligible",
                            json!({
                                "criterionId": binding.criterion_id,
                                "reference": reference,
                                "reason": format!("{reason:#}"),
                            }),
                        ));
                    }
                }
            }
            let now = chrono::Utc::now().to_rfc3339();
            if let Some(source_run_id) = prospective_run.as_deref() {
                transaction.execute(
                    r#"
                    UPDATE agent_run
                    SET status = 'succeeded', wait_reason = NULL,
                        execution_lease_owner = NULL, execution_lease_expires_at = NULL,
                        ended_at = ?2, version = version + 1, updated_at = ?2
                    WHERE id = ?1 AND status IN ('running', 'waiting')
                    "#,
                    params![source_run_id, now],
                )?;
            }
            let (actor_type, actor_id, source_agent_run_id) = actor_parts(&envelope.actor);
            let completion_version = version + 1;
            for binding in &envelope.payload.criterion_evidence {
                for (ordinal, reference) in binding.references.iter().enumerate() {
                    transaction.execute(
                        r#"
                        INSERT INTO task_evidence_binding(
                            task_id, task_generation, criterion_id, evidence_ordinal,
                            evidence_entity_type, evidence_entity_id,
                            task_version_at_completion,
                            attested_by_type, attested_by_id, source_agent_run_id,
                            semantic_attestation, created_at
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11)
                        "#,
                        params![
                            envelope.payload.task_id,
                            generation,
                            binding.criterion_id,
                            ordinal as i64,
                            reference.entity_type,
                            reference.entity_id,
                            completion_version,
                            actor_type,
                            actor_id,
                            source_agent_run_id,
                            now,
                        ],
                    )?;
                }
            }
            let updated = transaction.execute(
                r#"
                UPDATE task
                SET status = 'completed', completed_at = ?2, closed_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                  AND status IN ('pending', 'in_progress')
                "#,
                params![
                    envelope.payload.task_id,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("Task changed after completion gates passed");
            }
            if let Some(source_run_id) = prospective_run.as_deref() {
                finalize_completed_turn(transaction, source_run_id, &now)?;
            }
            append_domain_event(
                transaction,
                "task.completed",
                &camp_id,
                ("task", &envelope.payload.task_id),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "generation": generation,
                    "taskVersion": completion_version,
                    "criterionCount": criteria.len(),
                    "semanticAttestation": true,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "task.completed",
                json!({
                    "taskId": envelope.payload.task_id,
                    "generation": generation,
                    "version": completion_version,
                }),
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: envelope.payload.task_id.clone(),
                }),
            ))
        })
    }
}

#[derive(Debug, Deserialize)]
struct AcceptanceCriterion {
    id: String,
    #[allow(dead_code)]
    text: String,
}

pub struct EvidenceValidator;

impl EvidenceValidator {
    fn validate(
        transaction: &Transaction<'_>,
        camp_id: &str,
        reference: &EntityReference,
        prospective_succeeded_run: Option<&str>,
    ) -> Result<()> {
        match reference.entity_type.as_str() {
            "camp_message" => {
                require_single_row(
                    transaction,
                    "SELECT COUNT(*) FROM camp_message WHERE id = ?1 AND camp_id = ?2 AND tombstoned_at IS NULL",
                    &reference.entity_id,
                    camp_id,
                    "CampMessage is absent, private or tombstoned",
                )?;
            }
            "agent_run" => {
                let state = transaction
                    .query_row(
                        r#"
                        SELECT agent_run.status, camp_turn.camp_id
                        FROM agent_run
                        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                        WHERE agent_run.id = ?1
                        "#,
                        [&reference.entity_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()?;
                let Some((status, run_camp_id)) = state else {
                    anyhow::bail!("AgentRun does not exist");
                };
                let prospectively_succeeded =
                    prospective_succeeded_run == Some(&reference.entity_id);
                if run_camp_id != camp_id || (status != "succeeded" && !prospectively_succeeded) {
                    anyhow::bail!("AgentRun is outside the Camp or not successfully terminal");
                }
            }
            "action_execution" => {
                require_single_row(
                    transaction,
                    r#"
                    SELECT COUNT(*) FROM action_execution
                    JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE action_execution.id = ?1 AND camp_turn.camp_id = ?2
                      AND action_execution.status = 'succeeded'
                      AND action_execution.effect_disposition IN ('complete', 'partial')
                    "#,
                    &reference.entity_id,
                    camp_id,
                    "ActionExecution is outside the Camp or not a qualified result",
                )?;
            }
            "repository_commit" => {
                let commit = transaction
                    .query_row(
                        r#"
                        SELECT repository_commit_evidence.full_oid,
                               repository_commit_evidence.object_format,
                               repository_commit_evidence.repository_scope_id,
                               camp.repository_scope_id
                        FROM repository_commit_evidence
                        JOIN camp ON camp.id = repository_commit_evidence.camp_id
                        WHERE repository_commit_evidence.id = ?1
                          AND repository_commit_evidence.camp_id = ?2
                        "#,
                        params![reference.entity_id, camp_id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )
                    .optional()?;
                let Some((oid, object_format, scope, camp_scope)) = commit else {
                    anyhow::bail!("Repository Commit is not registered for this Camp");
                };
                let valid_oid = match object_format.as_str() {
                    "sha1" => oid.len() == 40,
                    "sha256" => oid.len() == 64,
                    _ => false,
                } && oid.bytes().all(|byte| byte.is_ascii_hexdigit());
                if !valid_oid || camp_scope.as_deref() != Some(scope.as_str()) {
                    anyhow::bail!("Repository Commit identity or scope is invalid");
                }
            }
            "message_attachment" => {
                require_single_row(
                    transaction,
                    r#"
                    SELECT COUNT(*) FROM message_attachment
                    JOIN managed_blob ON managed_blob.id = message_attachment.blob_id
                    WHERE message_attachment.id = ?1
                      AND message_attachment.camp_id = ?2
                      AND message_attachment.camp_message_id IS NOT NULL
                      AND managed_blob.state = 'present'
                    "#,
                    &reference.entity_id,
                    camp_id,
                    "Attachment is private, out of scope or its Blob is not intact",
                )?;
            }
            "conversation_message" | "inbox_message" | "workspace" | "patch" => {
                anyhow::bail!("Private or mutable object cannot complete a public Task");
            }
            _ => anyhow::bail!("Unsupported evidence entity type"),
        }
        Ok(())
    }
}

enum CompletionActor {
    Allowed { prospective_run: Option<String> },
    Rejected(CommandHandlerResult),
}

fn validate_completion_actor(
    transaction: &Transaction<'_>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    camp_id: &str,
    task_id: &str,
) -> Result<CompletionActor> {
    match actor {
        ActorRef::User { .. } => Ok(CompletionActor::Allowed {
            prospective_run: None,
        }),
        ActorRef::System { component_id } if component_id == "task-completion-coordinator" => {
            Ok(CompletionActor::Allowed {
                prospective_run: None,
            })
        }
        ActorRef::System { .. } => Ok(CompletionActor::Rejected(rejected(
            "task.complete_actor_denied",
            "System component cannot complete Tasks",
        ))),
        ActorRef::Agent {
            agent_profile_id,
            source_agent_run_id,
        } => {
            let Some(execution_epoch) = execution_epoch else {
                return Ok(CompletionActor::Rejected(rejected(
                    "task.complete_epoch_required",
                    "Agent completion requires executionEpoch",
                )));
            };
            let config = transaction
                .query_row(
                    r#"
                    SELECT agent_run.effective_config_json
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    JOIN conversation ON conversation.id = agent_run.conversation_id
                    WHERE agent_run.id = ?1 AND agent_run.task_id = ?2
                      AND camp_turn.camp_id = ?3
                      AND conversation.agent_profile_id = ?4
                      AND agent_run.execution_epoch = ?5
                      AND agent_run.status IN ('running', 'waiting')
                    "#,
                    params![
                        source_agent_run_id,
                        task_id,
                        camp_id,
                        agent_profile_id,
                        execution_epoch,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(config) = config else {
                return Ok(CompletionActor::Rejected(rejected(
                    "task.complete_agent_run_fenced",
                    "AgentRun is stale or does not own this Task",
                )));
            };
            let config: Value = serde_json::from_str(&config)?;
            let allowed = config["capabilities"]
                .as_array()
                .is_some_and(|capabilities| {
                    capabilities
                        .iter()
                        .any(|value| value.as_str() == Some("task.complete"))
                });
            if !allowed {
                return Ok(CompletionActor::Rejected(rejected(
                    "task.complete_capability_denied",
                    "AgentRun lacks task.complete",
                )));
            }
            Ok(CompletionActor::Allowed {
                prospective_run: Some(source_agent_run_id.clone()),
            })
        }
    }
}

fn dependencies_complete(transaction: &Transaction<'_>, task_id: &str) -> Result<bool> {
    let incomplete: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM task_dependency
        JOIN task AS dependency ON dependency.id = task_dependency.depends_on_task_id
        WHERE task_dependency.task_id = ?1 AND dependency.status <> 'completed'
        "#,
        [task_id],
        |row| row.get(0),
    )?;
    Ok(incomplete == 0)
}

fn completion_has_blockers(
    transaction: &Transaction<'_>,
    task_id: &str,
    prospective_run: Option<&str>,
) -> Result<bool> {
    let run_blockers: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM agent_run AS current
        WHERE current.task_id = ?1
          AND current.completion_role = 'required'
          AND current.id <> COALESCE(?2, '')
          AND NOT EXISTS (
              SELECT 1 FROM agent_run AS newer
              WHERE newer.camp_turn_id = current.camp_turn_id
                AND newer.responsibility_key = current.responsibility_key
                AND newer.responsibility_generation > current.responsibility_generation
          )
          AND current.status <> 'succeeded'
        "#,
        params![task_id, prospective_run],
        |row| row.get(0),
    )?;
    let safety_blockers: i64 = transaction.query_row(
        r#"
        SELECT
            (SELECT COUNT(*) FROM approval
             JOIN action_execution ON action_execution.id = approval.action_id
             JOIN agent_run ON agent_run.id = action_execution.agent_run_id
             WHERE agent_run.task_id = ?1 AND approval.status = 'pending')
          + (SELECT COUNT(*) FROM action_execution
             JOIN agent_run ON agent_run.id = action_execution.agent_run_id
             WHERE agent_run.task_id = ?1
               AND action_execution.status IN ('prepared', 'executing', 'unknown'))
          + (SELECT COUNT(*) FROM runtime_delivery_checkpoint
             JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
             WHERE agent_run.task_id = ?1
               AND runtime_delivery_checkpoint.status IN ('pending', 'delivering'))
        "#,
        [task_id],
        |row| row.get(0),
    )?;
    Ok(run_blockers != 0 || safety_blockers != 0)
}

fn finalize_completed_turn(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
    now: &str,
) -> Result<()> {
    let camp_turn_id: String = transaction.query_row(
        "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
        [source_agent_run_id],
        |row| row.get(0),
    )?;
    let incomplete: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM agent_run AS current
        WHERE current.camp_turn_id = ?1
          AND current.completion_role = 'required'
          AND NOT EXISTS (
              SELECT 1 FROM agent_run AS newer
              WHERE newer.camp_turn_id = current.camp_turn_id
                AND newer.responsibility_key = current.responsibility_key
                AND newer.responsibility_generation > current.responsibility_generation
          )
          AND current.status <> 'succeeded'
        "#,
        [&camp_turn_id],
        |row| row.get(0),
    )?;
    if incomplete == 0 {
        transaction.execute(
            r#"
            UPDATE camp_turn
            SET status = 'completed', ended_at = ?2,
                version = version + 1, updated_at = ?2
            WHERE id = ?1 AND status IN ('running', 'waiting')
            "#,
            params![camp_turn_id, now],
        )?;
    }
    Ok(())
}

fn validate_completion_input(command: &CompleteTaskCommand) -> Result<()> {
    if command.task_id.trim().is_empty() || !command.semantic_attestation {
        anyhow::bail!("Task completion requires an ID and semantic attestation");
    }
    let mut criterion_ids = BTreeSet::new();
    for binding in &command.criterion_evidence {
        if binding.criterion_id.trim().is_empty()
            || binding.references.is_empty()
            || !criterion_ids.insert(binding.criterion_id.as_str())
        {
            anyhow::bail!("Criterion evidence must use unique IDs and non-empty references");
        }
        let unique_references = binding
            .references
            .iter()
            .map(|reference| (&reference.entity_type, &reference.entity_id))
            .collect::<BTreeSet<_>>();
        if unique_references.len() != binding.references.len() {
            anyhow::bail!("Criterion evidence contains duplicate references");
        }
    }
    Ok(())
}

fn require_single_row(
    transaction: &Transaction<'_>,
    sql: &str,
    entity_id: &str,
    camp_id: &str,
    error: &str,
) -> Result<()> {
    let count: i64 = transaction.query_row(sql, params![entity_id, camp_id], |row| row.get(0))?;
    if count != 1 {
        anyhow::bail!(error.to_string());
    }
    Ok(())
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
        || value.chars().any(|character| character.is_control())
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

fn actor_parts(actor: &ActorRef) -> (&'static str, &str, Option<&str>) {
    match actor {
        ActorRef::User { user_id } => ("user", user_id, None),
        ActorRef::Agent {
            agent_profile_id,
            source_agent_run_id,
        } => ("agent", agent_profile_id, Some(source_agent_run_id)),
        ActorRef::System { component_id } => ("system", component_id, None),
    }
}

fn append_domain_event(
    transaction: &Transaction<'_>,
    event_type: &str,
    camp_id: &str,
    entity: (&str, &str),
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    payload: &Value,
) -> Result<()> {
    let (actor_type, actor_id, source_agent_run_id) = actor_parts(actor);
    transaction.execute(
        r#"
        INSERT INTO event_log(
            event_id, task_id, turn_id, sequence, event_type, native_method,
            payload_json, camp_id, entity_type, entity_id,
            actor_type, actor_id, source_agent_run_id, execution_epoch, created_at
        ) VALUES (?1, NULL, NULL, NULL, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            Uuid::new_v4().to_string(),
            event_type,
            serde_json::to_string(payload)?,
            camp_id,
            entity.0,
            entity.1,
            actor_type,
            actor_id,
            source_agent_run_id,
            execution_epoch,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::{
        collaboration::{
            AcceptanceCriterionInput, AddCampMemberCommand, CollaborationService,
            CreateCampCommand, CreateTaskCommand, MessageAddressSpec, SendCampMessageCommand,
        },
        command::CommandResultStatus,
    };

    struct Fixture {
        database: Database,
        directory: PathBuf,
        camp_id: String,
        camp_message_id: String,
    }

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn fixture() -> Fixture {
        let directory =
            std::env::temp_dir().join(format!("lumen-evidence-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "evidence-create-camp",
                    None,
                    CreateCampCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        repository: None,
                    },
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "evidence-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_profile_id: "agent-muwa".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        let message = collaboration
            .send_camp_message(
                &mut database,
                &user_envelope(
                    "evidence-camp-message",
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: "公开验收证据".to_string(),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        Fixture {
            database,
            directory,
            camp_id,
            camp_message_id: message.result.payload["campMessageId"]
                .as_str()
                .unwrap()
                .to_string(),
        }
    }

    fn create_task(fixture: &mut Fixture, command_id: &str, dedup_key: &str) -> String {
        let result = CollaborationService::default()
            .create_task(
                &mut fixture.database,
                &user_envelope(
                    command_id,
                    Some(&fixture.camp_id),
                    CreateTaskCommand {
                        camp_id: fixture.camp_id.clone(),
                        title: "Evidence task".to_string(),
                        objective: "Prove the result".to_string(),
                        acceptance_criteria: vec![AcceptanceCriterionInput {
                            id: "criterion-1".to_string(),
                            text: "Public evidence exists".to_string(),
                        }],
                        assignee_agent_id: "agent-muwa".to_string(),
                        source_message_id: Some(fixture.camp_message_id.clone()),
                        origin_task_id: None,
                        dedup_key: Some(dedup_key.to_string()),
                    },
                ),
            )
            .unwrap();
        result.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn managed_blobs_deduplicate_detect_corruption_and_keep_attachment_roots() {
        let mut fixture = fixture();
        let store = ManagedBlobStore::new(&fixture.directory);
        let first = store
            .put_reader(
                &mut fixture.database,
                &mut Cursor::new(b"stable evidence"),
                "text/plain",
                "normal",
            )
            .unwrap();
        let duplicate = store
            .put_reader(
                &mut fixture.database,
                &mut Cursor::new(b"stable evidence"),
                "text/plain",
                "normal",
            )
            .unwrap();
        assert_eq!(first.id, duplicate.id);
        let blob_count: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM managed_blob", [], |row| row.get(0))
            .unwrap();
        assert_eq!(blob_count, 1);
        let attachment = store
            .attach(
                &mut fixture.database,
                &fixture.camp_id,
                AttachmentTarget::CampMessage(&fixture.camp_message_id),
                &first.id,
                "evidence.txt",
                &ActorRef::User {
                    user_id: "local-user".to_string(),
                },
            )
            .unwrap();
        assert_eq!(attachment.blob_id, first.id);

        let orphan = store
            .put_reader(
                &mut fixture.database,
                &mut Cursor::new(b"orphan"),
                "text/plain",
                "normal",
            )
            .unwrap();
        let collected = store
            .collect_unreferenced_before(
                &mut fixture.database,
                &(chrono::Utc::now() + chrono::Duration::seconds(5)).to_rfc3339(),
            )
            .unwrap();
        assert_eq!(collected, vec![orphan.id]);

        let blob_path = store.root.join(blob_relative_path(&first.sha256));
        fs::write(&blob_path, b"tampered").unwrap();
        assert!(!store.verify(&mut fixture.database, &first.id).unwrap());
        let state: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT state FROM managed_blob WHERE id = ?1",
                [&first.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "corrupt");
        drop(fixture.database);
        fs::remove_dir_all(fixture.directory).unwrap();
    }

    #[test]
    fn task_completion_persists_criterion_to_stable_evidence_mapping() {
        let mut fixture = fixture();
        let task_id = create_task(&mut fixture, "evidence-create-task", "evidence-task");
        let command = user_envelope(
            "complete-evidence-task",
            Some(&fixture.camp_id),
            CompleteTaskCommand {
                task_id: task_id.clone(),
                expected_version: 1,
                semantic_attestation: true,
                criterion_evidence: vec![CriterionEvidenceInput {
                    criterion_id: "criterion-1".to_string(),
                    references: vec![EntityReference {
                        entity_type: "camp_message".to_string(),
                        entity_id: fixture.camp_message_id.clone(),
                    }],
                }],
            },
        );
        let result = EvidenceService::default()
            .complete_task(&mut fixture.database, &command)
            .unwrap();
        assert_eq!(result.result.status, CommandResultStatus::Applied);
        let (status, binding_count, event_sequence): (String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT task.status,
                       (SELECT COUNT(*) FROM task_evidence_binding
                        WHERE task_evidence_binding.task_id = task.id),
                       (SELECT global_sequence FROM event_log
                        WHERE event_type = 'task.completed'
                          AND entity_id = task.id)
                FROM task WHERE task.id = ?1
                "#,
                [&task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(binding_count, 1);
        assert!(event_sequence > 0);

        let invalid_task = create_task(
            &mut fixture,
            "evidence-create-invalid-task",
            "invalid-evidence-task",
        );
        let invalid = EvidenceService::default()
            .complete_task(
                &mut fixture.database,
                &user_envelope(
                    "complete-invalid-task",
                    Some(&fixture.camp_id),
                    CompleteTaskCommand {
                        task_id: invalid_task.clone(),
                        expected_version: 1,
                        semantic_attestation: true,
                        criterion_evidence: vec![CriterionEvidenceInput {
                            criterion_id: "criterion-1".to_string(),
                            references: vec![EntityReference {
                                entity_type: "conversation_message".to_string(),
                                entity_id: "private-message".to_string(),
                            }],
                        }],
                    },
                ),
            )
            .unwrap();
        assert_eq!(invalid.result.status, CommandResultStatus::Rejected);
        let invalid_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM task WHERE id = ?1",
                [&invalid_task],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(invalid_status, "pending");
        drop(fixture.database);
        fs::remove_dir_all(fixture.directory).unwrap();
    }
}
