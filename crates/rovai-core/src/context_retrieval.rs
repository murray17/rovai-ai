use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::{
    db::Database,
    team_tool::{AuthenticatedTeamToolRun, TeamToolInvocationError},
};

pub const CONTEXT_SEARCH_TOOL_NAME: &str = "context.search";
pub const CONTEXT_GET_MESSAGE_TOOL_NAME: &str = "context.get_message";
pub const CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME: &str = "context.get_message_window";
pub const CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME: &str = "context.get_message_thread";
pub const CONTEXT_GET_SUMMARY_TOOL_NAME: &str = "context.get_summary";

const MAX_BODY_CHARS: usize = 4_000;
const MAX_RESPONSE_CHARS: usize = 16_000;
const MAX_ATTACHMENTS: usize = 10;
const MAX_SEARCH_LIMIT: usize = 20;
const MAX_SEARCH_SNIPPET_CHARS: usize = 200;
const MAX_WINDOW_RADIUS: usize = 25;
const MAX_THREAD_MESSAGES: usize = 100;
const MAX_SHORT_QUERY_SCAN: usize = 10_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSearchScope {
    Messages,
    Summaries,
    #[default]
    All,
}

#[derive(Debug, Clone, Copy)]
struct ShortSearchBounds {
    sequence_from: i64,
    sequence_through: i64,
    limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSearchInput {
    pub query: Option<String>,
    #[serde(default)]
    pub scope: ContextSearchScope,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub sender_ids: Vec<String>,
    pub sequence_from: Option<i64>,
    pub sequence_through: Option<i64>,
    #[serde(default)]
    pub limit: usize,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextGetMessageInput {
    pub message_id: String,
    #[serde(default)]
    pub body_offset: usize,
    #[serde(default)]
    pub body_limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextGetMessageWindowInput {
    pub message_id: String,
    pub before: Option<usize>,
    pub after: Option<usize>,
    pub sequence_from: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextGetMessageThreadInput {
    pub root_message_id: String,
    pub sequence_from: Option<i64>,
    #[serde(default)]
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextGetSummaryInput {
    pub summary_id: String,
}

#[derive(Debug, Clone)]
struct RetrievalFence {
    camp_id: String,
    boundary: i64,
}

#[derive(Debug, Clone)]
struct SearchCandidate {
    kind: &'static str,
    id: String,
    sequence: i64,
    exact_reference: bool,
    rank: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentResult {
    attachment_id: String,
    name: String,
    media_type: String,
    byte_size: i64,
}

#[derive(Debug, Clone)]
struct MessageRow {
    id: String,
    sequence: i64,
    author_type: String,
    author_id: String,
    reply_to_message_id: Option<String>,
    body: String,
}

#[derive(Debug, Default)]
pub struct ContextRetrievalService;

impl ContextRetrievalService {
    pub fn search_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "query": {"type": "string"},
                "scope": {"type": "string", "enum": ["messages", "summaries", "all"]},
                "references": {"type": "array", "maxItems": 20, "items": {"type": "string", "minLength": 1}},
                "senderIds": {"type": "array", "maxItems": 20, "items": {"type": "string", "minLength": 1}},
                "sequenceFrom": {"type": "integer", "minimum": 1},
                "sequenceThrough": {"type": "integer", "minimum": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
                "cursor": {"type": "string", "minLength": 1}
            }
        })
    }

    pub fn get_message_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["messageId"],
            "properties": {
                "messageId": {"type": "string", "minLength": 1},
                "bodyOffset": {"type": "integer", "minimum": 0},
                "bodyLimit": {"type": "integer", "minimum": 1, "maximum": 4000}
            }
        })
    }

