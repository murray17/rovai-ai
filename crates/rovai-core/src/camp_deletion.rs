use anyhow::{Context, Result, ensure};
use chrono::{Duration, Utc};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    camp_attachment_view::{PreparedThreadAttachmentCleanup, ThreadAttachmentViewStore},
    collaboration::{
        DeleteThreadCommand, MissionWorkspaceDisposition, append_domain_event,
        delete_camp_aggregate,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    runtime::ExecutionRuntimeService,
};

const AUTOMATIC_RETRY_LIMIT: i64 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ThreadDeletionCandidate {
    pub camp_id: String,
    pub operation_id: String,
    pub requested_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ThreadDeletionCleanupCandidate {
    pub cleanup: PreparedThreadAttachmentCleanup,
    pub queued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadDeletionIssue {
    pub operation_id: String,
    pub attention_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RetryThreadDeletionCommand {
    pub operation_id: String,
}

impl sealed::Sealed for RetryThreadDeletionCommand {}
impl DomainCommand for RetryThreadDeletionCommand {
    const TYPE: &'static str = "camp.deletion.retry";
    const ALLOWED_WHILE_CAMP_DELETING: bool = true;
}

#[derive(Debug, Default)]
pub(crate) struct ThreadDeletionService {
    gateway: DomainCommandGateway,
}

impl ThreadDeletionService {
    pub(crate) fn accept(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteThreadCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.delete_user_required",
                    "Only a User can permanently delete a Camp",
                ));
            }
            if let Some((operation_id, accepted_at)) =
                existing_operation(transaction, &envelope.payload.camp_id)?
            {
                return Ok(accepted_result(
                    &envelope.payload.camp_id,
                    &operation_id,
                    &accepted_at,
                    false,
                ));
            }

            let version = transaction
                .query_row(
                    "SELECT version FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": version }),
                ));
            }
            if envelope.payload.workspace_disposition == MissionWorkspaceDisposition::Retain {
                let cleanup_running: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM mission_workspace WHERE camp_id=?1 AND state='cleanup_pending' AND NOT (cleanup_worktree_removed=1 AND cleanup_branch_removed=1))",
                    [&envelope.payload.camp_id],
                    |row| row.get(0),
                )?;
                if cleanup_running {
                    return Ok(CommandHandlerResult::rejected(
                        "camp.workspace_cleanup_pending",
                        json!({ "campId": envelope.payload.camp_id }),
                    ));
                }
            }

            let now = Utc::now().to_rfc3339();
            ExecutionRuntimeService::default().settle_camp_deletion_cutover_in_transaction(
                transaction,
                &envelope.payload.camp_id,
                &envelope.command_id,
            )?;
            transaction.execute(
                "DELETE FROM mission_workspace WHERE camp_id=?1 AND cleanup_worktree_removed=1 AND cleanup_branch_removed=1",
                [&envelope.payload.camp_id],
            )?;
            let workspace_cleanup_scheduled = match envelope.payload.workspace_disposition {
                MissionWorkspaceDisposition::Cleanup => transaction.execute(
                    "UPDATE mission_workspace SET generation=generation+CASE WHEN state='ready' THEN 1 ELSE 0 END,state='cleanup_pending',cleanup_command_id=?2,diagnostic=NULL,updated_at=?3 WHERE camp_id=?1 AND NOT (cleanup_worktree_removed=1 AND cleanup_branch_removed=1)",
                    params![envelope.payload.camp_id, envelope.command_id, now],
                )?,
                MissionWorkspaceDisposition::Retain => {
                    transaction.execute(
                        "UPDATE mission_workspace SET state='ready',cleanup_command_id=NULL,diagnostic=NULL,updated_at=?2 WHERE camp_id=?1 AND state IN ('cleanup_pending','cleanup_failed') AND NOT (cleanup_worktree_removed=1 AND cleanup_branch_removed=1)",
                        params![envelope.payload.camp_id, now],
                    )?;
                    0
                }
            };
            let changed = transaction.execute(
                r#"
                UPDATE camp
                SET deletion_operation_id = ?2,
                    deletion_requested_at = ?3,
                    deletion_attempt_count = 0,
                    deletion_next_attempt_at = ?3,
                    deletion_last_error_code = NULL,
                    deletion_attention_required = 0,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1 AND deletion_operation_id IS NULL
                "#,
                params![envelope.payload.camp_id, envelope.command_id, now],
            )?;
            ensure!(changed == 1, "Camp deletion cutover lost its serialized admission");
            Ok(accepted_result(
                &envelope.payload.camp_id,
                &envelope.command_id,
                &now,
                workspace_cleanup_scheduled > 0,
            ))
        })
    }

    pub(crate) fn retry(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RetryThreadDeletionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.deletion_retry_user_required",
                    "Only a User can retry Camp deletion",
                ));
            }
            Uuid::parse_str(&envelope.payload.operation_id)
                .context("Camp deletion operationId must be a UUID")?;
            let now = Utc::now().to_rfc3339();
            let camp_changed = transaction.execute(
                r#"
                UPDATE camp
                SET deletion_attempt_count = 0,
                    deletion_next_attempt_at = ?2,
                    deletion_last_error_code = NULL,
                    deletion_attention_required = 0,
                    updated_at = ?2
                WHERE deletion_operation_id = ?1
                "#,
                params![envelope.payload.operation_id, now],
            )?;
            let cleanup_changed = transaction.execute(
                r#"
                UPDATE camp_attachment_view_operation
                SET deletion_attempt_count = 0,
                    deletion_next_attempt_at = ?2,
                    deletion_attention_required = 0,
                    error_code = NULL,
                    updated_at = ?2
                WHERE kind = 'camp_delete_cleanup'
                  AND command_id = ?1
                  AND status NOT IN ('completed', 'rolled_back')
                "#,
                params![envelope.payload.operation_id, now],
            )?;
            if cleanup_changed > 0 {
                transaction.execute(
                    r#"
                    UPDATE mission_workspace
                    SET state = 'cleanup_pending', diagnostic = NULL, updated_at = ?2
                    WHERE cleanup_command_id = ?1
                      AND state = 'cleanup_failed'
                      AND NOT (cleanup_worktree_removed = 1 AND cleanup_branch_removed = 1)
                    "#,
                    params![envelope.payload.operation_id, now],
                )?;
            }
            let completed: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM camp_attachment_view_operation WHERE kind='camp_delete_cleanup' AND command_id=?1 AND status='completed')",
                [&envelope.payload.operation_id],
                |row| row.get(0),
            )?;
            if camp_changed == 0 && cleanup_changed == 0 && !completed {
                return Ok(rejected(
                    "camp.deletion_not_found",
                    "Camp deletion operation does not exist",
                ));
            }
            Ok(CommandHandlerResult::applied(
                "camp.deletion_retry_accepted",
                json!({
                    "operationId": envelope.payload.operation_id,
                    "completed": completed,
                }),
                Some(EntityReference {
                    entity_type: "camp_deletion".to_string(),
                    entity_id: envelope.payload.operation_id.clone(),
                }),
            ))
        })
    }

    pub(crate) fn deleting_camp_ids(&self, database: &Database) -> Result<Vec<String>> {
        let mut statement = database.connection().prepare(
            "SELECT id FROM camp WHERE deletion_operation_id IS NOT NULL ORDER BY deletion_requested_at, id",
        )?;
        Ok(statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub(crate) fn due_camps(
        &self,
        database: &Database,
        limit: i64,
    ) -> Result<Vec<ThreadDeletionCandidate>> {
        ensure!(
            (1..=32).contains(&limit),
            "Camp deletion batch limit is invalid"
        );
        let now = Utc::now().to_rfc3339();
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, deletion_operation_id, deletion_requested_at
            FROM camp
            WHERE deletion_operation_id IS NOT NULL
              AND deletion_attention_required = 0
              AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at <= ?1)
            ORDER BY deletion_requested_at, id
            LIMIT ?2
            "#,
        )?;
        Ok(statement
            .query_map(params![now, limit], |row| {
                Ok(ThreadDeletionCandidate {
                    camp_id: row.get(0)?,
                    operation_id: row.get(1)?,
                    requested_at: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub(crate) fn due_cleanups(
        &self,
        database: &Database,
        limit: i64,
    ) -> Result<Vec<ThreadDeletionCleanupCandidate>> {
        ensure!(
            (1..=32).contains(&limit),
            "Camp cleanup batch limit is invalid"
        );
        let now = Utc::now().to_rfc3339();
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, camp_id, command_id, created_at
            FROM camp_attachment_view_operation
            WHERE kind = 'camp_delete_cleanup'
              AND status IN ('committed', 'recovery_required')
              AND deletion_attention_required = 0
              AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at <= ?1)
            ORDER BY created_at, id
            LIMIT ?2
            "#,
        )?;
        Ok(statement
            .query_map(params![now, limit], |row| {
                Ok(ThreadDeletionCleanupCandidate {
                    cleanup: PreparedThreadAttachmentCleanup {
                        operation_id: row.get(0)?,
                        camp_id: row.get(1)?,
                        command_id: row.get(2)?,
                    },
                    queued_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub(crate) fn record_camp_failure(
        &self,
        database: &Database,
        candidate: &ThreadDeletionCandidate,
        error_code: &str,
    ) -> Result<bool> {
        let attempts: i64 = database.connection().query_row(
            "SELECT deletion_attempt_count + 1 FROM camp WHERE id=?1 AND deletion_operation_id=?2",
            params![candidate.camp_id, candidate.operation_id],
            |row| row.get(0),
        )?;
        let attention = attempts >= AUTOMATIC_RETRY_LIMIT;
        let now = Utc::now();
        let next = (!attention).then(|| (now + retry_delay(attempts)).to_rfc3339());
        let changed = database.connection().execute(
            r#"
            UPDATE camp
            SET deletion_attempt_count = ?3,
                deletion_next_attempt_at = ?4,
                deletion_last_error_code = ?5,
                deletion_attention_required = ?6,
                deletion_attention_revision = deletion_attention_revision
                    + CASE WHEN ?6 = 1 AND deletion_attention_required = 0 THEN 1 ELSE 0 END,
                updated_at = ?7
            WHERE id = ?1 AND deletion_operation_id = ?2
            "#,
            params![
                candidate.camp_id,
                candidate.operation_id,
                attempts,
                next,
                error_code,
                if attention { 1_i64 } else { 0_i64 },
                now.to_rfc3339(),
            ],
        )?;
        ensure!(changed == 1, "Camp deletion failure target changed");
        Ok(attention)
    }

    pub(crate) fn record_cleanup_failure(
        &self,
        database: &mut Database,
        cleanup: &PreparedThreadAttachmentCleanup,
        error_code: &str,
    ) -> Result<bool> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let attempts: i64 = transaction.query_row(
            "SELECT deletion_attempt_count + 1 FROM camp_attachment_view_operation WHERE id=?1 AND command_id=?2",
            params![cleanup.operation_id, cleanup.command_id],
            |row| row.get(0),
        )?;
        let attention = attempts >= AUTOMATIC_RETRY_LIMIT;
        let now = Utc::now();
        let next = (!attention).then(|| (now + retry_delay(attempts)).to_rfc3339());
        let changed = transaction.execute(
            r#"
            UPDATE camp_attachment_view_operation
            SET deletion_attempt_count = ?3,
                deletion_next_attempt_at = ?4,
                error_code = ?5,
                deletion_attention_required = ?6,
                deletion_attention_revision = deletion_attention_revision
                    + CASE WHEN ?6 = 1 AND deletion_attention_required = 0 THEN 1 ELSE 0 END,
                updated_at = ?7
            WHERE id = ?1 AND command_id = ?2
              AND kind = 'camp_delete_cleanup'
              AND status NOT IN ('completed', 'rolled_back')
            "#,
            params![
                cleanup.operation_id,
                cleanup.command_id,
                attempts,
                next,
                error_code,
                if attention { 1_i64 } else { 0_i64 },
                now.to_rfc3339(),
            ],
        )?;
        ensure!(changed == 1, "Camp cleanup failure target changed");
        if !attention {
            transaction.execute(
                r#"
                UPDATE mission_workspace
                SET state = 'cleanup_pending', diagnostic = NULL, updated_at = ?3
                WHERE camp_id = ?1 AND cleanup_command_id = ?2
                  AND state = 'cleanup_failed'
                  AND NOT (cleanup_worktree_removed = 1 AND cleanup_branch_removed = 1)
                "#,
                params![cleanup.camp_id, cleanup.command_id, now.to_rfc3339()],
            )?;
        }
        transaction.commit()?;
        Ok(attention)
    }

    pub(crate) fn commit_business_delete(
        &self,
        database: &mut Database,
        attachment_views: &ThreadAttachmentViewStore,
        candidate: &ThreadDeletionCandidate,
        cleanup: &PreparedThreadAttachmentCleanup,
    ) -> Result<()> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let marker: Option<String> = transaction
            .query_row(
                "SELECT deletion_operation_id FROM camp WHERE id=?1",
                [&candidate.camp_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        ensure!(
            marker.as_deref() == Some(candidate.operation_id.as_str()),
            "Camp deletion marker changed before business commit"
        );
        let unconfirmed = unconfirmed_runtime_cleanup_count(&transaction, &candidate.camp_id)?;
        ensure!(
            unconfirmed == 0,
            "Camp execution cleanup is unconfirmed; deletion remains fenced"
        );
        let workspace_cleanup_scheduled =
            workspace_cleanup_scheduled(&transaction, &candidate.operation_id)?
                .context("Camp deletion acceptance receipt is missing")?;
        if !workspace_cleanup_scheduled {
            // A retained Mission worktree is deliberately outside deletion
            // ownership. Drop its internal cleanup journal before the legacy
            // Camp-delete trigger can turn it into cleanup work.
            transaction.execute(
                "DELETE FROM mission_workspace WHERE camp_id = ?1",
                [&candidate.camp_id],
            )?;
        }
        attachment_views.commit_camp_delete_cleanup_in_transaction(&transaction, cleanup)?;
        delete_camp_aggregate(&transaction, &candidate.camp_id)?;
        append_domain_event(
            &transaction,
            "camp.deleted",
            Some(&candidate.camp_id),
            Some(("camp_deletion", &candidate.operation_id)),
            &ActorRef::System {
                component_id: "camp-deletion-coordinator".to_string(),
            },
            None,
            &json!({
                "campId": candidate.camp_id,
                "operationId": candidate.operation_id,
            }),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn issues(&self, database: &Database) -> Result<Vec<ThreadDeletionIssue>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT operation_id, MAX(attention_revision)
            FROM (
                SELECT deletion_operation_id AS operation_id,
                       deletion_attention_revision AS attention_revision
                FROM camp
                WHERE deletion_operation_id IS NOT NULL
                  AND deletion_attention_required = 1
                UNION ALL
                SELECT command_id AS operation_id,
                       deletion_attention_revision AS attention_revision
                FROM camp_attachment_view_operation
                WHERE kind = 'camp_delete_cleanup'
                  AND status NOT IN ('completed', 'rolled_back')
                  AND deletion_attention_required = 1
            )
            GROUP BY operation_id
            ORDER BY operation_id
            "#,
        )?;
        Ok(statement
            .query_map([], |row| {
                Ok(ThreadDeletionIssue {
                    operation_id: row.get(0)?,
                    attention_revision: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }
}

pub(crate) fn workspace_cleanup_scheduled(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<bool>> {
    let scheduled = connection
        .query_row(
            r#"
            SELECT COALESCE(
                json_extract(result_payload_json, '$.workspaceCleanupScheduled'),
                0
            )
            FROM event_log
            WHERE command_id = ?1
              AND command_type = 'camp.delete'
              AND result_status IN ('accepted','applied')
            "#,
            [operation_id],
            |row| row.get(0),
        )
        .optional()?;
    if scheduled.is_none() {
        let asynchronous_handoff: bool = connection.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM event_log
                WHERE event_type='camp.deleted'
                  AND entity_type='camp_deletion'
                  AND entity_id=?1
            )
            "#,
            [operation_id],
            |row| row.get(0),
        )?;
        ensure!(
            !asynchronous_handoff,
            "Camp deletion acceptance receipt is missing"
        );
    }
    Ok(scheduled)
}

fn accepted_result(
    camp_id: &str,
    operation_id: &str,
    accepted_at: &str,
    workspace_cleanup_scheduled: bool,
) -> CommandHandlerResult {
    CommandHandlerResult::accepted(
        "camp.delete_accepted",
        json!({
            "campId": camp_id,
            "operationId": operation_id,
            "acceptedAt": accepted_at,
            "workspaceCleanupScheduled": workspace_cleanup_scheduled,
        }),
        Some(EntityReference {
            entity_type: "camp_deletion".to_string(),
            entity_id: operation_id.to_string(),
        }),
    )
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn existing_operation(connection: &Connection, camp_id: &str) -> Result<Option<(String, String)>> {
    if let Some(found) = connection
        .query_row(
            r#"
            SELECT deletion_operation_id, deletion_requested_at
            FROM camp
            WHERE id=?1 AND deletion_operation_id IS NOT NULL
            "#,
            [camp_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    {
        return Ok(Some(found));
    }
    let receipt = connection
        .query_row(
            r#"
            SELECT result_payload_json, created_at
            FROM event_log
            WHERE camp_id=?1
              AND event_type='command.result'
              AND command_type='camp.delete'
              AND result_status='accepted'
            ORDER BY created_at, global_sequence
            LIMIT 1
            "#,
            [camp_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    receipt
        .map(|(payload, created_at)| {
            let payload: Value = serde_json::from_str(&payload)
                .context("Camp deletion receipt payload is invalid")?;
            let operation_id = payload
                .get("operationId")
                .and_then(Value::as_str)
                .context("Camp deletion receipt has no operationId")?;
            Ok((operation_id.to_string(), created_at))
        })
        .transpose()
}

fn unconfirmed_runtime_cleanup_count(connection: &Connection, camp_id: &str) -> Result<i64> {
    Ok(connection.query_row(
        r#"
        SELECT COUNT(*)
        FROM (
            SELECT agent_run.id
            FROM agent_run
            WHERE agent_run.invocation_kind = 'batch'
              AND agent_run.camp_id = ?1
              AND agent_run.cancel_requested_at IS NOT NULL
              AND agent_run.cancel_acknowledged_at IS NULL
            UNION ALL
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE agent_run.invocation_kind IS NOT 'batch'
              AND camp_turn.camp_id = ?1
              AND agent_run.cancel_requested_at IS NOT NULL
              AND agent_run.cancel_acknowledged_at IS NULL
        )
        "#,
        [camp_id],
        |row| row.get(0),
    )?)
}

fn retry_delay(attempt: i64) -> Duration {
    Duration::seconds(match attempt {
        0 | 1 => 1,
        2 => 2,
        3 => 5,
        _ => 15,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{camp_attachment::insert_test_camp, command::CommandResultStatus};

    fn deletion_envelope(
        command_id: String,
        camp_id: &str,
        expected_version: i64,
    ) -> CommandEnvelope<DeleteThreadCommand> {
        CommandEnvelope {
            command_id,
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: DeleteThreadCommand {
                camp_id: camp_id.to_string(),
                expected_version,
                force: true,
                workspace_disposition: MissionWorkspaceDisposition::Retain,
            },
        }
    }

    #[test]
    fn deletion_retry_delay_is_bounded() {
        assert_eq!(retry_delay(1).num_seconds(), 1);
        assert_eq!(retry_delay(2).num_seconds(), 2);
        assert_eq!(retry_delay(3).num_seconds(), 5);
        assert_eq!(retry_delay(99).num_seconds(), 15);
    }

    #[test]
    fn accepted_receipt_and_operation_survive_the_camp_aggregate() {
        let directory =
            std::env::temp_dir().join(format!("rovai-camp-deletion-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = crate::camp_id::ThreadId::new().to_string();
        insert_test_camp(&database, &camp_id);
        let operation_id = Uuid::new_v4().to_string();
        let envelope = deletion_envelope(operation_id.clone(), &camp_id, 1);

        let accepted = ThreadDeletionService::default()
            .accept(&mut database, &envelope)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(accepted.result.payload["operationId"], operation_id);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT deletion_operation_id FROM camp WHERE id=?1",
                    [&camp_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            operation_id
        );

        let transaction = database.connection_mut().transaction().unwrap();
        delete_camp_aggregate(&transaction, &camp_id).unwrap();
        transaction.commit().unwrap();

        let replay = ThreadDeletionService::default()
            .accept(&mut database, &envelope)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result.status, CommandResultStatus::Accepted);
        assert_eq!(replay.result.payload["operationId"], operation_id);

        let duplicate = ThreadDeletionService::default()
            .accept(
                &mut database,
                &deletion_envelope(Uuid::new_v4().to_string(), &camp_id, 999),
            )
            .unwrap();
        assert_eq!(duplicate.result.status, CommandResultStatus::Accepted);
        assert_eq!(duplicate.result.payload["operationId"], operation_id);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn accepted_deletion_adopts_an_existing_mission_cleanup() {
        let directory =
            std::env::temp_dir().join(format!("rovai-camp-deletion-mission-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let camp_id = crate::camp_id::ThreadId::new().to_string();
        insert_test_camp(&database, &camp_id);
        let host_id: String = database
            .connection()
            .query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "INSERT INTO mission(id,number,camp_id,title,description,status,tags_json,source_attachments_json,created_at,updated_at) VALUES('mission-delete-adopt',1,?1,'cleanup','','not_started','[]','[]','created','updated')",
                [&camp_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,state,cleanup_command_id,created_at,updated_at) VALUES('workspace-delete-adopt','mission-delete-adopt',?1,?2,'/repo','/repo','/repo/.git','/worktree','/worktree','main','rovai/mission/001','base','owner','cleanup_pending','prior-cleanup-command','created','updated')",
                params![camp_id, host_id],
            )
            .unwrap();
        let operation_id = Uuid::new_v4().to_string();
        let mut envelope = deletion_envelope(operation_id.clone(), &camp_id, 1);
        envelope.payload.workspace_disposition = MissionWorkspaceDisposition::Cleanup;

        let accepted = ThreadDeletionService::default()
            .accept(&mut database, &envelope)
            .unwrap();

        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(accepted.result.payload["workspaceCleanupScheduled"], true);
        assert!(
            workspace_cleanup_scheduled(database.connection(), &operation_id).unwrap()
                == Some(true),
            "the retained acceptance receipt is the cleanup completion authority"
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT cleanup_command_id FROM mission_workspace WHERE id='workspace-delete-adopt'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            operation_id,
            "the deletion operation must own retries and completion even when cleanup was already pending",
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
