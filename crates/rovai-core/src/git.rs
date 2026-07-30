use std::{
    fs,
    path::{Path, PathBuf},
    process::Output,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitCapabilityState {
    NotGit,
    GitValid,
    GitInvalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitObservation {
    pub state: GitCapabilityState,
    pub repository_root: Option<String>,
    pub git_common_dir: Option<String>,
    pub object_format: Option<String>,
    pub head_commit: Option<String>,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
    pub observed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInspection {
    pub name: String,
    pub project_path: String,
    pub git_observation: GitObservation,
}

pub fn validate_workspace_directory(
    path: &Path,
    application_data_dir: &Path,
    allow_managed_lobby: bool,
) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("workspace path must be absolute");
    }
    let canonical = fs::canonicalize(path)
        .with_context(|| format!("workspace directory does not exist: {}", path.display()))?;
    let metadata = fs::metadata(&canonical)
        .with_context(|| format!("workspace metadata is unavailable: {}", canonical.display()))?;
    if !metadata.is_dir() {
        bail!("workspace path is not a directory");
    }
    if canonical.parent().is_none() {
        bail!("the filesystem root cannot be used as a workspace");
    }
    fs::read_dir(&canonical).with_context(|| {
        format!(
            "workspace directory is not readable: {}",
            canonical.display()
        )
    })?;

    let canonical_data_dir = fs::canonicalize(application_data_dir).with_context(|| {
        format!(
            "Rovai-ai application data directory is unavailable: {}",
            application_data_dir.display()
        )
    })?;
    let canonical_lobby = fs::canonicalize(application_data_dir.join("lobby")).ok();
    if canonical.starts_with(&canonical_data_dir)
        && !(allow_managed_lobby && canonical_lobby.as_ref() == Some(&canonical))
    {
        bail!("Rovai-ai managed data cannot be used as a project workspace");
    }
    if is_git_metadata_path(&canonical) {
        bail!("Git metadata directories cannot be used as a project workspace");
    }
    Ok(canonical)
}

pub async fn inspect_workspace(
    path: &Path,
    application_data_dir: &Path,
    allow_managed_lobby: bool,
) -> Result<WorkspaceInspection> {
    let canonical = validate_workspace_directory(path, application_data_dir, allow_managed_lobby)?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("工作目录")
        .to_string();
    let project_path = canonical
        .to_str()
        .context("canonical workspace path is not valid Unicode")?
        .to_string();
    let git_observation = observe_git(&canonical).await;
    Ok(WorkspaceInspection {
        name,
        project_path,
        git_observation,
    })
}

pub async fn observe_git(path: &Path) -> GitObservation {
    let observed_at = chrono::Utc::now().to_rfc3339();
    let repository_probe = git_output(
        path,
        &["rev-parse", "--is-inside-work-tree", "--is-bare-repository"],
    )
    .await;
    let Ok(repository_probe) = repository_probe else {
        return invalid_or_not_git(path, observed_at, "git executable is unavailable");
    };
    if !repository_probe.status.success() {
        return invalid_or_not_git(
            path,
            observed_at,
            output_error(&repository_probe, "Git repository probe failed"),
        );
    }
    let probe_text = String::from_utf8_lossy(&repository_probe.stdout);
    let probe_lines = probe_text.lines().map(str::trim).collect::<Vec<_>>();
    let inside_work_tree = probe_lines.first().copied() == Some("true");
    let bare_repository = probe_lines.get(1).copied() == Some("true");
    if bare_repository || !inside_work_tree {
        return GitObservation {
            state: GitCapabilityState::GitInvalid,
            repository_root: None,
            git_common_dir: None,
            object_format: None,
            head_commit: None,
            branch: None,
            dirty: None,
            observed_at,
            diagnostic: Some(if bare_repository {
                "bare Git repositories cannot be used as Camp workspaces".to_string()
            } else {
                "Git metadata does not describe a working tree".to_string()
            }),
        };
    }

    let root = match required_git_text(path, &["rev-parse", "--show-toplevel"]).await {
        Ok(value) => PathBuf::from(value),
        Err(error) => return invalid_observation(observed_at, format!("{error:#}")),
    };
    let repository_root = match fs::canonicalize(&root) {
        Ok(value) => value,
        Err(error) => {
            return invalid_observation(
                observed_at,
                format!("Git repository root is unavailable: {error}"),
            );
        }
    };
    let common = match required_git_text(path, &["rev-parse", "--git-common-dir"]).await {
        Ok(value) => PathBuf::from(value),
        Err(error) => return invalid_observation(observed_at, format!("{error:#}")),
    };
    let common = if common.is_absolute() {
        common
    } else {
        repository_root.join(common)
    };
    let git_common_dir = match fs::canonicalize(&common) {
        Ok(value) => value,
        Err(error) => {
            return invalid_observation(
                observed_at,
                format!("Git common directory is unavailable: {error}"),
            );
        }
    };
    let object_format = match required_git_text(path, &["rev-parse", "--show-object-format"]).await
    {
        Ok(value) if matches!(value.as_str(), "sha1" | "sha256") => value,
        Ok(value) => {
            return invalid_observation(
                observed_at,
                format!("unsupported Git object format: {value}"),
            );
        }
        Err(error) => return invalid_observation(observed_at, format!("{error:#}")),
    };
    let status = match git_output(path, &["status", "--porcelain=v1", "-z"]).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return invalid_observation(observed_at, output_error(&output, "Git status failed"));
        }
        Err(error) => return invalid_observation(observed_at, format!("{error:#}")),
    };
    let head_commit = optional_git_text(path, &["rev-parse", "--verify", "HEAD^{commit}"]).await;
    let branch = optional_git_text(path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await;

    GitObservation {
        state: GitCapabilityState::GitValid,
        repository_root: Some(repository_root.to_string_lossy().to_string()),
        git_common_dir: Some(git_common_dir.to_string_lossy().to_string()),
        object_format: Some(object_format),
        head_commit,
        branch,
        dirty: Some(!status.stdout.is_empty()),
        observed_at,
        diagnostic: None,
    }
}

