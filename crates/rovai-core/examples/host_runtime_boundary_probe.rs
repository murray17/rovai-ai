//! An explicit native diagnostic, not a qualification bypass or a model test.
//! It tries only disposable sentinel files created by this invocation. Never
//! point it at actual credentials, a daily instance, or an external process.
use anyhow::{Context, Result};
use rovai_core::{
    managed_process::{
        ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    platform::{atomic_write_private_bytes, prepare_private_directory},
};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

const SENTINEL: &[u8] = b"disposable-host-boundary-sentinel";

fn main() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments
        .first()
        .is_some_and(|arg| arg == "--child" || arg == "--descendant")
    {
        let private = PathBuf::from(arguments.get(1).context("missing fixture")?);
        let workspace = PathBuf::from(arguments.get(2).context("missing workspace")?);
        let readable = std::fs::read(private).is_ok_and(|bytes| bytes == SENTINEL);
        let writable = std::fs::write(
            workspace.join(if arguments[0] == "--child" {
                "child.txt"
            } else {
                "descendant.txt"
            }),
            b"authorized-workspace",
        )
        .is_ok();
        let mut result =
            json!({"privateFixtureReadable":readable,"authorizedWorkspaceWritable":writable});
        if arguments[0] == "--child" {
            let descendant = std::process::Command::new(std::env::current_exe()?)
                .arg("--descendant")
                .args(&arguments[1..])
                .output()?;
            anyhow::ensure!(descendant.status.success(), "diagnostic descendant failed");
            result["descendant"] = serde_json::from_slice::<Value>(&descendant.stdout)?;
        }
        println!("{}", result);
        return Ok(());
    }
    anyhow::ensure!(
        arguments.is_empty(),
        "this diagnostic accepts no external paths"
    );
    let root = prepare_private_directory(
        &std::env::temp_dir().join(format!("rovai-boundary-probe-{}", uuid::Uuid::new_v4())),
    )?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(root.clone());
    let owner = prepare_private_directory(&root.join("private-owner"))?;
    let workspace = prepare_private_directory(&root.join("authorized-workspace"))?;
    let sentinel = owner.join("sentinel.txt");
    atomic_write_private_bytes(&sentinel, SENTINEL)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let mut command = Command::new(std::env::current_exe()?);
        command.arg("--child").arg(&sentinel).arg(&workspace).current_dir(&workspace);
        let spec = ManagedProcessLaunchSpec::capture(&command, ManagedProcessPurpose::RuntimeHost, ManagedStdinPolicy::Null, ManagedWindowsArgvDialect::MicrosoftCrt, "disposable-host-boundary-probe")?;
        let mut process = ManagedProcess::spawn(spec)?;
        let mut stdout = process.take_stdout().context("diagnostic stdout unavailable")?;
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            let mut output = Vec::new();
            (&mut stdout).take(16 * 1024).read_to_end(&mut output).await?;
            let status = process.wait().await?;
            anyhow::ensure!(status.success(), "diagnostic child failed");
            Ok::<_, anyhow::Error>(serde_json::from_slice::<Value>(&output)?)
        }).await;
        let tree_stop = process.force_terminate_tree().is_ok();
        let observation = result.context("diagnostic exceeded ten seconds")??;
        let isolated = observation["privateFixtureReadable"] == false && observation["descendant"]["privateFixtureReadable"] == false;
        println!("{}", serde_json::to_string_pretty(&json!({
            "schemaVersion":1, "os":std::env::consts::OS,"arch":std::env::consts::ARCH,
            "scope":"Rovai ManagedProcess private-file and descendant probe; disposable fixture only",
            "observation":observation,"treeStopRequested":tree_stop,
            "privateFileIsolationSatisfied":isolated,
            "releaseQualified":false,
            "notCovered":["real control credentials", "environment and handle inheritance", "local IPC impersonation", "process memory access", "real Runtime authentication and execution"]
        }))?);
        Ok::<_, anyhow::Error>(())
    })
}
