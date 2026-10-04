//! Live, read-only public execution and queue projection. No scheduling happens here.

use std::collections::HashMap;

use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use rusqlite::{Transaction, functions::FunctionFlags, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    camp_history::{public_read_target, visible_message_bodies},
    camp_id::ThreadId,
    db::Database,
    team_tool::{AuthenticatedTeamToolRun, TeamToolInvocationError},
};

pub const THREAD_RUNS_TOOL_NAME: &str = "thread.runs";
pub const THREAD_RUNS_CONTRACT_VERSION: u32 = 1;
const STATUSES: [&str; 6] = [
    "queued",
    "running",
    "waiting",
    "succeeded",
    "failed",
    "cancelled",
];

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadRunsInput {
    pub thread_id: Option<String>,
    pub agent_id: Option<String>,
    pub active: Option<bool>,
    pub status: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Filter {
    thread_id: String,
    agent_id: Option<String>,
    active: bool,
    status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SortKey {
    created_at: DateTime<Utc>,
    // Internal only. Queues use (Thread, Agent); the Thread is bound by Filter.
    identity: (u8, String),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    version: u8,
    filter: Filter,
    last: SortKey,
}

struct Candidate {
    key: SortKey,
    run_id: Option<String>,
    agent_id: String,
    status: String,
    batch: bool,
    count: Option<i64>,
    first_message: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    cancel_requested_at: Option<String>,
}

fn invalid(message: &str) -> anyhow::Error {
    TeamToolInvocationError {
        code: "builtin_tool.invalid_input".into(),
        message: message.into(),
    }
    .into()
}

fn unavailable() -> anyhow::Error {
    TeamToolInvocationError {
        code: "thread.runs_unavailable".into(),
        message: "Thread executions are unavailable.".into(),
    }
    .into()
}

fn trimmed(value: Option<&str>) -> Result<Option<String>> {
    value
        .map(|value| {
            let value = value.trim();
            if value.is_empty() {
                return Err(invalid("Identifiers and cursors must not be empty."));
            }
            Ok(value.to_owned())
        })
        .transpose()
}

impl ThreadRunsInput {
    pub fn validate(&self) -> Result<()> {
        if self.active.is_some() && self.status.is_some() {
            return Err(invalid("active and status cannot be supplied together."));
        }
        if self
            .status
            .as_deref()
            .is_some_and(|status| !STATUSES.contains(&status))
        {
            return Err(invalid("Unknown execution status."));
        }
        if !(1..=100).contains(&self.limit.unwrap_or(20)) {
            return Err(invalid("limit must be between 1 and 100."));
        }
        if let Some(id) = trimmed(self.thread_id.as_deref())? {
            ThreadId::parse(&id).map_err(|_| invalid("threadId must be a Rovai Thread ID."))?;
        }
        trimmed(self.agent_id.as_deref())?;
        trimmed(self.cursor.as_deref())?;
        Ok(())
    }
}

pub fn input_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "properties": {
            "threadId": {"type": "string", "minLength": 1},
            "agentId": {"type": "string", "minLength": 1},
            "active": {"type": "boolean"},
            "status": {"type": "string", "enum": STATUSES},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            "cursor": {"type": "string", "minLength": 1}
        }
    })
}

pub fn output_schema() -> Value {
    let timestamp = json!({"type": ["string", "null"], "format": "date-time"});
    let mut item = json!({
        "type": "object", "additionalProperties": false,
        "required": ["agentRunId", "agentId", "status", "messageCount", "messagePreview", "waitReason", "cancelRequestedAt", "createdAt", "startedAt", "endedAt"],
        "properties": {
            "agentRunId": {"type": "string", "minLength": 1},
            "agentId": {"type": "string", "minLength": 1},
            "status": {"type": "string", "enum": STATUSES},
            "messageCount": {"type": ["integer", "null"], "minimum": 0},
            "messagePreview": {"oneOf": [
                {"type": "null"},
                {"type": "object", "additionalProperties": false,
                 "required": ["messageId", "text", "truncated"],
                 "properties": {"messageId": {"type": "string"}, "text": {"type": "string", "maxLength": 201}, "truncated": {"type": "boolean"}}}
            ]},
            "waitReason": {"type": "null"},
            "cancelRequestedAt": timestamp,
            "createdAt": {"type": "string", "format": "date-time"},
            "startedAt": timestamp,
            "endedAt": timestamp
        }
    });
    let actual = item.clone();
    item["properties"]["agentRunId"] = json!({"type": "null"});
    item["properties"]["status"] = json!({"const": "queued"});
    item["properties"]["messageCount"] = json!({"type": "integer", "minimum": 1});
    for field in ["startedAt", "endedAt", "cancelRequestedAt"] {
        item["properties"][field] = json!({"type": "null"});
    }
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["threadId", "observedAt", "items", "hasMore", "nextCursor"],
        "properties": {
            "threadId": {"type": "string"},
            "observedAt": {"type": "string", "format": "date-time"},
            "items": {"type": "array", "maxItems": 100, "items": {"oneOf": [actual, item]}},
            "hasMore": {"type": "boolean"},
            "nextCursor": {"type": ["string", "null"]}
        }
    })
}

