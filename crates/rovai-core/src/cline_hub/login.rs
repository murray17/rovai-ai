//! Explicit user interaction only. Native authorization output lives in bounded
//! memory, never a transcript, event, database, diagnostic or model input.
use super::{auth, config};
use crate::managed_process::{ManagedChildStdin, ManagedProcess};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

pub(super) struct Login {
    pub id: String,
    process: Mutex<ManagedProcess>,
    input: Mutex<Option<ManagedChildStdin>>,
    lease: Mutex<Option<auth::NativeAuthLease>>,
    output: StdMutex<String>,
    status: StdMutex<&'static str>,
    cancel: AtomicBool,
    root: PathBuf,
}

impl Login {
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    pub async fn start(_executable: &Path, _root: PathBuf) -> Result<Arc<Self>> {
        bail!("cline_hub_platform_not_qualified")
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    pub async fn start(executable: &Path, root: PathBuf) -> Result<Arc<Self>> {
        use crate::{
            agent_profile::AdapterKind,
            managed_process::{
                ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
                ManagedWindowsArgvDialect,
            },
        };
        let fingerprint = crate::agent_runtime_adapter::executable_fingerprint(executable)?;
        let help = config::native_cli_arguments(executable, &["auth", "--help"]).await?;
        if crate::agent_runtime_adapter::executable_fingerprint(executable)? != fingerprint {
            bail!("cline_native_login_installation_changed");
        }
        if !help.contains("--provider") || !help.contains("Authenticate") {
            return Err(auth::failure(
                "cline_hub_native_login_unsupported",
                "所选 Cline 没有可用的原生登录入口",
                "本次安装的认证帮助不支持已确认的 Provider 登录参数；不会调用其他全局 CLI。",
            ));
        }
        let paths = crate::cline::runtime_native_paths()?;
        if let Some(parent) = paths.providers.parent() {
            if !parent.exists() {
                config::private_dir(parent)?;
            }
        }
        let mut preparation = config::HostPreparation::create(&root)?;
        let mut lease = auth::NativeAuthLease::acquire(&paths.providers, &root)?;
        let mut command = tokio::process::Command::new(executable);
        crate::runtime_discovery::configure_runtime_command(AdapterKind::ClineCli, &mut command);
        command
            .args(["auth", "--provider", "openai-codex"])
            .current_dir(&root)
            .env("CLINE_PROVIDER_SETTINGS_PATH", &paths.providers);
        for name in [
            "CLINE_API_KEY",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_API_BASE",
        ] {
            command.env_remove(name);
        }
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeOneShot,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "cline-native-login",
        )?;
        lease.before_spawn()?;
        let mut process = match ManagedProcess::spawn(spec) {
            Ok(process) => process,
            Err(error) => {
                lease.process_absent()?;
                return Err(error.into());
            }
        };
        preparation.process_started();
        let tracked = process
            .track_descendants(&root.join("owned-processes"))
            .map_err(anyhow::Error::from)
            .and_then(|()| {
                config::private_file(
                    &root.join(config::OWNED_HOST_MARKER),
                    super::PROTOCOL.as_bytes(),
                )
            })
            .and_then(|()| lease.tracked());
        if let Err(error) = tracked {
            let _ = process.force_terminate_tree();
            let _ = tokio::time::timeout(Duration::from_secs(2), process.wait()).await;
            if process.captured_tree_is_empty().unwrap_or(false) {
                lease.process_absent()?;
                std::fs::remove_dir_all(&root)?;
            }
            return Err(error);
        }
        let stdout = process
            .take_stdout()
            .context("cline_login_stdout_missing")?;
        let stderr = process
            .take_stderr()
            .context("cline_login_stderr_missing")?;
        let input = process.take_stdin();
        let login = Arc::new(Self {
            id: uuid::Uuid::new_v4().to_string(),
            process: Mutex::new(process),
            input: Mutex::new(input),
            lease: Mutex::new(Some(lease)),
            output: StdMutex::new(String::new()),
            status: StdMutex::new("running"),
            cancel: AtomicBool::new(false),
            root,
        });
        for stream in [
            Box::pin(stdout) as std::pin::Pin<Box<dyn tokio::io::AsyncRead + Send>>,
            Box::pin(stderr),
        ] {
            let login = login.clone();
            tokio::spawn(async move {
                let mut stream = stream;
                let mut bytes = [0u8; 2048];
                while let Ok(count) = stream.read(&mut bytes).await {
                    if count == 0 {
                        break;
                    }
                    let status = login.status.lock().unwrap();
                    if login.cancel.load(Ordering::Acquire) || *status != "running" {
                        break;
                    }
                    let mut output = login.output.lock().unwrap();
                    let chunk = String::from_utf8_lossy(&bytes[..count]);
                    if output.len() + chunk.len() > 64 * 1024 {
                        login.cancel.store(true, Ordering::Release);
                        break;
                    }
                    output.push_str(&chunk);
                }
            });
        }
        let worker = login.clone();
        tokio::spawn(async move {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
            let status = loop {
                if worker.cancel.load(Ordering::Acquire) {
                    break "cancelled";
                }
                if tokio::time::Instant::now() >= deadline {
                    break "expired";
                }
                let mut process = worker.process.lock().await;
                if process.capture_descendants().is_err() {
                    break "failed";
                }
                match process.try_wait() {
                    Ok(Some(status)) => {
                        break if status.success() {
                            "completed"
                        } else {
                            "failed"
                        };
                    }
                    Err(_) => break "failed",
                    _ => {}
                }
                drop(process);
                tokio::time::sleep(Duration::from_millis(100)).await;
            };
            worker.input.lock().await.take();
            let cleanup = worker.reap().await;
            let saved = config::read_json(&paths.providers).ok().flatten();
            let valid = saved.as_ref().is_some_and(|saved| {
                matches!(
                    auth::select(saved, "openai-codex", None),
                    Ok(auth::Authentication::NativeAccount)
                )
            });
            *worker.status.lock().unwrap() = if !cleanup {
                "cleanup_unconfirmed"
            } else if worker.cancel.load(Ordering::Acquire) {
                "cancelled"
            } else if status == "completed" && !valid {
                "failed"
            } else {
                status
            };
            worker.output.lock().unwrap().clear();
        });
        Ok(login)
    }

