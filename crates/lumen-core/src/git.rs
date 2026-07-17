use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug)]
pub struct GitProjectInfo {
    pub root_path: PathBuf,
    pub git_common_dir: PathBuf,
    pub head: String,
}

#[derive(Debug)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub status: Vec<String>,
    pub stat: String,
    pub patch: String,
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
    let head = run_git(&root_path, &["rev-parse", "HEAD"])
        .await
        .context("the project needs at least one commit before Lumen can create a worktree")?;
    Ok(GitProjectInfo {
        root_path,
        git_common_dir: common_path,
        head: head.trim().to_string(),
    })
}

pub async fn create_worktree(
    project_root: &Path,
    base_revision: &str,
    data_dir: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<WorktreeInfo> {
    let short_id = task_id
        .chars()
        .filter(|value| *value != '-')
        .take(8)
        .collect::<String>();
    let branch_name = format!("lumen/task-{short_id}");
    let worktree_path = data_dir.join("worktrees").join(project_id).join(task_id);
    let parent = worktree_path
        .parent()
        .context("worktree path does not have a parent")?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create worktree parent {}", parent.display()))?;

    let output = Command::new("git")
        .arg("-C")
        .arg(project_root)
        .args(["worktree", "add", "-b"])
        .arg(&branch_name)
        .arg(&worktree_path)
        .arg(base_revision)
        .output()
        .await
        .context("failed to launch git worktree add")?;
    if !output.status.success() {
        bail!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    Ok(WorktreeInfo {
        path: worktree_path,
        branch_name,
    })
}

pub async fn diff(worktree_path: &Path, base_revision: &str) -> Result<GitDiff> {
    let status = run_git(worktree_path, &["status", "--short"])
        .await?
        .lines()
        .map(str::to_string)
        .collect();
    let stat = run_git(worktree_path, &["diff", "--stat", base_revision, "--"]).await?;
    let patch = run_git(
        worktree_path,
        &["diff", "--no-ext-diff", "--unified=3", base_revision, "--"],
    )
    .await?;
    Ok(GitDiff {
        status,
        stat,
        patch,
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