pub fn read(
    database: &mut Database,
    run: &AuthenticatedTeamToolRun,
    input: &ThreadRunsInput,
) -> Result<Value> {
    input.validate()?;
    let transaction = database.connection_mut().transaction()?;
    let result = read_transaction(&transaction, run, input)?;
    transaction.commit()?;
    Ok(result)
}

fn read_transaction(
    transaction: &Transaction<'_>,
    run: &AuthenticatedTeamToolRun,
    input: &ThreadRunsInput,
) -> Result<Value> {
    input.validate()?;
    let requested = trimmed(input.thread_id.as_deref())?;
    let target = public_read_target(transaction, run, requested.as_deref())
        .map_err(|error| {
            if error
                .downcast_ref::<TeamToolInvocationError>()
                .is_some_and(|error| error.code == "camp.manifest_unavailable")
            {
                unavailable()
            } else {
                error
            }
        })?
        .ok_or_else(unavailable)?;
    let observed_at = Utc::now().to_rfc3339();
    let filter = Filter {
        thread_id: target.camp_id.clone(),
        agent_id: trimmed(input.agent_id.as_deref())?,
        active: input.active.unwrap_or(false),
        status: input.status.clone(),
    };
    let after = trimmed(input.cursor.as_deref())?
        .map(|text| decode_cursor(&text, &filter))
        .transpose()?;
    let limit = input.limit.unwrap_or(20);
    let mut rows = candidates(transaction, &filter, after.as_ref(), limit + 1)?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = if has_more {
        Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursor {
            version: 1,
            filter,
            last: rows.last().context("missing cursor row")?.key.clone(),
        })?))
    } else {
        None
    };
    let run_ids: Vec<_> = rows
        .iter()
        .filter_map(|row| row.run_id.as_deref())
        .collect();
    let inputs = frozen_inputs(transaction, &run_ids)?;
    for row in &mut rows {
        if let Some(run_id) = &row.run_id {
            if row.batch {
                ensure!(
                    inputs.contains_key(run_id),
                    "batch Run is missing frozen inputs"
                );
            }
            if let Some((count, first)) = inputs.get(run_id) {
                row.count = Some(*count);
                row.first_message = Some(first.clone());
            }
        }
    }
    let message_ids: Vec<_> = rows
        .iter()
        .filter_map(|row| row.first_message.as_deref())
        .collect();
    let bodies = visible_message_bodies(transaction, &target, &message_ids)?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let preview = row
            .first_message
            .as_ref()
            .and_then(|id| bodies.get(id).map(|body| message_preview(id, body)));
        items.push(json!({
            "agentRunId": row.run_id, "agentId": row.agent_id, "status": row.status,
            "messageCount": row.count, "messagePreview": preview, "waitReason": null,
            "createdAt": row.key.created_at.to_rfc3339(), "startedAt": utc_timestamp(row.started_at)?,
            "endedAt": utc_timestamp(row.ended_at)?, "cancelRequestedAt": utc_timestamp(row.cancel_requested_at)?
        }));
    }
    Ok(
        json!({"threadId": target.camp_id, "observedAt": observed_at, "items": items, "hasMore": has_more, "nextCursor": next_cursor}),
    )
}

