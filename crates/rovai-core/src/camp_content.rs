use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::command::canonical_json_digest;
use crate::current_user::{CURRENT_USER_ID, CurrentUserResolver};

pub const AGENT_MESSAGE_PROJECTION_AUDIENCE: &str = "agent_v1";
pub const AGENT_PRINCIPAL_DISPLAY_NAME: &str = "Principal";

pub type StructuredCampMessageContent = Vec<StructuredCampMessageSegment>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StructuredCampMessageSegment {
    Text {
        text: String,
    },
    MemberMention {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    AllMembersMention,
    CurrentUserMention {
        #[serde(rename = "userId")]
        user_id: String,
    },
    SkillMention {
        #[serde(rename = "skillId")]
        skill_id: String,
        #[serde(rename = "nameAtSend")]
        name_at_send: String,
    },
    FileSelection {
        selection: FileSelectionSnapshot,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSelectionSnapshot {
    pub selection_id: String,
    pub display_path: String,
    pub selected_text: String,
    pub start_line: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u64>,
    pub end_line: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u64>,
    pub position_encoding: String,
    pub range_end: String,
    pub content_version: FileSelectionContentVersion,
    pub verification: String,
    pub source_kind: String,
    pub source_identity_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSelectionContentVersion {
    pub size: u64,
    pub mtime_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
}

const MAX_CONTENT_SEGMENTS: usize = 4_096;
const MAX_CONTENT_TEXT_BYTES: usize = 1_048_576;
const MAX_FILE_SELECTIONS: usize = 8;
const MAX_FILE_SELECTION_BYTES: usize = 64 * 1_024;
const MAX_FILE_SELECTION_TOTAL_BYTES: usize = 256 * 1_024;

pub fn validate_content(content: &[StructuredCampMessageSegment]) -> Result<()> {
    if content.len() > MAX_CONTENT_SEGMENTS {
        anyhow::bail!("Structured Camp Message Content has too many segments");
    }
    let mut text_bytes = 0_usize;
    let mut selection_count = 0_usize;
    let mut selection_bytes = 0_usize;
    for segment in content {
        match segment {
            StructuredCampMessageSegment::Text { text } => {
                text_bytes = text_bytes
                    .checked_add(text.len())
                    .context("Structured Camp Message Content size overflow")?;
            }
            StructuredCampMessageSegment::MemberMention { agent_id } => {
                if agent_id.is_empty() || agent_id.trim() != agent_id || agent_id.len() > 256 {
                    anyhow::bail!("Member Mention requires a canonical Agent ID");
                }
            }
            StructuredCampMessageSegment::AllMembersMention => {}
            StructuredCampMessageSegment::CurrentUserMention { user_id } => {
                if user_id != CURRENT_USER_ID {
                    anyhow::bail!("Current User Mention requires the canonical local user ID");
                }
            }
            StructuredCampMessageSegment::SkillMention {
                skill_id,
                name_at_send,
            } => {
                if skill_id.is_empty() || skill_id.trim() != skill_id || skill_id.len() > 256 {
                    anyhow::bail!("Skill Mention requires a canonical Skill ID");
                }
                crate::skill::validate_skill_name(name_at_send)?;
            }
            StructuredCampMessageSegment::FileSelection { selection } => {
                validate_file_selection(selection)?;
                selection_count = selection_count.saturating_add(1);
                selection_bytes = selection_bytes
                    .checked_add(selection.selected_text.len())
                    .context("File Selection size overflow")?;
            }
        }
    }
    if text_bytes > MAX_CONTENT_TEXT_BYTES {
        anyhow::bail!("Structured Camp Message Content text exceeds 1 MiB");
    }
    if selection_count > MAX_FILE_SELECTIONS || selection_bytes > MAX_FILE_SELECTION_TOTAL_BYTES {
        anyhow::bail!("file_selection_limit_exceeded");
    }
    Ok(())
}

fn validate_file_selection(selection: &FileSelectionSnapshot) -> Result<()> {
    if selection.selection_id.is_empty()
        || selection.selection_id.trim() != selection.selection_id
        || selection.selection_id.len() > 128
        || selection.selection_id.contains(['\0', '\r', '\n'])
    {
        anyhow::bail!("File Selection requires a canonical Selection ID");
    }
    if selection.display_path.is_empty()
        || selection.display_path.len() > 1_024
        || selection.display_path.contains(['\0', '\r', '\n'])
    {
        anyhow::bail!("File Selection display path is invalid");
    }
    if selection.selected_text.is_empty()
        || selection.selected_text.len() > MAX_FILE_SELECTION_BYTES
    {
        anyhow::bail!("file_selection_limit_exceeded");
    }
    if selection.start_line == 0
        || selection.end_line == 0
        || selection.end_line < selection.start_line
        || selection.start_column == Some(0)
        || selection.end_column == Some(0)
        || (selection.end_line == selection.start_line
            && selection.start_column.is_some()
            && selection.end_column.is_some()
            && selection.end_column < selection.start_column)
    {
        anyhow::bail!("File Selection range is invalid");
    }
    if selection.position_encoding != "utf-16" || selection.range_end != "exclusive" {
        anyhow::bail!("File Selection position semantics are invalid");
    }
    if !matches!(
        selection.verification.as_str(),
        "current_file" | "viewer_snapshot_after_change"
    ) || !matches!(
        selection.source_kind.as_str(),
        "message_reference"
            | "camp_workspace"
            | "attachment"
            | "run_evidence"
            | "child_of_handle"
            | "authorized_root"
    ) || !selection.source_identity_digest.starts_with("sha256:")
        || selection.source_identity_digest.len() != 71
        || !selection.source_identity_digest[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        anyhow::bail!("File Selection provenance is invalid");
    }
    if selection
        .content_version
        .file_id
        .as_deref()
        .is_some_and(|file_id| file_id.is_empty() || file_id.len() > 256)
    {
        anyhow::bail!("File Selection content version is invalid");
    }
    Ok(())
}

/// Validates content submitted through the user-owned Composer boundary.
///
/// Current User Mentions are attention metadata generated by Core while
/// accepting an Agent message. They are deliberately not an authoring token:
/// accepting one from a Composer client would let handwritten or pasted
/// content impersonate that Core-owned signal.
pub fn validate_user_authored_content(content: &[StructuredCampMessageSegment]) -> Result<()> {
    validate_content(content)?;
    if mentions_current_user(content) {
        anyhow::bail!("Current User Mention can only be generated by Core");
    }
    Ok(())
}

pub fn normalize_content(content: StructuredCampMessageContent) -> StructuredCampMessageContent {
    let mut normalized: StructuredCampMessageContent = Vec::with_capacity(content.len());
    for segment in content {
        match segment {
            StructuredCampMessageSegment::Text { text } if text.is_empty() => {}
            StructuredCampMessageSegment::Text { text } => {
                if let Some(StructuredCampMessageSegment::Text { text: previous }) =
                    normalized.last_mut()
                {
                    previous.push_str(&text);
                } else {
                    normalized.push(StructuredCampMessageSegment::Text { text });
                }
            }
            mention => normalized.push(mention),
        }
    }
    normalized
}

pub fn member_mention_ids(content: &[StructuredCampMessageSegment]) -> Vec<String> {
    let mut seen = HashSet::new();
    content
        .iter()
        .filter_map(|segment| match segment {
            StructuredCampMessageSegment::MemberMention { agent_id }
                if seen.insert(agent_id.as_str()) =>
            {
                Some(agent_id.clone())
            }
            _ => None,
        })
        .collect()
}

pub fn has_all_members_mention(content: &[StructuredCampMessageSegment]) -> bool {
    content
        .iter()
        .any(|segment| matches!(segment, StructuredCampMessageSegment::AllMembersMention))
}

pub fn mentions_current_user(content: &[StructuredCampMessageSegment]) -> bool {
    content.iter().any(|segment| {
        matches!(
            segment,
            StructuredCampMessageSegment::CurrentUserMention { user_id }
                if user_id == CURRENT_USER_ID
        )
    })
}

pub fn render_plain_text(
    content: &[StructuredCampMessageSegment],
    mut member_name: impl FnMut(&str) -> Option<String>,
) -> Result<String> {
    let current_user = CurrentUserResolver::resolve("zh-CN");
    render_plain_text_with_current_user(content, &mut member_name, current_user.display_name)
}

pub fn render_plain_text_with_current_user(
    content: &[StructuredCampMessageSegment],
    mut member_name: impl FnMut(&str) -> Option<String>,
    current_user_display_name: &str,
) -> Result<String> {
    render_plain_text_with_current_user_mode(
        content,
        &mut member_name,
        current_user_display_name,
        FileSelectionProjection::Human,
    )
}

#[derive(Clone, Copy)]
enum FileSelectionProjection {
    Human,
    Agent,
}

fn render_plain_text_with_current_user_mode(
    content: &[StructuredCampMessageSegment],
    mut member_name: impl FnMut(&str) -> Option<String>,
    current_user_display_name: &str,
    file_selection_projection: FileSelectionProjection,
) -> Result<String> {
    if current_user_display_name.trim().is_empty() {
        anyhow::bail!("Current User display name must not be empty");
    }
    let mut rendered = String::new();
    for (index, segment) in content.iter().enumerate() {
        match segment {
            StructuredCampMessageSegment::Text { text } => rendered.push_str(text),
            StructuredCampMessageSegment::MemberMention { agent_id } => {
                let name = member_name(agent_id)
                    .ok_or_else(|| anyhow!("Member Mention identity does not exist"))?;
                rendered.push('@');
                rendered.push_str(&name);
            }
            StructuredCampMessageSegment::AllMembersMention => rendered.push_str("@所有队员"),
            StructuredCampMessageSegment::CurrentUserMention { user_id } => {
                if user_id != CURRENT_USER_ID {
                    anyhow::bail!("Current User Mention identity does not exist");
                }
                rendered.push('@');
                rendered.push_str(current_user_display_name);
                if index == 0 && content[index + 1..].iter().any(segment_projects_nonempty) {
                    rendered.push(' ');
                }
            }
            StructuredCampMessageSegment::SkillMention { name_at_send, .. } => {
                rendered.push('/');
                rendered.push_str(name_at_send);
            }
            StructuredCampMessageSegment::FileSelection { selection } => {
                if !rendered.is_empty() && !rendered.ends_with('\n') {
                    rendered.push('\n');
                }
                match file_selection_projection {
                    FileSelectionProjection::Human => {
                        rendered.push_str("文件选区：");
                        rendered.push_str(&selection.display_path);
                        rendered.push_str(" · ");
                        rendered.push_str(&file_selection_range_label(selection));
                        rendered.push('\n');
                        rendered.push_str(&selection.selected_text);
                        if !selection.selected_text.ends_with('\n') {
                            rendered.push('\n');
                        }
                    }
                    FileSelectionProjection::Agent => {
                        render_agent_file_selection(&mut rendered, selection);
                    }
                }
            }
        }
    }
    Ok(rendered)
}

fn render_agent_file_selection(rendered: &mut String, selection: &FileSelectionSnapshot) {
    rendered.push_str("<file_selection>\n");
    rendered.push_str("path: ");
    rendered.push_str(&selection.display_path);
    rendered.push_str("\nrange: ");
    rendered.push_str(&file_selection_range_label(selection));
    rendered.push_str("\nposition_encoding: utf-16\nrange_end: exclusive\n");
    rendered.push_str("content_version: size=");
    rendered.push_str(&selection.content_version.size.to_string());
    rendered.push_str("; mtime_ms=");
    rendered.push_str(&selection.content_version.mtime_ms.to_string());
    if let Some(file_id) = selection.content_version.file_id.as_deref() {
        rendered.push_str("; file_id=");
        rendered.push_str(file_id);
    }
    rendered.push_str("\nverification: ");
    rendered.push_str(&selection.verification);
    rendered.push_str("\ntext:\n");
    rendered.push_str(&selection.selected_text);
    if !selection.selected_text.ends_with('\n') {
        rendered.push('\n');
    }
    rendered.push_str("</file_selection>\n");
}

fn segment_projects_nonempty(segment: &StructuredCampMessageSegment) -> bool {
    match segment {
        StructuredCampMessageSegment::Text { text } => !text.is_empty(),
        StructuredCampMessageSegment::MemberMention { .. }
        | StructuredCampMessageSegment::AllMembersMention
        | StructuredCampMessageSegment::CurrentUserMention { .. }
        | StructuredCampMessageSegment::SkillMention { .. }
        | StructuredCampMessageSegment::FileSelection { .. } => true,
    }
}

fn file_selection_range_label(selection: &FileSelectionSnapshot) -> String {
    let start = match selection.start_column {
        Some(column) => format!("L{}:{}", selection.start_line, column),
        None => format!("L{}", selection.start_line),
    };
    let end = match selection.end_column {
        Some(column) => format!("L{}:{}", selection.end_line, column),
        None => format!("L{}", selection.end_line),
    };
    format!("{start}–{end}")
}

pub fn render_current_plain_text(
    connection: &Connection,
    content: &[StructuredCampMessageSegment],
) -> Result<String> {
    let current_user = CurrentUserResolver::resolve("zh-CN");
    render_plain_text_for_connection_with_current_user(
        connection,
        content,
        current_user.display_name,
    )
}

/// Renders Structured Camp Message Content for an Agent-owned surface.
///
/// Current User Mentions remain structured at rest. Only this projection seam
/// presents that identity as the stable Agent-facing `@Principal` token; human
/// projections continue to use the localized current-user display name.
pub fn render_agent_plain_text(
    connection: &Connection,
    content: &[StructuredCampMessageSegment],
) -> Result<String> {
    render_plain_text_for_connection_with_current_user_mode(
        connection,
        content,
        AGENT_PRINCIPAL_DISPLAY_NAME,
        FileSelectionProjection::Agent,
    )
}

fn render_plain_text_for_connection_with_current_user(
    connection: &Connection,
    content: &[StructuredCampMessageSegment],
    current_user_display_name: &str,
) -> Result<String> {
    render_plain_text_for_connection_with_current_user_mode(
        connection,
        content,
        current_user_display_name,
        FileSelectionProjection::Human,
    )
}

fn render_plain_text_for_connection_with_current_user_mode(
    connection: &Connection,
    content: &[StructuredCampMessageSegment],
    current_user_display_name: &str,
    file_selection_projection: FileSelectionProjection,
) -> Result<String> {
    let mut names = BTreeMap::new();
    for agent_id in member_mention_ids(content) {
        let display_name = connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [&agent_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(display_name) = display_name {
            names.insert(agent_id, display_name);
        }
    }
    render_plain_text_with_current_user_mode(
        content,
        |agent_id| names.get(agent_id).cloned(),
        current_user_display_name,
        file_selection_projection,
    )
}

/// Rebuilds the derived body cache for every surviving message that addresses
/// the current user. The caller owns the transaction, so an invalid segment or
/// unresolved member identity cannot leave projected bodies and FTS rows at
/// different presentation versions.
pub fn reproject_current_user_messages(
    transaction: &Transaction<'_>,
    current_user_display_name: &str,
) -> Result<usize> {
    let messages = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id, structured_content_json
            FROM camp_message
            ORDER BY rowid ASC
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut updated = 0_usize;
    for (message_id, content_json) in messages {
        let content: StructuredCampMessageContent = serde_json::from_str(&content_json)
            .with_context(|| format!("Camp Message {message_id} has invalid structured content"))?;
        validate_content(&content)?;
        if !mentions_current_user(&content) {
            continue;
        }
        let projected_body = render_plain_text_for_connection_with_current_user(
            transaction,
            &content,
            current_user_display_name,
        )?;
        updated += transaction.execute(
            "UPDATE camp_message SET body = ?2 WHERE id = ?1 AND body IS NOT ?2",
            params![message_id, projected_body],
        )?;
    }
    Ok(updated)
}

pub fn canonical_content_digest(content: &[StructuredCampMessageSegment]) -> Result<String> {
    let value = serde_json::to_value(content)?;
    Ok(format!("sha256:{}", canonical_json_digest(&value)?))
}

#[cfg(test)]
mod tests {
    use super::{
        FileSelectionContentVersion, FileSelectionSnapshot,
        StructuredCampMessageSegment as Segment, canonical_content_digest, member_mention_ids,
        mentions_current_user, normalize_content, render_agent_plain_text, render_plain_text,
        render_plain_text_with_current_user, validate_content, validate_user_authored_content,
    };
    use crate::current_user::CURRENT_USER_ID;
    use rusqlite::{Connection, params};

    fn file_selection(text: &str) -> Segment {
        Segment::FileSelection {
            selection: FileSelectionSnapshot {
                selection_id: "selection-1".into(),
                display_path: "src/app.ts".into(),
                selected_text: text.into(),
                start_line: 4,
                start_column: Some(2),
                end_line: 5,
                end_column: Some(7),
                position_encoding: "utf-16".into(),
                range_end: "exclusive".into(),
                content_version: FileSelectionContentVersion {
                    size: 42,
                    mtime_ms: 10,
                    file_id: Some("1:2".into()),
                },
                verification: "current_file".into(),
                source_kind: "camp_workspace".into(),
                source_identity_digest:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            },
        }
    }

    #[test]
    fn file_selection_is_validated_and_rendered_as_a_frozen_plain_text_block() {
        let content = vec![
            Segment::Text {
                text: "请看".into(),
            },
            file_selection("const ready = true;"),
        ];
        validate_user_authored_content(&content).unwrap();
        assert_eq!(
            render_plain_text(&content, |_| None).unwrap(),
            "请看\n文件选区：src/app.ts · L4:2–L5:7\nconst ready = true;\n"
        );
    }

    #[test]
    fn agent_file_selection_projection_includes_frozen_version_and_verification() {
        let content = vec![
            Segment::Text {
                text: "inspect".into(),
            },
            file_selection("const ready = true;"),
        ];
        let connection = Connection::open_in_memory().unwrap();

        assert_eq!(
            render_agent_plain_text(&connection, &content).unwrap(),
            concat!(
                "inspect\n",
                "<file_selection>\n",
                "path: src/app.ts\n",
                "range: L4:2–L5:7\n",
                "position_encoding: utf-16\n",
                "range_end: exclusive\n",
                "content_version: size=42; mtime_ms=10; file_id=1:2\n",
                "verification: current_file\n",
                "text:\n",
                "const ready = true;\n",
                "</file_selection>\n",
            )
        );
    }

    #[test]
    fn file_selection_limits_are_enforced_independently_of_message_text() {
        let too_large = file_selection(&"x".repeat(64 * 1_024 + 1));
        assert!(validate_content(&[too_large]).is_err());
        let too_many = (0..9)
            .map(|index| {
                let mut selection = file_selection("x");
                if let Segment::FileSelection { selection } = &mut selection {
                    selection.selection_id = format!("selection-{index}");
                }
                selection
            })
            .collect::<Vec<_>>();
        assert!(validate_content(&too_many).is_err());
    }

    #[test]
    fn normalization_preserves_occurrences_and_merges_only_adjacent_text() {
        let content = normalize_content(vec![
            Segment::Text { text: "让".into() },
            Segment::Text {
                text: "@普通文字 ".into(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".into(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".into(),
            },
            Segment::AllMembersMention,
            Segment::Text {
                text: String::new(),
            },
        ]);

        assert_eq!(content.len(), 4);
        assert_eq!(member_mention_ids(&content), vec!["agent_2"]);
        assert!(matches!(&content[0], Segment::Text { text } if text == "让@普通文字 "));
    }

    #[test]
    fn plain_text_that_looks_like_a_mention_never_becomes_an_address() {
        let content = normalize_content(vec![Segment::Text {
            text: "让@小河狸 review".into(),
        }]);

        assert!(member_mention_ids(&content).is_empty());
        assert_eq!(
            render_plain_text(&content, |_| None).unwrap(),
            "让@小河狸 review"
        );
    }

    #[test]
    fn serde_and_validation_keep_the_content_model_closed() {
        assert!(
            serde_json::from_str::<Segment>(
                r#"{"kind":"member_mention","agentId":"agent_2","name":"木瓦"}"#
            )
            .is_err()
        );
        assert!(serde_json::from_str::<Segment>(r#"{"kind":"markdown","text":"@木瓦"}"#).is_err());
        assert!(
            validate_content(&[Segment::MemberMention {
                agent_id: " agent_2".into(),
            }])
            .is_err()
        );
    }

    #[test]
    fn skill_mentions_freeze_identity_project_slash_text_and_reject_malformed_wire() {
        let content = vec![
            Segment::SkillMention {
                skill_id: "skill-review".into(),
                name_at_send: "review-pr".into(),
            },
            Segment::Text {
                text: " 123".into(),
            },
        ];
        validate_user_authored_content(&content).unwrap();
        assert_eq!(
            render_plain_text(&content, |_| None).unwrap(),
            "/review-pr 123"
        );
        assert_eq!(
            serde_json::to_value(&content[0]).unwrap(),
            serde_json::json!({
                "kind": "skill_mention",
                "skillId": "skill-review",
                "nameAtSend": "review-pr"
            })
        );
        let digest = canonical_content_digest(&content).unwrap();
        assert!(digest.starts_with("sha256:"));
        assert_eq!(digest.len(), 71);
        let round_tripped: Vec<Segment> =
            serde_json::from_value(serde_json::to_value(&content).unwrap()).unwrap();
        assert_eq!(canonical_content_digest(&round_tripped).unwrap(), digest);

        for malformed in [
            r#"{"kind":"skill_mention","skillId":"skill-review","nameAtSend":"review-pr","path":"/tmp/SKILL.md"}"#,
            r#"{"kind":"skill_mention","skillId":" skill-review","nameAtSend":"review-pr"}"#,
            r#"{"kind":"skill_mention","skillId":"skill-review","nameAtSend":"Review-PR"}"#,
            r#"{"kind":"skill_mention","skillId":"skill-review","nameAtSend":"review--pr"}"#,
        ] {
            if let Ok(segment) = serde_json::from_str::<Segment>(malformed) {
                assert!(validate_content(&[segment]).is_err());
            }
        }
        assert!(
            validate_content(&[Segment::SkillMention {
                skill_id: "技".repeat(86),
                name_at_send: "review-pr".into(),
            }])
            .is_err()
        );
    }

    #[test]
    fn rendering_projects_current_names_without_changing_semantic_digest() {
        let content = normalize_content(vec![
            Segment::MemberMention {
                agent_id: "agent_2".into(),
            },
            Segment::Text {
                text: " 请检查 ".into(),
            },
            Segment::AllMembersMention,
        ]);
        let digest = canonical_content_digest(&content).unwrap();

        assert_eq!(
            render_plain_text(&content, |id| {
                (id == "agent_2").then(|| "沐瓦".to_string())
            })
            .unwrap(),
            "@沐瓦 请检查 @所有队员"
        );
        assert_eq!(digest, canonical_content_digest(&content).unwrap());
    }

    #[test]
    fn current_user_mention_has_stable_identity_and_projected_display_name() {
        let content = normalize_content(vec![
            Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            },
            Segment::Text {
                text: "请选择方案".into(),
            },
        ]);
        validate_content(&content).unwrap();
        let digest = canonical_content_digest(&content).unwrap();

        assert!(mentions_current_user(&content));
        assert_eq!(
            render_plain_text(&content, |_| None).unwrap(),
            "@你 请选择方案"
        );
        assert_eq!(
            render_plain_text_with_current_user(&content, |_| None, "You").unwrap(),
            "@You 请选择方案"
        );
        let connection = Connection::open_in_memory().unwrap();
        assert_eq!(
            render_agent_plain_text(&connection, &content).unwrap(),
            "@Principal 请选择方案"
        );
        assert_eq!(digest, canonical_content_digest(&content).unwrap());
    }

    #[test]
    fn current_user_mention_rejects_noncanonical_identity_and_lookalikes_stay_text() {
        assert!(
            validate_content(&[Segment::CurrentUserMention {
                user_id: "local-user".into(),
            }])
            .is_err()
        );
        let lookalike = vec![Segment::Text {
            text: "@你 @local_user".into(),
        }];
        assert!(!mentions_current_user(&lookalike));
    }

    #[test]
    fn user_authored_content_cannot_create_current_user_attention() {
        assert!(
            validate_user_authored_content(&[Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            }])
            .unwrap_err()
            .to_string()
            .contains("only be generated by Core")
        );
        validate_user_authored_content(&[Segment::Text {
            text: "@你只是普通文本".into(),
        }])
        .unwrap();
    }

    #[test]
    fn current_user_reprojection_updates_body_and_fts_without_changing_semantics() {
        let mut connection = reprojection_fixture();
        let content = vec![
            Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            },
            Segment::Text {
                text: "请选择方案".into(),
            },
        ];
        let content_json = serde_json::to_string(&content).unwrap();
        let digest = canonical_content_digest(&content).unwrap();
        connection
            .execute(
                "INSERT INTO camp_message(id, body, structured_content_json) VALUES (?1, ?2, ?3)",
                params!["message-1", "@你 请选择方案", content_json],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO camp_message(id, body, structured_content_json) VALUES (?1, ?2, ?3)",
                params![
                    "message-2",
                    "普通正文",
                    serde_json::to_string(&vec![Segment::Text {
                        text: "普通正文".into()
                    }])
                    .unwrap()
                ],
            )
            .unwrap();

        let transaction = connection.transaction().unwrap();
        assert_eq!(
            super::reproject_current_user_messages(&transaction, "You").unwrap(),
            1
        );
        transaction.commit().unwrap();

        let (body, stored_content): (String, String) = connection
            .query_row(
                "SELECT body, structured_content_json FROM camp_message WHERE id = 'message-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let stored: Vec<Segment> = serde_json::from_str(&stored_content).unwrap();
        assert_eq!(body, "@You 请选择方案");
        assert_eq!(canonical_content_digest(&stored).unwrap(), digest);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM camp_message_fts WHERE camp_message_fts MATCH 'You'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn failed_current_user_reprojection_rolls_back_every_body_and_fts_row() {
        let mut connection = reprojection_fixture();
        let current_only = serde_json::to_string(&vec![
            Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            },
            Segment::Text {
                text: "保留中文".into(),
            },
        ])
        .unwrap();
        let unresolved_member = serde_json::to_string(&vec![
            Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            },
            Segment::MemberMention {
                agent_id: "missing-agent".into(),
            },
        ])
        .unwrap();
        connection
            .execute(
                "INSERT INTO camp_message(id, body, structured_content_json) VALUES ('message-1', '@你 保留中文', ?1)",
                [&current_only],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO camp_message(id, body, structured_content_json) VALUES ('message-2', '@你 @旧名字', ?1)",
                [&unresolved_member],
            )
            .unwrap();

        let transaction = connection.transaction().unwrap();
        assert!(super::reproject_current_user_messages(&transaction, "You").is_err());
        transaction.rollback().unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT body FROM camp_message WHERE id = 'message-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "@你 保留中文"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM camp_message_fts WHERE camp_message_fts MATCH 'You'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    fn reprojection_fixture() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE agent_profile (
                    id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL
                );
                CREATE TABLE camp_message (
                    id TEXT PRIMARY KEY,
                    body TEXT NOT NULL,
                    structured_content_json TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE camp_message_fts USING fts5(
                    body,
                    content='camp_message',
                    content_rowid='rowid'
                );
                CREATE TRIGGER camp_message_fts_insert
                AFTER INSERT ON camp_message BEGIN
                    INSERT INTO camp_message_fts(rowid, body) VALUES (new.rowid, new.body);
                END;
                CREATE TRIGGER camp_message_fts_update
                AFTER UPDATE OF body ON camp_message BEGIN
                    INSERT INTO camp_message_fts(camp_message_fts, rowid, body)
                    VALUES ('delete', old.rowid, old.body);
                    INSERT INTO camp_message_fts(rowid, body) VALUES (new.rowid, new.body);
                END;
                "#,
            )
            .unwrap();
        connection
    }
}
