use std::{collections::BTreeMap, fmt, sync::RwLock};

use anyhow::Result;
use rovai_core::agent_profile::AdapterKind;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubsystemSnapshot {
    pub id: String,
    pub state: &'static str,
    pub error: Option<Value>,
}

#[derive(Debug)]
pub(crate) struct SubsystemUnavailable {
    pub id: String,
    pub state: &'static str,
}

impl fmt::Display for SubsystemUnavailable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} is {}; retry this subsystem when available",
            self.id, self.state
        )
    }
}

impl std::error::Error for SubsystemUnavailable {}

/// Process-local feature gates, never database admission or substitute authority.
pub(crate) struct CoreSubsystems(RwLock<BTreeMap<String, SubsystemSnapshot>>);

#[derive(Default)]
pub(crate) struct SubsystemInitialization {
    // Retain exact already-retired targets across a failed filesystem cleanup.
    // Retrying must neither rescan new Camps nor lose the failed directory IDs.
    retired_camp_directories: Vec<String>,
}

impl CoreSubsystems {
    pub fn new() -> Self {
        let ids = [
            "skills",
            "mcp",
            "attachments",
            "maintenance",
            "builtin-tools",
        ]
        .into_iter()
        .map(str::to_owned)
        .chain(AdapterKind::ALL.into_iter().map(runtime_subsystem_id));
        Self(RwLock::new(
            ids.map(|id| {
                let entry = SubsystemSnapshot {
                    id: id.clone(),
                    state: "initializing",
                    error: None,
                };
                (id, entry)
            })
            .collect(),
        ))
    }

    pub fn snapshot(&self) -> Vec<SubsystemSnapshot> {
        self.0
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .cloned()
            .collect()
    }

    pub fn require(&self, id: &str) -> Result<()> {
        let entries = self.0.read().unwrap_or_else(|error| error.into_inner());
        let state = entries.get(id).map_or("unavailable", |entry| entry.state);
        if state != "ready" {
            return Err(SubsystemUnavailable {
                id: id.to_owned(),
                state,
            }
            .into());
        }
        Ok(())
    }

    /// Retry only failed/uninitialized features, never rerun cleanup against a
    /// healthy, possibly active Runtime or replace a live IPC listener.
    pub fn begin(&self, id: &str) -> bool {
        let mut entries = self.0.write().unwrap_or_else(|error| error.into_inner());
        let entry = entries.get_mut(id).expect("registered Core subsystem");
        if entry.state == "ready" {
            return false;
        }
        entry.state = "initializing";
        entry.error = None;
        true
    }

    pub fn finish(&self, id: &str, result: Result<()>) {
        let mut entries = self.0.write().unwrap_or_else(|error| error.into_inner());
        let entry = entries.get_mut(id).expect("registered Core subsystem");
        match result {
            Ok(()) => {
                entry.state = "ready";
                entry.error = None;
            }
            Err(error) => {
                eprintln!("Core subsystem {id} degraded: {error:#}");
                entry.state = "degraded";
                entry.error = Some(json!({
                    "code": "subsystem_initialization_failed",
                    "message": format!("{error:#}"),
                    "retryable": true,
                    "details": { "subsystem": id }
                }));
            }
        }
    }

    #[cfg(all(test, target_os = "macos", feature = "slow-tests"))]
    pub fn ready_for_test() -> Self {
        let states = Self::new();
        for entry in states.snapshot() {
            states.finish(&entry.id, Ok(()));
        }
        states
    }
}

pub(crate) fn runtime_subsystem_id(kind: AdapterKind) -> String {
    format!("runtime.{}", kind.as_str())
}

impl super::Core {
    pub(crate) fn mcp_config(&self) -> Result<&super::McpConfigStore> {
        self.mcp_config
            .as_ref()
            .map_err(|error| anyhow::anyhow!("{error:#}"))
    }

    pub(crate) fn require_execution_subsystems(&self, kind: AdapterKind) -> Result<()> {
        for id in ["skills", "mcp", "attachments", "builtin-tools"] {
            self.subsystems.require(id)?;
        }
        self.subsystems.require(&runtime_subsystem_id(kind))
    }

    fn publish_subsystems(&self) {
        super::emit(
            &self.output,
            "runtime.subsystemsChanged",
            json!(self.subsystems.snapshot()),
        );
    }

    pub(crate) fn finish_subsystem(&self, id: &str, result: Result<()>) {
        self.subsystems.finish(id, result);
        self.publish_subsystems();
    }

