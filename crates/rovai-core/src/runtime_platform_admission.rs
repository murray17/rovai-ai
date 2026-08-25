use serde::Serialize;

use crate::{agent_profile::AdapterKind, platform::HostPlatformKey};

/// Immutable digest of the current compatibility register revision. The
/// register preserves the existing macOS qualification evidence. Runtime rows
/// that have not completed their own qualification matrix remain excluded from
/// that evidence even when their Adapter identity exists in the Product Catalog.
/// Every register revision receives a new digest.
pub const MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION: &str =
    "sha256:cb02bfec2598f09a2c2460b1a37abfacd9e7ff2beaa48d084ca03f6d340a1625";

/// Immutable digest of the sanitized, adapter-scoped Windows x64 evidence.
/// The source qualifies only the Runtime rows named in that evidence; shared
/// Windows process infrastructure cannot promote any other Adapter.
pub const WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION: &str =
    "sha256:fe7e375313d4ba0eeefd0ad69304523414ebd2a0bd72efba8814af3732382054";

pub const GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION: &str =
    "sha256:6a2a96944ca7021f6e4c9c7289cdacde0e2077736a8e8af6bd247ce929e92b1e";

pub const GROK_BUILD_MACOS_X64_EVIDENCE_REVISION: &str =
    "sha256:6ce70fc844ef6f18327e5a23396072566fd907c972f273aeccfd987c87398879";

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
    fn platform_evidence_revisions_bind_their_frozen_source_bytes() {
        let macos_digest = Sha256::digest(include_bytes!("../../../docs/runtime-compatibility.md"));
        assert_eq!(
            MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
            format!("sha256:{macos_digest:x}")
        );
        let windows_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/windows-x64-v1.json"
        ));
        assert_eq!(
            WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
            format!("sha256:{windows_digest:x}")
        );
        let grok_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/macos-arm64-grok-build-v2.json"
        ));
        assert_eq!(
            GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION,
            format!("sha256:{grok_digest:x}")
        );
        let grok_x64_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/macos-x64-grok-build-v1.json"
        ));
        assert_eq!(
            GROK_BUILD_MACOS_X64_EVIDENCE_REVISION,
            format!("sha256:{grok_x64_digest:x}")
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
    fn windows_catalog_qualifies_only_adapter_scoped_frozen_evidence() {
        let registry = AgentRuntimeAdapterRegistry::default();

        for runtime_kind in AdapterKind::ALL {
            let admission = registry.platform_admission(runtime_kind, HostPlatformKey::WindowsX64);
            if !matches!(
                runtime_kind,
                AdapterKind::CursorAgent | AdapterKind::GrokBuild
            ) {
                assert!(admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            } else {
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
    }

    #[test]
    fn macos_catalog_qualifies_each_runtime_only_with_its_bound_evidence() {
        let registry = AgentRuntimeAdapterRegistry::default();

        for runtime_kind in AdapterKind::ALL
            .into_iter()
            .filter(|kind| !matches!(kind, AdapterKind::CursorAgent | AdapterKind::GrokBuild))
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
        let grok_arm =
            registry.platform_admission(AdapterKind::GrokBuild, HostPlatformKey::MacosArm64);
        assert!(grok_arm.is_qualified());
        assert_eq!(
            grok_arm.evidence_revision(),
            Some(GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION)
        );
        let grok_x64 =
            registry.platform_admission(AdapterKind::GrokBuild, HostPlatformKey::MacosX64);
        assert!(grok_x64.is_qualified());
        assert_eq!(
            grok_x64.evidence_revision(),
            Some(GROK_BUILD_MACOS_X64_EVIDENCE_REVISION)
        );
        let grok_windows =
            registry.platform_admission(AdapterKind::GrokBuild, HostPlatformKey::WindowsX64);
        assert_eq!(
            grok_windows.status(),
            RuntimePlatformAdmissionStatus::NotQualified
        );
        assert_eq!(
            grok_windows.reason_code(),
            Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
        );
    }

    #[test]
    fn wire_projection_uses_contract_field_and_enum_names() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let blocked = serde_json::to_value(
            registry.platform_admission(AdapterKind::CursorAgent, HostPlatformKey::WindowsX64),
        )
        .unwrap();
        assert_eq!(blocked["runtimeKind"], "cursor-agent");
        assert_eq!(blocked["platform"], "windows-x64");
        assert_eq!(blocked["status"], "not_qualified");
        assert_eq!(
            blocked["reasonCode"],
            "runtime_platform.qualification_evidence_missing"
        );
        assert!(blocked["evidenceRevision"].is_null());

        let qualified = serde_json::to_value(
            registry.platform_admission(AdapterKind::CodexCli, HostPlatformKey::WindowsX64),
        )
        .unwrap();
        assert_eq!(qualified["runtimeKind"], "codex-cli");
        assert_eq!(qualified["platform"], "windows-x64");
        assert_eq!(qualified["status"], "qualified");
        assert!(qualified["reasonCode"].is_null());
        assert_eq!(
            qualified["evidenceRevision"],
            WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION
        );
    }
}
