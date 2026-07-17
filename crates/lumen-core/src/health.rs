use std::{env, path::PathBuf};

use serde::Serialize;
use tokio::process::Command;

pub const CODEX_VERSION_BASELINE: &str = "0.144.5";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHealth {
    installed: bool,
    version: Option<String>,
    authenticated: Option<bool>,
    compatible: Option<bool>,
    detail: Option<String>,
    path: Option<String>,
}

pub async fn git_health() -> CommandHealth {
    command_health("git", &["--version"], None).await
}

pub async fn codex_health() -> CommandHealth {
    let Some(path) = find_codex() else {
        return CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            compatible: None,
            detail: Some("Codex CLI was not found in PATH or a common install location.".into()),
            path: None,
        };
    };

    let version_output = Command::new(&path).arg("--version").output().await;
    let (installed, version, detail) = match version_output {
        Ok(output) if output.status.success() => (
            true,
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            None,
        ),
        Ok(output) => (
            false,
            None,
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ),
        Err(error) => (false, None, Some(error.to_string())),
    };

    let auth_output = Command::new(&path).args(["login", "status"]).output().await;
    let (authenticated, auth_detail) = match auth_output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let detail = if stdout.is_empty() { stderr } else { stdout };
            (
                Some(output.status.success()),
                (!detail.is_empty()).then_some(detail),
            )
        }
        Err(error) => (None, Some(error.to_string())),
    };

    CommandHealth {
        installed,
        compatible: version
            .as_deref()
            .map(|value| value.contains(CODEX_VERSION_BASELINE)),
        version,
        authenticated,
        detail: auth_detail.or(detail),
        path: Some(path.to_string_lossy().to_string()),
    }
}

async fn command_health(command: &str, args: &[&str], path: Option<PathBuf>) -> CommandHealth {
    let executable = path.unwrap_or_else(|| PathBuf::from(command));
    match Command::new(&executable).args(args).output().await {
        Ok(output) if output.status.success() => CommandHealth {
            installed: true,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            authenticated: None,
            compatible: None,
            detail: None,
            path: Some(executable.to_string_lossy().to_string()),
        },
        Ok(output) => CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            compatible: None,
            detail: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            path: None,
        },
        Err(error) => CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            compatible: None,
            detail: Some(error.to_string()),
            path: None,
        },
    }
}

pub fn find_codex() -> Option<PathBuf> {
    if let Some(path) = env::var_os("LUMEN_CODEX_BIN").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            let candidate = directory.join("codex");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
    }
    candidates.into_iter().find(|path| path.is_file())
}