fn frozen_inputs(
    transaction: &Transaction<'_>,
    run_ids: &[&str],
) -> Result<HashMap<String, (i64, String)>> {
    if run_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut statement = transaction.prepare(
        "SELECT input.agent_run_id, COUNT(*),
                (SELECT first.message_id FROM agent_run_input first
                 WHERE first.agent_run_id = input.agent_run_id ORDER BY first.ordinal LIMIT 1)
         FROM agent_run_input input
         WHERE input.agent_run_id IN (SELECT value FROM json_each(?1))
         GROUP BY input.agent_run_id",
    )?;
    Ok(statement
        .query_map([serde_json::to_string(run_ids)?], |row| {
            Ok((row.get(0)?, (row.get(1)?, row.get(2)?)))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?)
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>> {
    // Older SQLite-written rows use SQLite's UTC datetime spelling.
    if let Ok(value) = DateTime::parse_from_rfc3339(value) {
        return Ok(value.with_timezone(&Utc));
    }
    Ok(chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")?.and_utc())
}

fn utc_timestamp(value: Option<String>) -> Result<Option<String>> {
    value
        .map(|value| Ok(parse_timestamp(&value)?.to_rfc3339()))
        .transpose()
}

fn decode_cursor(text: &str, filter: &Filter) -> Result<SortKey> {
    let decode =
        || -> Result<Cursor> { Ok(serde_json::from_slice(&URL_SAFE_NO_PAD.decode(text)?)?) };
    let cursor = decode().map_err(|_| invalid("Invalid execution cursor."))?;
    if cursor.version != 1
        || cursor.filter != *filter
        || cursor.last.identity.0 > 1
        || cursor.last.identity.1.is_empty()
    {
        return Err(invalid("Cursor does not match the Thread and filters."));
    }
    Ok(cursor.last)
}

// Each source contributes at most the page size plus one before the final merge.
// Existing indexes bound the Thread lookup, not the timestamp sort: SQLite still
// examines matching Runs, and queue counts still cover the entire waiting set.
const CANDIDATES_SQL: &str = r#"
        WITH direct_runs AS (
            SELECT r.id AS run_id, c.agent_id, r.status, r.invocation_kind = 'batch' AS batch,
                   r.created_at, r.started_at, r.ended_at, r.cancel_requested_at,
                   NULL AS message_count, NULL AS first_message,
                   rovai_thread_run_time_key(r.created_at) AS created_key,
                   1 AS source, r.id AS identity
            FROM agent_run r JOIN conversation c ON c.id = r.conversation_id
            WHERE r.camp_id = ?1
              AND r.invocation_kind <> 'single_chat' AND c.kind <> 'single_chat'
              AND (?2 IS NULL OR c.agent_id = ?2) AND (?3 IS NULL OR r.status = ?3)
              AND (?4 = 0 OR r.status IN ('queued', 'running', 'waiting'))
              AND (?5 IS NULL OR (created_key, 1, r.id) < (?5, ?6, ?7))
            ORDER BY created_key DESC, r.id DESC LIMIT ?8
        ), legacy_runs AS (
            SELECT r.id AS run_id, c.agent_id, r.status, r.invocation_kind = 'batch' AS batch,
                   r.created_at, r.started_at, r.ended_at, r.cancel_requested_at,
                   NULL AS message_count, NULL AS first_message,
                   rovai_thread_run_time_key(r.created_at) AS created_key,
                   1 AS source, r.id AS identity
            FROM camp_turn turn JOIN agent_run r ON r.camp_turn_id = turn.id
            JOIN conversation c ON c.id = r.conversation_id
            WHERE turn.camp_id = ?1 AND r.camp_id IS NULL
              AND r.invocation_kind <> 'single_chat' AND c.kind <> 'single_chat'
              AND (?2 IS NULL OR c.agent_id = ?2) AND (?3 IS NULL OR r.status = ?3)
              AND (?4 = 0 OR r.status IN ('queued', 'running', 'waiting'))
              AND (?5 IS NULL OR (created_key, 1, r.id) < (?5, ?6, ?7))
            ORDER BY created_key DESC, r.id DESC LIMIT ?8
        ), waiting AS (
            SELECT recipient_agent_id AS agent_id, COUNT(*) AS message_count, MIN(queue_sequence) AS head
            FROM camp_message_delivery
            WHERE camp_id = ?1 AND status = 'waiting'
              AND (?2 IS NULL OR recipient_agent_id = ?2) AND (?3 IS NULL OR ?3 = 'queued')
            GROUP BY recipient_agent_id
        ), queued AS (
            SELECT NULL AS run_id, waiting.agent_id, 'queued' AS status, 0 AS batch,
                   delivery.created_at, NULL AS started_at, NULL AS ended_at, NULL AS cancel_requested_at,
                   waiting.message_count, delivery.message_id AS first_message,
                   rovai_thread_run_time_key(delivery.created_at) AS created_key,
                   0 AS source, waiting.agent_id AS identity
            -- Drive head lookups from the aggregate, not from every waiting delivery.
            FROM waiting CROSS JOIN camp_message_delivery delivery
              ON delivery.camp_id = ?1 AND delivery.recipient_agent_id = waiting.agent_id
             AND delivery.queue_sequence = waiting.head AND delivery.status = 'waiting'
            WHERE ?5 IS NULL OR (created_key, 0, waiting.agent_id) < (?5, ?6, ?7)
            ORDER BY created_key DESC, waiting.agent_id DESC LIMIT ?8
        )
        SELECT * FROM direct_runs
        UNION ALL SELECT * FROM legacy_runs
        UNION ALL SELECT * FROM queued
        ORDER BY created_key DESC, source DESC, identity DESC LIMIT ?8
    "#;

fn timestamp_key(value: &DateTime<Utc>) -> Vec<u8> {
    // Order-preserving seconds + nanoseconds. SQLite datetime/julianday would
    // lose precision; raw timestamp text would misorder offsets and old spellings.
    let mut key = Vec::with_capacity(12);
    key.extend_from_slice(&(value.timestamp() ^ i64::MIN).to_be_bytes());
    key.extend_from_slice(&value.timestamp_subsec_nanos().to_be_bytes());
    key
}

fn candidates(
    transaction: &Transaction<'_>,
    filter: &Filter,
    after: Option<&SortKey>,
    take: usize,
) -> Result<Vec<Candidate>> {
    transaction.create_scalar_function(
        "rovai_thread_run_time_key",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |context| {
            let value = context.get::<String>(0)?;
            parse_timestamp(&value)
                .map(|value| timestamp_key(&value))
                .map_err(|error| rusqlite::Error::UserFunctionError(error.into()))
        },
    )?;
    let mut statement = transaction.prepare(CANDIDATES_SQL)?;
    let mut rows = statement.query(params![
        filter.thread_id,
        filter.agent_id,
        filter.status,
        filter.active,
        after.map(|key| timestamp_key(&key.created_at)),
        after.map(|key| key.identity.0),
        after.map(|key| &key.identity.1),
        i64::try_from(take)?,
    ])?;
    let mut candidates = Vec::with_capacity(take);
    while let Some(row) = rows.next()? {
        let run_id: Option<String> = row.get(0)?;
        let agent_id: String = row.get(1)?;
        let timestamp: String = row.get(4)?;
        let key = SortKey {
            created_at: parse_timestamp(&timestamp)?,
            identity: run_id
                .as_ref()
                .map_or_else(|| (0, agent_id.clone()), |id| (1, id.clone())),
        };
        candidates.push(Candidate {
            key,
            run_id,
            agent_id,
            status: row.get(2)?,
            batch: row.get(3)?,
            count: row.get(8)?,
            first_message: row.get(9)?,
            started_at: row.get(5)?,
            ended_at: row.get(6)?,
            cancel_requested_at: row.get(7)?,
        });
    }
    Ok(candidates)
}

fn message_preview(id: &str, body: &str) -> Value {
    let normalized = body.replace(['\n', '\r', '\t'], " ");
    let mut chars = normalized.trim().chars();
    let mut text: String = chars.by_ref().take(200).collect();
    let truncated = chars.next().is_some();
    if truncated {
        text.push('…');
    }
    json!({"messageId": id, "text": text, "truncated": truncated})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_counts_code_points_and_keeps_empty_visible_messages() {
        for length in [0, 199, 200, 201] {
            let body = "😀".repeat(length);
            let preview = message_preview("first", &body);
            assert_eq!(preview["truncated"], length > 200);
            assert_eq!(
                preview["text"].as_str().unwrap().chars().count(),
                length.min(200) + usize::from(length > 200)
            );
            assert_eq!(preview["messageId"], "first");
        }
        assert_eq!(
            message_preview("m", "\u{2003}一\r\n二\t三  四\u{2003}")["text"],
            "一  二 三  四"
        );
        assert_eq!(
            message_preview("m", &("a".repeat(199) + "e\u{301}"))["text"],
            "a".repeat(199) + "e…"
        );
    }

    #[test]
    fn input_and_cursor_bind_the_complete_scope_without_page_size() {
        for input in [
            json!({"active": false, "status": "queued"}),
            json!({"limit": 0}),
            json!({"limit": 101}),
            json!({"agentId": " "}),
            json!({"cursor": " "}),
            json!({"status": "WAITING"}),
            json!({"campId": "x"}),
            json!({"kind": "run"}),
        ] {
            assert!(
                crate::team_tool_catalog::validate_builtin_tool_input(
                    THREAD_RUNS_TOOL_NAME,
                    &input
                )
                .is_err(),
                "{input}"
            );
        }
        for status in STATUSES {
            crate::team_tool_catalog::validate_builtin_tool_input(
                THREAD_RUNS_TOOL_NAME,
                &json!({"status": status}),
            )
            .unwrap();
        }
        let filter = Filter {
            thread_id: "t".into(),
            agent_id: None,
            active: false,
            status: None,
        };
        let cursor = Cursor {
            version: 1,
            filter,
            last: SortKey {
                created_at: parse_timestamp("2026-10-03T12:00:00.000000001Z").unwrap(),
                identity: (0, "agent_1".into()),
            },
        };
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&cursor).unwrap());
        assert_eq!(
            decode_cursor(&encoded, &cursor.filter).unwrap(),
            cursor.last
        );
        for filter in [
            Filter {
                thread_id: "other".into(),
                agent_id: None,
                active: false,
                status: None,
            },
            Filter {
                thread_id: "t".into(),
                agent_id: Some("agent_1".into()),
                active: false,
                status: None,
            },
            Filter {
                thread_id: "t".into(),
                agent_id: None,
                active: true,
                status: None,
            },
            Filter {
                thread_id: "t".into(),
                agent_id: None,
                active: false,
                status: Some("queued".into()),
            },
        ] {
            assert!(decode_cursor(&encoded, &filter).is_err());
        }
        assert!(decode_cursor("not a cursor", &cursor.filter).is_err());
        assert!(cursor.last.created_at > parse_timestamp("2026-10-03 12:00:00").unwrap());
        let instants = [
            "1969-12-31T23:59:59.999999999Z",
            "1970-01-01 00:00:00",
            "2016-12-31T23:59:60Z",
            "2017-01-01T00:00:00Z",
            "2026-10-03T12:00:00.000000001Z",
            "2026-10-03T20:00:00.000000002+08:00",
        ]
        .map(|value| parse_timestamp(value).unwrap());
        for pair in instants.windows(2) {
            assert!(pair[0] < pair[1]);
            assert!(timestamp_key(&pair[0]) < timestamp_key(&pair[1]));
        }
        assert_eq!(
            timestamp_key(&parse_timestamp("2026-10-03 12:00:00.000000001").unwrap()),
            timestamp_key(&cursor.last.created_at)
        );
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod read_tests {
    use super::*;
    use rusqlite::Connection;

    const THREAD: &str = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
    const OTHER: &str = "rvcamp_01h47kvsy5fk1shh6w1g60eecg";

    fn read_fixture() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(r#"
            CREATE TABLE camp(id TEXT, last_message_sequence INTEGER, deletion_operation_id TEXT);
            CREATE TABLE conversation(id TEXT PRIMARY KEY, agent_id TEXT, kind TEXT);
            CREATE TABLE camp_turn(id TEXT PRIMARY KEY, camp_id TEXT, trigger_type TEXT, trigger_id TEXT,
                UNIQUE(camp_id, trigger_type, trigger_id));
            CREATE TABLE agent_run(id TEXT PRIMARY KEY, camp_id TEXT, camp_turn_id TEXT, conversation_id TEXT,
                invocation_kind TEXT, execution_epoch INTEGER DEFAULT 1, status TEXT,
                created_at TEXT DEFAULT '2026-10-03T12:00:00Z', started_at TEXT, ended_at TEXT, cancel_requested_at TEXT);
            CREATE INDEX agent_run_camp_delete_idx ON agent_run(camp_id, id) WHERE camp_id IS NOT NULL;
            CREATE INDEX agent_run_a2a_turn_idx ON agent_run(camp_turn_id, invocation_kind, created_at);
            CREATE TABLE context_manifest(id TEXT, agent_run_id TEXT, global_public_message_boundary INTEGER, history_fence_version INTEGER);
            CREATE TABLE agent_run_input(agent_run_id TEXT, ordinal INTEGER, message_id TEXT);
            CREATE TABLE camp_message_delivery(camp_id TEXT, recipient_agent_id TEXT, status TEXT,
                queue_sequence INTEGER, created_at TEXT, message_id TEXT);
            CREATE INDEX camp_message_delivery_waiting_idx
                ON camp_message_delivery(camp_id, recipient_agent_id, queue_sequence) WHERE status = 'waiting';
            CREATE TABLE camp_message(id TEXT, camp_id TEXT, sequence INTEGER, author_type TEXT DEFAULT 'user',
                author_id TEXT DEFAULT 'local_user', reply_to_camp_message_id TEXT, body TEXT DEFAULT 'STALE BODY',
                created_at TEXT DEFAULT '2026-10-03T12:00:00Z', tombstoned_at TEXT,
                recall_state TEXT DEFAULT 'closed', structured_content_json TEXT);
            INSERT INTO conversation VALUES ('public', 'agent_1', 'camp'), ('private', 'agent_1', 'single_chat');
            INSERT INTO context_manifest VALUES ('manifest', 'caller', 0, 1);
        "#).unwrap();
        connection
    }

    // This fixture owns the read SQL/transaction seam; claim writes are covered by delivery_queue.
    #[test]
    fn public_scope_frozen_inputs_and_dynamic_queues_share_one_read_view() {
        let mut connection = read_fixture();
        for thread in [THREAD, OTHER] {
            connection
                .execute("INSERT INTO camp VALUES (?1, 10, NULL)", [thread])
                .unwrap();
        }
        connection
            .execute(
                "INSERT INTO camp_turn(id,camp_id) VALUES ('historical', ?1)",
                [THREAD],
            )
            .unwrap();
        for (id, thread, turn, conversation, kind, status) in [
            (
                "caller",
                Some(THREAD),
                Some("historical"),
                "public",
                "direct",
                "running",
            ),
            (
                "actual-queued",
                Some(THREAD),
                None,
                "public",
                "batch",
                "queued",
            ),
            ("waiting", Some(THREAD), None, "public", "direct", "waiting"),
            (
                "failed",
                None,
                Some("historical"),
                "public",
                "direct",
                "failed",
            ),
            (
                "private-kind",
                Some(THREAD),
                None,
                "public",
                "single_chat",
                "running",
            ),
            (
                "private-conversation",
                Some(THREAD),
                None,
                "private",
                "direct",
                "running",
            ),
            (
                "elsewhere",
                Some(OTHER),
                Some("historical"),
                "public",
                "direct",
                "running",
            ),
        ] {
            connection.execute("INSERT INTO agent_run(id,camp_id,camp_turn_id,conversation_id,invocation_kind,status) VALUES(?1,?2,?3,?4,?5,?6)", params![id,thread,turn,conversation,kind,status]).unwrap();
        }
        for (id, sequence) in [("first", 1), ("anchor", 2), ("q1", 3), ("q2", 4), ("q3", 5)] {
            connection.execute("INSERT INTO camp_message(id,camp_id,sequence,structured_content_json) VALUES(?1,?2,?3,?4)", params![id,THREAD,sequence, json!([{"kind":"text","text": id}]).to_string()]).unwrap();
        }
        // Insertion order and anchor cannot replace the frozen ordinal.
        connection.execute_batch("INSERT INTO agent_run_input VALUES ('actual-queued',1,'anchor'),('actual-queued',0,'first');").unwrap();
        for (id, sequence) in [("q1", 3), ("q2", 4), ("q3", 5)] {
            connection.execute("INSERT INTO camp_message_delivery VALUES(?1,'agent_1','waiting',?2,'2026-10-03T13:00:00Z',?3)", params![THREAD,sequence,id]).unwrap();
        }
        let run = AuthenticatedTeamToolRun {
            camp_id: THREAD.into(),
            agent_id: "agent_1".into(),
            agent_run_id: "caller".into(),
            execution_epoch: 1,
        };
        let read = |connection: &mut Connection, input: ThreadRunsInput| {
            let tx = connection.transaction().unwrap();
            let before = tx.total_changes();
            let result = read_transaction(&tx, &run, &input);
            assert_eq!(
                tx.total_changes(),
                before,
                "query must not mutate business data"
            );
            if let Ok(result) = &result {
                crate::builtin_tool_cli_output::validate_schema(result, &output_schema()).unwrap();
            }
            tx.commit().unwrap();
            result
        };
        let all = read(&mut connection, ThreadRunsInput::default()).unwrap();
        assert_eq!(all["items"].as_array().unwrap().len(), 5);
        assert_eq!(all["items"][0]["agentRunId"], Value::Null);
        assert_eq!(all["items"][0]["messageCount"], 3);
        assert_eq!(all["items"][0]["messagePreview"]["text"], "q1");
        let actual = all["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["agentRunId"] == "actual-queued")
            .unwrap();
        assert_eq!(actual["messageCount"], 2);
        assert_eq!(actual["messagePreview"]["messageId"], "first");
        assert!(
            all["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(
                    |item| item["agentRunId"] != "actual-queued" && !item["agentRunId"].is_null()
                )
                .all(|item| item["messageCount"].is_null() && item["messagePreview"].is_null())
        );
        let active = read(
            &mut connection,
            ThreadRunsInput {
                active: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(active["items"].as_array().unwrap().len(), 4);
        let queued = read(
            &mut connection,
            ThreadRunsInput {
                status: Some("queued".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(queued["items"].as_array().unwrap().len(), 2);
        let failed = read(
            &mut connection,
            ThreadRunsInput {
                status: Some("failed".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(failed["items"][0]["agentRunId"], "failed");
        let page = read(
            &mut connection,
            ThreadRunsInput {
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        let cursor = page["nextCursor"].as_str().unwrap().to_owned();
        assert_eq!(page["items"][0]["messageCount"], 3);
        // The queue vanishes between pages. Its cursor is still a value, not a row lookup.
        connection
            .execute("DELETE FROM camp_message_delivery", [])
            .unwrap();
        let tail = read(
            &mut connection,
            ThreadRunsInput {
                cursor: Some(cursor.clone()),
                active: Some(false),
                thread_id: Some(THREAD.into()),
                limit: Some(100),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(tail["items"].as_array().unwrap().len(), 4);
        assert_eq!(tail["hasMore"], false);
        assert!(
            read(
                &mut connection,
                ThreadRunsInput {
                    cursor: Some(cursor),
                    active: Some(true),
                    ..Default::default()
                }
            )
            .is_err()
        );
        for update in [
            "UPDATE camp_message SET recall_state='withdrawn' WHERE id='first'",
            "UPDATE camp_message SET recall_state='closed',tombstoned_at='now' WHERE id='first'",
            "DELETE FROM camp_message WHERE id='first'",
        ] {
            connection.execute(update, []).unwrap();
            let result = read(
                &mut connection,
                ThreadRunsInput {
                    status: Some("queued".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(result["items"][0]["messageCount"], 2);
            assert!(result["items"][0]["messagePreview"].is_null());
        }
        let other = read(
            &mut connection,
            ThreadRunsInput {
                thread_id: Some(OTHER.into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(other["items"][0]["agentRunId"], "elsewhere");
        connection
            .execute(
                "UPDATE camp SET deletion_operation_id='deleting' WHERE id=?1",
                [OTHER],
            )
            .unwrap();
        assert!(
            read(
                &mut connection,
                ThreadRunsInput {
                    thread_id: Some(OTHER.into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
        connection
            .execute("DELETE FROM agent_run_input", [])
            .unwrap();
        assert!(
            read(
                &mut connection,
                ThreadRunsInput {
                    status: Some("queued".into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn candidate_pages_bound_materialization_and_use_thread_indexes() {
        let mut connection = read_fixture();
        connection
            .execute(
                "INSERT INTO camp_turn(id,camp_id) VALUES ('historical', ?1)",
                [THREAD],
            )
            .unwrap();
        // 50k public Runs, half with each ownership form. Adjacent Runs share an
        // instant, while the four timestamp spellings disagree lexicographically.
        connection.execute(r#"
            WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 50000)
            INSERT INTO agent_run(id,camp_id,camp_turn_id,conversation_id,invocation_kind,status,created_at)
            SELECT printf('run-%05d',n), CASE WHEN n % 2 = 0 THEN ?1 END,
                   CASE WHEN n % 2 = 1 THEN 'historical' END, 'public', 'direct', 'succeeded',
                   CASE n % 4
                       WHEN 0 THEN printf('2026-10-03T12:00:00.%09dZ',n/2)
                       WHEN 1 THEN printf('2026-10-03T20:00:00.%09d+08:00',n/2)
                       WHEN 2 THEN printf('2026-10-03 12:00:00.%09d',n/2)
                       ELSE printf('2026-10-03T07:00:00.%09d-05:00',n/2)
                   END
            FROM numbers
        "#, [THREAD]).unwrap();
        // An equally long unrelated Thread must not join the candidate scan.
        connection.execute(r#"
            INSERT INTO agent_run(id,camp_id,conversation_id,invocation_kind,status,created_at)
            SELECT 'other-' || id, ?1, conversation_id, invocation_kind,status,created_at FROM agent_run
        "#, [OTHER]).unwrap();
        connection.execute(r#"
            WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 2000)
            INSERT INTO camp_message_delivery
            SELECT ?1, CASE WHEN n % 2 = 0 THEN 'agent_1' ELSE 'agent_2' END, 'waiting', n,
                   '2026-10-03T12:00:00.000025000Z', printf('message-%d', n) FROM numbers
        "#, [THREAD]).unwrap();
        let tx = connection.transaction().unwrap();
        let filter = Filter {
            thread_id: THREAD.into(),
            agent_id: None,
            active: false,
            status: None,
        };
        let before = tx.total_changes();
        // Exercise SQL's returned-candidate boundary, before public projection or
        // Rust truncation. The previous all-candidate query returned 50,002 here.
        let page = candidates(&tx, &filter, None, 21).unwrap();
        assert_eq!(page.len(), 21);
        assert_eq!(page[0].run_id.as_deref(), Some("run-50000"));
        assert_eq!(page[1].agent_id, "agent_2");
        assert_eq!(page[2].agent_id, "agent_1");
        for (queue, first) in [(&page[1], "message-1"), (&page[2], "message-2")] {
            assert!(queue.run_id.is_none());
            assert_eq!(queue.count, Some(1000));
            assert_eq!(queue.first_message.as_deref(), Some(first));
        }
        for (row, n) in page[3..].iter().zip((49982..=49999).rev()) {
            assert_eq!(row.run_id.as_deref(), Some(format!("run-{n:05}").as_str()));
        }
        // Both source identities at the same instant must survive page seams;
        // changing page size does not change the order or duplicate the last row.
        for (after, expected) in [
            (&page[0].key, (0, "agent_2")),
            (&page[1].key, (0, "agent_1")),
            (&page[2].key, (1, "run-49999")),
            (&page[19].key, (1, "run-49982")),
        ] {
            let next = candidates(&tx, &filter, Some(after), 2).unwrap();
            assert_eq!(next.len(), 2);
            assert_eq!(next[0].key.identity, (expected.0, expected.1.into()));
            assert!(next.iter().all(|row| row.key < *after));
        }
        let deep = SortKey {
            created_at: parse_timestamp("2026-10-03T12:00:00.000005000Z").unwrap(),
            identity: (1, "run-10000".into()),
        };
        let page = candidates(&tx, &filter, Some(&deep), 21).unwrap();
        assert_eq!(page.len(), 21);
        for (row, n) in page.iter().zip((9979..=9999).rev()) {
            assert_eq!(row.run_id.as_deref(), Some(format!("run-{n:05}").as_str()));
        }
        let first = SortKey {
            created_at: parse_timestamp("2026-10-03T12:00:00Z").unwrap(),
            identity: (1, "run-00001".into()),
        };
        assert!(
            candidates(&tx, &filter, Some(&first), 21)
                .unwrap()
                .is_empty()
        );
        let agent_filter = Filter {
            agent_id: Some("agent_1".into()),
            active: true,
            ..filter
        };
        let queues = candidates(&tx, &agent_filter, None, 2).unwrap();
        assert_eq!(queues.len(), 1);
        assert_eq!(queues[0].count, Some(1000));

        // Verify access paths against production index definitions. Timestamp
        // sorting remains proportional to matching history; do not claim O(limit).
        let plan = tx
            .prepare(&format!("EXPLAIN QUERY PLAN {CANDIDATES_SQL}"))
            .unwrap()
            .query_map(
                params![
                    THREAD,
                    None::<String>,
                    None::<String>,
                    false,
                    None::<Vec<u8>>,
                    None::<u8>,
                    None::<String>,
                    21
                ],
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
            .join("\n");
        assert!(
            plan.contains("SEARCH r USING INDEX agent_run_camp_delete_idx (camp_id=?)"),
            "{plan}"
        );
        assert!(
            plan.contains("SEARCH r USING INDEX agent_run_a2a_turn_idx (camp_turn_id=?)"),
            "{plan}"
        );
        assert!(plan.contains("SEARCH camp_message_delivery USING COVERING INDEX camp_message_delivery_waiting_idx (camp_id=?)"), "{plan}");
        assert!(plan.contains("SEARCH delivery USING INDEX camp_message_delivery_waiting_idx (camp_id=? AND recipient_agent_id=? AND queue_sequence=?)"), "{plan}");
        assert!(!plan.contains("SCAN r"), "{plan}");
        assert_eq!(tx.total_changes(), before);
    }
}
