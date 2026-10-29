use serde::Serialize;

use crate::{agent_profile::AdapterKind, platform::HostPlatformKey};

/// Immutable digest of the current compatibility register revision. The
/// register preserves the existing macOS qualification evidence. Runtime rows
/// that have not completed their own qualification matrix remain excluded from
/// that evidence even when their Adapter identity exists in the Product Catalog.
/// Every register revision receives a new digest.
pub const MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION: &str =
    "sha256:d148203a2ed95b48b59453d16c5b9884907fe7f025408a1403c5ceaa65e5968f";

/// Immutable digest of the sanitized, adapter-scoped Windows x64 evidence.
/// The source qualifies only the Runtime rows named in that evidence; shared
/// Windows process infrastructure cannot promote any other Adapter.
pub const WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION: &str =
    "sha256:fe7e375313d4ba0eeefd0ad69304523414ebd2a0bd72efba8814af3732382054";

pub const GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION: &str =
    "sha256:6a2a96944ca7021f6e4c9c7289cdacde0e2077736a8e8af6bd247ce929e92b1e";
pub const GROK_BUILD_WINDOWS_X64_EVIDENCE_REVISION: &str =
    "sha256:66f80ed14dc6c2903f86af29f8209c6bee6aa72340f09a8b2b52da335242c66b";

pub const GROK_BUILD_MACOS_X64_EVIDENCE_REVISION: &str =
    "sha256:6ce70fc844ef6f18327e5a23396072566fd907c972f273aeccfd987c87398879";

pub const PI_MACOS_ARM64_EVIDENCE_REVISION: &str =
    "sha256:2e2055166f592a5e6fc6db6ac74b5f91315d0d01324f49ad71bd53e69d47b65c";
pub const PI_MACOS_X64_EVIDENCE_REVISION: &str =
    "sha256:5dc85386653d2170979d34b6c32bd3df72707b63deff394174775dd2eca64301";
pub const PI_WINDOWS_X64_EVIDENCE_REVISION: &str =
    "sha256:2dec32c61673793e06c80e9c55fb9631473a418cb773b309f9e075216b3362b8";

pub const MINIMAX_CODE_MACOS_X64_EVIDENCE_REVISION: &str =
    "sha256:906e763f1cace769603565a07a2cef020b3d47a36030312997eec9be7947a703";
pub const MINIMAX_CODE_LINUX_X64_EVIDENCE_REVISION: &str =
    "sha256:f2cb42090a713acf38ca2c98bf374f1c307e0db004a5de2ea6893735075ca06f";
pub const MINIMAX_CODE_WINDOWS_X64_EVIDENCE_REVISION: &str =
    "sha256:8e6eddd306b3e1d145767f0912facefe4cd255f1e5768e3f2369bc900a566426";

pub const DSH_MACOS_ARM64_EVIDENCE_REVISION: &str =
    "sha256:017f63a62ceb33a8c03e881e9ace29b9710cb94006f87a2def529c6a31276394";
pub const DSH_MACOS_X64_EVIDENCE_REVISION: &str =
    "sha256:de01e77a089da05a3b1f129cdeecd9941628a78bd7a5cd65ccb6baf98f7fb9ac";
pub const DSH_LINUX_X64_EVIDENCE_REVISION: &str =
    "sha256:f18337a37996cc0427d23130ae2ce079d4c0946afeb727e9fa4d218a792a48e2";
pub const DSH_WINDOWS_X64_EVIDENCE_REVISION: &str =
    "sha256:39c8037edac69b899a382e569f2b92135e9f48490b16321726b35375dc6444f0";

pub const ZCODE_MACOS_ARM64_EVIDENCE_REVISION: &str =
    "sha256:4c4134d5f68f0633e02d3ade061725d5ff5cfc372d85c345fae10b71ad2badc2";
