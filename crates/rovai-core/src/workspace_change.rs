use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
    sync::{Arc, OnceLock, Weak, mpsc as std_mpsc},
    time::{Duration, Instant},
};

#[cfg(not(unix))]
use std::fs::OpenOptions;

use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;

use crate::{
    db::Database,
    managed_blob::ManagedBlobStore,
    runtime_probe_process::{ProbeCommandLimits, run_bounded_command_with_input},
};

pub const CAPTURE_PROFILE_VERSION: i64 = 1;
const CAPTURE_DEADLINE: Duration = Duration::from_secs(8);
const CAPTURE_MAX_ATTEMPTS: usize = 6;
const CAPTURE_MAX_FILES: usize = 25_000;
const CAPTURE_MAX_BYTES: u64 = 512 * 1024 * 1024;
const CAPTURE_MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const DIFF_MAX_BYTES: usize = 24 * 1024 * 1024;
const GIT_STDOUT_MAX_BYTES: usize = 32 * 1024 * 1024;
const GIT_STDERR_MAX_BYTES: usize = 1024 * 1024;
const GIT_CLEANUP_TIMEOUT: Duration = Duration::from_millis(250);
const GIT_CLEANUP_RESERVE: Duration = Duration::from_millis(750);

static WORKSPACE_CHANGE_GIT_RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static WORKSPACE_CHANGE_GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorktreeIdentity {
    pub repository_root: String,
    pub worktree_git_dir: String,
    pub git_common_dir: String,
    pub object_format: String,
    pub object_database_dir: String,
    pub object_alternates_digest: Option<String>,
    pub identity_digest: String,
    pub canonical_execution_root: String,
    pub execution_root_relative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifestEntry {
    pub path: String,
    pub mode: String,
    pub source_kind: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureManifest {
    pub schema_version: u32,
    pub root_tree_oid: String,
    pub entries: Vec<CaptureManifestEntry>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct StableCapture {
    pub capture_started_at: String,
    pub captured_at: String,
    pub tree_oid: String,
    pub manifest: CaptureManifest,
}

#[derive(Debug, Clone)]
pub struct WindowAdmission {
    pub window_id: String,
    pub ref_token: String,
    pub identity: RepositoryWorktreeIdentity,
    pub needs_baseline: bool,
}

#[derive(Debug, Clone)]
pub struct WindowCloseRequest {
    pub window_id: String,
    pub ref_token: String,
    pub identity: RepositoryWorktreeIdentity,
    pub baseline_oid: String,
    pub baseline_manifest: CaptureManifest,
}

#[derive(Default)]
pub struct WorkspaceChangeCoordinator {
    gates: AsyncMutex<HashMap<WorkspaceChangeCoordinatorKey, Weak<AsyncMutex<()>>>>,
}

impl WorkspaceChangeCoordinator {
    pub async fn acquire(&self, identity: &RepositoryWorktreeIdentity) -> OwnedMutexGuard<()> {
        let key = WorkspaceChangeCoordinatorKey {
            canonical_execution_root: identity.canonical_execution_root.clone(),
            repository_identity_digest: identity.identity_digest.clone(),
        };
        let gate = {
            let mut gates = self.gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(AsyncMutex::new(()));
                gates.insert(key, Arc::downgrade(&gate));
                gate
            }
        };
        gate.lock_owned().await
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct WorkspaceChangeCoordinatorKey {
    canonical_execution_root: String,
    repository_identity_digest: String,
}

#[derive(Debug, Clone)]
struct InterruptedWindow {
    window_id: String,
    baseline_oid: Option<String>,
    final_oid: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingRefCleanup {
    window_id: String,
    ref_token: String,
    identity: RepositoryWorktreeIdentity,
    baseline_oid: Option<String>,
    final_oid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedFileView {
    pub path: String,
    pub change_kind: String,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangeWindowView {
    pub schema_version: u32,
    pub window_id: String,
    pub capture_status: String,
    pub execution_root_label: String,
    pub files: Vec<WorkspaceChangedFileView>,
    pub file_count: u64,
    pub additions: u64,
    pub deletions: u64,
    pub captured_at: String,
    pub has_diff_content: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangeWindowDiffView {
    pub schema_version: u32,
    pub window: WorkspaceChangeWindowView,
    pub diff: String,
}

#[derive(Debug, Clone)]
enum TreeEntry {
    Object {
        mode: String,
        object_type: &'static str,
        oid: String,
    },
    Directory(TreeNode),
}

#[derive(Debug, Clone, Default)]
struct TreeNode {
    entries: BTreeMap<String, TreeEntry>,
}

#[derive(Debug, Clone)]
struct CandidateEntry {
    relative_path: String,
    mode: String,
    index_oid: Option<String>,
    source_kind: String,
    sparse_omitted: bool,
}

pub fn discover_repository(execution_root: &Path) -> Result<Option<RepositoryWorktreeIdentity>> {
    discover_repository_until(execution_root, Instant::now() + CAPTURE_DEADLINE)
}

fn discover_repository_until(
    execution_root: &Path,
    deadline: Instant,
) -> Result<Option<RepositoryWorktreeIdentity>> {
    let canonical_execution_root = match fs::canonicalize(execution_root) {
        Ok(path) if path.is_dir() => path,
        Ok(_) => bail!("workspace_change_execution_root_not_directory"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let probe = git_output_at_until(
        &canonical_execution_root,
        &["rev-parse", "--is-inside-work-tree"],
        deadline,
    )?;
    if !probe.status.success() || stdout_text(&probe).trim() != "true" {
        return Ok(None);
    }
    let repository_root = canonical_git_path_until(
        &canonical_execution_root,
        &["rev-parse", "--show-toplevel"],
        None,
        deadline,
    )?;
    if !canonical_execution_root.starts_with(&repository_root) {
        bail!("workspace_change_execution_root_outside_repository");
    }
    let worktree_git_dir = canonical_git_path_until(
        &canonical_execution_root,
        &["rev-parse", "--absolute-git-dir"],
        None,
        deadline,
    )?;
    let common_raw = required_git_text_at_until(
        &canonical_execution_root,
        &["rev-parse", "--git-common-dir"],
        deadline,
    )?;
    let common_path = PathBuf::from(common_raw);
    let git_common_dir = fs::canonicalize(if common_path.is_absolute() {
        common_path
    } else {
        repository_root.join(common_path)
    })?;
    let object_format = required_git_text_at_until(
        &canonical_execution_root,
        &["rev-parse", "--show-object-format"],
        deadline,
    )?;
    if !matches!(object_format.as_str(), "sha1" | "sha256") {
        bail!("workspace_change_object_format_unsupported");
    }
    let object_database_dir = canonical_git_path_until(
        &canonical_execution_root,
        &["rev-parse", "--git-path", "objects"],
        Some(&repository_root),
        deadline,
    )?;
    let alternates_path = object_database_dir.join("info").join("alternates");
    let object_alternates_digest = match fs::read(&alternates_path) {
        Ok(bytes) => Some(format!("sha256:{:x}", Sha256::digest(bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let execution_root_relative = canonical_execution_root
        .strip_prefix(&repository_root)?
        .to_string_lossy()
        .replace('\\', "/");
    let identity_value = serde_json::json!({
        "repositoryRoot": repository_root,
        "worktreeGitDir": worktree_git_dir,
        "gitCommonDir": git_common_dir,
        "objectFormat": object_format,
        "objectDatabaseDir": object_database_dir,
        "objectAlternatesDigest": object_alternates_digest,
    });
    let identity_digest = format!(
        "sha256:{:x}",
        Sha256::digest(serde_json::to_vec(&identity_value)?)
    );
    Ok(Some(RepositoryWorktreeIdentity {
        repository_root: path_string(&repository_root)?,
        worktree_git_dir: path_string(&worktree_git_dir)?,
        git_common_dir: path_string(&git_common_dir)?,
        object_format,
        object_database_dir: path_string(&object_database_dir)?,
        object_alternates_digest,
        identity_digest,
        canonical_execution_root: path_string(&canonical_execution_root)?,
        execution_root_relative,
    }))
}

pub fn begin_or_join_window(
    database: &mut Database,
    camp_id: &str,
    identity: &RepositoryWorktreeIdentity,
) -> Result<WindowAdmission> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = transaction
        .query_row(
            r#"
            SELECT id, ref_token
            FROM workspace_change_window
            WHERE camp_id = ?1
              AND canonical_execution_root = ?2
              AND repository_identity_digest = ?3
              AND lifecycle = 'active'
            "#,
            params![
                camp_id,
                identity.canonical_execution_root,
                identity.identity_digest,
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((window_id, ref_token)) = existing {
        mark_overlapping_active_windows(&transaction, &window_id, identity)?;
        transaction.commit()?;
        return Ok(WindowAdmission {
            window_id,
            ref_token,
            identity: identity.clone(),
            needs_baseline: false,
        });
    }
    let obstructing = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM workspace_change_window
            WHERE canonical_execution_root = ?1
              AND lifecycle IN ('opening', 'closing')
        )
        "#,
        [&identity.canonical_execution_root],
        |row| row.get::<_, bool>(0),
    )?;
    if obstructing {
        bail!("workspace_change_window_closing");
    }
    let window_id = Uuid::new_v4().to_string();
    let ref_token = Uuid::new_v4().simple().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        INSERT INTO workspace_change_window(
            id, camp_id, canonical_execution_root,
            repository_identity_digest, repository_root, worktree_git_dir,
            git_common_dir, object_format, object_database_dir,
            object_alternates_digest, ref_token, lifecycle, capture_status,
            capture_profile_version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
            'opening', 'pending', ?12, ?13, ?13
        )
        "#,
        params![
            window_id,
            camp_id,
            identity.canonical_execution_root,
            identity.identity_digest,
            identity.repository_root,
            identity.worktree_git_dir,
            identity.git_common_dir,
            identity.object_format,
            identity.object_database_dir,
            identity.object_alternates_digest,
            ref_token,
            CAPTURE_PROFILE_VERSION,
            now,
        ],
    )?;
    mark_overlapping_active_windows(&transaction, &window_id, identity)?;
    transaction.commit()?;
    Ok(WindowAdmission {
        window_id,
        ref_token,
        identity: identity.clone(),
        needs_baseline: true,
    })
}

fn mark_overlapping_active_windows(
    transaction: &rusqlite::Transaction<'_>,
    window_id: &str,
    identity: &RepositoryWorktreeIdentity,
) -> Result<()> {
    let current_root = Path::new(&identity.canonical_execution_root);
    let mut statement = transaction.prepare(
        r#"
        SELECT id, canonical_execution_root
        FROM workspace_change_window
        WHERE id <> ?1
          AND repository_identity_digest = ?2
          AND lifecycle IN ('opening', 'active', 'closing')
        "#,
    )?;
    let overlapping = statement
        .query_map(params![window_id, identity.identity_digest], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|(id, root)| {
            let other_root = Path::new(&root);
            (current_root.starts_with(other_root) || other_root.starts_with(current_root))
                .then_some(id)
        })
        .collect::<Vec<_>>();
    drop(statement);
    if overlapping.is_empty() {
        return Ok(());
    }
    transaction.execute(
        "UPDATE workspace_change_window SET external_writer_observed = 1 WHERE id = ?1",
        [window_id],
    )?;
    for other_id in overlapping {
        transaction.execute(
            "UPDATE workspace_change_window SET external_writer_observed = 1 WHERE id = ?1",
            [other_id],
        )?;
    }
    Ok(())
}

pub fn stable_capture(
    identity: &RepositoryWorktreeIdentity,
    sticky_entries: &[CaptureManifestEntry],
) -> Result<StableCapture> {
    let started = chrono::Utc::now().to_rfc3339();
    let deadline = Instant::now() + CAPTURE_DEADLINE;
    let mut previous: Option<CaptureManifest> = None;
    for _ in 0..CAPTURE_MAX_ATTEMPTS {
        ensure_capture_deadline(deadline)?;
        verify_repository_identity_until(identity, deadline)?;
        let manifest = capture_once(identity, sticky_entries, deadline)?;
        if previous
            .as_ref()
            .is_some_and(|previous| previous.root_tree_oid == manifest.root_tree_oid)
        {
            validate_sparse_representation_transition(sticky_entries, &manifest)?;
            return Ok(StableCapture {
                capture_started_at: started,
                captured_at: chrono::Utc::now().to_rfc3339(),
                tree_oid: manifest.root_tree_oid.clone(),
                manifest,
            });
        }
        previous = Some(manifest);
    }
    bail!("workspace_change_capture_unstable")
}

fn validate_sparse_representation_transition(
    baseline_entries: &[CaptureManifestEntry],
    final_manifest: &CaptureManifest,
) -> Result<()> {
    if baseline_entries.is_empty() {
        return Ok(());
    }
    let final_by_path = final_manifest
        .entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect::<BTreeMap<_, _>>();
    for baseline in baseline_entries {
        let Some(final_entry) = final_by_path.get(baseline.path.as_str()) else {
            continue;
        };
        let representation_changed =
            (baseline.source_kind == "sparse_index") != (final_entry.source_kind == "sparse_index");
        if representation_changed && baseline.oid != final_entry.oid {
            bail!("workspace_change_sparse_representation_changed");
        }
    }
    Ok(())
}

pub fn publish_baseline(
    database: &mut Database,
    blob_store: &ManagedBlobStore,
    data_dir: &Path,
    admission: &WindowAdmission,
    capture: &StableCapture,
) -> Result<()> {
    let deadline = Instant::now() + CAPTURE_DEADLINE;
    let manifest = blob_store.put_bytes(
        database,
        &serde_json::to_vec(&capture.manifest)?,
        "application/vnd.rovai.workspace-capture+json",
        "sensitive",
    )?;
    let changed = database.connection().execute(
        r#"
        UPDATE workspace_change_window
        SET baseline_candidate_oid = ?2,
            baseline_manifest_blob_id = ?3,
            baseline_capture_started_at = ?4,
            updated_at = ?5
        WHERE id = ?1 AND lifecycle = 'opening' AND capture_status = 'pending'
        "#,
        params![
            admission.window_id,
            capture.tree_oid,
            manifest.id,
            capture.capture_started_at,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    if changed != 1 {
        bail!("workspace_change_baseline_candidate_fenced");
    }
    create_ref_until(
        &admission.identity,
        data_dir,
        &baseline_ref(&admission.ref_token),
        &capture.tree_oid,
        deadline,
    )?;
    verify_ref_until(
        &admission.identity,
        data_dir,
        &baseline_ref(&admission.ref_token),
        &capture.tree_oid,
        deadline,
    )?;
    let changed = database.connection().execute(
        r#"
        UPDATE workspace_change_window
        SET baseline_oid = baseline_candidate_oid,
            baseline_candidate_oid = NULL,
            baseline_captured_at = ?2,
            lifecycle = 'active', capture_status = 'baseline_ready',
            updated_at = ?2
        WHERE id = ?1 AND lifecycle = 'opening' AND capture_status = 'pending'
          AND baseline_candidate_oid = ?3
        "#,
        params![admission.window_id, capture.captured_at, capture.tree_oid,],
    )?;
    if changed != 1 {
        bail!("workspace_change_baseline_promotion_fenced");
    }
    Ok(())
}

pub fn mark_window_unavailable(
    database: &mut Database,
    window_id: &str,
    reason: &str,
    close: bool,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let changed = database.connection().execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = CASE WHEN ?3 = 1 THEN 'closed' ELSE 'active' END,
            capture_status = 'unavailable',
            unavailable_reason_code = ?2,
            updated_at = ?4
        WHERE id = ?1 AND lifecycle <> 'closed'
        "#,
        params![window_id, reason, i64::from(close), now],
    )?;
    if changed != 1 {
        bail!("workspace_change_unavailable_transition_fenced");
    }
    Ok(())
}

pub fn fail_baseline(
    database: &mut Database,
    data_dir: &Path,
    admission: &WindowAdmission,
    candidate_oid: Option<&str>,
    reason: &str,
) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let persisted_candidate_oid = transaction.query_row(
        "SELECT baseline_candidate_oid FROM workspace_change_window WHERE id = ?1",
        [&admission.window_id],
        |row| row.get::<_, Option<String>>(0),
    )?;
    if persisted_candidate_oid
        .as_deref()
        .zip(candidate_oid)
        .is_some_and(|(persisted, supplied)| persisted != supplied)
    {
        bail!("workspace_change_baseline_candidate_mismatch");
    }
    let cleanup_oid = persisted_candidate_oid.as_deref().or(candidate_oid);
    let now = chrono::Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = 'active', capture_status = 'unavailable',
            baseline_candidate_oid = NULL, unavailable_reason_code = ?2,
            updated_at = ?3
        WHERE id = ?1 AND lifecycle = 'opening' AND capture_status = 'pending'
        "#,
        params![admission.window_id, reason, now],
    )?;
    if changed != 1 {
        bail!("workspace_change_baseline_failure_fenced");
    }
    stage_ref_cleanup(
        &transaction,
        &admission.window_id,
        cleanup_oid,
        None,
        None,
        &now,
    )?;
    transaction.commit()?;
    let _ = attempt_pending_ref_cleanup(database, data_dir, &admission.window_id);
    Ok(())
}

pub fn join_window_participant(
    database: &mut Database,
    window_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let active = transaction.query_row(
        "SELECT lifecycle = 'active' FROM workspace_change_window WHERE id = ?1",
        [window_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !active {
        bail!("workspace_change_window_not_active");
    }
    transaction.execute(
        r#"
        INSERT INTO workspace_change_window_participant(
            window_id, agent_run_id, execution_epoch, joined_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(window_id, agent_run_id, execution_epoch) DO NOTHING
        "#,
        params![
            window_id,
            agent_run_id,
            execution_epoch,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn abort_unjoined_window(
    database: &mut Database,
    data_dir: &Path,
    admission: &WindowAdmission,
) -> Result<()> {
    if !admission.needs_baseline {
        return Ok(());
    }
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let baseline_oid = transaction.query_row(
        "SELECT COALESCE(baseline_oid, baseline_candidate_oid) FROM workspace_change_window WHERE id = ?1",
        [&admission.window_id],
        |row| row.get::<_, Option<String>>(0),
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = 'closed', capture_status = 'unavailable',
            unavailable_reason_code = 'workspace_change_run_admission_failed',
            baseline_candidate_oid = NULL, final_candidate_oid = NULL,
            final_manifest_blob_id = NULL, updated_at = ?2
        WHERE id = ?1 AND lifecycle <> 'closed'
        "#,
        params![admission.window_id, now],
    )?;
    if changed != 1 {
        bail!("workspace_change_unavailable_transition_fenced");
    }
    stage_ref_cleanup(
        &transaction,
        &admission.window_id,
        baseline_oid.as_deref(),
        None,
        None,
        &now,
    )?;
    transaction.commit()?;
    let _ = attempt_pending_ref_cleanup(database, data_dir, &admission.window_id);
    Ok(())
}

pub fn release_window_participant(
    database: &mut Database,
    blob_store: &ManagedBlobStore,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<WindowCloseRequest>> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = transaction
        .query_row(
            r#"
            SELECT window.id, window.ref_token, window.capture_status,
                   window.repository_root, window.worktree_git_dir,
                   window.git_common_dir, window.object_format,
                   window.object_database_dir, window.object_alternates_digest,
                   window.repository_identity_digest,
                   window.canonical_execution_root,
                   window.baseline_oid, window.baseline_manifest_blob_id
            FROM workspace_change_window_participant AS participant
            JOIN workspace_change_window AS window ON window.id = participant.window_id
            WHERE participant.agent_run_id = ?1
              AND participant.execution_epoch = ?2
              AND participant.released_at IS NULL
            "#,
            params![agent_run_id, execution_epoch],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ))
            },
        )
        .optional()?;
    let Some((
        window_id,
        ref_token,
        capture_status,
        repository_root,
        worktree_git_dir,
        git_common_dir,
        object_format,
        object_database_dir,
        object_alternates_digest,
        identity_digest,
        canonical_execution_root,
        baseline_oid,
        baseline_manifest_blob_id,
    )) = row
    else {
        transaction.commit()?;
        return Ok(None);
    };
    let released_at = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE workspace_change_window_participant
        SET released_at = ?3
        WHERE agent_run_id = ?1 AND execution_epoch = ?2 AND released_at IS NULL
        "#,
        params![agent_run_id, execution_epoch, released_at],
    )?;
    let active_count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM workspace_change_window_participant
        WHERE window_id = ?1 AND released_at IS NULL
        "#,
        [&window_id],
        |row| row.get(0),
    )?;
    if active_count > 0 {
        transaction.commit()?;
        return Ok(None);
    }
    if capture_status == "unavailable" {
        transaction.execute(
            r#"
            UPDATE workspace_change_window
            SET lifecycle = 'closed', updated_at = ?2
            WHERE id = ?1 AND lifecycle = 'active' AND capture_status = 'unavailable'
            "#,
            params![window_id, released_at],
        )?;
        transaction.commit()?;
        return Ok(None);
    }
    let changed = transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = 'closing', final_capture_started_at = ?2, updated_at = ?2
        WHERE id = ?1 AND lifecycle = 'active' AND capture_status = 'baseline_ready'
        "#,
        params![window_id, released_at],
    )?;
    if changed != 1 {
        transaction.commit()?;
        return Ok(None);
    }
    transaction.commit()?;
    let baseline_oid = baseline_oid.context("workspace_change_baseline_missing")?;
    let manifest_blob = baseline_manifest_blob_id.context("workspace_change_manifest_missing")?;
    let baseline_manifest = serde_json::from_slice::<CaptureManifest>(
        &blob_store.read_bytes(database, &manifest_blob)?,
    )?;
    let repository_root_path = PathBuf::from(&repository_root);
    let execution_root_relative = Path::new(&canonical_execution_root)
        .strip_prefix(&repository_root_path)?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(Some(WindowCloseRequest {
        window_id,
        ref_token,
        identity: RepositoryWorktreeIdentity {
            repository_root,
            worktree_git_dir,
            git_common_dir,
            object_format,
            object_database_dir,
            object_alternates_digest,
            identity_digest,
            canonical_execution_root,
            execution_root_relative,
        },
        baseline_oid,
        baseline_manifest,
    }))
}

pub fn participant_repository_identity(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<RepositoryWorktreeIdentity>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT window.repository_root, window.worktree_git_dir,
                   window.git_common_dir, window.object_format,
                   window.object_database_dir, window.object_alternates_digest,
                   window.repository_identity_digest,
                   window.canonical_execution_root
            FROM workspace_change_window_participant AS participant
            JOIN workspace_change_window AS window ON window.id = participant.window_id
            WHERE participant.agent_run_id = ?1
              AND participant.execution_epoch = ?2
              AND participant.released_at IS NULL
            "#,
            params![agent_run_id, execution_epoch],
            |row| {
                let repository_root = row.get::<_, String>(0)?;
                let canonical_execution_root = row.get::<_, String>(7)?;
                let execution_root_relative = Path::new(&canonical_execution_root)
                    .strip_prefix(Path::new(&repository_root))
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                Ok(RepositoryWorktreeIdentity {
                    repository_root,
                    worktree_git_dir: row.get(1)?,
                    git_common_dir: row.get(2)?,
                    object_format: row.get(3)?,
                    object_database_dir: row.get(4)?,
                    object_alternates_digest: row.get(5)?,
                    identity_digest: row.get(6)?,
                    canonical_execution_root,
                    execution_root_relative,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub fn fail_window_participant_after_unproven_quiescence(
    database: &mut Database,
    data_dir: &Path,
    agent_run_id: &str,
    execution_epoch: i64,
    reason: &str,
) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = transaction
        .query_row(
            r#"
            SELECT window.id, window.baseline_oid, window.final_candidate_oid
            FROM workspace_change_window_participant AS participant
            JOIN workspace_change_window AS window ON window.id = participant.window_id
            WHERE participant.agent_run_id = ?1
              AND participant.execution_epoch = ?2
              AND participant.released_at IS NULL
              AND window.lifecycle = 'active'
            "#,
            params![agent_run_id, execution_epoch],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((window_id, baseline_oid, final_candidate_oid)) = row else {
        transaction.commit()?;
        return Ok(());
    };
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE workspace_change_window_participant
        SET released_at = ?3
        WHERE agent_run_id = ?1 AND execution_epoch = ?2
          AND released_at IS NULL
        "#,
        params![agent_run_id, execution_epoch, now],
    )?;
    let active_count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM workspace_change_window_participant
        WHERE window_id = ?1 AND released_at IS NULL
        "#,
        [&window_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = CASE WHEN ?3 = 0 THEN 'closed' ELSE 'active' END,
            capture_status = 'unavailable', unavailable_reason_code = ?2,
            final_candidate_oid = NULL, final_manifest_blob_id = NULL,
            updated_at = ?4
        WHERE id = ?1 AND lifecycle = 'active'
        "#,
        params![window_id, reason, active_count, now],
    )?;
    stage_ref_cleanup(
        &transaction,
        &window_id,
        baseline_oid.as_deref(),
        final_candidate_oid.as_deref(),
        None,
        &now,
    )?;
    transaction.commit()?;
    let _ = attempt_pending_ref_cleanup(database, data_dir, &window_id);
    Ok(())
}

pub fn publish_final(
    database: &mut Database,
    blob_store: &ManagedBlobStore,
    data_dir: &Path,
    request: &WindowCloseRequest,
    capture: &StableCapture,
) -> Result<WorkspaceChangeWindowView> {
    let deadline = Instant::now() + CAPTURE_DEADLINE;
    verify_repository_identity_until(&request.identity, deadline)?;
    let manifest = blob_store.put_bytes(
        database,
        &serde_json::to_vec(&capture.manifest)?,
        "application/vnd.rovai.workspace-capture+json",
        "sensitive",
    )?;
    let staged = database.connection().execute(
        r#"
        UPDATE workspace_change_window
        SET final_candidate_oid = ?2, final_manifest_blob_id = ?3,
            final_capture_started_at = COALESCE(final_capture_started_at, ?4),
            updated_at = ?5
        WHERE id = ?1 AND lifecycle = 'closing' AND capture_status = 'baseline_ready'
        "#,
        params![
            request.window_id,
            capture.tree_oid,
            manifest.id,
            capture.capture_started_at,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    if staged != 1 {
        bail!("workspace_change_final_candidate_fenced");
    }
    create_ref_until(
        &request.identity,
        data_dir,
        &final_ref(&request.ref_token),
        &capture.tree_oid,
        deadline,
    )?;
    verify_ref_until(
        &request.identity,
        data_dir,
        &baseline_ref(&request.ref_token),
        &request.baseline_oid,
        deadline,
    )?;
    verify_ref_until(
        &request.identity,
        data_dir,
        &final_ref(&request.ref_token),
        &capture.tree_oid,
        deadline,
    )?;
    let patch = if request.baseline_oid == capture.tree_oid {
        String::new()
    } else {
        tree_diff(
            &request.identity,
            &request.baseline_oid,
            &capture.tree_oid,
            deadline,
        )?
    };
    let files = summarize_patch(&patch);
    let file_count = files.len() as u64;
    let additions = files.iter().map(|file| file.additions).sum::<u64>();
    let deletions = files.iter().map(|file| file.deletions).sum::<u64>();
    let diff_blob_id = if patch.is_empty() {
        None
    } else {
        Some(
            blob_store
                .put_bytes(database, patch.as_bytes(), "text/x-diff", "sensitive")?
                .id,
        )
    };
    let capture_status = if patch.is_empty() {
        "no_changes"
    } else {
        "complete"
    };
    let files_json = serde_json::to_string(&files)?;
    let participant_runs_json = {
        let mut statement = database.connection().prepare(
            r#"
            SELECT agent_run_id, execution_epoch
            FROM workspace_change_window_participant
            WHERE window_id = ?1
            ORDER BY joined_at, agent_run_id, execution_epoch
            "#,
        )?;
        let participants = statement
            .query_map([&request.window_id], |row| {
                Ok(serde_json::json!({
                    "agentRunId": row.get::<_, String>(0)?,
                    "executionEpoch": row.get::<_, i64>(1)?,
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        serde_json::to_string(&participants)?
    };
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let camp_id = transaction.query_row(
        "SELECT camp_id FROM workspace_change_window WHERE id = ?1",
        [&request.window_id],
        |row| row.get::<_, String>(0),
    )?;
    let changed = transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET final_oid = final_candidate_oid, final_candidate_oid = NULL,
            final_captured_at = ?2, lifecycle = 'closed', capture_status = ?3,
            diff_blob_id = ?4, files_json = ?5, file_count = ?6,
            additions = ?7, deletions = ?8, updated_at = ?2
        WHERE id = ?1 AND lifecycle = 'closing' AND capture_status = 'baseline_ready'
          AND final_candidate_oid = ?9
        "#,
        params![
            request.window_id,
            capture.captured_at,
            capture_status,
            diff_blob_id,
            files_json,
            file_count as i64,
            additions as i64,
            deletions as i64,
            capture.tree_oid,
        ],
    )?;
    if changed != 1 {
        bail!("workspace_change_final_promotion_fenced");
    }
    if let Some(diff_blob_id) = diff_blob_id.as_deref() {
        transaction.execute(
            r#"
            INSERT INTO workspace_change_completed_evidence(
                id, window_id, camp_id, canonical_execution_root,
                participant_runs_json, files_json, file_count,
                additions, deletions, diff_blob_id, baseline_oid,
                final_oid, captured_at, created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?13
            )
            "#,
            params![
                Uuid::new_v4().to_string(),
                request.window_id,
                camp_id,
                request.identity.canonical_execution_root,
                participant_runs_json,
                files_json,
                file_count as i64,
                additions as i64,
                deletions as i64,
                diff_blob_id,
                request.baseline_oid,
                capture.tree_oid,
                capture.captured_at,
            ],
        )?;
    }
    stage_ref_cleanup(
        &transaction,
        &request.window_id,
        Some(&request.baseline_oid),
        Some(&capture.tree_oid),
        None,
        &capture.captured_at,
    )?;
    transaction.commit()?;
    let _ = attempt_pending_ref_cleanup(database, data_dir, &request.window_id);
    Ok(WorkspaceChangeWindowView {
        schema_version: 1,
        window_id: request.window_id.clone(),
        capture_status: capture_status.to_string(),
        execution_root_label: execution_root_label(&request.identity.canonical_execution_root),
        files,
        file_count,
        additions,
        deletions,
        captured_at: capture.captured_at.clone(),
        has_diff_content: !patch.is_empty(),
    })
}

pub fn fail_close(
    database: &mut Database,
    data_dir: &Path,
    request: &WindowCloseRequest,
    reason: &str,
) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let final_candidate_oid = transaction.query_row(
        "SELECT final_candidate_oid FROM workspace_change_window WHERE id = ?1",
        [&request.window_id],
        |row| row.get::<_, Option<String>>(0),
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE workspace_change_window
        SET lifecycle = 'closed', capture_status = 'unavailable',
            unavailable_reason_code = ?2,
            final_candidate_oid = NULL, final_manifest_blob_id = NULL,
            updated_at = ?3
        WHERE id = ?1 AND lifecycle <> 'closed'
        "#,
        params![request.window_id, reason, now],
    )?;
    if changed != 1 {
        bail!("workspace_change_unavailable_transition_fenced");
    }
    stage_ref_cleanup(
        &transaction,
        &request.window_id,
        Some(&request.baseline_oid),
        final_candidate_oid.as_deref(),
        None,
        &now,
    )?;
    transaction.commit()?;
    let _ = attempt_pending_ref_cleanup(database, data_dir, &request.window_id);
    Ok(())
}

pub fn list_completed_windows(
    transaction: &rusqlite::Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<WorkspaceChangeWindowView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT window_id, canonical_execution_root, files_json,
               file_count, additions, deletions, captured_at
        FROM workspace_change_completed_evidence
        WHERE camp_id = ?1
        ORDER BY captured_at, id
        "#,
    )?;
    Ok(statement
        .query_map([camp_id], |row| {
            let files_json = row.get::<_, String>(2)?;
            let files = serde_json::from_str(&files_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    2,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            let root = row.get::<_, String>(1)?;
            Ok(WorkspaceChangeWindowView {
                schema_version: 1,
                window_id: row.get(0)?,
                capture_status: "complete".to_string(),
                execution_root_label: execution_root_label(&root),
                files,
                file_count: row.get::<_, i64>(3)? as u64,
                additions: row.get::<_, i64>(4)? as u64,
                deletions: row.get::<_, i64>(5)? as u64,
                captured_at: row.get::<_, String>(6)?,
                has_diff_content: true,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn read_window_diff(
    database: &Database,
    blob_store: &ManagedBlobStore,
    camp_id: &str,
    window_id: &str,
) -> Result<WorkspaceChangeWindowDiffView> {
    let row = database
        .connection()
        .query_row(
            r#"
            SELECT canonical_execution_root, files_json, file_count,
                   additions, deletions, captured_at, diff_blob_id
            FROM workspace_change_completed_evidence
            WHERE window_id = ?1 AND camp_id = ?2
            "#,
            params![window_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?
        .context("Workspace Change Window does not exist in this Camp")?;
    let files = serde_json::from_str::<Vec<WorkspaceChangedFileView>>(&row.0)?;
    let blob_id = row.6;
    let diff = blob_store.read_text(database, &blob_id)?;
    Ok(WorkspaceChangeWindowDiffView {
        schema_version: 1,
        window: WorkspaceChangeWindowView {
            schema_version: 1,
            window_id: window_id.to_string(),
            capture_status: "complete".to_string(),
            execution_root_label: execution_root_label(&row.1),
            files,
            file_count: row.2 as u64,
            additions: row.3 as u64,
            deletions: row.4 as u64,
            captured_at: row.5,
            has_diff_content: true,
        },
        diff,
    })
}

pub fn recover_interrupted_windows(database: &mut Database, data_dir: &Path) -> Result<usize> {
    let windows = {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id,
                   COALESCE(baseline_oid, baseline_candidate_oid),
                   COALESCE(final_oid, final_candidate_oid)
            FROM workspace_change_window
            WHERE lifecycle IN ('opening', 'active', 'closing')
            ORDER BY id
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok(InterruptedWindow {
                    window_id: row.get(0)?,
                    baseline_oid: row.get(1)?,
                    final_oid: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if windows.is_empty() {
        retry_pending_ref_cleanup(database, data_dir)?;
        return Ok(0);
    }
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    for window in &windows {
        transaction.execute(
            r#"
            UPDATE workspace_change_window
            SET lifecycle = 'closed', capture_status = 'unavailable',
                unavailable_reason_code = 'workspace_change_restart_boundary_unknown',
                baseline_candidate_oid = NULL,
                final_candidate_oid = NULL, final_manifest_blob_id = NULL,
                updated_at = ?2
            WHERE id = ?1 AND lifecycle IN ('opening', 'active', 'closing')
            "#,
            params![window.window_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE workspace_change_window_participant
            SET released_at = COALESCE(released_at, ?2)
            WHERE window_id = ?1
            "#,
            params![window.window_id, now],
        )?;
        stage_ref_cleanup(
            &transaction,
            &window.window_id,
            window.baseline_oid.as_deref(),
            window.final_oid.as_deref(),
            Some("workspace_change_ref_cleanup_pending"),
            &now,
        )?;
    }
    transaction.commit()?;
    retry_pending_ref_cleanup(database, data_dir)?;
    Ok(windows.len())
}

fn capture_once(
    identity: &RepositoryWorktreeIdentity,
    sticky_entries: &[CaptureManifestEntry],
    deadline: Instant,
) -> Result<CaptureManifest> {
    ensure_capture_deadline(deadline)?;
    let root = Path::new(&identity.canonical_execution_root);
    let pathspec = if identity.execution_root_relative.is_empty() {
        "."
    } else {
        identity.execution_root_relative.as_str()
    };
    let staged = git_output_until(
        identity,
        &["ls-files", "--stage", "-z", "--", pathspec],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&staged, "workspace_change_ls_files_failed")?;
    let sparse = git_output_until(
        identity,
        &["ls-files", "-v", "-z", "--", pathspec],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&sparse, "workspace_change_sparse_probe_failed")?;
    let sparse_paths = parse_sparse_paths(&sparse.stdout)?;
    let mut candidates = parse_tracked_entries(identity, &staged.stdout, &sparse_paths)?;
    let others = git_output_until(
        identity,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            pathspec,
        ],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&others, "workspace_change_untracked_probe_failed")?;
    for repository_path in parse_nul_paths(&others.stdout)? {
        if let Some(relative_path) = relative_capture_path(identity, &repository_path)? {
            candidates
                .entry(relative_path.clone())
                .or_insert(CandidateEntry {
                    relative_path,
                    mode: String::new(),
                    index_oid: None,
                    source_kind: "untracked".to_string(),
                    sparse_omitted: false,
                });
        }
    }
    for sticky in sticky_entries {
        if candidates.contains_key(&sticky.path) {
            continue;
        }
        if root.join(&sticky.path).symlink_metadata().is_ok() {
            candidates.insert(
                sticky.path.clone(),
                CandidateEntry {
                    relative_path: sticky.path.clone(),
                    mode: sticky.mode.clone(),
                    index_oid: None,
                    source_kind: "sticky".to_string(),
                    sparse_omitted: false,
                },
            );
        }
    }
    if candidates.len() > CAPTURE_MAX_FILES {
        bail!("workspace_change_file_limit");
    }
    let mut total_bytes = 0_u64;
    let mut manifest_entries = Vec::new();
    let mut tree = TreeNode::default();
    for candidate in candidates.into_values() {
        ensure_capture_deadline(deadline)?;
        if candidate.relative_path.contains('\n') || candidate.relative_path.contains('\r') {
            bail!("workspace_change_path_encoding_unsupported");
        }
        let path = root.join(&candidate.relative_path);
        if candidate.mode == "160000" {
            let oid = candidate
                .index_oid
                .context("workspace_change_gitlink_oid_missing")?;
            tree.insert(
                &candidate.relative_path,
                TreeEntry::Object {
                    mode: "160000".to_string(),
                    object_type: "commit",
                    oid: oid.clone(),
                },
            )?;
            manifest_entries.push(CaptureManifestEntry {
                path: candidate.relative_path,
                mode: "160000".to_string(),
                source_kind: "gitlink".to_string(),
                oid,
            });
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && candidate.sparse_omitted =>
            {
                let oid = candidate
                    .index_oid
                    .context("workspace_change_sparse_oid_missing")?;
                tree.insert(
                    &candidate.relative_path,
                    TreeEntry::Object {
                        mode: candidate.mode.clone(),
                        object_type: "blob",
                        oid: oid.clone(),
                    },
                )?;
                manifest_entries.push(CaptureManifestEntry {
                    path: candidate.relative_path,
                    mode: candidate.mode,
                    source_kind: "sparse_index".to_string(),
                    oid,
                });
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if metadata.is_dir() {
            // `git ls-files --others` reports nested repositories as opaque
            // directory boundaries. They intentionally have no inner entries.
            continue;
        }
        if crosses_nested_repository_boundary(root, Path::new(&candidate.relative_path))? {
            continue;
        }
        verify_no_symlink_ancestors(root, Path::new(&candidate.relative_path))?;
        let (bytes, mode) = if metadata.file_type().is_symlink() {
            (
                read_link_bytes(root, Path::new(&candidate.relative_path))?,
                "120000".to_string(),
            )
        } else if metadata.is_file() {
            let (bytes, opened_metadata) =
                read_regular_file_no_follow(root, Path::new(&candidate.relative_path))?;
            let mode = captured_regular_mode(&opened_metadata, &candidate.mode);
            (bytes, mode)
        } else {
            bail!("workspace_change_file_type_unsupported");
        };
        let byte_count = bytes.len() as u64;
        if byte_count > CAPTURE_MAX_FILE_BYTES {
            bail!("workspace_change_single_file_limit");
        }
        total_bytes = total_bytes
            .checked_add(byte_count)
            .context("workspace_change_size_overflow")?;
        if total_bytes > CAPTURE_MAX_BYTES {
            bail!("workspace_change_total_bytes_limit");
        }
        ensure_capture_deadline(deadline)?;
        let oid = hash_blob(identity, &bytes, deadline)?;
        tree.insert(
            &candidate.relative_path,
            TreeEntry::Object {
                mode: mode.clone(),
                object_type: "blob",
                oid: oid.clone(),
            },
        )?;
        manifest_entries.push(CaptureManifestEntry {
            path: candidate.relative_path,
            mode,
            source_kind: candidate.source_kind,
            oid,
        });
    }
    manifest_entries.sort_by(|left, right| left.path.cmp(&right.path));
    let root_tree_oid = write_tree(identity, &tree, deadline)?;
    Ok(CaptureManifest {
        schema_version: 1,
        root_tree_oid,
        entries: manifest_entries,
        total_bytes,
    })
}

impl TreeNode {
    fn insert(&mut self, path: &str, entry: TreeEntry) -> Result<()> {
        let parts = path
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.is_empty() {
            bail!("workspace_change_tree_path_empty");
        }
        self.insert_parts(&parts, entry)
    }

    fn insert_parts(&mut self, parts: &[&str], entry: TreeEntry) -> Result<()> {
        if parts.len() == 1 {
            if self.entries.insert(parts[0].to_string(), entry).is_some() {
                bail!("workspace_change_tree_path_collision");
            }
            return Ok(());
        }
        let child = self
            .entries
            .entry(parts[0].to_string())
            .or_insert_with(|| TreeEntry::Directory(TreeNode::default()));
        match child {
            TreeEntry::Directory(node) => node.insert_parts(&parts[1..], entry),
            TreeEntry::Object { .. } => bail!("workspace_change_tree_boundary_collision"),
        }
    }
}

fn write_tree(
    identity: &RepositoryWorktreeIdentity,
    node: &TreeNode,
    deadline: Instant,
) -> Result<String> {
    ensure_capture_deadline(deadline)?;
    let mut input = Vec::new();
    for (name, entry) in &node.entries {
        if name.contains('/') || name.contains('\0') {
            bail!("workspace_change_tree_name_invalid");
        }
        let (mode, object_type, oid) = match entry {
            TreeEntry::Object {
                mode,
                object_type,
                oid,
            } => (mode.clone(), *object_type, oid.clone()),
            TreeEntry::Directory(child) => (
                "040000".to_string(),
                "tree",
                write_tree(identity, child, deadline)?,
            ),
        };
        input.extend_from_slice(mode.as_bytes());
        input.push(b' ');
        input.extend_from_slice(object_type.as_bytes());
        input.push(b' ');
        input.extend_from_slice(oid.as_bytes());
        input.push(b'\t');
        input.extend_from_slice(name.as_bytes());
        input.push(0);
    }
    let output = git_output_until(
        identity,
        &["mktree", "-z"],
        Some(&input),
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&output, "workspace_change_mktree_failed")?;
    Ok(stdout_text(&output).trim().to_string())
}

fn hash_blob(
    identity: &RepositoryWorktreeIdentity,
    bytes: &[u8],
    deadline: Instant,
) -> Result<String> {
    let output = git_output_until(
        identity,
        &["hash-object", "-w", "--stdin"],
        Some(bytes),
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&output, "workspace_change_hash_object_failed")?;
    Ok(stdout_text(&output).trim().to_string())
}

fn tree_diff(
    identity: &RepositoryWorktreeIdentity,
    baseline_oid: &str,
    final_oid: &str,
    deadline: Instant,
) -> Result<String> {
    let output = git_output_until(
        identity,
        &[
            "-c",
            "core.quotePath=false",
            "-c",
            "diff.renameLimit=1000",
            "diff-tree",
            "--no-commit-id",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--full-index",
            "--binary",
            "--find-renames=50%",
            "-r",
            "-p",
            baseline_oid,
            final_oid,
        ],
        None,
        deadline,
        DIFF_MAX_BYTES,
    )
    .map_err(|error| {
        if error.to_string() == "workspace_change_git_output_limit" {
            anyhow::anyhow!("workspace_change_diff_size_limit")
        } else {
            error
        }
    })?;
    ensure_git_success(&output, "workspace_change_diff_failed")?;
    if output.stdout.len() > DIFF_MAX_BYTES {
        bail!("workspace_change_diff_size_limit");
    }
    String::from_utf8(output.stdout).context("workspace_change_diff_not_utf8")
}

fn summarize_patch(patch: &str) -> Vec<WorkspaceChangedFileView> {
    let mut files = Vec::<WorkspaceChangedFileView>::new();
    let mut current: Option<usize> = None;
    for line in patch.lines() {
        if let Some(marker) = line
            .rfind(" b/")
            .filter(|_| line.starts_with("diff --git a/"))
        {
            let path = line[marker + 3..].to_string();
            current = Some(files.len());
            files.push(WorkspaceChangedFileView {
                path,
                change_kind: "update".to_string(),
                additions: 0,
                deletions: 0,
            });
            continue;
        }
        let Some(index) = current else {
            continue;
        };
        if line.starts_with("new file mode ") {
            files[index].change_kind = "add".to_string();
        } else if line.starts_with("deleted file mode ") {
            files[index].change_kind = "delete".to_string();
        } else if let Some(path) = line.strip_prefix("rename to ") {
            files[index].path = path.to_string();
        } else if line.starts_with('+') && !line.starts_with("+++") {
            files[index].additions = files[index].additions.saturating_add(1);
        } else if line.starts_with('-') && !line.starts_with("---") {
            files[index].deletions = files[index].deletions.saturating_add(1);
        }
    }
    files
}

fn parse_tracked_entries(
    identity: &RepositoryWorktreeIdentity,
    bytes: &[u8],
    sparse_paths: &BTreeSet<String>,
) -> Result<BTreeMap<String, CandidateEntry>> {
    let mut entries = BTreeMap::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let record = std::str::from_utf8(record).context("workspace_change_git_path_not_utf8")?;
        let (metadata, repository_path) = record
            .split_once('\t')
            .context("workspace_change_ls_files_record_invalid")?;
        let fields = metadata.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 3 || fields[2] != "0" {
            bail!("workspace_change_unmerged_index");
        }
        let Some(relative_path) = relative_capture_path(identity, repository_path)? else {
            continue;
        };
        entries.insert(
            relative_path.clone(),
            CandidateEntry {
                relative_path,
                mode: fields[0].to_string(),
                index_oid: Some(fields[1].to_string()),
                source_kind: "tracked".to_string(),
                sparse_omitted: sparse_paths.contains(repository_path),
            },
        );
    }
    Ok(entries)
}

fn parse_sparse_paths(bytes: &[u8]) -> Result<BTreeSet<String>> {
    let mut paths = BTreeSet::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let record = std::str::from_utf8(record).context("workspace_change_git_path_not_utf8")?;
        if let Some(path) = record.strip_prefix("S ") {
            paths.insert(path.to_string());
        }
    }
    Ok(paths)
}

fn parse_nul_paths(bytes: &[u8]) -> Result<Vec<String>> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| {
            std::str::from_utf8(path)
                .map(str::to_string)
                .context("workspace_change_git_path_not_utf8")
        })
        .collect()
}

fn relative_capture_path(
    identity: &RepositoryWorktreeIdentity,
    repository_path: &str,
) -> Result<Option<String>> {
    let prefix = identity.execution_root_relative.trim_matches('/');
    let relative = if prefix.is_empty() {
        repository_path
    } else if repository_path == prefix {
        return Ok(None);
    } else if let Some(relative) = repository_path.strip_prefix(&format!("{prefix}/")) {
        relative
    } else {
        return Ok(None);
    };
    validate_relative_path(relative)?;
    Ok(Some(relative.to_string()))
}

fn validate_relative_path(path: &str) -> Result<()> {
    if path.is_empty() || path.starts_with('/') || path.contains('\0') {
        bail!("workspace_change_path_invalid");
    }
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) if !value.to_string_lossy().eq_ignore_ascii_case(".git") => {}
            Component::CurDir => {}
            _ => bail!("workspace_change_path_escape"),
        }
    }
    Ok(())
}

fn verify_no_symlink_ancestors(root: &Path, relative: &Path) -> Result<()> {
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        let Component::Normal(component) = component else {
            bail!("workspace_change_path_escape");
        };
        current.push(component);
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() {
            bail!("workspace_change_symlink_boundary");
        }
        if !metadata.is_dir() {
            bail!("workspace_change_directory_boundary");
        }
    }
    Ok(())
}

fn crosses_nested_repository_boundary(root: &Path, relative: &Path) -> Result<bool> {
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        let Component::Normal(component) = component else {
            bail!("workspace_change_path_escape");
        };
        current.push(component);
        if fs::symlink_metadata(current.join(".git")).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
fn read_regular_file_no_follow(root: &Path, relative: &Path) -> Result<(Vec<u8>, fs::Metadata)> {
    use std::{
        ffi::CString,
        fs::File,
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::ffi::OsStrExt,
        },
    };

    let root_path = CString::new(root.as_os_str().as_bytes())?;
    let root_fd = unsafe {
        libc::open(
            root_path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if root_fd < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut directory = unsafe { OwnedFd::from_raw_fd(root_fd) };
    let components = relative.components().collect::<Vec<_>>();
    if components.is_empty() {
        bail!("workspace_change_path_invalid");
    }
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(component) = component else {
            bail!("workspace_change_path_escape");
        };
        let name = CString::new(component.as_bytes())?;
        let final_component = index + 1 == components.len();
        let flags = if final_component {
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        } else {
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        };
        let opened = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if opened < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let opened = unsafe { OwnedFd::from_raw_fd(opened) };
        if !final_component {
            directory = opened;
            continue;
        }
        let mut file = File::from(opened);
        let before = file.metadata()?;
        if !before.is_file() || before.len() > CAPTURE_MAX_FILE_BYTES {
            bail!("workspace_change_file_changed_during_capture");
        }
        let mut bytes = Vec::with_capacity(before.len() as usize);
        file.read_to_end(&mut bytes)?;
        let after = file.metadata()?;
        if before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
            || bytes.len() as u64 != after.len()
        {
            bail!("workspace_change_file_changed_during_capture");
        }
        return Ok((bytes, after));
    }
    bail!("workspace_change_path_invalid")
}

#[cfg(not(unix))]
fn read_regular_file_no_follow(root: &Path, relative: &Path) -> Result<(Vec<u8>, fs::Metadata)> {
    let path = root.join(relative);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(path)?;
    let before = file.metadata()?;
    if !before.is_file() || before.len() > CAPTURE_MAX_FILE_BYTES {
        bail!("workspace_change_file_changed_during_capture");
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    if before.len() != after.len() || bytes.len() as u64 != after.len() {
        bail!("workspace_change_file_changed_during_capture");
    }
    Ok((bytes, after))
}

#[cfg(unix)]
fn read_link_bytes(root: &Path, relative: &Path) -> Result<Vec<u8>> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::ffi::OsStrExt,
        },
    };

    let root_path = CString::new(root.as_os_str().as_bytes())?;
    let root_fd = unsafe {
        libc::open(
            root_path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if root_fd < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut directory = unsafe { OwnedFd::from_raw_fd(root_fd) };
    let components = relative.components().collect::<Vec<_>>();
    let Some((file_name, parent_components)) = components.split_last() else {
        bail!("workspace_change_path_invalid");
    };
    for component in parent_components {
        let Component::Normal(component) = component else {
            bail!("workspace_change_path_escape");
        };
        let name = CString::new(component.as_bytes())?;
        let opened = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if opened < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        directory = unsafe { OwnedFd::from_raw_fd(opened) };
    }
    let Component::Normal(file_name) = file_name else {
        bail!("workspace_change_path_escape");
    };
    let name = CString::new(file_name.as_bytes())?;
    let mut bytes = vec![0_u8; 256];
    loop {
        let length = unsafe {
            libc::readlinkat(
                directory.as_raw_fd(),
                name.as_ptr(),
                bytes.as_mut_ptr().cast(),
                bytes.len(),
            )
        };
        if length < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let length = length as usize;
        if length < bytes.len() {
            bytes.truncate(length);
            return Ok(bytes);
        }
        if bytes.len() >= CAPTURE_MAX_FILE_BYTES as usize {
            bail!("workspace_change_single_file_limit");
        }
        bytes.resize((bytes.len() * 2).min(CAPTURE_MAX_FILE_BYTES as usize), 0);
    }
}

#[cfg(not(unix))]
fn read_link_bytes(root: &Path, relative: &Path) -> Result<Vec<u8>> {
    Ok(fs::read_link(root.join(relative))?
        .to_string_lossy()
        .as_bytes()
        .to_vec())
}

#[cfg(unix)]
fn captured_regular_mode(metadata: &fs::Metadata, _index_mode: &str) -> String {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 != 0 {
        "100755".to_string()
    } else {
        "100644".to_string()
    }
}

#[cfg(not(unix))]
fn captured_regular_mode(_metadata: &fs::Metadata, index_mode: &str) -> String {
    if index_mode == "100755" {
        "100755".to_string()
    } else {
        "100644".to_string()
    }
}

fn verify_repository_identity_until(
    identity: &RepositoryWorktreeIdentity,
    deadline: Instant,
) -> Result<()> {
    let observed =
        discover_repository_until(Path::new(&identity.canonical_execution_root), deadline)?
            .context("workspace_change_repository_unavailable")?;
    if observed.identity_digest != identity.identity_digest {
        bail!("workspace_change_repository_identity_changed");
    }
    Ok(())
}

fn baseline_ref(token: &str) -> String {
    format!("refs/rovai/w/{token}/b")
}

fn final_ref(token: &str) -> String {
    format!("refs/rovai/w/{token}/f")
}

#[cfg(test)]
fn create_ref(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    reference: &str,
    oid: &str,
) -> Result<()> {
    create_ref_until(
        identity,
        data_dir,
        reference,
        oid,
        Instant::now() + CAPTURE_DEADLINE,
    )
}

fn create_ref_until(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    reference: &str,
    oid: &str,
    deadline: Instant,
) -> Result<()> {
    let hooks = empty_hooks_dir(data_dir)?;
    let zero = if identity.object_format == "sha256" {
        "0".repeat(64)
    } else {
        "0".repeat(40)
    };
    let output = git_output_until(
        identity,
        &[
            "-c",
            &format!("core.hooksPath={}", hooks.to_string_lossy()),
            "update-ref",
            "--no-deref",
            reference,
            oid,
            &zero,
        ],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&output, "workspace_change_ref_create_failed")
}

#[cfg(test)]
fn verify_ref(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    reference: &str,
    expected: &str,
) -> Result<()> {
    verify_ref_until(
        identity,
        data_dir,
        reference,
        expected,
        Instant::now() + CAPTURE_DEADLINE,
    )
}

fn verify_ref_until(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    reference: &str,
    expected: &str,
    deadline: Instant,
) -> Result<()> {
    let hooks = empty_hooks_dir(data_dir)?;
    let output = git_output_until(
        identity,
        &[
            "-c",
            &format!("core.hooksPath={}", hooks.to_string_lossy()),
            "rev-parse",
            "--verify",
            reference,
        ],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&output, "workspace_change_ref_verify_failed")?;
    if stdout_text(&output).trim() != expected {
        bail!("workspace_change_ref_tampered");
    }
    let object_type = git_output_until(
        identity,
        &["cat-file", "-t", expected],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&object_type, "workspace_change_ref_object_missing")?;
    if stdout_text(&object_type).trim() != "tree" {
        bail!("workspace_change_ref_object_not_tree");
    }
    Ok(())
}

fn delete_ref_if_matches_until(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    reference: &str,
    expected: Option<&str>,
    deadline: Instant,
) -> Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let hooks = empty_hooks_dir(data_dir)?;
    let output = git_output_until(
        identity,
        &[
            "-c",
            &format!("core.hooksPath={}", hooks.to_string_lossy()),
            "update-ref",
            "--no-deref",
            "-d",
            reference,
            expected,
        ],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    if output.status.success() {
        return Ok(());
    }
    let observed = git_output_until(
        identity,
        &["for-each-ref", "--format=%(objectname)", reference],
        None,
        deadline,
        GIT_STDOUT_MAX_BYTES,
    )?;
    ensure_git_success(&observed, "workspace_change_ref_cleanup_probe_failed")?;
    let observed = stdout_text(&observed);
    let observed = observed.trim();
    if observed.is_empty() {
        return Ok(());
    }
    if observed != expected {
        bail!("workspace_change_ref_cleanup_expected_oid_changed");
    }
    ensure_git_success(&output, "workspace_change_ref_cleanup_failed")
}

fn cleanup_window_refs(
    identity: &RepositoryWorktreeIdentity,
    data_dir: &Path,
    token: &str,
    baseline_oid: Option<&str>,
    final_oid: Option<&str>,
) -> Result<()> {
    let deadline = Instant::now() + CAPTURE_DEADLINE;
    let final_result =
        delete_ref_if_matches_until(identity, data_dir, &final_ref(token), final_oid, deadline);
    let baseline_result = delete_ref_if_matches_until(
        identity,
        data_dir,
        &baseline_ref(token),
        baseline_oid,
        deadline,
    );
    final_result.and(baseline_result)
}

fn stage_ref_cleanup(
    transaction: &rusqlite::Transaction<'_>,
    window_id: &str,
    baseline_oid: Option<&str>,
    final_oid: Option<&str>,
    error_code: Option<&str>,
    now: &str,
) -> Result<()> {
    if baseline_oid.is_none() && final_oid.is_none() {
        return Ok(());
    }
    let changed = transaction.execute(
        r#"
        INSERT INTO workspace_change_ref_cleanup(
            window_id, baseline_oid, final_oid, error_code,
            attempt_count, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 0, ?5)
        ON CONFLICT(window_id) DO UPDATE SET
            baseline_oid = COALESCE(
                workspace_change_ref_cleanup.baseline_oid,
                excluded.baseline_oid
            ),
            final_oid = COALESCE(
                workspace_change_ref_cleanup.final_oid,
                excluded.final_oid
            ),
            error_code = COALESCE(excluded.error_code, error_code),
            updated_at = excluded.updated_at
        WHERE (
                workspace_change_ref_cleanup.baseline_oid IS NULL
                OR excluded.baseline_oid IS NULL
                OR workspace_change_ref_cleanup.baseline_oid = excluded.baseline_oid
            )
          AND (
                workspace_change_ref_cleanup.final_oid IS NULL
                OR excluded.final_oid IS NULL
                OR workspace_change_ref_cleanup.final_oid = excluded.final_oid
            )
        "#,
        params![window_id, baseline_oid, final_oid, error_code, now],
    )?;
    if changed != 1 {
        bail!("workspace_change_ref_cleanup_expected_oid_conflict");
    }
    Ok(())
}

fn load_pending_ref_cleanup(
    database: &Database,
    window_id: &str,
) -> Result<Option<PendingRefCleanup>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT window.id, window.ref_token,
                   window.repository_root, window.worktree_git_dir,
                   window.git_common_dir, window.object_format,
                   window.object_database_dir, window.object_alternates_digest,
                   window.repository_identity_digest,
                   window.canonical_execution_root,
                   cleanup.baseline_oid, cleanup.final_oid
            FROM workspace_change_ref_cleanup AS cleanup
            JOIN workspace_change_window AS window ON window.id = cleanup.window_id
            WHERE cleanup.window_id = ?1
            "#,
            [window_id],
            |row| {
                let repository_root = row.get::<_, String>(2)?;
                let canonical_execution_root = row.get::<_, String>(9)?;
                let execution_root_relative = Path::new(&canonical_execution_root)
                    .strip_prefix(Path::new(&repository_root))
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                Ok(PendingRefCleanup {
                    window_id: row.get(0)?,
                    ref_token: row.get(1)?,
                    identity: RepositoryWorktreeIdentity {
                        repository_root,
                        worktree_git_dir: row.get(3)?,
                        git_common_dir: row.get(4)?,
                        object_format: row.get(5)?,
                        object_database_dir: row.get(6)?,
                        object_alternates_digest: row.get(7)?,
                        identity_digest: row.get(8)?,
                        canonical_execution_root,
                        execution_root_relative,
                    },
                    baseline_oid: row.get(10)?,
                    final_oid: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn attempt_pending_ref_cleanup(
    database: &mut Database,
    data_dir: &Path,
    window_id: &str,
) -> Result<()> {
    let Some(cleanup) = load_pending_ref_cleanup(database, window_id)? else {
        return Ok(());
    };
    let result = cleanup_window_refs(
        &cleanup.identity,
        data_dir,
        &cleanup.ref_token,
        cleanup.baseline_oid.as_deref(),
        cleanup.final_oid.as_deref(),
    );
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    match result {
        Ok(()) => {
            transaction.execute(
                "DELETE FROM workspace_change_ref_cleanup WHERE window_id = ?1",
                [&cleanup.window_id],
            )?;
            transaction.execute(
                "UPDATE workspace_change_window SET cleanup_error_code = NULL WHERE id = ?1",
                [&cleanup.window_id],
            )?;
            transaction.commit()?;
            Ok(())
        }
        Err(error) => {
            transaction.execute(
                r#"
                UPDATE workspace_change_ref_cleanup
                SET error_code = 'workspace_change_ref_cleanup_failed',
                    attempt_count = attempt_count + 1, updated_at = ?2
                WHERE window_id = ?1
                "#,
                params![cleanup.window_id, now],
            )?;
            transaction.execute(
                r#"
                UPDATE workspace_change_window
                SET cleanup_error_code = 'workspace_change_ref_cleanup_failed'
                WHERE id = ?1
                "#,
                [&cleanup.window_id],
            )?;
            transaction.commit()?;
            Err(error)
        }
    }
}

pub fn retry_pending_ref_cleanup(database: &mut Database, data_dir: &Path) -> Result<usize> {
    let window_ids = {
        let mut statement = database.connection().prepare(
            "SELECT window_id FROM workspace_change_ref_cleanup ORDER BY updated_at, window_id",
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut completed = 0;
    for window_id in window_ids {
        if attempt_pending_ref_cleanup(database, data_dir, &window_id).is_ok() {
            completed += 1;
        }
    }
    Ok(completed)
}

fn empty_hooks_dir(data_dir: &Path) -> Result<PathBuf> {
    let path = data_dir.join("workspace-change-empty-hooks");
    fs::create_dir_all(&path)?;
    Ok(path)
}

fn git_output_until(
    identity: &RepositoryWorktreeIdentity,
    args: &[&str],
    stdin: Option<&[u8]>,
    deadline: Instant,
    stdout_limit: usize,
) -> Result<Output> {
    let mut command = Command::new(workspace_change_git_executable()?);
    sanitize_git_command(&mut command);
    command
        .current_dir(&identity.repository_root)
        .arg(format!("--git-dir={}", identity.worktree_git_dir))
        .arg(format!("--work-tree={}", identity.repository_root))
        .args(args);
    run_git_command(
        command,
        stdin,
        remaining_git_execution_time(deadline)?,
        stdout_limit,
    )
}

fn git_output_at_until(cwd: &Path, args: &[&str], deadline: Instant) -> Result<Output> {
    let mut command = Command::new(workspace_change_git_executable()?);
    sanitize_git_command(&mut command);
    command.current_dir(cwd).args(args);
    run_git_command(
        command,
        None,
        remaining_git_execution_time(deadline)?,
        GIT_STDOUT_MAX_BYTES,
    )
}

fn remaining_git_execution_time(deadline: Instant) -> Result<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining <= GIT_CLEANUP_RESERVE {
        bail!("workspace_change_capture_timeout");
    }
    Ok(remaining - GIT_CLEANUP_RESERVE)
}

fn ensure_capture_deadline(deadline: Instant) -> Result<()> {
    if Instant::now() >= deadline {
        bail!("workspace_change_capture_timeout");
    }
    Ok(())
}

fn run_git_command(
    command: Command,
    stdin: Option<&[u8]>,
    deadline: Duration,
    stdout_limit: usize,
) -> Result<Output> {
    if deadline.is_zero() {
        bail!("workspace_change_git_timeout");
    }
    let input = stdin.map(ToOwned::to_owned);
    let (sender, receiver) = std_mpsc::sync_channel(1);
    workspace_change_git_runtime().handle().spawn(async move {
        let mut command = tokio::process::Command::from(command);
        let result = run_bounded_command_with_input(
            &mut command,
            input.as_deref(),
            ProbeCommandLimits {
                deadline,
                stdout_bytes: stdout_limit,
                stderr_bytes: GIT_STDERR_MAX_BYTES,
                cleanup_timeout: GIT_CLEANUP_TIMEOUT,
            },
        )
        .await;
        let _ = sender.send(result);
    });
    let bounded = receiver
        .recv()
        .context("workspace_change_git_runner_unavailable")
        .and_then(|result| {
            result.map_err(|error| {
                if format!("{error:#}").contains("runtime_probe_timed_out") {
                    anyhow::anyhow!("workspace_change_git_timeout")
                } else {
                    error.context("workspace_change_git_execution_failed")
                }
            })
        })?;
    if bounded.stdout.truncated {
        bail!("workspace_change_git_output_limit");
    }
    if bounded.stderr.truncated {
        bail!("workspace_change_git_stderr_limit");
    }
    Ok(Output {
        status: bounded.status,
        stdout: bounded.stdout.bytes,
        stderr: bounded.stderr.bytes,
    })
}

fn workspace_change_git_runtime() -> &'static tokio::runtime::Runtime {
    WORKSPACE_CHANGE_GIT_RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("rovai-workspace-git")
            .enable_all()
            .build()
            .expect("Workspace Change Git runtime must start")
    })
}

fn workspace_change_git_executable() -> Result<&'static Path> {
    let executable = WORKSPACE_CHANGE_GIT_EXECUTABLE.get_or_init(|| {
        let names: &[&str] = if cfg!(windows) {
            &["git.exe", "git.cmd", "git.bat", "git.com", "git"]
        } else {
            &["git"]
        };
        std::env::var_os("PATH")
            .into_iter()
            .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
            .find(|candidate| candidate.is_file())
            .and_then(|candidate| fs::canonicalize(candidate).ok())
            .unwrap_or_default()
    });
    if executable.as_os_str().is_empty() {
        bail!("workspace_change_git_executable_unavailable");
    }
    Ok(executable)
}

fn sanitize_git_command(command: &mut Command) {
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_COMMON_DIR",
    ] {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars() {
        if key.starts_with("GIT_CONFIG_KEY_") || key.starts_with("GIT_CONFIG_VALUE_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
}

#[cfg(test)]
fn required_git_text_at(cwd: &Path, args: &[&str]) -> Result<String> {
    required_git_text_at_until(cwd, args, Instant::now() + CAPTURE_DEADLINE)
}

fn required_git_text_at_until(cwd: &Path, args: &[&str], deadline: Instant) -> Result<String> {
    let output = git_output_at_until(cwd, args, deadline)?;
    ensure_git_success(&output, "workspace_change_git_probe_failed")?;
    Ok(stdout_text(&output).trim().to_string())
}

fn canonical_git_path_until(
    cwd: &Path,
    args: &[&str],
    relative_to: Option<&Path>,
    deadline: Instant,
) -> Result<PathBuf> {
    let raw = PathBuf::from(required_git_text_at_until(cwd, args, deadline)?);
    fs::canonicalize(if raw.is_absolute() {
        raw
    } else {
        relative_to.unwrap_or(cwd).join(raw)
    })
    .map_err(Into::into)
}

fn ensure_git_success(output: &Output, code: &str) -> Result<()> {
    if output.status.success() {
        return Ok(());
    }
    bail!("{code}: {}", String::from_utf8_lossy(&output.stderr).trim())
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn path_string(path: &Path) -> Result<String> {
    path.to_str()
        .map(str::to_string)
        .context("workspace_change_path_not_utf8")
}

fn execution_root_label(root: &str) -> String {
    Path::new(root)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("workspace")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn coordinator_identity(root: &str, digest: &str) -> RepositoryWorktreeIdentity {
        RepositoryWorktreeIdentity {
            repository_root: format!("/repositories/{digest}"),
            worktree_git_dir: format!("/repositories/{digest}/.git"),
            git_common_dir: format!("/repositories/{digest}/.git"),
            object_format: "sha1".to_string(),
            object_database_dir: format!("/repositories/{digest}/.git/objects"),
            object_alternates_digest: None,
            identity_digest: digest.to_string(),
            canonical_execution_root: root.to_string(),
            execution_root_relative: String::new(),
        }
    }

    #[tokio::test]
    async fn coordinator_serializes_one_physical_root_without_blocking_another() {
        let coordinator = WorkspaceChangeCoordinator::default();
        let first = coordinator_identity("/workspaces/first", "identity-first");
        let same = first.clone();
        let second = coordinator_identity("/workspaces/second", "identity-second");
        let first_guard = coordinator.acquire(&first).await;

        assert!(
            tokio::time::timeout(Duration::from_millis(25), coordinator.acquire(&same))
                .await
                .is_err(),
            "the same physical workspace must serialize capture boundaries"
        );
        let second_guard =
            tokio::time::timeout(Duration::from_millis(100), coordinator.acquire(&second))
                .await
                .expect("an unrelated workspace must not wait for the first capture");

        drop(second_guard);
        drop(first_guard);
    }

    #[cfg(unix)]
    #[test]
    fn git_runner_enforces_execution_deadline_and_stdout_capacity() {
        let mut slow = Command::new("/bin/sh");
        slow.args(["-c", "sleep 2"]);
        let started = Instant::now();
        let timeout = run_git_command(slow, None, Duration::from_millis(50), 1024)
            .expect_err("a Git child must not outlive its execution deadline");
        assert_eq!(timeout.to_string(), "workspace_change_git_timeout");
        assert!(started.elapsed() < Duration::from_secs(1));

        let mut noisy = Command::new("/bin/sh");
        noisy.args(["-c", "head -c 4096 /dev/zero"]);
        let overflow = run_git_command(noisy, None, Duration::from_secs(1), 1024)
            .expect_err("Git stdout must be bounded while it is streamed");
        assert_eq!(overflow.to_string(), "workspace_change_git_output_limit");
    }

    #[test]
    fn synthetic_tree_captures_tracked_and_untracked_without_touching_index() {
        let root = std::env::temp_dir().join(format!("rovai-window-capture-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        run(&root, &["init", "-q"]);
        run(&root, &["config", "user.email", "test@example.com"]);
        run(&root, &["config", "user.name", "Test"]);
        fs::write(root.join("src/tracked.txt"), "before\n").unwrap();
        run(&root, &["add", "src/tracked.txt"]);
        run(&root, &["commit", "-qm", "base"]);
        fs::write(root.join("src/untracked.txt"), "new\n").unwrap();
        let index_before = fs::read(root.join(".git/index")).unwrap();
        let identity = discover_repository(&root).unwrap().unwrap();
        let baseline = stable_capture(&identity, &[]).unwrap();
        assert_eq!(baseline.manifest.entries.len(), 2);
        fs::write(root.join("src/tracked.txt"), "after\n").unwrap();
        fs::write(root.join("src/untracked.txt"), "newer\n").unwrap();
        let final_capture = stable_capture(&identity, &baseline.manifest.entries).unwrap();
        let patch = tree_diff(
            &identity,
            &baseline.tree_oid,
            &final_capture.tree_oid,
            Instant::now() + CAPTURE_DEADLINE,
        )
        .unwrap();
        let files = summarize_patch(&patch);
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|file| file.path == "src/tracked.txt"));
        assert!(files.iter().any(|file| file.path == "src/untracked.txt"));
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), index_before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn patch_summary_keeps_file_rows_unseparated_and_counted() {
        let files = summarize_patch(
            "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+next\n",
        );
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/a.ts");
        assert_eq!((files[0].additions, files[0].deletions), (2, 1));
    }

    #[test]
    fn ref_verification_rejects_a_commit_even_when_it_resolves_to_the_expected_tree() {
        let root = std::env::temp_dir().join(format!("rovai-window-ref-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        run(&root, &["init", "-q"]);
        run(&root, &["config", "user.email", "test@example.com"]);
        run(&root, &["config", "user.name", "Test"]);
        fs::write(root.join("tracked.txt"), "content\n").unwrap();
        run(&root, &["add", "tracked.txt"]);
        run(&root, &["commit", "-qm", "base"]);
        let identity = discover_repository(&root).unwrap().unwrap();
        let tree = required_git_text_at(&root, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let reference = "refs/rovai/w/test-ref/b";
        let data_dir = root.join("rovai-data");
        create_ref(&identity, &data_dir, reference, &tree).unwrap();
        verify_ref(&identity, &data_dir, reference, &tree).unwrap();

        run(&root, &["update-ref", reference, "HEAD"]);
        assert_eq!(
            verify_ref(&identity, &data_dir, reference, &tree)
                .unwrap_err()
                .to_string(),
            "workspace_change_ref_tampered"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_final_publication_releases_both_refs_and_final_manifest_root() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-window-final-failure-{}", Uuid::new_v4()));
        let repository = fixture.join("repository");
        let data_dir = fixture.join("data");
        fs::create_dir_all(&repository).unwrap();
        run(&repository, &["init", "-q"]);
        run(&repository, &["config", "user.email", "test@example.com"]);
        run(&repository, &["config", "user.name", "Test"]);
        fs::write(repository.join("tracked.txt"), "before\n").unwrap();
        run(&repository, &["add", "tracked.txt"]);
        run(&repository, &["commit", "-qm", "base"]);

        let identity = discover_repository(&repository).unwrap().unwrap();
        let baseline = stable_capture(&identity, &[]).unwrap();
        fs::write(repository.join("tracked.txt"), "after\n").unwrap();
        let final_capture = stable_capture(&identity, &baseline.manifest.entries).unwrap();
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data_dir);
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'camp-final-failure', 'Final failure', 'directory', ?1,
                    0, 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z'
                )
                "#,
                [identity.canonical_execution_root.as_str()],
            )
            .unwrap();
        let blob_store = ManagedBlobStore::new(&data_dir);
        let baseline_manifest = blob_store
            .put_bytes(
                &mut database,
                &serde_json::to_vec(&baseline.manifest).unwrap(),
                "application/vnd.rovai.workspace-capture+json",
                "sensitive",
            )
            .unwrap();
        let final_manifest = blob_store
            .put_bytes(
                &mut database,
                &serde_json::to_vec(&final_capture.manifest).unwrap(),
                "application/vnd.rovai.workspace-capture+json",
                "sensitive",
            )
            .unwrap();
        let ref_token = "failed-final-publication";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO workspace_change_window(
                    id, camp_id, canonical_execution_root,
                    repository_identity_digest, repository_root,
                    worktree_git_dir, git_common_dir, object_format,
                    object_database_dir, object_alternates_digest, ref_token,
                    lifecycle, capture_status, capture_profile_version,
                    baseline_oid, final_candidate_oid,
                    baseline_manifest_blob_id, final_manifest_blob_id,
                    baseline_capture_started_at, baseline_captured_at,
                    final_capture_started_at, created_at, updated_at
                ) VALUES (
                    'window-final-failure', 'camp-final-failure', ?1,
                    ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    'closing', 'baseline_ready', 1, ?10, ?11, ?12, ?13,
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:01Z',
                    '2026-08-27T00:00:02Z',
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:02Z'
                )
                "#,
                params![
                    identity.canonical_execution_root,
                    identity.identity_digest,
                    identity.repository_root,
                    identity.worktree_git_dir,
                    identity.git_common_dir,
                    identity.object_format,
                    identity.object_database_dir,
                    identity.object_alternates_digest,
                    ref_token,
                    baseline.tree_oid,
                    final_capture.tree_oid,
                    baseline_manifest.id,
                    final_manifest.id,
                ],
            )
            .unwrap();
        create_ref(
            &identity,
            &data_dir,
            &baseline_ref(ref_token),
            &baseline.tree_oid,
        )
        .unwrap();
        create_ref(
            &identity,
            &data_dir,
            &final_ref(ref_token),
            &final_capture.tree_oid,
        )
        .unwrap();
        let request = WindowCloseRequest {
            window_id: "window-final-failure".to_string(),
            ref_token: ref_token.to_string(),
            identity: identity.clone(),
            baseline_oid: baseline.tree_oid.clone(),
            baseline_manifest: baseline.manifest,
        };

        fail_close(
            &mut database,
            &data_dir,
            &request,
            "workspace_change_diff_size_limit",
        )
        .unwrap();

        for reference in [baseline_ref(ref_token), final_ref(ref_token)] {
            let output = Command::new("git")
                .current_dir(&repository)
                .args(["rev-parse", "--verify", &reference])
                .output()
                .unwrap();
            assert!(
                !output.status.success(),
                "failed publication must release {reference}"
            );
        }
        let state = database
            .connection()
            .query_row(
                r#"
                SELECT lifecycle, capture_status, final_candidate_oid,
                       final_manifest_blob_id, unavailable_reason_code
                FROM workspace_change_window
                WHERE id = 'window-final-failure'
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(state.0, "closed");
        assert_eq!(state.1, "unavailable");
        assert_eq!(
            state.2, None,
            "candidate OID must stop rooting cleanup state"
        );
        assert_eq!(
            state.3, None,
            "failed final manifest must stop rooting its managed blob"
        );
        assert_eq!(state.4, "workspace_change_diff_size_limit");

        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn failed_ref_cleanup_persists_expected_oid_and_retries_closed_window() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-window-cleanup-retry-{}", Uuid::new_v4()));
        let repository = fixture.join("repository");
        let data_dir = fixture.join("data");
        fs::create_dir_all(&repository).unwrap();
        run(&repository, &["init", "-q"]);
        run(&repository, &["config", "user.email", "test@example.com"]);
        run(&repository, &["config", "user.name", "Test"]);
        fs::write(repository.join("tracked.txt"), "before\n").unwrap();
        run(&repository, &["add", "tracked.txt"]);
        run(&repository, &["commit", "-qm", "base"]);

        let identity = discover_repository(&repository).unwrap().unwrap();
        let baseline = stable_capture(&identity, &[]).unwrap();
        fs::write(repository.join("tracked.txt"), "after\n").unwrap();
        let final_capture = stable_capture(&identity, &baseline.manifest.entries).unwrap();
        assert_ne!(baseline.tree_oid, final_capture.tree_oid);
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data_dir);
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'camp-cleanup-retry', 'Cleanup retry', 'directory', ?1,
                    0, 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z'
                )
                "#,
                [identity.canonical_execution_root.as_str()],
            )
            .unwrap();
        let ref_token = "cleanup-retry";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO workspace_change_window(
                    id, camp_id, canonical_execution_root,
                    repository_identity_digest, repository_root,
                    worktree_git_dir, git_common_dir, object_format,
                    object_database_dir, object_alternates_digest, ref_token,
                    lifecycle, capture_status, capture_profile_version,
                    baseline_oid, final_candidate_oid,
                    baseline_capture_started_at, baseline_captured_at,
                    final_capture_started_at, created_at, updated_at
                ) VALUES (
                    'window-cleanup-retry', 'camp-cleanup-retry', ?1,
                    ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    'closing', 'baseline_ready', 1, ?10, ?11,
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:01Z',
                    '2026-08-27T00:00:02Z',
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:02Z'
                )
                "#,
                params![
                    identity.canonical_execution_root,
                    identity.identity_digest,
                    identity.repository_root,
                    identity.worktree_git_dir,
                    identity.git_common_dir,
                    identity.object_format,
                    identity.object_database_dir,
                    identity.object_alternates_digest,
                    ref_token,
                    baseline.tree_oid,
                    final_capture.tree_oid,
                ],
            )
            .unwrap();
        let baseline_reference = baseline_ref(ref_token);
        let final_reference = final_ref(ref_token);
        create_ref(
            &identity,
            &data_dir,
            &baseline_reference,
            &baseline.tree_oid,
        )
        .unwrap();
        create_ref(
            &identity,
            &data_dir,
            &final_reference,
            &final_capture.tree_oid,
        )
        .unwrap();
        run(
            &repository,
            &[
                "update-ref",
                &final_reference,
                &baseline.tree_oid,
                &final_capture.tree_oid,
            ],
        );
        let request = WindowCloseRequest {
            window_id: "window-cleanup-retry".to_string(),
            ref_token: ref_token.to_string(),
            identity: identity.clone(),
            baseline_oid: baseline.tree_oid.clone(),
            baseline_manifest: baseline.manifest,
        };

        fail_close(
            &mut database,
            &data_dir,
            &request,
            "workspace_change_publication_failed",
        )
        .unwrap();

        let pending = database
            .connection()
            .query_row(
                r#"
                SELECT baseline_oid, final_oid, error_code, attempt_count
                FROM workspace_change_ref_cleanup
                WHERE window_id = 'window-cleanup-retry'
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(pending.0.as_deref(), Some(request.baseline_oid.as_str()));
        assert_eq!(pending.1.as_deref(), Some(final_capture.tree_oid.as_str()));
        assert_eq!(
            pending.2.as_deref(),
            Some("workspace_change_ref_cleanup_failed")
        );
        assert_eq!(pending.3, 1);
        let observed = required_git_text_at(&repository, &["rev-parse", &final_reference]).unwrap();
        assert_eq!(observed, request.baseline_oid);

        run(
            &repository,
            &[
                "update-ref",
                &final_reference,
                &final_capture.tree_oid,
                &request.baseline_oid,
            ],
        );
        assert_eq!(
            recover_interrupted_windows(&mut database, &data_dir).unwrap(),
            0,
            "startup recovery must retry cleanup even when every Window is closed"
        );
        let pending_count = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM workspace_change_ref_cleanup WHERE window_id = 'window-cleanup-retry'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(pending_count, 0);
        let cleanup_error = database
            .connection()
            .query_row(
                "SELECT cleanup_error_code FROM workspace_change_window WHERE id = 'window-cleanup-retry'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert_eq!(cleanup_error, None);
        let output = Command::new("git")
            .current_dir(&repository)
            .args(["rev-parse", "--verify", &final_reference])
            .output()
            .unwrap();
        assert!(!output.status.success());

        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn unproven_cancellation_releases_participant_and_closes_window_unavailable() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-window-cancel-fence-{}", Uuid::new_v4()));
        let repository = fixture.join("repository");
        let data_dir = fixture.join("data");
        fs::create_dir_all(&repository).unwrap();
        run(&repository, &["init", "-q"]);
        run(&repository, &["config", "user.email", "test@example.com"]);
        run(&repository, &["config", "user.name", "Test"]);
        fs::write(repository.join("tracked.txt"), "before\n").unwrap();
        run(&repository, &["add", "tracked.txt"]);
        run(&repository, &["commit", "-qm", "base"]);
        let identity = discover_repository(&repository).unwrap().unwrap();
        let baseline_oid =
            required_git_text_at(&repository, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data_dir);
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'camp-cancel-fence', 'Cancel fence', 'directory', ?1,
                    0, 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z'
                )
                "#,
                [identity.canonical_execution_root.as_str()],
            )
            .unwrap();
        let ref_token = "cancel-fence";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO workspace_change_window(
                    id, camp_id, canonical_execution_root,
                    repository_identity_digest, repository_root,
                    worktree_git_dir, git_common_dir, object_format,
                    object_database_dir, object_alternates_digest, ref_token,
                    lifecycle, capture_status, capture_profile_version,
                    baseline_oid, baseline_capture_started_at, baseline_captured_at,
                    created_at, updated_at
                ) VALUES (
                    'window-cancel-fence', 'camp-cancel-fence', ?1,
                    ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    'active', 'baseline_ready', 1, ?10,
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:01Z',
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:01Z'
                )
                "#,
                params![
                    identity.canonical_execution_root,
                    identity.identity_digest,
                    identity.repository_root,
                    identity.worktree_git_dir,
                    identity.git_common_dir,
                    identity.object_format,
                    identity.object_database_dir,
                    identity.object_alternates_digest,
                    ref_token,
                    baseline_oid,
                ],
            )
            .unwrap();
        database
            .connection()
            .pragma_update(None, "foreign_keys", "OFF")
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO workspace_change_window_participant(
                    window_id, agent_run_id, execution_epoch, joined_at
                ) VALUES (
                    'window-cancel-fence', 'cancelled-run', 7,
                    '2026-08-27T00:00:01Z'
                )
                "#,
                [],
            )
            .unwrap();
        database
            .connection()
            .pragma_update(None, "foreign_keys", "ON")
            .unwrap();
        create_ref(
            &identity,
            &data_dir,
            &baseline_ref(ref_token),
            &baseline_oid,
        )
        .unwrap();

        fail_window_participant_after_unproven_quiescence(
            &mut database,
            &data_dir,
            "cancelled-run",
            7,
            "workspace_change_cancellation_quiescence_unproven",
        )
        .unwrap();

        let released_at = database
            .connection()
            .query_row(
                r#"
                SELECT released_at
                FROM workspace_change_window_participant
                WHERE window_id = 'window-cancel-fence'
                  AND agent_run_id = 'cancelled-run'
                  AND execution_epoch = 7
                "#,
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert!(
            released_at.is_some(),
            "cancelled participant must be released"
        );
        let state = database
            .connection()
            .query_row(
                r#"
                SELECT lifecycle, capture_status, unavailable_reason_code
                FROM workspace_change_window
                WHERE id = 'window-cancel-fence'
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(state.0, "closed");
        assert_eq!(state.1, "unavailable");
        assert_eq!(state.2, "workspace_change_cancellation_quiescence_unproven");

        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn completed_cards_and_diff_read_from_immutable_evidence() {
        let root = std::env::temp_dir().join(format!("rovai-window-evidence-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&root);
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'camp-window', 'Window evidence', 'directory', '/tmp/window-evidence',
                    0, 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z'
                );
                INSERT INTO workspace_change_window(
                    id, camp_id, canonical_execution_root,
                    repository_identity_digest, repository_root,
                    worktree_git_dir, git_common_dir, object_format,
                    object_database_dir, ref_token, lifecycle, capture_status,
                    capture_profile_version, baseline_oid, final_oid,
                    baseline_capture_started_at, baseline_captured_at,
                    final_capture_started_at, final_captured_at,
                    files_json, file_count, additions, deletions,
                    created_at, updated_at
                ) VALUES (
                    'window-1', 'camp-window', '/tmp/window-evidence',
                    'sha256:identity', '/tmp/window-evidence',
                    '/tmp/window-evidence/.git', '/tmp/window-evidence/.git', 'sha1',
                    '/tmp/window-evidence/.git/objects', 'token-window-1',
                    'closed', 'complete', 1,
                    '1111111111111111111111111111111111111111',
                    '2222222222222222222222222222222222222222',
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:01Z',
                    '2026-08-27T00:00:02Z', '2026-08-27T00:00:03Z',
                    '[]', 0, 0, 0,
                    '2026-08-27T00:00:00Z', '2026-08-27T00:00:03Z'
                );
                "#,
            )
            .unwrap();
        let blob_store = ManagedBlobStore::new(&root);
        let patch = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
        let blob = blob_store
            .put_bytes(&mut database, patch.as_bytes(), "text/x-diff", "sensitive")
            .unwrap();
        let files = serde_json::to_string(&vec![WorkspaceChangedFileView {
            path: "src/a.ts".to_string(),
            change_kind: "update".to_string(),
            additions: 1,
            deletions: 1,
        }])
        .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO workspace_change_completed_evidence(
                    id, window_id, camp_id, canonical_execution_root,
                    participant_runs_json, files_json, file_count,
                    additions, deletions, diff_blob_id, baseline_oid,
                    final_oid, captured_at, created_at
                ) VALUES (
                    'evidence-1', 'window-1', 'camp-window', '/tmp/window-evidence',
                    '[]', ?1, 1, 1, 1, ?2,
                    '1111111111111111111111111111111111111111',
                    '2222222222222222222222222222222222222222',
                    '2026-08-27T00:00:03Z', '2026-08-27T00:00:03Z'
                )
                "#,
                params![files, blob.id],
            )
            .unwrap();

        database
            .connection()
            .execute(
                "UPDATE workspace_change_window SET files_json = '[]', file_count = 0, additions = 0, deletions = 0, diff_blob_id = NULL WHERE id = 'window-1'",
                [],
            )
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        let cards = list_completed_windows(&transaction, "camp-window").unwrap();
        transaction.commit().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].files[0].path, "src/a.ts");
        let review = read_window_diff(&database, &blob_store, "camp-window", "window-1").unwrap();
        assert_eq!(review.diff, patch);
        assert!(read_window_diff(&database, &blob_store, "another-camp", "window-1").is_err());

        drop(database);
        fs::remove_dir_all(root).unwrap();
    }
}
