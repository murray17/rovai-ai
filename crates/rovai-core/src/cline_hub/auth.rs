//! Cline owns credentials and refresh. Rovai owns only the selected source and
//! an exclusive process lease; no token is converted into a session API key.
use super::config;
use crate::{
    agent_profile::AdapterKind,
    runtime_failure::{
        RuntimeFailureError, RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView,
    },
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) enum Authentication {
    ApiKey(String),
    NativeAccount,
}

pub(super) fn failure(code: &str, summary: &str, detail: &str) -> anyhow::Error {
    RuntimeFailureError::new(RuntimeFailureView::new(
        AdapterKind::ClineCli,
        RuntimeFailureOrigin::Compatibility,
        if code == "cline_hub_native_not_logged_in" {
            RuntimeFailurePhase::Authentication
        } else {
            RuntimeFailurePhase::Spawn
        },
        code,
        summary,
        Some(detail.into()),
        false,
    ))
    .into()
}

pub(super) fn select(
    saved: &Value,
    provider: &str,
    explicit_key: Option<String>,
) -> Result<Authentication> {
    let entry = &saved["providers"][provider];
    let settings = &entry["settings"];
    let key = explicit_key
        .or_else(|| settings["apiKey"].as_str().map(str::to_owned))
        .filter(|value| !value.trim().is_empty());
    let oauth = entry["tokenSource"] == "oauth";
    if oauth && key.is_some() {
        return Err(failure(
            "cline_hub_auth_source_conflict",
            "Cline 认证来源冲突",
            "所选 Provider 同时配置了账号认证和静态 API key；请在 Cline 中明确认证来源。不会切换账号、端点或计费方式。",
        ));
    }
    if let Some(key) = key {
        return Ok(Authentication::ApiKey(key));
    }
    // This is a provider capability, not a version gate or an empty-key heuristic.
    // Other native login mechanisms remain explicitly unqualified.
    if provider == "openai-codex" {
        if !oauth || !settings["auth"].is_object() {
            return Err(failure(
                "cline_hub_native_not_logged_in",
                "Cline 尚未登录 ChatGPT",
                "请使用所选 Cline 安装完成原生 ChatGPT 登录，再重新检查。普通任务不会启动登录。",
            ));
        }
        if !settings["auth"]["accountId"]
            .as_str()
            .is_some_and(|id| !id.trim().is_empty())
        {
            return Err(failure(
                "cline_hub_native_account_identity_unavailable",
                "Cline 原生账号身份无法确认",
                "当前原生配置缺少稳定账号标识，无法区分凭据刷新与切换账号；请使用所选 Cline 重新登录。",
            ));
        }
        if settings["baseUrl"].as_str().is_some_and(|url| {
            !url.trim().is_empty()
                && url.trim().trim_end_matches('/') != "https://chatgpt.com/backend-api/codex"
        }) || settings
            .get("routingProviderId")
            .is_some_and(|value| !value.is_null())
        {
            return Err(failure(
                "cline_hub_native_auth_endpoint_conflict",
                "Cline 账号认证的目标地址不匹配",
                "ChatGPT 原生账号凭据不能交付给自定义 API 端点或另一个路由 Provider。",
            ));
        }
        return Ok(Authentication::NativeAccount);
    }
    Err(failure(
        "cline_hub_native_auth_unsupported",
        "Cline 原生认证方式尚未接通",
        "当前配置既不是已支持的 BYOK，也不是已确认的 ChatGPT 原生账号路径；不会猜测认证方式或回退计费来源。",
    ))
}

/// Preserve the complete selected native record, including extension metadata.
/// Native ProviderSettingsManager looks up records by provider ID; unrelated
/// records are not dependencies and must never become per-Host credential copies.
pub(super) fn byok_projection(saved: &Value, provider: &str) -> Result<Value> {
    let mut projected = if saved.is_null() {
        json!({"version":1,"providers":{}})
    } else {
        saved.clone()
    };
    let records = projected["providers"]
        .as_object_mut()
        .context("cline_native_config_invalid")?;
    records.retain(|id, _| id == provider);
    if let Some(auth) = records.get_mut(provider).and_then(|entry| {
        entry
            .pointer_mut("/settings/auth")
            .and_then(Value::as_object_mut)
    }) {
        for name in [
            "accessToken",
            "refreshToken",
            "expiresAt",
            "accountId",
            "idToken",
        ] {
            auth.remove(name);
        }
    }
    projected["lastUsedProvider"] = json!(provider);
    Ok(projected)
}

/// OS lock plus the existing kernel-identity process ledger. Dropping the lock
/// alone never clears an unconfirmed owner after a crash or cancelled startup.
pub(super) struct NativeAuthLease {
    _lock: fs::File,
    record: PathBuf,
    ledger: PathBuf,
    armed: bool,
}

