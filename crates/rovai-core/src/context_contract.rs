use serde_json::{Value, json};

pub const NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION: &str = "native_session_bootstrap_v3";
pub const BOOTSTRAP_FORMATTER_VERSION: i64 = 3;
pub const AGENT_RUN_CONTEXT_FORMATTER_VERSION: i64 = 16;
pub const CONTEXT_MANIFEST_VERSION: i64 = 14;

pub(crate) fn native_binding_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION,
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
            "../../../packages/contracts/fixtures/agent-run-context-v16.json"
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
                "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
                "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
                "contextManifestVersion": fixture["contextManifestVersion"],
            })
        );
    }
}