    pub fn get_message_window_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["messageId"],
            "properties": {
                "messageId": {"type": "string", "minLength": 1},
                "before": {"type": "integer", "minimum": 0, "maximum": 25},
                "after": {"type": "integer", "minimum": 0, "maximum": 25},
                "sequenceFrom": {"type": "integer", "minimum": 1}
            }
        })
    }

    pub fn get_message_thread_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["rootMessageId"],
            "properties": {
                "rootMessageId": {"type": "string", "minLength": 1},
                "sequenceFrom": {"type": "integer", "minimum": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100}
            }
        })
    }

    pub fn get_summary_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["summaryId"],
            "properties": {
                "summaryId": {"type": "string", "minLength": 1}
            }
        })
    }

    pub fn search(
        &self,
        database: &Database,
        run: &AuthenticatedTeamToolRun,
        input: &ContextSearchInput,
    ) -> Result<Value> {
        let fence = load_fence(database, run)?;
        let limit = effective_limit(input.limit, 10, MAX_SEARCH_LIMIT)?;
        let query = input
            .query
            .as_deref()
            .map(str::trim)
            .filter(|query| !query.is_empty());
        if query.is_none()
            && input.references.is_empty()
            && input.scope != ContextSearchScope::Summaries
        {
            return Err(tool_error(
                "context.invalid_search",
                "query or references are required unless scope is summaries",
            ));
        }
        if input.references.len() > 20 || input.sender_ids.len() > 20 {
            return Err(tool_error(
                "context.invalid_search",
                "references and senderIds each allow at most 20 entries",
            ));
        }
        let sequence_from = input.sequence_from.unwrap_or(1).max(1);
        let sequence_through = input
            .sequence_through
            .unwrap_or(fence.boundary)
            .min(fence.boundary);
        if sequence_from > sequence_through {
            return Ok(json!({
                "results": [],
                "nextCursor": null,
                "truncated": false,
                "omittedCount": 0,
                "boundarySequence": fence.boundary,
            }));
        }

        let short_query = query.is_some_and(|query| query.chars().count() < 3);
        if short_query {
            return self.search_short_context(
                database,
                &fence,
                input,
                query.context("short query disappeared")?,
                ShortSearchBounds {
                    sequence_from,
                    sequence_through,
                    limit,
                },
            );
        }

        let offset = parse_offset_cursor(input.cursor.as_deref())?;
        let mut candidates = HashMap::<(String, String), SearchCandidate>::new();
        if matches!(
            input.scope,
            ContextSearchScope::Messages | ContextSearchScope::All
        ) {
            add_reference_candidates(
                database,
                &fence,
                input,
                sequence_from,
                sequence_through,
                &mut candidates,
            )?;
            if let Some(query) = query {
                add_message_fts_candidates(
                    database,
                    &fence,
                    input,
                    query,
                    sequence_from,
                    sequence_through,
                    &mut candidates,
                )?;
            }
        }
        if matches!(
            input.scope,
            ContextSearchScope::Summaries | ContextSearchScope::All
        ) {
            add_summary_candidates(
                database,
                &fence,
                query,
                sequence_from,
                sequence_through,
                &mut candidates,
            )?;
        }
        let mut candidates = candidates.into_values().collect::<Vec<_>>();
        candidates.sort_by(compare_candidates);
        let total = candidates.len();
        let page = candidates
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        let mut results = Vec::with_capacity(page.len());
        for candidate in page {
            results.push(search_candidate_value(database, &fence, query, &candidate)?);
        }
        let mut omitted = total.saturating_sub(offset + results.len());
        let mut next_cursor = (omitted > 0).then(|| format!("offset:{}", offset + results.len()));
        cap_results(
            &mut results,
            &mut omitted,
            &mut next_cursor,
            |returned| format!("offset:{}", offset + returned),
            &json!({"boundarySequence": fence.boundary}),
        )?;
        Ok(json!({
            "results": results,
            "nextCursor": next_cursor,
            "truncated": omitted > 0,
            "omittedCount": omitted,
            "boundarySequence": fence.boundary,
        }))
    }

    fn search_short_context(
        &self,
        database: &Database,
        fence: &RetrievalFence,
        input: &ContextSearchInput,
        query: &str,
        bounds: ShortSearchBounds,
    ) -> Result<Value> {
        let (cursor_through, cursor_tie_offset, reference_offset) =
            parse_short_cursor(input.cursor.as_deref())?.unwrap_or((bounds.sequence_through, 0, 0));
        let cursor_through = cursor_through.min(bounds.sequence_through);
        let mut reference_candidates = HashMap::new();
        if matches!(
            input.scope,
            ContextSearchScope::Messages | ContextSearchScope::All
        ) {
            add_reference_candidates(
                database,
                fence,
                input,
                bounds.sequence_from,
                bounds.sequence_through,
                &mut reference_candidates,
            )?;
        }
        let exact_reference_ids = reference_candidates
            .keys()
            .map(|(_, id)| id.clone())
            .collect::<HashSet<_>>();
        let mut reference_candidates = reference_candidates.into_values().collect::<Vec<_>>();
        reference_candidates.sort_by(compare_candidates);
        let mut results = reference_candidates
            .iter()
            .skip(reference_offset)
            .take(bounds.limit)
            .map(|candidate| search_candidate_value(database, fence, Some(query), candidate))
            .collect::<Result<Vec<_>>>()?;
        let next_reference_offset = reference_offset + results.len();
        let references_remain = next_reference_offset < reference_candidates.len();
        if references_remain {
            let next_cursor =
                format!("short:{cursor_through}:{cursor_tie_offset}:{next_reference_offset}");
            return Ok(json!({
                "results": results,
                "nextCursor": next_cursor,
                "truncated": true,
                "scanBounded": true,
                "scannedThroughSequence": cursor_through,
                "hasMore": true,
                "boundarySequence": fence.boundary,
            }));
        }

        let escaped = escape_like(query);
        let rows = {
            let mut statement = database.connection().prepare(
                r#"
                WITH candidates(kind, id, sequence, author_type, author_id, body) AS (
                    SELECT 'message', id, sequence, author_type, author_id, body
                    FROM camp_message
                    WHERE ?1
                      AND camp_id = ?2 AND sequence >= ?3 AND sequence <= ?4
                      AND tombstoned_at IS NULL
                    UNION ALL
                    SELECT 'summary', id, through_sequence, '', '', body
                    FROM camp_summary
                    WHERE ?5
                      AND camp_id = ?2
                      AND through_sequence >= ?3 AND through_sequence <= ?4
                ),
                bounded AS (
                    SELECT kind, id, sequence, author_type, author_id, body
                    FROM candidates
                    WHERE sequence <= ?6
                    ORDER BY sequence DESC, kind, id
                    LIMIT ?7
                )
                SELECT kind, id, sequence, author_type, author_id, body,
                       body LIKE '%' || ?8 || '%' ESCAPE '\'
                FROM bounded
                ORDER BY sequence DESC, kind, id
                "#,
            )?;
            let include_messages = matches!(
                input.scope,
                ContextSearchScope::Messages | ContextSearchScope::All
            );
            let include_summaries = matches!(
                input.scope,
                ContextSearchScope::Summaries | ContextSearchScope::All
            );
            statement
                .query_map(
                    params![
                        include_messages,
                        fence.camp_id,
                        bounds.sequence_from,
                        bounds.sequence_through,
                        include_summaries,
                        cursor_through,
                        (MAX_SHORT_QUERY_SCAN + cursor_tie_offset + 1) as i64,
                        escaped
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, bool>(6)?,
                        ))
                    },
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let sender_filter = input.sender_ids.iter().collect::<HashSet<_>>();
        let mut scanned_through = cursor_through;
        let mut tie_offset = cursor_tie_offset;
        let mut skipped_at_cursor = 0;
        let mut scanned_count = 0;
        let mut row_index = 0;
        while row_index < rows.len() && scanned_count < MAX_SHORT_QUERY_SCAN {
            if results.len() == bounds.limit {
                break;
            }
            let row = &rows[row_index];
            row_index += 1;
            if row.2 == cursor_through && skipped_at_cursor < cursor_tie_offset {
                skipped_at_cursor += 1;
                continue;
            }
            scanned_count += 1;
            if row.2 == scanned_through {
                tie_offset += 1;
            } else {
                scanned_through = row.2;
                tie_offset = 1;
            }
            if !row.6
                || (row.0 == "message" && exact_reference_ids.contains(&row.1))
                || (row.0 == "message"
                    && !sender_filter.is_empty()
                    && !sender_filter.contains(&row.4))
            {
                continue;
            }
            if row.0 == "message" {
                results.push(json!({
                    "kind": "message",
                    "messageId": row.1,
                    "sequence": row.2,
                    "senderType": row.3,
                    "senderId": row.4,
                    "snippet": snippet(&row.5, Some(query)),
                    "exactReferenceMatch": false,
                }));
            } else {
                let (level, from_sequence): (String, i64) = database.connection().query_row(
                    "SELECT level, from_sequence FROM camp_summary WHERE id = ?1",
                    [&row.1],
                    |summary_row| Ok((summary_row.get(0)?, summary_row.get(1)?)),
                )?;
                results.push(json!({
                    "kind": "summary",
                    "summaryId": row.1,
                    "level": level,
                    "fromSequence": from_sequence,
                    "throughSequence": row.2,
                    "snippet": snippet(&row.5, Some(query)),
                    "exactReferenceMatch": false,
                }));
            }
            if results.len() == bounds.limit {
                break;
            }
        }
        let has_more = row_index < rows.len();
        let next_cursor = has_more
            .then(|| format!("short:{scanned_through}:{tie_offset}:{next_reference_offset}"));
        Ok(json!({
            "results": results,
            "nextCursor": next_cursor,
            "truncated": has_more,
            "scanBounded": true,
            "scannedThroughSequence": scanned_through,
            "hasMore": has_more,
            "boundarySequence": fence.boundary,
        }))
    }

    pub fn get_message(
        &self,
        database: &Database,
        run: &AuthenticatedTeamToolRun,
        input: &ContextGetMessageInput,
    ) -> Result<Value> {
        let fence = load_fence(database, run)?;
        let limit = effective_limit(input.body_limit, MAX_BODY_CHARS, MAX_BODY_CHARS)?;
        let message =
            load_visible_message(database, &fence, &input.message_id)?.ok_or_else(|| {
                tool_error(
                    "context.message_not_visible",
                    "CampMessage is not visible at this Run boundary",
                )
            })?;
        let mut value = message_value(database, &message, input.body_offset, limit)?;
        value["boundarySequence"] = Value::from(fence.boundary);
        if serde_json::to_string(&value)?.chars().count() > MAX_RESPONSE_CHARS {
            return Err(tool_error(
                "context.response_overloaded",
                "Message metadata cannot fit the Context Tool response limit",
            ));
        }
        Ok(value)
    }

    pub fn get_message_window(
        &self,
        database: &Database,
        run: &AuthenticatedTeamToolRun,
        input: &ContextGetMessageWindowInput,
    ) -> Result<Value> {
        let fence = load_fence(database, run)?;
        let target =
            load_visible_message(database, &fence, &input.message_id)?.ok_or_else(|| {
                tool_error(
                    "context.message_not_visible",
                    "Window target is not visible at this Run boundary",
                )
            })?;
        let before = input.before.unwrap_or(10);
        let after = input.after.unwrap_or(10);
        if before > MAX_WINDOW_RADIUS || after > MAX_WINDOW_RADIUS {
            return Err(tool_error(
                "context.limit_exceeded",
                "before and after must not exceed 25",
            ));
        }
        let from = input
            .sequence_from
            .unwrap_or((target.sequence - before as i64).max(1))
            .max(1);
        let through = (target.sequence + after as i64).min(fence.boundary);
        let messages = load_message_range(database, &fence, from, through)?;
        let item_limit = messages.len();
        bounded_message_collection(
            database,
            &fence,
            "messages",
            messages,
            input.sequence_from,
            item_limit,
        )
    }

    pub fn get_message_thread(
        &self,
        database: &Database,
        run: &AuthenticatedTeamToolRun,
        input: &ContextGetMessageThreadInput,
    ) -> Result<Value> {
        let fence = load_fence(database, run)?;
        load_visible_message(database, &fence, &input.root_message_id)?.ok_or_else(|| {
            tool_error(
                "context.message_not_visible",
                "Thread root is not visible at this Run boundary",
            )
        })?;
        let limit = effective_limit(input.limit, MAX_THREAD_MESSAGES, MAX_THREAD_MESSAGES)?;
        let sequence_from = input.sequence_from.unwrap_or(1).max(1);
        let rows = {
            let mut statement = database.connection().prepare(
                r#"
                WITH RECURSIVE thread(id) AS (
                    SELECT id FROM camp_message
                    WHERE id = ?1 AND camp_id = ?2
                      AND sequence <= ?3 AND tombstoned_at IS NULL
                    UNION ALL
                    SELECT reply.id
                    FROM camp_message AS reply
                    JOIN thread ON reply.reply_to_camp_message_id = thread.id
                    WHERE reply.camp_id = ?2
                      AND reply.sequence <= ?3
                      AND reply.tombstoned_at IS NULL
                )
                SELECT message.id, message.sequence, message.author_type,
                       message.author_id, message.reply_to_camp_message_id,
                       message.body
                FROM camp_message AS message
                JOIN thread ON thread.id = message.id
                WHERE message.sequence >= ?4
                ORDER BY message.sequence
                LIMIT ?5
                "#,
            )?;
            statement
                .query_map(
                    params![
                        input.root_message_id,
                        fence.camp_id,
                        fence.boundary,
                        sequence_from,
                        (limit + 1) as i64
                    ],
                    message_from_row,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        bounded_message_collection(
            database,
            &fence,
            "messages",
            rows,
            Some(sequence_from),
            limit,
        )
    }

    pub fn get_summary(
        &self,
        database: &Database,
        run: &AuthenticatedTeamToolRun,
        input: &ContextGetSummaryInput,
    ) -> Result<Value> {
        let fence = load_fence(database, run)?;
        let mut value = database
            .connection()
            .query_row(
                r#"
                SELECT id, level, from_sequence, through_sequence,
                       source_digest, input_truncated,
                       source_summary_ids_json, body,
                       generator_adapter_kind, generator_model_json,
                       generator_version, created_at
                FROM camp_summary
                WHERE id = ?1 AND camp_id = ?2 AND through_sequence <= ?3
                "#,
                params![input.summary_id, fence.camp_id, fence.boundary],
                |row| {
                    let source_ids: String = row.get(6)?;
                    let model: String = row.get(9)?;
                    Ok(json!({
                        "summaryId": row.get::<_, String>(0)?,
                        "level": row.get::<_, String>(1)?,
                        "fromSequence": row.get::<_, i64>(2)?,
                        "throughSequence": row.get::<_, i64>(3)?,
                        "sourceDigest": row.get::<_, String>(4)?,
                        "inputTruncated": row.get::<_, bool>(5)?,
                        "sourceSummaryIds": serde_json::from_str::<Value>(&source_ids)
                            .unwrap_or_else(|_| json!([])),
                        "body": row.get::<_, String>(7)?,
                        "generatorAdapterKind": row.get::<_, String>(8)?,
                        "generatorModel": serde_json::from_str::<Value>(&model)
                            .unwrap_or(Value::Null),
                        "generatorVersion": row.get::<_, String>(10)?,
                        "createdAt": row.get::<_, String>(11)?,
                        "boundarySequence": fence.boundary,
                    }))
                },
            )
            .optional()?
            .ok_or_else(|| {
                tool_error(
                    "context.summary_not_visible",
                    "Camp Summary is not visible at this Run boundary",
                )
            })?;
        if serde_json::to_string(&value)?.chars().count() > MAX_RESPONSE_CHARS {
            value["generatorModel"] = Value::Null;
            value["generatorMetadataTruncated"] = Value::Bool(true);
        }
        if serde_json::to_string(&value)?.chars().count() > MAX_RESPONSE_CHARS {
            return Err(tool_error(
                "context.response_overloaded",
                "Summary metadata cannot fit the Context Tool response limit",
            ));
        }
        Ok(value)
    }
}

fn tool_error(code: &str, message: &str) -> anyhow::Error {
    TeamToolInvocationError {
        code: code.to_string(),
        message: message.to_string(),
    }
    .into()
}

fn load_fence(database: &Database, run: &AuthenticatedTeamToolRun) -> Result<RetrievalFence> {
    database
        .connection()
        .query_row(
            r#"
            SELECT context_manifest.camp_message_boundary_sequence
            FROM context_manifest
            JOIN agent_run ON agent_run.id = context_manifest.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE context_manifest.agent_run_id = ?1
              AND agent_run.execution_epoch = ?2
              AND camp_turn.camp_id = ?3
            "#,
            params![run.agent_run_id, run.execution_epoch, run.camp_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(|boundary| RetrievalFence {
            camp_id: run.camp_id.clone(),
            boundary,
        })
        .ok_or_else(|| {
            tool_error(
                "context.manifest_unavailable",
                "Context tools require the current Run ContextManifest",
            )
        })
}

fn effective_limit(value: usize, default: usize, maximum: usize) -> Result<usize> {
    let value = if value == 0 { default } else { value };
    if value > maximum {
        return Err(tool_error(
            "context.limit_exceeded",
            &format!("limit must not exceed {maximum}"),
        ));
    }
    Ok(value)
}

fn parse_offset_cursor(cursor: Option<&str>) -> Result<usize> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    cursor
        .strip_prefix("offset:")
        .context("Context search cursor is invalid")?
        .parse()
        .context("Context search cursor is invalid")
}

fn parse_short_cursor(cursor: Option<&str>) -> Result<Option<(i64, usize, usize)>> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    let payload = cursor
        .strip_prefix("short:")
        .context("Short-query cursor is invalid")?;
    let mut parts = payload.split(':');
    let through = parts
        .next()
        .context("Short-query cursor is invalid")?
        .parse()
        .context("Short-query cursor is invalid")?;
    let second = parts
        .next()
        .map(str::parse)
        .transpose()
        .context("Short-query cursor is invalid")?
        .unwrap_or(0);
    let third = parts
        .next()
        .map(str::parse)
        .transpose()
        .context("Short-query cursor is invalid")?;
    if parts.next().is_some() {
        return Err(tool_error(
            "context.invalid_cursor",
            "Short-query cursor is invalid",
        ));
    }
    Ok(Some(match third {
        Some(reference_offset) => (through, second, reference_offset),
        None => (through, 0, second),
    }))
}

fn literal_fts_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

fn escape_like(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for character in query.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn normalize_reference(reference: &str) -> Option<(String, String)> {
    let reference = reference.trim();
    let lower = reference.to_ascii_lowercase();
    for (prefix, kind, canonical) in [
        ("adr-", "adr", "ADR-"),
        ("pr-", "pr", "PR-"),
        ("issue-", "issue", "issue-"),
    ] {
        if let Some(number) = lower.strip_prefix(prefix)
            && !number.is_empty()
            && number.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Some((kind.to_string(), format!("{canonical}{number}")));
        }
    }
    Uuid::parse_str(reference)
        .ok()
        .map(|uuid| ("task".to_string(), uuid.to_string()))
}

fn add_reference_candidates(
    database: &Database,
    fence: &RetrievalFence,
    input: &ContextSearchInput,
    sequence_from: i64,
    sequence_through: i64,
    candidates: &mut HashMap<(String, String), SearchCandidate>,
) -> Result<()> {
    let sender_filter = input.sender_ids.iter().collect::<HashSet<_>>();
    for reference in &input.references {
        let Some((kind, value)) = normalize_reference(reference) else {
            return Err(tool_error(
                "context.invalid_reference",
                "references must be ADR-N, PR-N, issue-N, or a full Task UUID",
            ));
        };
        let mut statement = database.connection().prepare(
            r#"
            SELECT message.id, message.sequence, message.author_id
            FROM camp_message_reference AS reference
            JOIN camp_message AS message ON message.id = reference.camp_message_id
            WHERE reference.kind = ?1 AND reference.value = ?2
              AND message.camp_id = ?3
              AND message.sequence >= ?4 AND message.sequence <= ?5
              AND message.tombstoned_at IS NULL
            "#,
        )?;
        for row in statement.query_map(
            params![kind, value, fence.camp_id, sequence_from, sequence_through],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )? {
            let (id, sequence, sender_id) = row?;
            if !sender_filter.is_empty() && !sender_filter.contains(&sender_id) {
                continue;
            }
            candidates.insert(
                ("message".to_string(), id.clone()),
                SearchCandidate {
                    kind: "message",
                    id,
                    sequence,
                    exact_reference: true,
                    rank: f64::NEG_INFINITY,
                },
            );
        }
    }
    Ok(())
}

fn add_message_fts_candidates(
    database: &Database,
    fence: &RetrievalFence,
    input: &ContextSearchInput,
    query: &str,
    sequence_from: i64,
    sequence_through: i64,
    candidates: &mut HashMap<(String, String), SearchCandidate>,
) -> Result<()> {
    let sender_filter = input.sender_ids.iter().collect::<HashSet<_>>();
    let mut statement = database.connection().prepare(
        r#"
        SELECT message.id, message.sequence, message.author_id,
               bm25(camp_message_fts)
        FROM camp_message_fts
        JOIN camp_message AS message ON message.rowid = camp_message_fts.rowid
        WHERE camp_message_fts MATCH ?1
          AND message.camp_id = ?2
          AND message.sequence >= ?3 AND message.sequence <= ?4
          AND message.tombstoned_at IS NULL
        ORDER BY bm25(camp_message_fts), message.sequence DESC
        LIMIT 200
        "#,
    )?;
    for row in statement.query_map(
        params![
            literal_fts_query(query),
            fence.camp_id,
            sequence_from,
            sequence_through
        ],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
            ))
        },
    )? {
        let (id, sequence, sender_id, rank) = row?;
        if !sender_filter.is_empty() && !sender_filter.contains(&sender_id) {
            continue;
        }
        candidates
            .entry(("message".to_string(), id.clone()))
            .and_modify(|candidate| candidate.rank = candidate.rank.min(rank))
            .or_insert(SearchCandidate {
                kind: "message",
                id,
                sequence,
                exact_reference: false,
                rank,
            });
    }
    Ok(())
}

