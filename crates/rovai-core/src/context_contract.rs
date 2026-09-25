use serde_json::{Value, json};

pub const NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION: &str = "native_session_bootstrap_v5";
pub const BOOTSTRAP_FORMATTER_VERSION: i64 = 5;
pub const SESSION_CHARTER_REVISION: i64 = 14;
const NATIVE_BINDING_CHARTER_COMPATIBILITY_REVISION: i64 = 13;
pub const CODEX_SESSION_GUIDANCE_REVISION: i64 = 1;
pub const AGENT_RUN_CONTEXT_FORMATTER_VERSION: i64 = 27;
pub const CONTEXT_MANIFEST_VERSION: i64 = 27;
pub const PUBLIC_CAMP_BATCH_CONTEXT_FORMATTER_VERSION: i64 = 31;
pub const PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION: i64 = 31;

pub(crate) fn native_binding_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION,
        "bootstrapFormatterVersion": BOOTSTRAP_FORMATTER_VERSION,
        "sessionCharterRevision": SESSION_CHARTER_REVISION,
        "agentRunContextFormatterVersion": AGENT_RUN_CONTEXT_FORMATTER_VERSION,
        "contextManifestVersion": CONTEXT_MANIFEST_VERSION,
    })
}

/// Keep the v1.68 context axes in Native Binding identity so the additional
/// history hint and new Charter do not replace an existing Session's Bootstrap.
pub(crate) fn native_binding_compatibility_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": "native_session_bootstrap_v4",
        "bootstrapFormatterVersion": 4,
        "sessionCharterRevision": NATIVE_BINDING_CHARTER_COMPATIBILITY_REVISION,
        "agentRunContextFormatterVersion": 26,
        "contextManifestVersion": 26,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../packages/contracts/fixtures/agent-run-context-v26.json"
        ))
        .expect("shared AgentRun context fixture must be valid JSON")
    }

    #[test]
    fn binding_contract_keeps_compatible_charter_separate_from_new_bootstrap_revision() {
        let fixture = shared_fixture();
        let legacy = json!({
            "nativeSessionBootstrap": fixture["nativeSessionBootstrap"],
            "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
            "sessionCharterRevision": 4,
            "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
            "contextManifestVersion": fixture["contextManifestVersion"],
        });
        let current = native_binding_context_contract();
        let compatibility = native_binding_compatibility_context_contract();
        assert_eq!(SESSION_CHARTER_REVISION, 14);
        assert_eq!(PUBLIC_CAMP_BATCH_CONTEXT_FORMATTER_VERSION, 31);
        assert_eq!(PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION, 31);
        assert_eq!(
            current,
            json!({
                "nativeSessionBootstrap": "native_session_bootstrap_v5",
                "bootstrapFormatterVersion": 5,
                "sessionCharterRevision": SESSION_CHARTER_REVISION,
                "agentRunContextFormatterVersion": 27,
                "contextManifestVersion": 27,
            })
        );
        assert_eq!(
            compatibility,
            json!({
                "nativeSessionBootstrap": fixture["nativeSessionBootstrap"],
                "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
                "sessionCharterRevision": NATIVE_BINDING_CHARTER_COMPATIBILITY_REVISION,
                "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
                "contextManifestVersion": fixture["contextManifestVersion"],
            })
        );
        let mut unversioned_charter = legacy.clone();
        unversioned_charter
            .as_object_mut()
            .unwrap()
            .remove("sessionCharterRevision");
        let new_charter_as_compatibility_revision = json!({
            "nativeSessionBootstrap": fixture["nativeSessionBootstrap"],
            "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
            "sessionCharterRevision": SESSION_CHARTER_REVISION,
            "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
            "contextManifestVersion": fixture["contextManifestVersion"],
        });
        for old_contract in [
            legacy,
            unversioned_charter,
            new_charter_as_compatibility_revision,
        ] {
            assert_ne!(
                crate::command::canonical_json_digest(&compatibility).unwrap(),
                crate::command::canonical_json_digest(&old_contract).unwrap(),
                "incompatible Charter contracts must rotate Adapter Binding compatibility digests"
            );
        }
    }
}
