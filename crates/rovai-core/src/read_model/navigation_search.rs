//! User-facing navigation search over the current SQLite read view.
use std::{
    fmt,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{camp_id::ThreadId, draft_client::DraftClient};

use super::{
    ConversationFindQuery, NavigationThreadTarget, PUBLIC_SEARCH_MESSAGE,
    camp_channel_source_from_row, current_global_sequence,
    navigation::{CLIENT_VISIBLE, GROUP_KEY, ORDER},
    project_search_message,
};

const RECENT_LIMIT: usize = 12;
const NAME_LIMIT: usize = 50;
const MESSAGE_LIMIT: usize = 20;
const MESSAGE_BATCH: usize = 128;
const SCAN_LIMIT: usize = 5_000;
const SCAN_TIME: Duration = Duration::from_millis(45);
const QUERY_LIMIT: usize = 200;
const MAX_IDLE_READERS: usize = 4;

pub(crate) struct SearchReaders {
    database_path: PathBuf,
    idle: Mutex<Vec<Connection>>,
}

impl SearchReaders {
    pub(crate) fn new(path: &Path) -> Self {
        Self {
            database_path: path.to_owned(),
            idle: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn read<T>(&self, operation: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let cached = self
            .idle
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop();
        let mut reader = match cached {
            Some(reader) => reader,
            None => Connection::open_with_flags(
                &self.database_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )?,
        };
        let snapshot = reader.transaction()?;
        let result = operation(&snapshot);
        // Each request gets its own WAL snapshot. Only idle connections return
        // to the pool, and other requests never wait for one to become idle.
        snapshot.rollback()?;
        let mut idle = self.idle.lock().unwrap_or_else(PoisonError::into_inner);
        if idle.len() < MAX_IDLE_READERS {
            idle.push(reader);
        }
        result
    }
}

#[derive(Debug)]
pub(crate) enum NavigationSearchInputError {
    Parameters,
    Query,
    Hints,
    Cursor,
}

impl NavigationSearchInputError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Cursor => "navigation.invalid_search_cursor",
            _ => "navigation.invalid_search_input",
        }
    }
}

impl fmt::Display for NavigationSearchInputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Parameters => "Unknown or malformed navigation search parameters.",
            Self::Query => "Navigation search query length or kind is invalid.",
            Self::Hints => "Too many navigation search hints.",
            Self::Cursor => "Navigation search cursor is invalid for this query.",
        })
    }
}

