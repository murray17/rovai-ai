//! Versioned, process-owned entry into the official Hermes ACP implementation.
//! Native authentication, model resolution, tools and session storage stay native.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, process::Stdio, time::Duration};
use tokio::process::Command;

use crate::command::canonical_json_digest;

pub const REVISION: &str = "rovai-hermes-host-v7";
const HOST: &str = include_str!("hermes/host.py");
const NATIVE_ENTRY: &str =
    "runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)";

pub fn supported_version(version: Option<&str>) -> bool {
    version
        .and_then(crate::agent_runtime_adapter::parse_reported_runtime_version)
        .is_some_and(|(version, _)| version >= [0, 22, 4])
}

pub fn implementation_digest() -> Result<String> {
    canonical_json_digest(
        &json!({"revision": REVISION, "host": format!("{:x}", Sha256::digest(HOST))}),
    )
}

fn managed_argv(mut argv: Vec<String>, script: &Path) -> Result<Vec<String>> {
    ensure!(
        argv.len() == 4
            && Path::new(&argv[0]).is_absolute()
            && argv[1] == "-I"
            && argv[2] == "-c"
            && argv[3].ends_with(NATIVE_ENTRY),
        "Hermes installation-bound launcher is unsupported; install official Hermes >= 0.22.4"
    );
    let prefix_len = argv[3].len() - NATIVE_ENTRY.len();
    argv[3].truncate(prefix_len);
    argv[3].push_str("runpy.run_path(sys.argv[1], run_name='__main__')");
    argv.push(
        script
            .to_str()
            .context("Hermes host path is not UTF-8")?
            .to_owned(),
    );
    Ok(argv)
}

/// Resolve through the selected launcher's official machine boundary. No shell
/// parsing, interpreter search or dependency installation. The launcher starts
/// the unmodified official ACP and Gateway in a binding-scoped private native Home.
pub async fn configure_command(command: &mut Command, root: &Path, storage: &Path) -> Result<()> {
    let native = command.as_std();
    let launcher = native.get_program().to_owned();
    ensure!(
        native.get_args().next().is_none(),
        "Hermes entry must be configured before arguments"
    );
    let environment: Vec<_> = native
        .get_envs()
        .map(|(k, v)| (k.to_owned(), v.map(ToOwned::to_owned)))
        .collect();
    let cwd = native.get_current_dir().map(ToOwned::to_owned);
    let mut resolver = Command::new(native.get_program());
    resolver
        .arg("--print-runtime-command")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    for (key, value) in &environment {
        if let Some(value) = value {
            resolver.env(key, value);
        } else {
            resolver.env_remove(key);
        }
    }
    resolver.env("HERMES_DISABLE_LAZY_INSTALLS", "1");
    if let Some(cwd) = &cwd {
        resolver.current_dir(cwd);
    }
    let output = crate::runtime_probe_process::run_bounded_command(
        &mut resolver,
        crate::runtime_probe_process::ProbeCommandLimits::new(Duration::from_secs(30)),
    )
    .await
    .context("Hermes launcher resolution failed")?;
    ensure!(
        output.status.success() && !output.stdout.truncated,
        "Hermes launcher resolution failed"
    );
    let argv: Vec<String> = serde_json::from_slice(&output.stdout.bytes)
        .context("Hermes launcher response is invalid")?;
    let root = crate::platform::private_storage::prepare_private_directory(root)?;
    let script = root.join("host.py");
    fs::write(&script, HOST)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o600))?;
    }
    let argv = managed_argv(argv, &script)?;
    let mut managed = Command::new(&argv[0]);
    managed.args(&argv[1..]);
    for (key, value) in environment {
        if let Some(value) = value {
            managed.env(key, value);
        } else {
            managed.env_remove(key);
        }
    }
    if let Some(cwd) = cwd {
        managed.current_dir(cwd);
    }
    let storage = crate::platform::private_storage::prepare_private_directory(storage)?;
    managed.env("ROVAI_HERMES_LAUNCHER", launcher);
    managed.env("HERMES_DISABLE_LAZY_INSTALLS", "1");
    managed.env("ROVAI_HERMES_STORAGE", storage);
    *command = managed;
    Ok(())
}