impl NativeAuthLease {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    pub(super) fn acquire(source: &Path, host: &Path) -> Result<Self> {
        use std::os::{
            fd::AsRawFd,
            unix::fs::{MetadataExt, OpenOptionsExt},
        };
        let source = source
            .parent()
            .context("cline_auth_parent_missing")?
            .canonicalize()?
            .join(source.file_name().context("cline_auth_filename_missing")?);
        let metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => bail!("cline_auth_source_unreadable"),
        };
        if metadata.as_ref().is_some_and(|metadata| {
            !metadata.file_type().is_file()
                || metadata.uid() != unsafe { libc::geteuid() }
                || metadata.mode() & 0o077 != 0
        }) {
            return Err(failure(
                "cline_hub_auth_source_not_private",
                "Cline 凭据文件权限不安全",
                "请通过原生 Cline 修复凭据文件权限。",
            ));
        }
        // Key by the entire file, not provider ID: Cline writes all its records.
        let root = source
            .parent()
            .context("cline_auth_parent_missing")?
            .join(format!(
                ".rovai-auth-{}",
                crate::command::canonical_json_digest(&json!(source))?
            ));
        if fs::symlink_metadata(&root).is_ok_and(|meta| {
            !meta.file_type().is_dir() || meta.uid() != unsafe { libc::geteuid() }
        }) {
            bail!("cline_auth_scope_not_owned");
        }
        config::private_dir(&root)?;
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(root.join("lease.lock"))?;
        let lock_metadata = lock.metadata()?;
        if !lock_metadata.is_file()
            || lock_metadata.uid() != unsafe { libc::geteuid() }
            || lock_metadata.mode() & 0o077 != 0
        {
            bail!("cline_auth_lock_not_private");
        }
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(failure(
                "cline_hub_auth_scope_busy",
                "Cline 账号正在使用中",
                "当前原生安装的刷新协调只允许 Rovai 同一认证文件运行一个 Host；请等待当前任务或登录结束。输入尚未发送。",
            ));
        }
        let record = root.join("owner.json");
        if fs::symlink_metadata(&record).is_ok_and(|meta| {
            !meta.file_type().is_file()
                || meta.uid() != unsafe { libc::geteuid() }
                || meta.mode() & 0o077 != 0
        }) {
            bail!("cline_auth_owner_not_private");
        }
        if let Some(previous) = config::read_json(&record)? {
            if previous["schema"] != 1 || previous["state"] != "tracked" {
                return Err(failure(
                    "cline_hub_auth_owner_unconfirmed",
                    "Cline 认证进程需要恢复",
                    "上次启动的进程所有权尚未确认；不能启动另一个可能刷新同一凭据的进程。",
                ));
            }
            let ledger = PathBuf::from(
                previous["ledger"]
                    .as_str()
                    .context("cline_auth_owner_invalid")?,
            );
            crate::managed_process::ManagedProcess::recover_descendants(&ledger)?;
            if ledger.exists() && fs::read_dir(&ledger)?.next().is_some() {
                return Err(failure(
                    "cline_hub_auth_owner_unconfirmed",
                    "Cline 认证进程尚未退出",
                    "原生进程账本仍有未清理的进程，不能交接认证文件。",
                ));
            }
            fs::remove_file(&record)?;
        }
        Ok(Self {
            _lock: lock,
            record,
            ledger: host.join("owned-processes"),
            armed: false,
        })
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    pub(super) fn acquire(_source: &Path, _host: &Path) -> Result<Self> {
        bail!("cline_hub_platform_not_qualified")
    }

    fn persist(&self, state: &str) -> Result<()> {
        let temporary = self
            .record
            .with_extension(format!("{}.pending", uuid::Uuid::new_v4()));
        config::private_file(
            &temporary,
            &serde_json::to_vec(&json!({"schema":1,"state":state,"ledger":self.ledger}))?,
        )?;
        fs::rename(temporary, &self.record)?;
        Ok(())
    }

    pub(super) fn before_spawn(&mut self) -> Result<()> {
        self.persist("starting")?;
        self.armed = true;
        Ok(())
    }
    pub(super) fn tracked(&self) -> Result<()> {
        self.persist("tracked")
    }
    /// Only call after spawn failed without a child, or kernel-confirmed empty tree.
    pub(super) fn process_absent(&mut self) -> Result<()> {
        if self.armed {
            fs::remove_file(&self.record)?;
            self.armed = false;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auth_source_and_projection_preserve_selected_metadata_without_oauth_copies() {
        let saved = json!({"version":1,"providers":{
            "byok":{"settings":{"provider":"byok","apiKey":"static","future":{"dependency":"native"}},"tokenSource":"manual","updatedAt":"date"},
            "openai-codex":{"settings":{"provider":"openai-codex","auth":{"accountId":"account-a","accessToken":"secret-access","refreshToken":"secret-refresh"}},"tokenSource":"oauth"}}});
        assert!(matches!(
            select(&saved, "byok", None).unwrap(),
            Authentication::ApiKey(_)
        ));
        assert!(matches!(
            select(&saved, "openai-codex", None).unwrap(),
            Authentication::NativeAccount
        ));
        assert!(select(&saved, "openai-codex", Some("override".into())).is_err());
        assert!(select(&saved, "unknown", None).is_err());
        assert!(select(&json!({}), "openai-codex", None).is_err());
        let projected = byok_projection(&saved, "byok").unwrap();
        assert_eq!(projected["providers"]["byok"], saved["providers"]["byok"]);
        assert!(!projected.to_string().contains("secret"));
        let mut redirected = saved.clone();
        redirected["providers"]["openai-codex"]["settings"]["baseUrl"] =
            json!("https://custom.invalid/v1");
        assert!(select(&redirected, "openai-codex", None).is_err());
    }
}
