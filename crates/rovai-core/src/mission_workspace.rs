//! Core-owned persistent Mission worktrees and current net changes. No Agent-reported patches.
use crate::runtime_probe_process::{
    BoundedCommandOutput, ProbeCommandLimits, run_bounded_command_with_input,
};
use anyhow::{Context, Result, bail, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionWorkspace {
    pub id: String,
    pub mission_id: String,
    pub camp_id: String,
    pub execution_host_id: String,
    pub source_directory: String,
    pub repository_root: String,
    pub git_common_dir: String,
    pub worktree_path: String,
    pub working_directory: String,
    pub base_branch: Option<String>,
    #[serde(rename = "managedBranch")]
    pub branch: String,
    pub base_sha: String,
    #[serde(skip)]
    pub preparation_token: String,
    #[serde(skip)]
    pub preparation_kind: String,
    #[serde(skip)]
    pub generation: i64,
    pub state: String,
    #[serde(skip)]
    pub cleanup_command_id: Option<String>,
    #[serde(skip)]
    pub cleanup_expected_branch_oid: Option<String>,
    pub cleanup_worktree_removed: bool,
    pub cleanup_branch_removed: bool,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionWorkspaceCleanupProjection {
    pub state: String,
    pub worktree_removed: bool,
    pub branch_removed: bool,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MissionCheckoutState {
    Branch { branch: String, head: String },
    Detached { head: String },
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionWorkspaceChangesView {
    pub checkout_state: MissionCheckoutState,
    pub view_id: Option<String>,
    pub files: Option<Vec<MissionChangedFile>>,
    pub diff_error: Option<String>,
}

impl MissionWorkspace {
    pub fn cleanup_finished(&self) -> bool {
        self.cleanup_worktree_removed && self.cleanup_branch_removed
    }

    pub fn managed_resources_remain(&self) -> bool {
        !self.cleanup_finished()
    }
}
#[derive(Debug, Clone)]
pub struct GitRepository {
    pub root: PathBuf,
    pub common_dir: PathBuf,
    pub base_branch: Option<String>,
    pub base_sha: String,
    pub relative_directory: PathBuf,
}
#[derive(Debug, Clone)]
pub struct MissionGit {
    executable: PathBuf,
    #[cfg(test)]
    invocations: Arc<std::sync::Mutex<Vec<Vec<String>>>>,
}

#[derive(Debug)]
pub(crate) struct MissionDiffMetadata {
    checkout_state: MissionCheckoutState,
    index: PathBuf,
    shared_index: Option<PathBuf>,
}

#[derive(Debug)]
pub(crate) struct VerifiedWorktreeCleanup {
    target_present: bool,
    admin_dir: Option<PathBuf>,
    stale_registrations: Vec<PathBuf>,
    staging_root: Option<PathBuf>,
    staging_checkout_present: bool,
    managed_reference: String,
    managed_branch_oid: Option<String>,
}

impl VerifiedWorktreeCleanup {
    pub(crate) fn target_present(&self) -> bool {
        self.target_present
    }

    pub(crate) fn requires_managed_branch(&self) -> bool {
        self.staging_checkout_present
    }

    pub(crate) fn managed_reference(&self) -> &str {
        &self.managed_reference
    }

    pub(crate) fn managed_branch_oid(&self) -> Option<&str> {
        self.managed_branch_oid.as_deref()
    }

    pub(crate) fn owned_worktree_intact(&self, workspace: &MissionWorkspace) -> bool {
        self.target_present
            && self.admin_dir.as_deref().is_some_and(|admin_dir| {
                MissionGit::verify_cleanup_filesystem_identity(workspace, admin_dir).is_ok()
            })
    }
}

#[derive(Debug)]
pub(crate) struct CleanupRefusal {
    code: &'static str,
    detail: Option<String>,
}

impl CleanupRefusal {
    fn new(code: &'static str, detail: Option<String>) -> Self {
        Self { code, detail }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for CleanupRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)?;
        if let Some(detail) = self.detail.as_deref().filter(|detail| !detail.is_empty()) {
            write!(formatter, ": {detail}")?;
        }
        Ok(())
    }
}

impl std::error::Error for CleanupRefusal {}

#[derive(Debug)]
struct CleanupGitObservation {
    root: PathBuf,
    admin_dir: PathBuf,
    common_dir: PathBuf,
    head_oid: String,
    managed_branch_oid: Option<String>,
    checkout_reference: Option<String>,
}

fn git_compatible_path(path: &Path) -> &Path {
    #[cfg(windows)]
    {
        dunce::simplified(path)
    }
    #[cfg(not(windows))]
    {
        path
    }
}

impl MissionGit {
    pub fn new(executable: PathBuf) -> Result<Self> {
        ensure!(
            executable.is_absolute() && executable.is_file(),
            "mission.git_unavailable"
        );
        Ok(Self {
            executable,
            #[cfg(test)]
            invocations: Arc::new(std::sync::Mutex::new(Vec::new())),
        })
    }
    #[cfg(test)]
    fn reset_command_count(&self) {
        self.invocations.lock().unwrap().clear();
    }
    #[cfg(test)]
    fn command_count(&self) -> usize {
        self.invocations.lock().unwrap().len()
    }
    async fn output(
        &self,
        cwd: &Path,
        args: &[OsString],
        index: Option<&Path>,
        input: Option<&[u8]>,
    ) -> Result<BoundedCommandOutput> {
        #[cfg(test)]
        self.invocations.lock().unwrap().push(
            args.iter()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect(),
        );
        let mut command = Command::new(&self.executable);
        crate::runtime_discovery::configure_active_runtime_command(&mut command);
        for key in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_COMMON_DIR",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            command.env_remove(key);
        }
        command
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .arg("--no-optional-locks")
            .arg("--literal-pathspecs")
            .arg("-C")
            .arg(git_compatible_path(cwd));
        for argument in args {
            let path = Path::new(argument);
            if path.is_absolute() {
                // Git for Windows rewrites a verbatim `\\?\C:\...` argument to
                // `//?/C:/...` and then rejects it while creating `.git`.
                // Keep canonical paths for Core identity checks, but expose the
                // equivalent ordinary path only at the Git process boundary.
                command.arg(git_compatible_path(path));
            } else {
                command.arg(argument);
            }
        }
        if let Some(index) = index {
            command.env("GIT_INDEX_FILE", git_compatible_path(index));
        }
        let output = run_bounded_command_with_input(
            &mut command,
            input,
            ProbeCommandLimits {
                deadline: Duration::from_secs(120),
                stdout_bytes: 16 * 1024 * 1024,
                stderr_bytes: 64 * 1024,
                cleanup_timeout: Duration::from_secs(2),
            },
        )
        .await
        .context("mission.git_failed")?;
        ensure!(!output.stdout.truncated, "mission.git_output_too_large");
        Ok(output)
    }

    #[cfg(test)]
    fn clear_invocations(&self) {
        self.invocations.lock().unwrap().clear();
    }

    #[cfg(test)]
    fn take_invocations(&self) -> Vec<Vec<String>> {
        std::mem::take(&mut *self.invocations.lock().unwrap())
    }
    async fn bytes(&self, cwd: &Path, args: &[&str]) -> Result<Vec<u8>> {
        let output = self
            .output(
                cwd,
                &args.iter().map(OsString::from).collect::<Vec<_>>(),
                None,
                None,
            )
            .await?;
        ensure!(output.status.success(), "{}", output.stderr.lossy_text());
        Ok(output.stdout.bytes)
    }
    async fn text(&self, cwd: &Path, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8(self.bytes(cwd, args).await?)
            .context("mission.invalid_git_text")?
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }

    async fn common_output(
        &self,
        workspace: &MissionWorkspace,
        args: &[OsString],
    ) -> Result<BoundedCommandOutput> {
        let common_dir = Path::new(&workspace.git_common_dir);
        ensure!(
            fs::canonicalize(common_dir)? == common_dir,
            "mission.repository_mismatch"
        );
        let mut scoped = vec!["--git-dir".into(), workspace.git_common_dir.clone().into()];
        scoped.extend_from_slice(args);
        self.output(common_dir, &scoped, None, None).await
    }
    pub async fn inspect(&self, directory: &Path) -> Result<Option<GitRepository>> {
        let output = self
            .output(
                directory,
                &["rev-parse".into(), "--is-inside-work-tree".into()],
                None,
                None,
            )
            .await?;
        if !output.status.success() {
            if output.stderr.lossy_text().contains("not a git repository")
                && !has_git_marker(directory)
            {
                return Ok(None);
            }
            bail!("mission.git_unavailable: {}", output.stderr.lossy_text());
        }
        ensure!(
            output.stdout.bytes.starts_with(b"true"),
            "mission.git_worktree_required"
        );
        let root = fs::canonicalize(
            self.text(directory, &["rev-parse", "--show-toplevel"])
                .await?,
        )?;
        let common_dir = fs::canonicalize(
            self.text(
                directory,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .await?,
        )?;
        let base_sha = self
            .text(directory, &["rev-parse", "--verify", "HEAD^{commit}"])
            .await
            .context("mission.base_unavailable")?;
        let branch = self
            .output(
                directory,
                &[
                    "symbolic-ref".into(),
                    "--quiet".into(),
                    "--short".into(),
                    "HEAD".into(),
                ],
                None,
                None,
            )
            .await?;
        let base_branch = if branch.status.success() {
            Some(
                String::from_utf8(branch.stdout.bytes)
                    .context("mission.invalid_git_text")?
                    .trim_end_matches(['\r', '\n'])
                    .to_string(),
            )
        } else if branch.status.code() == Some(1) {
            None
        } else {
            bail!("mission.git_unavailable: {}", branch.stderr.lossy_text());
        };
        let relative_directory = fs::canonicalize(directory)?
            .strip_prefix(&root)
            .context("mission.project_outside_repository")?
            .to_path_buf();
        Ok(Some(GitRepository {
            root,
            common_dir,
            base_branch,
            base_sha,
            relative_directory,
        }))
    }
    pub async fn candidate_available(
        &self,
        repo: &GitRepository,
        path: &Path,
        branch: &str,
    ) -> Result<bool> {
        if path_occupied(path)? {
            return Ok(false);
        }
        let output = self
            .output(
                &repo.root,
                &[
                    "show-ref".into(),
                    "--verify".into(),
                    "--quiet".into(),
                    format!("refs/heads/{branch}").into(),
                ],
                None,
                None,
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(false),
            Some(1) => Ok(true),
            _ => bail!("mission.git_failed: {}", output.stderr.lossy_text()),
        }
    }
    fn staging_root(workspace: &MissionWorkspace) -> Result<PathBuf> {
        Ok(Path::new(&workspace.repository_root)
            .parent()
            .context("mission.repository_parent_missing")?
            .join(format!(
                ".rovai-mission-prepare-{}",
                workspace.preparation_token
            )))
    }
    fn verify_staging_owner(root: &Path, workspace: &MissionWorkspace) -> Result<()> {
        ensure!(
            !fs::symlink_metadata(root)?.file_type().is_symlink(),
            "mission.staging_owner_mismatch"
        );
        ensure!(
            fs::read_to_string(root.join("owner"))? == workspace.preparation_token,
            "mission.staging_owner_mismatch"
        );
        Ok(())
    }
    async fn admin_dir(&self, path: &Path) -> Result<PathBuf> {
        fs::canonicalize(PathBuf::from(
            self.text(path, &["rev-parse", "--path-format=absolute", "--git-dir"])
                .await?,
        ))
        .context("mission.worktree_registration_missing")
    }
    async fn verify_tree(
        &self,
        path: &Path,
        workspace: &MissionWorkspace,
        require_marker: bool,
    ) -> Result<()> {
        ensure!(
            fs::canonicalize(path)? == path,
            "mission.worktree_path_changed"
        );
        ensure!(
            fs::canonicalize(self.text(path, &["rev-parse", "--show-toplevel"]).await?)? == path,
            "mission.worktree_root_mismatch"
        );
        ensure!(
            fs::canonicalize(
                self.text(
                    path,
                    &["rev-parse", "--path-format=absolute", "--git-common-dir"]
                )
                .await?
            )? == Path::new(&workspace.git_common_dir),
            "mission.repository_mismatch"
        );
        let admin = self.admin_dir(path).await?;
        ensure!(
            admin.starts_with(Path::new(&workspace.git_common_dir).join("worktrees")),
            "mission.worktree_registration_missing"
        );
        let registered = fs::read_to_string(admin.join("gitdir"))?;
        ensure!(
            fs::canonicalize(registered.trim_end_matches(['\r', '\n']))?
                == fs::canonicalize(path.join(".git"))?,
            "mission.worktree_registration_mismatch"
        );
        if require_marker {
            ensure!(
                fs::read_to_string(admin.join("rovai-mission-owner"))?
                    == workspace.preparation_token,
                "mission.worktree_owner_mismatch"
            );
        }
        Ok(())
    }
    /// A private staging parent proves ownership even across interruption before worktree registration.
    /// The final worktree carries that proof in Git's admin directory, outside tracked files.
    async fn materialize_with_branch(
        &self,
        workspace: &MissionWorkspace,
        create_branch: bool,
    ) -> Result<()> {
        let target = Path::new(&workspace.worktree_path);
        if path_occupied(target)? {
            if self.verify_tree(target, workspace, true).await.is_ok() {
                self.remove_empty_staging(workspace)?;
                return Ok(());
            }
            return Err(NameOccupied.into());
        }
        let staging = Self::staging_root(workspace)?;
        if staging.exists() {
            Self::verify_staging_owner(&staging, workspace)?;
        } else {
            fs::create_dir(&staging)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
            }
            fs::write(staging.join("owner"), &workspace.preparation_token)?;
        }
        let checkout = staging.join("checkout");
        if !checkout.exists() {
            let mut args = vec!["worktree".into(), "add".into(), "--no-guess-remote".into()];
            if create_branch {
                args.extend(["-b".into(), workspace.branch.clone().into()]);
            }
            args.push(checkout.as_os_str().to_owned());
            args.push(
                if create_branch {
                    workspace.base_sha.clone()
                } else {
                    workspace.branch.clone()
                }
                .into(),
            );
            let output = self
                .output(Path::new(&workspace.repository_root), &args, None, None)
                .await?;
            if !output.status.success() {
                let error = output.stderr.lossy_text();
                if create_branch
                    && error.contains("already exists")
                    && (error.contains("branch named")
                        || error.contains("reference already exists"))
                {
                    return Err(NameOccupied.into());
                }
                bail!(
                    "{}: {error}",
                    if create_branch {
                        "mission.worktree_create_failed"
                    } else {
                        "mission.worktree_restore_failed"
                    }
                );
            }
        }
        self.verify_tree(&checkout, workspace, false).await?;
        ensure!(
            self.text(&checkout, &["symbolic-ref", "--short", "HEAD"])
                .await?
                == workspace.branch,
            "mission.preparing_branch_mismatch"
        );
        let admin = self.admin_dir(&checkout).await?;
        let owner_path = admin.join("rovai-mission-owner");
        if owner_path.exists() {
            ensure!(
                fs::read_to_string(&owner_path)? == workspace.preparation_token,
                "mission.worktree_owner_mismatch"
            );
        } else {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&owner_path)?;
            file.write_all(workspace.preparation_token.as_bytes())?;
            file.sync_all()?;
        }
        let output = self
            .output(
                Path::new(&workspace.repository_root),
                &[
                    "worktree".into(),
                    "move".into(),
                    checkout.into_os_string(),
                    target.as_os_str().to_owned(),
                ],
                None,
                None,
            )
            .await?;
        if !output.status.success() {
            let error = output.stderr.lossy_text();
            if path_occupied(target)?
                && (error.contains("already exists") || error.contains("not empty"))
            {
                return Err(NameOccupied.into());
            }
            bail!("mission.worktree_move_failed: {error}");
        }
        self.verify_tree(target, workspace, true).await?;
        Self::verify_staging_owner(&staging, workspace)?;
        fs::remove_file(staging.join("owner"))?;
        fs::remove_dir(&staging)?;
        Ok(())
    }

    pub async fn materialize(&self, workspace: &MissionWorkspace) -> Result<()> {
        self.materialize_with_branch(workspace, true).await
    }

    pub async fn restore(&self, workspace: &MissionWorkspace) -> Result<()> {
        self.materialize_with_branch(workspace, false).await
    }
    fn remove_empty_staging(&self, workspace: &MissionWorkspace) -> Result<()> {
        let staging = Self::staging_root(workspace)?;
        if path_occupied(&staging)? {
            Self::verify_staging_owner(&staging, workspace)?;
            ensure!(
                !path_occupied(&staging.join("checkout"))?,
                "mission.preparing_checkout_remains"
            );
            fs::remove_file(staging.join("owner"))?;
            fs::remove_dir(staging)?;
        }
        Ok(())
    }
    pub async fn abandon_candidate(&self, workspace: &MissionWorkspace) -> Result<()> {
        let staging = Self::staging_root(workspace)?;
        if path_occupied(&staging)? {
            Self::verify_staging_owner(&staging, workspace)?;
            let checkout = staging.join("checkout");
            if path_occupied(&checkout)? {
                self.verify_tree(&checkout, workspace, false).await?;
                self.bytes(
                    Path::new(&workspace.repository_root),
                    &[
                        "worktree",
                        "remove",
                        "--force",
                        checkout.to_str().context("mission.invalid_path")?,
                    ],
                )
                .await?;
            }
            self.remove_empty_staging(workspace)?;
        }
        Ok(())
    }
    pub async fn validate_execution_workspace(&self, workspace: &MissionWorkspace) -> Result<()> {
        ensure!(workspace.state == "ready", "mission.workspace_not_ready");
        self.verify_tree(Path::new(&workspace.worktree_path), workspace, true)
            .await?;
        ensure!(
            fs::canonicalize(&workspace.working_directory)?
                == Path::new(&workspace.working_directory),
            "mission.working_directory_changed"
        );
        Ok(())
    }

    pub async fn observe_checkout(&self, workspace: &MissionWorkspace) -> MissionCheckoutState {
        let cwd = Path::new(&workspace.worktree_path);
        let head = match self
            .text(cwd, &["rev-parse", "--verify", "HEAD^{commit}"])
            .await
        {
            Ok(head) if !head.is_empty() => head,
            _ => return MissionCheckoutState::Unavailable,
        };
        let branch = match self
            .output(
                cwd,
                &[
                    "symbolic-ref".into(),
                    "--quiet".into(),
                    "--short".into(),
                    "HEAD".into(),
                ],
                None,
                None,
            )
            .await
        {
            Ok(branch) => branch,
            Err(_) => return MissionCheckoutState::Unavailable,
        };
        match branch.status.code() {
            Some(0) => match String::from_utf8(branch.stdout.bytes) {
                Ok(branch) => MissionCheckoutState::Branch {
                    branch: branch.trim_end_matches(['\r', '\n']).to_string(),
                    head,
                },
                Err(_) => MissionCheckoutState::Unavailable,
            },
            Some(1) => MissionCheckoutState::Detached { head },
            _ => MissionCheckoutState::Unavailable,
        }
    }
    pub async fn current_branch(&self, workspace: &MissionWorkspace) -> Result<Option<String>> {
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &[
                    "symbolic-ref".into(),
                    "--quiet".into(),
                    "--short".into(),
                    "HEAD".into(),
                ],
                None,
                None,
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(Some(
                String::from_utf8(output.stdout.bytes)?
                    .trim_end_matches(['\r', '\n'])
                    .into(),
            )),
            Some(1) => Ok(None),
            _ => bail!("mission.branch_unavailable"),
        }
    }

    pub fn worktree_exists(&self, workspace: &MissionWorkspace) -> Result<bool> {
        path_occupied(Path::new(&workspace.worktree_path))
    }

    fn valid_object_id(value: &str) -> bool {
        matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    fn parse_cleanup_observation(
        output: BoundedCommandOutput,
        includes_managed_branch: bool,
    ) -> Result<CleanupGitObservation> {
        ensure!(
            output.status.success(),
            "mission.cleanup_observation_unavailable: {}",
            output.stderr.lossy_text()
        );
        let text = String::from_utf8(output.stdout.bytes).context("mission.invalid_git_text")?;
        let fields = text
            .strip_suffix('\n')
            .unwrap_or(&text)
            .split('\n')
            .map(|field| field.strip_suffix('\r').unwrap_or(field))
            .collect::<Vec<_>>();
        let expected_fields = if includes_managed_branch { 6 } else { 5 };
        ensure!(
            fields.len() == expected_fields && fields.iter().all(|field| !field.is_empty()),
            "mission.cleanup_observation_invalid"
        );
        let head_index = 3;
        let managed_index = includes_managed_branch.then_some(4);
        let checkout_index = if includes_managed_branch { 5 } else { 4 };
        ensure!(
            Self::valid_object_id(fields[head_index]),
            "mission.cleanup_observation_invalid"
        );
        if let Some(index) = managed_index {
            ensure!(
                Self::valid_object_id(fields[index]),
                "mission.cleanup_observation_invalid"
            );
        }
        let checkout_reference = match fields[checkout_index] {
            "HEAD" => None,
            reference if reference.starts_with("refs/heads/") => Some(reference.to_string()),
            _ => bail!("mission.cleanup_observation_invalid"),
        };
        Ok(CleanupGitObservation {
            root: fields[0].into(),
            admin_dir: fs::canonicalize(fields[1])
                .context("mission.worktree_registration_missing")?,
            common_dir: fields[2].into(),
            head_oid: fields[head_index].to_string(),
            managed_branch_oid: managed_index.map(|index| fields[index].to_string()),
            checkout_reference,
        })
    }

    async fn cleanup_observation_query(
        &self,
        workspace: &MissionWorkspace,
        managed_reference: &str,
        includes_managed_branch: bool,
    ) -> Result<BoundedCommandOutput> {
        let mut arguments = vec![
            "rev-parse".into(),
            "--path-format=absolute".into(),
            "--show-toplevel".into(),
            "--git-dir".into(),
            "--git-common-dir".into(),
            "HEAD^{commit}".into(),
        ];
        if includes_managed_branch {
            arguments.push(format!("{managed_reference}^{{commit}}").into());
        }
        // rev-parse applies this output mode only to arguments that follow it.
        // Keeping it last yields object IDs above and the exact checkout ref here.
        arguments.extend(["--symbolic-full-name".into(), "HEAD".into()]);
        self.output(Path::new(&workspace.worktree_path), &arguments, None, None)
            .await
    }

    async fn observe_cleanup_state(
        &self,
        workspace: &MissionWorkspace,
        managed_reference: &str,
    ) -> Result<CleanupGitObservation> {
        if workspace.cleanup_branch_removed {
            return Self::parse_cleanup_observation(
                self.cleanup_observation_query(workspace, managed_reference, false)
                    .await?,
                false,
            );
        }
        let combined = self
            .cleanup_observation_query(workspace, managed_reference, true)
            .await?;
        if combined.status.success() {
            return Self::parse_cleanup_observation(combined, true);
        }
        // A missing managed ref is an allowed exceptional path. Re-run only the
        // identity/checkout query and distinguish absence from an invalid ref.
        let combined_error = combined.stderr.lossy_text();
        let mut observation = Self::parse_cleanup_observation(
            self.cleanup_observation_query(workspace, managed_reference, false)
                .await?,
            false,
        )?;
        if self
            .branch_oid_for_reference(workspace, managed_reference)
            .await?
            .is_some()
        {
            bail!("mission.branch_unavailable: {combined_error}");
        }
        observation.managed_branch_oid = None;
        Ok(observation)
    }

    fn verify_cleanup_filesystem_identity(
        workspace: &MissionWorkspace,
        admin_dir: &Path,
    ) -> Result<()> {
        let target = Path::new(&workspace.worktree_path);
        ensure!(
            fs::canonicalize(target)? == target,
            "mission.worktree_path_changed"
        );
        ensure!(
            fs::canonicalize(admin_dir)? == admin_dir
                && admin_dir.starts_with(Path::new(&workspace.git_common_dir).join("worktrees")),
            "mission.worktree_registration_missing"
        );
        let registered = fs::read_to_string(admin_dir.join("gitdir"))?;
        ensure!(
            fs::canonicalize(registered.trim_end_matches(['\r', '\n']))?
                == fs::canonicalize(target.join(".git"))?,
            "mission.worktree_registration_mismatch"
        );
        ensure!(
            fs::read_to_string(admin_dir.join("rovai-mission-owner"))?
                == workspace.preparation_token,
            "mission.worktree_owner_mismatch"
        );
        ensure!(
            fs::canonicalize(&workspace.working_directory)?
                == Path::new(&workspace.working_directory),
            "mission.working_directory_changed"
        );
        Ok(())
    }

    async fn detached_head_has_retained_reference(
        &self,
        workspace: &MissionWorkspace,
        managed_reference: &str,
        head: &str,
    ) -> Result<bool> {
        let output = self
            .common_output(
                workspace,
                &[
                    "for-each-ref".into(),
                    format!("--contains={head}").into(),
                    "--format=%(refname)".into(),
                ],
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.detached_head_reachability_unavailable: {}",
            output.stderr.lossy_text()
        );
        let references =
            String::from_utf8(output.stdout.bytes).context("mission.invalid_git_text")?;
        Ok(references
            .lines()
            .map(str::trim)
            .any(|reference| !reference.is_empty() && reference != managed_reference))
    }

    async fn verify_intact_execution_workspace(&self, workspace: &MissionWorkspace) -> Result<()> {
        self.verify_tree(Path::new(&workspace.worktree_path), workspace, true)
            .await?;
        ensure!(
            fs::canonicalize(&workspace.working_directory)?
                == Path::new(&workspace.working_directory),
            "mission.working_directory_changed"
        );
        Ok(())
    }

    pub(crate) async fn cleanup_failure_left_intact_workspace(
        &self,
        workspace: &MissionWorkspace,
    ) -> bool {
        path_occupied(Path::new(&workspace.worktree_path)).unwrap_or(false)
            && self
                .verify_intact_execution_workspace(workspace)
                .await
                .is_ok()
    }

    async fn validated_branch_reference(&self, workspace: &MissionWorkspace) -> Result<String> {
        let reference = format!("refs/heads/{}", workspace.branch);
        let valid = self
            .common_output(
                workspace,
                &[
                    "check-ref-format".into(),
                    "--branch".into(),
                    workspace.branch.clone().into(),
                ],
            )
            .await?;
        ensure!(valid.status.success(), "mission.branch_identity_invalid");
        Ok(reference)
    }

    pub(crate) async fn cleanup_branch_reference(
        &self,
        workspace: &MissionWorkspace,
    ) -> Result<String> {
        ensure!(
            fs::canonicalize(&workspace.repository_root)? == Path::new(&workspace.repository_root),
            "mission.repository_mismatch"
        );
        self.validated_branch_reference(workspace).await
    }

    pub(crate) async fn branch_oid_for_reference(
        &self,
        workspace: &MissionWorkspace,
        reference: &str,
    ) -> Result<Option<String>> {
        let output = self
            .common_output(
                workspace,
                &[
                    "show-ref".into(),
                    "--verify".into(),
                    "--hash".into(),
                    reference.to_string().into(),
                ],
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(Some(
                String::from_utf8(output.stdout.bytes)
                    .context("mission.invalid_git_text")?
                    .trim_end_matches(['\r', '\n'])
                    .to_string(),
            )),
            Some(1) => Ok(None),
            Some(128) if output.stderr.lossy_text().contains("not a valid ref") => Ok(None),
            _ => bail!("mission.branch_unavailable: {}", output.stderr.lossy_text()),
        }
    }

    pub async fn branch_oid(&self, workspace: &MissionWorkspace) -> Result<Option<String>> {
        let reference = self.validated_branch_reference(workspace).await?;
        self.branch_oid_for_reference(workspace, &reference).await
    }

    pub(crate) async fn branch_exists_for_reference(
        &self,
        workspace: &MissionWorkspace,
        reference: &str,
    ) -> Result<bool> {
        let output = self
            .common_output(
                workspace,
                &[
                    "show-ref".into(),
                    "--verify".into(),
                    "--quiet".into(),
                    reference.to_string().into(),
                ],
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => bail!("mission.branch_unavailable: {}", output.stderr.lossy_text()),
        }
    }

    pub async fn delete_branch_expected(
        &self,
        workspace: &MissionWorkspace,
        reference: &str,
        expected_oid: &str,
    ) -> Result<()> {
        let worktrees = self
            .common_output(
                workspace,
                &[
                    "worktree".into(),
                    "list".into(),
                    "--porcelain".into(),
                    "-z".into(),
                ],
            )
            .await?;
        ensure!(
            worktrees.status.success(),
            "mission.branch_unavailable: {}",
            worktrees.stderr.lossy_text()
        );
        let checkout_marker = format!("branch {reference}");
        ensure!(
            !worktrees
                .stdout
                .bytes
                .split(|byte| *byte == 0)
                .any(|field| field == checkout_marker.as_bytes()),
            "mission.branch_in_use"
        );
        let output = self
            .common_output(
                workspace,
                &[
                    "update-ref".into(),
                    "--no-deref".into(),
                    "-d".into(),
                    reference.to_string().into(),
                    expected_oid.into(),
                ],
            )
            .await?;
        if !output.status.success() {
            // A crash can happen after the conditional delete but before its durable checkpoint.
            // Missing is therefore an idempotent retry; a still-present ref failed the OID fence.
            if !self
                .branch_exists_for_reference(workspace, reference)
                .await?
            {
                return Ok(());
            }
            bail!("mission.branch_changed: {}", output.stderr.lossy_text());
        }
        Ok(())
    }

    pub(crate) async fn prepare_worktree_cleanup(
        &self,
        workspace: &MissionWorkspace,
    ) -> Result<VerifiedWorktreeCleanup> {
        let target = Path::new(&workspace.worktree_path);
        let target_present = path_occupied(target)?;
        let mut managed_reference = format!("refs/heads/{}", workspace.branch);
        let mut managed_branch_oid = None;
        let mut admin_dir = None;
        let mut detached_unreachable = false;
        let mut stale_registrations = Vec::new();
        if target_present {
            let observation = self
                .observe_cleanup_state(workspace, &managed_reference)
                .await?;
            ensure!(
                fs::canonicalize(&observation.root)? == target,
                "mission.worktree_root_mismatch"
            );
            ensure!(
                fs::canonicalize(&observation.common_dir)? == Path::new(&workspace.git_common_dir),
                "mission.repository_mismatch"
            );
            Self::verify_cleanup_filesystem_identity(workspace, &observation.admin_dir)?;
            if observation.checkout_reference.is_none()
                && !self
                    .detached_head_has_retained_reference(
                        workspace,
                        &managed_reference,
                        &observation.head_oid,
                    )
                    .await?
            {
                detached_unreachable = true;
            }
            managed_branch_oid = observation.managed_branch_oid;
            admin_dir = Some(observation.admin_dir);
        } else {
            managed_reference = self.cleanup_branch_reference(workspace).await?;
            if !workspace.cleanup_branch_removed {
                managed_branch_oid = self
                    .branch_oid_for_reference(workspace, &managed_reference)
                    .await?;
            }
            // Select only exact stale registrations carrying this workspace's owner marker.
            let registrations = Path::new(&workspace.git_common_dir).join("worktrees");
            if path_occupied(&registrations)? {
                ensure!(
                    fs::canonicalize(&registrations)? == registrations,
                    "mission.cleanup_registration_mismatch"
                );
                for entry in fs::read_dir(&registrations)? {
                    let entry = entry?;
                    ensure!(
                        !entry.file_type()?.is_symlink(),
                        "mission.cleanup_registration_mismatch"
                    );
                    let marker = entry.path().join("rovai-mission-owner");
                    if !path_occupied(&marker)? {
                        continue;
                    }
                    if fs::read_to_string(&marker)? != workspace.preparation_token {
                        continue;
                    }
                    let registered = fs::read_to_string(entry.path().join("gitdir"))?;
                    let expected_git_file = target.join(".git");
                    ensure!(
                        git_compatible_path(Path::new(registered.trim_end_matches(['\r', '\n'])))
                            == git_compatible_path(&expected_git_file),
                        "mission.cleanup_registration_mismatch"
                    );
                    stale_registrations.push(entry.path());
                }
            }
        }
        let staging = Self::staging_root(workspace)?;
        let mut staging_checkout_present = false;
        let staging_root = if staging.exists() {
            Self::verify_staging_owner(&staging, workspace)?;
            let checkout = staging.join("checkout");
            if checkout.exists() {
                self.verify_tree(&checkout, workspace, false).await?;
                ensure!(
                    self.text(&checkout, &["symbolic-ref", "--short", "HEAD"])
                        .await?
                        == workspace.branch,
                    "mission.workspace_branch_mismatch"
                );
                staging_checkout_present = true;
            }
            Some(staging)
        } else {
            None
        };
        if detached_unreachable {
            return Err(CleanupRefusal::new("mission.detached_head_unreachable", None).into());
        }
        Ok(VerifiedWorktreeCleanup {
            target_present,
            admin_dir,
            stale_registrations,
            staging_root,
            staging_checkout_present,
            managed_reference,
            managed_branch_oid,
        })
    }

    pub(crate) async fn remove_verified_worktree(
        &self,
        workspace: &MissionWorkspace,
        verified: &VerifiedWorktreeCleanup,
    ) -> Result<()> {
        if verified.target_present {
            let output = self
                .common_output(
                    workspace,
                    &[
                        "worktree".into(),
                        "remove".into(),
                        workspace.worktree_path.clone().into(),
                    ],
                )
                .await?;
            if !output.status.success() {
                let diagnostic = output.stderr.lossy_text();
                if diagnostic
                    .contains("contains modified or untracked files, use --force to delete it")
                    && verified.owned_worktree_intact(workspace)
                {
                    return Err(
                        CleanupRefusal::new("mission.workspace_dirty", Some(diagnostic)).into(),
                    );
                }
                bail!("mission.worktree_remove_failed: {diagnostic}");
            }
            ensure!(
                !path_occupied(Path::new(&workspace.worktree_path))?,
                "mission.worktree_remove_incomplete"
            );
        } else {
            for registration in &verified.stale_registrations {
                fs::remove_dir_all(registration)?;
            }
        }
        if let Some(staging) = verified.staging_root.as_ref() {
            let checkout = staging.join("checkout");
            if verified.staging_checkout_present {
                let output = self
                    .common_output(
                        workspace,
                        &[
                            "worktree".into(),
                            "remove".into(),
                            "--force".into(),
                            checkout.into_os_string(),
                        ],
                    )
                    .await?;
                ensure!(
                    output.status.success(),
                    "mission.staging_cleanup_failed: {}",
                    output.stderr.lossy_text()
                );
            }
            fs::remove_file(staging.join("owner"))?;
            fs::remove_dir(staging)?;
        }
        Ok(())
    }

    pub async fn cleanup(&self, workspace: &MissionWorkspace) -> Result<()> {
        let verified = self.prepare_worktree_cleanup(workspace).await?;
        self.remove_verified_worktree(workspace, &verified).await
    }

    async fn diff_metadata(&self, workspace: &MissionWorkspace) -> Result<MissionDiffMetadata> {
        ensure!(workspace.state == "ready", "mission.workspace_not_ready");
        ensure!(
            matches!(workspace.base_sha.len(), 40 | 64)
                && workspace
                    .base_sha
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit()),
            "mission.base_unavailable"
        );
        let cwd = Path::new(&workspace.worktree_path);
        ensure!(
            fs::canonicalize(cwd)? == cwd,
            "mission.worktree_path_changed"
        );
        ensure!(
            fs::canonicalize(&workspace.working_directory)?
                == Path::new(&workspace.working_directory),
            "mission.working_directory_changed"
        );
        let output = self
            .output(
                cwd,
                &[
                    "rev-parse".into(),
                    "--path-format=absolute".into(),
                    "--show-toplevel".into(),
                    "--git-dir".into(),
                    "--git-common-dir".into(),
                    "--git-path".into(),
                    "index".into(),
                    "--shared-index-path".into(),
                    "HEAD^{commit}".into(),
                    format!("{}^{{commit}}", workspace.base_sha).into(),
                    "--abbrev-ref=strict".into(),
                    "HEAD".into(),
                ],
                None,
                None,
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.base_unavailable: {}",
            output.stderr.lossy_text()
        );
        let text = String::from_utf8(output.stdout.bytes).context("mission.invalid_git_text")?;
        let fields = text.lines().collect::<Vec<_>>();
        ensure!(
            matches!(fields.len(), 7 | 8),
            "mission.invalid_git_metadata"
        );
        let split_index_offset = fields.len() - 7;
        let root = fs::canonicalize(fields[0])?;
        ensure!(root == cwd, "mission.worktree_root_mismatch");
        let common_dir = fs::canonicalize(fields[2])?;
        ensure!(
            common_dir == Path::new(&workspace.git_common_dir),
            "mission.repository_mismatch"
        );
        let admin = fs::canonicalize(fields[1])?;
        ensure!(
            admin.starts_with(common_dir.join("worktrees")),
            "mission.worktree_registration_missing"
        );
        let registered = fs::read_to_string(admin.join("gitdir"))?;
        ensure!(
            fs::canonicalize(registered.trim_end_matches(['\r', '\n']))?
                == fs::canonicalize(cwd.join(".git"))?,
            "mission.worktree_registration_mismatch"
        );
        ensure!(
            fs::read_to_string(admin.join("rovai-mission-owner"))? == workspace.preparation_token,
            "mission.worktree_owner_mismatch"
        );
        let head = fields[4 + split_index_offset].to_string();
        let base = fields[5 + split_index_offset];
        ensure!(base == workspace.base_sha, "mission.base_unavailable");
        let branch = fields[6 + split_index_offset];
        let checkout_state = if branch == "HEAD" {
            MissionCheckoutState::Detached { head }
        } else if branch.is_empty() {
            MissionCheckoutState::Unavailable
        } else {
            MissionCheckoutState::Branch {
                branch: branch.to_string(),
                head,
            }
        };
        let shared_index = (split_index_offset == 1 && !fields[4].is_empty()).then(|| {
            let path = PathBuf::from(fields[4]);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        });
        let index = PathBuf::from(fields[3]);
        ensure!(index.is_absolute(), "mission.invalid_index_path");
        Ok(MissionDiffMetadata {
            checkout_state,
            index,
            shared_index,
        })
    }

    async fn temporary_index(
        &self,
        workspace: &MissionWorkspace,
        metadata: &MissionDiffMetadata,
    ) -> Result<TemporaryIndex> {
        let temporary = TemporaryIndex::new()?;
        let cwd = Path::new(&workspace.worktree_path);
        if metadata.index.exists() {
            fs::copy(&metadata.index, &temporary.index)?;
            if let Some(shared) = &metadata.shared_index {
                fs::copy(
                    shared,
                    temporary
                        .root
                        .join(shared.file_name().context("mission.invalid_shared_index")?),
                )?;
            }
        } else {
            let output = self
                .output(
                    cwd,
                    &["read-tree".into(), "--empty".into()],
                    Some(&temporary.index),
                    None,
                )
                .await?;
            ensure!(output.status.success(), "mission.temporary_index_failed");
        }
        let prepared = self
            .output(
                cwd,
                &[
                    "-c".into(),
                    "core.splitIndex=false".into(),
                    "add".into(),
                    "-A".into(),
                    "-N".into(),
                    "--".into(),
                ],
                Some(&temporary.index),
                None,
            )
            .await?;
        ensure!(
            prepared.status.success(),
            "mission.temporary_index_failed: {}",
            prepared.stderr.lossy_text()
        );
        Ok(temporary)
    }
    async fn changes_with_index(
        &self,
        workspace: &MissionWorkspace,
        index: &Path,
    ) -> Result<Vec<MissionChangedFile>> {
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &[
                    "diff".into(),
                    "--no-ext-diff".into(),
                    "--no-textconv".into(),
                    "--find-renames".into(),
                    "--raw".into(),
                    "--numstat".into(),
                    "--no-abbrev".into(),
                    "-z".into(),
                    workspace.base_sha.clone().into(),
                    "--".into(),
                ],
                Some(index),
                None,
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.diff_failed: {}",
            output.stderr.lossy_text()
        );
        parse_changes(&output.stdout.bytes)
    }
    async fn prepare_diff_snapshot_from_metadata(
        &self,
        workspace: &MissionWorkspace,
        metadata: MissionDiffMetadata,
    ) -> Result<PreparedMissionDiff> {
        let checkout_state = metadata.checkout_state.clone();
        let temporary = self.temporary_index(workspace, &metadata).await?;
        let files = self.changes_with_index(workspace, &temporary.index).await?;
        Ok(PreparedMissionDiff::new(
            workspace,
            checkout_state,
            temporary,
            files,
        ))
    }
    pub(crate) async fn prepare_diff_snapshot_observed(
        &self,
        workspace: &MissionWorkspace,
    ) -> (MissionCheckoutState, Result<PreparedMissionDiff>) {
        let metadata = match self.diff_metadata(workspace).await {
            Ok(metadata) => metadata,
            Err(error) => return (self.observe_checkout(workspace).await, Err(error)),
        };
        let checkout_state = metadata.checkout_state.clone();
        let prepared = self
            .prepare_diff_snapshot_from_metadata(workspace, metadata)
            .await;
        (checkout_state, prepared)
    }
    pub async fn prepare_diff_snapshot(
        &self,
        workspace: &MissionWorkspace,
    ) -> Result<PreparedMissionDiff> {
        self.prepare_diff_snapshot_observed(workspace).await.1
    }
    pub async fn file_diff(
        &self,
        workspace: &MissionWorkspace,
        snapshot: &MissionDiffSnapshot,
        file_id: &str,
    ) -> Result<MissionFileDiff> {
        let current = self
            .prepare_diff_snapshot(workspace)
            .await
            .context("mission.changes_refresh_required")?;
        ensure!(
            snapshot.same_view(current.snapshot()),
            "mission.changes_refresh_required"
        );
        let file = current
            .snapshot()
            .file(file_id)
            .cloned()
            .context("mission.changes_refresh_required")?;
        if file.binary {
            return Ok(MissionFileDiff {
                file,
                patch: String::new(),
                hunks: Vec::new(),
            });
        }
        let mut args = vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "--find-renames".into(),
            "--unified=3".into(),
            workspace.base_sha.clone().into(),
            "--".into(),
        ];
        for path in &file.raw_paths {
            args.push(path_os_string(path)?);
        }
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &args,
                Some(current.index()),
                None,
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.diff_failed: {}",
            output.stderr.lossy_text()
        );
        let patch = String::from_utf8(output.stdout.bytes).context("mission.diff_not_utf8")?;
        let hunks = parse_hunks(&patch)?;
        Ok(MissionFileDiff { file, patch, hunks })
    }
}

