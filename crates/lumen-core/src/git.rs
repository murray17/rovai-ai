use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use tokio::process::Command;

#[derive(Debug)]
pub struct GitProjectInfo {
    pub root_path: PathBuf,
    pub git_common_dir: PathBuf,
    pub object_format: String,
    pub head: String,
}

pub async fn inspect_project(path: &Path) -> Result<GitProjectInfo> {
    let root = run_git(path, &["rev-parse", "--show-toplevel"]).await?;
    let root_path = PathBuf::from(root.trim());
    let common = run_git(&root_path, &["rev-parse", "--git-common-dir"]).await?;
    let common_path = {
        let path = PathBuf::from(common.trim());
        if path.is_absolute() {
            path
        } else {
            root_path.join(path)
        }
    };
    let object_format = run_git(&root_path, &["rev-parse", "--show-object-format"]).await?;
    let object_format = object_format.trim().to_string();
    if !matches!(object_format.as_str(), "sha1" | "sha256") {
        bail!("unsupported Git object format: {object_format}");
    }
    let head = run_git(&root_path, &["rev-parse", "HEAD"])
        .await
        .context("the project needs at least one commit before Lumen can start a coding task")?;
    Ok(GitProjectInfo {
        root_path,
        git_common_dir: common_path,
        object_format,
        head: head.trim().to_string(),
    })
}

async fn run_git(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .await
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