pub const ZCODE_WINDOWS_X64_EVIDENCE_REVISION: &str =
    "sha256:9c40aa1c943bc3b2e823ea2a9a48ac41441a3924190ec46d493135a46b0b00b0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePlatformAdmissionStatus {
    Enabled,
    Qualified,
    Preview,
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
    /// Ordinary product availability without claiming completed qualification.
    pub fn enabled(runtime_kind: AdapterKind, platform: HostPlatformKey) -> Self {
        Self {
            runtime_kind,
            platform,
            status: RuntimePlatformAdmissionStatus::Enabled,
            reason_code: None,
            evidence_revision: None,
        }
    }

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

    pub fn preview(
        runtime_kind: AdapterKind,
        platform: HostPlatformKey,
        reason_code: RuntimePlatformAdmissionReasonCode,
    ) -> Self {
        Self {
            runtime_kind,
            platform,
            status: RuntimePlatformAdmissionStatus::Preview,
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

    pub const fn allows_runtime_use(&self) -> bool {
        matches!(
            self.status,
            RuntimePlatformAdmissionStatus::Enabled
                | RuntimePlatformAdmissionStatus::Qualified
                | RuntimePlatformAdmissionStatus::Preview
        )
    }

    pub const fn blocker_code(&self) -> Option<&'static str> {
        match self.status {
            RuntimePlatformAdmissionStatus::Enabled
            | RuntimePlatformAdmissionStatus::Qualified
            | RuntimePlatformAdmissionStatus::Preview => None,
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
        for (revision, bytes) in [
            (
                MINIMAX_CODE_WINDOWS_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/windows-x64-minimax-code-v1.json"
                )
                .as_slice(),
            ),
            (
                MINIMAX_CODE_LINUX_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/linux-x64-minimax-code-v1.json"
                )
                .as_slice(),
            ),
            (
                MINIMAX_CODE_MACOS_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/macos-x64-minimax-code-v1.json"
                )
                .as_slice(),
            ),
            (
                DSH_MACOS_ARM64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/macos-arm64-deepseek-harness-v2.json"
                )
                .as_slice(),
            ),
            (
                DSH_MACOS_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/macos-x64-deepseek-harness-v1.json"
                )
                .as_slice(),
            ),
            (
                DSH_LINUX_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/linux-x64-deepseek-harness-v1.json"
                )
                .as_slice(),
            ),
            (
                DSH_WINDOWS_X64_EVIDENCE_REVISION,
                include_bytes!(
                    "../../../qualification/runtime-platform/windows-x64-deepseek-harness-v1.json"
                )
                .as_slice(),
            ),
            (
                ZCODE_MACOS_ARM64_EVIDENCE_REVISION,
                include_bytes!("../../../qualification/runtime-platform/macos-arm64-zcode-v1.json")
                    .as_slice(),
            ),
            (
                ZCODE_WINDOWS_X64_EVIDENCE_REVISION,
                include_bytes!("../../../qualification/runtime-platform/windows-x64-zcode-v1.json")
                    .as_slice(),
            ),
        ] {
            assert_eq!(revision, format!("sha256:{:x}", Sha256::digest(bytes)));
        }
        let zcode_macos: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../qualification/runtime-platform/macos-arm64-zcode-v1.json"
        ))
        .unwrap();
        assert_eq!(
            zcode_macos["qualificationBasis"]["sourceSha256"],
            format!(
                "{:x}",
                Sha256::digest(include_bytes!(
                    "../../../docs/versions/v1.57/evidence/zcode-macos-arm64-2026-09-10.json"
                ))
            )
        );
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
        let grok_windows_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/windows-x64-grok-build-v1.json"
        ));
        assert_eq!(
            GROK_BUILD_WINDOWS_X64_EVIDENCE_REVISION,
            format!("sha256:{grok_windows_digest:x}")
        );
        let grok_x64_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/macos-x64-grok-build-v1.json"
        ));
        assert_eq!(
            GROK_BUILD_MACOS_X64_EVIDENCE_REVISION,
            format!("sha256:{grok_x64_digest:x}")
        );
        let pi_macos_arm64_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/macos-arm64-pi-v1.json"
        ));
        assert_eq!(
            PI_MACOS_ARM64_EVIDENCE_REVISION,
            format!("sha256:{pi_macos_arm64_digest:x}")
        );
        let pi_macos_x64_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/macos-x64-pi-v1.json"
        ));
        assert_eq!(
            PI_MACOS_X64_EVIDENCE_REVISION,
            format!("sha256:{pi_macos_x64_digest:x}")
        );
        let pi_windows_x64_digest = Sha256::digest(include_bytes!(
            "../../../qualification/runtime-platform/windows-x64-pi-v1.json"
        ));
        assert_eq!(
            PI_WINDOWS_X64_EVIDENCE_REVISION,
            format!("sha256:{pi_windows_x64_digest:x}")
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
                if platform == HostPlatformKey::LinuxX64 {
                    let admission = registry.platform_admission(runtime_kind, platform);
                    match runtime_kind {
                        AdapterKind::DeepseekHarness | AdapterKind::MinimaxCodeCli => {
                            assert_eq!(
                                admission.status(),
                                RuntimePlatformAdmissionStatus::Qualified
                            );
                            assert!(admission.allows_runtime_use());
                            assert_eq!(admission.blocker_code(), None);
                            assert_eq!(
                                admission.evidence_revision(),
                                Some(if runtime_kind == AdapterKind::MinimaxCodeCli {
                                    MINIMAX_CODE_LINUX_X64_EVIDENCE_REVISION
                                } else {
                                    DSH_LINUX_X64_EVIDENCE_REVISION
                                })
                            );
                        }
                        AdapterKind::HermesCli => {
                            assert_eq!(admission.status(), RuntimePlatformAdmissionStatus::Enabled);
                            assert!(admission.allows_runtime_use());
                            assert_eq!(admission.blocker_code(), None);
                            assert_eq!(admission.reason_code(), None);
                            assert!(admission.evidence_revision().is_none());
                        }
                        AdapterKind::CursorAgent | AdapterKind::ClineCli => {
                            assert_eq!(
                                admission.status(),
                                RuntimePlatformAdmissionStatus::NotQualified
                            );
                            assert!(!admission.allows_runtime_use());
                            assert_eq!(
                                admission.blocker_code(),
                                Some("runtime_platform_not_qualified")
                            );
                            assert!(admission.evidence_revision().is_none());
                        }
                        _ => {
                            assert_eq!(admission.status(), RuntimePlatformAdmissionStatus::Preview);
                            assert!(admission.allows_runtime_use());
                            assert_eq!(admission.blocker_code(), None);
                            assert!(admission.evidence_revision().is_none());
                        }
                    }
                }
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
            if runtime_kind == AdapterKind::HermesCli {
                assert_eq!(admission.status(), RuntimePlatformAdmissionStatus::Enabled);
                assert!(admission.allows_runtime_use());
                assert!(!admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(admission.evidence_revision(), None);
                assert_eq!(admission.blocker_code(), None);
            } else if runtime_kind == AdapterKind::MinimaxCodeCli {
                assert!(admission.is_qualified());
                assert!(admission.allows_runtime_use());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(MINIMAX_CODE_WINDOWS_X64_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            } else if runtime_kind == AdapterKind::Pi {
                assert_eq!(
                    admission.status(),
                    RuntimePlatformAdmissionStatus::Qualified
                );
                assert!(admission.allows_runtime_use());
                assert!(admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(PI_WINDOWS_X64_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            } else if runtime_kind == AdapterKind::ZcodeApp {
                assert_eq!(
                    admission.status(),
                    RuntimePlatformAdmissionStatus::Qualified
                );
                assert!(admission.allows_runtime_use());
                assert!(admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(ZCODE_WINDOWS_X64_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            } else if runtime_kind == AdapterKind::DeepseekHarness {
                assert_eq!(
                    admission.status(),
                    RuntimePlatformAdmissionStatus::Qualified
                );
                assert!(admission.allows_runtime_use());
                assert!(admission.is_qualified());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(DSH_WINDOWS_X64_EVIDENCE_REVISION)
                );
                assert_eq!(admission.blocker_code(), None);
            } else if runtime_kind == AdapterKind::CommandCodeCli {
                assert_eq!(admission.status(), RuntimePlatformAdmissionStatus::Preview);
                assert!(admission.allows_runtime_use());
                assert!(!admission.is_qualified());
                assert_eq!(
                    admission.reason_code(),
                    Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
                );
                assert_eq!(admission.evidence_revision(), None);
                assert_eq!(admission.blocker_code(), None);
            } else if !matches!(
                runtime_kind,
                AdapterKind::CursorAgent
                    | AdapterKind::ClineCli
                    | AdapterKind::CommandCodeCli
                    | AdapterKind::MinimaxCodeCli
                    | AdapterKind::HermesCli
                    | AdapterKind::ZcodeApp
                    | AdapterKind::DeepseekHarness
            ) {
                assert!(admission.is_qualified());
                assert!(admission.allows_runtime_use());
                assert_eq!(admission.reason_code(), None);
                assert_eq!(
                    admission.evidence_revision(),
                    Some(if runtime_kind == AdapterKind::GrokBuild {
                        GROK_BUILD_WINDOWS_X64_EVIDENCE_REVISION
                    } else {
                        WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION
                    })
                );
                assert_eq!(admission.blocker_code(), None);
            } else {
                assert_eq!(
                    admission.status(),
                    RuntimePlatformAdmissionStatus::NotQualified
                );
                assert!(!admission.allows_runtime_use());
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
        for platform in HostPlatformKey::ALL {
            let hermes = registry.platform_admission(AdapterKind::HermesCli, platform);
            assert_eq!(hermes.status(), RuntimePlatformAdmissionStatus::Enabled);
            assert!(hermes.evidence_revision().is_none());
            assert!(hermes.reason_code().is_none());
            assert!(!hermes.is_qualified());
            assert!(hermes.allows_runtime_use());
            assert_eq!(hermes.blocker_code(), None);
        }

        assert_eq!(
            registry
                .platform_admission(AdapterKind::ZcodeApp, HostPlatformKey::MacosArm64)
                .status(),
            RuntimePlatformAdmissionStatus::Qualified
        );
        assert_eq!(
            registry
                .platform_admission(AdapterKind::ZcodeApp, HostPlatformKey::MacosArm64)
                .evidence_revision(),
            Some(ZCODE_MACOS_ARM64_EVIDENCE_REVISION)
        );
        assert_eq!(
            registry
                .platform_admission(AdapterKind::ZcodeApp, HostPlatformKey::MacosX64)
                .status(),
            RuntimePlatformAdmissionStatus::Preview
        );
        for platform in HostPlatformKey::ALL {
            let mini = registry.platform_admission(AdapterKind::MinimaxCodeCli, platform);
            assert_eq!(
                mini.status(),
                match platform {
                    HostPlatformKey::MacosArm64 => RuntimePlatformAdmissionStatus::Preview,
                    HostPlatformKey::MacosX64
                    | HostPlatformKey::LinuxX64
                    | HostPlatformKey::WindowsX64 => RuntimePlatformAdmissionStatus::Qualified,
                }
            );
            assert_eq!(
                mini.evidence_revision(),
                match platform {
                    HostPlatformKey::MacosX64 => Some(MINIMAX_CODE_MACOS_X64_EVIDENCE_REVISION),
                    HostPlatformKey::LinuxX64 => Some(MINIMAX_CODE_LINUX_X64_EVIDENCE_REVISION),
                    HostPlatformKey::WindowsX64 => Some(MINIMAX_CODE_WINDOWS_X64_EVIDENCE_REVISION),
                    _ => None,
                }
            );
            assert_eq!(
                mini.reason_code(),
                (!matches!(
                    platform,
                    HostPlatformKey::MacosX64
                        | HostPlatformKey::LinuxX64
                        | HostPlatformKey::WindowsX64
                ))
                .then_some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
            );
            let admitted = matches!(
                platform,
                HostPlatformKey::MacosArm64
                    | HostPlatformKey::MacosX64
                    | HostPlatformKey::LinuxX64
                    | HostPlatformKey::WindowsX64
            );
            assert_eq!(mini.allows_runtime_use(), admitted);
            assert_eq!(
                mini.blocker_code(),
                (!admitted).then_some("runtime_platform_not_qualified")
            );
        }
        for runtime_kind in AdapterKind::ALL.into_iter().filter(|kind| {
            !matches!(
                kind,
                AdapterKind::CursorAgent
                    | AdapterKind::ClineCli
                    | AdapterKind::CommandCodeCli
                    | AdapterKind::MinimaxCodeCli
                    | AdapterKind::HermesCli
                    | AdapterKind::Pi
                    | AdapterKind::GrokBuild
                    | AdapterKind::ZcodeApp
                    | AdapterKind::DeepseekHarness
            )
        }) {
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
            let command = registry.platform_admission(AdapterKind::CommandCodeCli, platform);
            assert_eq!(command.status(), RuntimePlatformAdmissionStatus::Preview);
            assert!(command.allows_runtime_use());
            assert!(!command.is_qualified());
            assert_eq!(command.blocker_code(), None);
            assert_eq!(
                command.reason_code(),
                Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
            );
            assert_eq!(command.evidence_revision(), None);

            for kind in [AdapterKind::CursorAgent, AdapterKind::ClineCli] {
                let admission = registry.platform_admission(kind, platform);
                assert_eq!(
                    admission.status(),
                    RuntimePlatformAdmissionStatus::NotQualified
                );
                assert!(!admission.allows_runtime_use());
                assert!(!admission.is_qualified());
                assert_eq!(
                    admission.blocker_code(),
                    Some("runtime_platform_not_qualified")
                );
                assert_eq!(
                    admission.reason_code(),
                    Some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
                );
                assert_eq!(admission.evidence_revision(), None);
            }

            let pi = registry.platform_admission(AdapterKind::Pi, platform);
            assert_eq!(pi.status(), RuntimePlatformAdmissionStatus::Qualified);
            assert!(pi.allows_runtime_use());
            assert!(pi.is_qualified());
            assert_eq!(pi.reason_code(), None);
            assert_eq!(
                pi.evidence_revision(),
                Some(match platform {
                    HostPlatformKey::MacosArm64 => PI_MACOS_ARM64_EVIDENCE_REVISION,
                    HostPlatformKey::MacosX64 => PI_MACOS_X64_EVIDENCE_REVISION,
                    HostPlatformKey::WindowsX64 | HostPlatformKey::LinuxX64 => unreachable!(),
                })
            );
        }
        for platform in HostPlatformKey::ALL {
            let dsh = registry.platform_admission(AdapterKind::DeepseekHarness, platform);
            let expected_revision = match platform {
                HostPlatformKey::MacosArm64 => Some(DSH_MACOS_ARM64_EVIDENCE_REVISION),
                HostPlatformKey::MacosX64 => Some(DSH_MACOS_X64_EVIDENCE_REVISION),
                HostPlatformKey::LinuxX64 => Some(DSH_LINUX_X64_EVIDENCE_REVISION),
                HostPlatformKey::WindowsX64 => Some(DSH_WINDOWS_X64_EVIDENCE_REVISION),
            };
            assert_eq!(
                dsh.status(),
                if expected_revision.is_some() {
                    RuntimePlatformAdmissionStatus::Qualified
                } else {
                    RuntimePlatformAdmissionStatus::NotQualified
                }
            );
            assert_eq!(dsh.evidence_revision(), expected_revision);
            assert_eq!(dsh.is_qualified(), expected_revision.is_some());
            assert_eq!(
                dsh.reason_code(),
                expected_revision
                    .is_none()
                    .then_some(RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing)
            );
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
    }

    #[test]
    fn wire_projection_uses_contract_field_and_enum_names() {
        let registry = AgentRuntimeAdapterRegistry::default();
        for platform in HostPlatformKey::ALL {
            let enabled =
                serde_json::to_value(registry.platform_admission(AdapterKind::HermesCli, platform))
                    .unwrap();
            assert_eq!(enabled["runtimeKind"], "hermes-cli");
            assert_eq!(enabled["platform"], platform.as_str());
            assert_eq!(enabled["status"], "enabled");
            assert!(enabled["reasonCode"].is_null());
            assert!(enabled["evidenceRevision"].is_null());
        }
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

        let pi = serde_json::to_value(
            registry.platform_admission(AdapterKind::Pi, HostPlatformKey::WindowsX64),
        )
        .unwrap();
        assert_eq!(pi["runtimeKind"], "pi");
        assert_eq!(pi["platform"], "windows-x64");
        assert_eq!(pi["status"], "qualified");
        assert!(pi["reasonCode"].is_null());
        assert_eq!(pi["evidenceRevision"], PI_WINDOWS_X64_EVIDENCE_REVISION);

        for (platform, platform_name, revision) in [
            (
                HostPlatformKey::MacosArm64,
                "macos-arm64",
                DSH_MACOS_ARM64_EVIDENCE_REVISION,
            ),
            (
                HostPlatformKey::MacosX64,
                "macos-x64",
                DSH_MACOS_X64_EVIDENCE_REVISION,
            ),
            (
                HostPlatformKey::WindowsX64,
                "windows-x64",
                DSH_WINDOWS_X64_EVIDENCE_REVISION,
            ),
            (
                HostPlatformKey::LinuxX64,
                "linux-x64",
                DSH_LINUX_X64_EVIDENCE_REVISION,
            ),
        ] {
            let dsh = serde_json::to_value(
                registry.platform_admission(AdapterKind::DeepseekHarness, platform),
            )
            .unwrap();
            assert_eq!(dsh["runtimeKind"], "deepseek-harness");
            assert_eq!(dsh["platform"], platform_name);
            assert_eq!(dsh["status"], "qualified");
            assert!(dsh["reasonCode"].is_null());
            assert_eq!(dsh["evidenceRevision"], revision);
        }

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
