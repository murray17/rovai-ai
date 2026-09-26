//! Desktop Mission application orchestration. Git work is kept outside the database lock.
use super::*;
use crate::command::EntityReference;
use crate::mission::{
    CleanupMissionWorkspaceCommand, CreateMissionCommand, MissionAttachmentUpdate, MissionService,
    StartMissionCommand, StatusMissionCommand, UpdateMissionCommand,
};
use crate::mission_workspace::{
    self, CleanupRefusal, GitRepository, MissionGit, MissionWorkspace, NameOccupied,
};
use rusqlite::{OptionalExtension, params};

#[derive(Debug, Clone, Default)]
struct MissionWorkspaceCleanupTimings {
    identity_and_safety_ms: u128,
    worktree_remove_ms: u128,
    branch_check_and_delete_ms: u128,
}

#[derive(Debug)]
struct MissionWorkspaceCleanupFailure {
    error: anyhow::Error,
    restore_ready: bool,
    timings: MissionWorkspaceCleanupTimings,
}

impl MissionWorkspaceCleanupFailure {
    fn new(
        error: anyhow::Error,
        restore_ready: bool,
        timings: &MissionWorkspaceCleanupTimings,
    ) -> Self {
        Self {
            error,
            restore_ready,
            timings: timings.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissionSourceAttachmentPathInput {
    id: String,
    source_path: String,
    display_name: String,
    media_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateMissionWithAttachmentsParams {
    command_id: String,
    command: CreateMissionCommand,
    attachments: Vec<MissionSourceAttachmentPathInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateMissionWithAttachmentsParams {
    command_id: String,
    command: UpdateMissionCommand,
    keep_attachment_ids: Vec<String>,
    attachments: Vec<MissionSourceAttachmentPathInput>,
}

async fn observe_mission_source_attachments(
    inputs: Vec<MissionSourceAttachmentPathInput>,
) -> Result<Vec<rovai_core::local_attachment_source::LocalAttachmentSourceRef>> {
    anyhow::ensure!(
        inputs.len() <= rovai_core::camp_attachment::MAX_PREPARED_ATTACHMENTS,
        "mission.too_many_attachments"
    );
    tokio::task::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|input| {
                let canonical_id = uuid::Uuid::parse_str(&input.id)?.hyphenated().to_string();
                anyhow::ensure!(canonical_id == input.id, "mission.invalid_attachment_id");
                let mut source = observe_source_attachment(
                    Path::new(&input.source_path),
                    &input.display_name,
                    input.media_type.as_deref(),
                )?;
                source.id = input.id;
                Ok(source)
            })
            .collect::<Result<Vec<_>>>()
    })
    .await
    .context("Mission Source Attachment observation task failed")?
}

fn worktree_cleanup_required(worktree_removed: bool) -> bool {
    !worktree_removed
}

fn mission_workspace_read_matches(expected: &MissionWorkspace, current: &MissionWorkspace) -> bool {
    current.state == "ready"
        && current.id == expected.id
        && current.generation == expected.generation
        && current.preparation_token == expected.preparation_token
        && current.worktree_path == expected.worktree_path
        && current.working_directory == expected.working_directory
}

fn camp_accepts_workspace_preparation(
    connection: &rusqlite::Connection,
    camp_id: &str,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM camp WHERE id=?1 AND deletion_operation_id IS NULL)",
        [camp_id],
        |row| row.get(0),
    )?)
}

fn mission_workspace_preparation_is_current(
    connection: &rusqlite::Connection,
    expected: &MissionWorkspace,
) -> Result<bool> {
    Ok(connection.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM mission_workspace
            JOIN camp ON camp.id = mission_workspace.camp_id
            WHERE mission_workspace.id = ?1
              AND mission_workspace.state = 'ready'
              AND mission_workspace.generation = ?2
              AND mission_workspace.preparation_token = ?3
              AND mission_workspace.worktree_path = ?4
              AND mission_workspace.working_directory = ?5
              AND camp.deletion_operation_id IS NULL
        )
        "#,
        params![
            expected.id,
            expected.generation,
            expected.preparation_token,
            expected.worktree_path,
            expected.working_directory,
        ],
        |row| row.get(0),
    )?)
}

#[cfg(all(test, feature = "extended-tests"))]
fn cleanup_refusal_code(error: &anyhow::Error) -> Option<&'static str> {
    if let Some(refusal) = error.downcast_ref::<CleanupRefusal>() {
        return Some(refusal.code());
    }
    let diagnostic = format!("{error:#}");
    [
        "mission.workspace_dirty",
        "mission.detached_head_unreachable",
    ]
    .into_iter()
    .find(|code| diagnostic.contains(code))
}

fn cleanup_diagnostic_is_recoverable(workspace: &MissionWorkspace) -> bool {
    let Some(diagnostic) = workspace.diagnostic.as_deref() else {
        return false;
    };
    diagnostic.contains("mission.workspace_dirty")
        || diagnostic.contains("mission.detached_head_unreachable")
        || (workspace.cleanup_expected_branch_oid.is_none()
            && diagnostic.contains("mission.workspace_branch_mismatch"))
}

impl Core {
    async fn mission_git(&self) -> Result<MissionGit> {
        MissionGit::new(
            self.runtime_search_environment
                .read()
                .await
                .resolve_command_path("git")
                .context("mission.git_unavailable")?,
        )
    }

