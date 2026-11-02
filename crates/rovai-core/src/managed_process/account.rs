use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// Non-secret deployment settings. Passwords are only read by the Windows
/// backend from an owner-bound ConvertFrom-SecureString DPAPI file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowsAccountLaunch {
    pub username: String,
    pub domain: String,
    pub dpapi_path: PathBuf,
    pub profile_root: PathBuf,
}

impl WindowsAccountLaunch {
    pub fn for_isolation(isolation: &str) -> Result<Option<Self>> {
        match isolation {
            "shared" | "git_worktree" => Ok(None),
            "windows_account" => {
                if !cfg!(windows) {
                    bail!("managed_process.account_unsupported: windows_account requires Windows");
                }
                let path = env::var_os("ROVAI_WINDOWS_ACCOUNT_CONFIG").context(
                    "managed_process.account_config_required: set ROVAI_WINDOWS_ACCOUNT_CONFIG",
                )?;
                let config: Self = serde_json::from_slice(
                    &std::fs::read(path)
                        .context("managed_process.account_config_invalid: cannot read config")?,
                )
                .context("managed_process.account_config_invalid: invalid JSON")?;
                config.validate()?;
                Ok(Some(config))
            }
            _ => bail!("managed_process.invalid_isolation: unsupported workspace isolation"),
        }
    }

    fn validate(&self) -> Result<()> {
        if self.username.trim().is_empty()
            || self.domain.trim().is_empty()
            || self.username.contains('\0')
            || self.domain.contains('\0')
            || !self.dpapi_path.is_absolute()
            || !self.dpapi_path.is_file()
            || !self.profile_root.is_absolute()
            || !self.profile_root.is_dir()
        {
            bail!(
                "managed_process.account_config_invalid: expected account, domain, absolute DPAPI file and existing profile directory"
            );
        }
        Ok(())
    }

    pub fn compatibility_digest(&self) -> Result<String> {
        crate::command::canonical_json_digest(&serde_json::to_value(self)?)
    }

