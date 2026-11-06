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