fn add_summary_candidates(
    database: &Database,
    fence: &RetrievalFence,
    query: Option<&str>,
    sequence_from: i64,
    sequence_through: i64,
    candidates: &mut HashMap<(String, String), SearchCandidate>,
) -> Result<()> {
    if let Some(query) = query {
        let mut statement = database.connection().prepare(
            r#"
            SELECT summary.id, summary.through_sequence,
                   bm25(camp_summary_fts)
            FROM camp_summary_fts
            JOIN camp_summary AS summary ON summary.rowid = camp_summary_fts.rowid
            WHERE camp_summary_fts MATCH ?1
              AND summary.camp_id = ?2
              AND summary.through_sequence >= ?3
              AND summary.through_sequence <= ?4
            ORDER BY bm25(camp_summary_fts), summary.through_sequence DESC
            LIMIT 200
            "#,
        )?;
        for row in statement.query_map(
            params![
                literal_fts_query(query),
                fence.camp_id,
                sequence_from,
                sequence_through
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            },
        )? {
            let (id, sequence, rank) = row?;
            candidates.insert(
                ("summary".to_string(), id.clone()),
                SearchCandidate {
                    kind: "summary",
                    id,
                    sequence,
                    exact_reference: false,
                    rank,
                },
            );
        }
    } else {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, through_sequence
            FROM camp_summary
            WHERE camp_id = ?1
              AND through_sequence >= ?2
              AND through_sequence <= ?3
            ORDER BY through_sequence DESC, id
            "#,
        )?;
        for row in statement.query_map(
            params![fence.camp_id, sequence_from, sequence_through],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )? {
            let (id, sequence) = row?;
            candidates.insert(
                ("summary".to_string(), id.clone()),
                SearchCandidate {
                    kind: "summary",
                    id,
                    sequence,
                    exact_reference: false,
                    rank: 0.0,
                },
            );
        }
    }
    Ok(())
}

