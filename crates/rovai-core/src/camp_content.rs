use std::collections::{BTreeMap, HashSet};

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::command::canonical_json_digest;

pub type StructuredCampMessageContent = Vec<StructuredCampMessageSegment>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StructuredCampMessageSegment {
    Text {
        text: String,
    },
    MemberMention {
        #[serde(rename = "agentProfileId")]
        agent_profile_id: String,
    },
    AllMembersMention,
}

const MAX_CONTENT_SEGMENTS: usize = 4_096;
const MAX_CONTENT_TEXT_BYTES: usize = 1_048_576;

pub fn validate_content(content: &[StructuredCampMessageSegment]) -> Result<()> {
    if content.len() > MAX_CONTENT_SEGMENTS {
        anyhow::bail!("Structured Camp Message Content has too many segments");
    }
    let mut text_bytes = 0_usize;
    for segment in content {
        match segment {
            StructuredCampMessageSegment::Text { text } => {
                text_bytes = text_bytes
                    .checked_add(text.len())
                    .context("Structured Camp Message Content size overflow")?;
            }
            StructuredCampMessageSegment::MemberMention { agent_profile_id } => {
                if agent_profile_id.is_empty()
                    || agent_profile_id.trim() != agent_profile_id
                    || agent_profile_id.len() > 256
                {
                    anyhow::bail!("Member Mention requires a canonical Agent Profile ID");
                }
            }
            StructuredCampMessageSegment::AllMembersMention => {}
        }
    }
    if text_bytes > MAX_CONTENT_TEXT_BYTES {
        anyhow::bail!("Structured Camp Message Content text exceeds 1 MiB");
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
            StructuredCampMessageSegment::MemberMention { agent_profile_id }
                if seen.insert(agent_profile_id.as_str()) =>
            {
                Some(agent_profile_id.clone())
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

pub fn render_plain_text(
    content: &[StructuredCampMessageSegment],
    mut member_name: impl FnMut(&str) -> Option<String>,
) -> Result<String> {
    let mut rendered = String::new();
    for segment in content {
        match segment {
            StructuredCampMessageSegment::Text { text } => rendered.push_str(text),
            StructuredCampMessageSegment::MemberMention { agent_profile_id } => {
                let name = member_name(agent_profile_id)
                    .ok_or_else(|| anyhow!("Member Mention identity does not exist"))?;
                rendered.push('@');
                rendered.push_str(&name);
            }
            StructuredCampMessageSegment::AllMembersMention => rendered.push_str("@所有成员"),
        }
    }
    Ok(rendered)
}

pub fn render_current_plain_text(
    connection: &Connection,
    content: &[StructuredCampMessageSegment],
) -> Result<String> {
    let mut names = BTreeMap::new();
    for agent_profile_id in member_mention_ids(content) {
        let display_name = connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [&agent_profile_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(display_name) = display_name {
            names.insert(agent_profile_id, display_name);
        }
    }
    render_plain_text(content, |agent_profile_id| {
        names.get(agent_profile_id).cloned()
    })
}

pub fn canonical_content_digest(content: &[StructuredCampMessageSegment]) -> Result<String> {
    let value = serde_json::to_value(content)?;
    Ok(format!("sha256:{}", canonical_json_digest(&value)?))
}

#[cfg(test)]
mod tests {
    use super::{
        StructuredCampMessageSegment as Segment, canonical_content_digest, member_mention_ids,
        normalize_content, render_plain_text, validate_content,
    };

    #[test]
    fn normalization_preserves_occurrences_and_merges_only_adjacent_text() {
        let content = normalize_content(vec![
            Segment::Text { text: "让".into() },
            Segment::Text {
                text: "@普通文字 ".into(),
            },
            Segment::MemberMention {
                agent_profile_id: "agent-muwa".into(),
            },
            Segment::MemberMention {
                agent_profile_id: "agent-muwa".into(),
            },
            Segment::AllMembersMention,
            Segment::Text {
                text: String::new(),
            },
        ]);

        assert_eq!(content.len(), 4);
        assert_eq!(member_mention_ids(&content), vec!["agent-muwa"]);
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
                r#"{"kind":"member_mention","agentProfileId":"agent-muwa","name":"木瓦"}"#
            )
            .is_err()
        );
        assert!(serde_json::from_str::<Segment>(r#"{"kind":"markdown","text":"@木瓦"}"#).is_err());
        assert!(
            validate_content(&[Segment::MemberMention {
                agent_profile_id: " agent-muwa".into(),
            }])
            .is_err()
        );
    }

    #[test]
    fn rendering_projects_current_names_without_changing_semantic_digest() {
        let content = normalize_content(vec![
            Segment::MemberMention {
                agent_profile_id: "agent-muwa".into(),
            },
            Segment::Text {
                text: " 请检查 ".into(),
            },
            Segment::AllMembersMention,
        ]);
        let digest = canonical_content_digest(&content).unwrap();

        assert_eq!(
            render_plain_text(&content, |id| {
                (id == "agent-muwa").then(|| "沐瓦".to_string())
            })
            .unwrap(),
            "@沐瓦 请检查 @所有成员"
        );
        assert_eq!(digest, canonical_content_digest(&content).unwrap());
    }
}
