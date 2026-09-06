use std::{error::Error, fmt};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::Database;

const REQUEST_DIGEST_VERSION: i64 = 1;
pub(crate) const COMMAND_RESULT_STORAGE_MARKER_JSON: &str =
    r#"{"_rovaiStorage":"command-result-columns-v1"}"#;
const COMMAND_RESULT_STORAGE_MARKER: &str = "command-result-columns-v1";

pub(crate) mod sealed {
    pub trait Sealed {}
}

pub trait DomainCommand: sealed::Sealed + Serialize {
    const TYPE: &'static str;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActorRef {
    User {
        user_id: String,
    },
    Agent {
        agent_id: String,
        source_agent_run_id: String,
    },
    System {
        component_id: String,
    },
}

impl ActorRef {
    fn actor_type(&self) -> &'static str {
        match self {
            Self::User { .. } => "user",
            Self::Agent { .. } => "agent",
            Self::System { .. } => "system",
        }
    }

    fn actor_id(&self) -> &str {
        match self {
            Self::User { user_id } => user_id,
            Self::Agent { agent_id, .. } => agent_id,
            Self::System { component_id } => component_id,
        }
    }

    fn source_agent_run_id(&self) -> Option<&str> {
        match self {
            Self::Agent {
                source_agent_run_id,
                ..
            } => Some(source_agent_run_id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedVersion {
    pub entity_type: String,
    pub entity_id: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope<P> {
    pub command_id: String,
    pub actor: ActorRef,
    pub camp_id: Option<String>,
    pub expected_versions: Vec<ExpectedVersion>,
    pub execution_epoch: Option<i64>,
    pub payload: P,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityReference {
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandResultStatus {
    Applied,
    Accepted,
    Rejected,
}

impl CommandResultStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "applied" => Ok(Self::Applied),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            _ => anyhow::bail!("unknown persisted command result status: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHandlerResult {
    pub status: CommandResultStatus,
    pub code: String,
    pub payload: Value,
    pub result_entity: Option<EntityReference>,
}

impl CommandHandlerResult {
    pub fn applied(
        code: impl Into<String>,
        payload: Value,
        result_entity: Option<EntityReference>,
    ) -> Self {
        Self {
            status: CommandResultStatus::Applied,
            code: code.into(),
            payload,
            result_entity,
        }
    }

    pub fn rejected(code: impl Into<String>, payload: Value) -> Self {
        Self {
            status: CommandResultStatus::Rejected,
            code: code.into(),
            payload,
            result_entity: None,
        }
    }

    pub fn accepted(
        code: impl Into<String>,
        payload: Value,
        result_entity: Option<EntityReference>,
    ) -> Self {
        Self {
            status: CommandResultStatus::Accepted,
            code: code.into(),
            payload,
            result_entity,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCommandResult {
    pub command_id: String,
    pub command_type: String,
    pub request_digest: String,
    pub request_digest_version: i64,
    pub status: CommandResultStatus,
    pub code: String,
    pub payload: Value,
    pub result_entity: Option<EntityReference>,
    pub recorded_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommandExecution {
    pub result: StoredCommandResult,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandGatewayError {
    InvalidEnvelope(String),
    IdempotencyConflict { command_id: String },
}

impl fmt::Display for CommandGatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEnvelope(message) => {
                write!(formatter, "invalid command envelope: {message}")
            }
            Self::IdempotencyConflict { command_id } => {
                write!(formatter, "idempotency_conflict for command {command_id}")
            }
        }
    }
}

impl Error for CommandGatewayError {}

#[derive(Debug, Default)]
pub struct DomainCommandGateway;

impl DomainCommandGateway {
    pub fn replay_if_recorded<C>(
        &self,
        database: &Database,
        envelope: &CommandEnvelope<C>,
    ) -> Result<Option<CommandExecution>>
    where
        C: DomainCommand,
    {
        validate_envelope::<C>(envelope)?;
        let request_digest = request_digest(envelope)?;
        load_stored_result(database.connection(), &envelope.command_id)?
            .map(|result| replay_or_conflict(result, C::TYPE, &request_digest))
            .transpose()
    }

    pub fn execute<C, F>(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<C>,
        handler: F,
    ) -> Result<CommandExecution>
    where
        C: DomainCommand,
        F: FnOnce(&Transaction<'_>) -> Result<CommandHandlerResult>,
    {
        validate_envelope::<C>(envelope)?;
        let request_digest = request_digest(envelope)?;

        // Retry a failed text flush before replaying the already committed command receipt.
        crate::execution_text::flush_settled(database)?;
        if let Some(result) = load_stored_result(database.connection(), &envelope.command_id)? {
            return replay_or_conflict(result, C::TYPE, &request_digest);
        }

        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .context("failed to start domain command transaction")?;

        if let Some(result) = load_stored_result(&transaction, &envelope.command_id)? {
            transaction.commit()?;
            return replay_or_conflict(result, C::TYPE, &request_digest);
        }

        let handler_result = handler(&transaction)?;
        let recorded_at = chrono::Utc::now().to_rfc3339();
        let stored_result = StoredCommandResult {
            command_id: envelope.command_id.clone(),
            command_type: C::TYPE.to_string(),
            request_digest,
            request_digest_version: REQUEST_DIGEST_VERSION,
            status: handler_result.status,
            code: handler_result.code,
            payload: handler_result.payload,
            result_entity: handler_result.result_entity,
            recorded_at,
        };
        append_command_result(&transaction, envelope, &stored_result)?;
        transaction.commit()?;
        crate::execution_text::flush_settled(database)?;

        Ok(CommandExecution {
            result: stored_result,
            replayed: false,
        })
    }
}

fn validate_envelope<C>(envelope: &CommandEnvelope<C>) -> Result<()>
where
    C: DomainCommand,
{
    if C::TYPE.trim().is_empty() {
        return Err(CommandGatewayError::InvalidEnvelope(
            "command type must not be empty".to_string(),
        )
        .into());
    }
    if envelope.command_id.trim().is_empty() {
        return Err(CommandGatewayError::InvalidEnvelope(
            "commandId must not be empty".to_string(),
        )
        .into());
    }
    match (&envelope.actor, envelope.execution_epoch) {
        (ActorRef::Agent { .. }, None) => Err(CommandGatewayError::InvalidEnvelope(
            "agent commands require executionEpoch".to_string(),
        )
        .into()),
        (ActorRef::User { .. } | ActorRef::System { .. }, Some(_)) => {
            Err(CommandGatewayError::InvalidEnvelope(
                "executionEpoch is only valid for agent commands".to_string(),
            )
            .into())
        }
        _ => Ok(()),
    }
}

fn request_digest<C>(envelope: &CommandEnvelope<C>) -> Result<String>
where
    C: DomainCommand,
{
    let mut expected_versions = envelope.expected_versions.clone();
    expected_versions.sort_by(|left, right| {
        (&left.entity_type, &left.entity_id, left.version).cmp(&(
            &right.entity_type,
            &right.entity_id,
            right.version,
        ))
    });
    let semantic_request = json!({
        "digestVersion": REQUEST_DIGEST_VERSION,
        "commandType": C::TYPE,
        "actor": envelope.actor,
        "campId": envelope.camp_id,
        "expectedVersions": expected_versions,
        "payload": envelope.payload,
    });
    canonical_json_digest(&semantic_request)
}

pub fn canonical_json_digest(value: &Value) -> Result<String> {
    let canonical = canonicalize_json(value.clone());
    let bytes = serde_json::to_vec(&canonical).context("failed to serialize canonical JSON")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_json).collect()),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            let mut canonical = Map::new();
            for (key, value) in entries {
                canonical.insert(key, canonicalize_json(value));
            }
            Value::Object(canonical)
        }
        scalar => scalar,
    }
}

fn replay_or_conflict(
    result: StoredCommandResult,
    command_type: &str,
    request_digest: &str,
) -> Result<CommandExecution> {
    if result.command_type == command_type
        && result.request_digest_version == REQUEST_DIGEST_VERSION
        && result.request_digest == request_digest
    {
        return Ok(CommandExecution {
            result,
            replayed: true,
        });
    }

    Err(CommandGatewayError::IdempotencyConflict {
        command_id: result.command_id,
    }
    .into())
}

fn load_stored_result(
    connection: &rusqlite::Connection,
    command_id: &str,
) -> Result<Option<StoredCommandResult>> {
    connection
        .query_row(
            r#"
            SELECT command_id, command_type, request_digest, request_digest_version,
                   result_status, result_code, result_payload_json,
                   result_entity_type, result_entity_id, created_at
            FROM event_log
            WHERE event_type = 'command.result' AND command_id = ?1
            "#,
            [command_id],
            |row| {
                let status = row.get::<_, String>(4)?;
                let payload = row.get::<_, String>(6)?;
                let result_entity_type = row.get::<_, Option<String>>(7)?;
                let result_entity_id = row.get::<_, Option<String>>(8)?;
                let result_entity = match (result_entity_type, result_entity_id) {
                    (Some(entity_type), Some(entity_id)) => Some(EntityReference {
                        entity_type,
                        entity_id,
                    }),
                    _ => None,
                };
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    status,
                    row.get::<_, String>(5)?,
                    payload,
                    result_entity,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                command_id,
                command_type,
                request_digest,
                request_digest_version,
                status,
                code,
                payload,
                result_entity,
                recorded_at,
            )| {
                Ok(StoredCommandResult {
                    command_id,
                    command_type,
                    request_digest,
                    request_digest_version,
                    status: CommandResultStatus::parse(&status)?,
                    code,
                    payload: serde_json::from_str(&payload)
                        .context("failed to decode persisted command result payload")?,
                    result_entity,
                    recorded_at,
                })
            },
        )
        .transpose()
}

pub(crate) fn project_persisted_command_result_event_payload(
    payload_json: &str,
    command_type: Option<&str>,
    result_status: Option<&str>,
    result_code: Option<&str>,
    result_payload_json: Option<&str>,
    result_entity_type: Option<&str>,
    result_entity_id: Option<&str>,
) -> Result<Value> {
    let stored_payload: Value = serde_json::from_str(payload_json)
        .context("failed to decode persisted command result event payload")?;
    let Some(marker) = stored_payload
        .as_object()
        .and_then(|object| object.get("_rovaiStorage"))
    else {
        return Ok(stored_payload);
    };
    let known_marker = stored_payload
        .as_object()
        .is_some_and(|object| object.len() == 1)
        && marker.as_str() == Some(COMMAND_RESULT_STORAGE_MARKER);
    anyhow::ensure!(
        known_marker,
        "unsupported persisted command result storage marker"
    );

    let command_type = command_type.context("stored command result is missing command_type")?;
    let status = CommandResultStatus::parse(
        result_status.context("stored command result is missing result_status")?,
    )?;
    let code = result_code.context("stored command result is missing result_code")?;
    let result: Value = serde_json::from_str(
        result_payload_json.context("stored command result is missing result_payload_json")?,
    )
    .context("failed to decode persisted command result result_payload_json")?;
    let result_entity = match (result_entity_type, result_entity_id) {
        (None, None) => None,
        (Some(entity_type), Some(entity_id)) => Some(EntityReference {
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
        }),
        _ => anyhow::bail!("stored command result has an incomplete result entity reference"),
    };

    Ok(json!({
        "commandType": command_type,
        "status": status,
        "code": code,
        "result": result,
        "resultEntity": result_entity,
    }))
}

fn append_command_result<C>(
    transaction: &Transaction<'_>,
    envelope: &CommandEnvelope<C>,
    result: &StoredCommandResult,
) -> Result<()>
where
    C: DomainCommand,
{
    let result_entity_type = result
        .result_entity
        .as_ref()
        .map(|reference| reference.entity_type.as_str());
    let result_entity_id = result
        .result_entity
        .as_ref()
        .map(|reference| reference.entity_id.as_str());
    let result_payload_json = serde_json::to_string(&result.payload)?;

    transaction.execute(
        r#"
        INSERT INTO event_log(
            event_id, task_id, turn_id, sequence, event_type, native_method,
            payload_json, camp_id, entity_type, entity_id, actor_type, actor_id,
            source_agent_run_id, execution_epoch, command_id, command_type,
            request_digest, request_digest_version, result_status, result_code,
            result_payload_json, result_entity_type, result_entity_id, created_at
        ) VALUES (
            ?1, NULL, NULL, NULL, 'command.result', NULL,
            ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15,
            ?16, ?17, ?18, ?19
        )
        "#,
        params![
            Uuid::new_v4().to_string(),
            COMMAND_RESULT_STORAGE_MARKER_JSON,
            envelope.camp_id,
            result_entity_type,
            result_entity_id,
            envelope.actor.actor_type(),
            envelope.actor.actor_id(),
            envelope.actor.source_agent_run_id(),
            envelope.execution_epoch,
            result.command_id,
            result.command_type,
            result.request_digest,
            result.request_digest_version,
            result.status.as_str(),
            result.code,
            result_payload_json,
            result_entity_type,
            result_entity_id,
            result.recorded_at,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, path::Path};

    use serde_json::json;

    use super::*;

    #[derive(Debug, Clone, Serialize)]
    struct TestCommand {
        payload: Value,
    }

    impl sealed::Sealed for TestCommand {}

    impl DomainCommand for TestCommand {
        const TYPE: &'static str = "test.command";
    }

    fn database() -> (Database, std::path::PathBuf) {
        let directory = std::env::temp_dir().join(format!("rovai-command-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        (database, directory)
    }

    fn system_command(command_id: &str, payload: Value) -> CommandEnvelope<TestCommand> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: "command-test".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: TestCommand { payload },
        }
    }

    #[test]
    fn canonical_digest_ignores_json_object_key_order() {
        let left = system_command("command-1", json!({ "a": 1, "b": { "c": 2, "d": 3 } }));
        let right = system_command("command-1", json!({ "b": { "d": 3, "c": 2 }, "a": 1 }));

        assert_eq!(
            request_digest(&left).unwrap(),
            request_digest(&right).unwrap()
        );
    }

    #[test]
    fn execution_epoch_fences_processing_without_changing_command_semantics() {
        let command = TestCommand {
            payload: json!({ "value": 42 }),
        };
        let mut first = CommandEnvelope {
            command_id: "agent-command".to_string(),
            actor: ActorRef::Agent {
                agent_id: "agent_2".to_string(),
                source_agent_run_id: "run-1".to_string(),
            },
            camp_id: Some("camp-1".to_string()),
            expected_versions: Vec::new(),
            execution_epoch: Some(1),
            payload: command.clone(),
        };
        let first_digest = request_digest(&first).unwrap();
        first.execution_epoch = Some(2);

        assert_eq!(first_digest, request_digest(&first).unwrap());
    }

    #[test]
    fn command_results_store_one_body_and_replay_all_statuses_without_rerunning_handlers() {
        let (mut database, directory) = database();
        let gateway = DomainCommandGateway;
        for (index, handler_result) in [
            CommandHandlerResult::applied(
                "test.applied",
                json!({ "answer": 42, "text": "完整结果 🧭" }),
                Some(EntityReference {
                    entity_type: "test_entity".to_string(),
                    entity_id: "entity-applied".to_string(),
                }),
            ),
            CommandHandlerResult::accepted(
                "test.accepted",
                json!(["queued", { "position": 2 }]),
                None,
            ),
            CommandHandlerResult::rejected("test.rejected", Value::Null),
        ]
        .into_iter()
        .enumerate()
        {
            let command_id = format!("command-{index}");
            let envelope = system_command(&command_id, json!({ "value": index }));
            let calls = Cell::new(0);
            let expected_handler_result = handler_result.clone();
            let first = gateway
                .execute(&mut database, &envelope, |_| {
                    calls.set(calls.get() + 1);
                    Ok(handler_result)
                })
                .expect("first command should persist its result");
            let replay = gateway
                .execute(&mut database, &envelope, |_| {
                    calls.set(calls.get() + 1);
                    Ok(CommandHandlerResult::rejected("must.not.run", Value::Null))
                })
                .expect("duplicate command should replay");

            assert!(!first.replayed);
            assert!(replay.replayed);
            assert_eq!(first.result, replay.result);
            assert_eq!(first.result.recorded_at, replay.result.recorded_at);
            assert_eq!(calls.get(), 1);
            let persisted: (
                String,
                String,
                String,
                String,
                String,
                Option<String>,
                Option<String>,
                i64,
            ) = database
                .connection()
                .query_row(
                    r#"
                    SELECT payload_json, command_type, result_status, result_code,
                           result_payload_json, result_entity_type, result_entity_id,
                           length(CAST(payload_json AS BLOB))
                               + length(CAST(result_payload_json AS BLOB))
                    FROM event_log
                    WHERE event_type = 'command.result' AND command_id = ?1
                    "#,
                    [&command_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(persisted.0, COMMAND_RESULT_STORAGE_MARKER_JSON);
            assert_eq!(
                serde_json::from_str::<Value>(&persisted.4).unwrap(),
                expected_handler_result.payload
            );
            let projected = project_persisted_command_result_event_payload(
                &persisted.0,
                Some(&persisted.1),
                Some(&persisted.2),
                Some(&persisted.3),
                Some(&persisted.4),
                persisted.5.as_deref(),
                persisted.6.as_deref(),
            )
            .unwrap();
            assert_eq!(
                projected,
                json!({
                    "commandType": TestCommand::TYPE,
                    "status": expected_handler_result.status,
                    "code": expected_handler_result.code,
                    "result": expected_handler_result.payload,
                    "resultEntity": expected_handler_result.result_entity,
                })
            );
            assert_eq!(
                database
                    .connection()
                    .query_row(
                        "SELECT COUNT(*) FROM event_log WHERE command_id = ?1",
                        [&command_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
            assert_eq!(
                persisted.7,
                COMMAND_RESULT_STORAGE_MARKER_JSON.len() as i64 + persisted.4.len() as i64
            );
        }

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn command_result_projection_preserves_json_boundaries_and_fails_closed_on_markers() {
        let large = "大正文🧭".repeat(32 * 1024);
        for result in [
            Value::Null,
            json!({}),
            json!([]),
            json!(42),
            json!(true),
            json!("Unicode 结果 🧭"),
            json!({ "nested": [{ "large": large }] }),
        ] {
            let result_json = serde_json::to_string(&result).unwrap();
            let payload = project_persisted_command_result_event_payload(
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("accepted"),
                Some("test.accepted"),
                Some(&result_json),
                None,
                None,
            )
            .unwrap();
            assert_eq!(payload["result"], result);
            assert!(payload["resultEntity"].is_null());
        }

        let old = json!({
            "commandType": "old.command",
            "status": "applied",
            "code": "old.applied",
            "result": { "kept": true },
            "resultEntity": null,
            "historicalExtension": "preserved",
        });
        assert_eq!(
            project_persisted_command_result_event_payload(
                &old.to_string(),
                None,
                None,
                None,
                None,
                Some("ignored"),
                None,
            )
            .unwrap(),
            old
        );

        for (payload_json, command_type, status, code, result_json, entity_type, entity_id) in [
            (
                r#"{"_rovaiStorage":"command-result-columns-v2"}"#,
                Some("test.command"),
                Some("applied"),
                Some("ok"),
                Some("null"),
                None,
                None,
            ),
            (
                r#"{"_rovaiStorage":"command-result-columns-v1","extra":true}"#,
                Some("test.command"),
                Some("applied"),
                Some("ok"),
                Some("null"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                None,
                Some("applied"),
                Some("ok"),
                Some("null"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                None,
                Some("ok"),
                Some("null"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("applied"),
                None,
                Some("null"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("applied"),
                Some("ok"),
                None,
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("unknown"),
                Some("ok"),
                Some("null"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("applied"),
                Some("ok"),
                Some("not-json"),
                None,
                None,
            ),
            (
                COMMAND_RESULT_STORAGE_MARKER_JSON,
                Some("test.command"),
                Some("applied"),
                Some("ok"),
                Some("null"),
                Some("task"),
                None,
            ),
        ] {
            assert!(
                project_persisted_command_result_event_payload(
                    payload_json,
                    command_type,
                    status,
                    code,
                    result_json,
                    entity_type,
                    entity_id,
                )
                .is_err()
            );
        }
    }

    #[test]
    fn committed_results_replay_after_reopen_and_handler_errors_roll_back_atomically() {
        let (mut database, directory) = database();
        let gateway = DomainCommandGateway;
        let committed = system_command("command-committed", json!({ "value": 1 }));
        let first = gateway
            .execute(&mut database, &committed, |_| {
                Ok(CommandHandlerResult::applied(
                    "test.persisted",
                    json!({ "first": true }),
                    None,
                ))
            })
            .unwrap();
        drop(database);

        let mut database = Database::open(&directory).unwrap();
        let replay = gateway
            .execute(&mut database, &committed, |_| {
                unreachable!("a committed command must replay after database reopen")
            })
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, first.result);

        let failed = system_command("command-failed", json!({ "value": 2 }));
        let error = gateway
            .execute(&mut database, &failed, |transaction| {
                transaction.execute(
                    "INSERT INTO event_log(event_id,event_type,payload_json,created_at) VALUES (?1,'test.partial','{}',?2)",
                    params![Uuid::new_v4().to_string(), chrono::Utc::now().to_rfc3339()],
                )?;
                anyhow::bail!("handler fixture failure")
            })
            .expect_err("handler failure must abort the transaction");
        assert!(error.to_string().contains("handler fixture failure"));
        let remaining: (i64, i64) = database
            .connection()
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM event_log WHERE command_id='command-failed'),
                    (SELECT COUNT(*) FROM event_log WHERE event_type='test.partial')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(remaining, (0, 0));

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn replay_lookup_returns_the_persisted_result_without_opening_a_write_transaction() {
        let (mut database, directory) = database();
        let gateway = DomainCommandGateway;
        let envelope = system_command("command-lookup", json!({ "value": 42 }));

        assert!(
            gateway
                .replay_if_recorded(&database, &envelope)
                .unwrap()
                .is_none()
        );
        gateway
            .execute(&mut database, &envelope, |_| {
                Ok(CommandHandlerResult::accepted(
                    "test.accepted",
                    json!({ "answer": 42 }),
                    None,
                ))
            })
            .unwrap();

        let replay = gateway
            .replay_if_recorded(&database, &envelope)
            .unwrap()
            .expect("persisted result should be found");
        assert!(replay.replayed);
        assert_eq!(replay.result.code, "test.accepted");

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn reusing_command_id_for_a_different_request_is_a_stable_conflict() {
        let (mut database, directory) = database();
        let gateway = DomainCommandGateway;
        let first = system_command("command-1", json!({ "value": 1 }));
        gateway
            .execute(&mut database, &first, |_| {
                Ok(CommandHandlerResult::applied(
                    "test.applied",
                    Value::Null,
                    None,
                ))
            })
            .unwrap();

        let changed = system_command("command-1", json!({ "value": 2 }));
        let error = gateway
            .execute(&mut database, &changed, |_| {
                unreachable!("conflicting command must not run")
            })
            .expect_err("changed request should conflict");
        assert!(matches!(
            error.downcast_ref::<CommandGatewayError>(),
            Some(CommandGatewayError::IdempotencyConflict { command_id })
                if command_id == "command-1"
        ));

        drop(database);
        std::fs::remove_dir_all(Path::new(&directory))
            .expect("temporary database should be removable");
    }
}
