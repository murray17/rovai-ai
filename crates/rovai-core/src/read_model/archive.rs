use std::collections::BTreeMap;

use rusqlite::functions::FunctionFlags;
use unicode_normalization::UnicodeNormalization;

use super::*;
use crate::camp_message_publication::LAST_VISIBLE_MESSAGE_SQL;

const ELIGIBLE: &str = "camp.archived_at IS NOT NULL AND camp.deletion_operation_id IS NULL
    AND camp.activation_state = 'active'";
const PROJECT_KEY: &str = "CASE WHEN camp.project_binding_kind = 'quick_chat' THEN 'quick-chat'
    WHEN camp.project_binding_kind = 'directory' AND length(trim(camp.project_path)) > 0
        THEN 'directory:' || camp.project_path ELSE 'unavailable' END";
const TITLE: &str = "COALESCE(mission.title, camp.title)";
const IS_MISSION: &str = "mission.id IS NOT NULL";
const SELECTED_PROJECT: &str =
    "json_array_length(?2) = 0 OR project_key IN (SELECT value FROM json_each(?2))";

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ArchiveKind {
    Chat,
    Mission,
}

impl ArchiveKind {
    fn from_is_mission(value: bool) -> Self {
        if value { Self::Mission } else { Self::Chat }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveListQuery {
    kind: ArchiveKind,
    query: Option<String>,
    #[serde(default)]
    project_keys: Vec<String>,
    limit: Option<u32>,
}

#[derive(Default, Serialize)]
pub(crate) struct ArchiveCounts {
    chat: usize,
    mission: usize,
}

impl ArchiveCounts {
    fn for_kind(&mut self, kind: ArchiveKind) -> &mut usize {
        match kind {
            ArchiveKind::Chat => &mut self.chat,
            ArchiveKind::Mission => &mut self.mission,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveItem {
    thread_id: String,
    mission_id: Option<String>,
    kind: ArchiveKind,
    title: String,
    project_key: String,
    project_name: String,
    last_message_at: Option<String>,
    archive_revision: i64,
    thread_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveProject {
    project_key: String,
    project_name: String,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveGroup {
    project_key: String,
    total_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveList {
    schema_version: u32,
    items: Vec<ArchiveItem>,
    totals: ArchiveCounts,
    matching_counts: ArchiveCounts,
    projects: Vec<ArchiveProject>,
    groups: Vec<ArchiveGroup>,
    has_more: bool,
    through_global_sequence: i64,
}

// Match the Renderer search normalization, without locale-specific case rules.
fn normalize(value: &str) -> String {
    value.nfkc().flat_map(char::to_lowercase).collect()
}

fn project_name(key: &str) -> String {
    match key {
        "quick-chat" => "快速对话".into(),
        "unavailable" => "项目不可用".into(),
        other => project_display_name(other.strip_prefix("directory:").unwrap_or(other)),
    }
}

pub(crate) fn list(database: &mut Database, query: ArchiveListQuery) -> Result<ArchiveList> {
    let ArchiveListQuery {
        kind,
        query,
        project_keys,
        limit,
    } = query;
    let needle = normalize(
        query
            .as_deref()
            .unwrap_or_default()
            .trim_matches(|ch: char| (ch.is_whitespace() && ch != '\u{0085}') || ch == '\u{feff}'),
    );
    let project_keys_json = serde_json::to_string(&project_keys)?;
    let limit = i64::from(limit.unwrap_or(50).max(1));
    let for_mission = matches!(kind, ArchiveKind::Mission);
    let connection = database.connection_mut();
    connection.create_scalar_function(
        "rovai_archive_match",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |context| {
            let title = context.get::<String>(0)?;
            let query = context.get::<String>(1)?;
            Ok(normalize(&title).contains(&query))
        },
    )?;
    let tx = connection.transaction()?;
    let through_global_sequence = current_global_sequence(&tx)?;
    let mut totals = ArchiveCounts::default();
    let mut matching_counts = ArchiveCounts::default();
    let mut projects = project_keys
        .into_iter()
        .map(|key| (key, 0))
        .collect::<BTreeMap<_, _>>();
    let mut groups = Vec::new();
    {
        let mut statement = tx.prepare(&format!(
            r#"
            WITH catalog AS (
                SELECT camp.id, {TITLE} AS title, {PROJECT_KEY} AS project_key,
                    {IS_MISSION} AS is_mission
                FROM camp LEFT JOIN mission ON mission.camp_id = camp.id
                WHERE {ELIGIBLE}
            )
            SELECT is_mission, project_key, count(*),
                count(*) FILTER (WHERE ({SELECTED_PROJECT})
                    AND (?1 = '' OR instr(id, ?1) > 0 OR rovai_archive_match(title, ?1)))
            FROM catalog GROUP BY is_mission, project_key
            "#,
        ))?;
        let rows = statement.query_map(params![needle, project_keys_json], |row| {
            Ok((
                row.get::<_, bool>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as usize,
                row.get::<_, i64>(3)? as usize,
            ))
        })?;
        for row in rows {
            let (is_mission, key, count, matching) = row?;
            let record_kind = ArchiveKind::from_is_mission(is_mission);
            *totals.for_kind(record_kind) += count;
            *matching_counts.for_kind(record_kind) += matching;
            let candidate = projects.entry(key.clone()).or_default();
            if is_mission == for_mission {
                *candidate = count;
                if matching > 0 {
                    groups.push(ArchiveGroup {
                        project_key: key,
                        total_count: matching,
                    });
                }
            }
        }
    }

    let last_visible_time = LAST_VISIBLE_MESSAGE_SQL.replace("m.created_at, m.id", "m.created_at");
    let items = {
        let mut statement = tx.prepare(&format!(
            r#"
            WITH matches AS MATERIALIZED (
                SELECT camp.id, mission.id AS mission_id, {TITLE} AS title,
                    {PROJECT_KEY} AS project_key, camp.archive_revision, camp.version,
                    CASE WHEN camp.history_activity_initialized = 1 THEN camp.history_activity_at
                        ELSE ({last_visible_time}) END AS last_message_at
                FROM camp LEFT JOIN mission ON mission.camp_id = camp.id
                WHERE {ELIGIBLE} AND ({IS_MISSION}) = ?3 AND ({SELECTED_PROJECT})
                    AND (?1 = '' OR instr(camp.id, ?1) > 0 OR rovai_archive_match({TITLE}, ?1))
            )
            SELECT id, mission_id, title, project_key, archive_revision, version, last_message_at
            FROM matches
            ORDER BY MAX(julianday(last_message_at)) OVER (PARTITION BY project_key) DESC,
                project_key, julianday(last_message_at) DESC, id
            LIMIT ?4
            "#,
        ))?;
        statement
            .query_map(
                params![needle, project_keys_json, for_mission, limit],
                |row| {
                    let project_key: String = row.get(3)?;
                    Ok(ArchiveItem {
                        thread_id: row.get(0)?,
                        mission_id: row.get(1)?,
                        kind,
                        title: row.get(2)?,
                        project_name: project_name(&project_key),
                        project_key,
                        archive_revision: row.get(4)?,
                        thread_version: row.get(5)?,
                        last_message_at: row.get(6)?,
                    })
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    tx.commit()?;
    let has_more = *matching_counts.for_kind(kind) > items.len();
    Ok(ArchiveList {
        schema_version: 1,
        items,
        totals,
        matching_counts,
        projects: projects
            .into_iter()
            .map(|(project_key, count)| ArchiveProject {
                project_name: project_name(&project_key),
                project_key,
                count,
            })
            .collect(),
        groups,
        has_more,
        through_global_sequence,
    })
}
