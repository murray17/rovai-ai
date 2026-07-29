use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::Database;

const MAX_PENDING_EXECUTION_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingExecutionIntentStatus {
    Pending,
    Resolving,
    Failed,
    Cancelled,
    Consumed,
}

impl TryFrom<&str> for PendingExecutionIntentStatus {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "resolving" => Ok(Self::Resolving),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "consumed" => Ok(Self::Consumed),
            _ => anyhow::bail!("invalid Pending Execution Intent status"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingExecutionIntent {
    pub id: String,
    pub request_method: String,
    pub camp_id: Option<String>,
    pub payload_json: String,
    pub dispatch_digest: String,
    pub status: PendingExecutionIntentStatus,
    pub diagnostic_code: Option<String>,
    pub job_id: String,
    pub job_status: String,
    pub attempt_count: i64,
    pub retry_after: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingExecutionIntentView {
    pub id: String,
    pub request_method: String,
    pub camp_id: Option<String>,
    pub status: PendingExecutionIntentStatus,
    pub diagnostic_code: Option<String>,
    pub attempt_count: i64,
    pub retry_after: Option<String>,
}

impl From<&PendingExecutionIntent> for PendingExecutionIntentView {
    fn from(value: &PendingExecutionIntent) -> Self {
        Self {
            id: value.id.clone(),
            request_method: value.request_method.clone(),
            camp_id: value.camp_id.clone(),
            status: value.status.clone(),
            diagnostic_code: value.diagnostic_code.clone(),
            attempt_count: value.attempt_count,
            retry_after: value.retry_after.clone(),
        }
    }
}

#[derive(Default)]
pub struct RuntimeResolutionService;

impl RuntimeResolutionService {
    pub fn intent_id_for_command(command_id: &str) -> String {
        format!("pending-execution:{command_id}")
    }

    pub fn begin(
        &self,
        database: &mut Database,
        intent_id: &str,
        request_method: &str,
        camp_id: Option<&str>,
        payload_json: &str,
        dispatch_digest: &str,
    ) -> Result<PendingExecutionIntent> {
        validate_begin(intent_id, request_method, payload_json, dispatch_digest)?;
        let now = chrono::Utc::now().to_rfc3339();
        let job_id = format!("runtime-resolution:{intent_id}");
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO pending_execution_intent(
                id, request_method, camp_id, payload_json, dispatch_digest, status,
                diagnostic_code, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, ?6, ?6)
            "#,
            params![
                intent_id,
                request_method,
                camp_id,
                payload_json,
                dispatch_digest,
                now
            ],
        )?;
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO runtime_resolution_job(
                id, pending_execution_intent_id, status, attempt_count,
                diagnostic_code, retry_after, created_at, updated_at
            ) VALUES (?1, ?2, 'pending', 0, NULL, NULL, ?3, ?3)
            "#,
            params![job_id, intent_id, now],
        )?;
        let existing = load_intent_from_connection(&transaction, intent_id)?
            .context("Pending Execution Intent was not created")?;
        if existing.request_method != request_method
            || existing.camp_id.as_deref() != camp_id
            || existing.payload_json != payload_json
            || existing.dispatch_digest != dispatch_digest
        {
            anyhow::bail!("Pending Execution Intent ID was reused with a different request");
        }
        transaction.commit()?;
        Ok(existing)
    }

    pub fn claim(
        &self,
        database: &mut Database,
        intent_id: &str,
    ) -> Result<Option<PendingExecutionIntent>> {
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let Some(current) = load_intent_from_connection(&transaction, intent_id)? else {
            transaction.commit()?;
            return Ok(None);
        };
        if matches!(
            current.status,
            PendingExecutionIntentStatus::Cancelled | PendingExecutionIntentStatus::Consumed
        ) {
            transaction.commit()?;
            return Ok(None);
        }
        transaction.execute(
            r#"
            UPDATE pending_execution_intent
            SET status = 'resolving', diagnostic_code = NULL, updated_at = ?2
            WHERE id = ?1 AND status IN ('pending', 'resolving', 'failed')
            "#,
            params![intent_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE runtime_resolution_job
            SET status = 'running', attempt_count = attempt_count + 1,
                diagnostic_code = NULL, retry_after = NULL, updated_at = ?2
            WHERE pending_execution_intent_id = ?1
              AND status IN ('pending', 'running', 'failed', 'completed')
            "#,
            params![intent_id, now],
        )?;
        let claimed = load_intent_from_connection(&transaction, intent_id)?;
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn complete_resolution(&self, database: &mut Database, intent_id: &str) -> Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE pending_execution_intent
            SET status = 'resolving', diagnostic_code = NULL, updated_at = ?2
            WHERE id = ?1 AND status = 'resolving'
            "#,
            params![intent_id, now],
        )?;
        if updated == 1 {
            transaction.execute(
                r#"
                UPDATE runtime_resolution_job
                SET status = 'completed', diagnostic_code = NULL,
                    retry_after = NULL, updated_at = ?2
                WHERE pending_execution_intent_id = ?1 AND status = 'running'
                "#,
                params![intent_id, now],
            )?;
        }
        transaction.commit()?;
        Ok(updated == 1)
    }

    pub fn fail(
        &self,
        database: &mut Database,
        intent_id: &str,
        diagnostic_code: &str,
        retry_after: Option<&str>,
    ) -> Result<Option<PendingExecutionIntentView>> {
        validate_diagnostic_code(diagnostic_code)?;
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE pending_execution_intent
            SET status = 'failed', diagnostic_code = ?2, updated_at = ?3
            WHERE id = ?1 AND status IN ('pending', 'resolving', 'failed')
            "#,
            params![intent_id, diagnostic_code, now],
        )?;
        if updated == 1 {
            transaction.execute(
                r#"
                UPDATE runtime_resolution_job
                SET status = 'failed', diagnostic_code = ?2,
                    retry_after = ?3, updated_at = ?4
                WHERE pending_execution_intent_id = ?1
                  AND status IN ('pending', 'running', 'failed', 'completed')
                "#,
                params![intent_id, diagnostic_code, retry_after, now],
            )?;
        }
        let intent = load_intent_from_connection(&transaction, intent_id)?;
        transaction.commit()?;
        Ok(intent.as_ref().map(PendingExecutionIntentView::from))
    }

