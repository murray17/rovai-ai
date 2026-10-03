//! Explicit local smoke helper: fixed fake keys, native config in an isolated fixture only.
//! Run through scripts/smoke-runtime-custom-api.py. No user credential input is accepted.
use anyhow::{Context, Result, ensure};
use rovai_core::{
    agent_profile::AdapterKind,
    runtime_custom_api::{
        self, ApiKeyChange, ConnectionMode, CustomApiConfiguration, FieldEdit, native, native_edit,
    },
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf};
use tokio::process::Command;
#[tokio::main]
async fn main() -> Result<()> {
    let args = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    ensure!(
        args.len() == 3,
        "usage: custom_api_native_fixture EXECUTABLE FIXTURE_ROOT CONFIG_JSON"
    );
    let [executable, root, config] = args.as_slice() else {
        unreachable!()
    };
    ensure!(
        root.is_absolute() && root.join(".rovai-custom-api-fixture").is_file(),
        "fixture marker missing"
    );
    let mut configuration: CustomApiConfiguration =
        serde_json::from_slice(&std::fs::read(config)?)?;
    configuration.validate(configuration.kind())?;
    let kind = configuration.kind();
    let directory = root.join(if kind == AdapterKind::CodexCli {
        "codex"
    } else {
        "claude"
    });
    let mut environment = BTreeMap::from([
        (
            "PATH".into(),
            std::env::var("PATH").context("PATH missing")?,
        ),
        ("HOME".into(), root.to_string_lossy().into_owned()),
        ("USERPROFILE".into(), root.to_string_lossy().into_owned()),
        (
            if kind == AdapterKind::CodexCli {
                "CODEX_HOME"
            } else {
                "CLAUDE_CONFIG_DIR"
            }
            .into(),
            directory.to_string_lossy().into_owned(),
        ),
        (
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
            "1".into(),
        ),
        ("DO_NOT_TRACK".into(), "1".into()),
    ]);
    let shell_credential =
        kind == AdapterKind::ClaudeCodeCli && root.join("shell-credential-fixture").is_file();
    if shell_credential {
        environment.insert(
            "ANTHROPIC_AUTH_TOKEN".into(),
            "rovai-isolated-fake-key".into(),
        );
    }
    let context = native::NativeContext {
        kind,
        directory,
        artifact_root: root.join("derived"),
        environment,
    };
    let before = native::read(&context, Some(ConnectionMode::CustomApi))?;
    let fields = if kind == AdapterKind::CodexCli {
        vec![vec!["baseUrl"], vec!["codexModels"], vec!["defaultRowId"]]
    } else {
        vec![
            vec!["baseUrl"],
            vec!["claudeModels", "model"],
            vec!["claudeModels", "reasoningModel"],
            vec!["claudeModels", "haikuModel"],
            vec!["claudeModels", "sonnetModel"],
            vec!["claudeModels", "opusModel"],
        ]
    };
    let edits = fields
        .into_iter()
        .map(|path| FieldEdit {
            path: path.into_iter().map(str::to_owned).collect(),
            before: Value::Null,
            after: Value::Null,
            label: String::new(),
        })
        .collect::<Vec<_>>();
    if configuration.enabled() {
        native_edit::write(
            &context,
            &before,
            &configuration,
            &edits,
            &if shell_credential {
                ApiKeyChange::Keep
            } else {
                ApiKeyChange::Replace {
                    value: if root.join("rotate-fixture-key").exists() {
                        "rovai-isolated-rotated-key"
                    } else {
                        "rovai-isolated-fake-key"
                    }
                    .into(),
                }
            },
            Some(executable),
        )?;
    }
    let read = native::read(&context, configuration.mode())?;
    let snapshot = read.snapshot(&context, true);
    let mut command = Command::new(executable);
    command
        .env_clear()
        .envs(&context.environment)
        .current_dir(root);
    match &snapshot.configuration {
        CustomApiConfiguration::Codex { .. } => {
            runtime_custom_api::codex_catalog::configure(&snapshot, &mut command)?;
            command.args(["app-server", "--listen", "stdio://"]);
        }
        CustomApiConfiguration::ClaudeCode { .. } => {
            runtime_custom_api::claude_native::configure(&snapshot, &mut command)?;
            command.args([
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-prompt-tool",
                "stdio",
                "--no-session-persistence",
            ]);
        }
    }
    // The Python owner handles the entire dedicated process group, including abnormal exit.
    let status = command.status().await?;
    ensure!(
        status.success(),
        "native fixture failed: {}",
        json!(status.to_string())
    );
    Ok(())
}