fn compare_candidates(left: &SearchCandidate, right: &SearchCandidate) -> Ordering {
    right
        .exact_reference
        .cmp(&left.exact_reference)
        .then_with(|| {
            left.rank
                .partial_cmp(&right.rank)
                .unwrap_or(Ordering::Equal)
        })
        .then_with(|| right.sequence.cmp(&left.sequence))
        .then_with(|| left.id.cmp(&right.id))
}

fn search_candidate_value(
    database: &Database,
    fence: &RetrievalFence,
    query: Option<&str>,
    candidate: &SearchCandidate,
) -> Result<Value> {
    if candidate.kind == "message" {
        let message = load_visible_message(database, fence, &candidate.id)?
            .context("Indexed CampMessage is no longer visible")?;
        Ok(json!({
            "kind": "message",
            "messageId": message.id,
            "sequence": message.sequence,
            "senderType": message.author_type,
            "senderId": message.author_id,
            "replyToMessageId": message.reply_to_message_id,
            "snippet": snippet(&message.body, query),
            "exactReferenceMatch": candidate.exact_reference,
        }))
    } else {
        database
            .connection()
            .query_row(
                r#"
            SELECT id, level, from_sequence, through_sequence, body
            FROM camp_summary
            WHERE id = ?1 AND camp_id = ?2 AND through_sequence <= ?3
            "#,
                params![candidate.id, fence.camp_id, fence.boundary],
                |row| {
                    let body: String = row.get(4)?;
                    Ok(json!({
                        "kind": "summary",
                        "summaryId": row.get::<_, String>(0)?,
                        "level": row.get::<_, String>(1)?,
                        "fromSequence": row.get::<_, i64>(2)?,
                        "throughSequence": row.get::<_, i64>(3)?,
                        "snippet": snippet(&body, query),
                        "exactReferenceMatch": false,
                    }))
                },
            )
            .map_err(Into::into)
    }
}