    pub fn consume(&self, database: &mut Database, intent_id: &str) -> Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        let updated = database.connection_mut().execute(
            r#"
            UPDATE pending_execution_intent
            SET status = 'consumed', diagnostic_code = NULL, updated_at = ?2
            WHERE id = ?1 AND status = 'resolving'
            "#,
            params![intent_id, now],
        )?;
        Ok(updated == 1)
    }

    pub fn cancel(
        &self,
        database: &mut Database,
        intent_id: &str,
    ) -> Result<Option<PendingExecutionIntentView>> {
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        transaction.execute(
            r#"
            UPDATE pending_execution_intent
            SET status = 'cancelled', diagnostic_code = 'execution_cancelled',
                updated_at = ?2
            WHERE id = ?1 AND status IN ('pending', 'resolving', 'failed')
            "#,
            params![intent_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE runtime_resolution_job
            SET status = 'cancelled', diagnostic_code = 'execution_cancelled',
                retry_after = NULL, updated_at = ?2
            WHERE pending_execution_intent_id = ?1
              AND status IN ('pending', 'running', 'failed', 'completed')
            "#,
            params![intent_id, now],
        )?;
        let intent = load_intent_from_connection(&transaction, intent_id)?;
        transaction.commit()?;
        Ok(intent.as_ref().map(PendingExecutionIntentView::from))
    }

    pub fn get(
        &self,
        database: &Database,
        intent_id: &str,
    ) -> Result<Option<PendingExecutionIntent>> {
        load_intent_from_connection(database.connection(), intent_id)
    }

    pub fn recoverable(
        &self,
        database: &Database,
        limit: usize,
    ) -> Result<Vec<PendingExecutionIntent>> {
        if !(1..=100).contains(&limit) {
            anyhow::bail!("Pending Execution recovery limit must be between 1 and 100");
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut statement = database.connection().prepare(
            r#"
            SELECT intent.id
            FROM pending_execution_intent AS intent
            JOIN runtime_resolution_job AS job
              ON job.pending_execution_intent_id = intent.id
            WHERE (
                    intent.status IN ('pending', 'resolving')
                    AND job.status IN ('pending', 'running', 'completed')
                  )
               OR (
                    intent.status = 'failed'
                    AND job.status = 'failed'
                    AND job.retry_after IS NOT NULL
                    AND job.retry_after <= ?2
                  )
            ORDER BY intent.created_at, intent.id
            LIMIT ?1
            "#,
        )?;
        let ids = statement
            .query_map(params![limit as i64, now], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| {
                load_intent_from_connection(database.connection(), &id)?
                    .context("recoverable Pending Execution Intent disappeared")
            })
            .collect()
    }
}

fn load_intent_from_connection(
    connection: &rusqlite::Connection,
    intent_id: &str,
) -> Result<Option<PendingExecutionIntent>> {
    connection
        .query_row(
            r#"
            SELECT intent.id, intent.request_method, intent.camp_id,
                   intent.payload_json, intent.dispatch_digest,
                   intent.status, intent.diagnostic_code,
                   job.id, job.status, job.attempt_count, job.retry_after,
                   intent.created_at, intent.updated_at
            FROM pending_execution_intent AS intent
            JOIN runtime_resolution_job AS job
              ON job.pending_execution_intent_id = intent.id
            WHERE intent.id = ?1
            "#,
            [intent_id],
            |row| {
                let status = row.get::<_, String>(5)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    status,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                id,
                request_method,
                camp_id,
                payload_json,
                dispatch_digest,
                status,
                diagnostic_code,
                job_id,
                job_status,
                attempt_count,
                retry_after,
                created_at,
                updated_at,
            )| {
                Ok(PendingExecutionIntent {
                    id,
                    request_method,
                    camp_id,
                    payload_json,
                    dispatch_digest,
                    status: PendingExecutionIntentStatus::try_from(status.as_str())?,
                    diagnostic_code,
                    job_id,
                    job_status,
                    attempt_count,
                    retry_after,
                    created_at,
                    updated_at,
                })
            },
        )
        .transpose()
}

fn validate_begin(
    intent_id: &str,
    request_method: &str,
    payload_json: &str,
    dispatch_digest: &str,
) -> Result<()> {
    if intent_id.trim().is_empty() || intent_id.len() > 256 {
        anyhow::bail!("Pending Execution Intent ID must be 1-256 characters");
    }
    if request_method != "camp.messages.send" {
        anyhow::bail!("Pending Execution request method is unsupported");
    }
    if payload_json.len() > MAX_PENDING_EXECUTION_PAYLOAD_BYTES {
        anyhow::bail!("Pending Execution request exceeds the persisted input limit");
    }
    serde_json::from_str::<serde_json::Value>(payload_json)
        .context("Pending Execution request payload is invalid JSON")?;
    if dispatch_digest.len() != 64 || !dispatch_digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        anyhow::bail!("Pending Execution dispatch digest is invalid");
    }
    Ok(())
}