impl std::error::Error for NavigationSearchInputError {}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct SearchHints {
    group_keys: Vec<String>,
    channel_kinds: Vec<String>,
    thread_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NavigationSearchParams {
    query: String,
    #[serde(default)]
    hints: Option<SearchHints>,
}

impl NavigationSearchParams {
    pub(crate) fn validate(self) -> Result<Self, NavigationSearchInputError> {
        let query = self.query.trim();
        if query.chars().count() > QUERY_LIMIT {
            return Err(NavigationSearchInputError::Query);
        }
        if let Some(hints) = &self.hints
            && hints.group_keys.len() + hints.channel_kinds.len() + hints.thread_ids.len() > 200
        {
            return Err(NavigationSearchInputError::Hints);
        }
        Ok(Self {
            query: query.to_owned(),
            ..self
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NavigationMessageSearchParams {
    query: String,
    cursor: Option<String>,
}

pub(crate) struct MessageSearch {
    query: String,
    cursor: Option<Cursor>,
    fingerprint: String,
}

impl NavigationMessageSearchParams {
    pub(crate) fn validate(self) -> Result<MessageSearch, NavigationSearchInputError> {
        let query = self.query.trim();
        if !(2..=QUERY_LIMIT).contains(&query.chars().count()) || ThreadId::parse(query).is_ok() {
            return Err(NavigationSearchInputError::Query);
        }
        let fingerprint: String = Sha256::digest(query.as_bytes())[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let cursor = self
            .cursor
            .as_deref()
            .map(|cursor| Cursor::decode(cursor, &fingerprint))
            .transpose()?;
        Ok(MessageSearch {
            query: query.to_owned(),
            cursor,
            fingerprint,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    v: u8,
    q: String,
    at: String,
    seq: i64,
    id: String,
    below: Option<i64>,
}

impl Cursor {
    fn decode(raw: &str, fingerprint: &str) -> Result<Self, NavigationSearchInputError> {
        let error = || NavigationSearchInputError::Cursor;
        if raw.len() > 1024 {
            return Err(error());
        }
        let bytes = URL_SAFE_NO_PAD.decode(raw).map_err(|_| error())?;
        let cursor: Self = serde_json::from_slice(&bytes).map_err(|_| error())?;
        if cursor.v != 1
            || cursor.q != fingerprint
            || cursor.at.is_empty()
            || cursor.at.len() > 128
            || cursor.seq < 0
            || cursor.id.is_empty()
            || cursor.id.len() > 256
            || cursor.below.is_some_and(|below| below <= 0)
        {
            return Err(error());
        }
        Ok(cursor)
    }

    fn encode(&self) -> Result<String> {
        Ok(URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?))
    }

    fn is_at(&self, target: &Candidate) -> bool {
        self.id == target.thread.id
            && self.at == target.last_activity_at
            && self.seq == target.activity_sequence
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NavigationSearchResult {
    schema_version: u8,
    through_global_sequence: i64,
    query: String,
    items: Vec<SearchTarget>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NavigationMessageSearchPage {
    schema_version: u8,
    through_global_sequence: i64,
    query: String,
    items: Vec<MessageHit>,
    next_cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchTarget {
    kind: &'static str,
    thread: NavigationThreadTarget,
    mission: Option<MissionTarget>,
    last_activity_at: String,
    r#match: Option<NameMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MissionTarget {
    mission_id: String,
    number: i64,
    status: String,
}

#[derive(Serialize)]
struct NameMatch {
    field: &'static str,
    snippet: Option<String>,
}

impl NameMatch {
    fn field(field: &'static str) -> Self {
        Self {
            field,
            snippet: None,
        }
    }
}

#[derive(Serialize)]
struct MessageHit {
    target: SearchTarget,
    message: MatchedMessage,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchedMessage {
    id: String,
    sequence: i64,
    author_type: String,
    author_id: String,
    author_name: String,
    created_at: String,
}

struct Candidate {
    thread: NavigationThreadTarget,
    mission: Option<MissionTarget>,
    last_activity_at: String,
    activity_sequence: i64,
    description: Option<String>,
    tags: Option<String>,
    group_key: String,
}

impl Candidate {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        let mission = match row.get::<_, Option<String>>(9)? {
            Some(mission_id) => Some(MissionTarget {
                mission_id,
                number: row.get(10)?,
                status: row.get(11)?,
            }),
            None => None,
        };
        Ok(Self {
            thread: NavigationThreadTarget {
                id: row.get(0)?,
                title: row.get(1)?,
                activation_state: row.get(2)?,
                project_binding_kind: row.get(3)?,
                project_path: row.get(4)?,
                channel_source: camp_channel_source_from_row(row, 5)?,
            },
            last_activity_at: row.get(7)?,
            activity_sequence: row.get(8)?,
            mission,
            description: row.get(12)?,
            tags: row.get(13)?,
            group_key: row.get(14)?,
        })
    }

    fn target(self, found: Option<NameMatch>) -> SearchTarget {
        SearchTarget {
            kind: if self.mission.is_some() {
                "mission"
            } else {
                "thread"
            },
            thread: self.thread,
            mission: self.mission,
            last_activity_at: self.last_activity_at,
            r#match: found,
        }
    }

    fn cursor(&self, fingerprint: &str, below: Option<i64>) -> Cursor {
        Cursor {
            v: 1,
            q: fingerprint.to_owned(),
            at: self.last_activity_at.clone(),
            seq: self.activity_sequence,
            id: self.thread.id.clone(),
            below,
        }
    }
}

fn target_sql(details: bool, filter: &str, tail: &str) -> String {
    let mission_details = if details {
        "mission.description, mission.tags_json"
    } else {
        "NULL, NULL"
    };
    format!(
        "SELECT camp.id, COALESCE(mission.title, camp.title), camp.activation_state,
                camp.project_binding_kind, camp.project_path, channel.provider, channel.conversation_kind,
                COALESCE(camp.navigation_activity_at, camp.created_at), camp.navigation_activity_sequence,
                mission.id, mission.number, mission.status, {mission_details}, {GROUP_KEY}
         FROM camp LEFT JOIN mission ON mission.camp_id = camp.id
         LEFT JOIN channel_conversation_binding AS binding ON binding.camp_id = camp.id
         LEFT JOIN channel_conversation AS channel ON channel.id = binding.channel_conversation_id
         WHERE {CLIENT_VISIBLE} AND camp.archived_at IS NULL {filter} {tail}"
    )
}

pub(crate) fn search(
    connection: &Connection,
    client: &DraftClient,
    input: NavigationSearchParams,
) -> Result<NavigationSearchResult> {
    let through_global_sequence = current_global_sequence(connection)?;
    let hints = input.hints.unwrap_or_default();
    let id = ThreadId::parse(&input.query).ok();
    let number = exact_mission_number(&input.query);
    let recent = input.query.is_empty();
    let matcher = ConversationFindQuery::new(&input.query);
    let mut items = Vec::new();
    let mut truncated = false;

    if let Some(id) = id {
        let exact = connection
            .query_row(
                &target_sql(false, "AND camp.id = ?2", ""),
                params![client.id(), id],
                Candidate::read,
            )
            .optional()?;
        if let Some(candidate) = exact {
            items.push(candidate.target(Some(NameMatch::field("id"))));
        }
    } else if recent {
        let mut statement = connection.prepare(&target_sql(
            false,
            "",
            &format!("ORDER BY {ORDER} LIMIT ?2"),
        ))?;
        let rows =
            statement.query_map(params![client.id(), RECENT_LIMIT as i64], Candidate::read)?;
        for row in rows {
            items.push(row?.target(None));
        }
    } else {
        let order = if number.is_some() {
            format!("ORDER BY CASE WHEN mission.number = ?2 THEN 0 ELSE 1 END, {ORDER}")
        } else {
            format!("ORDER BY {ORDER}")
        };
        let mut statement = connection.prepare(&target_sql(true, "", &order))?;
        let client_id = client.id();
        let with_number = params![client_id, number];
        let without_number = params![client_id];
        let params = if number.is_some() {
            with_number
        } else {
            without_number
        };
        let candidates = statement.query_map(params, Candidate::read)?;
        for row in candidates {
            let candidate = row?;
            let Some(found) = match_name(&candidate, &matcher, &hints, number)? else {
                continue;
            };
            if items.len() == NAME_LIMIT {
                truncated = true;
                break;
            }
            items.push(candidate.target(Some(found)));
        }
    }
    Ok(NavigationSearchResult {
        schema_version: 1,
        through_global_sequence,
        query: input.query,
        items,
        truncated,
    })
}

fn exact_mission_number(query: &str) -> Option<i64> {
    let digits = match query.as_bytes().first()? {
        b'm' | b'M' => query[1..].strip_prefix('-').unwrap_or(&query[1..]),
        b'#' => &query[1..],
        _ => query,
    }
    .trim_start_matches('0');
    if digits.is_empty() || digits.len() > 9 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn match_name(
    candidate: &Candidate,
    matcher: &ConversationFindQuery,
    hints: &SearchHints,
    number: Option<i64>,
) -> Result<Option<NameMatch>> {
    let thread = &candidate.thread;
    if candidate
        .mission
        .as_ref()
        .is_some_and(|mission| Some(mission.number) == number)
    {
        return Ok(Some(NameMatch::field("number")));
    }
    if matcher.first_range(&thread.title).is_some()
        || hints.thread_ids.contains(&thread.id)
        || thread.channel_source.as_ref().is_some_and(|source| {
            hints
                .channel_kinds
                .contains(&format!("{}:{}", source.provider, source.conversation_kind))
        })
    {
        return Ok(Some(NameMatch::field("title")));
    }
    if hints.group_keys.contains(&candidate.group_key) {
        return Ok(Some(NameMatch::field("project")));
    }
    if let Some(text) = &candidate.description
        && let Some(range) = matcher.first_range(text)
    {
        return Ok(Some(NameMatch {
            field: "description",
            snippet: Some(snippet(text, range)),
        }));
    }
    if let Some(tags) = &candidate.tags {
        for tag in serde_json::from_str::<Vec<String>>(tags).context("Invalid mission tags")? {
            if let Some(range) = matcher.first_range(&tag) {
                return Ok(Some(NameMatch {
                    field: "tag",
                    snippet: Some(snippet(&tag, range)),
                }));
            }
        }
    }
    Ok(None)
}

fn snippet(value: &str, (start, end): (usize, usize)) -> String {
    let from = start.saturating_sub(16);
    let until = (from + 120).max(end);
    let mut remaining = value.chars().skip(from);
    let mut result = String::new();
    if from != 0 {
        result.push('…');
    }
    result.extend(remaining.by_ref().take(until - from));
    if remaining.next().is_some() {
        result.push('…');
    }
    result
}

impl MessageSearch {
    pub(crate) fn run(
        self,
        connection: &Connection,
        client: &DraftClient,
    ) -> Result<NavigationMessageSearchPage> {
        let started = Instant::now();
        let (items, cursor) = self.scan(connection, client, SCAN_LIMIT, || {
            started.elapsed() >= SCAN_TIME
        })?;
        Ok(NavigationMessageSearchPage {
            schema_version: 1,
            through_global_sequence: current_global_sequence(connection)?,
            query: self.query,
            items,
            next_cursor: cursor.map(|cursor| cursor.encode()).transpose()?,
        })
    }

    fn scan(
        &self,
        connection: &Connection,
        client: &DraftClient,
        limit: usize,
        time_up: impl Fn() -> bool,
    ) -> Result<(Vec<MessageHit>, Option<Cursor>)> {
        let activity_at = "COALESCE(camp.navigation_activity_at, camp.created_at)";
        let filter = format!(
            "AND (?2 IS NULL OR ({activity_at}, camp.navigation_activity_sequence) < (?2, ?3)
                OR ({activity_at} = ?2 AND camp.navigation_activity_sequence = ?3 AND camp.id >= ?4))
             AND EXISTS (SELECT 1 FROM camp_message WHERE camp_id = camp.id AND {PUBLIC_SEARCH_MESSAGE})"
        );
        let mut targets =
            connection.prepare(&target_sql(false, &filter, &format!("ORDER BY {ORDER}")))?;
        let mut targets = targets.query(params![
            client.id(),
            self.cursor.as_ref().map(|cursor| &cursor.at),
            self.cursor.as_ref().map(|cursor| cursor.seq),
            self.cursor.as_ref().map(|cursor| &cursor.id)
        ])?;
        let mut messages = connection.prepare(&format!(
            "SELECT id, sequence, author_type, author_id, created_at, structured_content_json
             FROM camp_message WHERE camp_id = ?1 AND sequence <= ?2 AND {PUBLIC_SEARCH_MESSAGE}
             ORDER BY sequence DESC LIMIT ?3"
        ))?;
        let matcher = ConversationFindQuery::new(&self.query);
        let mut items = Vec::new();
        let mut scanned = 0;
        let mut advanced = false;

        'targets: while let Some(row) = targets.next()? {
            let target = Candidate::read(row)?;
            let mut below = self
                .cursor
                .as_ref()
                .filter(|cursor| cursor.is_at(&target))
                .and_then(|cursor| cursor.below);
            loop {
                // Advance at least one batch (including an empty target) even when
                // the initial target sort already consumed the cooperative budget.
                if scanned == limit || (advanced && time_up()) {
                    return Ok((items, Some(target.cursor(&self.fingerprint, below))));
                }
                let batch_limit = MESSAGE_BATCH.min(limit - scanned);
                let upper = below.map_or(i64::MAX, |sequence| sequence - 1);
                let mut rows =
                    messages.query(params![target.thread.id, upper, batch_limit as i64])?;
                let mut batch_count = 0;
                while let Some(row) = rows.next()? {
                    batch_count += 1;
                    scanned += 1;
                    let sequence = row.get(1)?;
                    let body = project_search_message(connection, row.get_ref(5)?.as_str()?)?;
                    if let Some(range) = matcher.first_range(&body) {
                        if items.len() == MESSAGE_LIMIT {
                            return Ok((items, Some(target.cursor(&self.fingerprint, below))));
                        }
                        let author_type: String = row.get(2)?;
                        let author_id: String = row.get(3)?;
                        let author_name = match author_type.as_str() {
                            "agent" => connection
                                .query_row(
                                    "SELECT display_name FROM agent_profile WHERE id = ?1",
                                    [&author_id],
                                    |row| row.get(0),
                                )
                                .optional()?,
                            "external_principal" => connection
                                .query_row(
                                    "SELECT display_name FROM external_principal WHERE id = ?1",
                                    [&author_id],
                                    |row| row.get(0),
                                )
                                .optional()?,
                            _ => None,
                        }
                        .unwrap_or_default();
                        items.push(MessageHit {
                            target: target.target(None),
                            message: MatchedMessage {
                                id: row.get(0)?,
                                sequence,
                                author_type,
                                author_id,
                                author_name,
                                created_at: row.get(4)?,
                            },
                            snippet: snippet(&body, range),
                        });
                        advanced = true;
                        continue 'targets;
                    }
                    below = Some(sequence);
                }
                advanced = true;
                if batch_count < batch_limit {
                    continue 'targets;
                }
            }
        }
        Ok((items, None))
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // A single SQLite owner exercises the actual ordered cursor and both limits,
    // including resuming within an object whose first several batches do not match.
    #[test]
    fn search_pages_resume_at_the_first_unexamined_message_without_skipping_targets() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("
            CREATE TABLE event_sequence(singleton INTEGER PRIMARY KEY, last_sequence INTEGER);
            INSERT INTO event_sequence VALUES (1, 42);
            CREATE TABLE camp(
              id TEXT PRIMARY KEY, title TEXT, activation_state TEXT, project_binding_kind TEXT,
              project_path TEXT, created_at TEXT, navigation_activity_at TEXT,
              navigation_activity_sequence INTEGER, archived_at TEXT, deletion_operation_id TEXT);
            CREATE TABLE mission(id TEXT PRIMARY KEY, camp_id TEXT UNIQUE, title TEXT,
              number INTEGER UNIQUE, status TEXT, description TEXT, tags_json TEXT);
            CREATE TABLE pending_camp_draft_presence(camp_id TEXT, client_id TEXT);
            CREATE TABLE camp_composer_draft(camp_id TEXT, client_id TEXT, body TEXT, source_attachments_json TEXT);
            CREATE TABLE prepared_attachment(camp_id TEXT, client_id TEXT);
            CREATE TABLE channel_conversation_binding(camp_id TEXT, channel_conversation_id TEXT);
            CREATE TABLE channel_conversation(id TEXT, provider TEXT, conversation_kind TEXT);
            CREATE TABLE agent_profile(id TEXT, display_name TEXT);
            CREATE TABLE external_principal(id TEXT, display_name TEXT);
            INSERT INTO external_principal VALUES ('external', 'External Author');
            CREATE TABLE camp_message(id TEXT PRIMARY KEY, camp_id TEXT, sequence INTEGER,
              author_type TEXT, author_id TEXT, created_at TEXT, tombstoned_at TEXT,
              structured_content_json TEXT, UNIQUE(camp_id, sequence));
        ").unwrap();
        let client = DraftClient::default();
        let mission = ThreadId::new().to_string();
        let pending = ThreadId::new().to_string();
        let archived = ThreadId::new().to_string();
        let stamp = "2026-11-20T00:00:00Z";
        let mut ids = vec![];
        for index in 0..55 {
            let id = ThreadId::new().to_string();
            connection.execute(
                "INSERT INTO camp VALUES (?1,'needle 19','active','directory','/repo',?2,NULL,?3,NULL,NULL)",
                params![id, stamp, 1000 - index],
            ).unwrap();
            ids.push(id);
        }
        for (id, activation, archived_at, path) in [
            (&mission, "active", None, "/mission"),
            (&pending, "pending", None, "/repo"),
            (&archived, "active", Some(stamp), "/repo"),
        ] {
            connection
                .execute(
                    "INSERT INTO camp VALUES (?1,'extra',?2,'directory',?3,?4,NULL,0,?5,NULL)",
                    params![id, activation, path, stamp, archived_at],
                )
                .unwrap();
        }
        connection.execute(
            "INSERT INTO mission VALUES('mission',?1,'A mission',19,'in_progress','Mission details',?2)",
            params![mission, r#"["needle"]"#],
        ).unwrap();
        connection
            .execute(
                "INSERT INTO pending_camp_draft_presence VALUES(?1,?2)",
                params![pending, client.id()],
            )
            .unwrap();

        let name_request = |query: &str| {
            let input = NavigationSearchParams {
                query: query.to_owned(),
                hints: None,
            }
            .validate()
            .unwrap();
            search(&connection, &client, input).unwrap()
        };
        let recent = name_request("");
        assert_eq!(recent.items.len(), 12);
        let exact_number = name_request("19");
        assert_eq!(exact_number.items[0].thread.id, mission);
        assert_eq!(
            exact_number.items[0].r#match.as_ref().unwrap().field,
            "number"
        );
        assert!(exact_number.truncated);
        assert_eq!(name_request(&pending).items[0].thread.id, pending);
        assert!(name_request(&archived).items.is_empty());
        let web_client = DraftClient::verified_web(&"0".repeat(64)).unwrap();
        let pending_request = NavigationSearchParams {
            query: pending.clone(),
            hints: None,
        }
        .validate()
        .unwrap();
        assert!(
            search(&connection, &web_client, pending_request)
                .unwrap()
                .items
                .is_empty()
        );

        assert_eq!(name_request("needle").items.len(), 50);

        let insert = |thread: &str, sequence: i64, author: &str, body: &str, deleted: bool| {
            let json = serde_json::json!([{"kind":"text", "text":body}]).to_string();
            connection
                .execute(
                    "INSERT INTO camp_message VALUES (?1,?2,?3,?4,'external',?5,?6,?7)",
                    params![
                        format!("{thread}-{sequence}"),
                        thread,
                        sequence,
                        author,
                        stamp,
                        deleted.then_some(stamp),
                        json
                    ],
                )
                .unwrap();
        };
        let query = "needle\tΟΣ";
        insert(&ids[0], 1, "external_principal", query, false);
        for sequence in 2..=135 {
            insert(&ids[0], sequence, "user", "unrelated", false);
        }
        insert(&ids[0], 136, "system", query, false);
        insert(&ids[0], 137, "user", query, true);
        for id in &ids[1..] {
            insert(id, 1, "user", query, false);
        }
        insert(&mission, 1, "user", query, false);
        insert(&archived, 1, "user", query, false);

        let run = |cursor| {
            NavigationMessageSearchParams {
                query: query.to_owned(),
                cursor,
            }
            .validate()
            .unwrap()
        };
        let collect_pages = |budget, time_up| {
            let mut cursor = None;
            let mut results = Vec::new();
            for _ in 0..180 {
                let (items, next) = run(cursor.clone())
                    .scan(&connection, &client, budget, || time_up)
                    .unwrap();
                results.extend(items);
                let Some(next) = next else { return results };
                let next = next.encode().unwrap();
                assert_ne!(
                    cursor.as_deref(),
                    Some(next.as_str()),
                    "a nonterminal page must advance"
                );
                cursor = Some(next);
            }
            panic!("scan did not finish");
        };
        let full = collect_pages(SCAN_LIMIT, false);
        let tiny = collect_pages(3, false);
        let elapsed = collect_pages(SCAN_LIMIT, true);
        let ids_from = |hits: &[MessageHit]| {
            hits.iter()
                .map(|hit| hit.target.thread.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids_from(&full), [&ids[..], &[mission]].concat());
        assert_eq!(ids_from(&tiny), ids_from(&full));
        assert_eq!(ids_from(&elapsed), ids_from(&full));
        assert_eq!(full[0].message.sequence, 1);
        assert_eq!(full[0].message.author_name, "External Author");
        assert_eq!(full[0].snippet, query);

        let (_, next) = run(None).scan(&connection, &client, 3, || false).unwrap();
        assert!(matches!(
            (NavigationMessageSearchParams {
                query: "another".into(),
                cursor: Some(next.unwrap().encode().unwrap())
            })
            .validate(),
            Err(NavigationSearchInputError::Cursor)
        ));
        let long_query = "界".repeat(200);
        assert!(snippet(&format!("prefix {long_query} end"), (7, 207)).contains(&long_query));
    }
}