fn invalid_or_not_git(
    path: &Path,
    observed_at: String,
    diagnostic: impl Into<String>,
) -> GitObservation {
    if nearest_git_marker(path).is_some() || is_git_metadata_path(path) {
        invalid_observation(observed_at, diagnostic.into())
    } else {
        GitObservation {
            state: GitCapabilityState::NotGit,
            repository_root: None,
            git_common_dir: None,
            object_format: None,
            head_commit: None,
            branch: None,
            dirty: None,
            observed_at,
            diagnostic: None,
        }
    }
}

fn invalid_observation(observed_at: String, diagnostic: String) -> GitObservation {
    GitObservation {
        state: GitCapabilityState::GitInvalid,
        repository_root: None,
        git_common_dir: None,
        object_format: None,
        head_commit: None,
        branch: None,
        dirty: None,
        observed_at,
        diagnostic: Some(diagnostic),
    }
}

fn nearest_git_marker(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .map(|ancestor| ancestor.join(".git"))
        .find(|candidate| candidate.exists())
}

fn is_git_metadata_path(path: &Path) -> bool {
    path.ancestors().any(|candidate| {
        candidate.file_name().and_then(|value| value.to_str()) == Some(".git")
            || looks_like_git_metadata_root(candidate)
    })
}

fn looks_like_git_metadata_root(path: &Path) -> bool {
    path.join("HEAD").is_file()
        && (path.join("objects").is_dir()
            || path.join("commondir").is_file()
            || path.join("gitdir").is_file())
}