fn snippet(body: &str, query: Option<&str>) -> String {
    let body_chars = body.chars().collect::<Vec<_>>();
    if body_chars.len() <= MAX_SEARCH_SNIPPET_CHARS {
        return body.to_string();
    }
    let start = query
        .and_then(|query| body.find(query))
        .map(|byte_index| body[..byte_index].chars().count().saturating_sub(50))
        .unwrap_or(0)
        .min(body_chars.len().saturating_sub(MAX_SEARCH_SNIPPET_CHARS));
    body_chars[start..start + MAX_SEARCH_SNIPPET_CHARS]
        .iter()
        .collect()
}

fn load_visible_message(
    database: &Database,
    fence: &RetrievalFence,
    message_id: &str,
) -> Result<Option<MessageRow>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT id, sequence, author_type, author_id,
                   reply_to_camp_message_id, body
            FROM camp_message
            WHERE id = ?1 AND camp_id = ?2 AND sequence <= ?3
              AND tombstoned_at IS NULL
            "#,
            params![message_id, fence.camp_id, fence.boundary],
            message_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn message_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRow> {
    Ok(MessageRow {
        id: row.get(0)?,
        sequence: row.get(1)?,
        author_type: row.get(2)?,
        author_id: row.get(3)?,
        reply_to_message_id: row.get(4)?,
        body: row.get(5)?,
    })
}