    pub(super) fn environment(
        &self,
        spec: &super::ManagedProcessLaunchSpec,
    ) -> Result<std::collections::BTreeMap<std::ffi::OsString, std::ffi::OsString>> {
        // Keep the existing frozen Runtime/provider environment authoritative.
        // This mode changes process identity and filesystem homes, not provider
        // authentication; get_envs is not an origin/secret-classification API.
        let mut result = spec.environment().clone();
        for (key, relative) in [
            ("HOME", ""),
            ("USERPROFILE", ""),
            ("APPDATA", "AppData/Roaming"),
            ("LOCALAPPDATA", "AppData/Local"),
            ("TEMP", "tmp"),
            ("TMP", "tmp"),
            ("TMPDIR", "tmp"),
            ("CLAUDE_CODE_TMPDIR", "tmp"),
            ("CODEX_HOME", ".codex"),
            ("CODEBUDDY_CONFIG_DIR", ".codebuddy"),
            ("PI_CODING_AGENT_DIR", ".pi/agent"),
            ("GROK_HOME", ".grok"),
            ("QWEN_HOME", ".qwen"),
            ("QWEN_RUNTIME_DIR", ".qwen"),
            ("CLAUDE_CONFIG_DIR", ".claude"),
            ("CLAUDE_SECURESTORAGE_CONFIG_DIR", ".claude"),
            ("XDG_CONFIG_HOME", ".config"),
            ("XDG_CACHE_HOME", ".cache"),
            ("XDG_DATA_HOME", ".local/share"),
            ("XDG_RUNTIME_DIR", "tmp"),
        ] {
            super::insert_environment(
                &mut result,
                key.into(),
                self.profile_root.join(relative).into_os_string(),
            );
        }
        for key in [
            "OPENCODE_CONFIG",
            "OPENCODE_CONFIG_DIR",
            "OPENCODE_DB",
            "NODE_OPTIONS",
            "NODE_PATH",
        ] {
            super::remove_environment(&mut result, key.as_ref());
        }
        #[cfg(windows)]
        if let Some(root) = super::environment_value(&result, "SystemRoot".as_ref()) {
            let root = PathBuf::from(root);
            let mut modules = vec![root.join("System32/WindowsPowerShell/v1.0/Modules")];
            if let Some(program_files) = super::environment_value(&result, "ProgramFiles".as_ref())
            {
                modules.push(PathBuf::from(program_files).join("WindowsPowerShell/Modules"));
            }
            if let Ok(value) = std::env::join_paths(modules) {
                super::insert_environment(&mut result, "PSModulePath".into(), value);
            }
        }
        if let Some(process) =
            super::environment_value(&result, "ROVAI_ACCOUNT_PROCESS_ID".as_ref())
                .map(ToOwned::to_owned)
        {
            let instance=super::environment_value(&result,"ROVAI_ACCOUNT_INSTANCE_KEY".as_ref()).context("managed_process.account_instance_required: account process requires an explicit instance key")?;
            let outbox = self
                .profile_root
                .join("rovai-runtime-outbox")
                .join(instance)
                .join("builtin-tools")
                .join(process)
                .join("compaction-observation-outbox");
            super::insert_environment(
                &mut result,
                "ROVAI_ACCOUNT_COMPACTION_OUTBOX".into(),
                outbox.into_os_string(),
            );
        }
        // This is deployment configuration, not a child credential transport.
        super::remove_environment(&mut result, "ROVAI_WINDOWS_ACCOUNT_CONFIG".as_ref());
        super::remove_environment(&mut result, "ROVAI_CHAT_ISOLATION".as_ref());
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_policy_resets_profile_and_preserves_explicit_runtime_environment() {
        let root = std::env::temp_dir();
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .env("ANTHROPIC_API_KEY", "test-not-a-real-key")
            .env("HOME", "wrong-home")
            .env("CODEBUDDY_CONFIG_DIR", "host-private-codebuddy")
            .env("QWEN_HOME", "host-private-qwen")
            .env("OPENCODE_CONFIG", "host-private-opencode")
            .env("OPENCODE_DB", "host-private-history");
        let spec = super::super::ManagedProcessLaunchSpec::capture(
            &command,
            super::super::ManagedProcessPurpose::RuntimeHost,
            super::super::ManagedStdinPolicy::Piped,
            super::super::ManagedWindowsArgvDialect::MicrosoftCrt,
            "account-policy-test",
        )
        .unwrap();
        let account = WindowsAccountLaunch {
            username: "fixture".into(),
            domain: ".".into(),
            dpapi_path: root.join("not-a-credential"),
            profile_root: root.clone(),
        };
        let environment = account.environment(&spec).unwrap();
        assert_eq!(
            super::super::environment_value(&environment, "HOME".as_ref()),
            Some(root.as_os_str())
        );
        assert_eq!(
            super::super::environment_value(&environment, "ANTHROPIC_API_KEY".as_ref()),
            Some("test-not-a-real-key".as_ref())
        );
        assert!(
            super::super::environment_value(&environment, "ROVAI_WINDOWS_ACCOUNT_CONFIG".as_ref())
                .is_none()
        );
        for (key, relative) in [
            ("CODEBUDDY_CONFIG_DIR", ".codebuddy"),
            ("PI_CODING_AGENT_DIR", ".pi/agent"),
            ("GROK_HOME", ".grok"),
            ("QWEN_HOME", ".qwen"),
            ("QWEN_RUNTIME_DIR", ".qwen"),
        ] {
            assert_eq!(
                super::super::environment_value(&environment, key.as_ref()),
                Some(root.join(relative).as_os_str())
            );
        }
        for key in ["OPENCODE_CONFIG", "OPENCODE_DB"] {
            assert!(super::super::environment_value(&environment, key.as_ref()).is_none());
        }
        assert_ne!(
            account.compatibility_digest().unwrap(),
            WindowsAccountLaunch {
                username: "other".into(),
                ..account.clone()
            }
            .compatibility_digest()
            .unwrap()
        );
        assert!(account.validate().is_err());
        #[cfg(windows)]
        {
            let selected = spec.with_windows_account(Some(account.clone())).unwrap();
            let derived = selected
                .derive_runtime_one_shot_command(
                    std::env::current_exe().unwrap().as_os_str(),
                    vec![],
                    root,
                    Default::default(),
                    "account-derived-test",
                )
                .unwrap();
            assert_eq!(derived.windows_account.as_ref(), Some(&account));
        }
        #[cfg(not(windows))]
        assert!(spec.with_windows_account(Some(account)).is_err());
    }
}
