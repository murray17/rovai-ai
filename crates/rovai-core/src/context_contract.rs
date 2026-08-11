use serde_json::{Value, json};

pub const NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION: &str = "native_session_bootstrap_v3";
// Stable Charter semantics participate in Native Session compatibility independently of layout.
pub const SESSION_CHARTER_CONTRACT_VERSION: i64 = 2;
pub const BOOTSTRAP_FORMATTER_VERSION: i64 = 3;
pub const AGENT_RUN_CONTEXT_FORMATTER_VERSION: i64 = 13;
pub const CONTEXT_MANIFEST_VERSION: i64 = 11;

pub(crate) fn native_binding_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION,
        "sessionCharterContractVersion": SESSION_CHARTER_CONTRACT_VERSION,
        "bootstrapFormatterVersion": BOOTSTRAP_FORMATTER_VERSION,
        "agentRunContextFormatterVersion": AGENT_RUN_CONTEXT_FORMATTER_VERSION,
        "contextManifestVersion": CONTEXT_MANIFEST_VERSION,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../packages/contracts/fixtures/agent-run-context-v13.json"
        ))
        .expect("shared AgentRun context fixture must be valid JSON")
    }

    #[test]
    fn binding_contract_freezes_each_context_axis_version() {
        let fixture = shared_fixture();
        assert_eq!(
            native_binding_context_contract(),
            json!({
                "nativeSessionBootstrap": fixture["nativeSessionBootstrap"],
                "sessionCharterContractVersion": fixture["sessionCharterContractVersion"],
                "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
                "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
                "contextManifestVersion": fixture["contextManifestVersion"],
            })
        );
        assert_eq!(fixture["contextManifestFormatterVersion"], 13);
        assert_eq!(fixture["contextDeliveryProfileVersion"], 3);
        assert_eq!(
            fixture["selfActiveTaskProjection"]["section"],
            "SELF_ACTIVE_TASKS"
        );
        assert_eq!(fixture["selfActiveTaskProjection"]["maxTasks"], 8);
        assert_eq!(
            fixture["selfActiveTaskProjection"]["emptyCandidateProjection"],
            json!({"tasks": []})
        );
        assert_eq!(
            fixture["selfActiveTaskProjection"]["allCandidatesBudgetOmitted"],
            "section_omitted"
        );
        assert_eq!(
            fixture["currentInputSourceShapes"],
            json!({
                "user": {"type": "user"},
                "memberCall": {
                    "type": "member_call",
                    "senderAgentId": "source-agent",
                    "senderName": "Source Agent",
                },
            })
        );
        assert_eq!(
            fixture["truncatedBodyContinuation"]["operation"],
            "camp.read"
        );
        assert_eq!(fixture["omissionRecoveryField"], "navigationHint");
        assert_eq!(
            fixture["contextManifestSharedMessageEvidence"][2],
            "attachmentIdPathDigest"
        );
        assert!(
            fixture["contextManifestOmissionEvidence"]["wholeHistory"]
                .get("messageIds")
                .is_none()
        );
        assert_eq!(
            fixture["contextManifestOmissionEvidence"]["boundedCandidate"]["messageIds"],
            json!(["message-123"])
        );
        assert_eq!(
            fixture["contextManifestRunNoticeEvidence"][0],
            "typedTaskReference"
        );
        assert_eq!(fixture["bootstrapRedeliveryEnvelopeVersion"], 2);
        assert_eq!(fixture["bootstrapRedeliveryFormatterVersion"], 2);
    }
}