fn load_message_range(
    database: &Database,
    fence: &RetrievalFence,
    from: i64,
    through: i64,
) -> Result<Vec<MessageRow>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, sequence, author_type, author_id,
               reply_to_camp_message_id, body
        FROM camp_message
        WHERE camp_id = ?1 AND sequence >= ?2 AND sequence <= ?3
          AND tombstoned_at IS NULL
        ORDER BY sequence
        "#,
    )?;
    Ok(statement
        .query_map(params![fence.camp_id, from, through], message_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn message_value(
    database: &Database,
    message: &MessageRow,
    body_offset: usize,
    body_limit: usize,
) -> Result<Value> {
    let body_length = message.body.chars().count();
    let body = message
        .body
        .chars()
        .skip(body_offset)
        .take(body_limit)
        .collect::<String>();
    let (attachments, attachment_omitted_count) = load_message_attachments(database, &message.id)?;
    let (references, reference_omitted_count) = load_message_references(database, &message.id)?;
    Ok(json!({
        "messageId": message.id,
        "sequence": message.sequence,
        "senderType": message.author_type,
        "senderId": message.author_id,
        "replyToMessageId": message.reply_to_message_id,
        "body": body,
        "bodyOffset": body_offset,
        "bodyLimit": body_limit,
        "bodyLength": body_length,
        "bodyTruncated": body_offset > 0 || body_offset + body.chars().count() < body_length,
        "attachments": attachments,
        "attachmentsTruncated": attachment_omitted_count > 0,
        "attachmentOmittedCount": attachment_omitted_count,
        "references": references,
        "referencesTruncated": reference_omitted_count > 0,
        "referenceOmittedCount": reference_omitted_count,
    }))
}

fn load_message_attachments(
    database: &Database,
    message_id: &str,
) -> Result<(Vec<AttachmentResult>, usize)> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, display_name, media_type, byte_size
        FROM message_attachment
        WHERE camp_message_id = ?1
        ORDER BY created_at, id
        LIMIT ?2
        "#,
    )?;
    let attachments = statement
        .query_map(params![message_id, (MAX_ATTACHMENTS + 1) as i64], |row| {
            Ok(AttachmentResult {
                attachment_id: row.get(0)?,
                name: truncate_metadata(row.get::<_, String>(1)?),
                media_type: truncate_metadata(row.get::<_, String>(2)?),
                byte_size: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let omitted = attachments.len().saturating_sub(MAX_ATTACHMENTS);
    Ok((
        attachments.into_iter().take(MAX_ATTACHMENTS).collect(),
        omitted,
    ))
}

fn load_message_references(database: &Database, message_id: &str) -> Result<(Vec<Value>, usize)> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT kind, value FROM camp_message_reference
        WHERE camp_message_id = ?1
        ORDER BY kind, value
        "#,
    )?;
    let references = statement
        .query_map([message_id], |row| {
            Ok(json!({
                "kind": row.get::<_, String>(0)?,
                "value": row.get::<_, String>(1)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let omitted = references.len().saturating_sub(20);
    Ok((references.into_iter().take(20).collect(), omitted))
}

fn truncate_metadata(value: String) -> String {
    if value.chars().count() <= 500 {
        value
    } else {
        format!("{}…", value.chars().take(499).collect::<String>())
    }
}

fn bounded_message_collection(
    database: &Database,
    fence: &RetrievalFence,
    key: &str,
    mut messages: Vec<MessageRow>,
    continuation_from: Option<i64>,
    item_limit: usize,
) -> Result<Value> {
    let logical_omitted = messages.len().saturating_sub(item_limit);
    messages.truncate(item_limit);
    let mut values = messages
        .iter()
        .map(|message| message_value(database, message, 0, MAX_BODY_CHARS))
        .collect::<Result<Vec<_>>>()?;
    let mut omitted = logical_omitted;
    let mut next_cursor = None;
    let mut object = Map::new();
    object.insert("boundarySequence".to_string(), Value::from(fence.boundary));
    while response_chars(key, &values, omitted, &next_cursor, &object)? > MAX_RESPONSE_CHARS {
        let Some(removed) = values.pop() else {
            break;
        };
        omitted += 1;
        next_cursor = removed
            .get("sequence")
            .and_then(Value::as_i64)
            .map(|sequence| sequence.to_string());
    }
    if omitted > 0 && next_cursor.is_none() {
        next_cursor = messages
            .get(values.len().saturating_sub(1))
            .map(|message| (message.sequence + 1).to_string())
            .or_else(|| continuation_from.map(|sequence| sequence.to_string()));
    }
    Ok(json!({
        key: values,
        "nextSequence": next_cursor.and_then(|cursor| cursor.parse::<i64>().ok()),
        "truncated": omitted > 0,
        "omittedCount": omitted,
        "boundarySequence": fence.boundary,
    }))
}

fn cap_results<F>(
    results: &mut Vec<Value>,
    omitted: &mut usize,
    next_cursor: &mut Option<String>,
    cursor_for_returned: F,
    extra: &Value,
) -> Result<()>
where
    F: Fn(usize) -> String,
{
    while serde_json::to_string(&json!({
        "results": results,
        "nextCursor": next_cursor,
        "truncated": *omitted > 0,
        "omittedCount": omitted,
        "extra": extra,
    }))?
    .chars()
    .count()
        > MAX_RESPONSE_CHARS
    {
        if results.pop().is_none() {
            break;
        }
        *omitted += 1;
        *next_cursor = Some(cursor_for_returned(results.len()));
    }
    Ok(())
}

fn response_chars(
    key: &str,
    items: &[Value],
    omitted: usize,
    next_cursor: &Option<String>,
    extra: &Map<String, Value>,
) -> Result<usize> {
    let mut value = extra.clone();
    value.insert(key.to_string(), Value::Array(items.to_vec()));
    value.insert("omittedCount".to_string(), Value::from(omitted));
    value.insert("nextCursor".to_string(), json!(next_cursor));
    Ok(serde_json::to_string(&Value::Object(value))?
        .chars()
        .count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_and_like_queries_are_literalized() {
        assert_eq!(literal_fts_query(r#"a" OR b*"#), r#""a"" OR b*""#);
        assert_eq!(escape_like(r#"100%_done\x"#), r#"100\%\_done\\x"#);
    }

    #[test]
    fn references_are_exact_and_task_ids_require_full_uuids() {
        assert_eq!(
            normalize_reference("adr-49"),
            Some(("adr".to_string(), "ADR-49".to_string()))
        );
        assert!(normalize_reference("task-49").is_none());
        let task_id = Uuid::new_v4();
        assert_eq!(
            normalize_reference(&task_id.to_string()),
            Some(("task".to_string(), task_id.to_string()))
        );
        assert_eq!(
            parse_short_cursor(Some("short:42:3")).unwrap(),
            Some((42, 0, 3))
        );
        assert_eq!(
            parse_short_cursor(Some("short:42:2:3")).unwrap(),
            Some((42, 2, 3))
        );
        assert_eq!(
            parse_short_cursor(Some("short:42")).unwrap(),
            Some((42, 0, 0))
        );
    }
}
