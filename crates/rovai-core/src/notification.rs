use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

const DEFAULT_PAGE_LIMIT: usize = 50;
const MAX_PAGE_LIMIT: usize = 100;

pub(crate) fn maintain_in_app_notification_retention(
    connection: &rusqlite::Connection,
) -> Result<()> {
    connection.execute_batch(
        r#"
        DELETE FROM in_app_notification
        WHERE datetime(created_at) < datetime('now', '-90 days');
        DELETE FROM in_app_notification
        WHERE sequence NOT IN (
            SELECT retained.sequence
            FROM in_app_notification AS retained
            WHERE retained.recipient_user_id = in_app_notification.recipient_user_id
            ORDER BY retained.sequence DESC
            LIMIT 1000
        );
        DELETE FROM in_app_notification
        WHERE cleared_at IS NOT NULL
          AND datetime(cleared_at) < datetime('now', '-1 day');
        "#,
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InAppNotificationKind {
    RuntimePermissionAttention,
    CampTurnCompleted,
    CampTurnIncomplete,
}

impl InAppNotificationKind {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "runtime_permission_attention" => Ok(Self::RuntimePermissionAttention),
            "camp_turn_completed" => Ok(Self::CampTurnCompleted),
            "camp_turn_incomplete" => Ok(Self::CampTurnIncomplete),
            _ => anyhow::bail!("unknown In-App Notification kind"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InAppNotificationFilter {
    All,
    Unread,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InAppNotificationAttentionState {
    Pending,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotificationCampView {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotificationView {
    pub id: String,
    pub sequence: i64,
    pub kind: InAppNotificationKind,
    pub camp: InAppNotificationCampView,
    pub camp_turn_id: Option<String>,
    pub source_available: bool,
    pub attention_state: Option<InAppNotificationAttentionState>,
    pub read_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotificationInbox {
    pub schema_version: i64,
    pub through_sequence: i64,
    pub unread_count: i64,
    pub items: Vec<InAppNotificationView>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotificationCreatedBatch {
    pub schema_version: i64,
    pub requested_after_sequence: i64,
    pub next_sequence: i64,
    pub through_sequence: i64,
    pub reset_required: bool,
    pub has_more: bool,
    pub items: Vec<InAppNotificationView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppNotificationPreference {
    pub heads_up_enabled: bool,
    pub approval_heads_up_enabled: bool,
    pub execution_heads_up_enabled: bool,
    pub version: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkInAppNotificationReadCommand {
    pub notification_id: String,
}

impl sealed::Sealed for MarkInAppNotificationReadCommand {}
impl DomainCommand for MarkInAppNotificationReadCommand {
    const TYPE: &'static str = "in_app_notification.mark_read";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkCampInAppNotificationsReadCommand {
    pub camp_id: String,
    pub through_sequence: i64,
}

impl sealed::Sealed for MarkCampInAppNotificationsReadCommand {}
impl DomainCommand for MarkCampInAppNotificationsReadCommand {
    const TYPE: &'static str = "in_app_notification.mark_camp_read";
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkAllInAppNotificationsReadCommand {}

impl sealed::Sealed for MarkAllInAppNotificationsReadCommand {}
impl DomainCommand for MarkAllInAppNotificationsReadCommand {
    const TYPE: &'static str = "in_app_notification.mark_all_read";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearInAppNotificationCommand {
    pub notification_id: String,
}

impl sealed::Sealed for ClearInAppNotificationCommand {}
impl DomainCommand for ClearInAppNotificationCommand {
    const TYPE: &'static str = "in_app_notification.clear";
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearReadInAppNotificationsCommand {}

impl sealed::Sealed for ClearReadInAppNotificationsCommand {}
impl DomainCommand for ClearReadInAppNotificationsCommand {
    const TYPE: &'static str = "in_app_notification.clear_read";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInAppNotificationPreferenceCommand {
    pub expected_version: i64,
    pub heads_up_enabled: bool,
    pub approval_heads_up_enabled: bool,
    pub execution_heads_up_enabled: bool,
}

impl sealed::Sealed for UpdateInAppNotificationPreferenceCommand {}
impl DomainCommand for UpdateInAppNotificationPreferenceCommand {
    const TYPE: &'static str = "in_app_notification.preference.update";
}

#[derive(Debug, Default)]
pub struct InAppNotificationService {
    gateway: DomainCommandGateway,
}

impl InAppNotificationService {
    pub fn maintain_retention(&self, database: &Database) -> Result<()> {
        maintain_in_app_notification_retention(database.connection())
    }

    pub fn inbox(
        &self,
        database: &mut Database,
        recipient_user_id: &str,
        filter: InAppNotificationFilter,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<InAppNotificationInbox> {
        let limit = normalized_limit(limit);
        let cursor = cursor.map(decode_cursor).transpose()?;
        let transaction = database.connection_mut().transaction()?;
        let through_sequence = notification_high_water(&transaction, recipient_user_id)?;
        let unread_count = transaction.query_row(
            r#"
            SELECT COUNT(*)
            FROM in_app_notification
            WHERE recipient_user_id = ?1
              AND cleared_at IS NULL
              AND read_at IS NULL
            "#,
            [recipient_user_id],
            |row| row.get(0),
        )?;
        let mut items = load_notification_page(
            &transaction,
            recipient_user_id,
            filter,
            cursor.as_ref(),
            limit + 1,
        )?;
        let has_more = items.len() > limit;
        if has_more {
            items.truncate(limit);
        }
        let next_cursor = has_more
            .then(|| {
                items
                    .last()
                    .map(|item| encode_cursor(item.sequence, &item.id))
            })
            .flatten();
        transaction.commit()?;
        Ok(InAppNotificationInbox {
            schema_version: 2,
            through_sequence,
            unread_count,
            items,
            next_cursor,
        })
    }

    pub fn created_since(
        &self,
        database: &mut Database,
        recipient_user_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<InAppNotificationCreatedBatch> {
        let limit = normalized_limit(limit);
        let transaction = database.connection_mut().transaction()?;
        let through_sequence = notification_high_water(&transaction, recipient_user_id)?;
        let earliest_sequence = transaction.query_row(
            r#"
            SELECT COALESCE(MIN(sequence), 0)
            FROM in_app_notification
            WHERE recipient_user_id = ?1
            "#,
            [recipient_user_id],
            |row| row.get::<_, i64>(0),
        )?;
        let reset_required = after_sequence < 0
            || after_sequence > through_sequence
            || (earliest_sequence > 0 && after_sequence < earliest_sequence - 1);
        if reset_required {
            transaction.commit()?;
            return Ok(InAppNotificationCreatedBatch {
                schema_version: 1,
                requested_after_sequence: after_sequence,
                next_sequence: through_sequence,
                through_sequence,
                reset_required: true,
                has_more: false,
                items: Vec::new(),
            });
        }

        let mut statement = transaction.prepare(&format!(
            "{} WHERE n.recipient_user_id = ?1 AND n.cleared_at IS NULL \
             AND n.sequence > ?2 ORDER BY n.sequence ASC LIMIT ?3",
            notification_select()
        ))?;
        let rows = statement.query_map(
            params![recipient_user_id, after_sequence, (limit + 1) as i64],
            notification_from_row,
        )?;
        let mut items = rows
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(validate_notification)
            .collect::<Result<Vec<_>>>()?;
        drop(statement);
        let has_more = items.len() > limit;
        if has_more {
            items.truncate(limit);
        }
        let next_sequence = if has_more {
            items
                .last()
                .map(|item| item.sequence)
                .unwrap_or(after_sequence)
        } else {
            through_sequence
        };
        transaction.commit()?;
        Ok(InAppNotificationCreatedBatch {
            schema_version: 1,
            requested_after_sequence: after_sequence,
            next_sequence,
            through_sequence,
            reset_required: false,
            has_more,
            items,
        })
    }

    pub fn preference(&self, database: &Database) -> Result<InAppNotificationPreference> {
        load_preference(database.connection())
    }

    pub fn mark_read(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkInAppNotificationReadCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let notification_id = envelope.payload.notification_id.trim();
            if notification_id.is_empty() {
                return Ok(rejected(
                    "in_app_notification.invalid_id",
                    "notificationId must not be empty",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE in_app_notification
                SET read_at = ?3, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND recipient_user_id = ?2
                  AND cleared_at IS NULL AND read_at IS NULL
                "#,
                params![notification_id, recipient_user_id, now],
            )?;
            Ok(applied_change(
                "in_app_notification.read",
                changed,
                json!({
                    "notificationId": notification_id,
                }),
            ))
        })
    }

    pub fn mark_camp_read(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkCampInAppNotificationsReadCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            if envelope.payload.camp_id.trim().is_empty() || envelope.payload.through_sequence < 0 {
                return Ok(rejected(
                    "in_app_notification.invalid_camp_boundary",
                    "campId and throughSequence must define a valid boundary",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE in_app_notification
                SET read_at = ?4, version = version + 1, updated_at = ?4
                WHERE recipient_user_id = ?1 AND camp_id = ?2
                  AND sequence <= ?3 AND cleared_at IS NULL AND read_at IS NULL
                "#,
                params![
                    recipient_user_id,
                    envelope.payload.camp_id,
                    envelope.payload.through_sequence,
                    now,
                ],
            )?;
            Ok(applied_change(
                "in_app_notification.camp_read",
                changed,
                json!({
                    "campId": envelope.payload.camp_id,
                    "throughSequence": envelope.payload.through_sequence,
                }),
            ))
        })
    }

    pub fn mark_all_read(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkAllInAppNotificationsReadCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let through_sequence = notification_high_water(transaction, &recipient_user_id)?;
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE in_app_notification
                SET read_at = ?3, version = version + 1, updated_at = ?3
                WHERE recipient_user_id = ?1 AND sequence <= ?2
                  AND cleared_at IS NULL AND read_at IS NULL
                "#,
                params![recipient_user_id, through_sequence, now],
            )?;
            Ok(applied_change(
                "in_app_notification.all_read",
                changed,
                json!({
                    "throughSequence": through_sequence,
                }),
            ))
        })
    }

    pub fn clear(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClearInAppNotificationCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let notification_id = envelope.payload.notification_id.trim();
            if notification_id.is_empty() {
                return Ok(rejected(
                    "in_app_notification.invalid_id",
                    "notificationId must not be empty",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE in_app_notification
                SET cleared_at = ?3, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND recipient_user_id = ?2 AND cleared_at IS NULL
                "#,
                params![notification_id, recipient_user_id, now],
            )?;
            Ok(applied_change(
                "in_app_notification.cleared",
                changed,
                json!({
                    "notificationId": notification_id,
                }),
            ))
        })
    }

    pub fn clear_read(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClearReadInAppNotificationsCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let through_sequence = notification_high_water(transaction, &recipient_user_id)?;
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE in_app_notification
                SET cleared_at = ?3, version = version + 1, updated_at = ?3
                WHERE recipient_user_id = ?1 AND sequence <= ?2
                  AND cleared_at IS NULL AND read_at IS NOT NULL
                "#,
                params![recipient_user_id, through_sequence, now],
            )?;
            Ok(applied_change(
                "in_app_notification.read_cleared",
                changed,
                json!({
                    "throughSequence": through_sequence,
                }),
            ))
        })
    }

    pub fn update_preference(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateInAppNotificationPreferenceCommand>,
    ) -> Result<CommandExecution> {
        user_id(&envelope.actor)?;
        self.gateway.execute(database, envelope, |transaction| {
            let current = load_preference(transaction)?;
            if current.version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "in_app_notification.preference_conflict",
                    serde_json::to_value(current)?,
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE in_app_notification_preference
                SET heads_up_enabled = ?1,
                    approval_heads_up_enabled = ?2,
                    execution_heads_up_enabled = ?3,
                    version = version + 1,
                    updated_at = ?4
                WHERE singleton = 1 AND version = ?5
                "#,
                params![
                    envelope.payload.heads_up_enabled,
                    envelope.payload.approval_heads_up_enabled,
                    envelope.payload.execution_heads_up_enabled,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            let preference = load_preference(transaction)?;
            Ok(CommandHandlerResult::applied(
                "in_app_notification.preference_updated",
                serde_json::to_value(&preference)?,
                Some(EntityReference {
                    entity_type: "in_app_notification_preference".to_string(),
                    entity_id: "1".to_string(),
                }),
            ))
        })
    }
}

fn normalized_limit(limit: usize) -> usize {
    if limit == 0 {
        DEFAULT_PAGE_LIMIT
    } else {
        limit.min(MAX_PAGE_LIMIT)
    }
}

fn notification_select() -> &'static str {
    r#"
    SELECT n.id, n.sequence, n.kind,
           camp.id, camp.title,
           n.camp_turn_id,
           CASE
               WHEN n.kind = 'runtime_permission_attention' THEN 1
               WHEN camp_turn.id IS NOT NULL THEN 1
               ELSE 0
           END,
           n.resolved_at, n.read_at, n.created_at, n.updated_at
    FROM in_app_notification AS n
    JOIN camp ON camp.id = n.camp_id
    LEFT JOIN camp_turn ON camp_turn.id = n.camp_turn_id
    "#
}

fn load_notification_page(
    transaction: &Transaction<'_>,
    recipient_user_id: &str,
    filter: InAppNotificationFilter,
    cursor: Option<&(i64, String)>,
    limit: usize,
) -> Result<Vec<InAppNotificationView>> {
    let unread_clause = if filter == InAppNotificationFilter::Unread {
        " AND n.read_at IS NULL"
    } else {
        ""
    };
    let cursor_clause = if cursor.is_some() {
        " AND n.sequence < ?2"
    } else {
        ""
    };
    let limit_parameter = if cursor.is_some() { "?3" } else { "?2" };
    let sql = format!(
        "{} WHERE n.recipient_user_id = ?1 AND n.cleared_at IS NULL{}{} \
         ORDER BY n.sequence DESC, n.id DESC LIMIT {}",
        notification_select(),
        unread_clause,
        cursor_clause,
        limit_parameter,
    );
    let mut statement = transaction.prepare(&sql)?;
    let rows = if let Some((sequence, _)) = cursor {
        statement.query_map(
            params![recipient_user_id, sequence, limit as i64],
            notification_from_row,
        )?
    } else {
        statement.query_map(
            params![recipient_user_id, limit as i64],
            notification_from_row,
        )?
    };
    rows.collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(validate_notification)
        .collect()
}

type RawNotification = (
    String,
    i64,
    String,
    String,
    String,
    Option<String>,
    bool,
    Option<String>,
    Option<String>,
    String,
    String,
);

fn notification_from_row(row: &Row<'_>) -> rusqlite::Result<RawNotification> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn validate_notification(raw: RawNotification) -> Result<InAppNotificationView> {
    let kind = InAppNotificationKind::parse(&raw.2)?;
    let attention_state = match kind {
        InAppNotificationKind::RuntimePermissionAttention => Some(if raw.7.is_some() {
            InAppNotificationAttentionState::Resolved
        } else {
            InAppNotificationAttentionState::Pending
        }),
        InAppNotificationKind::CampTurnCompleted | InAppNotificationKind::CampTurnIncomplete => {
            None
        }
    };
    Ok(InAppNotificationView {
        id: raw.0,
        sequence: raw.1,
        kind,
        camp: InAppNotificationCampView {
            id: raw.3,
            title: raw.4,
        },
        camp_turn_id: raw.5,
        source_available: raw.6,
        attention_state,
        read_at: raw.8,
        created_at: raw.9,
        updated_at: raw.10,
    })
}

fn notification_high_water(transaction: &Transaction<'_>, _recipient_user_id: &str) -> Result<i64> {
    transaction
        .query_row(
            r#"
            SELECT COALESCE((
                SELECT seq FROM sqlite_sequence
                WHERE name = 'in_app_notification'
            ), 0)
            "#,
            [],
            |row| row.get(0),
        )
        .context("failed to capture In-App Notification high water")
}

fn encode_cursor(sequence: i64, id: &str) -> String {
    format!("{sequence:016x}.{id}")
}

fn decode_cursor(cursor: &str) -> Result<(i64, String)> {
    let (sequence, id) = cursor
        .split_once('.')
        .context("In-App Notification cursor is invalid")?;
    let sequence = i64::from_str_radix(sequence, 16)
        .context("In-App Notification cursor sequence is invalid")?;
    if sequence < 0 || id.is_empty() || id.len() > 128 {
        anyhow::bail!("In-App Notification cursor is invalid");
    }
    Ok((sequence, id.to_string()))
}

fn load_preference(connection: &rusqlite::Connection) -> Result<InAppNotificationPreference> {
    connection
        .query_row(
            r#"
            SELECT heads_up_enabled, approval_heads_up_enabled,
                   execution_heads_up_enabled, version, updated_at
            FROM in_app_notification_preference
            WHERE singleton = 1
            "#,
            [],
            |row| {
                Ok(InAppNotificationPreference {
                    heads_up_enabled: row.get(0)?,
                    approval_heads_up_enabled: row.get(1)?,
                    execution_heads_up_enabled: row.get(2)?,
                    version: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()?
        .context("In-App Notification preference is missing")
}

fn user_id(actor: &ActorRef) -> Result<&str> {
    match actor {
        ActorRef::User { user_id } if !user_id.trim().is_empty() => Ok(user_id),
        _ => anyhow::bail!("In-App Notification commands require a User Actor"),
    }
}

fn applied_change(
    code: &str,
    changed: usize,
    mut payload: serde_json::Value,
) -> CommandHandlerResult {
    if let Some(object) = payload.as_object_mut() {
        object.insert("changed".to_string(), json!(changed));
    }
    CommandHandlerResult::applied(code, payload, None)
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_database() -> (std::path::PathBuf, Database) {
        let directory =
            std::env::temp_dir().join(format!("rovai-notification-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("notification database should open");
        (directory, database)
    }

    fn insert_camp(database: &Database, camp_id: &str, title: &str) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, name_origin, collaboration_mode,
                    project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, 'user', 'peer', 'quick_chat', '/quick-chat',
                    0, 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                )
                "#,
                params![camp_id, title],
            )
            .expect("Camp fixture should insert");
    }

    fn insert_runtime_permission_fixture(database: &Database) {
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id,
                    summary_through_message_sequence, last_message_sequence,
                    version, created_at, updated_at
                ) VALUES (
                    'conversation-attention', 'camp-attention', 'agent_1',
                    0, 0, 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                );
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    version, created_at, updated_at
                ) VALUES (
                    'turn-attention', 'camp-attention', 'system_event', 'attention',
                    'running', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                );
                INSERT INTO agent_run(
                    id, camp_turn_id, conversation_id,
                    initial_camp_context_through_sequence,
                    initial_conversation_context_through_sequence,
                    responsibility_key, responsibility_generation,
                    start_reason, purpose, expected_output, completion_role,
                    effective_config_json, workspace_json, permission_semantics,
                    status, idempotency_key, version, created_at, updated_at
                ) VALUES (
                    'run-attention', 'turn-attention', 'conversation-attention', 0, 0,
                    'attention', 0, 'initial', 'permission fixture', 'evidence', 'required',
                    '{}', NULL, 'runtime_managed_v2', 'running', 'attention', 1,
                    '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                );
                "#,
            )
            .expect("Runtime permission fixture should insert");
    }

    fn insert_native_approval(
        database: &Database,
        action_id: &str,
        approval_id: &str,
        requested_at: &str,
    ) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO action_execution(
                    id, agent_run_id, action_kind, action_schema_version,
                    action_digest, digest_algorithm, canonicalization_version,
                    canonical_input_json, input_completeness, action_summary,
                    execution_authority, control_mode,
                    source_agent_run_execution_epoch,
                    native_request_method, native_request_id_json,
                    native_request_digest,
                    policy_decision, policy_version, matched_policy_rule_ids_json,
                    status, resolution_evidence_refs_json,
                    version, created_at, updated_at
                ) VALUES (
                    ?1, 'run-attention', 'shell', '1', ?1, 'sha256', '1',
                    '{}', 'complete', 'native permission fixture',
                    'runtime', 'intercepted', 0,
                    'runtime.permission', json_object('id', ?1), ?1,
                    'ask', '1', '[]', 'prepared', '[]', 1, ?2, ?2
                )
                "#,
                params![action_id, requested_at],
            )
            .expect("Action fixture should insert");
        database
            .connection()
            .execute(
                r#"
                INSERT INTO approval(
                    id, action_id, action_kind, action_digest,
                    digest_algorithm, canonicalization_version, action_summary,
                    requested_for_user_id, request_policy_version,
                    status, version, requested_at, updated_at, native_options_json
                ) VALUES (
                    ?1, ?2, 'shell', ?2, 'sha256', '1',
                    'native permission fixture', 'local-user', '1',
                    'pending', 1, ?3, ?3,
                    '[{"optionId":"deny","kind":"deny","label":"拒绝","consequence":"拒绝","nativeResponseDigest":"digest"}]'
                )
                "#,
                params![approval_id, action_id, requested_at],
            )
            .expect("Approval fixture should insert");
    }

    #[test]
    fn terminal_turns_create_exactly_one_notification_and_stop_is_silent() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-notification", "初始标题");
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    version, created_at, updated_at
                ) VALUES (
                    'turn-complete', 'camp-notification', 'system_event', 'complete',
                    'running', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                );
                UPDATE camp_turn
                SET status = 'completed', ended_at = '2026-08-01T00:01:00Z',
                    updated_at = '2026-08-01T00:01:00Z', version = 2
                WHERE id = 'turn-complete';
                UPDATE camp_turn SET updated_at = '2026-08-01T00:02:00Z', version = 3
                WHERE id = 'turn-complete';

                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    cancel_requested_at, cancel_request_command_id,
                    version, created_at, updated_at, ended_at
                ) VALUES (
                    'turn-stopped', 'camp-notification', 'system_event', 'stopped',
                    'cancelled', '2026-08-01T00:02:00Z', 'stop-command',
                    1, '2026-08-01T00:00:00Z', '2026-08-01T00:02:00Z',
                    '2026-08-01T00:02:00Z'
                );
                "#,
            )
            .expect("terminal fixtures should commit");

        let inbox = InAppNotificationService::default()
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .expect("Inbox should load");
        assert_eq!(inbox.items.len(), 1);
        assert_eq!(inbox.unread_count, 1);
        assert_eq!(
            inbox.items[0].kind,
            InAppNotificationKind::CampTurnCompleted
        );
        assert_eq!(inbox.items[0].camp.title, "初始标题");

        database
            .connection()
            .execute(
                "UPDATE camp SET title = '重命名后' WHERE id = 'camp-notification'",
                [],
            )
            .unwrap();
        let renamed = InAppNotificationService::default()
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(renamed.items[0].camp.title, "重命名后");

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn read_and_clear_commands_are_idempotent_and_respect_sequence_boundaries() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-one", "One");
        insert_camp(&database, "camp-two", "Two");
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    version, created_at, updated_at, ended_at
                ) VALUES
                    ('turn-one', 'camp-one', 'system_event', 'one', 'completed', 1,
                     '2026-08-01T00:00:00Z', '2026-08-01T00:01:00Z', '2026-08-01T00:01:00Z'),
                    ('turn-two', 'camp-two', 'system_event', 'two', 'failed', 1,
                     '2026-08-01T00:00:00Z', '2026-08-01T00:02:00Z', '2026-08-01T00:02:00Z');
                "#,
            )
            .unwrap();
        let service = InAppNotificationService::default();
        let baseline = service
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        let first_sequence = baseline
            .items
            .iter()
            .find(|item| item.camp.id == "camp-one")
            .unwrap()
            .sequence;
        let envelope = CommandEnvelope {
            command_id: "mark-camp-read".to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: Some("camp-one".to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: MarkCampInAppNotificationsReadCommand {
                camp_id: "camp-one".to_string(),
                through_sequence: first_sequence,
            },
        };
        service.mark_camp_read(&mut database, &envelope).unwrap();
        let replay = service.mark_camp_read(&mut database, &envelope).unwrap();
        assert!(replay.replayed);

        let unread = service
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::Unread,
                None,
                50,
            )
            .unwrap();
        assert_eq!(unread.items.len(), 1);
        assert_eq!(unread.items[0].camp.id, "camp-two");

        let clear = CommandEnvelope {
            command_id: "clear-read".to_string(),
            actor: envelope.actor.clone(),
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: ClearReadInAppNotificationsCommand::default(),
        };
        service.clear_read(&mut database, &clear).unwrap();
        let remaining = service
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(remaining.items.len(), 1);
        assert_eq!(remaining.items[0].camp.id, "camp-two");

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_permission_attention_uses_camp_episodes_even_after_clear() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-attention", "Permission Camp");
        insert_runtime_permission_fixture(&database);
        insert_native_approval(
            &database,
            "action-attention-1",
            "approval-attention-1",
            "2026-08-01T01:00:00Z",
        );
        let service = InAppNotificationService::default();
        let initial = service
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(initial.items.len(), 1);
        assert_eq!(
            initial.items[0].kind,
            InAppNotificationKind::RuntimePermissionAttention
        );

        let clear = CommandEnvelope {
            command_id: "clear-attention".to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: Some("camp-attention".to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: ClearInAppNotificationCommand {
                notification_id: initial.items[0].id.clone(),
            },
        };
        service.clear(&mut database, &clear).unwrap();
        insert_native_approval(
            &database,
            "action-attention-2",
            "approval-attention-2",
            "2026-08-01T01:01:00Z",
        );
        let rows_in_same_episode: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM in_app_notification WHERE camp_id = 'camp-attention'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows_in_same_episode, 1);

        database
            .connection()
            .execute(
                r#"
                UPDATE approval
                SET status = 'denied', resolved_at = ?2, updated_at = ?2, version = version + 1
                WHERE id = ?1
                "#,
                params!["approval-attention-1", "2026-08-01T01:02:00Z"],
            )
            .unwrap();
        let unresolved: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM in_app_notification WHERE camp_id = 'camp-attention' AND resolved_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unresolved, 1);
        database
            .connection()
            .execute(
                r#"
                UPDATE approval
                SET status = 'denied', resolved_at = ?2, updated_at = ?2, version = version + 1
                WHERE id = ?1
                "#,
                params!["approval-attention-2", "2026-08-01T01:03:00Z"],
            )
            .unwrap();
        insert_native_approval(
            &database,
            "action-attention-3",
            "approval-attention-3",
            "2026-08-01T01:04:00Z",
        );
        let total_rows: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM in_app_notification WHERE camp_id = 'camp-attention'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total_rows, 2);
        let visible = service
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(visible.items.len(), 1);
        assert_eq!(
            visible.items[0].attention_state,
            Some(InAppNotificationAttentionState::Pending)
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn retention_caps_history_and_preserves_a_monotonic_creation_boundary() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-retention", "Retention Camp");
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO in_app_notification(
                    id, recipient_user_id, kind, camp_id, version,
                    created_at, updated_at
                ) VALUES (
                    'notification-expired', 'local-user', 'camp_turn_completed',
                    'camp-retention', 1, '2000-01-01T00:00:00Z',
                    '2000-01-01T00:00:00Z'
                );

                WITH RECURSIVE notification_number(value) AS (
                    SELECT 1
                    UNION ALL
                    SELECT value + 1 FROM notification_number WHERE value < 1005
                )
                INSERT INTO in_app_notification(
                    id, recipient_user_id, kind, camp_id, version,
                    created_at, updated_at
                )
                SELECT printf('notification-%04d', value), 'local-user',
                       'camp_turn_completed', 'camp-retention', 1,
                       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                FROM notification_number;
                "#,
            )
            .unwrap();

        let retained: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM in_app_notification", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(retained, 1000);
        let page = InAppNotificationService::default()
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                25,
            )
            .unwrap();
        assert_eq!(page.items.len(), 25);
        assert!(page.next_cursor.is_some());
        assert_eq!(page.through_sequence, 1006);
        let reset = InAppNotificationService::default()
            .created_since(&mut database, "local-user", 0, 100)
            .unwrap();
        assert!(reset.reset_required);
        assert_eq!(reset.next_sequence, 1006);

        database
            .connection()
            .execute(
                r#"
                UPDATE in_app_notification
                SET read_at = '2000-01-01T00:00:00Z',
                    cleared_at = '2000-01-01T00:00:00Z'
                WHERE sequence = (SELECT MIN(sequence) FROM in_app_notification)
                "#,
                [],
            )
            .unwrap();
        maintain_in_app_notification_retention(database.connection()).unwrap();
        let after_clear_maintenance: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM in_app_notification", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(after_clear_maintenance, 999);

        database
            .connection()
            .execute("DELETE FROM camp WHERE id = 'camp-retention'", [])
            .unwrap();
        let empty = InAppNotificationService::default()
            .inbox(
                &mut database,
                "local-user",
                InAppNotificationFilter::All,
                None,
                50,
            )
            .unwrap();
        assert!(empty.items.is_empty());
        assert_eq!(empty.through_sequence, 1006);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