    pub fn view(&self) -> Value {
        let status = *self.status.lock().unwrap();
        json!({"attemptId":self.id,"status":status,"output":if status == "running" {
            crate::runtime_failure::redact_secret_values(self.output.lock().unwrap().clone())
        } else { String::new() }})
    }
    pub fn running(&self) -> bool {
        matches!(
            *self.status.lock().unwrap(),
            "running" | "cleanup_unconfirmed"
        )
    }
    pub async fn write(&self, input: &str) -> Result<()> {
        if !self.running() || input.len() > 4096 || input.contains(['\0', '\r', '\n']) {
            bail!("cline_login_input_invalid");
        }
        let mut stdin = self.input.lock().await;
        let stdin = stdin.as_mut().context("cline_login_input_closed")?;
        tokio::time::timeout(Duration::from_secs(2), async {
            stdin.write_all(input.as_bytes()).await?;
            stdin.write_all(b"\n").await
        })
        .await
        .context("cline_login_input_outcome_unknown")??;
        Ok(())
    }
    pub async fn stop(&self) -> bool {
        self.cancel.store(true, Ordering::Release);
        let stopped = self.reap().await;
        self.output.lock().unwrap().clear();
        if stopped {
            *self.status.lock().unwrap() = "cancelled";
        }
        stopped
    }
    async fn reap(&self) -> bool {
        let mut process = self.process.lock().await;
        let _ = process.force_terminate_tree();
        let _ = tokio::time::timeout(Duration::from_secs(2), process.wait()).await;
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        for _ in 0..50 {
            if process.captured_tree_is_empty().unwrap_or(false) {
                let mut lease = self.lease.lock().await;
                if let Some(lease) = lease.as_mut() {
                    if lease.process_absent().is_err() {
                        return false;
                    }
                }
                lease.take();
                let _ = std::fs::remove_dir_all(&self.root);
                return true;
            }
            let _ = process.force_terminate_tree();
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }
}

#[cfg(all(
    test,
    feature = "extended-tests",
    target_os = "macos",
    target_arch = "aarch64"
))]
mod tests {
    use super::*;
    use crate::{
        agent_profile::AdapterKind,
        runtime_discovery::{RuntimeSearchEnvironment, with_runtime_configuration},
        runtime_startup::{RuntimeEnvironmentVariable, RuntimeStartupConfiguration},
    };
    use std::os::unix::fs::PermissionsExt;

    // A real child is necessary to verify that pipe interaction, exclusive
    // refresh ownership and cancellation end at kernel-confirmed process exit.
    #[tokio::test]
    async fn login_interaction_is_private_and_cancel_releases_only_proven_empty_ownership() {
        let root = std::env::temp_dir().join(format!("rovai-cline-login-{}", uuid::Uuid::new_v4()));
        config::private_dir(&root).unwrap();
        let source = root.join("providers.json");
        let settings = json!({"version":1,"providers":{"openai-codex":{"settings":{"provider":"openai-codex","auth":{"accountId":"fixture-account"}},"tokenSource":"oauth"}}});
        config::private_file(&source, &serde_json::to_vec(&settings).unwrap()).unwrap();
        let executable = root.join("selected-cline");
        config::private_file(&executable,b"#!/bin/sh\nif [ \"$2\" = \"--help\" ]; then echo 'Authenticate --provider'; exit 0; fi\nprintf '%s\\n' 'Login link https://auth.invalid/?user_code=fixture-code' 'access_token=never-render-this'\nIFS= read -r answer\nif [ \"$answer\" = finish ]; then exit 0; fi\nexec /bin/sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let search = RuntimeSearchEnvironment::for_test_paths(1, Vec::new())
            .with_startup_configuration(
                AdapterKind::ClineCli,
                RuntimeStartupConfiguration {
                    program_path: None,
                    custom_api_snapshot: None,
                    environment: vec![RuntimeEnvironmentVariable {
                        name: "CLINE_PROVIDER_SETTINGS_PATH".into(),
                        value: source.to_string_lossy().into_owned(),
                    }],
                },
            );
        let first = with_runtime_configuration(
            AdapterKind::ClineCli,
            &search,
            Login::start(&executable, root.join("first")),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !first.view()["output"]
                .as_str()
                .unwrap()
                .contains("fixture-code")
            {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(!first.view().to_string().contains("never-render-this"));
        assert!(auth::NativeAuthLease::acquire(&source, &root.join("other")).is_err());
        assert!(first.stop().await);
        assert_eq!(first.view()["output"], "");
        assert!(!root.join("first").exists());
        let second = with_runtime_configuration(
            AdapterKind::ClineCli,
            &search,
            Login::start(&executable, root.join("second")),
        )
        .await
        .unwrap();
        second.write("finish").await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while second.running() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(second.view()["status"], "completed");
        assert_eq!(second.view()["output"], "");
        assert_eq!(config::read_json(&source).unwrap().unwrap(), settings);
        let mut unconfirmed =
            auth::NativeAuthLease::acquire(&source, &root.join("unconfirmed")).unwrap();
        unconfirmed.before_spawn().unwrap();
        drop(unconfirmed);
        assert!(auth::NativeAuthLease::acquire(&source, &root.join("must-not-spawn")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
