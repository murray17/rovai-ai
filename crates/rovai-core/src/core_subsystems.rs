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

    #[cfg(all(test, feature = "slow-tests", any(target_os = "macos", windows)))]
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

fn shared_execution_subsystem_ids(_kind: AdapterKind) -> &'static [&'static str] {
    &["skills", "builtin-tools"]
}

impl super::Core {
    pub(crate) fn mcp_config(&self) -> Result<&super::McpConfigStore> {
        self.mcp_config
            .as_ref()
            .map_err(|error| anyhow::anyhow!("{error:#}"))
    }

    pub(crate) fn require_execution_subsystems(&self, kind: AdapterKind) -> Result<()> {
        for id in shared_execution_subsystem_ids(kind) {
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
        self.execution_wake.runs.notify_one();
    }

    /// Runs after ready and is also the explicit in-process retry path. Gates
    /// close before any work; successful live services are not initialized twice.
    pub(crate) async fn initialize_optional_subsystems(&self) {
        use super::*;

        let _initialization = self.subsystem_initialization.lock().await;
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
                AdapterKind::Pi => self.pi.initialize_storage(),
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
            // Historical derived views are rebuilt by the individual operation.
            // New source references have no global view-reconciliation prerequisite.
            self.finish_subsystem("attachments", Ok(()));
        }
        tokio::task::yield_now().await;

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("mcp") {
            let aliases = self.database.lock().await.agent_id_aliases();
            let config = self.mcp_config().cloned();
            let result = tokio::task::spawn_blocking(move || -> Result<()> {
                let config = config?;
                let aliases = aliases?;
                config.migrate_pre_release_config()?;
                config.migrate_agent_ids(&aliases)?;
                Ok(())
            })
            .await
            .context("MCP initialization task failed")
            .and_then(|result| result);
            self.finish_subsystem("mcp", result);
        }
        tokio::task::yield_now().await;

        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if self.subsystems.begin("skills") {
            let result = async {
                let started = Instant::now();
                match rovai_core::managed_skills::ManagedSkills::for_data_dir(&self.data_dir) {
                    Ok(managed) => {
                        if let Err(error) = tokio::task::spawn_blocking(move || managed.sync())
                            .await
                            .context("managed Skill synchronization task failed")?
                        {
                            // A missing or modified resource is a diagnostic, not a
                            // Runtime admission gate. New Run preparation retries.
                            eprintln!("managed Skill synchronization unavailable: {error:#}");
                        }
                    }
                    Err(error) => eprintln!("managed Skill resources unavailable: {error:#}"),
                }
                let mut database = self.database.lock().await;
                // Project access is owned by Navigation. A previous startup
                // cleanup marked observed projects removed, so synchronize the
                // persisted access state without touching project files.
                SkillProjectionReconciler.synchronize_removed_execution_roots(
                    &mut database,
                    self.removed_skill_project_roots.get()?,
                )?;
                eprintln!(
                    "[startup] stage=managed_skills_ready duration_ms={}",
                    started.elapsed().as_millis()
                );
                Ok(())
            }
            .await;
            self.finish_subsystem("skills", result);
        }
        // Historical cleanup is started once by run_core, independently of
        // feature initialization/retry. Unknown old attachment and Skill trees
        // are retained: directory age alone cannot prove exclusive ownership.
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    #[test]
    fn ordinary_dispatch_does_not_depend_on_external_mcp() {
        for kind in AdapterKind::ALL {
            assert!(!shared_execution_subsystem_ids(kind).contains(&"mcp"));
            assert!(shared_execution_subsystem_ids(kind).contains(&"builtin-tools"));
        }
    }

    #[test]
    fn private_storage_failure_is_isolated_from_core_and_peer_runtimes() {
        for kind in [AdapterKind::Pi, AdapterKind::GrokBuild] {
            let subsystems = CoreSubsystems::new();
            for entry in subsystems.snapshot() {
                subsystems.finish(&entry.id, Ok(()));
            }
            let id = runtime_subsystem_id(kind);
            // A healthy adapter may own reused Hosts; retry must not run cleanup.
            assert!(!subsystems.begin(&id));
            subsystems.finish(
                &id,
                Err(anyhow::anyhow!("private storage cleanup unavailable")),
            );

            assert!(subsystems.require("skills").is_ok());
            assert!(subsystems.require("mcp").is_ok());
            assert!(
                subsystems
                    .require(&runtime_subsystem_id(AdapterKind::ClaudeCodeCli))
                    .is_ok()
            );
            assert!(subsystems.require(&id).is_err());
            assert!(subsystems.begin(&id));
            subsystems.finish(&id, Ok(()));
            assert!(subsystems.require(&id).is_ok());
            assert!(!subsystems.begin(&id));
        }
    }
}