const MISSION_DIFF_SNAPSHOT_LIMIT: usize = 12;
const MISSION_DIFF_SNAPSHOT_TTL: Duration = Duration::from_secs(10 * 60);

/// One current-workspace view of the Mission change list. It keeps no temporary
/// index or historical file content; file detail reads prepare a fresh index and
/// reject this view when the current checkout or list no longer matches it.
#[derive(Clone)]
pub struct MissionDiffSnapshot {
    view_id: String,
    workspace_id: String,
    worktree_path: String,
    workspace_generation: i64,
    checkout_state: MissionCheckoutState,
    files: Arc<Vec<MissionChangedFile>>,
    file_indices: Arc<BTreeMap<String, usize>>,
}
impl MissionDiffSnapshot {
    fn new(
        workspace: &MissionWorkspace,
        checkout_state: MissionCheckoutState,
        files: Vec<MissionChangedFile>,
    ) -> Self {
        let file_indices = files
            .iter()
            .enumerate()
            .map(|(index, file)| (file.id.clone(), index))
            .collect();
        Self {
            view_id: Uuid::new_v4().to_string(),
            workspace_id: workspace.id.clone(),
            worktree_path: workspace.worktree_path.clone(),
            workspace_generation: workspace.generation,
            checkout_state,
            files: Arc::new(files),
            file_indices: Arc::new(file_indices),
        }
    }
    pub fn files(&self) -> &[MissionChangedFile] {
        &self.files
    }
    pub fn view_id(&self) -> &str {
        &self.view_id
    }
    fn file(&self, file_id: &str) -> Option<&MissionChangedFile> {
        self.file_indices
            .get(file_id)
            .and_then(|index| self.files.get(*index))
    }
    fn matches_workspace(&self, workspace: &MissionWorkspace) -> bool {
        self.workspace_id == workspace.id
            && self.worktree_path == workspace.worktree_path
            && self.workspace_generation == workspace.generation
    }
    fn same_view(&self, other: &Self) -> bool {
        self.workspace_id == other.workspace_id
            && self.worktree_path == other.worktree_path
            && self.workspace_generation == other.workspace_generation
            && self.checkout_state == other.checkout_state
            && self.files == other.files
    }
}

