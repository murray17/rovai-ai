use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    path::Path,
};

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    camp_attachment::managed_attachment_summary,
    db::Database,
    team_tool::{AuthenticatedTeamToolRun, TeamToolInvocationError},
};

pub const CAMP_LIST_TOOL_NAME: &str = "camp.list";
pub const CAMP_SEARCH_TOOL_NAME: &str = "camp.search";
pub const HISTORY_SEARCH_TOOL_NAME: &str = "history.search";
pub const CAMP_READ_TOOL_NAME: &str = "camp.read";

const CAMP_LIST_DEFAULT_LIMIT: usize = 20;
const CAMP_LIST_MAX_LIMIT: usize = 50;
const CAMP_SEARCH_DEFAULT_LIMIT: usize = 10;
const CAMP_SEARCH_MAX_LIMIT: usize = 20;
const HISTORY_SEARCH_DEFAULT_LIMIT: usize = 15;
const HISTORY_SEARCH_MAX_LIMIT: usize = 30;
const SEARCH_CANDIDATE_MULTIPLIER: usize = 8;
const MAX_QUERY_CHARS: usize = 512;
const MAX_CAMP_QUERY_CHARS: usize = 200;
const MAX_HISTORY_CAMP_IDS: usize = 20;
const MAX_SNIPPET_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 4_000;
const MAX_AROUND_MESSAGES: usize = 10;
const DEFAULT_AROUND_BEFORE: usize = 5;
const DEFAULT_AROUND_AFTER: usize = 10;
const DEFAULT_PAGE_LIMIT: usize = 20;
const MAX_PAGE_LIMIT: usize = 20;
const COLLECTION_BODY_PREFIX_CHARS: usize = 500;
const MAX_ATTACHMENTS: usize = 10;
const MAX_RESPONSE_CHARS: usize = 16_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampListInput {
    pub query: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampSearchInput {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySearchInput {
    pub query: String,
    pub camp_ids: Option<Vec<String>>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadDirection {
    Before,
    After,
}

impl ReadDirection {
    fn as_str(self) -> &'static str {
        match self {
            Self::Before => "before",
            Self::After => "after",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CampReadInput {
    Item {
        camp_id: String,
        message_id: String,
        body_offset: Option<usize>,
        body_limit: Option<usize>,
    },
    Around {
        camp_id: String,
        message_id: String,
        before: Option<usize>,
        after: Option<usize>,
    },
    Thread {
        camp_id: String,
        message_id: String,
        direction: ReadDirection,
        cursor: Option<i64>,
        limit: Option<usize>,
    },
    Timeline {
        camp_id: String,
        direction: ReadDirection,
        cursor: Option<i64>,
        limit: Option<usize>,
    },
}

#[derive(Debug, Clone)]
struct RunFence {
    manifest_id: String,
    current_camp_id: String,
    current_boundary: i64,
    global_boundary: i64,
}

#[derive(Debug, Clone)]
struct HistoryCamp {
    camp_id: String,
    camp_title: String,
    last_visible_activity_at: String,
}

#[derive(Debug, Clone, Copy)]
enum MessageFence {
    Current { boundary: i64 },
    History { global_boundary: i64 },
}

#[derive(Debug, Clone)]
struct ReadTarget {
    camp_id: String,
    fence: MessageFence,
}

#[derive(Debug, Clone)]
struct MessageRow {
    id: String,
    camp_id: String,
    sequence: i64,
    author_type: String,
    author_id: String,
    reply_to_message_id: Option<String>,
    body: String,
    created_at: String,
    recency: i64,
    camp_title: Option<String>,
}

#[derive(Debug, Clone)]
struct RankedMessage {
    message: MessageRow,
    exact_reference: bool,
    occurrence_count: usize,
    first_match_offset: usize,
    body_length: usize,
}

type CandidateKey = (String, String);
type CandidateMap = HashMap<CandidateKey, RankedMessage>;
type CandidatePage = (CandidateMap, bool);

#[derive(Debug, Clone, Copy)]
struct ParsedDateRange {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
}

impl ParsedDateRange {
    fn lower_bound_parameter(self) -> Option<String> {
        self.from.map(|value| value.to_rfc3339())
    }

    fn upper_bound_parameter(self) -> Option<String> {
        self.to.map(|value| value.to_rfc3339())
    }
}

#[derive(Debug, Clone, Copy)]
struct HistorySearchScope<'a> {
    run: &'a AuthenticatedTeamToolRun,
    fence: &'a RunFence,
    camp_ids: &'a [String],
    dates: ParsedDateRange,
}

#[derive(Debug, Default)]
pub struct CampHistoryService;

impl CampHistoryService {
    pub fn camp_list_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "query": {"type": "string", "maxLength": MAX_CAMP_QUERY_CHARS},
                "limit": {"type": "integer", "minimum": 1, "maximum": CAMP_LIST_MAX_LIMIT}
            }
        })
    }

    pub fn camp_search_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": MAX_QUERY_CHARS},
                "limit": {"type": "integer", "minimum": 1, "maximum": CAMP_SEARCH_MAX_LIMIT}
            }
        })
    }

    pub fn history_search_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": MAX_QUERY_CHARS},
                "campIds": {
                    "type": "array", "minItems": 1, "maxItems": MAX_HISTORY_CAMP_IDS,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1}
                },
                "dateFrom": {"type": "string", "format": "date-time"},
                "dateTo": {"type": "string", "format": "date-time"},
                "limit": {"type": "integer", "minimum": 1, "maximum": HISTORY_SEARCH_MAX_LIMIT}
            }
        })
    }

    pub fn camp_read_input_schema() -> Value {
        json!({
            "type": "object",
            "oneOf": [
                {
                    "additionalProperties": false,
                    "required": ["campId", "mode", "messageId"],
                    "properties": {
                        "campId": {"type": "string", "minLength": 1},
                        "mode": {"const": "item"},
                        "messageId": {"type": "string", "minLength": 1},
                        "bodyOffset": {"type": "integer", "minimum": 0},
                        "bodyLimit": {"type": "integer", "minimum": 1, "maximum": MAX_BODY_CHARS}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["campId", "mode", "messageId"],
                    "properties": {
                        "campId": {"type": "string", "minLength": 1},
                        "mode": {"const": "around"},
                        "messageId": {"type": "string", "minLength": 1},
                        "before": {"type": "integer", "minimum": 0, "maximum": MAX_AROUND_MESSAGES},
                        "after": {"type": "integer", "minimum": 0, "maximum": MAX_AROUND_MESSAGES}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["campId", "mode", "messageId", "direction"],
                    "properties": {
                        "campId": {"type": "string", "minLength": 1},
                        "mode": {"const": "thread"},
                        "messageId": {"type": "string", "minLength": 1},
                        "direction": {"type": "string", "enum": ["before", "after"]},
                        "cursor": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["campId", "mode", "direction"],
                    "properties": {
                        "campId": {"type": "string", "minLength": 1},
                        "mode": {"const": "timeline"},
                        "direction": {"type": "string", "enum": ["before", "after"]},
                        "cursor": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                }
            ]
        })
    }

    pub fn list_camps(
        &self,
        database: &mut Database,
        run: &AuthenticatedTeamToolRun,
        input: &CampListInput,
    ) -> Result<Value> {
        let limit = effective_limit(input.limit, CAMP_LIST_DEFAULT_LIMIT, CAMP_LIST_MAX_LIMIT)?;
        let query = optional_trimmed_query(input.query.as_deref(), MAX_CAMP_QUERY_CHARS)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let fence = load_run_fence(&transaction, run)?;
        let mut camps = load_authorized_history_camps(&transaction, run, &fence)?;
        if let Some(query) = query.as_deref() {
            let folded_query = fold_text(query);
            camps.retain(|camp| fold_text(&camp.camp_title).contains(&folded_query));
            camps.sort_by(|left, right| {
                camp_name_match_class(&left.camp_title, &folded_query)
                    .cmp(&camp_name_match_class(&right.camp_title, &folded_query))
                    .then_with(|| {
                        right
                            .last_visible_activity_at
                            .cmp(&left.last_visible_activity_at)
                    })
                    .then_with(|| left.camp_id.cmp(&right.camp_id))
            });
        } else {
            camps.sort_by(|left, right| {
                right
                    .last_visible_activity_at
                    .cmp(&left.last_visible_activity_at)
                    .then_with(|| left.camp_id.cmp(&right.camp_id))
            });
        }
        let truncated = camps.len() > limit;
        camps.truncate(limit);
        let values = camps
            .into_iter()
            .map(|camp| {
                json!({
                    "campId": camp.camp_id,
                    "title": camp.camp_title,
                    "lastVisibleActivityAt": camp.last_visible_activity_at,
                })
            })
            .collect::<Vec<_>>();
        let result = cap_top_k_response(json!({"camps": values, "truncated": truncated}), "camps")?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn search_current_camp(
        &self,
        database: &mut Database,
        run: &AuthenticatedTeamToolRun,
        input: &CampSearchInput,
    ) -> Result<Value> {
        let query = required_query(&input.query)?;
        let limit = effective_limit(
            input.limit,
            CAMP_SEARCH_DEFAULT_LIMIT,
            CAMP_SEARCH_MAX_LIMIT,
        )?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let fence = load_run_fence(&transaction, run)?;
        let budget = limit * SEARCH_CANDIDATE_MULTIPLIER;
        let (mut candidates, search_incomplete) =
            load_current_body_candidates(&transaction, &fence, &query, budget)?;
        merge_current_reference_candidates(&transaction, &fence, &query, limit, &mut candidates)?;
        let result = ranked_search_response(candidates, &query, limit, false, search_incomplete)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn search_history(
        &self,
        database: &mut Database,
        run: &AuthenticatedTeamToolRun,
        input: &HistorySearchInput,
    ) -> Result<Value> {
        let query = required_query(&input.query)?;
        let limit = effective_limit(
            input.limit,
            HISTORY_SEARCH_DEFAULT_LIMIT,
            HISTORY_SEARCH_MAX_LIMIT,
        )?;
        let requested_camps = validate_requested_camps(input.camp_ids.as_deref())?;
        let dates = parse_date_range(input.date_from.as_deref(), input.date_to.as_deref())?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let fence = load_run_fence(&transaction, run)?;
        let authorized = load_authorized_history_camps(&transaction, run, &fence)?;
        let authorized_ids = authorized
            .iter()
            .map(|camp| camp.camp_id.as_str())
            .collect::<HashSet<_>>();
        let scope = requested_camps.map_or_else(
            || authorized.iter().map(|camp| camp.camp_id.clone()).collect(),
            |requested| {
                requested
                    .into_iter()
                    .filter(|camp_id| authorized_ids.contains(camp_id.as_str()))
                    .collect::<Vec<_>>()
            },
        );
        if scope.is_empty() {
            transaction.commit()?;
            return Ok(json!({
                "results": [],
                "truncated": false,
                "searchIncomplete": false,
            }));
        }
        let budget = limit * SEARCH_CANDIDATE_MULTIPLIER;
        let history_scope = HistorySearchScope {
            run,
            fence: &fence,
            camp_ids: &scope,
            dates,
        };
        let (mut candidates, search_incomplete) =
            load_history_body_candidates(&transaction, &history_scope, &query, budget)?;
        merge_history_reference_candidates(
            &transaction,
            &history_scope,
            &query,
            limit,
            &mut candidates,
        )?;
        let result = ranked_search_response(candidates, &query, limit, true, search_incomplete)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn read(
        &self,
        database: &mut Database,
        run: &AuthenticatedTeamToolRun,
        input: &CampReadInput,
    ) -> Result<Value> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let fence = match load_run_fence(&transaction, run) {
            Ok(fence) => fence,
            Err(error)
                if error
                    .downcast_ref::<TeamToolInvocationError>()
                    .is_some_and(|error| error.code == "camp.manifest_unavailable") =>
            {
                return Err(read_unavailable());
            }
            Err(error) => return Err(error),
        };
        let value = match input {
            CampReadInput::Item {
                camp_id,
                message_id,
                body_offset,
                body_limit,
            } => {
                let target = load_read_target(&transaction, run, &fence, camp_id)?;
                read_item(
                    &transaction,
                    &target,
                    message_id,
                    body_offset.unwrap_or(0),
                    effective_limit(*body_limit, MAX_BODY_CHARS, MAX_BODY_CHARS)?,
                )?
            }
            CampReadInput::Around {
                camp_id,
                message_id,
                before,
                after,
            } => {
                let before = before.unwrap_or(DEFAULT_AROUND_BEFORE);
                let after = after.unwrap_or(DEFAULT_AROUND_AFTER);
                if before > MAX_AROUND_MESSAGES || after > MAX_AROUND_MESSAGES {
                    return Err(invalid_argument("before and after must not exceed 10"));
                }
                let target = load_read_target(&transaction, run, &fence, camp_id)?;
                read_around(&transaction, &target, message_id, before, after)?
            }
            CampReadInput::Thread {
                camp_id,
                message_id,
                direction,
                cursor,
                limit,
            } => {
                validate_cursor(*cursor)?;
                let limit = effective_limit(*limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
                let target = load_read_target(&transaction, run, &fence, camp_id)?;
                read_thread(
                    &transaction,
                    &target,
                    message_id,
                    *direction,
                    *cursor,
                    limit,
                )?
            }
            CampReadInput::Timeline {
                camp_id,
                direction,
                cursor,
                limit,
            } => {
                validate_cursor(*cursor)?;
                let limit = effective_limit(*limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
                let target = load_read_target(&transaction, run, &fence, camp_id)?;
                read_timeline(&transaction, &target, *direction, *cursor, limit)?
            }
        };
        transaction.commit()?;
        Ok(value)
    }
}

pub fn invalid_input_error(message: impl Into<String>) -> anyhow::Error {
    invalid_argument(&message.into())
}

fn invalid_argument(message: &str) -> anyhow::Error {
    tool_error("camp.invalid_argument", message)
}

fn read_unavailable() -> anyhow::Error {
    tool_error(
        "camp.read_unavailable",
        "Camp history item is unavailable to this AgentRun",
    )
}

fn tool_error(code: &str, message: &str) -> anyhow::Error {
    TeamToolInvocationError {
        code: code.to_string(),
        message: message.to_string(),
    }
    .into()
}

fn effective_limit(value: Option<usize>, default: usize, maximum: usize) -> Result<usize> {
    let value = value.unwrap_or(default);
    if !(1..=maximum).contains(&value) {
        return Err(invalid_argument(&format!(
            "limit must be between 1 and {maximum}"
        )));
    }
    Ok(value)
}

fn required_query(value: &str) -> Result<String> {
    let query = value.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(invalid_argument(
            "query must contain between 1 and 512 Unicode scalars",
        ));
    }
    Ok(query.to_string())
}

fn optional_trimmed_query(value: Option<&str>, maximum: usize) -> Result<Option<String>> {
    let query = value.map(str::trim).filter(|value| !value.is_empty());
    if query.is_some_and(|value| value.chars().count() > maximum) {
        return Err(invalid_argument(&format!(
            "query must not exceed {maximum} Unicode scalars"
        )));
    }
    Ok(query.map(str::to_string))
}

fn validate_cursor(cursor: Option<i64>) -> Result<()> {
    if cursor.is_some_and(|cursor| cursor < 1) {
        return Err(invalid_argument("cursor must be a positive Camp sequence"));
    }
    Ok(())
}

fn validate_requested_camps(values: Option<&[String]>) -> Result<Option<Vec<String>>> {
    let Some(values) = values else {
        return Ok(None);
    };
    if values.is_empty() || values.len() > MAX_HISTORY_CAMP_IDS {
        return Err(invalid_argument("campIds must contain 1 to 20 unique IDs"));
    }
    let mut unique = HashSet::new();
    for value in values {
        if Uuid::parse_str(value).is_err() || !unique.insert(value.clone()) {
            return Err(invalid_argument(
                "campIds must contain 1 to 20 unique UUIDs",
            ));
        }
    }
    Ok(Some(values.to_vec()))
}

fn parse_date_range(from: Option<&str>, to: Option<&str>) -> Result<ParsedDateRange> {
    let parse = |value: Option<&str>| -> Result<Option<DateTime<Utc>>> {
        value
            .map(|value| {
                DateTime::parse_from_rfc3339(value)
                    .map(|value| value.with_timezone(&Utc))
                    .map_err(|_| invalid_argument("dateFrom and dateTo must be RFC 3339 instants"))
            })
            .transpose()
    };
    let range = ParsedDateRange {
        from: parse(from)?,
        to: parse(to)?,
    };
    if matches!((range.from, range.to), (Some(from), Some(to)) if from >= to) {
        return Err(invalid_argument("dateFrom must be earlier than dateTo"));
    }
    Ok(range)
}

fn load_run_fence(
    transaction: &Transaction<'_>,
    run: &AuthenticatedTeamToolRun,
) -> Result<RunFence> {
    transaction
        .query_row(
            r#"
            SELECT manifest.id, manifest.camp_message_boundary_sequence,
                   manifest.global_public_message_boundary
            FROM context_manifest AS manifest
            JOIN agent_run ON agent_run.id = manifest.agent_run_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = ?4
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE manifest.agent_run_id = ?1
              AND agent_run.execution_epoch = ?2
              AND agent_run.status = 'running'
              AND conversation.agent_id = ?4
              AND camp_turn.camp_id = ?3
              AND manifest.history_fence_version = 1
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![
                run.agent_run_id,
                run.execution_epoch,
                run.camp_id,
                run.agent_id,
            ],
            |row| {
                Ok(RunFence {
                    manifest_id: row.get(0)?,
                    current_camp_id: run.camp_id.clone(),
                    current_boundary: row.get(1)?,
                    global_boundary: row.get(2)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| {
            tool_error(
                "camp.manifest_unavailable",
                "Camp history tools require the current AgentRun ContextManifest",
            )
        })
}

fn load_authorized_history_camps(
    transaction: &Transaction<'_>,
    run: &AuthenticatedTeamToolRun,
    fence: &RunFence,
) -> Result<Vec<HistoryCamp>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT snapshot.camp_id, snapshot.camp_title,
               snapshot.last_visible_activity_at
        FROM context_manifest_history_camp AS snapshot
        JOIN camp ON camp.id = snapshot.camp_id
        JOIN camp_member
          ON camp_member.camp_id = camp.id
         AND camp_member.agent_id = ?2
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        WHERE snapshot.context_manifest_id = ?1
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
        ORDER BY snapshot.camp_id
        "#,
    )?;
    statement
        .query_map(params![fence.manifest_id, run.agent_id], |row| {
            Ok(HistoryCamp {
                camp_id: row.get(0)?,
                camp_title: row.get(1)?,
                last_visible_activity_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn load_read_target(
    transaction: &Transaction<'_>,
    run: &AuthenticatedTeamToolRun,
    fence: &RunFence,
    camp_id: &str,
) -> Result<ReadTarget> {
    if camp_id == fence.current_camp_id {
        return Ok(ReadTarget {
            camp_id: camp_id.to_string(),
            fence: MessageFence::Current {
                boundary: fence.current_boundary,
            },
        });
    }
    let authorized = transaction
        .query_row(
            r#"
            SELECT 1
            FROM context_manifest_history_camp AS snapshot
            JOIN camp ON camp.id = snapshot.camp_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = ?3
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE snapshot.context_manifest_id = ?1
              AND snapshot.camp_id = ?2
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![fence.manifest_id, camp_id, run.agent_id],
            |_| Ok(()),
        )
        .optional()?;
    if authorized.is_none() {
        return Err(read_unavailable());
    }
    Ok(ReadTarget {
        camp_id: camp_id.to_string(),
        fence: MessageFence::History {
            global_boundary: fence.global_boundary,
        },
    })
}

fn camp_name_match_class(title: &str, folded_query: &str) -> u8 {
    let title = fold_text(title);
    if title == folded_query {
        0
    } else if title.starts_with(folded_query) {
        1
    } else {
        2
    }
}

fn fold_text(value: &str) -> String {
    value.chars().map(fold_char).collect()
}

fn fold_char(value: char) -> char {
    value.to_lowercase().next().unwrap_or(value)
}

fn literal_fts_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

fn load_current_body_candidates(
    transaction: &Transaction<'_>,
    fence: &RunFence,
    query: &str,
    budget: usize,
) -> Result<CandidatePage> {
    let short = query.chars().count() < 3;
    let sql = if short {
        r#"
        SELECT message.id, message.camp_id, message.sequence,
               message.author_type, message.author_id,
               message.reply_to_camp_message_id, message.body,
               message.created_at, message.sequence, NULL
        FROM camp_message AS message
        WHERE message.camp_id = ?1
          AND message.sequence <= ?2
          AND message.tombstoned_at IS NULL
        ORDER BY message.sequence DESC, message.id
        LIMIT ?3
        "#
    } else {
        r#"
        SELECT message.id, message.camp_id, message.sequence,
               message.author_type, message.author_id,
               message.reply_to_camp_message_id, message.body,
               message.created_at, message.sequence, NULL
        FROM camp_message_fts
        JOIN camp_message AS message ON message.rowid = camp_message_fts.rowid
        WHERE camp_message_fts MATCH ?4
          AND message.camp_id = ?1
          AND message.sequence <= ?2
          AND message.tombstoned_at IS NULL
        ORDER BY message.sequence DESC, message.id
        LIMIT ?3
        "#
    };
    let mut statement = transaction.prepare(sql)?;
    let rows = if short {
        statement
            .query_map(
                params![
                    fence.current_camp_id,
                    fence.current_boundary,
                    (budget + 1) as i64
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        statement
            .query_map(
                params![
                    fence.current_camp_id,
                    fence.current_boundary,
                    (budget + 1) as i64,
                    literal_fts_query(query),
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    body_candidates(rows, query, budget, short)
}

fn load_history_body_candidates(
    transaction: &Transaction<'_>,
    scope: &HistorySearchScope<'_>,
    query: &str,
    budget: usize,
) -> Result<CandidatePage> {
    let short = query.chars().count() < 3;
    let sql = if short {
        r#"
        SELECT message.id, message.camp_id, message.sequence,
               message.author_type, message.author_id,
               message.reply_to_camp_message_id, message.body,
               message.created_at, sent.global_sequence, snapshot.camp_title
        FROM context_manifest_history_camp AS snapshot
        JOIN camp ON camp.id = snapshot.camp_id
        JOIN camp_member
          ON camp_member.camp_id = camp.id
         AND camp_member.agent_id = ?2
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        JOIN camp_message AS message ON message.camp_id = snapshot.camp_id
        JOIN event_log AS sent
          ON sent.entity_type = 'camp_message'
         AND sent.entity_id = message.id
         AND sent.event_type = 'camp_message.sent'
        WHERE snapshot.context_manifest_id = ?1
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
          AND sent.global_sequence <= ?3
          AND message.tombstoned_at IS NULL
          AND message.camp_id IN (SELECT value FROM json_each(?4))
          AND (?5 IS NULL OR julianday(message.created_at) >= julianday(?5))
          AND (?6 IS NULL OR julianday(message.created_at) < julianday(?6))
        ORDER BY sent.global_sequence DESC, message.camp_id, message.id
        LIMIT ?7
        "#
    } else {
        r#"
        SELECT message.id, message.camp_id, message.sequence,
               message.author_type, message.author_id,
               message.reply_to_camp_message_id, message.body,
               message.created_at, sent.global_sequence, snapshot.camp_title
        FROM context_manifest_history_camp AS snapshot
        JOIN camp ON camp.id = snapshot.camp_id
        JOIN camp_member
          ON camp_member.camp_id = camp.id
         AND camp_member.agent_id = ?2
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        JOIN camp_message AS message ON message.camp_id = snapshot.camp_id
        JOIN camp_message_fts ON camp_message_fts.rowid = message.rowid
        JOIN event_log AS sent
          ON sent.entity_type = 'camp_message'
         AND sent.entity_id = message.id
         AND sent.event_type = 'camp_message.sent'
        WHERE snapshot.context_manifest_id = ?1
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
          AND sent.global_sequence <= ?3
          AND message.tombstoned_at IS NULL
          AND message.camp_id IN (SELECT value FROM json_each(?4))
          AND (?5 IS NULL OR julianday(message.created_at) >= julianday(?5))
          AND (?6 IS NULL OR julianday(message.created_at) < julianday(?6))
          AND camp_message_fts MATCH ?8
        ORDER BY sent.global_sequence DESC, message.camp_id, message.id
        LIMIT ?7
        "#
    };
    let camp_ids = serde_json::to_string(scope.camp_ids)?;
    let from = scope.dates.lower_bound_parameter();
    let to = scope.dates.upper_bound_parameter();
    let mut statement = transaction.prepare(sql)?;
    let rows = if short {
        statement
            .query_map(
                params![
                    scope.fence.manifest_id,
                    scope.run.agent_id,
                    scope.fence.global_boundary,
                    camp_ids,
                    from,
                    to,
                    (budget + 1) as i64,
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        statement
            .query_map(
                params![
                    scope.fence.manifest_id,
                    scope.run.agent_id,
                    scope.fence.global_boundary,
                    camp_ids,
                    from,
                    to,
                    (budget + 1) as i64,
                    literal_fts_query(query),
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    body_candidates(rows, query, budget, short)
}

fn body_candidates(
    mut rows: Vec<MessageRow>,
    query: &str,
    budget: usize,
    require_local_match: bool,
) -> Result<CandidatePage> {
    let incomplete = rows.len() > budget;
    rows.truncate(budget);
    let mut candidates = HashMap::new();
    for row in rows {
        let ranked = rank_message(row, query, false);
        if require_local_match && ranked.occurrence_count == 0 {
            continue;
        }
        candidates.insert(
            (ranked.message.camp_id.clone(), ranked.message.id.clone()),
            ranked,
        );
    }
    Ok((candidates, incomplete))
}

fn merge_current_reference_candidates(
    transaction: &Transaction<'_>,
    fence: &RunFence,
    query: &str,
    limit: usize,
    candidates: &mut CandidateMap,
) -> Result<()> {
    for (kind, value) in extract_query_references(query).into_iter().take(20) {
        let mut statement = transaction.prepare(
            r#"
            SELECT message.id, message.camp_id, message.sequence,
                   message.author_type, message.author_id,
                   message.reply_to_camp_message_id, message.body,
                   message.created_at, message.sequence, NULL
            FROM camp_message_reference AS reference
            JOIN camp_message AS message ON message.id = reference.camp_message_id
            WHERE reference.kind = ?1 AND reference.value = ?2
              AND message.camp_id = ?3
              AND message.sequence <= ?4
              AND message.tombstoned_at IS NULL
            ORDER BY message.sequence DESC, message.id
            LIMIT ?5
            "#,
        )?;
        let rows = statement
            .query_map(
                params![
                    kind,
                    value,
                    fence.current_camp_id,
                    fence.current_boundary,
                    (limit + 1) as i64
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        merge_reference_rows(candidates, rows, query);
    }
    Ok(())
}

fn merge_history_reference_candidates(
    transaction: &Transaction<'_>,
    scope: &HistorySearchScope<'_>,
    query: &str,
    limit: usize,
    candidates: &mut CandidateMap,
) -> Result<()> {
    let camp_ids = serde_json::to_string(scope.camp_ids)?;
    let from = scope.dates.lower_bound_parameter();
    let to = scope.dates.upper_bound_parameter();
    for (kind, value) in extract_query_references(query).into_iter().take(20) {
        let mut statement = transaction.prepare(
            r#"
            SELECT message.id, message.camp_id, message.sequence,
                   message.author_type, message.author_id,
                   message.reply_to_camp_message_id, message.body,
                   message.created_at, sent.global_sequence, snapshot.camp_title
            FROM camp_message_reference AS reference
            JOIN camp_message AS message ON message.id = reference.camp_message_id
            JOIN context_manifest_history_camp AS snapshot
              ON snapshot.context_manifest_id = ?1
             AND snapshot.camp_id = message.camp_id
            JOIN camp ON camp.id = snapshot.camp_id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = ?2
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            JOIN event_log AS sent
              ON sent.entity_type = 'camp_message'
             AND sent.entity_id = message.id
             AND sent.event_type = 'camp_message.sent'
            WHERE reference.kind = ?3 AND reference.value = ?4
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
              AND sent.global_sequence <= ?5
              AND message.tombstoned_at IS NULL
              AND message.camp_id IN (SELECT value FROM json_each(?6))
              AND (?7 IS NULL OR julianday(message.created_at) >= julianday(?7))
              AND (?8 IS NULL OR julianday(message.created_at) < julianday(?8))
            ORDER BY sent.global_sequence DESC, message.camp_id, message.id
            LIMIT ?9
            "#,
        )?;
        let rows = statement
            .query_map(
                params![
                    scope.fence.manifest_id,
                    scope.run.agent_id,
                    kind,
                    value,
                    scope.fence.global_boundary,
                    camp_ids,
                    from,
                    to,
                    (limit + 1) as i64,
                ],
                message_search_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        merge_reference_rows(candidates, rows, query);
    }
    Ok(())
}

fn merge_reference_rows(candidates: &mut CandidateMap, rows: Vec<MessageRow>, query: &str) {
    for row in rows {
        let key = (row.camp_id.clone(), row.id.clone());
        candidates
            .entry(key)
            .and_modify(|candidate| candidate.exact_reference = true)
            .or_insert_with(|| rank_message(row, query, true));
    }
}

fn extract_query_references(query: &str) -> Vec<(String, String)> {
    let mut references = Vec::new();
    let mut seen = HashSet::new();
    for token in query.split(|character: char| {
        !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
    }) {
        if token.is_empty() {
            continue;
        }
        let lower = token.to_ascii_lowercase();
        let reference = [
            ("adr-", "adr", "ADR-"),
            ("pr-", "pr", "PR-"),
            ("issue-", "issue", "issue-"),
        ]
        .into_iter()
        .find_map(|(prefix, kind, canonical)| {
            lower.strip_prefix(prefix).and_then(|number| {
                (!number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
                    .then(|| (kind.to_string(), format!("{canonical}{number}")))
            })
        })
        .or_else(|| {
            Uuid::parse_str(token)
                .ok()
                .map(|uuid| ("task".to_string(), uuid.to_string()))
        });
        if let Some(reference) = reference
            && seen.insert(reference.clone())
        {
            references.push(reference);
        }
    }
    references
}

fn message_search_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        id: row.get(0)?,
        camp_id: row.get(1)?,
        sequence: row.get(2)?,
        author_type: row.get(3)?,
        author_id: row.get(4)?,
        reply_to_message_id: row.get(5)?,
        body: row.get(6)?,
        created_at: row.get(7)?,
        recency: row.get(8)?,
        camp_title: row.get(9)?,
    })
}

fn rank_message(message: MessageRow, query: &str, exact_reference: bool) -> RankedMessage {
    let (occurrence_count, first_match_offset) = literal_match_rank(&message.body, query);
    let body_length = message.body.chars().count();
    RankedMessage {
        message,
        exact_reference,
        occurrence_count,
        first_match_offset,
        body_length,
    }
}

fn literal_match_rank(body: &str, query: &str) -> (usize, usize) {
    let body = body.chars().map(fold_char).collect::<Vec<_>>();
    let query = query.chars().map(fold_char).collect::<Vec<_>>();
    if query.is_empty() || body.len() < query.len() {
        return (0, usize::MAX);
    }
    let mut count = 0;
    let mut first = usize::MAX;
    for offset in 0..=body.len() - query.len() {
        if body[offset..offset + query.len()] == query {
            count = (count + 1).min(32);
            first = first.min(offset);
            if count == 32 {
                break;
            }
        }
    }
    (count, first)
}

fn compare_ranked(left: &RankedMessage, right: &RankedMessage) -> Ordering {
    right
        .exact_reference
        .cmp(&left.exact_reference)
        .then_with(|| right.occurrence_count.cmp(&left.occurrence_count))
        .then_with(|| left.first_match_offset.cmp(&right.first_match_offset))
        .then_with(|| left.body_length.cmp(&right.body_length))
        .then_with(|| right.message.recency.cmp(&left.message.recency))
        .then_with(|| left.message.camp_id.cmp(&right.message.camp_id))
        .then_with(|| left.message.id.cmp(&right.message.id))
}

fn ranked_search_response(
    candidates: CandidateMap,
    _query: &str,
    limit: usize,
    include_camp_title: bool,
    search_incomplete: bool,
) -> Result<Value> {
    let mut candidates = candidates.into_values().collect::<Vec<_>>();
    candidates.sort_by(compare_ranked);
    let truncated = candidates.len() > limit;
    candidates.truncate(limit);
    let results = candidates
        .into_iter()
        .map(|candidate| {
            let mut value = json!({
                "campId": candidate.message.camp_id,
                "messageId": candidate.message.id,
                "sequence": candidate.message.sequence,
                "authorType": candidate.message.author_type,
                "authorId": candidate.message.author_id,
                "replyToMessageId": candidate.message.reply_to_message_id,
                "createdAt": candidate.message.created_at,
                "snippet": snippet(
                    &candidate.message.body,
                    (candidate.first_match_offset != usize::MAX)
                        .then_some(candidate.first_match_offset),
                ),
            });
            if include_camp_title {
                value["campTitle"] = json!(candidate.message.camp_title);
            }
            value
        })
        .collect::<Vec<_>>();
    cap_top_k_response(
        json!({
            "results": results,
            "truncated": truncated,
            "searchIncomplete": search_incomplete,
        }),
        "results",
    )
}

fn snippet(body: &str, first_match: Option<usize>) -> String {
    let chars = body.chars().collect::<Vec<_>>();
    if chars.len() <= MAX_SNIPPET_CHARS {
        return body.to_string();
    }
    let mut start = first_match.unwrap_or(0).saturating_sub(60);
    let prefix = usize::from(start > 0);
    let available = MAX_SNIPPET_CHARS - prefix - 1;
    if start + available > chars.len() {
        start = chars.len().saturating_sub(available);
    }
    let suffix = usize::from(start + available < chars.len());
    let content_limit = MAX_SNIPPET_CHARS - usize::from(start > 0) - suffix;
    let mut result = String::new();
    if start > 0 {
        result.push('…');
    }
    result.extend(chars[start..(start + content_limit).min(chars.len())].iter());
    if start + content_limit < chars.len() {
        result.push('…');
    }
    result
}

fn cap_top_k_response(mut response: Value, key: &str) -> Result<Value> {
    loop {
        if json_chars(&response)? <= MAX_RESPONSE_CHARS {
            return Ok(response);
        }
        let Some(items) = response.get_mut(key).and_then(Value::as_array_mut) else {
            return Err(tool_error(
                "camp.response_overloaded",
                "Camp history response metadata exceeds the hard limit",
            ));
        };
        if items.pop().is_none() {
            return Err(tool_error(
                "camp.response_overloaded",
                "Camp history response metadata exceeds the hard limit",
            ));
        }
        response["truncated"] = Value::Bool(true);
    }
}

fn read_item(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    message_id: &str,
    body_offset: usize,
    body_limit: usize,
) -> Result<Value> {
    let message =
        load_visible_message(transaction, target, message_id)?.ok_or_else(read_unavailable)?;
    let body_length = message.body.chars().count();
    if body_offset > body_length {
        return Err(invalid_argument(
            "bodyOffset exceeds the message body length",
        ));
    }
    let body = message
        .body
        .chars()
        .skip(body_offset)
        .take(body_limit)
        .collect::<String>();
    let returned = body.chars().count();
    let next_offset = body_offset + returned;
    let (attachments, attachment_count) = load_attachments(transaction, message_id)?;
    let value = json!({
        "campId": target.camp_id,
        "mode": "item",
        "items": [{
            "messageId": message.id,
            "sequence": message.sequence,
            "authorType": message.author_type,
            "authorId": message.author_id,
            "replyToMessageId": message.reply_to_message_id,
            "createdAt": message.created_at,
            "body": body,
            "bodyOffset": body_offset,
            "bodyLength": body_length,
            "bodyTruncated": next_offset < body_length || body_offset > 0,
            "nextBodyOffset": (next_offset < body_length).then_some(next_offset),
            "attachmentCount": attachment_count,
            "attachments": attachments,
            "attachmentsTruncated": attachment_count > MAX_ATTACHMENTS,
            "attachmentOmittedCount": attachment_count.saturating_sub(MAX_ATTACHMENTS),
        }]
    });
    if json_chars(&value)? > MAX_RESPONSE_CHARS {
        return Err(tool_error(
            "camp.response_overloaded",
            "Camp message metadata exceeds the hard response limit",
        ));
    }
    Ok(value)
}

fn read_around(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    message_id: &str,
    before: usize,
    after: usize,
) -> Result<Value> {
    let anchor =
        load_visible_message(transaction, target, message_id)?.ok_or_else(read_unavailable)?;
    let mut preceding = load_relative_messages(
        transaction,
        target,
        ReadDirection::Before,
        anchor.sequence,
        before + 1,
    )?;
    let has_more_before = preceding.len() > before;
    preceding.truncate(before);
    preceding.reverse();
    let mut following = load_relative_messages(
        transaction,
        target,
        ReadDirection::After,
        anchor.sequence,
        after + 1,
    )?;
    let has_more_after = following.len() > after;
    following.truncate(after);
    preceding.push(anchor);
    preceding.extend(following);
    fit_collection_response(
        transaction,
        preceding,
        json!({
            "campId": target.camp_id,
            "mode": "around",
            "anchorMessageId": message_id,
            "items": [],
            "hasMoreBefore": has_more_before,
            "hasMoreAfter": has_more_after,
        }),
    )
}

fn read_thread(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    message_id: &str,
    direction: ReadDirection,
    cursor: Option<i64>,
    limit: usize,
) -> Result<Value> {
    let anchor =
        load_visible_message(transaction, target, message_id)?.ok_or_else(read_unavailable)?;
    let root = resolve_thread_root(transaction, target, anchor.clone())?;
    let boundary = cursor.unwrap_or(anchor.sequence);
    let inclusive = cursor.is_none();
    let mut rows = load_thread_page(
        transaction,
        target,
        &root.id,
        direction,
        boundary,
        inclusive,
        limit + 1,
    )?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    if direction == ReadDirection::Before {
        rows.reverse();
    }
    let next_cursor = if has_more {
        match direction {
            ReadDirection::Before => rows.first().map(|row| row.sequence),
            ReadDirection::After => rows.last().map(|row| row.sequence),
        }
    } else {
        None
    };
    fit_collection_response(
        transaction,
        rows,
        json!({
            "campId": target.camp_id,
            "mode": "thread",
            "anchorMessageId": message_id,
            "threadRootMessageId": root.id,
            "direction": direction.as_str(),
            "items": [],
            "nextCursor": next_cursor,
            "hasMore": has_more,
        }),
    )
}

fn read_timeline(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    direction: ReadDirection,
    cursor: Option<i64>,
    limit: usize,
) -> Result<Value> {
    let mut rows = load_timeline_page(transaction, target, direction, cursor, limit + 1)?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    if direction == ReadDirection::Before {
        rows.reverse();
    }
    let next_cursor = if has_more {
        match direction {
            ReadDirection::Before => rows.first().map(|row| row.sequence),
            ReadDirection::After => rows.last().map(|row| row.sequence),
        }
    } else {
        None
    };
    fit_collection_response(
        transaction,
        rows,
        json!({
            "campId": target.camp_id,
            "mode": "timeline",
            "direction": direction.as_str(),
            "items": [],
            "nextCursor": next_cursor,
            "hasMore": has_more,
        }),
    )
}

fn load_visible_message(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    message_id: &str,
) -> Result<Option<MessageRow>> {
    let (sql, parameter) = match target.fence {
        MessageFence::Current { boundary } => (
            r#"
            SELECT id, camp_id, sequence, author_type, author_id,
                   reply_to_camp_message_id, body, created_at, sequence, NULL
            FROM camp_message
            WHERE id = ?1 AND camp_id = ?2
              AND sequence <= ?3 AND tombstoned_at IS NULL
            "#,
            boundary,
        ),
        MessageFence::History { global_boundary } => (
            r#"
            SELECT message.id, message.camp_id, message.sequence,
                   message.author_type, message.author_id,
                   message.reply_to_camp_message_id, message.body,
                   message.created_at, sent.global_sequence, NULL
            FROM camp_message AS message
            JOIN event_log AS sent
              ON sent.entity_type = 'camp_message'
             AND sent.entity_id = message.id
             AND sent.event_type = 'camp_message.sent'
            WHERE message.id = ?1 AND message.camp_id = ?2
              AND sent.global_sequence <= ?3
              AND message.tombstoned_at IS NULL
            ORDER BY sent.global_sequence DESC
            LIMIT 1
            "#,
            global_boundary,
        ),
    };
    transaction
        .query_row(
            sql,
            params![message_id, target.camp_id, parameter],
            message_search_row,
        )
        .optional()
        .map_err(Into::into)
}

fn load_relative_messages(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    direction: ReadDirection,
    cursor: i64,
    limit: usize,
) -> Result<Vec<MessageRow>> {
    load_ordered_messages(
        transaction,
        target,
        direction,
        Some(cursor),
        false,
        limit,
        None,
    )
}

fn load_timeline_page(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    direction: ReadDirection,
    cursor: Option<i64>,
    limit: usize,
) -> Result<Vec<MessageRow>> {
    load_ordered_messages(transaction, target, direction, cursor, false, limit, None)
}

fn load_ordered_messages(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    direction: ReadDirection,
    cursor: Option<i64>,
    inclusive: bool,
    limit: usize,
    thread_root_id: Option<&str>,
) -> Result<Vec<MessageRow>> {
    let comparator = match (direction, cursor, inclusive) {
        (ReadDirection::Before, Some(_), false) => "<",
        (ReadDirection::Before, Some(_), true) => "<=",
        (ReadDirection::After, Some(_), false) => ">",
        (ReadDirection::After, Some(_), true) => ">=",
        (_, None, _) => "",
    };
    let order = if direction == ReadDirection::Before {
        "DESC"
    } else {
        "ASC"
    };
    let cursor_filter = cursor
        .map(|_| format!("AND message.sequence {comparator} ?3"))
        .unwrap_or_default();
    let thread_cte = thread_root_id.map_or_else(String::new, |root| {
        let escaped = root.replace('\'', "''");
        format!(
            "WITH RECURSIVE thread(id) AS (\
             SELECT '{escaped}' UNION ALL \
             SELECT child.id FROM camp_message AS child \
             JOIN thread ON child.reply_to_camp_message_id = thread.id)"
        )
    });
    let thread_join = thread_root_id.map_or("", |_| "JOIN thread ON thread.id = message.id");
    let fence_filter = match target.fence {
        MessageFence::Current { .. } => "AND message.sequence <= ?2",
        MessageFence::History { .. } => {
            "AND EXISTS (SELECT 1 FROM event_log AS sent WHERE sent.entity_type = 'camp_message' AND sent.entity_id = message.id AND sent.event_type = 'camp_message.sent' AND sent.global_sequence <= ?2)"
        }
    };
    let sql = format!(
        r#"
        {thread_cte}
        SELECT message.id, message.camp_id, message.sequence,
               message.author_type, message.author_id,
               message.reply_to_camp_message_id, message.body,
               message.created_at, message.sequence, NULL
        FROM camp_message AS message
        {thread_join}
        WHERE message.camp_id = ?1
          {fence_filter}
          AND message.tombstoned_at IS NULL
          {cursor_filter}
        ORDER BY message.sequence {order}, message.id
        LIMIT ?4
        "#
    );
    let boundary = match target.fence {
        MessageFence::Current { boundary } => boundary,
        MessageFence::History { global_boundary } => global_boundary,
    };
    let cursor_parameter = cursor.unwrap_or(0);
    let mut statement = transaction.prepare(&sql)?;
    statement
        .query_map(
            params![target.camp_id, boundary, cursor_parameter, limit as i64],
            message_search_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn resolve_thread_root(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    mut message: MessageRow,
) -> Result<MessageRow> {
    let mut seen = HashSet::new();
    while let Some(parent_id) = message.reply_to_message_id.clone() {
        if !seen.insert(message.id.clone()) {
            return Err(read_unavailable());
        }
        message =
            load_visible_message(transaction, target, &parent_id)?.ok_or_else(read_unavailable)?;
    }
    Ok(message)
}

fn load_thread_page(
    transaction: &Transaction<'_>,
    target: &ReadTarget,
    root_message_id: &str,
    direction: ReadDirection,
    boundary: i64,
    inclusive: bool,
    limit: usize,
) -> Result<Vec<MessageRow>> {
    load_ordered_messages(
        transaction,
        target,
        direction,
        Some(boundary),
        inclusive,
        limit,
        Some(root_message_id),
    )
}

fn load_attachments(
    transaction: &Transaction<'_>,
    message_id: &str,
) -> Result<(Vec<Value>, usize)> {
    let count = transaction.query_row(
        "SELECT COUNT(*) FROM message_attachment WHERE camp_message_id = ?1",
        [message_id],
        |row| row.get::<_, i64>(0),
    )? as usize;
    let mut statement = transaction.prepare(
        r#"
        SELECT id, display_name, media_type, byte_size, storage_path
        FROM message_attachment
        WHERE camp_message_id = ?1
        ORDER BY position, id
        LIMIT ?2
        "#,
    )?;
    let attachments = statement
        .query_map(params![message_id, MAX_ATTACHMENTS as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let attachments = attachments
        .into_iter()
        .map(
            |(attachment_id, name, media_type, byte_size, storage_path)| {
                let summary = managed_attachment_summary(Path::new(&storage_path), &media_type)?;
                Ok(json!({
                    "attachmentId": attachment_id,
                    "name": truncate_metadata(name),
                    "kind": summary.kind,
                    "fileCount": summary.file_count,
                    "mediaType": truncate_metadata(media_type),
                    "byteSize": byte_size,
                }))
            },
        )
        .collect::<Result<Vec<_>>>()?;
    Ok((attachments, count))
}

fn attachment_count(transaction: &Transaction<'_>, message_id: &str) -> Result<usize> {
    transaction
        .query_row(
            "SELECT COUNT(*) FROM message_attachment WHERE camp_message_id = ?1",
            [message_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count as usize)
        .map_err(Into::into)
}

fn fit_collection_response(
    transaction: &Transaction<'_>,
    rows: Vec<MessageRow>,
    mut response: Value,
) -> Result<Value> {
    let mut prefix = COLLECTION_BODY_PREFIX_CHARS;
    loop {
        let items = rows
            .iter()
            .map(|row| collection_item(transaction, row, prefix))
            .collect::<Result<Vec<_>>>()?;
        response["items"] = Value::Array(items);
        if json_chars(&response)? <= MAX_RESPONSE_CHARS {
            return Ok(response);
        }
        prefix = match prefix {
            500.. => 400,
            400..=499 => 300,
            300..=399 => 200,
            200..=299 => 100,
            100..=199 => 50,
            50..=99 => 1,
            _ => {
                return Err(tool_error(
                    "camp.response_overloaded",
                    "Camp message page metadata exceeds the hard response limit",
                ));
            }
        };
    }
}

fn collection_item(
    transaction: &Transaction<'_>,
    row: &MessageRow,
    prefix_limit: usize,
) -> Result<Value> {
    let body_length = row.body.chars().count();
    let body = row.body.chars().take(prefix_limit).collect::<String>();
    let returned = body.chars().count();
    Ok(json!({
        "messageId": row.id,
        "sequence": row.sequence,
        "authorType": row.author_type,
        "authorId": row.author_id,
        "replyToMessageId": row.reply_to_message_id,
        "createdAt": row.created_at,
        "body": body,
        "bodyOffset": 0,
        "bodyLength": body_length,
        "bodyTruncated": returned < body_length,
        "nextBodyOffset": (returned < body_length).then_some(returned),
        "attachmentCount": attachment_count(transaction, &row.id)?,
    }))
}

fn truncate_metadata(value: String) -> String {
    if value.chars().count() <= 500 {
        value
    } else {
        value.chars().take(500).collect()
    }
}

fn json_chars(value: &Value) -> Result<usize> {
    Ok(serde_json::to_string(value)?.chars().count())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    #[test]
    fn literal_helpers_are_bounded_and_reference_aware() {
        assert_eq!(literal_fts_query(r#"a" OR b*"#), r#""a"" OR b*""#);
        assert_eq!(literal_match_rank("令牌令牌轮换", "令牌"), (2, 0));
        assert_eq!(literal_match_rank("Alpha beta", "BETA"), (1, 6));
        assert_eq!(
            extract_query_references("check ADR-49 and issue-7"),
            vec![
                ("adr".to_string(), "ADR-49".to_string()),
                ("issue".to_string(), "issue-7".to_string()),
            ]
        );
        assert!(snippet(&"x".repeat(500), Some(250)).chars().count() <= 200);
    }

    #[test]
    fn per_tool_limits_and_dates_are_strict() {
        assert_eq!(effective_limit(None, 10, 20).unwrap(), 10);
        assert!(effective_limit(Some(0), 10, 20).is_err());
        assert!(effective_limit(Some(21), 10, 20).is_err());
        assert!(required_query("   ").is_err());
        assert!(
            parse_date_range(Some("2026-08-02T00:00:00Z"), Some("2026-08-01T00:00:00Z")).is_err()
        );
        let normalized = parse_date_range(
            Some("2026-08-01T08:00:00+08:00"),
            Some("2026-08-02T08:00:00+08:00"),
        )
        .unwrap();
        assert_eq!(
            normalized.lower_bound_parameter().as_deref(),
            Some("2026-08-01T00:00:00+00:00")
        );
        assert_eq!(
            normalized.upper_bound_parameter().as_deref(),
            Some("2026-08-02T00:00:00+00:00")
        );
    }

    #[test]
    fn candidate_budget_and_top_k_truncation_are_independent() {
        let rows = (1..=9)
            .map(|sequence| MessageRow {
                id: format!("message-{sequence}"),
                camp_id: "camp-1".to_string(),
                sequence,
                author_type: "user".to_string(),
                author_id: "local-user".to_string(),
                reply_to_message_id: None,
                body: "任务".to_string(),
                created_at: "2026-08-01T00:00:00Z".to_string(),
                recency: sequence,
                camp_title: None,
            })
            .collect();
        let (candidates, search_incomplete) = body_candidates(rows, "任务", 8, true).unwrap();
        assert!(search_incomplete);
        assert_eq!(candidates.len(), 8);

        let response =
            ranked_search_response(candidates, "任务", 5, false, search_incomplete).unwrap();
        assert_eq!(response["results"].as_array().unwrap().len(), 5);
        assert_eq!(response["truncated"], true);
        assert_eq!(response["searchIncomplete"], true);

        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE camp_message (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    author_type TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    reply_to_camp_message_id TEXT,
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    tombstoned_at TEXT
                );
                "#,
            )
            .unwrap();
        for sequence in 1..=9 {
            connection
                .execute(
                    "INSERT INTO camp_message(id, camp_id, sequence, author_type, author_id, body, created_at) VALUES (?1, 'camp-1', ?2, 'user', 'local-user', 'x', '2026-08-01T00:00:00Z')",
                    params![format!("short-{sequence}"), sequence],
                )
                .unwrap();
        }
        let transaction = connection.transaction().unwrap();
        let (short_candidates, short_incomplete) = load_current_body_candidates(
            &transaction,
            &RunFence {
                manifest_id: "manifest-1".to_string(),
                current_camp_id: "camp-1".to_string(),
                current_boundary: 100,
                global_boundary: 100,
            },
            "x",
            8,
        )
        .unwrap();
        assert_eq!(short_candidates.len(), 8);
        assert!(short_incomplete);
    }

    #[test]
    fn top_k_reorders_by_relevance_without_exposing_a_cursor() {
        let row = |id: &str, body: &str, recency: i64| MessageRow {
            id: id.to_string(),
            camp_id: "camp-1".to_string(),
            sequence: recency,
            author_type: "user".to_string(),
            author_id: "local-user".to_string(),
            reply_to_message_id: None,
            body: body.to_string(),
            created_at: "2026-08-01T00:00:00Z".to_string(),
            recency,
            camp_title: Some("Camp".to_string()),
        };
        let mut candidates = CandidateMap::new();
        let reference = row("reference", "no literal match", 1);
        let frequent = row("frequent", "needle needle", 2);
        let recent = row("recent", "needle", 3);
        candidates.insert(
            (reference.camp_id.clone(), reference.id.clone()),
            rank_message(reference, "needle", true),
        );
        candidates.insert(
            (frequent.camp_id.clone(), frequent.id.clone()),
            rank_message(frequent, "needle", false),
        );
        candidates.insert(
            (recent.camp_id.clone(), recent.id.clone()),
            rank_message(recent, "needle", false),
        );

        let response = ranked_search_response(candidates, "needle", 2, false, false).unwrap();
        assert_eq!(
            response["results"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["messageId"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["reference", "frequent"]
        );
        assert_eq!(response["truncated"], true);
        assert!(response.get("nextCursor").is_none());
    }

    #[test]
    fn response_budget_keeps_collection_items_and_item_reads_use_unicode_scalars() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE camp_message (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    author_type TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    reply_to_camp_message_id TEXT,
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    tombstoned_at TEXT
                );
                CREATE TABLE message_attachment (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL,
                    camp_message_id TEXT,
                    position INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    byte_size INTEGER NOT NULL,
                    content_digest TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    preview_kind TEXT NOT NULL,
                    created_by_type TEXT NOT NULL,
                    created_by_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body, created_at
                ) VALUES (
                    'message-1', 'camp-1', 1, 'user', 'local-user', 'A😀中B',
                    '2026-08-01T00:00:00Z'
                );
                "#,
            )
            .unwrap();
        for position in 0..12 {
            connection
                .execute(
                    r#"
                    INSERT INTO message_attachment(
                        id, camp_id, camp_message_id, position, display_name, media_type,
                        byte_size, content_digest, storage_path, preview_kind,
                        created_by_type, created_by_id, created_at
                    ) VALUES (?1, 'camp-1', 'message-1', ?2, ?3, ?4, 10,
                               'sha256:attachment', ?5, 'none', 'user', 'local-user',
                               '2026-08-01T00:00:00Z')
                    "#,
                    params![
                        format!("{position}-{}.txt", "n".repeat(600)),
                        position,
                        "text name".repeat(100),
                        "text/plain",
                        format!("/private/attachment/{position}")
                    ],
                )
                .unwrap();
        }

        let transaction = connection.transaction().unwrap();
        let target = ReadTarget {
            camp_id: "camp-1".to_string(),
            fence: MessageFence::Current { boundary: 1 },
        };
        let item = read_item(&transaction, &target, "message-1", 1, 2).unwrap();
        let item = &item["items"][0];
        assert_eq!(item["body"], "😀中");
        assert_eq!(item["bodyLength"], 4);
        assert_eq!(item["nextBodyOffset"], 3);
        assert_eq!(item["attachmentCount"], 12);
        assert_eq!(item["attachments"].as_array().unwrap().len(), 10);
        assert_eq!(item["attachmentsTruncated"], true);
        assert_eq!(item["attachmentOmittedCount"], 2);
        assert!(item.get("storagePath").is_none());
        assert!(
            item["attachments"]
                .as_array()
                .unwrap()
                .iter()
                .all(|attachment| {
                    attachment["name"].as_str().unwrap().chars().count() <= 500
                        && attachment.get("storagePath").is_none()
                        && attachment.get("content").is_none()
                })
        );

        let rows = (1..=20)
            .map(|sequence| MessageRow {
                id: format!("message-{sequence}"),
                camp_id: "camp-1".to_string(),
                sequence,
                author_type: "user".to_string(),
                author_id: "local-user".to_string(),
                reply_to_message_id: None,
                body: "x".repeat(1_000),
                created_at: "2026-08-01T00:00:00Z".to_string(),
                recency: sequence,
                camp_title: None,
            })
            .collect();
        let collection = fit_collection_response(
            &transaction,
            rows,
            json!({
                "campId": "camp-1",
                "mode": "timeline",
                "direction": "after",
                "items": [],
                "hasMore": false,
                "nextCursor": null
            }),
        )
        .unwrap();
        assert_eq!(collection["items"].as_array().unwrap().len(), 20);
        assert!(
            collection["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["body"].as_str().unwrap().chars().count() <= 500)
        );
        assert!(json_chars(&collection).unwrap() <= MAX_RESPONSE_CHARS);
    }
}
