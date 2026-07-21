use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{
    agent_profile::{
        AdapterCapabilitySnapshot, AdapterKind, AdapterPermissionConfig, ModelDescriptor,
        ModelOptionDescriptor, PermissionOptionDescriptor, RuntimeOptionScope, ValueChoice,
    },
    command::canonical_json_digest,
};

/// The stable, built-in boundary between Lumen runtime configuration and a
/// provider-specific protocol implementation. v0.03 intentionally keeps this
/// registry compile-time: it is not a plugin ABI.
pub trait AgentRuntimeAdapter {
    fn kind(&self) -> AdapterKind;

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection>;
}

pub fn executable_fingerprint(path: &Path) -> Result<String> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut file = File::open(&canonical)
        .with_context(|| format!("failed to open {}", canonical.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

#[derive(Debug, Clone, Copy)]
pub struct AdapterRuntimeResolutionInput<'a> {
    pub installation_id: &'a str,
    pub executable_path: &'a str,
    pub auth_scope: &'a str,
    pub executable_fingerprint: &'a str,
    pub protocols: &'a [String],
    pub permissions: &'a AdapterPermissionConfig,
    pub permission_descriptors: &'a [PermissionOptionDescriptor],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterRuntimeProjection {
    pub protocol_version: String,
    pub binding_compatibility_digest: String,
    pub host_config_digest: String,
}

#[derive(Debug, Clone)]
pub struct CodexProbeObservation {
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub capabilities: Vec<String>,
    pub raw_model_catalog: Option<Value>,
    pub attempted_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Default)]
pub struct AgentRuntimeAdapterRegistry {
    codex_cli: CodexCliAdapterPolicy,
}

impl AgentRuntimeAdapterRegistry {
    pub fn resolve_runtime(
        &self,
        kind: AdapterKind,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        match kind {
            AdapterKind::CodexCli => self.codex_cli.resolve_runtime(input),
            AdapterKind::OpencodeCli | AdapterKind::CopilotCli | AdapterKind::AgyCli => {
                anyhow::bail!("{} execution is not implemented", kind.as_str())
            }
        }
    }

    pub fn codex_capability_snapshot(
        &self,
        observation: CodexProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        self.codex_cli.capability_snapshot(observation)
    }
}

#[derive(Debug, Default)]
struct CodexCliAdapterPolicy;

impl CodexCliAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: CodexProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        let ready = observation.probe_status == "ready";
        let models = if ready {
            codex_models(
                observation
                    .raw_model_catalog
                    .as_ref()
                    .context("ready Codex probe did not return model/list")?,
            )?
        } else {
            Vec::new()
        };
        let mut capabilities = observation.capabilities;
        for capability in ["model.list", "structured_permission_request"] {
            if ready && !capabilities.iter().any(|value| value == capability) {
                capabilities.push(capability.to_string());
            }
        }
        capabilities.sort();
        capabilities.dedup();
        Ok(AdapterCapabilitySnapshot {
            reported_version: observation.reported_version,
            executable_fingerprint: observation.executable_fingerprint,
            authentication_status: observation.authentication_status,
            probe_status: observation.probe_status,
            permission_schema_version: 1,
            capabilities,
            protocols: if ready {
                vec!["codex-app-server-v2".to_string()]
            } else {
                Vec::new()
            },
            models,
            permission_options: ready.then(codex_permission_options).unwrap_or_default(),
            observed_at: ready.then(|| observation.attempted_at.clone()),
            last_attempted_at: observation.attempted_at.clone(),
            stale_at: (!ready).then_some(observation.attempted_at),
            last_error: observation.last_error,
        })
    }
}

fn codex_models(catalog: &Value) -> Result<Vec<ModelDescriptor>> {
    let values = catalog
        .get("data")
        .and_then(Value::as_array)
        .context("Codex model/list catalog did not include data")?;
    values
        .iter()
        .map(|value| {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .context("Codex model is missing id")?;
            let display_name = value
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(id);
            let efforts = value
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let options = if efforts.is_empty() {
                Vec::new()
            } else {
                vec![ModelOptionDescriptor {
                    key: "reasoning_effort".to_string(),
                    label: "Reasoning effort".to_string(),
                    value_type: "enum".to_string(),
                    values: efforts
                        .iter()
                        .filter_map(|effort| {
                            let value = effort.get("reasoningEffort")?.as_str()?;
                            Some(ValueChoice {
                                value: value.to_string(),
                                label: humanize_identifier(value),
                            })
                        })
                        .collect(),
                    default_value: value
                        .get("defaultReasoningEffort")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    scope: RuntimeOptionScope::Run,
                }]
            };
            Ok(ModelDescriptor {
                id: id.to_string(),
                display_name: display_name.to_string(),
                is_default: value
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                hidden: value
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                deprecated: value
                    .get("upgrade")
                    .is_some_and(|upgrade| !upgrade.is_null()),
                options,
            })
        })
        .collect()
}

fn humanize_identifier(value: &str) -> String {
    let mut characters = value.replace(['_', '-'], " ").chars().collect::<Vec<_>>();
    if let Some(first) = characters.first_mut() {
        first.make_ascii_uppercase();
    }
    characters.into_iter().collect()
}

fn codex_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![
        PermissionOptionDescriptor {
            key: "sandbox_mode".to_string(),
            label: "sandbox_mode".to_string(),
            description: "Codex filesystem sandbox mode for this member's Native Session."
                .to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("read-only", "read-only"),
                choice("workspace-write", "workspace-write"),
                choice("danger-full-access", "danger-full-access (no sandbox)"),
            ],
            recommended_value: json!("workspace-write"),
            scope: RuntimeOptionScope::Session,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "approval_policy".to_string(),
            label: "approval_policy".to_string(),
            description:
                "Codex approval policy. on-request keeps structured requests in Lumen Approval."
                    .to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("untrusted", "untrusted"),
                choice("on-request", "on-request"),
                choice("never", "never (no approval prompts)"),
            ],
            recommended_value: json!("on-request"),
            scope: RuntimeOptionScope::Session,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
    ]
}