pub struct PreparedMissionDiff {
    snapshot: MissionDiffSnapshot,
    temporary_index: TemporaryIndex,
}

impl PreparedMissionDiff {
    fn new(
        workspace: &MissionWorkspace,
        checkout_state: MissionCheckoutState,
        temporary_index: TemporaryIndex,
        files: Vec<MissionChangedFile>,
    ) -> Self {
        Self {
            snapshot: MissionDiffSnapshot::new(workspace, checkout_state, files),
            temporary_index,
        }
    }

    pub fn snapshot(&self) -> &MissionDiffSnapshot {
        &self.snapshot
    }

    pub fn into_snapshot(self) -> MissionDiffSnapshot {
        self.snapshot
    }

    fn index(&self) -> &Path {
        &self.temporary_index.index
    }
}

struct CachedMissionDiffSnapshot {
    mission_id: String,
    snapshot: MissionDiffSnapshot,
    last_used: Instant,
    sequence: u64,
}

/// Process-local, bounded request association. It contains neither a temporary
/// Git index nor historical file content.
#[derive(Default)]
pub struct MissionDiffSnapshotCache {
    // Keyed by view ID so a superseded list request that finishes late cannot
    // overwrite the association returned by a newer request.
    entries: BTreeMap<String, CachedMissionDiffSnapshot>,
    sequence: u64,
}
impl MissionDiffSnapshotCache {
    pub fn insert(&mut self, mission_id: String, snapshot: MissionDiffSnapshot) {
        self.prune_expired();
        self.sequence = self.sequence.wrapping_add(1);
        let view_id = snapshot.view_id.clone();
        self.entries.insert(
            view_id,
            CachedMissionDiffSnapshot {
                mission_id,
                snapshot,
                last_used: Instant::now(),
                sequence: self.sequence,
            },
        );
        while self.entries.len() > MISSION_DIFF_SNAPSHOT_LIMIT {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.sequence)
                .map(|(view_id, _)| view_id.clone())
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }
    pub fn get(
        &mut self,
        mission_id: &str,
        workspace: &MissionWorkspace,
        view_id: &str,
    ) -> Option<MissionDiffSnapshot> {
        self.prune_expired();
        let entry = self.entries.get(view_id)?;
        if entry.mission_id != mission_id {
            return None;
        }
        if !entry.snapshot.matches_workspace(workspace) {
            self.entries.remove(view_id);
            return None;
        }
        let entry = self.entries.get_mut(view_id)?;
        self.sequence = self.sequence.wrapping_add(1);
        entry.last_used = Instant::now();
        entry.sequence = self.sequence;
        Some(entry.snapshot.clone())
    }
    pub fn release(&mut self, mission_id: &str) -> bool {
        let before = self.entries.len();
        self.entries
            .retain(|_, entry| entry.mission_id != mission_id);
        self.entries.len() != before
    }
    fn prune_expired(&mut self) {
        let now = Instant::now();
        self.entries.retain(|_, entry| {
            now.saturating_duration_since(entry.last_used) < MISSION_DIFF_SNAPSHOT_TTL
        });
    }
}