    async fn ensure_mission_workspace_read_is_current(
        &self,
        expected: &MissionWorkspace,
    ) -> Result<(u128, u128)> {
        let lock_started_at = Instant::now();
        let database = self.database.lock().await;
        let lock_ms = lock_started_at.elapsed().as_millis();
        let read_started_at = Instant::now();
        let current =
            mission_workspace::load_workspaces(database.connection(), &expected.mission_id)?
                .into_iter()
                .find(|workspace| workspace.id == expected.id)
                .context("mission.changes_refresh_required")?;
        anyhow::ensure!(
            mission_workspace_read_matches(expected, &current),
            "mission.changes_refresh_required"
        );
        Ok((lock_ms, read_started_at.elapsed().as_millis()))
    }
    pub(super) async fn prepare_mission_workspace(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
    ) -> Result<Option<rovai_core::runtime::AgentRunWorkspace>> {
        let _preparation = self.mission_workspace_gate.lock().await;
        let (mission, existing, host) = {
            let mut database = self.database.lock().await;
            let Some(mission) =
                crate::mission::mission_for_camp(database.connection(), &candidate.camp_id)?
            else {
                return Ok(Some(candidate.execution_workspace()));
            };
            if !ExecutionRuntimeService::default()
                .begin_workspace_preparation(&mut database, candidate)?
            {
                return Ok(None);
            }
            let host: String = database.connection().query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |r| r.get(0),
            )?;
            let existing = mission_workspace::load_workspaces(
                database.connection(),
                &mission.info.mission_id,
            )?;
            (mission, existing, host)
        };
        let mut execution = candidate.execution_workspace();
        let source = Path::new(&mission.project_path);
        if existing.is_empty() && !mission_workspace::has_git_marker(source) {
            // An unavailable Git executable cannot change non-Git execution behavior.
            if self
                .runtime_search_environment
                .read()
                .await
                .resolve_command_path("git")
                .is_none()
            {
                let database = self.database.lock().await;
                return Ok(camp_accepts_workspace_preparation(
                    database.connection(),
                    &candidate.camp_id,
                )?
                .then_some(execution));
            }
        }
        let git = self.mission_git().await?;
        let mut workspace = if let Some(saved) = existing.into_iter().next() {
            anyhow::ensure!(
                saved.execution_host_id == host,
                "mission.execution_host_unavailable"
            );
            saved
        } else {
            let Some(repository) = git.inspect(source).await? else {
                let database = self.database.lock().await;
                return Ok(camp_accepts_workspace_preparation(
                    database.connection(),
                    &candidate.camp_id,
                )?
                .then_some(execution));
            };
            let workspace = select_candidate(&git, &repository, &mission, &host, 1).await?;
            let database = self.database.lock().await;
            if !camp_accepts_workspace_preparation(database.connection(), &candidate.camp_id)? {
                return Ok(None);
            }
            mission_workspace::persist_plan(database.connection(), &workspace)?;
            workspace
        };
        if workspace.state == "cleanup_failed"
            && !workspace.cleanup_finished()
            && cleanup_diagnostic_is_recoverable(&workspace)
            && git.cleanup_failure_left_intact_workspace(&workspace).await
        {
            let database = self.database.lock().await;
            let changed = database.connection().execute(
                r#"
                UPDATE mission_workspace
                SET state='ready',cleanup_command_id=NULL,
                    cleanup_expected_branch_oid=NULL,cleanup_worktree_removed=0,
                    cleanup_branch_removed=0,diagnostic=NULL,updated_at=?2
                WHERE id=?1 AND state='cleanup_failed'
                  AND generation=?3 AND preparation_token=?4
                  AND EXISTS(
                      SELECT 1 FROM camp
                      WHERE camp.id=mission_workspace.camp_id
                        AND camp.deletion_operation_id IS NULL
                  )
                "#,
                params![
                    workspace.id,
                    chrono::Utc::now().to_rfc3339(),
                    workspace.generation,
                    workspace.preparation_token,
                ],
            )?;
            if changed != 1 {
                return Ok(None);
            }
            workspace.state = "ready".into();
            workspace.cleanup_command_id = None;
            workspace.cleanup_expected_branch_oid = None;
            workspace.cleanup_worktree_removed = false;
            workspace.cleanup_branch_removed = false;
            workspace.diagnostic = None;
        }
        anyhow::ensure!(
            matches!(
                workspace.state.as_str(),
                "preparing" | "ready" | "cleanup_pending" | "cleanup_failed"
            ),
            "mission.workspace_cleanup_pending"
        );
        anyhow::ensure!(
            matches!(workspace.state.as_str(), "preparing" | "ready")
                || workspace.cleanup_finished(),
            "mission.workspace_cleanup_pending"
        );
        if workspace.state != "preparing" {
            let expected_state = workspace.state.clone();
            let expected_generation = workspace.generation;
            let expected_preparation_token = workspace.preparation_token.clone();
            let worktree_exists = git.worktree_exists(&workspace)?;
            if worktree_exists {
                workspace.state = "ready".into();
                // Reuse depends on the owned Worktree and execution directory, not
                // on which branch is currently checked out or whether the original
                // managed branch still exists.
                git.validate_execution_workspace(&workspace).await?;
                let database = self.database.lock().await;
                let changed = database.connection().execute(
                    r#"
                    UPDATE mission_workspace
                    SET state='ready',cleanup_command_id=NULL,
                        cleanup_expected_branch_oid=NULL,cleanup_worktree_removed=0,
                        cleanup_branch_removed=0,diagnostic=NULL,updated_at=?2
                    WHERE id=?1 AND state=?3 AND generation=?4
                      AND preparation_token=?5
                      AND EXISTS(
                          SELECT 1 FROM camp
                          WHERE camp.id=mission_workspace.camp_id
                            AND camp.deletion_operation_id IS NULL
                      )
                    "#,
                    params![
                        workspace.id,
                        chrono::Utc::now().to_rfc3339(),
                        expected_state,
                        expected_generation,
                        expected_preparation_token,
                    ],
                )?;
                if changed != 1 {
                    return Ok(None);
                }
                workspace.cleanup_command_id = None;
                workspace.cleanup_expected_branch_oid = None;
                workspace.cleanup_worktree_removed = false;
                workspace.cleanup_branch_removed = false;
            } else {
                let branch_oid = git.branch_oid(&workspace).await?;
                // Remove only a stale registration carrying this workspace's owner marker.
                git.cleanup(&workspace).await?;
                let preparation_kind = if branch_oid.is_some() {
                    "restore"
                } else {
                    "create"
                };
                if branch_oid.is_none() {
                    let repository = git
                        .inspect(source)
                        .await?
                        .context("mission.source_repository_unavailable")?;
                    anyhow::ensure!(
                        repository.root == Path::new(&workspace.repository_root)
                            && repository.common_dir == Path::new(&workspace.git_common_dir),
                        "mission.repository_mismatch"
                    );
                    let expected_relative = Path::new(&workspace.working_directory)
                        .strip_prefix(&workspace.worktree_path)?;
                    anyhow::ensure!(
                        repository.relative_directory == expected_relative,
                        "mission.working_directory_changed"
                    );
                    workspace.base_branch = repository.base_branch;
                    workspace.base_sha = repository.base_sha;
                }
                workspace.preparation_token = uuid::Uuid::new_v4().to_string();
                workspace.preparation_kind = preparation_kind.into();
                workspace.generation += 1;
                workspace.state = "preparing".into();
                workspace.cleanup_command_id = None;
                workspace.cleanup_expected_branch_oid = None;
                workspace.cleanup_worktree_removed = false;
                workspace.cleanup_branch_removed = false;
                workspace.diagnostic = None;
                let database = self.database.lock().await;
                let changed = database.connection().execute(
                    r#"
                    UPDATE mission_workspace
                    SET base_branch=?2,base_sha=?3,preparation_token=?4,
                        preparation_kind=?5,generation=?6,state='preparing',
                        cleanup_command_id=NULL,cleanup_expected_branch_oid=NULL,
                        cleanup_worktree_removed=0,cleanup_branch_removed=0,
                        diagnostic=NULL,updated_at=?7
                    WHERE id=?1 AND state=?8 AND generation=?9
                      AND preparation_token=?10
                      AND EXISTS(
                          SELECT 1 FROM camp
                          WHERE camp.id=mission_workspace.camp_id
                            AND camp.deletion_operation_id IS NULL
                      )
                    "#,
                    params![
                        workspace.id,
                        workspace.base_branch,
                        workspace.base_sha,
                        workspace.preparation_token,
                        workspace.preparation_kind,
                        workspace.generation,
                        chrono::Utc::now().to_rfc3339(),
                        expected_state,
                        expected_generation,
                        expected_preparation_token,
                    ],
                )?;
                if changed != 1 {
                    return Ok(None);
                }
            }
        }
        if workspace.state == "preparing" {
            loop {
                let materialized = if workspace.preparation_kind == "restore" {
                    git.restore(&workspace).await
                } else {
                    git.materialize(&workspace).await
                };
                match materialized {
                    Ok(()) => break,
                    Err(error)
                        if error.is::<NameOccupied>() && workspace.preparation_kind == "create" =>
                    {
                        git.abandon_candidate(&workspace).await?;
                        // Keep the first resolved base even when a name was occupied during creation.
                        let root = PathBuf::from(&workspace.repository_root);
                        let relative = Path::new(&workspace.working_directory)
                            .strip_prefix(&workspace.worktree_path)?
                            .to_path_buf();
                        let repository = GitRepository {
                            root,
                            common_dir: workspace.git_common_dir.clone().into(),
                            base_branch: workspace.base_branch.clone(),
                            base_sha: workspace.base_sha.clone(),
                            relative_directory: relative,
                        };
                        let mut next =
                            select_candidate(&git, &repository, &mission, &host, 2).await?;
                        next.id = workspace.id.clone();
                        next.preparation_token = workspace.preparation_token.clone();
                        next.generation = workspace.generation;
                        let database = self.database.lock().await;
                        let changed = database.connection().execute(
                            r#"
                            UPDATE mission_workspace
                            SET worktree_path=?2,working_directory=?3,branch=?4,updated_at=?5
                            WHERE id=?1 AND state='preparing' AND generation=?6
                              AND preparation_token=?7
                              AND EXISTS(
                                  SELECT 1 FROM camp
                                  WHERE camp.id=mission_workspace.camp_id
                                    AND camp.deletion_operation_id IS NULL
                              )
                            "#,
                            params![
                                next.id,
                                next.worktree_path,
                                next.working_directory,
                                next.branch,
                                chrono::Utc::now().to_rfc3339(),
                                workspace.generation,
                                workspace.preparation_token,
                            ],
                        )?;
                        if changed != 1 {
                            return Ok(None);
                        }
                        workspace = next;
                    }
                    Err(error) => {
                        let database = self.database.lock().await;
                        let changed = database.connection().execute(
                            r#"
                            UPDATE mission_workspace
                            SET diagnostic=?2,updated_at=?3
                            WHERE id=?1 AND state='preparing' AND generation=?4
                              AND preparation_token=?5
                              AND EXISTS(
                                  SELECT 1 FROM camp
                                  WHERE camp.id=mission_workspace.camp_id
                                    AND camp.deletion_operation_id IS NULL
                              )
                            "#,
                            params![
                                workspace.id,
                                format!("{error:#}"),
                                chrono::Utc::now().to_rfc3339(),
                                workspace.generation,
                                workspace.preparation_token,
                            ],
                        )?;
                        if changed != 1 {
                            return Ok(None);
                        }
                        return Err(error);
                    }
                }
            }
            let database = self.database.lock().await;
            let changed = database.connection().execute(
                r#"
                UPDATE mission_workspace
                SET state='ready',diagnostic=NULL,updated_at=?2
                WHERE id=?1 AND state='preparing' AND generation=?3
                  AND preparation_token=?4
                  AND EXISTS(
                      SELECT 1 FROM camp
                      WHERE camp.id=mission_workspace.camp_id
                        AND camp.deletion_operation_id IS NULL
                  )
                "#,
                params![
                    workspace.id,
                    chrono::Utc::now().to_rfc3339(),
                    workspace.generation,
                    workspace.preparation_token,
                ],
            )?;
            if changed != 1 {
                return Ok(None);
            }
            workspace.state = "ready".into();
        }
        git.validate_execution_workspace(&workspace).await?;
        let actual = git::validate_workspace_directory(
            Path::new(&workspace.working_directory),
            &self.data_dir,
            false,
        )?;
        anyhow::ensure!(
            git::persisted_workspace_path_matches_canonical(
                Path::new(&workspace.working_directory),
                &actual
            ),
            "mission.working_directory_changed"
        );
        let database = self.database.lock().await;
        if !mission_workspace_preparation_is_current(database.connection(), &workspace)? {
            return Ok(None);
        }
        drop(database);
        execution.execution_root = workspace.working_directory;
        execution.isolation = "git_worktree".into();
        if let Some(frozen) = &candidate.workspace {
            anyhow::ensure!(frozen == &execution, "mission.frozen_workspace_mismatch");
        }
        Ok(Some(execution))
    }

    async fn perform_mission_workspace_cleanup_locked(
        &self,
        workspace: &mut MissionWorkspace,
    ) -> std::result::Result<MissionWorkspaceCleanupTimings, MissionWorkspaceCleanupFailure> {
        let mut timings = MissionWorkspaceCleanupTimings::default();
        let identity_started_at = Instant::now();
        let host = {
            let database = self.database.lock().await;
            database
                .connection()
                .query_row(
                    "SELECT id FROM mission_execution_host WHERE singleton=1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .map_err(anyhow::Error::from)
                .map_err(|error| MissionWorkspaceCleanupFailure::new(error, false, &timings))?
        };
        if workspace.execution_host_id != host {
            return Err(MissionWorkspaceCleanupFailure::new(
                anyhow::anyhow!("mission.execution_host_unavailable"),
                false,
                &timings,
            ));
        }
        if workspace.state != "cleanup_pending" {
            return Err(MissionWorkspaceCleanupFailure::new(
                anyhow::anyhow!("mission.workspace_cleanup_not_pending"),
                false,
                &timings,
            ));
        }
        let git = self
            .mission_git()
            .await
            .map_err(|error| MissionWorkspaceCleanupFailure::new(error, false, &timings))?;
        let verified_worktree = if worktree_cleanup_required(workspace.cleanup_worktree_removed) {
            match git.prepare_worktree_cleanup(workspace).await {
                Ok(verified) => Some(verified),
                Err(error) => {
                    timings.identity_and_safety_ms = identity_started_at.elapsed().as_millis();
                    let restore_ready = error.downcast_ref::<CleanupRefusal>().is_some();
                    return Err(MissionWorkspaceCleanupFailure::new(
                        error,
                        restore_ready,
                        &timings,
                    ));
                }
            }
        } else {
            None
        };
        let reference = match verified_worktree.as_ref() {
            Some(verified) => verified.managed_reference().to_string(),
            None => git
                .cleanup_branch_reference(workspace)
                .await
                .map_err(|error| MissionWorkspaceCleanupFailure::new(error, false, &timings))?,
        };
        let saved_expected_oid = workspace.cleanup_expected_branch_oid.clone();
        let expected_oid = match saved_expected_oid.as_ref() {
            Some(expected_oid) => {
                if let Some(verified) = verified_worktree.as_ref() {
                    match verified.managed_branch_oid() {
                        Some(observed_oid) if observed_oid != expected_oid => {
                            timings.identity_and_safety_ms =
                                identity_started_at.elapsed().as_millis();
                            return Err(MissionWorkspaceCleanupFailure::new(
                                anyhow::anyhow!("mission.branch_changed"),
                                false,
                                &timings,
                            ));
                        }
                        None if verified.target_present() => {
                            timings.identity_and_safety_ms =
                                identity_started_at.elapsed().as_millis();
                            return Err(MissionWorkspaceCleanupFailure::new(
                                anyhow::anyhow!("mission.branch_changed"),
                                false,
                                &timings,
                            ));
                        }
                        _ => {}
                    }
                }
                Some(expected_oid.clone())
            }
            None => verified_worktree
                .as_ref()
                .and_then(|verified| verified.managed_branch_oid().map(str::to_string)),
        };
        if verified_worktree
            .as_ref()
            .is_some_and(|verified| verified.requires_managed_branch())
        {
            if expected_oid.is_none() {
                timings.identity_and_safety_ms = identity_started_at.elapsed().as_millis();
                return Err(MissionWorkspaceCleanupFailure::new(
                    anyhow::anyhow!("mission.workspace_branch_missing"),
                    false,
                    &timings,
                ));
            }
        }
        workspace.cleanup_expected_branch_oid = expected_oid.clone();
        workspace.cleanup_branch_removed |= expected_oid.is_none();
        {
            let database = self.database.lock().await;
            let changed = database
                .connection()
                .execute(
                    "UPDATE mission_workspace SET cleanup_expected_branch_oid=?2,cleanup_branch_removed=?3,updated_at=?4 WHERE id=?1 AND state='cleanup_pending'",
                    params![workspace.id, workspace.cleanup_expected_branch_oid, workspace.cleanup_branch_removed, chrono::Utc::now().to_rfc3339()],
                )
                .map_err(anyhow::Error::from)
                .map_err(|error| {
                    MissionWorkspaceCleanupFailure::new(error, false, &timings)
                })?;
            if changed != 1 {
                return Err(MissionWorkspaceCleanupFailure::new(
                    anyhow::anyhow!("mission.workspace_cleanup_not_pending"),
                    false,
                    &timings,
                ));
            }
        }
        timings.identity_and_safety_ms = identity_started_at.elapsed().as_millis();

        if let Some(verified_worktree) = verified_worktree.as_ref() {
            let worktree_started_at = Instant::now();
            if let Err(error) = git
                .remove_verified_worktree(workspace, verified_worktree)
                .await
            {
                timings.worktree_remove_ms = worktree_started_at.elapsed().as_millis();
                let restore_ready = error.downcast_ref::<CleanupRefusal>().is_some();
                return Err(MissionWorkspaceCleanupFailure::new(
                    error,
                    restore_ready,
                    &timings,
                ));
            }
            timings.worktree_remove_ms = worktree_started_at.elapsed().as_millis();
            workspace.cleanup_worktree_removed = true;
            let database = self.database.lock().await;
            database
                .connection()
                .execute(
                    "UPDATE mission_workspace SET cleanup_worktree_removed=1,updated_at=?2 WHERE id=?1",
                    params![workspace.id, chrono::Utc::now().to_rfc3339()],
                )
                .map_err(anyhow::Error::from)
                .map_err(|error| {
                    MissionWorkspaceCleanupFailure::new(error, false, &timings)
                })?;
        }

        let branch_started_at = Instant::now();
        if !workspace.cleanup_branch_removed {
            let expected_oid = expected_oid.ok_or_else(|| {
                MissionWorkspaceCleanupFailure::new(
                    anyhow::anyhow!("mission.branch_identity_missing"),
                    false,
                    &timings,
                )
            })?;
            git.delete_branch_expected(workspace, &reference, &expected_oid)
                .await
                .map_err(|error| {
                    timings.branch_check_and_delete_ms = branch_started_at.elapsed().as_millis();
                    MissionWorkspaceCleanupFailure::new(error, false, &timings)
                })?;
            workspace.cleanup_branch_removed = true;
        }
        timings.branch_check_and_delete_ms = branch_started_at.elapsed().as_millis();
        {
            let database = self.database.lock().await;
            database
                .connection()
                .execute(
                    "UPDATE mission_workspace SET state='cleanup_pending',cleanup_worktree_removed=1,cleanup_branch_removed=1,diagnostic=NULL,updated_at=?2 WHERE id=?1",
                    params![workspace.id, chrono::Utc::now().to_rfc3339()],
                )
                .map_err(anyhow::Error::from)
                .map_err(|error| {
                    MissionWorkspaceCleanupFailure::new(error, false, &timings)
                })?;
        }
        workspace.state = "cleanup_pending".into();
        workspace.diagnostic = None;
        Ok(timings)
    }

    pub(super) async fn cleanup_mission_workspaces_locked(
        &self,
        camp_id: Option<&str>,
    ) -> Result<()> {
        // Preparation, aggregate deletion and destructive Git cleanup share one
        // lifecycle gate. Camp deletion acceptance stays outside this gate so
        // its foreground latency is independent of an in-flight Git command.
        let _workspace_lifecycle = self.mission_workspace_gate.lock().await;
        let workspaces = {
            let database = self.database.lock().await;
            let mut statement=database.connection().prepare("SELECT DISTINCT mission_id FROM mission_workspace WHERE state='cleanup_pending' AND NOT (cleanup_worktree_removed=1 AND cleanup_branch_removed=1) AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id AND camp.deletion_operation_id IS NOT NULL) AND (?1 IS NULL OR camp_id=?1)")?;
            let ids = statement
                .query_map([camp_id], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut rows = Vec::new();
            for id in ids {
                rows.extend(
                    mission_workspace::load_workspaces(database.connection(), &id)?
                        .into_iter()
                        .filter(|workspace| {
                            workspace.state == "cleanup_pending"
                                && !workspace.cleanup_finished()
                                && camp_id.is_none_or(|camp_id| workspace.camp_id == camp_id)
                        }),
                );
            }
            rows
        };
        if workspaces.is_empty() {
            return Ok(());
        }
        for mut workspace in workspaces {
            let attempt_started_at = Instant::now();
            let result = self
                .perform_mission_workspace_cleanup_locked(&mut workspace)
                .await;
            let publish_started_at = Instant::now();
            let mut outcome = "completed";
            let timings = match &result {
                Ok(timings) => timings.clone(),
                Err(failure) => failure.timings.clone(),
            };
            let database = self.database.lock().await;
            match result {
                Ok(_) => {
                    let camp_exists = database.connection().query_row(
                        "SELECT EXISTS(SELECT 1 FROM camp WHERE id=?1)",
                        [&workspace.camp_id],
                        |row| row.get::<_, bool>(0),
                    )?;
                    if !camp_exists {
                        database.connection().execute(
                            r#"
                            DELETE FROM mission_workspace
                            WHERE id=?1
                              AND NOT EXISTS(
                                  SELECT 1
                                  FROM camp_attachment_view_operation AS deletion
                                  WHERE deletion.kind='camp_delete_cleanup'
                                    AND deletion.camp_id=mission_workspace.camp_id
                                    AND deletion.command_id=mission_workspace.cleanup_command_id
                                    AND deletion.status NOT IN ('completed','rolled_back')
                              )
                            "#,
                            [&workspace.id],
                        )?;
                    }
                }
                Err(failure) => {
                    let detailed_diagnostic = format!("{:#}", failure.error);
                    let diagnostic = failure
                        .error
                        .downcast_ref::<CleanupRefusal>()
                        .map(|refusal| refusal.code().to_string())
                        .unwrap_or_else(|| detailed_diagnostic.clone());
                    if let Some(refusal) = failure.error.downcast_ref::<CleanupRefusal>() {
                        eprintln!(
                            "[mission-worktree-cleanup] mission={:?} workspace={:?} stage=refusal_detail code={:?} detail={:?}",
                            workspace.mission_id,
                            workspace.id,
                            refusal.code(),
                            detailed_diagnostic,
                        );
                    }
                    let restored = failure.restore_ready
                        && !workspace.cleanup_worktree_removed
                        && database.connection().execute(
                            "UPDATE mission_workspace SET state='ready',cleanup_command_id=NULL,cleanup_expected_branch_oid=NULL,cleanup_worktree_removed=0,cleanup_branch_removed=0,diagnostic=?2,updated_at=?3 WHERE id=?1 AND state='cleanup_pending' AND EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id AND camp.deletion_operation_id IS NULL)",
                            params![workspace.id, &diagnostic, chrono::Utc::now().to_rfc3339()],
                        )? == 1;
                    if restored {
                        outcome = "refused_ready";
                    } else {
                        outcome = "failed";
                        database.connection().execute("UPDATE mission_workspace SET state='cleanup_failed',diagnostic=?2,updated_at=?3 WHERE id=?1 AND state='cleanup_pending'",params![workspace.id,&diagnostic,chrono::Utc::now().to_rfc3339()])?;
                    }
                }
            }
            drop(database);
            self.mission_diff_snapshots
                .lock()
                .await
                .release(&workspace.mission_id);
            emit_missions_invalidated(
                &self.output,
                "mission.workspace.cleanup.finished",
                Some(&workspace.camp_id),
            );
            eprintln!(
                "[mission-worktree-cleanup] mission={:?} workspace={:?} stage=result_published outcome={} identity_and_safety_ms={} worktree_remove_ms={} branch_check_and_delete_ms={} result_publish_ms={} total_ms={}",
                workspace.mission_id,
                workspace.id,
                outcome,
                timings.identity_and_safety_ms,
                timings.worktree_remove_ms,
                timings.branch_check_and_delete_ms,
                publish_started_at.elapsed().as_millis(),
                attempt_started_at.elapsed().as_millis(),
            );
            // A Camp deletion operation may be waiting for this existing
            // resource journal before it can emit deletion completion.
            self.camp_deletion_notify.notify_one();
        }
        Ok(())
    }

    pub(super) async fn handle_mission(&self, request: &Request) -> Result<Value> {
        match request.method.as_str() {
            "missions.workspace.cleanup" => {
                let admission_started_at = Instant::now();
                let params: UserCommandParams<CleanupMissionWorkspaceCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mission_id = params.command.mission_id.clone();
                let envelope = user_command_envelope(params.command_id.clone(), params.command);
                if let Some(replay) = {
                    let database = self.database.lock().await;
                    DomainCommandGateway.replay_if_recorded(&database, &envelope)?
                } {
                    if replay.result.payload["scheduled"] == json!(true) {
                        self.mission_workspace_cleanup_notify.notify_one();
                    }
                    eprintln!(
                        "[mission-worktree-cleanup] mission={:?} stage=request_queued replay=true scheduled={} request_to_queue_ms={}",
                        mission_id,
                        replay.result.payload["scheduled"] == json!(true),
                        admission_started_at.elapsed().as_millis(),
                    );
                    return Ok(serde_json::to_value(replay.result)?);
                }
                let _guard = self.mission_workspace_gate.lock().await;
                let mut database = self.database.lock().await;
                let execution = DomainCommandGateway.execute(&mut database, &envelope, |tx| {
                    let camp_id = tx
                        .query_row(
                            "SELECT camp_id FROM mission WHERE id=?1",
                            [&mission_id],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?;
                    let Some(camp_id) = camp_id else {
                        return Ok(CommandHandlerResult::rejected(
                            "mission.not_found",
                            json!({"missionId": mission_id}),
                        ));
                    };
                    let workspace = mission_workspace::load_workspaces(tx, &mission_id)?
                        .into_iter()
                        .next();
                    let Some(workspace) = workspace else {
                        return Ok(CommandHandlerResult::rejected(
                            "mission.workspace_not_prepared",
                            json!({"missionId": mission_id}),
                        ));
                    };
                    if workspace.cleanup_finished() {
                        return Ok(CommandHandlerResult::applied(
                            "mission.workspace_cleanup_already_finished",
                            json!({"missionId": mission_id, "campId": camp_id, "scheduled": false}),
                            Some(EntityReference {
                                entity_type: "mission".into(),
                                entity_id: mission_id.clone(),
                            }),
                        ));
                    }
                    if workspace.state == "cleanup_pending" {
                        return Ok(CommandHandlerResult::rejected(
                            "mission.workspace_cleanup_pending",
                            json!({"missionId": mission_id}),
                        ));
                    }
                    if workspace.state == "preparing"
                        || mission_workspace::workspace_in_use(tx, &workspace)?
                    {
                        return Ok(CommandHandlerResult::rejected(
                            "mission.workspace_in_use",
                            json!({"missionId": mission_id}),
                        ));
                    }
                    let current_host: String = tx.query_row(
                        "SELECT id FROM mission_execution_host WHERE singleton=1",
                        [],
                        |row| row.get(0),
                    )?;
                    if workspace.execution_host_id != current_host {
                        return Ok(CommandHandlerResult::rejected(
                            "mission.execution_host_unavailable",
                            json!({"missionId": mission_id}),
                        ));
                    }
                    let generation = workspace.generation + i64::from(workspace.state == "ready");
                    tx.execute(
                        "UPDATE mission_workspace SET generation=?2,state='cleanup_pending',cleanup_command_id=?3,diagnostic=NULL,updated_at=?4 WHERE id=?1",
                        params![workspace.id, generation, params.command_id, chrono::Utc::now().to_rfc3339()],
                    )?;
                    Ok(CommandHandlerResult::applied(
                        "mission.workspace_cleanup_scheduled",
                        json!({
                            "missionId": mission_id,
                            "campId": camp_id,
                            "worktreePath": workspace.worktree_path,
                            "managedBranch": workspace.branch,
                            "scheduled": true,
                        }),
                        Some(EntityReference {
                            entity_type: "mission".into(),
                            entity_id: mission_id.clone(),
                        }),
                    ))
                })?;
                let scheduled = execution.result.payload["scheduled"] == json!(true);
                let camp_id = execution.result.payload["campId"]
                    .as_str()
                    .map(str::to_string);
                drop(database);
                if scheduled {
                    self.mission_diff_snapshots
                        .lock()
                        .await
                        .release(&mission_id);
                    emit_missions_invalidated(
                        &self.output,
                        "missions.workspace.cleanup",
                        camp_id.as_deref(),
                    );
                    self.mission_workspace_cleanup_notify.notify_one();
                }
                eprintln!(
                    "[mission-worktree-cleanup] mission={:?} stage=request_queued replay=false scheduled={} request_to_queue_ms={}",
                    mission_id,
                    scheduled,
                    admission_started_at.elapsed().as_millis(),
                );
                Ok(serde_json::to_value(execution.result)?)
            }
            "missions.cleanup.list" => {
                let database = self.database.lock().await;
                let mut stmt=database.connection().prepare("SELECT mission_id FROM mission_workspace WHERE state IN ('cleanup_pending','cleanup_failed') AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id) AND NOT EXISTS(SELECT 1 FROM camp_attachment_view_operation AS deletion WHERE deletion.kind='camp_delete_cleanup' AND deletion.command_id=mission_workspace.cleanup_command_id) ORDER BY updated_at")?;
                let ids = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut rows = Vec::new();
                for id in ids {
                    rows.extend(mission_workspace::load_workspaces(
                        database.connection(),
                        &id,
                    )?);
                }
                Ok(serde_json::to_value(rows)?)
            }
            "missions.cleanup.retry" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Retry {
                    workspace_id: String,
                }
                let query: Retry = serde_json::from_value(request.params.clone())?;
                let _guard = self.mission_workspace_gate.lock().await;
                let retry_command_id = uuid::Uuid::new_v4().to_string();
                let (scheduled, camp_id, pending) = {
                    let database = self.database.lock().await;
                    let camp_id = database.connection().query_row("SELECT camp_id FROM mission_workspace WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id) AND NOT EXISTS(SELECT 1 FROM camp_attachment_view_operation AS deletion WHERE deletion.kind='camp_delete_cleanup' AND deletion.command_id=mission_workspace.cleanup_command_id)",[&query.workspace_id],|r|r.get::<_,String>(0)).optional()?;
                    let scheduled = if camp_id.is_some() {
                        database.connection().execute(
                            "UPDATE mission_workspace SET state='cleanup_pending',cleanup_command_id=?2,diagnostic=NULL,updated_at=?3 WHERE id=?1 AND state='cleanup_failed' AND NOT (cleanup_worktree_removed=1 AND cleanup_branch_removed=1)",
                            params![query.workspace_id, retry_command_id, chrono::Utc::now().to_rfc3339()],
                        )? == 1
                    } else {
                        false
                    };
                    let pending = database.connection().query_row(
                        "SELECT EXISTS(SELECT 1 FROM mission_workspace WHERE id=?1)",
                        [&query.workspace_id],
                        |r| r.get::<_, bool>(0),
                    )?;
                    (scheduled, camp_id, pending)
                };
                if scheduled {
                    emit_missions_invalidated(
                        &self.output,
                        "missions.cleanup.retry",
                        camp_id.as_deref(),
                    );
                    self.mission_workspace_cleanup_notify.notify_one();
                }
                Ok(json!({"pending":pending,"scheduled":scheduled}))
            }
            "missions.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MissionService::default().list(&database)?,
                )?)
            }
            "missions.get"
            | "missions.activity"
            | "missions.delivery"
            | "missions.changes"
            | "missions.fileDiff"
            | "missions.diffSession.release" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Query {
                    mission_id: String,
                    before: Option<i64>,
                    file_id: Option<String>,
                    view_id: Option<String>,
                }
                let query: Query = serde_json::from_value(request.params.clone())?;
                if request.method == "missions.diffSession.release" {
                    {
                        let database = self.database.lock().await;
                        MissionService::default()
                            .get(&database, &query.mission_id)?
                            .context("mission.not_found")?;
                    }
                    let released = self
                        .mission_diff_snapshots
                        .lock()
                        .await
                        .release(&query.mission_id);
                    return Ok(json!({ "released": released }));
                }
                let workspace_lock_started_at = Instant::now();
                let (mission, workspaces, workspace_lock_ms, workspace_read_ms) = {
                    let database = self.database.lock().await;
                    let workspace_lock_ms = workspace_lock_started_at.elapsed().as_millis();
                    let workspace_read_started_at = Instant::now();
                    let mission = MissionService::default()
                        .get(&database, &query.mission_id)?
                        .context("mission.not_found")?;
                    if request.method == "missions.get" {
                        return Ok(serde_json::to_value(mission)?);
                    }
                    if request.method == "missions.activity" {
                        return Ok(serde_json::to_value(MissionService::default().activity(
                            &database,
                            &query.mission_id,
                            query.before,
                        )?)?);
                    }
                    let workspaces = mission_workspace::load_workspaces(
                        database.connection(),
                        &query.mission_id,
                    )?;
                    (
                        mission,
                        workspaces,
                        workspace_lock_ms,
                        workspace_read_started_at.elapsed().as_millis(),
                    )
                };
                if request.method == "missions.delivery" {
                    let database = self.database.lock().await;
                    let mut prs=database.connection().prepare("SELECT id,url,title,created_at FROM mission_pr WHERE mission_id=?1 ORDER BY created_at DESC,id")?;
                    let prs=prs.query_map([&query.mission_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"url":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"createdAt":r.get::<_,String>(3)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
                    let files =
                        MissionService::default().delivery_files(&database, &mission.camp_id)?;
                    let git_project = !workspaces.is_empty()
                        || mission_workspace::has_git_marker(Path::new(&mission.project_path));
                    let workspace = workspaces.first().cloned().map(|mut workspace| {
                        if workspace.cleanup_finished() {
                            workspace.state = "cleaned".into();
                        }
                        workspace
                    });
                    return Ok(
                        json!({"campId":mission.camp_id,"workingDirectory":workspaces.first().map(|w|w.working_directory.as_str()).unwrap_or(&mission.project_path),"git":git_project,"workspace":workspace,"pullRequests":prs,"files":files}),
                    );
                }
                let workspace = workspaces.first().context(
                    if mission_workspace::has_git_marker(Path::new(&mission.project_path)) {
                        "mission.workspace_not_prepared"
                    } else {
                        "mission.git_not_applicable"
                    },
                )?;
                anyhow::ensure!(
                    workspace.state == "ready",
                    "mission.changes_refresh_required"
                );
                let git = self.mission_git().await?;
                let permit_started_at = Instant::now();
                let _git_read_permit = self
                    .mission_git_read_capacity
                    .acquire()
                    .await
                    .context("mission.git_read_capacity_closed")?;
                let permit_wait_ms = permit_started_at.elapsed().as_millis();
                #[cfg(test)]
                wait_for_mission_git_read_test_barrier(&request.method, &query.mission_id).await;
                let git_started_at = Instant::now();
                if request.method == "missions.changes" {
                    let (checkout_state, prepared) =
                        git.prepare_diff_snapshot_observed(workspace).await;
                    let git_ms = git_started_at.elapsed().as_millis();
                    let (revalidate_lock_ms, revalidate_read_ms) = self
                        .ensure_mission_workspace_read_is_current(workspace)
                        .await?;
                    let serialization_started_at = Instant::now();
                    let value = match prepared {
                        Ok(prepared) => {
                            let snapshot = prepared.into_snapshot();
                            let view = mission_workspace::MissionWorkspaceChangesView {
                                checkout_state,
                                view_id: Some(snapshot.view_id().to_string()),
                                files: Some(snapshot.files().to_vec()),
                                diff_error: None,
                            };
                            self.mission_diff_snapshots
                                .lock()
                                .await
                                .insert(query.mission_id.clone(), snapshot);
                            serde_json::to_value(view)?
                        }
                        Err(error) => {
                            serde_json::to_value(mission_workspace::MissionWorkspaceChangesView {
                                checkout_state,
                                view_id: None,
                                files: None,
                                diff_error: Some(format!("{error:#}")),
                            })?
                        }
                    };
                    let serialization_ms = serialization_started_at.elapsed().as_millis();
                    eprintln!(
                        "[mission-git-read] request={} method={} mission={:?} stage=read_complete workspace_lock_ms={} workspace_read_ms={} permit_wait_ms={} git_ms={} revalidate_lock_ms={} revalidate_read_ms={} serialization_ms={}",
                        request.id,
                        request.method,
                        query.mission_id,
                        workspace_lock_ms,
                        workspace_read_ms,
                        permit_wait_ms,
                        git_ms,
                        revalidate_lock_ms,
                        revalidate_read_ms,
                        serialization_ms,
                    );
                    Ok(value)
                } else {
                    let view_id = query
                        .view_id
                        .as_deref()
                        .context("mission.changes_refresh_required")?;
                    let snapshot = self
                        .mission_diff_snapshots
                        .lock()
                        .await
                        .get(&query.mission_id, workspace, view_id)
                        .context("mission.changes_refresh_required")?;
                    let diff = git
                        .file_diff(
                            workspace,
                            &snapshot,
                            query
                                .file_id
                                .as_deref()
                                .context("mission.file_id_required")?,
                        )
                        .await?;
                    let git_ms = git_started_at.elapsed().as_millis();
                    let (revalidate_lock_ms, revalidate_read_ms) = self
                        .ensure_mission_workspace_read_is_current(workspace)
                        .await?;
                    let serialization_started_at = Instant::now();
                    let value = serde_json::to_value(diff)?;
                    let serialization_ms = serialization_started_at.elapsed().as_millis();
                    eprintln!(
                        "[mission-git-read] request={} method={} mission={:?} stage=read_complete workspace_lock_ms={} workspace_read_ms={} permit_wait_ms={} git_ms={} revalidate_lock_ms={} revalidate_read_ms={} serialization_ms={}",
                        request.id,
                        request.method,
                        query.mission_id,
                        workspace_lock_ms,
                        workspace_read_ms,
                        permit_wait_ms,
                        git_ms,
                        revalidate_lock_ms,
                        revalidate_read_ms,
                        serialization_ms,
                    );
                    Ok(value)
                }
            }
            "missions.create" | "missions.createWithAttachments" => {
                let mut params: UserCommandParams<CreateMissionCommand> =
                    if request.method == "missions.createWithAttachments" {
                        anyhow::ensure!(request.client.is_desktop(), "mission.desktop_required");
                        let private: CreateMissionWithAttachmentsParams =
                            serde_json::from_value(request.params.clone())?;
                        let mut command = private.command;
                        command.source_attachments =
                            observe_mission_source_attachments(private.attachments).await?;
                        UserCommandParams {
                            command_id: private.command_id,
                            command,
                        }
                    } else {
                        serde_json::from_value(request.params.clone())?
                    };
                if params.command.project_binding_kind == ProjectBindingKind::QuickChat {
                    let path = self.data_dir.join("quick-chat");
                    std::fs::create_dir_all(&path)?;
                    params.command.project_path = path.to_string_lossy().into();
                }
                let selection = git::select_workspace(
                    Path::new(&params.command.project_path),
                    &self.data_dir,
                    params.command.project_binding_kind == ProjectBindingKind::QuickChat,
                )?;
                if !request.client.is_desktop() {
                    anyhow::ensure!(
                        selection.project_path == params.command.project_path,
                        "Authorized workspace changed before Mission creation"
                    );
                }
                params.command.project_path = selection.project_path;
                let mut database = self.database.lock().await;
                let execution = MissionService::default().create(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied
                    && let Some(camp_id) = execution.result.payload["campId"].as_str()
                {
                    self.attachment_views
                        .ensure_empty_camp_ready(&mut database, camp_id)?;
                }
                emit_missions_invalidated(
                    &self.output,
                    "missions.create",
                    execution.result.payload["campId"].as_str(),
                );
                Ok(serde_json::to_value(execution.result)?)
            }
            "missions.update"
            | "missions.updateWithAttachments"
            | "missions.status"
            | "missions.start"
            | "missions.linkPr" => {
                let private_update = if request.method == "missions.updateWithAttachments" {
                    anyhow::ensure!(request.client.is_desktop(), "mission.desktop_required");
                    let private: UpdateMissionWithAttachmentsParams =
                        serde_json::from_value(request.params.clone())?;
                    let mut command = private.command;
                    command.source_attachment_update = Some(MissionAttachmentUpdate {
                        keep_attachment_ids: private.keep_attachment_ids,
                        new_source_attachments: observe_mission_source_attachments(
                            private.attachments,
                        )
                        .await?,
                    });
                    Some(UserCommandParams {
                        command_id: private.command_id,
                        command,
                    })
                } else {
                    None
                };
                let mut database = self.database.lock().await;
                let execution = match request.method.as_str() {
                    "missions.update" | "missions.updateWithAttachments" => {
                        let params: UserCommandParams<UpdateMissionCommand> = match private_update {
                            Some(params) => params,
                            None => serde_json::from_value(request.params.clone())?,
                        };
                        MissionService::default().update(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    "missions.status" => {
                        let params: UserCommandParams<StatusMissionCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().status(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    "missions.linkPr" => {
                        let params: UserCommandParams<crate::mission::LinkMissionPrCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().link_pr(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    _ => {
                        let params: UserCommandParams<StartMissionCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().start(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                };
                if super::command_result_has_delivery_work(&execution.result.payload) {
                    self.delivery_batch_scheduler_notify.notify_one();
                }
                emit_missions_invalidated(&self.output, &request.method, None);
                Ok(serde_json::to_value(execution.result)?)
            }
            _ => anyhow::bail!("Unsupported Mission operation"),
        }
    }
}

async fn select_candidate(
    git: &MissionGit,
    repository: &GitRepository,
    mission: &crate::mission::MissionRecord,
    host: &str,
    start: u32,
) -> Result<MissionWorkspace> {
    let parent = repository
        .root
        .parent()
        .context("mission.repository_parent_missing")?;
    let name = repository
        .root
        .file_name()
        .context("mission.repository_name_missing")?
        .to_str()
        .context("mission.invalid_path")?;
    for suffix in start..=10000 {
        let suffix = if suffix == 1 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let mission_number = format!("{:03}", mission.number);
        let branch = format!("rovai/mission/{mission_number}{suffix}");
        let path = parent.join(format!("{name}-mission-{mission_number}{suffix}"));
        if !git.candidate_available(repository, &path, &branch).await? {
            continue;
        }
        return Ok(MissionWorkspace {
            id: uuid::Uuid::new_v4().to_string(),
            mission_id: mission.info.mission_id.clone(),
            camp_id: mission.camp_id.clone(),
            execution_host_id: host.into(),
            source_directory: mission.project_path.clone(),
            repository_root: repository
                .root
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            git_common_dir: repository
                .common_dir
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            worktree_path: path.to_str().context("mission.invalid_path")?.into(),
            working_directory: path
                .join(&repository.relative_directory)
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            base_branch: repository.base_branch.clone(),
            branch,
            base_sha: repository.base_sha.clone(),
            preparation_token: uuid::Uuid::new_v4().to_string(),
            preparation_kind: "create".into(),
            generation: 1,
            state: "preparing".into(),
            cleanup_command_id: None,
            cleanup_expected_branch_oid: None,
            cleanup_worktree_removed: false,
            cleanup_branch_removed: false,
            diagnostic: None,
        });
    }
    anyhow::bail!("mission.workspace_names_exhausted")
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::{cleanup_refusal_code, mission_workspace_read_matches, worktree_cleanup_required};
    use crate::mission_workspace::MissionWorkspace;

    fn workspace() -> MissionWorkspace {
        MissionWorkspace {
            id: "workspace-1".into(),
            mission_id: "mission-1".into(),
            camp_id: "camp-1".into(),
            execution_host_id: "host-1".into(),
            source_directory: "/source".into(),
            repository_root: "/source".into(),
            git_common_dir: "/source/.git".into(),
            worktree_path: "/worktree".into(),
            working_directory: "/worktree/project".into(),
            base_branch: Some("main".into()),
            branch: "rovai/mission/001".into(),
            base_sha: "base".into(),
            preparation_token: "token".into(),
            preparation_kind: "create".into(),
            generation: 1,
            state: "ready".into(),
            cleanup_command_id: None,
            cleanup_expected_branch_oid: None,
            cleanup_worktree_removed: false,
            cleanup_branch_removed: false,
            diagnostic: None,
        }
    }
    #[test]
    fn cleanup_retries_only_unfinished_worktree_and_classifies_safe_refusals() {
        assert!(worktree_cleanup_required(false));
        assert!(!worktree_cleanup_required(true));
        for code in [
            "mission.workspace_dirty",
            "mission.detached_head_unreachable",
        ] {
            assert_eq!(
                cleanup_refusal_code(&anyhow::anyhow!("context: {code}")),
                Some(code)
            );
        }
        assert_eq!(
            cleanup_refusal_code(&anyhow::anyhow!("mission.worktree_owner_mismatch")),
            None
        );
    }

    #[test]
    fn mission_git_reads_reject_cleanup_rebuild_and_replacement_workspaces() {
        let expected = workspace();
        assert!(mission_workspace_read_matches(&expected, &expected));

        let mut cleanup = expected.clone();
        cleanup.state = "cleanup_pending".into();
        assert!(!mission_workspace_read_matches(&expected, &cleanup));

        let mut rebuilt = expected.clone();
        rebuilt.generation += 1;
        assert!(!mission_workspace_read_matches(&expected, &rebuilt));

        let mut moved = expected.clone();
        moved.worktree_path = "/replacement".into();
        moved.working_directory = "/replacement/project".into();
        assert!(!mission_workspace_read_matches(&expected, &moved));

        let mut replacement = expected.clone();
        replacement.id = "workspace-2".into();
        assert!(!mission_workspace_read_matches(&expected, &replacement));
    }
}