async fn required_git_text(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = git_output(cwd, args).await?;
    if !output.status.success() {
        bail!(
            "{}",
            output_error(&output, &format!("git {} failed", args.join(" ")))
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn optional_git_text(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = git_output(cwd, args).await.ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

async fn git_output(cwd: &Path, args: &[&str]) -> Result<Output> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args).kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .with_context(|| format!("git {} timed out", args.join(" ")))?
        .with_context(|| format!("failed to run git {}", args.join(" ")))
}

fn output_error(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.to_string()
    } else {
        stderr
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rovai-git-{name}-{}", Uuid::new_v4()))
    }

    async fn run_git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .await
            .expect("git should run");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[tokio::test]
    async fn ordinary_and_empty_git_directories_are_valid_workspaces() {
        let root = test_root("ordinary-empty");
        let data_dir = root.join("data");
        let ordinary = root.join("ordinary");
        let empty_repository = root.join("empty-repository");
        fs::create_dir_all(data_dir.join("lobby")).unwrap();
        fs::create_dir_all(&ordinary).unwrap();
        fs::create_dir_all(&empty_repository).unwrap();

        let ordinary_inspection = inspect_workspace(&ordinary, &data_dir, false)
            .await
            .unwrap();
        assert_eq!(
            ordinary_inspection.git_observation.state,
            GitCapabilityState::NotGit
        );
        run_git(&ordinary, &["init"]).await;
        assert_eq!(
            observe_git(&ordinary).await.state,
            GitCapabilityState::GitValid,
            "an existing Camp directory gains Git capability dynamically"
        );
        fs::remove_dir_all(ordinary.join(".git")).unwrap();
        assert_eq!(
            observe_git(&ordinary).await.state,
            GitCapabilityState::NotGit,
            "losing Git metadata does not make the directory unavailable"
        );

        run_git(&empty_repository, &["init"]).await;
        let empty_inspection = inspect_workspace(&empty_repository, &data_dir, false)
            .await
            .unwrap();
        assert_eq!(
            empty_inspection.git_observation.state,
            GitCapabilityState::GitValid
        );
        assert_eq!(empty_inspection.git_observation.head_commit, None);
        assert_eq!(empty_inspection.git_observation.dirty, Some(false));

        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn git_observation_tracks_head_branch_and_dirty_state() {
        let root = test_root("observation");
        let data_dir = root.join("data");
        let project = root.join("project");
        fs::create_dir_all(data_dir.join("lobby")).unwrap();
        fs::create_dir_all(&project).unwrap();
        run_git(&project, &["init"]).await;
        run_git(&project, &["config", "user.email", "tests@rovai.local"]).await;
        run_git(&project, &["config", "user.name", "Rovai Tests"]).await;
        fs::write(project.join("README.md"), "hello\n").unwrap();
        run_git(&project, &["add", "README.md"]).await;
        run_git(&project, &["commit", "-m", "initial"]).await;

        let clean = observe_git(&project).await;
        assert_eq!(clean.state, GitCapabilityState::GitValid);
        assert!(clean.head_commit.is_some());
        assert!(clean.branch.is_some());
        assert_eq!(clean.dirty, Some(false));

        fs::write(project.join("README.md"), "changed\n").unwrap();
        let dirty = observe_git(&project).await;
        assert_eq!(dirty.dirty, Some(true));

        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn malformed_git_metadata_is_an_invalid_capability_not_a_workspace_failure() {
        let root = test_root("invalid");
        let data_dir = root.join("data");
        let project = root.join("project");
        fs::create_dir_all(data_dir.join("lobby")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join(".git"), "gitdir: /missing/rovai-git-dir\n").unwrap();

        let inspection = inspect_workspace(&project, &data_dir, false).await.unwrap();
        assert_eq!(
            inspection.git_observation.state,
            GitCapabilityState::GitInvalid
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn protected_and_git_metadata_directories_are_rejected() {
        let root = test_root("safety");
        let data_dir = root.join("data");
        let project = root.join("project");
        let git_dir = project.join(".git");
        let bare = root.join("bare.git");
        let worktree_private_gitdir = root.join("worktrees").join("camp");
        fs::create_dir_all(data_dir.join("lobby")).unwrap();
        fs::create_dir_all(git_dir.join("objects")).unwrap();
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(bare.join("objects")).unwrap();
        fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(&worktree_private_gitdir).unwrap();
        fs::write(
            worktree_private_gitdir.join("HEAD"),
            "ref: refs/heads/main\n",
        )
        .unwrap();
        fs::write(worktree_private_gitdir.join("commondir"), "../..\n").unwrap();

        assert!(validate_workspace_directory(&data_dir, &data_dir, false).is_err());
        assert!(validate_workspace_directory(&data_dir.join("lobby"), &data_dir, false).is_err());
        assert!(validate_workspace_directory(&git_dir, &data_dir, false).is_err());
        assert!(validate_workspace_directory(&bare, &data_dir, false).is_err());
        assert!(validate_workspace_directory(&worktree_private_gitdir, &data_dir, false).is_err());
        assert!(validate_workspace_directory(&data_dir.join("lobby"), &data_dir, true).is_ok());
        assert!(validate_workspace_directory(Path::new("/"), &data_dir, false).is_err());

        fs::remove_dir_all(root).unwrap();
    }
}
