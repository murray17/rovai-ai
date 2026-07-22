use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug)]
pub struct GitProjectInfo {
    pub root_path: PathBuf,
    pub git_common_dir: PathBuf,
    pub object_format: String,
    pub head: String,
    pub branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub status: Vec<String>,
    pub is_clean: bool,
    pub changed_file_count: usize,
    pub stat: String,
    pub patch: String,
}

impl GitDiff {
    pub fn empty() -> Self {
        Self {
            status: Vec::new(),
            is_clean: true,
            changed_file_count: 0,
            stat: String::new(),
            patch: String::new(),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct GitStatusSummary {
    status: Vec<String>,
    is_clean: bool,
    changed_file_count: usize,
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
    let branch = run_git(&root_path, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    Ok(GitProjectInfo {
        root_path,
        git_common_dir: common_path,
        object_format,
        head: head.trim().to_string(),
        branch: branch.trim().to_string(),
    })
}

pub async fn diff(project_root: &Path, base_revision: &str) -> Result<GitDiff> {
    let status_output = run_git(project_root, &["status", "--short"]).await?;
    let status_summary = summarize_status(&status_output);
    let baseline_paths =
        run_git(project_root, &["diff", "--name-only", base_revision, "--"]).await?;
    let stat = run_git(project_root, &["diff", "--stat", base_revision, "--"]).await?;
    let patch = run_git(
        project_root,
        &["diff", "--no-ext-diff", "--unified=3", base_revision, "--"],
    )
    .await?;
    let changed_file_count = count_changed_files(&status_summary.status, &baseline_paths);
    Ok(GitDiff {
        status: status_summary.status,
        is_clean: changed_file_count == 0,
        changed_file_count,
        stat,
        patch,
    })
}

fn summarize_status(output: &str) -> GitStatusSummary {
    let status = output.lines().map(str::to_string).collect::<Vec<_>>();
    let changed_file_count = status.len();
    GitStatusSummary {
        status,
        is_clean: changed_file_count == 0,
        changed_file_count,
    }
}

fn count_changed_files(status: &[String], baseline_paths: &str) -> usize {
    let mut paths = baseline_paths
        .lines()
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>();

    for entry in status {
        let Some(path) = entry.get(3..) else {
            continue;
        };
        let path = path
            .rsplit_once(" -> ")
            .map_or(path, |(_, destination)| destination)
            .trim();
        if !path.is_empty() {
            paths.insert(path.to_string());
        }
    }

    paths.len()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_status_has_no_changed_files() {
        let summary = summarize_status("");

        assert!(summary.is_clean);
        assert_eq!(summary.changed_file_count, 0);
        assert!(summary.status.is_empty());
    }

    #[test]
    fn changed_file_count_matches_status_entries() {
        let summary =
            summarize_status(" M README.md\n?? new-file.txt\nR  old-name.txt -> new-name.txt\n");

        assert!(!summary.is_clean);
        assert_eq!(summary.changed_file_count, 3);
        assert_eq!(
            summary.status,
            [
                " M README.md",
                "?? new-file.txt",
                "R  old-name.txt -> new-name.txt"
            ]
        );
    }

    #[test]
    fn changed_file_count_includes_committed_and_untracked_changes() {
        let status = [
            " M README.md".to_string(),
            "?? new-file.txt".to_string(),
            "R  old-name.txt -> new-name.txt".to_string(),
        ];

        assert_eq!(
            count_changed_files(&status, "README.md\ncommitted-only.rs\nnew-name.txt\n"),
            4
        );
    }
}