/// A bounded, one-shot official control operation. This connection never observes
/// ordinary prompt events or decides their terminal outcome.
pub async fn control(
    spec: &crate::managed_process::ManagedProcessLaunchSpec,
    operation: &str,
    params: Value,
) -> Result<Value> {
    let mut command = Command::new(spec.application());
    command
        .args(spec.arguments())
        .current_dir(spec.working_directory())
        .env_clear()
        .envs(spec.environment())
        .env("ROVAI_HERMES_CONTROL", "1");
    let input = serde_json::to_vec(&json!({"operation": operation, "params": params}))?;
    let output = crate::runtime_probe_process::run_bounded_command_with_input(
        &mut command,
        Some(&input),
        crate::runtime_probe_process::ProbeCommandLimits::new(Duration::from_secs(45)),
    )
    .await?;
    ensure!(
        !output.stdout.truncated,
        "Hermes control response was truncated"
    );
    let value: Value = serde_json::from_slice(&output.stdout.bytes)
        .context("Hermes control response is unavailable")?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        anyhow::bail!("Hermes control: {error}");
    }
    ensure!(output.status.success(), "Hermes control failed");
    value
        .get("result")
        .cloned()
        .context("Hermes control returned no result")
}

/// A cancellation can precede submit; a transport error can follow admission.
/// Neither proves that an otherwise unobserved input was accepted or rejected.
/// The shared ACP client matches the response and keeps its terminal outcome.
pub fn input_acceptance_uncertain(message: &Value) -> bool {
    message
        .pointer("/result/stopReason")
        .and_then(Value::as_str)
        == Some("cancelled")
        || message.get("error").is_some()
            && !matches!(message["error"]["code"].as_i64(), Some(-32600 | -32602))
            && message
                .pointer("/error/data/details")
                .and_then(Value::as_str)
                != Some("admitted_turn_failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_entry_requires_the_known_native_launcher_and_execution_identity() {
        let argv = vec![
            "/native/python".into(),
            "-I".into(),
            "-c".into(),
            format!("import runpy; import hermes_bootstrap; {NATIVE_ENTRY}"),
        ];
        let command = managed_argv(argv.clone(), Path::new("/private/host.py")).unwrap();
        assert!(command[3].starts_with("import runpy; import hermes_bootstrap; "));
        assert!(command[3].ends_with("runpy.run_path(sys.argv[1], run_name='__main__')"));
        assert_eq!(command[4], "/private/host.py");
        for index in 0..4 {
            let mut invalid = argv.clone();
            invalid[index] = "unexpected".into();
            assert!(managed_argv(invalid, Path::new("/private/host.py")).is_err());
        }
        assert!(!supported_version(Some("Hermes Agent v0.22.2")));
        for version in [
            "0.22.4",
            "Hermes Agent v0.22.5 (new source)",
            "0.23.0",
            "1.0.0",
        ] {
            assert!(supported_version(Some(version)), "{version}");
        }
        assert!(!supported_version(None));
        // Missing supplementary observations cannot invalidate official success.
        assert!(!input_acceptance_uncertain(
            &json!({"result":{"stopReason":"end_turn"}})
        ));
        assert!(input_acceptance_uncertain(
            &json!({"result":{"stopReason":"cancelled"}})
        ));
        assert!(!input_acceptance_uncertain(
            &json!({"error":{"code":-32602}})
        ));
        assert!(!input_acceptance_uncertain(
            &json!({"error":{"code":-32603,"data":{"details":"admitted_turn_failed"}}})
        ));
        assert!(input_acceptance_uncertain(
            &json!({"error":{"code":-32603,"data":{"details":"connection_lost"}}})
        ));
    }
}
