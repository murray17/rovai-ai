use serde_json::{Value, json};

pub const NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION: &str = "native_session_bootstrap_v2";
pub const BOOTSTRAP_FORMATTER_VERSION: i64 = 2;
pub const AGENT_RUN_CONTEXT_FORMATTER_VERSION: i64 = 7;
pub const CONTEXT_MANIFEST_VERSION: i64 = 6;

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

    #[test]
    fn binding_contract_freezes_each_context_axis_version() {
        assert_eq!(
            native_binding_context_contract(),
            json!({
                "nativeSessionBootstrap": "native_session_bootstrap_v2",
                "bootstrapFormatterVersion": 2,
                "agentRunContextFormatterVersion": 7,
                "contextManifestVersion": 6,
            })
        );
    }
}
