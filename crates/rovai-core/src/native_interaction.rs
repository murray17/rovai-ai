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