    /// Runs after ready and is also the explicit in-process retry path. Gates
    /// close before any work; successful live services are not initialized twice.
    pub(crate) async fn initialize_optional_subsystems(&self) {
        use super::*;

        let mut initialization = self.subsystem_initialization.lock().await;
        if self.planned_shutdown.shutdown_started() {
            return;
        }

        if self.subsystems.begin("builtin-tools") {
            match LocalIpcListener::bind(&builtin_tool_endpoint()) {
                Ok(listener) => {
                    let mut slot = self.builtin_tool_listener.lock().await;
                    *slot = Some(listener);
                    // Publish ready before the acceptor can take the listener.
                    // Otherwise an immediate fatal accept could publish degraded
                    // and then have that failure overwritten by this initializer.
                    self.finish_subsystem("builtin-tools", Ok(()));
                    drop(slot);
                    self.builtin_tool_listener_notify.notify_one();
                }
                Err(error) => self.finish_subsystem("builtin-tools", Err(error)),
            }
        }

        for kind in AdapterKind::ALL {
            if self.planned_shutdown.shutdown_started() {
                return;
            }
            let id = runtime_subsystem_id(kind);
            if !self.subsystems.begin(&id) {
                continue;
            }
            let result = match kind {
                AdapterKind::CodexCli => Ok(()),
                AdapterKind::ClaudeCodeCli => self.claude_code_cli.initialize_storage(),
                AdapterKind::AntigravityApp => self.antigravity_app.initialize_storage(),
                kind => self
                    .acp_adapter(kind)
                    .context("missing ACP adapter")
                    .and_then(|adapter| adapter.initialize_storage()),
            };
            self.finish_subsystem(&id, result);
            tokio::task::yield_now().await;
        }

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("attachments") {
            let result = {
                let mut database = self.database.lock().await;
                (|| -> Result<_> {
                    ManagedAttachmentStore::for_database(&database).reconcile(&mut database)?;
                    self.attachment_views
                        .reconcile(&mut database, &CampAttachmentStore::new(&self.data_dir))?;
                    unresolved_publication_camp_ids(&database)
                })()
            };
            let result = result.map(|camps| {
                for camp_id in camps {
                    self.request_camp_attachment_projection(&camp_id);
                }
            });
            self.finish_subsystem("attachments", result);
        }
        tokio::task::yield_now().await;

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("mcp") {
            let result = {
                let database = self.database.lock().await;
                (|| -> Result<()> {
                    let config = self.mcp_config()?;
                    config.migrate_pre_release_config()?;
                    config.migrate_agent_ids(&database.agent_id_aliases()?)?;
                    Ok(())
                })()
            };
            self.finish_subsystem("mcp", result);
        }
        tokio::task::yield_now().await;

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("skills") {
            let result = {
                let mut database = self.database.lock().await;
                (|| -> Result<()> {
                    self.skill_library.initialize_storage()?;
                    SkillProjectionReconciler.synchronize_removed_execution_roots(
                        &mut database,
                        &parse_removed_skill_project_roots()?,
                    )?;
                    let started = Instant::now();
                    let bundled = self.skill_library.install_bundled_skills(&mut database)?;
                    eprintln!(
                        "[startup] stage=bundled_skills_ready duration_ms={} fast_path_count={} materialized_count={} repaired_count={} changed={}",
                        started.elapsed().as_millis(),
                        bundled.fast_path_count,
                        bundled.materialized_count,
                        bundled.repaired_count,
                        bundled.changed,
                    );
                    if bundled.changed {
                        SkillProjectionReconciler
                            .mark_observed_roots_dirty(&mut database, false)?;
                    }
                    for root in &self.startup_skill_execution_roots {
                        SkillProjectionReconciler.reconcile_after_run_terminal(
                            &mut database,
                            &self.skill_library,
                            Path::new(root),
                        )?;
                    }
                    Ok(())
                })()
            };
            self.finish_subsystem("skills", result);
        }
        tokio::task::yield_now().await;

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("maintenance") {
            let search_summary = self.runtime_search_environment.read().await.summary();
            let mut database = self.database.lock().await;
            let mut errors = Vec::new();
            macro_rules! maintain {
                ($stage:literal, $result:expr) => {
                    if let Err(error) = $result {
                        errors.push(format!("{}: {error:#}", $stage));
                    }
                };
            }
            let attachments = CampAttachmentStore::new(&self.data_dir);
            maintain!(
                "attachment_cleanup",
                attachments.cleanup_expired(&mut database)
            );
            maintain!(
                "pending_camp_cleanup",
                (|| -> Result<()> {
                    let camps = CollaborationService::default()
                        .discard_empty_pending_camps_on_startup(
                            &mut database,
                            &self.startup_pending_camp_ids,
                        )?;
                    initialization.retired_camp_directories.extend(camps);
                    Ok(())
                })()
            );
            initialization.retired_camp_directories.retain(|camp| {
                match attachments.remove_camp(camp) {
                    Ok(()) => false,
                    Err(error) => {
                        errors.push(format!("pending_camp_directory: {error:#}"));
                        true
                    }
                }
            });
            maintain!(
                "runtime_search_generation",
                database.record_runtime_search_environment_generation(
                    search_summary.generation,
                    &search_summary.created_at
                )
            );
            if self.subsystems.require("skills").is_ok() {
                maintain!(
                    "skill_staging_cleanup",
                    self.skill_library.cleanup_expired_staging()
                );
                maintain!(
                    "skill_revision_cleanup",
                    self.skill_library.cleanup_orphan_revisions(&database)
                );
            }
            maintain!(
                "mcp_projection_cleanup",
                self.mcp_projection.cleanup_terminal_and_orphaned(&database)
            );
            maintain!(
                "file_change_projection",
                AgentRunFileChangeProjector
                    .recover_terminal_runs(&mut database, &ManagedBlobStore::new(&self.data_dir))
            );
            drop(database);
            self.finish_subsystem(
                "maintenance",
                if errors.is_empty() {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!(errors.join("; ")))
                },
            );
        }
    }
}
