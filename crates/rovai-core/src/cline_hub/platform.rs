//! Only the qualified platform can launch or capture a native Hub process tree.
use super::{HubHostLaunch, Socket, config};
use crate::managed_process::ManagedProcess;
use anyhow::{Result, bail};
use std::path::Path;

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub(super) async fn launch(
    _request: &HubHostLaunch,
    _root: &Path,
    _history: &Path,
) -> Result<(ManagedProcess, Socket, u32, config::NativeConfiguration)> {
    bail!("cline_hub_platform_not_qualified")
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(super) async fn launch(
    request: &HubHostLaunch,
    root: &Path,
    history: &Path,
) -> Result<(ManagedProcess, Socket, u32, config::NativeConfiguration)> {
    use crate::{
        agent_profile::AdapterKind,
        managed_process::{
            ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
            ManagedWindowsArgvDialect,
        },
    };
    use std::time::Duration;
    use tokio::{process::Command, time::timeout};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut preparation = config::HostPreparation::create(root)?;
    let mut command = Command::new(&request.executable);
    crate::runtime_discovery::configure_runtime_command(AdapterKind::ClineCli, &mut command);
    if let Some(tools) = &request.builtin_tools {
        tools.configure_command(&mut command)?;
    }
    let configuration = config::configure(
        &mut command,
        root,
        history,
        &request.cwd,
        &request.executable,
        request.selected_model.as_deref(),
        &request.bootstrap,
        &request.servers,
    )
    .await?;
    if request.builtin_tools.is_some() {
        config::configure_tool_shell(&mut command);
    }
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeHost,
        ManagedStdinPolicy::Null,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        "runtime-host:cline-hub",
    )?;
    if let Some(tools) = &request.builtin_tools {
        let first = spec
            .environment()
            .get(std::ffi::OsStr::new("PATH"))
            .and_then(|value| std::env::split_paths(value).next());
        if first.as_deref() != tools.cli_executable().parent() {
            bail!("cline_hub_builtin_cli_path_not_owned");
        }
    }
    let mut child = ManagedProcess::spawn(spec)?;
    preparation.process_started();
    if let Err(error) = child
        .track_descendants(&root.join("owned-processes"))
        .map_err(anyhow::Error::from)
        .and_then(|()| {
            // A marker may outlive a retired ledger only after ownership
            // was recorded. Never infer cleanup from a failed first track.
            config::private_file(
                &root.join(config::OWNED_HOST_MARKER),
                super::PROTOCOL.as_bytes(),
            )?;
            Ok(())
        })
    {
        let _ = child.force_terminate_tree();
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
        if child.captured_tree_is_empty().unwrap_or(false) {
            let _ = std::fs::remove_dir_all(root);
        }
        return Err(error);
    }
    // Native stderr may contain provider credentials. Drain both streams
    // without forwarding them into public diagnostics or snapshots.
    if let Some(mut out) = child.take_stdout() {
        tokio::spawn(async move {
            let _ = tokio::io::copy(&mut out, &mut tokio::io::sink()).await;
        });
    }
    if let Some(mut err) = child.take_stderr() {
        tokio::spawn(async move {
            let _ = tokio::io::copy(&mut err, &mut tokio::io::sink()).await;
        });
    }
    let connected = timeout(Duration::from_secs(20), async {
        loop {
            child.capture_descendants()?;
            if child.try_wait()?.is_some_and(|status| !status.success()) {
                bail!("cline_hub_startup_exited");
            }
            if configuration.discovery.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let discovery = super::owned_discovery(&configuration.discovery, root)?;
        if !child.owns_live_pid(discovery["pid"].as_u64().unwrap() as u32)? {
            bail!("cline_hub_discovery_process_mismatch");
        }
        let mut upgrade = discovery["url"].as_str().unwrap().into_client_request()?;
        upgrade.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            format!(
                "cline-hub-auth.{}",
                discovery["authToken"].as_str().unwrap()
            )
            .parse()?,
        );
        let socket = tokio_tungstenite::connect_async_with_config(
            upgrade,
            Some(super::transport::socket_config()),
            false,
        )
        .await
        .map_err(|_| anyhow::anyhow!("cline_hub_authenticated_connection_failed"))?
        .0;
        Ok::<_, anyhow::Error>((socket, discovery["pid"].as_u64().unwrap() as u32))
    })
    .await;
    let (socket, daemon_pid) = match connected {
        Ok(Ok(socket)) => socket,
        other => {
            let _ = child.force_terminate_tree();
            let _ = timeout(Duration::from_secs(2), child.wait()).await;
            if child.captured_tree_is_empty().unwrap_or(false) {
                let _ = std::fs::remove_dir_all(root);
            }
            return match other {
                Ok(Err(error)) => Err(error),
                _ => Err(anyhow::anyhow!("cline_hub_startup_timeout")),
            };
        }
    };
    Ok((child, socket, daemon_pid, configuration))
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(super) fn capture_descendants(child: &mut ManagedProcess) -> Result<()> {
    Ok(child.capture_descendants()?)
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub(super) fn capture_descendants(_child: &mut ManagedProcess) -> Result<()> {
    bail!("cline_hub_platform_not_qualified")
}
