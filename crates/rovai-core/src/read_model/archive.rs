use super::*;
use crate::camp_message_publication::LAST_VISIBLE_MESSAGE_SQL;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveListQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveItem {
    thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chat_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_paused_inputs: Option<bool>,
    mission_id: Option<String>,
    title: String,
    project_key: String,
    last_message_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveList {
    items: Vec<ArchiveItem>,
    next_cursor: Option<String>,
}

pub(crate) fn list(database: &mut Database, query: ArchiveListQuery) -> Result<ArchiveList> {
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let last_visible_time = LAST_VISIBLE_MESSAGE_SQL.replace("m.created_at, m.id", "m.created_at");
    let mut statement = database.connection().prepare(&format!(
        "SELECT camp.id, mission.id, COALESCE(mission.title, camp.title),
            CASE WHEN camp.project_binding_kind = 'quick_chat' THEN 'quick-chat'
                WHEN camp.project_binding_kind = 'directory' AND length(trim(camp.project_path)) > 0
                    THEN 'directory:' || camp.project_path ELSE 'unavailable' END,
            CASE WHEN camp.history_activity_initialized = 1 THEN camp.history_activity_at
                ELSE ({last_visible_time}) END, NULL, NULL
         FROM camp LEFT JOIN mission ON mission.camp_id = camp.id
         WHERE camp.archived_at IS NOT NULL AND camp.deletion_operation_id IS NULL
           AND camp.id > COALESCE(?1, '')
         UNION ALL SELECT t.conversation_id,NULL,t.title,'private-chat',c.updated_at,t.conversation_id,
            EXISTS(SELECT 1 FROM single_chat_pending_input p WHERE p.conversation_id=t.conversation_id AND p.requested_mode='start' AND p.state='queued')
         FROM chat_topic t JOIN conversation c ON c.id=t.conversation_id
         WHERE t.archived_at IS NOT NULL AND t.deletion_operation_id IS NULL AND t.owner_user_id=?3
           AND t.conversation_id>COALESCE(?1,'')
         ORDER BY 1 LIMIT ?2"
    ))?;
    let mut items = statement
        .query_map(
            params![
                query.cursor,
                limit + 1,
                crate::current_user::CURRENT_USER_ID
            ],
            |row| {
                Ok(ArchiveItem {
                    thread_id: row.get(0)?,
                    chat_id: row.get(5)?,
                    has_paused_inputs: row.get(6)?,
                    mission_id: row.get(1)?,
                    title: row.get(2)?,
                    project_key: row.get(3)?,
                    last_message_at: row.get(4)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next_cursor = if items.len() > limit as usize {
        items.pop();
        items.last().map(|row| row.thread_id.clone())
    } else {
        None
    };
    Ok(ArchiveList { items, next_cursor })
}
