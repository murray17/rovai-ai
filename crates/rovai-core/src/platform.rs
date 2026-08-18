use serde::{Deserialize, Serialize};

/// Closed identity for build targets Rovai can ship.
///
/// This is not host-envelope or Runtime Platform Admission evidence. Callers
/// must evaluate those authorities separately before enabling execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostPlatformKey {
    MacosArm64,
    MacosX64,
    WindowsX64,
}

impl HostPlatformKey {
    pub const ALL: [Self; 3] = [Self::MacosArm64, Self::MacosX64, Self::WindowsX64];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MacosArm64 => "macos-arm64",
            Self::MacosX64 => "macos-x64",
            Self::WindowsX64 => "windows-x64",
        }
    }

    pub const fn current() -> Option<Self> {
        CURRENT_HOST_PLATFORM
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const CURRENT_HOST_PLATFORM: Option<HostPlatformKey> = Some(HostPlatformKey::MacosArm64);

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const CURRENT_HOST_PLATFORM: Option<HostPlatformKey> = Some(HostPlatformKey::MacosX64);

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const CURRENT_HOST_PLATFORM: Option<HostPlatformKey> = Some(HostPlatformKey::WindowsX64);

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64")
)))]
const CURRENT_HOST_PLATFORM: Option<HostPlatformKey> = None;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_platform_keys_serialize_to_the_closed_contract_values() {
        let values = HostPlatformKey::ALL
            .into_iter()
            .map(|platform| serde_json::to_value(platform).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            ["macos-arm64", "macos-x64", "windows-x64"]
                .into_iter()
                .map(serde_json::Value::from)
                .collect::<Vec<_>>()
        );
    }
}