#[derive(Debug)]
pub struct NameOccupied;
impl std::fmt::Display for NameOccupied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("mission.workspace_name_occupied")
    }
}
impl std::error::Error for NameOccupied {}
fn path_occupied(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub fn has_git_marker(path: &Path) -> bool {
    path.ancestors().any(|p| {
        fs::symlink_metadata(p.join(".git")).is_ok()
            || (p.join("HEAD").is_file() && p.join("objects").is_dir())
    })
}
pub fn load_workspaces(connection: &Connection, mission_id: &str) -> Result<Vec<MissionWorkspace>> {
    let mut stmt=connection.prepare("SELECT id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,preparation_kind,generation,state,cleanup_command_id,cleanup_expected_branch_oid,cleanup_worktree_removed,cleanup_branch_removed,diagnostic FROM mission_workspace WHERE mission_id=?1 ORDER BY created_at,id")?;
    Ok(stmt
        .query_map([mission_id], |r| {
            Ok(MissionWorkspace {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                camp_id: r.get(2)?,
                execution_host_id: r.get(3)?,
                source_directory: r.get(4)?,
                repository_root: r.get(5)?,
                git_common_dir: r.get(6)?,
                worktree_path: r.get(7)?,
                working_directory: r.get(8)?,
                base_branch: r.get(9)?,
                branch: r.get(10)?,
                base_sha: r.get(11)?,
                preparation_token: r.get(12)?,
                preparation_kind: r.get(13)?,
                generation: r.get(14)?,
                state: r.get(15)?,
                cleanup_command_id: r.get(16)?,
                cleanup_expected_branch_oid: r.get(17)?,
                cleanup_worktree_removed: r.get(18)?,
                cleanup_branch_removed: r.get(19)?,
                diagnostic: r.get(20)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
pub fn persist_plan(connection: &Connection, workspace: &MissionWorkspace) -> Result<()> {
    connection.execute("INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,preparation_kind,generation,state,cleanup_command_id,cleanup_expected_branch_oid,cleanup_worktree_removed,cleanup_branch_removed,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'preparing',?16,?17,?18,?19,?20,?20)",params![workspace.id,workspace.mission_id,workspace.camp_id,workspace.execution_host_id,workspace.source_directory,workspace.repository_root,workspace.git_common_dir,workspace.worktree_path,workspace.working_directory,workspace.base_branch,workspace.branch,workspace.base_sha,workspace.preparation_token,workspace.preparation_kind,workspace.generation,workspace.cleanup_command_id,workspace.cleanup_expected_branch_oid,workspace.cleanup_worktree_removed,workspace.cleanup_branch_removed,chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}
pub fn execution_directory(connection: &Connection, camp_id: &str) -> Result<Option<String>> {
    Ok(connection.query_row("SELECT w.working_directory FROM mission_workspace w JOIN mission m ON m.id=w.mission_id WHERE m.camp_id=?1 AND w.state='ready' ORDER BY w.created_at LIMIT 1",[camp_id],|r|r.get(0)).optional()?)
}

pub fn workspace_in_use(connection: &Connection, workspace: &MissionWorkspace) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM agent_run r
            JOIN conversation c ON c.id=r.conversation_id
            WHERE (
                c.camp_id=?1
                OR json_extract(r.workspace_json,'$.executionRoot')=?2
            )
              AND (
                r.status IN ('queued','running','waiting')
                OR (r.cancel_requested_at IS NOT NULL AND r.cancel_acknowledged_at IS NULL)
              )
            UNION ALL
            SELECT 1
            FROM camp_message_delivery d
            WHERE d.camp_id=?1 AND d.status='waiting'
        )",
        params![workspace.camp_id, workspace.working_directory],
        |row| row.get(0),
    )?)
}

pub fn cleanup_projection(
    connection: &Connection,
    mission_id: &str,
    camp_id: &str,
) -> Result<(bool, bool, bool, Option<MissionWorkspaceCleanupProjection>)> {
    let workspaces = load_workspaces(connection, mission_id)?;
    let Some(workspace) = workspaces.first() else {
        return Ok((false, false, false, None));
    };
    let resources_present = workspace.managed_resources_remain();
    let current_host: String = connection.query_row(
        "SELECT id FROM mission_execution_host WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let available = resources_present
        && workspace.execution_host_id == current_host
        && workspace.camp_id == camp_id
        && workspace.state == "ready"
        && !workspace_in_use(connection, workspace)?;
    let cleanup = if workspace.cleanup_finished() {
        Some(MissionWorkspaceCleanupProjection {
            state: "cleaned".into(),
            worktree_removed: true,
            branch_removed: true,
            diagnostic: None,
        })
    } else if workspace.state == "cleanup_pending" {
        Some(MissionWorkspaceCleanupProjection {
            state: "cleaning".into(),
            worktree_removed: workspace.cleanup_worktree_removed,
            branch_removed: workspace.cleanup_branch_removed,
            diagnostic: None,
        })
    } else if workspace.state == "cleanup_failed"
        || (workspace.state == "ready" && workspace.diagnostic.is_some())
    {
        Some(MissionWorkspaceCleanupProjection {
            state: "failed".into(),
            worktree_removed: workspace.cleanup_worktree_removed,
            branch_removed: workspace.cleanup_branch_removed,
            diagnostic: workspace.diagnostic.clone(),
        })
    } else {
        None
    };
    Ok((true, resources_present, available, cleanup))
}

struct TemporaryIndex {
    root: PathBuf,
    index: PathBuf,
}
impl TemporaryIndex {
    fn new() -> Result<Self> {
        let root = std::env::temp_dir().join(format!("rovai-mission-index-{}", Uuid::new_v4()));
        fs::create_dir(&root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self {
            index: root.join("index"),
            root,
        })
    }
}
impl Drop for TemporaryIndex {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionChangedFile {
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub kind: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    pub old_mode: String,
    pub new_mode: String,
    #[serde(skip)]
    raw_paths: Vec<Vec<u8>>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionFileDiff {
    pub file: MissionChangedFile,
    pub patch: String,
    pub hunks: Vec<DiffHunk>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u64,
    pub new_start: u64,
    pub lines: Vec<DiffLine>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
    pub old_line: Option<u64>,
    pub new_line: Option<u64>,
}

fn parse_changes(bytes: &[u8]) -> Result<Vec<MissionChangedFile>> {
    let tokens = bytes.split(|b| *b == 0).collect::<Vec<_>>();
    let mut i = 0;
    let mut files = Vec::new();
    let mut indices = BTreeMap::new();
    while i < tokens.len() && tokens[i].starts_with(b":") {
        let fields = std::str::from_utf8(&tokens[i][1..])?
            .split_whitespace()
            .collect::<Vec<_>>();
        ensure!(fields.len() == 5, "mission.invalid_raw_diff");
        i += 1;
        let first = tokens.get(i).context("mission.invalid_raw_path")?.to_vec();
        i += 1;
        let (path, old_path, raw_paths) = if fields[4].starts_with(['R', 'C']) {
            let next = tokens.get(i).context("mission.invalid_rename")?.to_vec();
            i += 1;
            (
                next.clone(),
                Some(String::from_utf8_lossy(&first).into_owned()),
                vec![first, next],
            )
        } else {
            (first.clone(), None, vec![first])
        };
        let id = format!("{:x}", Sha256::digest(&path));
        let kind = match fields[4].as_bytes()[0] {
            b'A' => "added",
            b'D' => "deleted",
            b'R' => "renamed",
            b'C' => "copied",
            b'T' => "type_changed",
            b'U' => "unmerged",
            _ => "modified",
        };
        indices.insert(path.clone(), files.len());
        files.push(MissionChangedFile {
            id,
            path: String::from_utf8_lossy(&path).into_owned(),
            old_path,
            kind: kind.into(),
            additions: Some(0),
            deletions: Some(0),
            binary: false,
            old_mode: fields[0].into(),
            new_mode: fields[1].into(),
            raw_paths,
        });
    }
    while i < tokens.len() && !tokens[i].is_empty() {
        let fields = tokens[i].splitn(3, |b| *b == b'\t').collect::<Vec<_>>();
        ensure!(fields.len() == 3, "mission.invalid_numstat");
        i += 1;
        let path = if fields[2].is_empty() {
            let next = tokens
                .get(i + 1)
                .context("mission.invalid_numstat_rename")?;
            i += 2;
            *next
        } else {
            fields[2]
        };
        let file = &mut files[*indices
            .get(path)
            .context("mission.diff_changed_during_query")?];
        file.binary = fields[0] == b"-" || fields[1] == b"-";
        file.additions = if file.binary {
            None
        } else {
            Some(std::str::from_utf8(fields[0])?.parse()?)
        };
        file.deletions = if file.binary {
            None
        } else {
            Some(std::str::from_utf8(fields[1])?.parse()?)
        };
    }
    Ok(files)
}
fn path_os_string(bytes: &[u8]) -> Result<OsString> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(OsString::from_vec(bytes.to_vec()))
    }
    #[cfg(not(unix))]
    {
        Ok(OsString::from(std::str::from_utf8(bytes)?))
    }
}
fn parse_hunks(patch: &str) -> Result<Vec<DiffHunk>> {
    let mut hunks = Vec::<DiffHunk>::new();
    let mut old = 0;
    let mut new = 0;
    for line in patch.lines() {
        if line.starts_with("@@ ") {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            ensure!(fields.len() >= 4, "mission.invalid_diff_hunk");
            old = fields[1]
                .trim_start_matches('-')
                .split(',')
                .next()
                .context("mission.invalid_diff_hunk")?
                .parse()?;
            new = fields[2]
                .trim_start_matches('+')
                .split(',')
                .next()
                .context("mission.invalid_diff_hunk")?
                .parse()?;
            hunks.push(DiffHunk {
                old_start: old,
                new_start: new,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = hunks.last_mut() {
            let (kind, old_line, new_line) = match line.as_bytes().first() {
                Some(b'+') => {
                    let n = new;
                    new += 1;
                    ("addition", None, Some(n))
                }
                Some(b'-') => {
                    let n = old;
                    old += 1;
                    ("deletion", Some(n), None)
                }
                Some(b' ') => {
                    let o = old;
                    let n = new;
                    old += 1;
                    new += 1;
                    ("context", Some(o), Some(n))
                }
                Some(b'\\') => ("metadata", None, None),
                _ => continue,
            };
            hunk.lines.push(DiffLine {
                kind: kind.into(),
                text: line[1..].to_string(),
                old_line,
                new_line,
            });
        }
    }
    Ok(hunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    async fn fixture() -> (Fixture, MissionGit, GitRepository, MissionWorkspace) {
        let git = MissionGit::new(
            crate::runtime_discovery::resolve_active_command_path("git")
                .expect("Git required for real worktree test"),
        )
        .unwrap();
        let root = std::env::temp_dir().join(format!("rovai-mission-git-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let repo = root.join("app");
        fs::create_dir(&repo).unwrap();
        git.bytes(&repo, &["init", "-b", "main"]).await.unwrap();
        git.bytes(&repo, &["config", "user.name", "Mission Test"])
            .await
            .unwrap();
        git.bytes(&repo, &["config", "user.email", "mission@example.invalid"])
            .await
            .unwrap();
        git.bytes(&repo, &["config", "core.autocrlf", "false"])
            .await
            .unwrap();
        for (name, body) in [
            ("edit.txt", "original\n"),
            ("remove.txt", "remove\n"),
            ("rename.txt", "stable rename\n"),
            ("mode.sh", "echo test\n"),
            (".gitignore", "ignored/\n"),
        ] {
            fs::write(repo.join(name), body).unwrap();
        }
        fs::create_dir(repo.join("src")).unwrap();
        fs::write(repo.join("src/keep.txt"), "keep\n").unwrap();
        git.bytes(&repo, &["add", "."]).await.unwrap();
        git.bytes(&repo, &["commit", "-m", "base"]).await.unwrap();
        let repository = git.inspect(&repo.join("src")).await.unwrap().unwrap();
        let path = root.join("app-mission-rvm_test");
        let workspace = MissionWorkspace {
            id: "ws".into(),
            mission_id: "rvm_test".into(),
            camp_id: "camp".into(),
            execution_host_id: "host".into(),
            source_directory: repo.join("src").to_str().unwrap().into(),
            repository_root: repo.to_str().unwrap().into(),
            git_common_dir: repository.common_dir.to_str().unwrap().into(),
            worktree_path: path.to_str().unwrap().into(),
            working_directory: path.join("src").to_str().unwrap().into(),
            base_branch: repository.base_branch.clone(),
            branch: "rovai/mission/rvm_test".into(),
            base_sha: repository.base_sha.clone(),
            preparation_token: Uuid::new_v4().to_string(),
            preparation_kind: "create".into(),
            generation: 1,
            state: "preparing".into(),
            cleanup_command_id: None,
            cleanup_expected_branch_oid: None,
            cleanup_worktree_removed: false,
            cleanup_branch_removed: false,
            diagnostic: None,
        };
        (Fixture(root), git, repository, workspace)
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_materialize_accepts_a_verbatim_canonical_repository_path() {
        let (_fixture, git, _repo, mut workspace) = fixture().await;
        assert!(workspace.repository_root.starts_with(r"\\?\"));

        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate_execution_workspace(&workspace).await.unwrap();
        git.cleanup(&workspace).await.unwrap();
    }

    #[tokio::test]
    async fn persistent_worktree_preserves_source_recovers_owned_creation_and_retains_branch_on_delete()
     {
        let (_fixture, git, repo, mut workspace) = fixture().await;
        fs::write(repo.root.join("edit.txt"), "source dirty\n").unwrap();
        assert!(
            git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        fs::create_dir(&workspace.worktree_path).unwrap();
        fs::write(
            Path::new(&workspace.worktree_path).join("unrelated"),
            "preserve",
        )
        .unwrap();
        assert!(
            !git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        assert!(
            git.materialize(&workspace)
                .await
                .unwrap_err()
                .is::<NameOccupied>()
        );
        assert_eq!(
            fs::read_to_string(Path::new(&workspace.worktree_path).join("unrelated")).unwrap(),
            "preserve"
        );
        fs::remove_dir_all(&workspace.worktree_path).unwrap();
        // Simulate interruption after Git registered the tree, before Core wrote the admin marker.
        let staging = MissionGit::staging_root(&workspace).unwrap();
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("owner"), &workspace.preparation_token).unwrap();
        git.bytes(
            &repo.root,
            &[
                "worktree",
                "add",
                "-b",
                &workspace.branch,
                staging.join("checkout").to_str().unwrap(),
                &workspace.base_sha,
            ],
        )
        .await
        .unwrap();
        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate_execution_workspace(&workspace).await.unwrap();
        git.materialize(&workspace).await.unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&workspace.worktree_path).join("edit.txt")).unwrap(),
            "original\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("edit.txt")).unwrap(),
            "source dirty\n"
        );
        git.clear_invocations();
        let verified = git.prepare_worktree_cleanup(&workspace).await.unwrap();
        let expected_oid = verified.managed_branch_oid().unwrap().to_string();
        let managed_reference = verified.managed_reference().to_string();
        git.remove_verified_worktree(&workspace, &verified)
            .await
            .unwrap();
        git.delete_branch_expected(&workspace, &managed_reference, &expected_oid)
            .await
            .unwrap();
        let cleanup_calls = git.take_invocations();
        assert_eq!(
            cleanup_calls.len(),
            4,
            "ordinary cleanup must use one observation, worktree removal, occupancy check and conditional ref deletion: {cleanup_calls:#?}"
        );
        assert_eq!(cleanup_calls[0][0], "rev-parse");
        assert!(
            cleanup_calls[1]
                .windows(2)
                .any(|args| args == ["worktree", "remove"])
        );
        assert!(
            cleanup_calls[2]
                .windows(2)
                .any(|args| args == ["worktree", "list"])
        );
        assert!(cleanup_calls[3].iter().any(|arg| arg == "update-ref"));
        assert!(cleanup_calls[3].iter().any(|arg| arg == "--no-deref"));
        assert!(!Path::new(&workspace.worktree_path).exists());
        git.bytes(&repo.root, &["branch", &workspace.branch, &expected_oid])
            .await
            .unwrap();
        workspace.preparation_token = Uuid::new_v4().to_string();
        workspace.preparation_kind = "restore".into();
        workspace.state = "preparing".into();
        git.restore(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate_execution_workspace(&workspace).await.unwrap();
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["checkout", "--detach"],
        )
        .await
        .unwrap();
        assert_eq!(git.current_branch(&workspace).await.unwrap(), None);
        assert!(matches!(
            git.observe_checkout(&workspace).await,
            MissionCheckoutState::Detached { .. }
        ));
        git.validate_execution_workspace(&workspace).await.unwrap();
        let reference = git.cleanup_branch_reference(&workspace).await.unwrap();
        git.prepare_worktree_cleanup(&workspace).await.unwrap();
        fs::write(
            Path::new(&workspace.worktree_path).join("detached-result.txt"),
            "detached\n",
        )
        .unwrap();
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["add", "detached-result.txt"],
        )
        .await
        .unwrap();
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["commit", "-m", "detached result"],
        )
        .await
        .unwrap();
        assert!(
            git.prepare_worktree_cleanup(&workspace)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.detached_head_unreachable")
        );
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["branch", "external/detached-preserved"],
        )
        .await
        .unwrap();
        git.prepare_worktree_cleanup(&workspace).await.unwrap();
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["checkout", &workspace.branch],
        )
        .await
        .unwrap();
        git.bytes(&repo.root, &["branch", "-D", "external/detached-preserved"])
            .await
            .unwrap();
        git.validate_execution_workspace(&workspace).await.unwrap();
        let managed_oid = git.branch_oid(&workspace).await.unwrap().unwrap();
        let worktree = Path::new(&workspace.worktree_path);
        git.bytes(worktree, &["switch", "-c", "external/validation"])
            .await
            .unwrap();
        fs::write(worktree.join("external-untracked.txt"), "preserve\n").unwrap();
        git.bytes(&repo.root, &["branch", "-D", &workspace.branch])
            .await
            .unwrap();
        assert!(git.branch_oid(&workspace).await.unwrap().is_none());
        git.validate_execution_workspace(&workspace).await.unwrap();
        assert!(matches!(
            git.observe_checkout(&workspace).await,
            MissionCheckoutState::Branch { branch, .. } if branch == "external/validation"
        ));
        assert!(
            git.cleanup(&workspace)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.workspace_dirty")
        );
        assert_eq!(
            fs::read_to_string(worktree.join("external-untracked.txt")).unwrap(),
            "preserve\n"
        );
        git.bytes(worktree, &["add", "external-untracked.txt"])
            .await
            .unwrap();
        git.bytes(worktree, &["commit", "-m", "preserve external result"])
            .await
            .unwrap();
        let external_oid = git
            .text(worktree, &["rev-parse", "HEAD^{commit}"])
            .await
            .unwrap();
        git.cleanup(&workspace).await.unwrap();
        assert!(!worktree.exists());
        assert_eq!(
            git.text(&repo.root, &["rev-parse", "external/validation^{commit}"])
                .await
                .unwrap(),
            external_oid
        );
        git.bytes(&repo.root, &["branch", &workspace.branch, &managed_oid])
            .await
            .unwrap();
        workspace.preparation_token = Uuid::new_v4().to_string();
        workspace.preparation_kind = "restore".into();
        workspace.state = "preparing".into();
        git.restore(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate_execution_workspace(&workspace).await.unwrap();
        git.bytes(&repo.root, &["branch", "-D", "external/validation"])
            .await
            .unwrap();
        let admin = git.admin_dir(worktree).await.unwrap();
        let head_path = admin.join("HEAD");
        let head_contents = fs::read(&head_path).unwrap();
        fs::write(
            &head_path,
            "ref: refs/heads/checkout-observation-unavailable\n",
        )
        .unwrap();
        assert_eq!(
            git.observe_checkout(&workspace).await,
            MissionCheckoutState::Unavailable
        );
        git.validate_execution_workspace(&workspace).await.unwrap();
        fs::write(&head_path, head_contents).unwrap();
        let expected = git.branch_oid(&workspace).await.unwrap().unwrap();
        fs::remove_dir_all(&workspace.worktree_path).unwrap();
        assert!(
            git.delete_branch_expected(&workspace, &reference, &expected)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.branch_in_use")
        );
        fs::write(&head_path, "ref: refs/heads/external/stale-registration\n").unwrap();
        git.cleanup(&workspace).await.unwrap();
        assert!(!Path::new(&workspace.worktree_path).exists());
        assert_eq!(
            git.branch_oid(&workspace).await.unwrap().as_deref(),
            Some(expected.as_str())
        );
        assert!(
            !git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        git.cleanup(&workspace).await.unwrap();
        git.delete_branch_expected(&workspace, &reference, &expected)
            .await
            .unwrap();
        git.delete_branch_expected(&workspace, &reference, &expected)
            .await
            .unwrap();
        assert!(git.branch_oid(&workspace).await.unwrap().is_none());
        assert!(
            git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        assert!(git.validate_execution_workspace(&workspace).await.is_err());
        let non_git = repo.root.parent().unwrap().join("plain");
        fs::create_dir(&non_git).unwrap();
        assert!(git.inspect(&non_git).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn restore_keeps_branch_content_and_expected_oid_fences_branch_deletion() {
        let (_fixture, git, repo, mut workspace) = fixture().await;
        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        let worktree = PathBuf::from(&workspace.worktree_path);
        fs::write(worktree.join("mission-result.txt"), "kept\n").unwrap();
        git.bytes(&worktree, &["add", "mission-result.txt"])
            .await
            .unwrap();
        git.bytes(&worktree, &["commit", "-m", "mission result"])
            .await
            .unwrap();
        let expected = git.branch_oid(&workspace).await.unwrap().unwrap();
        let reference = git.cleanup_branch_reference(&workspace).await.unwrap();

        git.cleanup(&workspace).await.unwrap();
        assert!(!worktree.exists());
        workspace.preparation_token = Uuid::new_v4().to_string();
        workspace.preparation_kind = "restore".into();
        workspace.state = "preparing".into();
        git.restore(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate_execution_workspace(&workspace).await.unwrap();
        assert_eq!(
            fs::read_to_string(worktree.join("mission-result.txt")).unwrap(),
            "kept\n"
        );

        git.cleanup(&workspace).await.unwrap();
        let other = repo.root.parent().unwrap().join("other-worktree");
        git.bytes(
            &repo.root,
            &[
                "worktree",
                "add",
                other.to_str().unwrap(),
                &workspace.branch,
            ],
        )
        .await
        .unwrap();
        assert!(
            git.delete_branch_expected(&workspace, &reference, &expected)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.branch_in_use")
        );
        git.bytes(
            &repo.root,
            &["worktree", "remove", "--force", other.to_str().unwrap()],
        )
        .await
        .unwrap();
        fs::write(repo.root.join("replacement.txt"), "replacement\n").unwrap();
        git.bytes(&repo.root, &["add", "replacement.txt"])
            .await
            .unwrap();
        git.bytes(&repo.root, &["commit", "-m", "replacement"])
            .await
            .unwrap();
        let replacement = git
            .text(&repo.root, &["rev-parse", "HEAD^{commit}"])
            .await
            .unwrap();
        git.bytes(
            &repo.root,
            &[
                "update-ref",
                &format!("refs/heads/{}", workspace.branch),
                &replacement,
                &expected,
            ],
        )
        .await
        .unwrap();
        assert!(
            git.delete_branch_expected(&workspace, &reference, &expected)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.branch_changed")
        );
        assert_eq!(
            git.branch_oid(&workspace).await.unwrap().as_deref(),
            Some(replacement.as_str())
        );
        git.delete_branch_expected(&workspace, &reference, &replacement)
            .await
            .unwrap();
        assert!(git.branch_oid(&workspace).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn fixed_base_diff_is_final_net_content_without_mutating_real_index() {
        let (_fixture, git, _repo, mut workspace) = fixture().await;
        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        let cwd = Path::new(&workspace.worktree_path);
        fs::write(cwd.join("edit.txt"), "committed\n").unwrap();
        git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
        git.bytes(cwd, &["commit", "-m", "mission commit"])
            .await
            .unwrap();
        fs::write(cwd.join("edit.txt"), "staged\n").unwrap();
        git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
        fs::write(cwd.join("edit.txt"), "final\n").unwrap();
        git.bytes(cwd, &["mv", "rename.txt", "renamed.txt"])
            .await
            .unwrap();
        fs::remove_file(cwd.join("remove.txt")).unwrap();
        let special_name = if cfg!(windows) {
            "space 中文 file"
        } else {
            "tab\t中文\nfile"
        };
        for (name, body) in [
            ("new.txt", b"new\n".as_slice()),
            (special_name, b"special\n"),
            ("empty", b""),
            ("binary", b"a\0b"),
        ] {
            fs::write(cwd.join(name), body).unwrap();
        }
        fs::create_dir(cwd.join("ignored")).unwrap();
        fs::write(cwd.join("ignored/hidden"), "ignore").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(cwd.join("mode.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        git.bytes(cwd, &["update-index", "--split-index"])
            .await
            .unwrap();
        let index = git
            .text(
                cwd,
                &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            )
            .await
            .unwrap();
        let before = fs::read(&index).unwrap();
        let head = git.text(cwd, &["rev-parse", "HEAD"]).await.unwrap();
        git.reset_command_count();
        let read_started_at = Instant::now();
        let snapshot = git
            .prepare_diff_snapshot(&workspace)
            .await
            .unwrap()
            .into_snapshot();
        let read_elapsed = read_started_at.elapsed();
        assert_eq!(
            git.command_count(),
            3,
            "normal split-index changes read must use metadata, temporary-index preparation and diff only"
        );
        eprintln!(
            "mission changes fixture: commands={} elapsed_ms={}",
            git.command_count(),
            read_elapsed.as_millis()
        );
        let files = snapshot.files();
        for name in [
            "edit.txt",
            "renamed.txt",
            "remove.txt",
            "new.txt",
            special_name,
            "empty",
            "binary",
        ] {
            assert!(
                files.iter().any(|f| f.path == name),
                "missing {name}: {files:?}"
            );
        }
        assert!(files.iter().all(|f| !f.path.starts_with("ignored/")));
        assert!(files.iter().find(|f| f.path == "binary").unwrap().binary);
        assert_eq!(
            files
                .iter()
                .find(|f| f.path == "renamed.txt")
                .unwrap()
                .old_path
                .as_deref(),
            Some("rename.txt")
        );
        let edit = files.iter().find(|f| f.path == "edit.txt").unwrap().clone();
        assert_eq!((edit.additions, edit.deletions), (Some(1), Some(1)));
        let diff = git
            .file_diff(&workspace, &snapshot, &edit.id)
            .await
            .unwrap();
        assert!(diff.patch.contains("-original\n+final"));
        assert!(!diff.patch.contains("staged"));
        assert_eq!(diff.hunks[0].lines[0].old_line, Some(1));
        let renamed = files
            .iter()
            .find(|f| f.path == "renamed.txt")
            .unwrap()
            .clone();
        let renamed_diff = git
            .file_diff(&workspace, &snapshot, &renamed.id)
            .await
            .unwrap();
        assert!(renamed_diff.patch.contains("a/rename.txt"));
        assert!(renamed_diff.patch.contains("b/renamed.txt"));
        assert_eq!(fs::read(&index).unwrap(), before);
        assert_eq!(git.text(cwd, &["rev-parse", "HEAD"]).await.unwrap(), head);
        fs::write(cwd.join("edit.txt"), "original\n").unwrap();
        let refreshed = git
            .prepare_diff_snapshot(&workspace)
            .await
            .unwrap()
            .into_snapshot();
        assert!(!refreshed.files().iter().any(|f| f.path == "edit.txt"));
        assert!(
            git.file_diff(&workspace, &snapshot, &edit.id)
                .await
                .is_err()
        );
        fs::write(cwd.join("staged-after-refresh.txt"), "staged\n").unwrap();
        git.bytes(cwd, &["add", "staged-after-refresh.txt"])
            .await
            .unwrap();
        fs::write(cwd.join("src/keep.txt"), "unstaged\n").unwrap();
        fs::write(cwd.join("untracked-after-refresh.txt"), "untracked\n").unwrap();
        let same_head_refresh = git
            .prepare_diff_snapshot(&workspace)
            .await
            .unwrap()
            .into_snapshot();
        for path in [
            "staged-after-refresh.txt",
            "src/keep.txt",
            "untracked-after-refresh.txt",
        ] {
            assert!(
                same_head_refresh
                    .files()
                    .iter()
                    .any(|file| file.path == path),
                "same-HEAD refresh omitted {path}"
            );
        }
        assert_eq!(git.text(cwd, &["rev-parse", "HEAD"]).await.unwrap(), head);

        let mut cache = MissionDiffSnapshotCache::default();
        let first_view_id = refreshed.view_id().to_string();
        let latest_view_id = same_head_refresh.view_id().to_string();
        cache.insert(workspace.mission_id.clone(), refreshed);
        cache.insert(workspace.mission_id.clone(), same_head_refresh.clone());
        assert!(
            cache
                .get(&workspace.mission_id, &workspace, &first_view_id)
                .is_some()
        );
        assert!(
            cache
                .get(&workspace.mission_id, &workspace, &latest_view_id)
                .is_some()
        );

        let base_sha = workspace.base_sha.clone();
        workspace.base_sha = "f".repeat(40);
        git.validate_execution_workspace(&workspace).await.unwrap();
        let (checkout_state, unavailable_base) =
            git.prepare_diff_snapshot_observed(&workspace).await;
        assert!(matches!(
            checkout_state,
            MissionCheckoutState::Branch { branch, .. } if branch == workspace.branch
        ));
        assert!(
            unavailable_base
                .err()
                .unwrap()
                .to_string()
                .contains("mission.base_unavailable")
        );
        workspace.base_sha = base_sha;
        assert!(
            git.cleanup(&workspace)
                .await
                .unwrap_err()
                .to_string()
                .contains("mission.workspace_dirty")
        );
        git.bytes(cwd, &["add", "-A"]).await.unwrap();
        git.bytes(cwd, &["commit", "-m", "settle diff fixture"])
            .await
            .unwrap();
        git.cleanup(&workspace).await.unwrap();
    }

    #[tokio::test]
    async fn private_index_preserves_conflicts_sparse_checkout_and_assume_unchanged() {
        {
            let (_fixture, git, _repo, mut workspace) = fixture().await;
            git.materialize(&workspace).await.unwrap();
            workspace.state = "ready".into();
            let cwd = Path::new(&workspace.worktree_path);
            git.bytes(cwd, &["switch", "-c", "conflict-side"])
                .await
                .unwrap();
            fs::write(cwd.join("edit.txt"), "side\n").unwrap();
            git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
            git.bytes(cwd, &["commit", "-m", "side change"])
                .await
                .unwrap();
            git.bytes(cwd, &["switch", &workspace.branch])
                .await
                .unwrap();
            fs::write(cwd.join("edit.txt"), "managed\n").unwrap();
            git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
            git.bytes(cwd, &["commit", "-m", "managed change"])
                .await
                .unwrap();
            let merge = git
                .output(cwd, &["merge".into(), "conflict-side".into()], None, None)
                .await
                .unwrap();
            assert!(!merge.status.success());
            let unmerged_before = git.bytes(cwd, &["ls-files", "-u", "-z"]).await.unwrap();
            assert!(!unmerged_before.is_empty());
            let index = git
                .text(
                    cwd,
                    &["rev-parse", "--path-format=absolute", "--git-path", "index"],
                )
                .await
                .unwrap();
            let index_before = fs::read(&index).unwrap();
            git.reset_command_count();
            let snapshot = git
                .prepare_diff_snapshot(&workspace)
                .await
                .unwrap()
                .into_snapshot();
            assert_eq!(git.command_count(), 3);
            assert!(snapshot.files().iter().any(|file| file.path == "edit.txt"));
            assert_eq!(fs::read(&index).unwrap(), index_before);
            assert_eq!(
                git.bytes(cwd, &["ls-files", "-u", "-z"]).await.unwrap(),
                unmerged_before
            );
        }

        {
            let (_fixture, git, repo, mut workspace) = fixture().await;
            fs::write(repo.root.join("src/sparse-visible.txt"), "base\n").unwrap();
            git.bytes(&repo.root, &["add", "src/sparse-visible.txt"])
                .await
                .unwrap();
            git.bytes(&repo.root, &["commit", "-m", "add sparse fixture"])
                .await
                .unwrap();
            workspace.base_sha = git
                .text(&repo.root, &["rev-parse", "HEAD^{commit}"])
                .await
                .unwrap();
            git.materialize(&workspace).await.unwrap();
            workspace.state = "ready".into();
            let cwd = Path::new(&workspace.worktree_path);
            git.bytes(
                cwd,
                &["sparse-checkout", "init", "--cone", "--sparse-index"],
            )
            .await
            .unwrap();
            git.bytes(cwd, &["sparse-checkout", "set", "src"])
                .await
                .unwrap();
            git.bytes(cwd, &["update-index", "--assume-unchanged", "src/keep.txt"])
                .await
                .unwrap();
            fs::write(cwd.join("src/keep.txt"), "assumed\n").unwrap();
            fs::write(cwd.join("src/sparse-visible.txt"), "changed\n").unwrap();
            fs::write(cwd.join("src/sparse-new.txt"), "new\n").unwrap();
            let index = git
                .text(
                    cwd,
                    &["rev-parse", "--path-format=absolute", "--git-path", "index"],
                )
                .await
                .unwrap();
            let index_before = fs::read(&index).unwrap();
            git.reset_command_count();
            let snapshot = git
                .prepare_diff_snapshot(&workspace)
                .await
                .unwrap()
                .into_snapshot();
            assert_eq!(git.command_count(), 3);
            assert!(
                snapshot
                    .files()
                    .iter()
                    .any(|file| file.path == "src/sparse-visible.txt")
            );
            assert!(
                snapshot
                    .files()
                    .iter()
                    .any(|file| file.path == "src/sparse-new.txt")
            );
            assert!(
                snapshot
                    .files()
                    .iter()
                    .all(|file| file.path != "src/keep.txt" && !file.path.starts_with("docs/"))
            );
            assert_eq!(fs::read(&index).unwrap(), index_before);
            assert!(
                git.text(cwd, &["ls-files", "-v", "src/keep.txt"])
                    .await
                    .unwrap()
                    .starts_with("h ")
            );
        }
    }
}
