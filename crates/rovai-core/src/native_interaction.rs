//! Runtime-owned user questions. These are answers, never execution permissions.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInteractionView {
    pub id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub questions: Vec<NativeQuestion>,
    pub can_skip: bool,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub status: NativeInteractionStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeQuestion {
    pub id: String,
    pub kind: NativeQuestionKind,
    pub title: String,
    pub description: Option<String>,
    pub options: Vec<NativeQuestionOption>,
    pub placeholder: Option<String>,
    pub prefill: Option<String>,
    pub multiline: bool,
}

fn preview_text(text: &str) -> String {
    let mut chars = text.chars();
    let mut preview: String = chars.by_ref().take(300).collect();
    if chars.next().is_some() {
        preview.push_str("……（仅展示部分内容）");
    }
    preview
}

impl NativeQuestion {
    /// Bounded channel display text, separate from the original native content.
    pub(crate) fn display_preview(&self) -> String {
        preview_text(&match &self.description {
            Some(description) => format!("{}\n\n{description}", self.title),
            None => self.title.clone(),
        })
    }

    pub(crate) fn answer_preview(&self, answer: &NativeInteractionAnswer) -> Option<String> {
        let text = match answer {
            NativeInteractionAnswer::Confirm { confirmed } => {
                format!("回答：{}", if *confirmed { "是" } else { "否" })
            }
            NativeInteractionAnswer::Select { option_id } => {
                let option = self.options.iter().find(|option| option.id == *option_id)?;
                format!("已选择：{}", option.label)
            }
            NativeInteractionAnswer::Input { value } if value.is_empty() => "已提交空文本".into(),
            NativeInteractionAnswer::Input { value } => format!("回答：\n{value}"),
            NativeInteractionAnswer::Skip => return None,
        };
        Some(preview_text(&text))
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeQuestionKind {
    Confirm,
    Select,
    Input,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeQuestionOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeInteractionStatus {
    Pending,
    Sent,
    Skipped,
    Expired,
    Unavailable,
    Unknown,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NativeInteractionAnswer {
    Confirm {
        confirmed: bool,
    },
    Select {
        #[serde(rename = "optionId")]
        option_id: String,
    },
    Input {
        value: String,
    },
    Skip,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondNativeInteraction {
    pub command_id: String,
    pub thread_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub interaction_id: String,
    pub answer: NativeInteractionAnswer,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInteractionResult {
    pub status: NativeInteractionStatus,
    pub already_handled: bool,
}

/// Current Runtime attention only: no question/answer text, notification rows or restored waits.
pub fn notification_source(
    connection: &rusqlite::Connection,
    thread_id: &str,
    question: &NativeInteractionView,
) -> anyhow::Result<Option<serde_json::Value>> {
    use rusqlite::{OptionalExtension, params};
    use serde_json::json;
    if question.status != NativeInteractionStatus::Pending
        || question
            .expires_at
            .is_some_and(|end| end <= chrono::Utc::now().timestamp_millis())
    {
        return Ok(None);
    }
    Ok(connection.query_row(
        "SELECT camp.title, profile.display_name, owner.agent_id,
                run.destination_conversation_id, channel.provider, channel.conversation_kind
         FROM agent_run AS run JOIN conversation AS owner ON owner.id=run.conversation_id
         LEFT JOIN camp_turn AS turn ON turn.id=run.camp_turn_id
         JOIN camp ON camp.id=COALESCE(run.camp_id,turn.camp_id)
         JOIN agent_profile AS profile ON profile.id=owner.agent_id AND profile.profile_status='present'
         JOIN camp_member AS member ON member.camp_id=camp.id AND member.agent_id=owner.agent_id
           AND member.status='active' AND member.leave_requested_at IS NULL
         LEFT JOIN conversation AS private ON private.id=run.destination_conversation_id
           AND private.kind='single_chat' AND private.camp_id=camp.id AND private.agent_id=owner.agent_id
         LEFT JOIN channel_conversation_binding AS binding ON binding.camp_id=camp.id
         LEFT JOIN channel_conversation AS channel ON channel.id=binding.channel_conversation_id
         WHERE run.id=?1 AND run.execution_epoch=?2 AND camp.id=?3
           AND run.status IN ('running','waiting') AND run.cancel_requested_at IS NULL
           AND ((run.invocation_kind<>'single_chat' AND run.destination_conversation_id IS NULL)
             OR (run.invocation_kind='single_chat' AND private.id IS NOT NULL AND private.ended_at IS NULL))",
        params![question.agent_run_id, question.execution_epoch, thread_id],
        |row| {
            let name: String = row.get(1)?;
            let conversation_id: Option<String> = row.get(3)?;
            let agent_id: String = row.get(2)?;
            Ok(json!({
                "id":question.id, "agentRunId":question.agent_run_id,
                "executionEpoch":question.execution_epoch, "agentDisplayName":name,
                "thread":{"id":thread_id,"title":row.get::<_,String>(0)?,
                    "channelSource":crate::read_model::camp_channel_source_from_row(row,4)?},
                "singleChat":conversation_id.map(|id| json!({"conversationId":id,
                    "agentId":agent_id,
                    "agentDisplayName":name,"agentRunId":question.agent_run_id})),
                "createdAt":question.created_at,"expiresAt":question.expires_at
            }))
        },
    ).optional()?)
}
