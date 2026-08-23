use serde::Serialize;

use crate::{agent_profile::AdapterKind, platform::HostPlatformKey};

/// Immutable digest of the current compatibility register revision. The
/// register preserves the existing macOS qualification evidence. Runtime rows
/// that have not completed their own qualification matrix remain excluded from
/// that evidence even when their Adapter identity exists in the Product Catalog.
/// Every register revision receives a new digest.
pub const MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION: &str =
    "sha256:0e229d06b0af72a0a1d867bd87372aa7792e3a70e5ab8f51657aabb6c122fbe2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePlatformAdmissionStatus {
    Qualified,
    NotQualified,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RuntimePlatformAdmissionReasonCode {
    #[serde(rename = "runtime_platform.qualification_evidence_missing")]
    QualificationEvidenceMissing,
    #[serde(rename = "runtime_platform.adapter_not_implemented")]
    AdapterNotImplemented,
    #[serde(rename = "runtime_platform.upstream_unsupported")]
    UpstreamUnsupported,
    #[serde(rename = "runtime_platform.authentication_unqualified")]
    AuthenticationUnqualified,
    #[serde(rename = "runtime_platform.session_unqualified")]
    SessionUnqualified,
    #[serde(rename = "runtime_platform.builtin_transport_unqualified")]
    BuiltinTransportUnqualified,
    #[serde(rename = "runtime_platform.lifecycle_unqualified")]
    LifecycleUnqualified,
    #[serde(rename = "runtime_platform.filesystem_semantics_unqualified")]
    FilesystemSemanticsUnqualified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlatformAdmission {
    runtime_kind: AdapterKind,
    platform: HostPlatformKey,
    status: RuntimePlatformAdmissionStatus,
    reason_code: Option<RuntimePlatformAdmissionReasonCode>,
    evidence_revision: Option<String>,
}

impl RuntimePlatformAdmission {
    pub fn qualified(
        runtime_kind: AdapterKind,
        platform: HostPlatformKey,
        evidence_revision: impl Into<String>,
    ) -> Self {
        let evidence_revision = evidence_revision.into();
        debug_assert!(!evidence_revision.trim().is_empty());
        Self {
            runtime_kind,
            platform,
            status: RuntimePlatformAdmissionStatus::Qualified,
            reason_code: None,
            evidence_revision: Some(evidence_revision),
        }
    }

    pub fn not_qualified(
        runtime_kind: AdapterKind,
        platform: HostPlatformKey,
        reason_code: RuntimePlatformAdmissionReasonCode,
    ) -> Self {
        Self {
            runtime_kind,
            platform,
            status: RuntimePlatformAdmissionStatus::NotQualified,
            reason_code: Some(reason_code),
            evidence_revision: None,
        }
    }

    pub fn unsupported(
        runtime_kind: AdapterKind,
        platform: HostPlatformKey,
        reason_code: RuntimePlatformAdmissionReasonCode,
    ) -> Self {
        Self {
            runtime_kind,
            platform,
            status: RuntimePlatformAdmissionStatus::Unsupported,
            reason_code: Some(reason_code),
            evidence_revision: None,
        }
    }

    pub const fn runtime_kind(&self) -> AdapterKind {
        self.runtime_kind
    }

    pub const fn platform(&self) -> HostPlatformKey {
        self.platform
    }

    pub const fn status(&self) -> RuntimePlatformAdmissionStatus {
        self.status
    }

    pub const fn reason_code(&self) -> Option<RuntimePlatformAdmissionReasonCode> {
        self.reason_code
    }

    pub fn evidence_revision(&self) -> Option<&str> {
        self.evidence_revision.as_deref()
    }

    pub const fn is_qualified(&self) -> bool {
        matches!(self.status, RuntimePlatformAdmissionStatus::Qualified)
    }

    pub const fn blocker_code(&self) -> Option<&'static str> {
        match self.status {
            RuntimePlatformAdmissionStatus::Qualified => None,
            RuntimePlatformAdmissionStatus::NotQualified => Some("runtime_platform_not_qualified"),
            RuntimePlatformAdmissionStatus::Unsupported => Some("runtime_platform_unsupported"),
        }
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::agent_runtime_adapter::AgentRuntimeAdapterRegistry;

    #[test]
    fn compatibility_evidence_revision_binds_the_frozen_register_bytes() {
        let digest = Sha256::digest(include_bytes!("../../../docs/runtime-compatibility.md"));
        assert_eq!(
            MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
            format!("sha256:{digest:x}")
        );
    }

    #[test]
    fn registry_projects_the_complete_closed_matrix() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let matrix = registry.platform_admission_matrix();

        assert_eq!(
            matrix.len(),
            AdapterKind::ALL.len() * HostPlatformKey::ALL.len()
        );
        for runtime_kind in AdapterKind::ALL {
            for platform in HostPlatformKey::ALL {
                assert_eq!(
                    matrix
                        .iter()
                        .filter(|row| {
                            row.runtime_kind() == runtime_kind && row.platform() == platform
                        })
                        .count(),
                    1
                );
            }
        }
    }

    #[test]
    fn windows_catalog_is_not_qualified_and_has_no_machine_evidence() {
        let registry = AgentRuntimeAdapterRegistry::default();

        for runtime_kind in AdapterKind::ALL {
            let admission = registry.platform_admission(runtime_kind, HostPlatformKey::WindowsX64);
            assert_eq!(
                admission.status(),
                RuntimePlatformAdmissionStatus::NotQualified
            );
            assert_eq!(
                admission.reason_code(),
                Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
            );
            assert_eq!(admission.evidence_revision(), None);
            assert_eq!(
                admission.blocker_code(),
                Some("runtime_platform_not_qualified")
            );
        }
    }

    #[test]
    fn existing_macos_catalog_rows_remain_qualified_with_digest_bound_evidence() {
        let registry = AgentRuntimeAdapterRegistry::default();

        for runtime_kind in AdapterKind::ALL
            .into_iter()
            .filter(|kind| !matches!(kind, AdapterKind::CursorAgent | AdapterKind::KimiCodeCli))
        {
            for platform in [HostPlatformKey::MacosArm64, HostPlatformKey::MacosX64] {
                let admission = registry.platform_admission(runtime_kind, platform);
                assert!(admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            }
        }
        for platform in [HostPlatformKey::MacosArm64, HostPlatformKey::MacosX64] {
            let admission = registry.platform_admission(AdapterKind::CursorAgent, platform);
            assert_eq!(
                admission.status(),
                RuntimePlatformAdmissionStatus::NotQualified
            );
            assert_eq!(
                admission.reason_code(),
                Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
            );
            assert_eq!(admission.evidence_revision(), None);
        }
        let kimi_arm =
            registry.platform_admission(AdapterKind::KimiCodeCli, HostPlatformKey::MacosArm64);
        assert!(kimi_arm.is_qualified());
        assert_eq!(kimi_arm.reason_code(), None);
        assert_eq!(
            kimi_arm.evidence_revision(),
            Some(MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION)
        );
        let kimi_x64 =
            registry.platform_admission(AdapterKind::KimiCodeCli, HostPlatformKey::MacosX64);
        assert_eq!(
            kimi_x64.status(),
            RuntimePlatformAdmissionStatus::NotQualified
        );
    }

    #[test]
    fn wire_projection_uses_contract_field_and_enum_names() {
        let value = serde_json::to_value(
            AgentRuntimeAdapterRegistry::default()
                .platform_admission(AdapterKind::CodexCli, HostPlatformKey::WindowsX64),
        )
        .unwrap();
        assert_eq!(value["runtimeKind"], "codex-cli");
        assert_eq!(value["platform"], "windows-x64");
        assert_eq!(value["status"], "not_qualified");
        assert_eq!(
            value["reasonCode"],
            "runtime_platform.qualification_evidence_missing"
        );
        assert!(value["evidenceRevision"].is_null());
    }
}