fn choice(value: &str, label: &str) -> ValueChoice {
    ValueChoice {
        value: value.to_string(),
        label: label.to_string(),
    }
}

impl AgentRuntimeAdapter for CodexCliAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::CodexCli
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        if input.permissions.adapter_kind != self.kind() {
            anyhow::bail!("Codex permission configuration belongs to another Adapter");
        }
        let protocol_version = input
            .protocols
            .iter()
            .find(|protocol| {
                matches!(
                    protocol.as_str(),
                    "codex-app-server-v2" | "codex-app-server"
                )
            })
            .context("Codex installation does not advertise App Server support")?
            .clone();
        let permission_values = input
            .permissions
            .values
            .as_object()
            .context("Codex permission configuration must be an object")?;
        let descriptors = input
            .permission_descriptors
            .iter()
            .map(|descriptor| (descriptor.key.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();

        let scoped_values = |scope: RuntimeOptionScope| -> Result<Value> {
            let mut values = serde_json::Map::new();
            for (key, value) in permission_values {
                let descriptor = descriptors
                    .get(key.as_str())
                    .with_context(|| format!("missing Codex permission descriptor for {key}"))?;
                if descriptor.scope == scope {
                    values.insert(key.clone(), value.clone());
                }
            }
            Ok(Value::Object(values))
        };

        // Codex model and reasoning effort are Turn-scoped. They deliberately
        // stay out of this digest so changing them does not replace a healthy
        // Native Session.
        let binding_compatibility_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "sessionPermissions": scoped_values(RuntimeOptionScope::Session)?,
        }))?;
        let host_config_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "executablePath": input.executable_path,
            "executableFingerprint": input.executable_fingerprint,
            "authScope": input.auth_scope,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "hostPermissions": scoped_values(RuntimeOptionScope::Host)?,
        }))?;
        Ok(AdapterRuntimeProjection {
            protocol_version,
            binding_compatibility_digest,
            host_config_digest,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_profile::{PermissionOptionDescriptor, ValueChoice};

    fn descriptor(key: &str, scope: RuntimeOptionScope) -> PermissionOptionDescriptor {
        PermissionOptionDescriptor {
            key: key.to_string(),
            label: key.to_string(),
            description: String::new(),
            value_type: "enum".to_string(),
            choices: vec![ValueChoice {
                value: "value".to_string(),
                label: "Value".to_string(),
            }],
            recommended_value: json!("value"),
            scope,
            risk: "medium".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        }
    }

    #[test]
    fn run_options_do_not_change_codex_binding_compatibility() {
        let adapter = CodexCliAdapterPolicy;
        let descriptors = vec![
            descriptor("sandbox_mode", RuntimeOptionScope::Session),
            descriptor("host_mode", RuntimeOptionScope::Host),
        ];
        let permissions = AdapterPermissionConfig {
            adapter_kind: AdapterKind::CodexCli,
            schema_version: 1,
            values: json!({"sandbox_mode": "value", "host_mode": "value"}),
        };
        let protocols = vec!["codex-app-server-v2".to_string()];
        let resolved = adapter
            .resolve_runtime(AdapterRuntimeResolutionInput {
                installation_id: "codex-local",
                executable_path: "/opt/bin/codex",
                auth_scope: "local-user",
                executable_fingerprint: "sha256:one",
                protocols: &protocols,
                permissions: &permissions,
                permission_descriptors: &descriptors,
            })
            .expect("runtime should resolve");
        let upgraded_host = adapter
            .resolve_runtime(AdapterRuntimeResolutionInput {
                executable_fingerprint: "sha256:two",
                installation_id: "codex-local",
                executable_path: "/opt/bin/codex",
                auth_scope: "local-user",
                protocols: &protocols,
                permissions: &permissions,
                permission_descriptors: &descriptors,
            })
            .expect("runtime should resolve");
        assert_eq!(
            resolved.binding_compatibility_digest,
            upgraded_host.binding_compatibility_digest
        );
        assert_ne!(
            resolved.host_config_digest,
            upgraded_host.host_config_digest
        );
    }

    #[test]
    fn codex_model_list_becomes_a_dynamic_model_and_permission_catalog() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .codex_capability_snapshot(CodexProbeObservation {
                reported_version: Some("codex-cli test".to_string()),
                executable_fingerprint: Some("sha256:test".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["app_server.initialize".to_string()],
                raw_model_catalog: Some(json!({
                    "data": [{
                        "id": "gpt-current",
                        "displayName": "GPT Current",
                        "isDefault": true,
                        "hidden": false,
                        "upgrade": null,
                        "defaultReasoningEffort": "high",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort": "high", "description": "Deep reasoning"},
                            {"reasoningEffort": "xhigh", "description": "Deeper reasoning"}
                        ]
                    }]
                })),
                attempted_at: "2026-07-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Codex catalog should map");

        assert_eq!(snapshot.models[0].id, "gpt-current");
        assert_eq!(
            snapshot.models[0].options[0].default_value.as_deref(),
            Some("high")
        );
        assert!(
            snapshot.permission_options[0]
                .choices
                .iter()
                .any(|choice| choice.value == "danger-full-access")
        );
        assert!(
            snapshot.permission_options[1]
                .choices
                .iter()
                .any(|choice| choice.value == "never")
        );
    }
}
