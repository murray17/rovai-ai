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
    camp_channel_source_from_row, current_global_sequence, load_message_author_display_name,
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
const FIRST_RUN_DEFAULT_TITLE: &str = "初次集结";

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
    let localized_first_run_title = thread.channel_source.is_none()
        && thread.title == FIRST_RUN_DEFAULT_TITLE
        && hints.thread_ids.contains(&thread.id);
    if matcher.first_range(&thread.title).is_some()
        || localized_first_run_title
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
                        let author_name =
                            load_message_author_display_name(connection, &author_type, &author_id)?
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::read_model::ThreadChannelSource;

    fn name_candidate(title: &str) -> Candidate {
        Candidate {
            thread: NavigationThreadTarget {
                id: "thread".into(),
                title: title.into(),
                activation_state: "active".into(),
                project_binding_kind: "directory".into(),
                project_path: "/repo".into(),
                channel_source: None,
            },
            mission: None,
            last_activity_at: String::new(),
            activity_sequence: 0,
            description: None,
            tags: None,
            group_key: "directory:/repo".into(),
        }
    }

    #[test]
    fn navigation_mission_number_accepts_only_complete_number_syntax() {
        for (query, expected) in [
            ("19", Some(19)),
            ("m19", Some(19)),
            ("M-019", Some(19)),
            ("#00019", Some(19)),
            ("000000000001", Some(1)),
            ("M-999999999", Some(999_999_999)),
            ("M-1000000000", None),
            ("M-000", None),
            ("M--19", None),
            ("#-19", None),
            ("Ｍ１９", None),
            ("19 seats", None),
            ("", None),
        ] {
            assert_eq!(exact_mission_number(query), expected, "{query:?}");
        }
    }

    #[test]
    fn navigation_name_match_returns_the_highest_priority_field_and_its_snippet() {
        let mut candidate = name_candidate("计划 19");
        candidate.mission = Some(MissionTarget {
            mission_id: "mission".into(),
            number: 19,
            status: "in_progress".into(),
        });
        candidate.thread.channel_source = Some(ThreadChannelSource {
            provider: "lark".into(),
            conversation_kind: "topic".into(),
        });
        candidate.description = Some("里程碑\t阶段".into());
        candidate.tags = Some(r#"["里程碑","交付"]"#.into());
        let no_hints = SearchHints::default();
        let project_hint = SearchHints {
            group_keys: vec!["directory:/repo".into()],
            ..Default::default()
        };
        let channel_and_project_hints = SearchHints {
            group_keys: vec!["directory:/repo".into()],
            channel_kinds: vec!["lark:topic".into()],
            ..Default::default()
        };
        for (query, hints, expected) in [
            ("19", &channel_and_project_hints, Some(("number", None))),
            ("计划", &project_hint, Some(("title", None))),
            (
                "Lark topic",
                &channel_and_project_hints,
                Some(("title", None)),
            ),
            ("Lark topic", &no_hints, None),
            ("项目别名", &project_hint, Some(("project", None))),
            ("里程碑", &project_hint, Some(("project", None))),
            (
                "里程碑",
                &no_hints,
                Some(("description", Some("里程碑\t阶段"))),
            ),
            ("交付", &no_hints, Some(("tag", Some("交付")))),
            ("无匹配", &no_hints, None),
        ] {
            let found = match_name(
                &candidate,
                &ConversationFindQuery::new(query),
                hints,
                exact_mission_number(query),
            )
            .unwrap();
            assert_eq!(
                found
                    .as_ref()
                    .map(|hit| (hit.field, hit.snippet.as_deref())),
                expected,
                "{query:?}"
            );
        }
    }

    #[test]
    fn navigation_first_run_hint_requires_the_unchanged_title_and_thread_id() {
        let hints = SearchHints {
            thread_ids: vec!["thread".into()],
            ..Default::default()
        };
        for (title, id, channel_bound, matched) in [
            (FIRST_RUN_DEFAULT_TITLE, "thread", false, true),
            ("已改名", "thread", false, false),
            (FIRST_RUN_DEFAULT_TITLE, "other", false, false),
            (FIRST_RUN_DEFAULT_TITLE, "thread", true, false),
        ] {
            let mut candidate = name_candidate(title);
            candidate.thread.id = id.into();
            candidate.thread.channel_source = channel_bound.then(|| ThreadChannelSource {
                provider: "lark".into(),
                conversation_kind: "topic".into(),
            });
            let found = match_name(
                &candidate,
                &ConversationFindQuery::new("first"),
                &hints,
                None,
            )
            .unwrap();
            assert_eq!(
                found.map(|hit| hit.field),
                matched.then_some("title"),
                "{title:?} {id:?} {channel_bound}"
            );
        }
    }

    #[test]
    fn navigation_snippet_keeps_the_full_match_and_raw_whitespace_at_the_cutoff() {
        let prefix = "前".repeat(20);
        let long_query = "界".repeat(200);
        let body = format!("{prefix}\t{long_query} 后文");
        assert_eq!(
            snippet(&body, (21, 221)),
            format!("…{}\t{long_query}…", "前".repeat(15))
        );
    }

    #[cfg(feature = "extended-tests")]
    mod sqlite {
        use super::*;

        const STAMP: &str = "2026-11-20T00:00:00Z";

        fn database() -> Connection {
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
                CREATE TABLE agent_profile(id TEXT, display_name TEXT, profile_status TEXT);
                CREATE TABLE external_principal(id TEXT, display_name TEXT);
                CREATE TABLE camp_message(id TEXT PRIMARY KEY, camp_id TEXT, sequence INTEGER,
                  author_type TEXT, author_id TEXT, created_at TEXT, tombstoned_at TEXT,
                  structured_content_json TEXT, UNIQUE(camp_id, sequence));
            ").unwrap();
            connection
        }

        fn insert_thread(connection: &Connection, title: &str, activity_sequence: i64) -> String {
            let id = ThreadId::new().to_string();
            connection.execute(
                "INSERT INTO camp VALUES (?1,?2,'active','directory','/repo',?3,NULL,?4,NULL,NULL)",
                params![id, title, STAMP, activity_sequence],
            ).unwrap();
            id
        }

        fn number_mission(connection: &Connection, camp_id: &str) {
            connection.execute(
                "INSERT INTO mission VALUES('mission',?1,'A mission',19,'in_progress','Mission details','[]')",
                [camp_id],
            ).unwrap();
        }

        fn insert_message(
            connection: &Connection,
            thread: &str,
            sequence: i64,
            author: (&str, &str),
            body: &str,
            deleted: bool,
        ) {
            let json = serde_json::json!([{"kind":"text", "text":body}]).to_string();
            connection
                .execute(
                    "INSERT INTO camp_message VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        format!("{thread}-{sequence}"),
                        thread,
                        sequence,
                        author.0,
                        author.1,
                        STAMP,
                        deleted.then_some(STAMP),
                        json
                    ],
                )
                .unwrap();
        }

        fn name_request(
            connection: &Connection,
            client: &DraftClient,
            query: &str,
        ) -> NavigationSearchResult {
            let input = NavigationSearchParams {
                query: query.to_owned(),
                hints: None,
            }
            .validate()
            .unwrap();
            search(connection, client, input).unwrap()
        }

        fn message_request(query: &str, cursor: Option<String>) -> MessageSearch {
            NavigationMessageSearchParams {
                query: query.to_owned(),
                cursor,
            }
            .validate()
            .unwrap()
        }

        #[test]
        fn navigation_names_limit_recent_results_and_rank_exact_matches_before_truncation() {
            let connection = database();
            let client = DraftClient::default();
            let older = insert_thread(&connection, "旧任务 19", 0);
            let mission = insert_thread(&connection, "任务使命", 1);
            number_mission(&connection, &mission);
            let active: Vec<_> = (2..57)
                .rev()
                .map(|sequence| insert_thread(&connection, "较新的计划 19", sequence))
                .collect();

            let recent = name_request(&connection, &client, "");
            assert_eq!(
                recent
                    .items
                    .iter()
                    .map(|item| item.thread.id.as_str())
                    .collect::<Vec<_>>(),
                active[..12].iter().map(String::as_str).collect::<Vec<_>>(),
            );
            let number = name_request(&connection, &client, "19");
            assert_eq!(number.items.len(), 50);
            assert_eq!(number.items[0].thread.id, mission);
            assert_eq!(number.items[0].r#match.as_ref().unwrap().field, "number");
            assert!(number.truncated);
            let exact = name_request(&connection, &client, &older);
            assert_eq!(exact.items.len(), 1);
            assert_eq!(exact.items[0].thread.id, older);
            assert_eq!(exact.items[0].r#match.as_ref().unwrap().field, "id");
        }

        #[test]
        fn navigation_names_and_messages_share_thread_visibility() {
            let connection = database();
            let owner = DraftClient::default();
            let visitor = DraftClient::verified_web(&"0".repeat(64)).unwrap();
            let mission = insert_thread(&connection, "使命", 4);
            number_mission(&connection, &mission);
            let pending = insert_thread(&connection, "待建对话", 3);
            let archived = insert_thread(&connection, "归档", 2);
            let deleting = insert_thread(&connection, "删除中", 1);
            connection
                .execute(
                    "UPDATE camp SET activation_state='pending' WHERE id=?1",
                    [&pending],
                )
                .unwrap();
            connection
                .execute(
                    "UPDATE camp SET archived_at=?2 WHERE id=?1",
                    params![archived, STAMP],
                )
                .unwrap();
            connection
                .execute(
                    "UPDATE camp SET deletion_operation_id='delete' WHERE id=?1",
                    [&deleting],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO pending_camp_draft_presence VALUES(?1,?2)",
                    params![pending, owner.id()],
                )
                .unwrap();
            for id in [&mission, &pending, &archived, &deleting] {
                insert_message(&connection, id, 1, ("user", "local_user"), "needle", false);
            }
            for (client, expected) in [
                (&owner, vec![&mission, &pending]),
                (&visitor, vec![&mission]),
            ] {
                let recent = name_request(&connection, client, "");
                assert_eq!(
                    recent
                        .items
                        .iter()
                        .map(|target| &target.thread.id)
                        .collect::<Vec<_>>(),
                    expected
                );
                assert!(recent.items[0].mission.is_some());
                for id in [&pending, &archived, &deleting] {
                    assert_eq!(
                        name_request(&connection, client, id).items.len(),
                        usize::from(expected.contains(&id))
                    );
                }
                let (hits, next) = message_request("needle", None)
                    .scan(&connection, client, SCAN_LIMIT, || false)
                    .unwrap();
                assert!(next.is_none());
                assert_eq!(
                    hits.iter()
                        .map(|hit| &hit.target.thread.id)
                        .collect::<Vec<_>>(),
                    expected
                );
            }
        }

        #[test]
        fn navigation_message_hits_return_the_newest_public_body_and_resolved_author() {
            let connection = database();
            let client = DraftClient::default();
            let external = insert_thread(&connection, "外部作者", 3);
            let removed = insert_thread(&connection, "已移除作者", 2);
            let unknown = insert_thread(&connection, "资料缺失", 1);
            connection
                .execute_batch(
                    "
                INSERT INTO external_principal VALUES ('external', '外部作者');
                INSERT INTO agent_profile VALUES ('removed', '历史队员', 'removed');
            ",
                )
                .unwrap();
            let query = "needle\tΟΣ";
            insert_message(
                &connection,
                &external,
                1,
                ("user", "local_user"),
                query,
                false,
            );
            insert_message(
                &connection,
                &external,
                2,
                ("external_principal", "external"),
                query,
                false,
            );
            insert_message(
                &connection,
                &external,
                3,
                ("system", "system"),
                query,
                false,
            );
            insert_message(
                &connection,
                &external,
                4,
                ("user", "local_user"),
                query,
                true,
            );
            insert_message(&connection, &removed, 1, ("agent", "removed"), query, false);
            insert_message(&connection, &unknown, 1, ("agent", "missing"), query, false);

            let (hits, next) = message_request(query, None)
                .scan(&connection, &client, SCAN_LIMIT, || false)
                .unwrap();
            assert!(next.is_none());
            assert_eq!(
                hits.iter()
                    .map(|hit| (
                        hit.target.thread.id.as_str(),
                        hit.message.sequence,
                        hit.message.author_name.as_str(),
                        hit.snippet.as_str()
                    ))
                    .collect::<Vec<_>>(),
                vec![
                    (external.as_str(), 2, "外部作者", query),
                    (removed.as_str(), 1, "历史队员", query),
                    (unknown.as_str(), 1, "", query)
                ]
            );
        }

        // The SQL order, the 21st-hit boundary and resuming inside a Thread
        // must agree under both deterministic record and clock budgets.
        #[test]
        fn search_pages_resume_at_the_first_unexamined_message_without_skipping_targets() {
            let connection = database();
            let client = DraftClient::default();
            let ids: Vec<_> = (1..=25)
                .rev()
                .map(|sequence| insert_thread(&connection, "会话", sequence))
                .collect();
            let query = "needle";
            for id in &ids {
                insert_message(&connection, id, 1, ("user", "local_user"), query, false);
            }
            for sequence in 2..=135 {
                insert_message(
                    &connection,
                    &ids[0],
                    sequence,
                    ("user", "local_user"),
                    "unrelated",
                    false,
                );
            }

            let collect_pages = |budget, time_up| {
                let mut cursor = None;
                let mut results = Vec::new();
                for _ in 0..180 {
                    let (items, next) = message_request(query, cursor.clone())
                        .scan(&connection, &client, budget, || time_up)
                        .unwrap();
                    results.extend(items.into_iter().map(|hit| hit.target.thread.id));
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
            let (first, cursor) = message_request(query, None)
                .scan(&connection, &client, SCAN_LIMIT, || false)
                .unwrap();
            assert_eq!(first.len(), 20);
            let cursor = cursor.unwrap();
            assert_eq!(cursor.id, ids[20]);
            assert!(matches!(
                (NavigationMessageSearchParams {
                    query: "another".into(),
                    cursor: Some(cursor.encode().unwrap())
                })
                .validate(),
                Err(NavigationSearchInputError::Cursor)
            ));
            for (budget, time_up) in [(SCAN_LIMIT, false), (3, false), (SCAN_LIMIT, true)] {
                assert_eq!(collect_pages(budget, time_up), ids);
            }
        }
    }
}