fn validate_diagnostic_code(value: &str) -> Result<()> {
    if value.trim().is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        anyhow::bail!("Pending Execution diagnostic code is invalid");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dispatch_digest() -> String {
        "a".repeat(64)
    }

    #[test]
    fn intent_is_idempotent_and_cancellation_fences_consumption() {
        let data = std::env::temp_dir().join(format!(
            "rovai-runtime-resolution-test-{}",
            uuid::Uuid::new_v4()
        ));
        let mut database = Database::open(&data).unwrap();
        let service = RuntimeResolutionService;
        let payload = r#"{"commandId":"command-1","body":"hello"}"#;
        let first = service
            .begin(
                &mut database,
                "pending-execution:command-1",
                "camp.messages.send",
                None,
                payload,
                &dispatch_digest(),
            )
            .unwrap();
        let replay = service
            .begin(
                &mut database,
                "pending-execution:command-1",
                "camp.messages.send",
                None,
                payload,
                &dispatch_digest(),
            )
            .unwrap();
        assert_eq!(first.id, replay.id);
        assert_eq!(
            service
                .claim(&mut database, &first.id)
                .unwrap()
                .unwrap()
                .attempt_count,
            1
        );
        let cancelled = service.cancel(&mut database, &first.id).unwrap().unwrap();
        assert_eq!(cancelled.status, PendingExecutionIntentStatus::Cancelled);
        assert!(
            !service
                .complete_resolution(&mut database, &first.id)
                .unwrap()
        );
        assert!(!service.consume(&mut database, &first.id).unwrap());
        drop(database);
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn recoverable_intents_survive_database_reopen() {
        let data = std::env::temp_dir().join(format!(
            "rovai-runtime-resolution-reopen-test-{}",
            uuid::Uuid::new_v4()
        ));
        let intent_id = "pending-execution:command-2";
        {
            let mut database = Database::open(&data).unwrap();
            RuntimeResolutionService
                .begin(
                    &mut database,
                    intent_id,
                    "camp.messages.send",
                    None,
                    r#"{"commandId":"command-2"}"#,
                    &dispatch_digest(),
                )
                .unwrap();
            RuntimeResolutionService
                .claim(&mut database, intent_id)
                .unwrap();
        }
        let database = Database::open(&data).unwrap();
        let recovered = RuntimeResolutionService.recoverable(&database, 10).unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, intent_id);
        assert_eq!(recovered[0].status, PendingExecutionIntentStatus::Resolving);
        drop(database);
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn failed_intents_become_recoverable_only_after_their_backoff_expires() {
        let data = std::env::temp_dir().join(format!(
            "rovai-runtime-resolution-backoff-test-{}",
            uuid::Uuid::new_v4()
        ));
        let mut database = Database::open(&data).unwrap();
        let service = RuntimeResolutionService;
        let intent_id = "pending-execution:command-backoff";
        service
            .begin(
                &mut database,
                intent_id,
                "camp.messages.send",
                None,
                r#"{"commandId":"command-backoff"}"#,
                &dispatch_digest(),
            )
            .unwrap();
        service.claim(&mut database, intent_id).unwrap();
        let future = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
        service
            .fail(
                &mut database,
                intent_id,
                "runtime_resolution_unavailable",
                Some(&future),
            )
            .unwrap();
        assert!(service.recoverable(&database, 10).unwrap().is_empty());

        let past = (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE runtime_resolution_job
                SET retry_after = ?2
                WHERE pending_execution_intent_id = ?1
                "#,
                params![intent_id, past],
            )
            .unwrap();
        let recoverable = service.recoverable(&database, 10).unwrap();
        assert_eq!(recoverable.len(), 1);
        assert_eq!(recoverable[0].id, intent_id);
        drop(database);
        std::fs::remove_dir_all(data).unwrap();
    }
}
