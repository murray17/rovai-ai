use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Row, Transaction, named_params, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

use crate::{
    camp_content::{StructuredCampMessageContent, render_current_plain_text, validate_content},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
};

const DEFAULT_PAGE_LIMIT: usize = 50;
const MAX_PAGE_LIMIT: usize = 100;
const NOTIFICATION_EPISODE_SCHEMA_VERSION: i64 = 6;
const MESSAGE_SUMMARY_MAX_SCALARS: usize = 160;

/// Retention only removes inactive, terminal Episodes. A delete first records a remove
/// change through the schema trigger; journal truncation then advances the durable floor.
pub(crate) fn maintain_notification_episode_retention(
    connection: &rusqlite::Connection,
) -> Result<()> {
    connection.execute_batch(
        r#"
        DELETE FROM notification_episode
        WHERE datetime(updated_at) < datetime('now', '-90 days')
          AND NOT EXISTS (
              SELECT 1
              FROM notification_occurrence AS occurrence
              JOIN notification_occurrence_disposition AS disposition
                ON disposition.occurrence_id = occurrence.id
              JOIN notification_episode_disposition AS episode_disposition
                ON episode_disposition.episode_id = occurrence.episode_id
              WHERE occurrence.episode_id = notification_episode.id
                AND occurrence.admitted_attention_revision
                    > episode_disposition.cleared_through_attention_revision
                AND disposition.acknowledged_at IS NULL
                AND (
                    occurrence.semantic <> 'turn_completed'
                    OR disposition.satisfied_at IS NULL
                )
          )
          AND (
              kind = 'message'
              OR (kind = 'collaboration' AND EXISTS (
                  SELECT 1 FROM notification_occurrence AS occurrence
                  WHERE occurrence.episode_id = notification_episode.id
                    AND occurrence.semantic IN (
                        'turn_completed', 'turn_failed', 'turn_incomplete'
                    )
              ))
              OR (kind = 'approval' AND NOT EXISTS (
                  SELECT 1
                  FROM notification_occurrence AS occurrence
                  JOIN notification_occurrence_disposition AS disposition
                    ON disposition.occurrence_id = occurrence.id
                  WHERE occurrence.episode_id = notification_episode.id
                    AND disposition.resolved_at IS NULL
              ))
          );

        DELETE FROM notification_episode
        WHERE id IN (
            SELECT candidate.id
            FROM notification_episode AS candidate
            WHERE NOT EXISTS (
                SELECT 1
                FROM notification_occurrence AS occurrence
                JOIN notification_occurrence_disposition AS disposition
                  ON disposition.occurrence_id = occurrence.id
                JOIN notification_episode_disposition AS episode_disposition
                  ON episode_disposition.episode_id = occurrence.episode_id
                WHERE occurrence.episode_id = candidate.id
                  AND occurrence.admitted_attention_revision
                      > episode_disposition.cleared_through_attention_revision
                  AND disposition.acknowledged_at IS NULL
                  AND (
                      occurrence.semantic <> 'turn_completed'
                      OR disposition.satisfied_at IS NULL
                  )
            )
              AND (
                  candidate.kind = 'message'
                  OR (candidate.kind = 'collaboration' AND EXISTS (
                      SELECT 1 FROM notification_occurrence AS occurrence
                      WHERE occurrence.episode_id = candidate.id
                        AND occurrence.semantic IN (
                            'turn_completed', 'turn_failed', 'turn_incomplete'
                        )
                  ))
                  OR (candidate.kind = 'approval' AND NOT EXISTS (
                      SELECT 1
                      FROM notification_occurrence AS occurrence
                      JOIN notification_occurrence_disposition AS disposition
                        ON disposition.occurrence_id = occurrence.id
                      WHERE occurrence.episode_id = candidate.id
                        AND disposition.resolved_at IS NULL
                  ))
              )
            ORDER BY candidate.sort_at DESC, candidate.id DESC
            LIMIT -1 OFFSET 1000
        );

        UPDATE notification_change_clock
        SET retained_floor_sequence = MAX(
            retained_floor_sequence,
            COALESCE((
                SELECT MAX(change_sequence)
                FROM notification_change_journal
                WHERE datetime(changed_at) < datetime('now', '-90 days')
                   OR change_sequence <= MAX(
                       (SELECT current_sequence FROM notification_change_clock
                        WHERE singleton = 1) - 5000,
                       0
                   )
            ), retained_floor_sequence)
        )
        WHERE singleton = 1;

        DELETE FROM notification_change_journal
        WHERE change_sequence <= (
            SELECT retained_floor_sequence
            FROM notification_change_clock
            WHERE singleton = 1
        );
        "#,
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEpisodeKind {
    Collaboration,
    Message,
    Approval,
}

impl NotificationEpisodeKind {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "collaboration" => Ok(Self::Collaboration),
            "message" => Ok(Self::Message),
            "approval" => Ok(Self::Approval),
            _ => anyhow::bail!("unknown Notification Episode kind: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationSemantic {
    ApprovalPending,
    UserMention,
    TurnCompleted,
    TurnFailed,
    TurnIncomplete,
}

impl NotificationSemantic {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "approval_pending" => Ok(Self::ApprovalPending),
            "user_mention" => Ok(Self::UserMention),
            "turn_completed" => Ok(Self::TurnCompleted),
            "turn_failed" => Ok(Self::TurnFailed),
            "turn_incomplete" => Ok(Self::TurnIncomplete),
            _ => anyhow::bail!("unknown Notification semantic: {value}"),
        }
    }

    fn priority(self) -> u8 {
        match self {
            Self::ApprovalPending => 5,
            Self::TurnFailed => 4,
            Self::TurnIncomplete => 3,
            Self::TurnCompleted => 2,
            Self::UserMention => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEpisodeFilter {
    All,
    Unread,
}

impl NotificationEpisodeFilter {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Unread => "unread",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationReasonState {
    Pending,
    Resolved,
    Unacknowledged,
    Acknowledged,
    Unsatisfied,
    Satisfied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationActionKind {
    OpenApproval,
    OpenCampMessage,
    OpenCampTurn,
    OpenCamp,
    AcknowledgeOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationChangeOperation {
    Upsert,
    Remove,
}

impl NotificationChangeOperation {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "upsert" => Ok(Self::Upsert),
            "remove" => Ok(Self::Remove),
            _ => anyhow::bail!("unknown Notification change operation: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationChangeCause {
    OccurrenceAdmitted,
    Acknowledged,
    Satisfied,
    Resolved,
    Cleared,
    Retained,
}

impl NotificationChangeCause {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "occurrence_admitted" => Ok(Self::OccurrenceAdmitted),
            "acknowledged" => Ok(Self::Acknowledged),
            "satisfied" => Ok(Self::Satisfied),
            "resolved" => Ok(Self::Resolved),
            "cleared" => Ok(Self::Cleared),
            "retained" => Ok(Self::Retained),
            _ => anyhow::bail!("unknown Notification change cause: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCampView {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationReasonView {
    pub semantic: NotificationSemantic,
    pub occurrence_count: i64,
    pub unacknowledged_count: i64,
    pub state: NotificationReasonState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationMentionView {
    pub message_id: String,
    pub author_id: String,
    pub author_display_name: Option<String>,
    pub summary: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActionView {
    pub action_id: String,
    pub kind: NotificationActionKind,
    pub available: bool,
    pub camp_id: String,
    pub camp_turn_id: Option<String>,
    pub message_id: Option<String>,
    pub approval_id: Option<String>,
    pub acknowledgement_id: Option<String>,
    pub observed_episode_version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEpisodeView {
    pub id: String,
    pub kind: NotificationEpisodeKind,
    pub episode_version: i64,
    pub attention_revision: i64,
    pub change_sequence: i64,
    pub camp: NotificationCampView,
    pub camp_turn_id: Option<String>,
    pub primary_semantic: NotificationSemantic,
    pub unread: bool,
    pub resolved: bool,
    pub satisfied: bool,
    pub pending_approval_count: i64,
    pub mention_count: i64,
    pub unacknowledged_mention_count: i64,
    pub mention: Option<NotificationMentionView>,
    pub reasons: Vec<NotificationReasonView>,
    pub primary_action: NotificationActionView,
    pub secondary_actions: Vec<NotificationActionView>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEpisodeInbox {
    pub schema_version: i64,
    pub through_change_sequence: i64,
    pub unread_count: i64,
    pub items: Vec<NotificationEpisodeView>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEpisodeChange {
    pub change_sequence: i64,
    pub episode_id: String,
    pub episode_version: i64,
    pub attention_revision: i64,
    pub operation: NotificationChangeOperation,
    pub change_cause: NotificationChangeCause,
    pub heads_up_signal: Option<NotificationHeadsUpSignal>,
    pub heads_up_invalidation: Option<NotificationHeadsUpInvalidation>,
    pub changed_at: String,
    pub episode: Option<NotificationEpisodeView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationHeadsUpSignal {
    pub semantic: NotificationSemantic,
    pub admitted_attention_revision: i64,
    pub action: NotificationActionView,
    pub mention: Option<NotificationMentionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationHeadsUpInvalidation {
    pub kind: NotificationHeadsUpInvalidationKind,
    pub acknowledgement_id: Option<String>,
    pub through_attention_revision: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationHeadsUpInvalidationKind {
    SourceStateChanged,
    AttentionCleared,
    EpisodeRemoved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEpisodeChangeBatch {
    pub schema_version: i64,
    pub requested_after_change_sequence: i64,
    pub next_change_sequence: i64,
    pub through_change_sequence: i64,
    pub reset_required: bool,
    pub has_more: bool,
    pub changes: Vec<NotificationEpisodeChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreference {
    pub heads_up_enabled: bool,
    pub approval_heads_up_enabled: bool,
    pub user_mention_heads_up_enabled: bool,
    pub turn_completed_heads_up_enabled: bool,
    pub turn_incomplete_heads_up_enabled: bool,
    pub version: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcknowledgeNotificationEpisodeCommand {
    pub episode_id: String,
    pub observed_episode_version: i64,
    pub acknowledgement_id: String,
}

impl sealed::Sealed for AcknowledgeNotificationEpisodeCommand {}
impl DomainCommand for AcknowledgeNotificationEpisodeCommand {
    const TYPE: &'static str = "notification_episode.acknowledge";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcknowledgeVisibleNotificationSourcesCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub observed_through_change_sequence: i64,
    pub visible_message_ids: Vec<String>,
    pub visible_camp_turn_ids: Vec<String>,
    pub visible_approval_ids: Vec<String>,
}

impl sealed::Sealed for AcknowledgeVisibleNotificationSourcesCommand {}
impl DomainCommand for AcknowledgeVisibleNotificationSourcesCommand {
    const TYPE: &'static str = "notification_episode.acknowledge_visible_sources";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearNotificationEpisodeCommand {
    pub episode_id: String,
    pub through_attention_revision: i64,
}

impl sealed::Sealed for ClearNotificationEpisodeCommand {}
impl DomainCommand for ClearNotificationEpisodeCommand {
    const TYPE: &'static str = "notification_episode.clear";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkAllNotificationEpisodesReadCommand {
    pub through_change_sequence: i64,
}

impl sealed::Sealed for MarkAllNotificationEpisodesReadCommand {}
impl DomainCommand for MarkAllNotificationEpisodesReadCommand {
    const TYPE: &'static str = "notification_episode.mark_all_read";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateNotificationPreferenceCommand {
    pub expected_version: i64,
    pub heads_up_enabled: bool,
    pub approval_heads_up_enabled: bool,
    pub user_mention_heads_up_enabled: bool,
    pub turn_completed_heads_up_enabled: bool,
    pub turn_incomplete_heads_up_enabled: bool,
}

impl sealed::Sealed for UpdateNotificationPreferenceCommand {}
impl DomainCommand for UpdateNotificationPreferenceCommand {
    const TYPE: &'static str = "notification_episode.preference.update";
}

#[derive(Debug, Default)]
pub struct NotificationEpisodeService {
    gateway: DomainCommandGateway,
}

impl NotificationEpisodeService {
    pub fn maintain_retention(&self, database: &Database) -> Result<()> {
        maintain_notification_episode_retention(database.connection())
    }

    pub fn inbox(
        &self,
        database: &mut Database,
        recipient_user_id: &str,
        filter: NotificationEpisodeFilter,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<NotificationEpisodeInbox> {
        require_recipient(recipient_user_id)?;
        let limit = normalized_limit(limit);
        let cursor = cursor.map(decode_inbox_cursor).transpose()?;
        let transaction = database.connection_mut().transaction()?;
        let (current_sequence, retained_floor_sequence) = change_clock(&transaction)?;
        let through_change_sequence = cursor
            .as_ref()
            .map(|cursor| cursor.through_change_sequence)
            .unwrap_or(current_sequence);
        if through_change_sequence > current_sequence {
            anyhow::bail!("Notification Episode cursor is ahead of the durable high-water");
        }
        if through_change_sequence < retained_floor_sequence {
            anyhow::bail!("Notification Episode cursor is older than the durable floor");
        }
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor.filter != filter)
        {
            anyhow::bail!("Notification Episode cursor filter does not match the request");
        }

        let unread_count =
            unread_episode_count(&transaction, recipient_user_id, through_change_sequence)?;
        let mut ranked = load_episode_page(
            &transaction,
            recipient_user_id,
            filter,
            through_change_sequence,
            cursor.as_ref(),
            limit + 1,
        )?;
        let has_more = ranked.len() > limit;
        if has_more {
            ranked.truncate(limit);
        }
        let next_cursor = if has_more {
            ranked.last().map(|item| {
                encode_inbox_cursor(&InboxCursor {
                    through_change_sequence,
                    filter,
                    priority: item.priority,
                    sort_at: item.sort_at.clone(),
                    episode_id: item.episode.id.clone(),
                })
            })
        } else {
            None
        };
        let items = ranked.into_iter().map(|item| item.episode).collect();
        transaction.commit()?;
        Ok(NotificationEpisodeInbox {
            schema_version: NOTIFICATION_EPISODE_SCHEMA_VERSION,
            through_change_sequence,
            unread_count,
            items,
            next_cursor,
        })
    }

    pub fn changes_since(
        &self,
        database: &mut Database,
        recipient_user_id: &str,
        after_change_sequence: i64,
        limit: usize,
    ) -> Result<NotificationEpisodeChangeBatch> {
        require_recipient(recipient_user_id)?;
        let limit = normalized_limit(limit);
        let transaction = database.connection_mut().transaction()?;
        let (through_change_sequence, retained_floor_sequence) = change_clock(&transaction)?;
        let reset_required = after_change_sequence < retained_floor_sequence
            || after_change_sequence < 0
            || after_change_sequence > through_change_sequence;
        if reset_required {
            transaction.commit()?;
            return Ok(NotificationEpisodeChangeBatch {
                schema_version: NOTIFICATION_EPISODE_SCHEMA_VERSION,
                requested_after_change_sequence: after_change_sequence,
                next_change_sequence: through_change_sequence,
                through_change_sequence,
                reset_required: true,
                has_more: false,
                changes: Vec::new(),
            });
        }

        let mut statement = transaction.prepare(
            r#"
            SELECT change_sequence, episode_id, episode_version, attention_revision,
                   operation, change_cause, heads_up_reason,
                   affected_acknowledgement_id,
                   cleared_through_attention_revision, changed_at
            FROM notification_change_journal
            WHERE change_sequence > ?1 AND change_sequence <= ?2
            ORDER BY change_sequence ASC
            LIMIT ?3
            "#,
        )?;
        let rows = statement.query_map(
            params![
                after_change_sequence,
                through_change_sequence,
                (limit + 1) as i64
            ],
            raw_change_from_row,
        )?;
        let mut raw_changes = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(statement);
        let has_more = raw_changes.len() > limit;
        if has_more {
            raw_changes.truncate(limit);
        }

        let mut changes = Vec::with_capacity(raw_changes.len());
        for raw in raw_changes {
            let persisted_operation = NotificationChangeOperation::parse(&raw.operation)?;
            let heads_up_reason = raw
                .heads_up_reason
                .as_deref()
                .map(NotificationSemantic::parse)
                .transpose()?;
            let change_cause = NotificationChangeCause::parse(&raw.change_cause)?;
            let episode = if persisted_operation == NotificationChangeOperation::Upsert {
                load_episode_by_id(&transaction, recipient_user_id, &raw.episode_id)?
            } else {
                None
            };
            let heads_up_signal = if persisted_operation == NotificationChangeOperation::Upsert {
                heads_up_reason
                    .map(|semantic| {
                        load_heads_up_signal(
                            &transaction,
                            recipient_user_id,
                            &raw.episode_id,
                            raw.change_sequence,
                            semantic,
                        )
                    })
                    .transpose()?
                    .flatten()
            } else {
                None
            };
            let operation = if episode.is_some() {
                NotificationChangeOperation::Upsert
            } else {
                NotificationChangeOperation::Remove
            };
            let heads_up_invalidation = heads_up_invalidation(&raw, change_cause)?;
            changes.push(NotificationEpisodeChange {
                change_sequence: raw.change_sequence,
                episode_id: raw.episode_id,
                episode_version: raw.episode_version,
                attention_revision: raw.attention_revision,
                operation,
                change_cause,
                heads_up_signal,
                heads_up_invalidation,
                changed_at: raw.changed_at,
                episode,
            });
        }
        let next_change_sequence = if has_more {
            changes
                .last()
                .map(|change| change.change_sequence)
                .unwrap_or(after_change_sequence)
        } else {
            through_change_sequence
        };
        transaction.commit()?;
        Ok(NotificationEpisodeChangeBatch {
            schema_version: NOTIFICATION_EPISODE_SCHEMA_VERSION,
            requested_after_change_sequence: after_change_sequence,
            next_change_sequence,
            through_change_sequence,
            reset_required: false,
            has_more,
            changes,
        })
    }

    pub fn preference(&self, database: &Database) -> Result<NotificationPreference> {
        load_preference(database.connection())
    }

    pub fn acknowledge(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcknowledgeNotificationEpisodeCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let payload = &envelope.payload;
            if payload.episode_id.trim().is_empty()
                || payload.acknowledgement_id.trim().is_empty()
                || payload.observed_episode_version < 1
            {
                return Ok(rejected(
                    "notification_episode.invalid_acknowledgement_boundary",
                    "episodeId, acknowledgementId and observedEpisodeVersion must define a valid boundary",
                ));
            }
            let occurrence = transaction
                .query_row(
                    r#"
                    SELECT episode.version, occurrence.admitted_episode_version,
                           disposition.acknowledged_at
                    FROM notification_occurrence AS occurrence
                    JOIN notification_episode AS episode ON episode.id = occurrence.episode_id
                    JOIN notification_occurrence_disposition AS disposition
                      ON disposition.occurrence_id = occurrence.id
                    WHERE occurrence.id = ?1
                      AND occurrence.episode_id = ?2
                      AND occurrence.recipient_user_id = ?3
                    "#,
                    params![
                        payload.acknowledgement_id,
                        payload.episode_id,
                        recipient_user_id
                    ],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((current_version, admitted_version, acknowledged_at)) = occurrence else {
                return Ok(rejected(
                    "notification_episode.acknowledgement_not_found",
                    "acknowledgementId does not belong to this Episode",
                ));
            };
            if payload.observed_episode_version > current_version
                || admitted_version > payload.observed_episode_version
            {
                return Ok(rejected(
                    "notification_episode.stale_acknowledgement_boundary",
                    "the acknowledgement did not exist at the observed Episode version",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = if acknowledged_at.is_none() {
                transaction.execute(
                    r#"
                    UPDATE notification_occurrence_disposition
                    SET acknowledged_at = ?2, updated_at = ?2
                    WHERE occurrence_id = ?1 AND acknowledged_at IS NULL
                    "#,
                    params![payload.acknowledgement_id, now],
                )?
            } else {
                0
            };
            Ok(applied_change(
                "notification_episode.acknowledged",
                changed,
                json!({
                    "episodeId": payload.episode_id,
                    "acknowledgementId": payload.acknowledgement_id,
                    "observedEpisodeVersion": payload.observed_episode_version,
                    "throughChangeSequence": change_clock(transaction)?.0,
                }),
            ))
        })
    }

    pub fn acknowledge_visible_sources(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcknowledgeVisibleNotificationSourcesCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let payload = &envelope.payload;
            let source_count = payload.visible_message_ids.len()
                + payload.visible_camp_turn_ids.len()
                + payload.visible_approval_ids.len();
            if payload.camp_id.trim().is_empty()
                || payload.observed_through_change_sequence < 0
                || source_count == 0
                || source_count > 600
                || payload
                    .visible_message_ids
                    .iter()
                    .chain(&payload.visible_camp_turn_ids)
                    .chain(&payload.visible_approval_ids)
                    .any(|source_id| source_id.trim().is_empty())
            {
                return Ok(rejected(
                    "notification_episode.invalid_visible_sources_boundary",
                    "campId, observedThroughChangeSequence and visible source IDs must define a bounded non-empty observation",
                ));
            }
            let current_sequence = change_clock(transaction)?.0;
            if payload.observed_through_change_sequence > current_sequence {
                return Ok(rejected(
                    "notification_episode.future_visible_sources_boundary",
                    "observedThroughChangeSequence is ahead of the durable high-water",
                ));
            }
            let visible_message_ids = payload
                .visible_message_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            let visible_camp_turn_ids = payload
                .visible_camp_turn_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            let visible_approval_ids = payload
                .visible_approval_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            let occurrence_ids = {
                let mut statement = transaction.prepare(
                    r#"
                    SELECT occurrence.id, occurrence.semantic, occurrence.source_id,
                           disposition.resolved_at
                    FROM notification_occurrence AS occurrence
                    JOIN notification_occurrence_disposition AS disposition
                      ON disposition.occurrence_id = occurrence.id
                    JOIN notification_episode_disposition AS episode_disposition
                      ON episode_disposition.episode_id = occurrence.episode_id
                    WHERE occurrence.recipient_user_id = ?1
                      AND occurrence.camp_id = ?2
                      AND occurrence.admitted_change_sequence <= ?3
                      AND occurrence.admitted_attention_revision
                          > episode_disposition.cleared_through_attention_revision
                      AND disposition.acknowledged_at IS NULL
                    ORDER BY occurrence.admitted_change_sequence, occurrence.id
                    "#,
                )?;
                statement
                    .query_map(
                        params![
                            recipient_user_id,
                            payload.camp_id,
                            payload.observed_through_change_sequence
                        ],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )?
                    .filter_map(|candidate| match candidate {
                        Ok((id, semantic, source_id, resolved_at)) => {
                            let visible = match semantic.as_str() {
                                "user_mention" => visible_message_ids.contains(source_id.as_str()),
                                "turn_completed" | "turn_failed" | "turn_incomplete" => {
                                    visible_camp_turn_ids.contains(source_id.as_str())
                                }
                                "approval_pending" => {
                                    resolved_at.is_none()
                                        && visible_approval_ids.contains(source_id.as_str())
                                }
                                _ => false,
                            };
                            visible.then_some(Ok(id))
                        }
                        Err(error) => Some(Err(error)),
                    })
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            let now = chrono::Utc::now().to_rfc3339();
            let mut changed = 0;
            for occurrence_id in &occurrence_ids {
                changed += transaction.execute(
                    r#"
                    UPDATE notification_occurrence_disposition
                    SET acknowledged_at = ?2, updated_at = ?2
                    WHERE occurrence_id = ?1 AND acknowledged_at IS NULL
                    "#,
                    params![occurrence_id, now],
                )?;
            }
            Ok(applied_change(
                "notification_episode.visible_sources_acknowledged",
                changed,
                json!({
                    "campId": payload.camp_id,
                    "observedThroughChangeSequence": payload.observed_through_change_sequence,
                    "resultingChangeSequence": change_clock(transaction)?.0,
                }),
            ))
        })
    }

    pub fn clear(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClearNotificationEpisodeCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let payload = &envelope.payload;
            if payload.episode_id.trim().is_empty() || payload.through_attention_revision < 1 {
                return Ok(rejected(
                    "notification_episode.invalid_clear_boundary",
                    "episodeId and throughAttentionRevision must define a valid boundary",
                ));
            }
            let current_revision = transaction
                .query_row(
                    r#"
                    SELECT attention_revision
                    FROM notification_episode
                    WHERE id = ?1 AND recipient_user_id = ?2
                    "#,
                    params![payload.episode_id, recipient_user_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(current_revision) = current_revision else {
                return Ok(rejected(
                    "notification_episode.not_found",
                    "Episode does not exist for the current user",
                ));
            };
            if payload.through_attention_revision > current_revision {
                return Ok(rejected(
                    "notification_episode.future_clear_boundary",
                    "throughAttentionRevision is ahead of the Episode",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE notification_episode_disposition
                SET cleared_through_attention_revision = ?2, updated_at = ?3
                WHERE episode_id = ?1
                  AND cleared_through_attention_revision < ?2
                "#,
                params![payload.episode_id, payload.through_attention_revision, now],
            )?;
            Ok(applied_change(
                "notification_episode.cleared",
                changed,
                json!({
                    "episodeId": payload.episode_id,
                    "throughAttentionRevision": payload.through_attention_revision,
                    "throughChangeSequence": change_clock(transaction)?.0,
                }),
            ))
        })
    }

    pub fn mark_all_read(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<MarkAllNotificationEpisodesReadCommand>,
    ) -> Result<CommandExecution> {
        let recipient_user_id = user_id(&envelope.actor)?.to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let through = envelope.payload.through_change_sequence;
            let current = change_clock(transaction)?.0;
            if through < 0 || through > current {
                return Ok(rejected(
                    "notification_episode.invalid_mark_all_boundary",
                    "throughChangeSequence must be within the durable high-water",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let changed = transaction.execute(
                r#"
                UPDATE notification_occurrence_disposition
                SET acknowledged_at = ?3, updated_at = ?3
                WHERE acknowledged_at IS NULL
                  AND occurrence_id IN (
                      SELECT occurrence.id
                      FROM notification_occurrence AS occurrence
                      WHERE occurrence.recipient_user_id = ?1
                        AND occurrence.admitted_change_sequence <= ?2
                  )
                "#,
                params![recipient_user_id, through, now],
            )?;
            Ok(applied_change(
                "notification_episode.all_read",
                changed,
                json!({
                    "throughChangeSequence": through,
                    "resultingChangeSequence": change_clock(transaction)?.0,
                }),
            ))
        })
    }

    pub fn update_preference(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateNotificationPreferenceCommand>,
    ) -> Result<CommandExecution> {
        user_id(&envelope.actor)?;
        self.gateway.execute(database, envelope, |transaction| {
            let current = load_preference(transaction)?;
            if current.version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "notification_episode.preference_conflict",
                    serde_json::to_value(current)?,
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE notification_preference
                SET heads_up_enabled = ?1,
                    approval_heads_up_enabled = ?2,
                    user_mention_heads_up_enabled = ?3,
                    turn_completed_heads_up_enabled = ?4,
                    turn_incomplete_heads_up_enabled = ?5,
                    version = version + 1,
                    updated_at = ?6
                WHERE singleton = 1 AND version = ?7
                "#,
                params![
                    envelope.payload.heads_up_enabled,
                    envelope.payload.approval_heads_up_enabled,
                    envelope.payload.user_mention_heads_up_enabled,
                    envelope.payload.turn_completed_heads_up_enabled,
                    envelope.payload.turn_incomplete_heads_up_enabled,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            let preference = load_preference(transaction)?;
            Ok(CommandHandlerResult::applied(
                "notification_episode.preference_updated",
                serde_json::to_value(&preference)?,
                Some(EntityReference {
                    entity_type: "notification_preference".to_string(),
                    entity_id: "1".to_string(),
                }),
            ))
        })
    }
}

#[derive(Debug)]
struct InboxCursor {
    through_change_sequence: i64,
    filter: NotificationEpisodeFilter,
    priority: i64,
    sort_at: String,
    episode_id: String,
}

#[derive(Debug)]
struct RawEpisode {
    id: String,
    kind: String,
    camp_id: String,
    camp_title: String,
    camp_turn_id: Option<String>,
    version: i64,
    attention_revision: i64,
    last_change_sequence: i64,
    sort_at: String,
    created_at: String,
    updated_at: String,
    cleared_through_attention_revision: i64,
    priority: i64,
}

#[derive(Debug)]
struct RankedEpisode {
    priority: i64,
    sort_at: String,
    episode: NotificationEpisodeView,
}

#[derive(Debug)]
struct RawOccurrence {
    id: String,
    semantic: NotificationSemantic,
    occurred_at: String,
    camp_turn_id: Option<String>,
    source_message_id: Option<String>,
    approval_id: Option<String>,
    admitted_attention_revision: i64,
    acknowledged: bool,
    satisfied: bool,
    resolved: bool,
    source_available: bool,
    author_id: Option<String>,
    author_display_name: Option<String>,
    structured_content_json: Option<String>,
}

impl RawOccurrence {
    fn is_unread(&self) -> bool {
        !self.acknowledged
            && (self.semantic != NotificationSemantic::TurnCompleted || !self.satisfied)
    }

    fn is_active_attention(&self, cleared_through_attention_revision: i64) -> bool {
        self.admitted_attention_revision > cleared_through_attention_revision && self.is_unread()
    }
}

#[derive(Debug)]
struct RawChange {
    change_sequence: i64,
    episode_id: String,
    episode_version: i64,
    attention_revision: i64,
    operation: String,
    change_cause: String,
    heads_up_reason: Option<String>,
    affected_acknowledgement_id: Option<String>,
    cleared_through_attention_revision: Option<i64>,
    changed_at: String,
}

fn heads_up_invalidation(
    change: &RawChange,
    cause: NotificationChangeCause,
) -> Result<Option<NotificationHeadsUpInvalidation>> {
    let invalidation = match cause {
        NotificationChangeCause::Acknowledged
        | NotificationChangeCause::Satisfied
        | NotificationChangeCause::Resolved => NotificationHeadsUpInvalidation {
            kind: NotificationHeadsUpInvalidationKind::SourceStateChanged,
            acknowledgement_id: Some(
                change
                    .affected_acknowledgement_id
                    .clone()
                    .context("notification disposition change lacks acknowledgement identity")?,
            ),
            through_attention_revision: None,
        },
        NotificationChangeCause::Cleared => NotificationHeadsUpInvalidation {
            kind: NotificationHeadsUpInvalidationKind::AttentionCleared,
            acknowledgement_id: None,
            through_attention_revision: Some(
                change
                    .cleared_through_attention_revision
                    .context("notification clear change lacks attention boundary")?,
            ),
        },
        NotificationChangeCause::Retained => NotificationHeadsUpInvalidation {
            kind: NotificationHeadsUpInvalidationKind::EpisodeRemoved,
            acknowledgement_id: None,
            through_attention_revision: None,
        },
        NotificationChangeCause::OccurrenceAdmitted => return Ok(None),
    };
    Ok(Some(invalidation))
}

fn normalized_limit(limit: usize) -> usize {
    if limit == 0 {
        DEFAULT_PAGE_LIMIT
    } else {
        limit.min(MAX_PAGE_LIMIT)
    }
}

fn change_clock(connection: &rusqlite::Connection) -> Result<(i64, i64)> {
    connection
        .query_row(
            r#"
            SELECT current_sequence, retained_floor_sequence
            FROM notification_change_clock WHERE singleton = 1
            "#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("Notification change clock is missing")
}

fn unread_episode_count(
    connection: &rusqlite::Connection,
    recipient_user_id: &str,
    through_change_sequence: i64,
) -> Result<i64> {
    connection
        .query_row(
            r#"
        SELECT COUNT(*)
        FROM notification_episode AS episode
        JOIN notification_episode_disposition AS episode_disposition
          ON episode_disposition.episode_id = episode.id
        WHERE episode.recipient_user_id = ?1
          AND episode.created_change_sequence <= ?2
          AND episode.attention_revision
              > episode_disposition.cleared_through_attention_revision
          AND EXISTS (
              SELECT 1
              FROM notification_occurrence AS occurrence
              JOIN notification_occurrence_disposition AS disposition
                ON disposition.occurrence_id = occurrence.id
              WHERE occurrence.episode_id = episode.id
                AND occurrence.admitted_change_sequence <= ?2
                AND occurrence.admitted_attention_revision
                    > episode_disposition.cleared_through_attention_revision
                AND disposition.acknowledged_at IS NULL
                AND (
                    occurrence.semantic <> 'turn_completed'
                    OR disposition.satisfied_at IS NULL
                )
          )
        "#,
            params![recipient_user_id, through_change_sequence],
            |row| row.get(0),
        )
        .context("failed to count unread Notification Episodes")
}

fn load_episode_page(
    transaction: &Transaction<'_>,
    recipient_user_id: &str,
    filter: NotificationEpisodeFilter,
    through_change_sequence: i64,
    cursor: Option<&InboxCursor>,
    limit: usize,
) -> Result<Vec<RankedEpisode>> {
    let mut statement = transaction.prepare(
        r#"
        WITH ranked AS (
            SELECT episode.id, episode.kind, episode.camp_id, camp.title,
                   episode.camp_turn_id, episode.version, episode.attention_revision,
                   episode.last_change_sequence,
                   COALESCE((
                       SELECT MAX(boundary_occurrence.occurred_at)
                       FROM notification_occurrence AS boundary_occurrence
                       WHERE boundary_occurrence.episode_id = episode.id
                         AND boundary_occurrence.admitted_change_sequence <= :through
                   ), episode.sort_at) AS boundary_sort_at,
                   episode.created_at, episode.updated_at,
                   episode_disposition.cleared_through_attention_revision,
                   CASE
                       WHEN episode.kind = 'approval' AND EXISTS (
                           SELECT 1
                           FROM notification_occurrence AS occurrence
                           JOIN notification_occurrence_disposition AS disposition
                             ON disposition.occurrence_id = occurrence.id
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.admitted_attention_revision
                                 > episode_disposition.cleared_through_attention_revision
                             AND disposition.resolved_at IS NULL
                       ) THEN 500
                       WHEN EXISTS (
                           SELECT 1 FROM notification_occurrence AS occurrence
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.admitted_attention_revision
                                 > episode_disposition.cleared_through_attention_revision
                             AND occurrence.semantic = 'turn_failed'
                       ) THEN 400
                       WHEN EXISTS (
                           SELECT 1 FROM notification_occurrence AS occurrence
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.admitted_attention_revision
                                 > episode_disposition.cleared_through_attention_revision
                             AND occurrence.semantic = 'turn_incomplete'
                       ) THEN 300
                       WHEN EXISTS (
                           SELECT 1
                           FROM notification_occurrence AS occurrence
                           JOIN notification_occurrence_disposition AS disposition
                             ON disposition.occurrence_id = occurrence.id
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.admitted_attention_revision
                                 > episode_disposition.cleared_through_attention_revision
                             AND occurrence.semantic = 'turn_completed'
                             AND disposition.satisfied_at IS NULL
                       ) THEN 200
                       WHEN EXISTS (
                           SELECT 1 FROM notification_occurrence AS occurrence
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.admitted_attention_revision
                                 > episode_disposition.cleared_through_attention_revision
                             AND occurrence.semantic = 'user_mention'
                       ) THEN 100
                       WHEN episode.kind = 'approval' THEN 50
                       WHEN EXISTS (
                           SELECT 1 FROM notification_occurrence AS occurrence
                           WHERE occurrence.episode_id = episode.id
                             AND occurrence.admitted_change_sequence <= :through
                             AND occurrence.semantic = 'turn_completed'
                       ) THEN 40
                       ELSE 0
                   END AS priority
            FROM notification_episode AS episode
            JOIN notification_episode_disposition AS episode_disposition
              ON episode_disposition.episode_id = episode.id
            JOIN camp ON camp.id = episode.camp_id
            WHERE episode.recipient_user_id = :recipient
              AND episode.created_change_sequence <= :through
              AND episode.attention_revision
                  > episode_disposition.cleared_through_attention_revision
              AND (
                  :filter = 'all'
                  OR EXISTS (
                      SELECT 1
                      FROM notification_occurrence AS occurrence
                      JOIN notification_occurrence_disposition AS disposition
                        ON disposition.occurrence_id = occurrence.id
                      WHERE occurrence.episode_id = episode.id
                        AND occurrence.admitted_change_sequence <= :through
                        AND occurrence.admitted_attention_revision
                            > episode_disposition.cleared_through_attention_revision
                        AND disposition.acknowledged_at IS NULL
                        AND (
                            occurrence.semantic <> 'turn_completed'
                            OR disposition.satisfied_at IS NULL
                        )
                  )
              )
        )
        SELECT id, kind, camp_id, title, camp_turn_id, version,
               attention_revision, last_change_sequence, boundary_sort_at,
               created_at, updated_at, cleared_through_attention_revision, priority
        FROM ranked
        WHERE :cursor_priority IS NULL
           OR priority < :cursor_priority
           OR (priority = :cursor_priority AND boundary_sort_at < :cursor_sort_at)
           OR (priority = :cursor_priority AND boundary_sort_at = :cursor_sort_at
               AND id < :cursor_episode_id)
        ORDER BY priority DESC, boundary_sort_at DESC, id DESC
        LIMIT :limit
        "#,
    )?;
    let cursor_priority = cursor.map(|cursor| cursor.priority);
    let cursor_sort_at = cursor.map(|cursor| cursor.sort_at.as_str());
    let cursor_episode_id = cursor.map(|cursor| cursor.episode_id.as_str());
    let rows = statement.query_map(
        named_params! {
            ":recipient": recipient_user_id,
            ":through": through_change_sequence,
            ":filter": filter.as_str(),
            ":cursor_priority": cursor_priority,
            ":cursor_sort_at": cursor_sort_at,
            ":cursor_episode_id": cursor_episode_id,
            ":limit": limit as i64,
        },
        raw_episode_from_row,
    )?;
    let raw = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    raw.into_iter()
        .map(|raw| {
            let priority = raw.priority;
            let sort_at = raw.sort_at.clone();
            Ok(RankedEpisode {
                priority,
                sort_at,
                episode: hydrate_episode(transaction, raw)?,
            })
        })
        .collect()
}

fn load_episode_by_id(
    transaction: &Transaction<'_>,
    recipient_user_id: &str,
    episode_id: &str,
) -> Result<Option<NotificationEpisodeView>> {
    load_raw_episode_by_id(transaction, recipient_user_id, episode_id)?
        .map(|raw| hydrate_episode(transaction, raw))
        .transpose()
}

fn load_raw_episode_by_id(
    connection: &rusqlite::Connection,
    recipient_user_id: &str,
    episode_id: &str,
) -> Result<Option<RawEpisode>> {
    connection
        .query_row(
            r#"
            SELECT episode.id, episode.kind, episode.camp_id, camp.title,
                   episode.camp_turn_id, episode.version, episode.attention_revision,
                   episode.last_change_sequence, episode.sort_at,
                   episode.created_at, episode.updated_at,
                   disposition.cleared_through_attention_revision, 0
            FROM notification_episode AS episode
            JOIN notification_episode_disposition AS disposition
              ON disposition.episode_id = episode.id
            JOIN camp ON camp.id = episode.camp_id
            WHERE episode.id = ?1 AND episode.recipient_user_id = ?2
              AND episode.attention_revision
                  > disposition.cleared_through_attention_revision
            "#,
            params![episode_id, recipient_user_id],
            raw_episode_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn raw_episode_from_row(row: &Row<'_>) -> rusqlite::Result<RawEpisode> {
    Ok(RawEpisode {
        id: row.get(0)?,
        kind: row.get(1)?,
        camp_id: row.get(2)?,
        camp_title: row.get(3)?,
        camp_turn_id: row.get(4)?,
        version: row.get(5)?,
        attention_revision: row.get(6)?,
        last_change_sequence: row.get(7)?,
        sort_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        cleared_through_attention_revision: row.get(11)?,
        priority: row.get(12)?,
    })
}

fn load_heads_up_signal(
    connection: &rusqlite::Connection,
    recipient_user_id: &str,
    episode_id: &str,
    change_sequence: i64,
    semantic: NotificationSemantic,
) -> Result<Option<NotificationHeadsUpSignal>> {
    let Some(episode) = load_raw_episode_by_id(connection, recipient_user_id, episode_id)? else {
        return Ok(None);
    };
    let tuple = connection
        .query_row(
            r#"
            SELECT occurrence.id, occurrence.semantic, occurrence.occurred_at,
                   occurrence.camp_turn_id, occurrence.source_message_id,
                   occurrence.approval_id, occurrence.admitted_attention_revision,
                   occurrence.admitted_change_sequence,
                   CASE WHEN disposition.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END,
                   CASE WHEN disposition.satisfied_at IS NOT NULL THEN 1 ELSE 0 END,
                   CASE WHEN disposition.resolved_at IS NOT NULL THEN 1 ELSE 0 END,
                   CASE
                       WHEN occurrence.semantic = 'user_mention'
                           THEN CASE WHEN message.id IS NOT NULL
                                          AND message.tombstoned_at IS NULL THEN 1 ELSE 0 END
                       WHEN occurrence.semantic = 'approval_pending'
                           THEN CASE WHEN approval.id IS NOT NULL
                                          AND approval.status = 'pending' THEN 1 ELSE 0 END
                       ELSE CASE WHEN turn.id IS NOT NULL THEN 1 ELSE 0 END
                   END,
                   message.author_id, profile.display_name,
                   message.structured_content_json
            FROM notification_occurrence AS occurrence
            JOIN notification_occurrence_disposition AS disposition
              ON disposition.occurrence_id = occurrence.id
            LEFT JOIN camp_message AS message
              ON message.id = occurrence.source_message_id
             AND message.camp_id = occurrence.camp_id
            LEFT JOIN agent_profile AS profile ON profile.id = message.author_id
            LEFT JOIN camp_turn AS turn ON turn.id = occurrence.camp_turn_id
            LEFT JOIN approval ON approval.id = occurrence.approval_id
            WHERE occurrence.episode_id = ?1
              AND occurrence.admitted_change_sequence = ?2
            "#,
            params![episode_id, change_sequence],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, bool>(8)?,
                    row.get::<_, bool>(9)?,
                    row.get::<_, bool>(10)?,
                    row.get::<_, bool>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        persisted_semantic,
        occurred_at,
        camp_turn_id,
        source_message_id,
        approval_id,
        admitted_attention_revision,
        _admitted_change_sequence,
        acknowledged,
        satisfied,
        resolved,
        source_available,
        author_id,
        author_display_name,
        structured_content_json,
    )) = tuple
    else {
        return Ok(None);
    };
    let occurrence = RawOccurrence {
        id,
        semantic: NotificationSemantic::parse(&persisted_semantic)?,
        occurred_at,
        camp_turn_id,
        source_message_id,
        approval_id,
        admitted_attention_revision,
        acknowledged,
        satisfied,
        resolved,
        source_available,
        author_id,
        author_display_name,
        structured_content_json,
    };
    if occurrence.semantic != semantic
        || !occurrence.is_active_attention(episode.cleared_through_attention_revision)
        || (semantic == NotificationSemantic::ApprovalPending && occurrence.resolved)
    {
        return Ok(None);
    }
    let mention =
        (semantic == NotificationSemantic::UserMention).then(|| NotificationMentionView {
            message_id: occurrence.source_message_id.clone().unwrap_or_default(),
            author_id: occurrence.author_id.clone().unwrap_or_default(),
            author_display_name: occurrence.author_display_name.clone(),
            summary: message_summary(connection, &occurrence),
            available: occurrence.source_available,
        });
    Ok(Some(NotificationHeadsUpSignal {
        semantic,
        admitted_attention_revision: occurrence.admitted_attention_revision,
        action: action_for_occurrence(&episode, &occurrence, true),
        mention,
    }))
}

fn hydrate_episode(
    connection: &rusqlite::Connection,
    raw: RawEpisode,
) -> Result<NotificationEpisodeView> {
    let kind = NotificationEpisodeKind::parse(&raw.kind)?;
    let mut statement = connection.prepare(
        r#"
        SELECT occurrence.id, occurrence.semantic, occurrence.occurred_at,
               occurrence.camp_turn_id, occurrence.source_message_id,
               occurrence.approval_id, occurrence.admitted_attention_revision,
               occurrence.admitted_change_sequence,
               CASE WHEN disposition.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END,
               CASE WHEN disposition.satisfied_at IS NOT NULL THEN 1 ELSE 0 END,
               CASE WHEN disposition.resolved_at IS NOT NULL THEN 1 ELSE 0 END,
               CASE
                   WHEN occurrence.semantic = 'user_mention'
                       THEN CASE WHEN message.id IS NOT NULL
                                      AND message.tombstoned_at IS NULL THEN 1 ELSE 0 END
                   WHEN occurrence.semantic = 'approval_pending'
                       THEN CASE WHEN approval.id IS NOT NULL
                                      AND approval.status = 'pending' THEN 1 ELSE 0 END
                   ELSE CASE WHEN turn.id IS NOT NULL THEN 1 ELSE 0 END
               END,
               message.author_id, profile.display_name,
               message.structured_content_json
        FROM notification_occurrence AS occurrence
        JOIN notification_occurrence_disposition AS disposition
          ON disposition.occurrence_id = occurrence.id
        LEFT JOIN camp_message AS message
          ON message.id = occurrence.source_message_id
         AND message.camp_id = occurrence.camp_id
        LEFT JOIN agent_profile AS profile ON profile.id = message.author_id
        LEFT JOIN camp_turn AS turn ON turn.id = occurrence.camp_turn_id
        LEFT JOIN approval ON approval.id = occurrence.approval_id
        WHERE occurrence.episode_id = ?1
        ORDER BY occurrence.occurred_at ASC, occurrence.id ASC
        "#,
    )?;
    let rows = statement.query_map([raw.id.as_str()], |row| {
        let semantic: String = row.get(1)?;
        Ok((
            row.get::<_, String>(0)?,
            semantic,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, bool>(8)?,
            row.get::<_, bool>(9)?,
            row.get::<_, bool>(10)?,
            row.get::<_, bool>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<String>>(14)?,
        ))
    })?;
    let tuples = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    let occurrences = tuples
        .into_iter()
        .map(
            |(
                id,
                semantic,
                occurred_at,
                camp_turn_id,
                source_message_id,
                approval_id,
                admitted_attention_revision,
                _admitted_change_sequence,
                acknowledged,
                satisfied,
                resolved,
                source_available,
                author_id,
                author_display_name,
                structured_content_json,
            )| {
                Ok(RawOccurrence {
                    id,
                    semantic: NotificationSemantic::parse(&semantic)?,
                    occurred_at,
                    camp_turn_id,
                    source_message_id,
                    approval_id,
                    admitted_attention_revision,
                    acknowledged,
                    satisfied,
                    resolved,
                    source_available,
                    author_id,
                    author_display_name,
                    structured_content_json,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    if occurrences.is_empty() {
        anyhow::bail!("Notification Episode has no Occurrences");
    }

    let primary_semantic = occurrences
        .iter()
        .max_by_key(|occurrence| match occurrence.semantic {
            NotificationSemantic::ApprovalPending => 5,
            NotificationSemantic::TurnFailed => 4,
            NotificationSemantic::TurnIncomplete => 3,
            NotificationSemantic::TurnCompleted if !occurrence.satisfied => 2,
            NotificationSemantic::UserMention => 1,
            NotificationSemantic::TurnCompleted => 0,
        })
        .map(|occurrence| occurrence.semantic)
        .context("Notification Episode has no primary semantic")?;
    let active_attention = occurrences
        .iter()
        .filter(|occurrence| occurrence.is_active_attention(raw.cleared_through_attention_revision))
        .collect::<Vec<_>>();
    let unread = !active_attention.is_empty();
    let resolved = kind == NotificationEpisodeKind::Approval
        && occurrences.iter().all(|occurrence| occurrence.resolved);
    let completion_occurrences = occurrences
        .iter()
        .filter(|occurrence| occurrence.semantic == NotificationSemantic::TurnCompleted)
        .collect::<Vec<_>>();
    let satisfied = !completion_occurrences.is_empty()
        && completion_occurrences
            .iter()
            .all(|occurrence| occurrence.satisfied);
    let pending_approval_count = occurrences
        .iter()
        .filter(|occurrence| {
            occurrence.semantic == NotificationSemantic::ApprovalPending && !occurrence.resolved
        })
        .count() as i64;
    let mentions = occurrences
        .iter()
        .filter(|occurrence| occurrence.semantic == NotificationSemantic::UserMention)
        .collect::<Vec<_>>();
    let unacknowledged_mentions = mentions
        .iter()
        .filter(|occurrence| {
            occurrence.admitted_attention_revision > raw.cleared_through_attention_revision
                && !occurrence.acknowledged
        })
        .copied()
        .collect::<Vec<_>>();
    let selected_mention = unacknowledged_mentions
        .first()
        .copied()
        .or_else(|| mentions.first().copied());
    let mention = selected_mention.map(|occurrence| NotificationMentionView {
        message_id: occurrence.source_message_id.clone().unwrap_or_default(),
        author_id: occurrence.author_id.clone().unwrap_or_default(),
        author_display_name: occurrence.author_display_name.clone(),
        summary: message_summary(connection, occurrence),
        available: occurrence.source_available,
    });

    let attention_occurrence = if kind == NotificationEpisodeKind::Approval {
        active_attention
            .iter()
            .copied()
            .find(|occurrence| !occurrence.resolved)
            .or_else(|| active_attention.first().copied())
    } else {
        active_attention.iter().copied().max_by(|left, right| {
            left.semantic
                .priority()
                .cmp(&right.semantic.priority())
                .then_with(|| right.occurred_at.cmp(&left.occurred_at))
                .then_with(|| right.id.cmp(&left.id))
        })
    };
    let display_occurrence = occurrences
        .iter()
        .filter(|occurrence| occurrence.semantic == primary_semantic)
        .min_by(|left, right| {
            left.occurred_at
                .cmp(&right.occurred_at)
                .then_with(|| left.id.cmp(&right.id))
        })
        .context("primary Notification Occurrence is missing")?;
    let action_occurrence = attention_occurrence.unwrap_or(display_occurrence);
    let primary_action = if kind == NotificationEpisodeKind::Approval
        && attention_occurrence.is_some_and(|occurrence| occurrence.resolved)
    {
        acknowledge_only_action(&raw, action_occurrence)
    } else {
        action_for_occurrence(&raw, action_occurrence, attention_occurrence.is_some())
    };
    let mut secondary_actions = Vec::new();
    if primary_action.kind != NotificationActionKind::OpenCampMessage
        && let Some(mention_occurrence) = unacknowledged_mentions.first().copied()
    {
        secondary_actions.push(action_for_occurrence(&raw, mention_occurrence, true));
    }
    if primary_action.kind != NotificationActionKind::OpenCampTurn
        && let Some(camp_turn_id) = raw.camp_turn_id.as_deref()
    {
        let available = connection
            .query_row(
                "SELECT 1 FROM camp_turn WHERE id = ?1 AND camp_id = ?2",
                params![camp_turn_id, raw.camp_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        secondary_actions.push(action_view(
            &raw,
            NotificationActionKind::OpenCampTurn,
            available,
            Some(camp_turn_id.to_string()),
            None,
            None,
            None,
            "turn",
        ));
    }
    secondary_actions.push(action_view(
        &raw,
        NotificationActionKind::OpenCamp,
        true,
        None,
        None,
        None,
        None,
        "camp",
    ));

    Ok(NotificationEpisodeView {
        id: raw.id.clone(),
        kind,
        episode_version: raw.version,
        attention_revision: raw.attention_revision,
        change_sequence: raw.last_change_sequence,
        camp: NotificationCampView {
            id: raw.camp_id.clone(),
            title: raw.camp_title,
        },
        camp_turn_id: raw.camp_turn_id.clone(),
        primary_semantic,
        unread,
        resolved,
        satisfied,
        pending_approval_count,
        mention_count: mentions.len() as i64,
        unacknowledged_mention_count: unacknowledged_mentions.len() as i64,
        mention,
        reasons: reason_views(&occurrences, raw.cleared_through_attention_revision),
        primary_action,
        secondary_actions,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

fn reason_views(
    occurrences: &[RawOccurrence],
    cleared_through_attention_revision: i64,
) -> Vec<NotificationReasonView> {
    let semantics = [
        NotificationSemantic::ApprovalPending,
        NotificationSemantic::TurnFailed,
        NotificationSemantic::TurnIncomplete,
        NotificationSemantic::TurnCompleted,
        NotificationSemantic::UserMention,
    ];
    semantics
        .into_iter()
        .filter_map(|semantic| {
            let matching = occurrences
                .iter()
                .filter(|occurrence| occurrence.semantic == semantic)
                .collect::<Vec<_>>();
            if matching.is_empty() {
                return None;
            }
            let active = matching
                .iter()
                .filter(|occurrence| {
                    occurrence.is_active_attention(cleared_through_attention_revision)
                })
                .copied()
                .collect::<Vec<_>>();
            let unacknowledged_count = active
                .iter()
                .filter(|occurrence| !occurrence.acknowledged)
                .count() as i64;
            let state = match semantic {
                NotificationSemantic::ApprovalPending => {
                    if matching.iter().all(|occurrence| occurrence.resolved) {
                        NotificationReasonState::Resolved
                    } else {
                        NotificationReasonState::Pending
                    }
                }
                NotificationSemantic::TurnCompleted => {
                    if matching.iter().all(|occurrence| occurrence.satisfied) {
                        NotificationReasonState::Satisfied
                    } else if unacknowledged_count == 0 {
                        NotificationReasonState::Acknowledged
                    } else {
                        NotificationReasonState::Unsatisfied
                    }
                }
                NotificationSemantic::UserMention
                | NotificationSemantic::TurnFailed
                | NotificationSemantic::TurnIncomplete => {
                    if unacknowledged_count == 0 {
                        NotificationReasonState::Acknowledged
                    } else {
                        NotificationReasonState::Unacknowledged
                    }
                }
            };
            Some(NotificationReasonView {
                semantic,
                occurrence_count: matching.len() as i64,
                unacknowledged_count,
                state,
            })
        })
        .collect()
}

fn message_summary(
    connection: &rusqlite::Connection,
    occurrence: &RawOccurrence,
) -> Option<String> {
    if !occurrence.source_available {
        return None;
    }
    let content: StructuredCampMessageContent =
        serde_json::from_str(occurrence.structured_content_json.as_deref()?).ok()?;
    validate_content(&content).ok()?;
    let body = render_current_plain_text(connection, &content).ok()?;
    Some(bounded_message_summary(&body))
}

fn action_for_occurrence(
    episode: &RawEpisode,
    occurrence: &RawOccurrence,
    acknowledge: bool,
) -> NotificationActionView {
    let acknowledgement_id = acknowledge.then(|| occurrence.id.clone());
    match occurrence.semantic {
        NotificationSemantic::ApprovalPending => action_view(
            episode,
            NotificationActionKind::OpenApproval,
            occurrence.source_available,
            None,
            None,
            occurrence.approval_id.clone(),
            acknowledgement_id,
            &occurrence.id,
        ),
        NotificationSemantic::UserMention => action_view(
            episode,
            NotificationActionKind::OpenCampMessage,
            occurrence.source_available,
            occurrence.camp_turn_id.clone(),
            occurrence.source_message_id.clone(),
            None,
            acknowledgement_id,
            &occurrence.id,
        ),
        NotificationSemantic::TurnCompleted
        | NotificationSemantic::TurnFailed
        | NotificationSemantic::TurnIncomplete => action_view(
            episode,
            NotificationActionKind::OpenCampTurn,
            occurrence.source_available,
            occurrence.camp_turn_id.clone(),
            None,
            None,
            acknowledgement_id,
            &occurrence.id,
        ),
    }
}

fn acknowledge_only_action(
    episode: &RawEpisode,
    occurrence: &RawOccurrence,
) -> NotificationActionView {
    action_view(
        episode,
        NotificationActionKind::AcknowledgeOnly,
        true,
        None,
        None,
        None,
        Some(occurrence.id.clone()),
        &occurrence.id,
    )
}

#[allow(clippy::too_many_arguments)]
fn action_view(
    episode: &RawEpisode,
    kind: NotificationActionKind,
    available: bool,
    camp_turn_id: Option<String>,
    message_id: Option<String>,
    approval_id: Option<String>,
    acknowledgement_id: Option<String>,
    discriminator: &str,
) -> NotificationActionView {
    NotificationActionView {
        action_id: format!(
            "notification-action-v1:{}:{}:{}",
            episode.id, episode.version, discriminator
        ),
        kind,
        available,
        camp_id: episode.camp_id.clone(),
        camp_turn_id,
        message_id,
        approval_id,
        acknowledgement_id,
        observed_episode_version: episode.version,
    }
}

fn bounded_message_summary(body: &str) -> String {
    if body.chars().count() <= MESSAGE_SUMMARY_MAX_SCALARS {
        return body.to_string();
    }
    body.chars()
        .take(MESSAGE_SUMMARY_MAX_SCALARS - 1)
        .chain(std::iter::once('…'))
        .collect()
}

fn raw_change_from_row(row: &Row<'_>) -> rusqlite::Result<RawChange> {
    Ok(RawChange {
        change_sequence: row.get(0)?,
        episode_id: row.get(1)?,
        episode_version: row.get(2)?,
        attention_revision: row.get(3)?,
        operation: row.get(4)?,
        change_cause: row.get(5)?,
        heads_up_reason: row.get(6)?,
        affected_acknowledgement_id: row.get(7)?,
        cleared_through_attention_revision: row.get(8)?,
        changed_at: row.get(9)?,
    })
}

fn load_preference(connection: &rusqlite::Connection) -> Result<NotificationPreference> {
    connection
        .query_row(
            r#"
            SELECT heads_up_enabled, approval_heads_up_enabled,
                   user_mention_heads_up_enabled, turn_completed_heads_up_enabled,
                   turn_incomplete_heads_up_enabled, version, updated_at
            FROM notification_preference WHERE singleton = 1
            "#,
            [],
            |row| {
                Ok(NotificationPreference {
                    heads_up_enabled: row.get(0)?,
                    approval_heads_up_enabled: row.get(1)?,
                    user_mention_heads_up_enabled: row.get(2)?,
                    turn_completed_heads_up_enabled: row.get(3)?,
                    turn_incomplete_heads_up_enabled: row.get(4)?,
                    version: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()?
        .context("Notification preference is missing")
}

fn encode_inbox_cursor(cursor: &InboxCursor) -> String {
    format!(
        "{:016x}|{}|{}|{}|{}",
        cursor.through_change_sequence,
        cursor.filter.as_str(),
        cursor.priority,
        cursor.sort_at,
        cursor.episode_id
    )
}

fn decode_inbox_cursor(value: &str) -> Result<InboxCursor> {
    let mut parts = value.splitn(5, '|');
    let through = parts
        .next()
        .context("Notification Episode cursor is invalid")?;
    let filter = parts
        .next()
        .context("Notification Episode cursor is invalid")?;
    let priority = parts
        .next()
        .context("Notification Episode cursor is invalid")?;
    let sort_at = parts
        .next()
        .context("Notification Episode cursor is invalid")?;
    let episode_id = parts
        .next()
        .context("Notification Episode cursor is invalid")?;
    let through_change_sequence = i64::from_str_radix(through, 16)
        .context("Notification Episode cursor high-water is invalid")?;
    let priority = priority
        .parse::<i64>()
        .context("Notification Episode cursor priority is invalid")?;
    let filter = match filter {
        "all" => NotificationEpisodeFilter::All,
        "unread" => NotificationEpisodeFilter::Unread,
        _ => anyhow::bail!("Notification Episode cursor filter is invalid"),
    };
    if through_change_sequence < 0
        || priority < 0
        || sort_at.is_empty()
        || sort_at.len() > 64
        || episode_id.is_empty()
        || episode_id.len() > 128
        || sort_at.contains('|')
        || episode_id.contains('|')
    {
        anyhow::bail!("Notification Episode cursor is invalid");
    }
    Ok(InboxCursor {
        through_change_sequence,
        filter,
        priority,
        sort_at: sort_at.to_string(),
        episode_id: episode_id.to_string(),
    })
}

fn require_recipient(recipient_user_id: &str) -> Result<()> {
    if recipient_user_id != CURRENT_USER_ID {
        anyhow::bail!("Notification Episode reads require the current user");
    }
    Ok(())
}

fn user_id(actor: &ActorRef) -> Result<&str> {
    match actor {
        ActorRef::User { user_id } if user_id == CURRENT_USER_ID => Ok(user_id),
        _ => anyhow::bail!("Notification Episode commands require the current User Actor"),
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

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;
    use uuid::Uuid;

    fn test_database() -> (std::path::PathBuf, Database) {
        let directory = std::env::temp_dir().join(format!("rovai-episode-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("Notification database should open");
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
            .unwrap();
    }

    fn insert_turn(database: &Database, turn_id: &str, camp_id: &str, status: &str) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, 'system_event', ?1, ?3, 1,
                    '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                )
                "#,
                params![turn_id, camp_id, status],
            )
            .unwrap();
    }

    fn insert_mention(
        database: &Database,
        message_id: &str,
        camp_id: &str,
        turn_id: Option<&str>,
        sequence: i64,
        occurred_at: &str,
    ) {
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, camp_turn_id,
                    version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, 'agent', 'agent_1', '@你 请确认',
                    '[{"kind":"current_user_mention","userId":"local_user"},{"kind":"text","text":"请确认"}]',
                    ?1, 'default', '[]', ?4, 1, ?5, ?5
                )
                "#,
                params![message_id, camp_id, sequence, turn_id, occurred_at],
            )
            .unwrap();
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
                    start_reason, purpose, completion_role,
                    effective_config_json, workspace_json, permission_semantics,
                    status, idempotency_key, version, created_at, updated_at
                ) VALUES (
                    'run-attention', 'turn-attention', 'conversation-attention', 0, 0,
                    'attention', 0, 'initial', 'permission fixture', 'required',
                    '{}', NULL, 'runtime_managed_v2', 'running', 'attention', 1,
                    '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
                );
                "#,
            )
            .unwrap();
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
            .unwrap();
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
                    'native permission fixture', 'local_user', '1',
                    'pending', 1, ?3, ?3,
                    '[{"optionId":"deny","kind":"deny","label":"拒绝","consequence":"拒绝","nativeResponseDigest":"digest"}]'
                )
                "#,
                params![approval_id, action_id, requested_at],
            )
            .unwrap();
    }

    fn envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn collaboration_episode_aggregates_mentions_and_separates_display_from_attention() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-episode", "协作事项");
        insert_turn(&database, "turn-episode", "camp-episode", "running");
        insert_mention(
            &database,
            "message-one",
            "camp-episode",
            Some("turn-episode"),
            1,
            "2026-08-01T00:01:00Z",
        );
        insert_mention(
            &database,
            "message-two",
            "camp-episode",
            Some("turn-episode"),
            2,
            "2026-08-01T00:02:00Z",
        );
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'failed', version = 2,
                    ended_at = '2026-08-01T00:03:00Z',
                    updated_at = '2026-08-01T00:03:00Z'
                WHERE id = 'turn-episode'
                "#,
                [],
            )
            .unwrap();

        let service = NotificationEpisodeService::default();
        let initial = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(initial.items.len(), 1);
        assert_eq!(initial.unread_count, 1);
        let episode = &initial.items[0];
        assert_eq!(episode.kind, NotificationEpisodeKind::Collaboration);
        assert_eq!(episode.primary_semantic, NotificationSemantic::TurnFailed);
        assert_eq!(episode.mention_count, 2);
        assert_eq!(episode.unacknowledged_mention_count, 2);
        assert_eq!(
            episode.primary_action.kind,
            NotificationActionKind::OpenCampTurn
        );

        let failure_ack = envelope(
            "ack-failure",
            Some("camp-episode"),
            AcknowledgeNotificationEpisodeCommand {
                episode_id: episode.id.clone(),
                observed_episode_version: episode.episode_version,
                acknowledgement_id: episode.primary_action.acknowledgement_id.clone().unwrap(),
            },
        );
        service.acknowledge(&mut database, &failure_ack).unwrap();
        let after_failure = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        let episode = &after_failure.items[0];
        assert_eq!(episode.primary_semantic, NotificationSemantic::TurnFailed);
        assert_eq!(
            episode.primary_action.kind,
            NotificationActionKind::OpenCampMessage
        );
        assert_eq!(
            episode.primary_action.message_id.as_deref(),
            Some("message-one")
        );

        let mention_ack = envelope(
            "ack-first-mention",
            Some("camp-episode"),
            AcknowledgeNotificationEpisodeCommand {
                episode_id: episode.id.clone(),
                observed_episode_version: episode.episode_version,
                acknowledgement_id: episode.primary_action.acknowledgement_id.clone().unwrap(),
            },
        );
        service.acknowledge(&mut database, &mention_ack).unwrap();
        let next = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(
            next.items[0].primary_action.message_id.as_deref(),
            Some("message-two")
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn inbox_cursor_freezes_membership_and_order_while_hydrating_current_episode_fields() {
        let (directory, mut database) = test_database();
        for (camp_id, turn_id, message_id, occurred_at) in [
            (
                "camp-page-a",
                "turn-page-a",
                "message-page-a",
                "2026-08-01T00:01:00Z",
            ),
            (
                "camp-page-b",
                "turn-page-b",
                "message-page-b",
                "2026-08-01T00:02:00Z",
            ),
            (
                "camp-page-c",
                "turn-page-c",
                "message-page-c",
                "2026-08-01T00:03:00Z",
            ),
        ] {
            insert_camp(&database, camp_id, camp_id);
            insert_turn(&database, turn_id, camp_id, "running");
            insert_mention(
                &database,
                message_id,
                camp_id,
                Some(turn_id),
                1,
                occurred_at,
            );
        }
        let service = NotificationEpisodeService::default();
        let first_page = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                1,
            )
            .unwrap();
        assert_eq!(first_page.items.len(), 1);
        assert_eq!(first_page.items[0].camp.id, "camp-page-c");
        let cursor = first_page.next_cursor.clone().unwrap();

        insert_mention(
            &database,
            "message-page-b-late",
            "camp-page-b",
            Some("turn-page-b"),
            2,
            "2026-08-01T00:04:00Z",
        );
        let second_page = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                Some(&cursor),
                10,
            )
            .unwrap();
        assert_eq!(
            second_page
                .items
                .iter()
                .map(|episode| episode.camp.id.as_str())
                .collect::<Vec<_>>(),
            vec!["camp-page-b", "camp-page-a"]
        );
        assert_eq!(second_page.items[0].mention_count, 2);
        assert_eq!(
            second_page.through_change_sequence,
            first_page.through_change_sequence
        );
        assert!(
            service
                .inbox(
                    &mut database,
                    CURRENT_USER_ID,
                    NotificationEpisodeFilter::Unread,
                    Some(&cursor),
                    10,
                )
                .is_err(),
            "a cursor must not be reused across filters"
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn ordinary_agent_messages_and_user_stop_are_silent_but_incomplete_turns_are_not() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-silent", "Silent boundaries");
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, version, created_at, updated_at
                ) VALUES (
                    'message-ordinary', 'camp-silent', 1, 'agent', 'agent_1',
                    '普通进度', '[{"kind":"text","text":"普通进度"}]',
                    'message-ordinary', 'default', '[]', 1,
                    '2026-08-01T00:01:00Z', '2026-08-01T00:01:00Z'
                );
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    cancel_requested_at, cancel_request_command_id,
                    version, created_at, updated_at, ended_at
                ) VALUES (
                    'turn-user-stop', 'camp-silent', 'system_event', 'user-stop',
                    'cancelled', '2026-08-01T00:02:00Z', 'stop-command', 2,
                    '2026-08-01T00:01:30Z', '2026-08-01T00:02:00Z',
                    '2026-08-01T00:02:00Z'
                );
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    version, created_at, updated_at, ended_at
                ) VALUES (
                    'turn-incomplete', 'camp-silent', 'system_event', 'incomplete',
                    'cancelled', 1, '2026-08-01T00:02:30Z',
                    '2026-08-01T00:03:00Z', '2026-08-01T00:03:00Z'
                );
                "#,
            )
            .unwrap();

        let occurrences = database
            .connection()
            .prepare("SELECT semantic, source_id FROM notification_occurrence ORDER BY occurred_at")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            occurrences,
            vec![("turn_incomplete".to_string(), "turn-incomplete".to_string())]
        );
        assert!(
            database
                .connection()
                .execute(
                    "UPDATE notification_occurrence SET occurred_at = '2026-08-01T00:04:00Z'",
                    [],
                )
                .is_err(),
            "NotificationOccurrence must remain immutable after admission"
        );
        let inbox = NotificationEpisodeService::default()
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(inbox.items.len(), 1);
        assert_eq!(
            inbox.items[0].primary_semantic,
            NotificationSemantic::TurnIncomplete
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clear_is_attention_bounded_and_a_new_mention_reopens_the_episode() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-clear", "Clear");
        insert_turn(&database, "turn-clear", "camp-clear", "running");
        insert_mention(
            &database,
            "message-before-clear",
            "camp-clear",
            Some("turn-clear"),
            1,
            "2026-08-01T00:01:00Z",
        );
        let service = NotificationEpisodeService::default();
        let before = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        let episode = &before.items[0];
        service
            .clear(
                &mut database,
                &envelope(
                    "clear-episode",
                    Some("camp-clear"),
                    ClearNotificationEpisodeCommand {
                        episode_id: episode.id.clone(),
                        through_attention_revision: episode.attention_revision,
                    },
                ),
            )
            .unwrap();
        assert!(
            service
                .inbox(
                    &mut database,
                    CURRENT_USER_ID,
                    NotificationEpisodeFilter::All,
                    None,
                    50,
                )
                .unwrap()
                .items
                .is_empty()
        );

        insert_mention(
            &database,
            "message-after-clear",
            "camp-clear",
            Some("turn-clear"),
            2,
            "2026-08-01T00:02:00Z",
        );
        let reopened = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(reopened.items.len(), 1);
        assert_eq!(reopened.items[0].attention_revision, 2);
        assert_eq!(reopened.items[0].mention_count, 2);
        assert_eq!(reopened.items[0].unacknowledged_mention_count, 1);
        assert_eq!(
            reopened.items[0]
                .mention
                .as_ref()
                .map(|mention| mention.message_id.as_str()),
            Some("message-after-clear")
        );
        assert_eq!(
            reopened.items[0].primary_action.message_id.as_deref(),
            Some("message-after-clear")
        );
        assert_eq!(reopened.unread_count, 1);

        let changes = service
            .changes_since(
                &mut database,
                CURRENT_USER_ID,
                before.through_change_sequence,
                50,
            )
            .unwrap();
        assert!(!changes.reset_required);
        assert!(changes.changes.iter().any(|change| {
            change.operation == NotificationChangeOperation::Remove
                && change.change_cause == NotificationChangeCause::Cleared
                && change
                    .heads_up_invalidation
                    .as_ref()
                    .is_some_and(|invalidation| {
                        invalidation.kind == NotificationHeadsUpInvalidationKind::AttentionCleared
                            && invalidation.through_attention_revision
                                == Some(episode.attention_revision)
                    })
        }));
        assert!(changes.changes.iter().any(|change| {
            change.operation == NotificationChangeOperation::Upsert
                && change.heads_up_signal.as_ref().is_some_and(|signal| {
                    signal.semantic == NotificationSemantic::UserMention
                        && signal.action.message_id.as_deref() == Some("message-after-clear")
                })
        }));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn subsequent_user_turn_satisfies_completion_without_acknowledging_mentions() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-satisfaction", "Satisfaction");
        insert_turn(&database, "turn-complete", "camp-satisfaction", "running");
        insert_mention(
            &database,
            "message-mentioned",
            "camp-satisfaction",
            Some("turn-complete"),
            1,
            "2026-08-01T00:01:00Z",
        );
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'completed', version = 2,
                    ended_at = '2026-08-01T00:02:00Z',
                    updated_at = '2026-08-01T00:02:00Z'
                WHERE id = 'turn-complete'
                "#,
                [],
            )
            .unwrap();
        insert_turn(&database, "turn-next", "camp-satisfaction", "running");
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, camp_turn_id,
                    version, created_at, updated_at
                ) VALUES (
                    'message-next', 'camp-satisfaction', 2, 'user', 'local_user', '继续',
                    '[{"kind":"text","text":"继续"}]', 'message-next',
                    'default', '[]', 'turn-next', 1,
                    '2026-08-01T00:03:00Z', '2026-08-01T00:03:00Z'
                )
                "#,
                [],
            )
            .unwrap();

        let inbox = NotificationEpisodeService::default()
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        let episode = &inbox.items[0];
        assert!(episode.satisfied);
        assert!(episode.unread);
        assert_eq!(episode.unacknowledged_mention_count, 1);
        assert_eq!(episode.primary_semantic, NotificationSemantic::UserMention);
        assert_eq!(
            episode.primary_action.kind,
            NotificationActionKind::OpenCampMessage
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn changes_bind_each_heads_up_signal_to_its_exact_occurrence() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-signal", "Exact signal");
        insert_turn(&database, "turn-signal", "camp-signal", "running");
        let baseline = change_clock(database.connection()).unwrap().0;
        insert_mention(
            &database,
            "message-signal-one",
            "camp-signal",
            Some("turn-signal"),
            1,
            "2026-08-01T00:01:00Z",
        );
        insert_mention(
            &database,
            "message-signal-two",
            "camp-signal",
            Some("turn-signal"),
            2,
            "2026-08-01T00:02:00Z",
        );
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'completed', version = 2,
                    ended_at = '2026-08-01T00:03:00Z',
                    updated_at = '2026-08-01T00:03:00Z'
                WHERE id = 'turn-signal'
                "#,
                [],
            )
            .unwrap();

        let changes = NotificationEpisodeService::default()
            .changes_since(&mut database, CURRENT_USER_ID, baseline, 50)
            .unwrap();
        let mention_signals = changes
            .changes
            .iter()
            .filter_map(|change| change.heads_up_signal.as_ref())
            .filter(|signal| signal.semantic == NotificationSemantic::UserMention)
            .collect::<Vec<_>>();
        assert_eq!(mention_signals.len(), 2);
        assert_eq!(
            mention_signals
                .iter()
                .map(|signal| signal.admitted_attention_revision)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            mention_signals
                .iter()
                .map(|signal| signal.action.message_id.as_deref().unwrap())
                .collect::<Vec<_>>(),
            vec!["message-signal-one", "message-signal-two"]
        );
        assert!(mention_signals.iter().all(|signal| {
            signal.mention.as_ref().is_some_and(|mention| {
                signal.action.message_id.as_deref() == Some(mention.message_id.as_str())
            })
        }));
        let mention_change = changes
            .changes
            .iter()
            .find(|change| {
                change
                    .heads_up_signal
                    .as_ref()
                    .is_some_and(|signal| signal.semantic == NotificationSemantic::UserMention)
            })
            .unwrap();
        assert_eq!(
            mention_change.episode.as_ref().unwrap().primary_semantic,
            NotificationSemantic::TurnCompleted
        );
        assert!(changes.changes.iter().any(|change| {
            change.heads_up_signal.as_ref().is_some_and(|signal| {
                signal.semantic == NotificationSemantic::TurnCompleted
                    && signal.action.camp_turn_id.as_deref() == Some("turn-signal")
            })
        }));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn approval_zero_to_nonzero_cycles_create_generations_and_resolution_does_not_read() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-attention", "Approval");
        insert_runtime_permission_fixture(&database);
        insert_native_approval(
            &database,
            "action-one",
            "approval-one",
            "2026-08-01T00:01:00Z",
        );
        insert_native_approval(
            &database,
            "action-two",
            "approval-two",
            "2026-08-01T00:02:00Z",
        );

        let service = NotificationEpisodeService::default();
        let first = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(first.items.len(), 1);
        assert_eq!(first.items[0].pending_approval_count, 2);
        assert_eq!(first.items[0].attention_revision, 2);
        let approval_one_acknowledgement_id = first.items[0]
            .primary_action
            .acknowledgement_id
            .clone()
            .unwrap();

        database
            .connection()
            .execute(
                r#"
                UPDATE approval
                SET status = 'denied', resolved_at = '2026-08-01T00:03:00Z',
                    updated_at = '2026-08-01T00:03:00Z', version = version + 1
                WHERE id = 'approval-one'
                "#,
                [],
            )
            .unwrap();
        let resolution_changes = service
            .changes_since(
                &mut database,
                CURRENT_USER_ID,
                first.through_change_sequence,
                50,
            )
            .unwrap();
        assert!(resolution_changes.changes.iter().any(|change| {
            change.change_cause == NotificationChangeCause::Resolved
                && change
                    .heads_up_invalidation
                    .as_ref()
                    .is_some_and(|invalidation| {
                        invalidation.kind == NotificationHeadsUpInvalidationKind::SourceStateChanged
                            && invalidation.acknowledgement_id.as_deref()
                                == Some(approval_one_acknowledgement_id.as_str())
                    })
        }));
        let mixed = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(mixed.items[0].pending_approval_count, 1);
        assert_eq!(
            mixed.items[0].primary_action.kind,
            NotificationActionKind::OpenApproval
        );
        assert_eq!(
            mixed.items[0].primary_action.approval_id.as_deref(),
            Some("approval-two")
        );
        assert!(mixed.items[0].primary_action.available);

        database
            .connection()
            .execute(
                r#"
                UPDATE approval
                SET status = 'denied', resolved_at = '2026-08-01T00:04:00Z',
                    updated_at = '2026-08-01T00:04:00Z', version = version + 1
                WHERE id = 'approval-two'
                "#,
                [],
            )
            .unwrap();
        let resolved = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert!(resolved.items[0].resolved);
        assert!(resolved.items[0].unread);
        assert_eq!(resolved.unread_count, 1);
        assert_eq!(
            resolved.items[0].primary_action.kind,
            NotificationActionKind::AcknowledgeOnly
        );
        assert!(resolved.items[0].primary_action.available);
        assert!(resolved.items[0].primary_action.approval_id.is_none());

        service
            .acknowledge(
                &mut database,
                &envelope(
                    "ack-resolved-approval-one",
                    Some("camp-attention"),
                    AcknowledgeNotificationEpisodeCommand {
                        episode_id: resolved.items[0].id.clone(),
                        observed_episode_version: resolved.items[0].episode_version,
                        acknowledgement_id: resolved.items[0]
                            .primary_action
                            .acknowledgement_id
                            .clone()
                            .unwrap(),
                    },
                ),
            )
            .unwrap();
        let remaining_resolved = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(
            remaining_resolved.items[0].primary_action.kind,
            NotificationActionKind::AcknowledgeOnly
        );

        insert_native_approval(
            &database,
            "action-three",
            "approval-three",
            "2026-08-01T00:05:00Z",
        );
        let next_generation = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(next_generation.items.len(), 2);
        assert_eq!(
            next_generation
                .items
                .iter()
                .filter(|episode| !episode.resolved)
                .count(),
            1
        );
        let generations: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM notification_episode WHERE kind = 'approval'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(generations, 2);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn retention_removes_only_inactive_terminal_episodes_and_advances_the_journal_floor() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-retained-message", "Retained message");
        insert_mention(
            &database,
            "message-retained",
            "camp-retained-message",
            None,
            1,
            "2000-01-01T00:00:00Z",
        );
        insert_camp(&database, "camp-retained-running", "Running collaboration");
        insert_turn(
            &database,
            "turn-retained-running",
            "camp-retained-running",
            "running",
        );
        insert_mention(
            &database,
            "message-retained-running",
            "camp-retained-running",
            Some("turn-retained-running"),
            1,
            "2000-01-01T00:01:00Z",
        );

        let service = NotificationEpisodeService::default();
        let initial = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        for episode in &initial.items {
            service
                .acknowledge(
                    &mut database,
                    &envelope(
                        &format!("ack-retention-{}", episode.id),
                        Some(&episode.camp.id),
                        AcknowledgeNotificationEpisodeCommand {
                            episode_id: episode.id.clone(),
                            observed_episode_version: episode.episode_version,
                            acknowledgement_id: episode
                                .primary_action
                                .acknowledgement_id
                                .clone()
                                .unwrap(),
                        },
                    ),
                )
                .unwrap();
        }
        database
            .connection()
            .execute(
                "UPDATE notification_episode SET updated_at = '2000-01-01T00:02:00Z'",
                [],
            )
            .unwrap();
        let before_retention = change_clock(database.connection()).unwrap().0;

        service.maintain_retention(&database).unwrap();
        let remaining = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(remaining.items.len(), 1);
        assert_eq!(remaining.items[0].camp.id, "camp-retained-running");
        let changes = service
            .changes_since(&mut database, CURRENT_USER_ID, before_retention, 50)
            .unwrap();
        assert!(changes.changes.iter().any(|change| {
            change.operation == NotificationChangeOperation::Remove
                && change.change_cause == NotificationChangeCause::Retained
                && change
                    .heads_up_invalidation
                    .as_ref()
                    .is_some_and(|invalidation| {
                        invalidation.kind == NotificationHeadsUpInvalidationKind::EpisodeRemoved
                    })
        }));
        let reset = service
            .changes_since(&mut database, CURRENT_USER_ID, 0, 50)
            .unwrap();
        assert!(reset.reset_required);
        assert!(reset.changes.is_empty());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cleared_historical_attention_does_not_block_terminal_retention() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-cleared-retention", "Cleared retention");
        insert_mention(
            &database,
            "message-cleared-retention",
            "camp-cleared-retention",
            None,
            1,
            "2000-01-01T00:00:00Z",
        );
        let service = NotificationEpisodeService::default();
        let inbox = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        service
            .clear(
                &mut database,
                &envelope(
                    "clear-before-retention",
                    Some("camp-cleared-retention"),
                    ClearNotificationEpisodeCommand {
                        episode_id: inbox.items[0].id.clone(),
                        through_attention_revision: inbox.items[0].attention_revision,
                    },
                ),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE notification_episode SET updated_at = '2000-01-01T00:01:00Z'",
                [],
            )
            .unwrap();

        service.maintain_retention(&database).unwrap();
        let episode_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM notification_episode", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(episode_count, 0);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn mark_all_and_acknowledge_are_bounded_by_the_observed_versions() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-boundary", "Boundary");
        insert_turn(&database, "turn-boundary", "camp-boundary", "running");
        insert_mention(
            &database,
            "message-before-boundary",
            "camp-boundary",
            Some("turn-boundary"),
            1,
            "2026-08-01T00:01:00Z",
        );
        let service = NotificationEpisodeService::default();
        let observed = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        let observed_episode = observed.items[0].clone();
        insert_mention(
            &database,
            "message-after-boundary",
            "camp-boundary",
            Some("turn-boundary"),
            2,
            "2026-08-01T00:02:00Z",
        );

        service
            .mark_all_read(
                &mut database,
                &envelope(
                    "mark-observed-boundary",
                    None,
                    MarkAllNotificationEpisodesReadCommand {
                        through_change_sequence: observed.through_change_sequence,
                    },
                ),
            )
            .unwrap();
        let after_mark_all = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(after_mark_all.items[0].unacknowledged_mention_count, 1);
        assert_eq!(
            after_mark_all.items[0].primary_action.message_id.as_deref(),
            Some("message-after-boundary")
        );

        let late_occurrence_id: String = database
            .connection()
            .query_row(
                "SELECT id FROM notification_occurrence WHERE source_message_id = 'message-after-boundary'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let stale = service
            .acknowledge(
                &mut database,
                &envelope(
                    "stale-late-ack",
                    Some("camp-boundary"),
                    AcknowledgeNotificationEpisodeCommand {
                        episode_id: observed_episode.id,
                        observed_episode_version: observed_episode.episode_version,
                        acknowledgement_id: late_occurrence_id,
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            stale.result.status,
            crate::command::CommandResultStatus::Rejected
        );
        assert_eq!(
            stale.result.code,
            "notification_episode.stale_acknowledgement_boundary"
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn visible_sources_acknowledge_only_exact_sources_within_the_observed_boundary() {
        let (directory, mut database) = test_database();
        insert_camp(&database, "camp-visible", "Visible sources");
        insert_turn(&database, "turn-visible", "camp-visible", "running");
        insert_mention(
            &database,
            "message-visible-before",
            "camp-visible",
            Some("turn-visible"),
            1,
            "2026-08-01T00:01:00Z",
        );
        let service = NotificationEpisodeService::default();
        let observed = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();

        insert_mention(
            &database,
            "message-visible-after",
            "camp-visible",
            Some("turn-visible"),
            2,
            "2026-08-01T00:02:00Z",
        );
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'failed', version = 2,
                    ended_at = '2026-08-01T00:03:00Z',
                    updated_at = '2026-08-01T00:03:00Z'
                WHERE id = 'turn-visible'
                "#,
                [],
            )
            .unwrap();

        service
            .acknowledge_visible_sources(
                &mut database,
                &envelope(
                    "ack-visible-observed",
                    Some("camp-visible"),
                    AcknowledgeVisibleNotificationSourcesCommand {
                        camp_id: "camp-visible".to_string(),
                        observed_through_change_sequence: observed.through_change_sequence,
                        visible_message_ids: vec![
                            "message-visible-before".to_string(),
                            "message-visible-after".to_string(),
                        ],
                        visible_camp_turn_ids: vec!["turn-visible".to_string()],
                        visible_approval_ids: Vec::new(),
                    },
                ),
            )
            .unwrap();
        let after_stale_boundary = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(after_stale_boundary.unread_count, 1);
        assert_eq!(
            after_stale_boundary.items[0].unacknowledged_mention_count,
            1
        );
        assert_eq!(
            after_stale_boundary.items[0].primary_action.kind,
            NotificationActionKind::OpenCampTurn
        );

        service
            .acknowledge_visible_sources(
                &mut database,
                &envelope(
                    "ack-visible-current",
                    Some("camp-visible"),
                    AcknowledgeVisibleNotificationSourcesCommand {
                        camp_id: "camp-visible".to_string(),
                        observed_through_change_sequence: after_stale_boundary
                            .through_change_sequence,
                        visible_message_ids: vec!["message-visible-after".to_string()],
                        visible_camp_turn_ids: vec!["turn-visible".to_string()],
                        visible_approval_ids: Vec::new(),
                    },
                ),
            )
            .unwrap();
        let after_current_boundary = service
            .inbox(
                &mut database,
                CURRENT_USER_ID,
                NotificationEpisodeFilter::All,
                None,
                50,
            )
            .unwrap();
        assert_eq!(after_current_boundary.unread_count, 0);
        assert_eq!(
            after_current_boundary.items[0].unacknowledged_mention_count,
            0
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
