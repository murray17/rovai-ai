//! Mission descriptions share member identity with messages, never message addressing.
use anyhow::{Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DescriptionSegment {
    Text {
        text: String,
    },
    MemberMention {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
}

pub type DescriptionContent = Vec<DescriptionSegment>;

pub fn text_content(text: &str) -> DescriptionContent {
    if text.is_empty() {
        vec![]
    } else {
        vec![DescriptionSegment::Text { text: text.into() }]
    }
}

pub fn normalize(content: &[DescriptionSegment]) -> Result<DescriptionContent> {
    ensure!(content.len() <= 12000, "mission.description_too_long");
    let mut result = Vec::new();
    for segment in content {
        match segment {
            DescriptionSegment::Text { text } if text.is_empty() => {}
            DescriptionSegment::Text { text } => {
                if let Some(DescriptionSegment::Text { text: previous }) = result.last_mut() {
                    previous.push_str(text);
                } else {
                    result.push(segment.clone());
                }
            }
            DescriptionSegment::MemberMention { agent_id } => {
                ensure!(
                    !agent_id.trim().is_empty() && agent_id.len() <= 200,
                    "mission.invalid_member_mention"
                );
                result.push(segment.clone());
            }
        }
    }
    Ok(result)
}

pub fn member_ids(content: &[DescriptionSegment]) -> Vec<String> {
    let mut ids = Vec::new();
    for segment in content {
        if let DescriptionSegment::MemberMention { agent_id } = segment {
            if !ids.contains(agent_id) {
                ids.push(agent_id.clone());
            }
        }
    }
    ids
}

pub fn render(connection: &Connection, content: &[DescriptionSegment]) -> Result<String> {
    let content = content
        .iter()
        .map(|segment| match segment {
            DescriptionSegment::Text { text } => {
                crate::camp_content::StructuredThreadMessageSegment::Text { text: text.clone() }
            }
            DescriptionSegment::MemberMention { agent_id } => {
                crate::camp_content::StructuredThreadMessageSegment::MemberMention {
                    agent_id: agent_id.clone(),
                }
            }
        })
        .collect::<Vec<_>>();
    let mut names = std::collections::BTreeMap::new();
    for id in crate::camp_content::member_mention_ids(&content) {
        let name: Option<String> = connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .optional()?;
        names.insert(id, name.unwrap_or_else(|| "不可用队员".into()));
    }
    crate::camp_content::render_plain_text(&content, |id| names.get(id).cloned())
}

pub fn load(connection: &Connection, mission_id: &str, legacy: &str) -> Result<DescriptionContent> {
    let json: Option<String> = connection
        .query_row(
            "SELECT content_json FROM mission_description WHERE mission_id=?1",
            [mission_id],
            |r| r.get(0),
        )
        .optional()?;
    json.map(|json| serde_json::from_str(&json).map_err(Into::into))
        .unwrap_or_else(|| Ok(text_content(legacy)))
}

pub fn save(
    connection: &Connection,
    mission_id: &str,
    content: &[DescriptionSegment],
) -> Result<()> {
    connection.execute("INSERT INTO mission_description(mission_id,content_json) VALUES(?1,?2) ON CONFLICT(mission_id) DO UPDATE SET content_json=excluded.content_json", params![mission_id, serde_json::to_string(content)?])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptions_admit_only_text_and_stable_individual_member_ids() {
        for invalid in [
            r#"[{"kind":"all_members_mention"}]"#,
            r#"[{"kind":"skill_mention","skillId":"x","nameAtSend":"s"}]"#,
            r#"[{"kind":"member_mention","agentId":"a","name":"Alice"}]"#,
        ] {
            assert!(serde_json::from_str::<DescriptionContent>(invalid).is_err());
        }
        let content: DescriptionContent = serde_json::from_str(r#"[{"kind":"text","text":"@literal"},{"kind":"text","text":" "},{"kind":"member_mention","agentId":"a"},{"kind":"member_mention","agentId":"a"}]"#).unwrap();
        let normalized = normalize(&content).unwrap();
        assert_eq!(normalized.len(), 3);
        assert_eq!(member_ids(&normalized), vec!["a"]);
        assert_eq!(
            text_content("@literal"),
            vec![DescriptionSegment::Text {
                text: "@literal".into()
            }]
        );
    }
}
