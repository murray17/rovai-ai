use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RUNTIME_COMPACTION_DISPLAY_EVENT: &str = "runtime.compaction.display";
pub const RUNTIME_COMPACTION_DISPLAY_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCompactionDisplayPhase {
    Imminent,
    Started,
    Completed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCompactionCompletionEvidence {
    NativeTerminal,
    PreCompactionOnly,
    PostCompactionBoundary,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompactionTokenSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_percent: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompactionMessageSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compacted: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompactionDisplayEvent {
    pub schema_version: u32,
    pub compaction_id: String,
    pub adapter_kind: String,
    pub phase: RuntimeCompactionDisplayPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_evidence: Option<RuntimeCompactionCompletionEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<RuntimeCompactionTokenSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages: Option<RuntimeCompactionMessageSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_text: Option<String>,
}

impl RuntimeCompactionDisplayEvent {
    pub fn new(
        compaction_id: impl Into<String>,
        adapter_kind: impl Into<String>,
        phase: RuntimeCompactionDisplayPhase,
    ) -> Option<Self> {
        let compaction_id = compaction_id.into();
        let adapter_kind = adapter_kind.into();
        if compaction_id.trim().is_empty() || adapter_kind.trim().is_empty() {
            return None;
        }
        Some(Self {
            schema_version: RUNTIME_COMPACTION_DISPLAY_SCHEMA_VERSION,
            compaction_id,
            adapter_kind,
            phase,
            completion_evidence: None,
            tokens: None,
            messages: None,
            elapsed_ms: None,
            summary_text: None,
        })
    }

    pub fn set_summary_text(&mut self, summary_text: Option<&str>) {
        self.summary_text = summary_text
            .map(str::trim)
            .filter(|summary| !summary.is_empty())
            .map(str::to_string);
    }

    pub fn payload(&self) -> Value {
        serde_json::to_value(self).expect("Runtime Compaction Display Event must serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_event_keeps_only_explicit_non_empty_summary_content() {
        let mut event = RuntimeCompactionDisplayEvent::new(
            "compact-1",
            "codex-cli",
            RuntimeCompactionDisplayPhase::Completed,
        )
        .unwrap();
        event.set_summary_text(Some("  preserved summary\n"));
        assert_eq!(event.summary_text.as_deref(), Some("preserved summary"));
        event.set_summary_text(Some(" \n\t"));
        assert!(event.summary_text.is_none());
    }
}
