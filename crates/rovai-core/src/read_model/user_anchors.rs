//! Complete public-user navigation, independent of the message/Run display windows.
//! Reads only navigation text; it never hydrates messages, evidence or attachment bytes.
use super::*;
use crate::camp_content::{member_mention_ids, render_plain_text_with_current_user};
use crate::current_user::CurrentUserResolver;

const SUMMARY_SCALARS: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUserAnchor {
    pub message_id: String,
    pub sequence: i64,
    pub title: String,
    pub message_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUserAnchorIndex {
    pub schema_version: i64,
    #[serde(rename = "threadId")]
    pub camp_id: String,
    pub through_global_sequence: i64,
    pub total_count: usize,
    pub items: Vec<ThreadUserAnchor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUserAnchorReply {
    pub message_id: String,
    pub sequence: i64,
    pub summary: String,
    pub message_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUserAnchorPreview {
    pub schema_version: i64,
    #[serde(rename = "threadId")]
    pub camp_id: String,
    pub message_id: String,
    pub through_global_sequence: i64,
    pub source_available: bool,
    pub first_reply: Option<ThreadUserAnchorReply>,
}

const NAVIGABLE_USER: &str = "message.author_type IN ('user', 'external_principal')
    AND message.tombstoned_at IS NULL AND message.recall_state <> 'withdrawn'
    AND NOT EXISTS (SELECT 1 FROM mission_start WHERE message_id = message.id)";

pub(super) const DIRECT_REPLY_SQL: &str = "
    SELECT reply.id FROM camp_message AS reply
    WHERE reply.camp_id = ?1 AND reply.reply_to_camp_message_id = ?2
      AND reply.sequence > ?3 AND reply.author_type = 'agent'
      AND reply.tombstoned_at IS NULL AND reply.recall_state <> 'withdrawn'
      AND NOT EXISTS (SELECT 1 FROM mission_start WHERE message_id = reply.id)
    ORDER BY reply.sequence, reply.id LIMIT 1";

impl ReadModelService {
    pub fn user_anchors(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<UserAnchorIndexRead> {
        let tx = database.connection_mut().transaction()?;
        load_camp(&tx, camp_id)?.context("Thread does not exist")?;
        let through_global_sequence = current_global_sequence(&tx)?;
        let sql = format!(
            "SELECT message.id, message.sequence, message.version,
            message.structured_content_json, message.source_attachments_json, message.quotes_json
            FROM camp_message AS message WHERE message.camp_id = ?1 AND {NAVIGABLE_USER}
            ORDER BY message.sequence, message.id"
        );
        let rows = tx
            .prepare(&sql)?
            .query_map([camp_id], text_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let text = read_navigation_text(&tx, rows)?;
        tx.commit()?;
        Ok(UserAnchorIndexRead {
            camp_id: camp_id.into(),
            through_global_sequence,
            text,
        })
    }

    pub fn user_anchor_preview(
        &self,
        database: &mut Database,
        camp_id: &str,
        message_id: &str,
    ) -> Result<UserAnchorPreviewRead> {
        let tx = database.connection_mut().transaction()?;
        load_camp(&tx, camp_id)?.context("Thread does not exist")?;
        let through_global_sequence = current_global_sequence(&tx)?;
        let sequence: Option<i64> = tx
            .query_row(
                &format!(
                    "SELECT message.sequence FROM camp_message AS message
             WHERE message.camp_id = ?1 AND message.id = ?2 AND {NAVIGABLE_USER}"
                ),
                params![camp_id, message_id],
                |row| row.get(0),
            )
            .optional()?;
        // Only direct child replies qualify. Select identity before reading any body.
        let reply_id = if let Some(sequence) = sequence {
            tx.query_row(
                DIRECT_REPLY_SQL,
                params![camp_id, message_id, sequence],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        } else {
            None
        };
        let rows = if let Some(id) = reply_id {
            vec![tx.query_row("SELECT id, sequence, version, structured_content_json,
                source_attachments_json, quotes_json FROM camp_message WHERE id = ?1 AND camp_id = ?2",
                params![id, camp_id], text_row)?]
        } else {
            Vec::new()
        };
        let text = read_navigation_text(&tx, rows)?;
        tx.commit()?;
        Ok(UserAnchorPreviewRead {
            camp_id: camp_id.into(),
            message_id: message_id.into(),
            through_global_sequence,
            source_available: sequence.is_some(),
            text,
        })
    }
}

/// Detached consistent materials. Call format only after releasing the shared Database guard.
pub struct UserAnchorIndexRead {
    camp_id: String,
    through_global_sequence: i64,
    text: NavigationTextRead,
}
impl UserAnchorIndexRead {
    pub fn format(self) -> Result<ThreadUserAnchorIndex> {
        let items = self
            .text
            .format()?
            .into_iter()
            .map(|(row, title)| ThreadUserAnchor {
                message_id: row.id,
                sequence: row.sequence,
                message_version: row.version,
                title,
            })
            .collect::<Vec<_>>();
        Ok(ThreadUserAnchorIndex {
            schema_version: 1,
            camp_id: self.camp_id,
            through_global_sequence: self.through_global_sequence,
            total_count: items.len(),
            items,
        })
    }
}

pub struct UserAnchorPreviewRead {
    camp_id: String,
    message_id: String,
    through_global_sequence: i64,
    source_available: bool,
    text: NavigationTextRead,
}
impl UserAnchorPreviewRead {
    pub fn format(self) -> Result<ThreadUserAnchorPreview> {
        let first_reply = self
            .text
            .format()?
            .into_iter()
            .next()
            .map(|(row, summary)| ThreadUserAnchorReply {
                message_id: row.id,
                sequence: row.sequence,
                message_version: row.version,
                summary,
            });
        Ok(ThreadUserAnchorPreview {
            schema_version: 1,
            camp_id: self.camp_id,
            message_id: self.message_id,
            through_global_sequence: self.through_global_sequence,
            source_available: self.source_available,
            first_reply,
        })
    }
}

struct NavigationText {
    id: String,
    sequence: i64,
    version: i64,
    content: String,
    sources: String,
    quotes: String,
}

fn text_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NavigationText> {
    Ok(NavigationText {
        id: row.get(0)?,
        sequence: row.get(1)?,
        version: row.get(2)?,
        content: row.get(3)?,
        sources: row.get(4)?,
        quotes: row.get(5)?,
    })
}

fn read_navigation_text(
    tx: &Transaction<'_>,
    mut rows: Vec<NavigationText>,
) -> Result<NavigationTextRead> {
    let contents = rows
        .iter_mut()
        .map(|row| {
            serde_json::from_str::<StructuredThreadMessageContent>(&std::mem::take(
                &mut row.content,
            ))
        })
        .collect::<serde_json::Result<Vec<_>>>()?;
    let mentions = contents
        .iter()
        .flat_map(|content| member_mention_ids(content))
        .collect::<BTreeSet<_>>();
    let mut names = BTreeMap::new();
    let mut query = tx.prepare(
        "SELECT id, display_name FROM agent_profile
        WHERE id IN (SELECT value FROM json_each(?1))",
    )?;
    for name in query.query_map([serde_json::to_string(&mentions)?], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (id, name) = name?;
        names.insert(id, name);
    }
    // Parsing only identifies mention IDs required by this consistent read. Rendering,
    // normalization and fallback parsing run later without the shared Database lock.
    let requested = rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
    let mut attachments = BTreeMap::<String, Vec<String>>::new();
    if !requested.is_empty() {
        // Both historical attachment representations are metadata-only and fetched once.
        let mut query = tx.prepare(r#"
            WITH requested AS (SELECT value AS id FROM json_each(?1))
            SELECT message_id, name FROM (
                SELECT a.camp_message_id AS message_id, a.display_name AS name, a.position AS ordinal, a.id
                FROM requested JOIN message_attachment a ON a.camp_message_id = requested.id
                UNION ALL
                SELECT a.camp_message_id, a.display_name_snapshot, a.ordinal, a.attachment_id
                FROM requested JOIN camp_message_attachment_ref a ON a.camp_message_id = requested.id
            ) ORDER BY message_id, ordinal, id
        "#)?;
        for row in query.query_map([serde_json::to_string(&requested)?], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (id, name) = row?;
            attachments.entry(id).or_default().push(name);
        }
    }
    Ok(NavigationTextRead {
        rows,
        contents,
        names,
        attachments,
    })
}

struct NavigationTextRead {
    rows: Vec<NavigationText>,
    contents: Vec<StructuredThreadMessageContent>,
    names: BTreeMap<String, String>,
    attachments: BTreeMap<String, Vec<String>>,
}
impl NavigationTextRead {
    fn format(mut self) -> Result<Vec<(NavigationText, String)>> {
        let current_user = CurrentUserResolver::resolve("zh-CN");
        self.rows
            .into_iter()
            .zip(self.contents)
            .map(|(row, content)| {
                let mut text = render_plain_text_with_current_user(
                    &normalize_content(content),
                    |id| self.names.get(id).cloned(),
                    current_user.display_name,
                )?;
                if text.trim().is_empty() {
                    let mut names = parse_source_attachments(&row.sources)?
                        .into_iter()
                        .map(|a| a.display_name)
                        .collect::<Vec<_>>();
                    names.extend(self.attachments.remove(&row.id).unwrap_or_default());
                    text = names.join("、");
                }
                if text.trim().is_empty() {
                    text = serde_json::from_str::<Vec<MessageQuoteSnapshot>>(&row.quotes)?
                        .into_iter()
                        .map(|quote| quote.text)
                        .collect::<Vec<_>>()
                        .join(" ");
                }
                if text.trim().is_empty() {
                    text = "（无文本）".into();
                }
                Ok((row, navigation_summary(&text)))
            })
            .collect()
    }
}

fn navigation_summary(text: &str) -> String {
    // Iterate only up to the scalar budget plus lookahead, without a full word/char array.
    let mut chars = text
        .split_whitespace()
        .enumerate()
        .flat_map(|(index, word)| (index > 0).then_some(' ').into_iter().chain(word.chars()));
    let mut summary: String = chars.by_ref().take(SUMMARY_SCALARS).collect();
    if chars.next().is_some() {
        summary.pop();
        summary.push('…');
    }
    summary
}
