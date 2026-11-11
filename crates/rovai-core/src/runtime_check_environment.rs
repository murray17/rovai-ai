//! Fresh discovery inputs are separate from publishing the active search snapshot.
use crate::application::{
    AdapterKind, Core, RuntimeCheckState, RuntimeDiscoveryObservation, RuntimeDiscoveryStatus,
    RuntimeExecutableCandidate, RuntimeSearchEnvironment, RuntimeVersionReadAttempt,
};
use crate::runtime_discovery::RuntimeVersionTarget;
use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::{MutexGuard, RwLock};

pub(super) const AUTOMATIC_VERSION_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(10 * 60);

impl RuntimeCheckState {
    pub(super) fn automatic_version_is_due(&self, target: &RuntimeVersionTarget) -> bool {
        self.automatic_version_is_due_at(target, tokio::time::Instant::now())
    }

    pub(super) fn automatic_version_is_due_at(
        &self,
        target: &RuntimeVersionTarget,
        now: tokio::time::Instant,
    ) -> bool {
        self.version_reads
            .get(target)
            .and_then(|read| read.attempted_at)
            .is_none_or(|at| now.saturating_duration_since(at) >= AUTOMATIC_VERSION_INTERVAL)
    }

    /// Called under the existing installation commit guard, together with the
    /// version write and Fleet mark. Starting a later read alone is not success.
    pub(super) fn accept_version_read(&mut self, attempt: &RuntimeVersionReadAttempt) -> bool {
        let Some(read) = self.version_reads.get_mut(&attempt.target) else {
            return false;
        };
        if attempt.sequence < read.accepted {
            return false;
        }
        read.accepted = attempt.sequence;
        true
    }

    pub(super) fn rebind_version_read(
        &mut self,
        attempt: &mut RuntimeVersionReadAttempt,
        installation_id: &str,
    ) {
        if attempt.target.installation_id == installation_id {
            return;
        }
        let Some(previous) = self.version_reads.remove(&attempt.target) else {
            return;
        };
        attempt.target.installation_id = installation_id.to_owned();
        let current = self
            .version_reads
            .entry(attempt.target.clone())
            .or_default();
        current.next = current.next.max(previous.next);
        current.accepted = current.accepted.max(previous.accepted);
        current.attempted_at = current.attempted_at.max(previous.attempted_at);
        current.read_by_runs.extend(previous.read_by_runs);
    }
}

pub(super) async fn version_target(
    kind: AdapterKind,
    installation_id: &str,
    path: &str,
    search: &RuntimeSearchEnvironment,
    environment: Option<crate::member_environment::LaunchEnvironment>,
) -> Result<RuntimeVersionTarget> {
    crate::runtime_discovery::with_runtime_configuration(
        kind,
        search,
        crate::runtime_discovery::with_launch_environment(environment, async {
            // Capture the existing command environment without launching it.
            let mut command = tokio::process::Command::new(path);
            crate::runtime_discovery::configure_runtime_command(kind, &mut command);
            let mut values = crate::runtime_discovery::capture_host_runtime_environment();
            for (name, value) in command.as_std().get_envs() {
                let name = name
                    .to_str()
                    .context("Runtime version environment name is not UTF-8")?;
                if cfg!(windows) {
                    values.retain(|key, _| !key.eq_ignore_ascii_case(name));
                }
                match value {
                    Some(value) => {
                        values.insert(
                            name.to_owned(),
                            value
                                .to_str()
                                .context("Runtime version environment value is not UTF-8")?
                                .to_owned(),
                        );
                    }
                    None => {
                        values.remove(name);
                    }
                }
            }
            RuntimeVersionTarget::new(kind, installation_id, path, &values)
        }),
    )
    .await
}

pub(super) async fn begin_version_read(
    state: &RwLock<RuntimeCheckState>,
    fleet: &crate::runtime_fleet::AgentRuntimeFleetManager,
    target: RuntimeVersionTarget,
    run_id: Option<&str>,
) -> Result<RuntimeVersionReadAttempt> {
    let sequence = {
        let mut state = state.write().await;
        let read = state.version_reads.entry(target.clone()).or_default();
        read.next = read
            .next
            .checked_add(1)
            .context("Runtime version read sequence exhausted")?;
        read.attempted_at = Some(tokio::time::Instant::now());
        if let Some(run_id) = run_id {
            read.read_by_runs.insert(run_id.to_owned());
        }
        read.next
    };
    let baselines = fleet.version_baselines(&target).await;
    Ok(RuntimeVersionReadAttempt {
        target,
        sequence,
        baselines,
        publish_failure: true,
    })
}

#[cfg(all(test, feature = "slow-tests", any(target_os = "macos", windows)))]
#[path = "runtime_check_refresh_tests.rs"]
mod tests;

pub(crate) fn candidate_observation(
    kind: AdapterKind,
    search: &RuntimeSearchEnvironment,
    candidate: &RuntimeExecutableCandidate,
    canonical: &std::path::Path,
    fingerprint: &str,
) -> RuntimeDiscoveryObservation {
    RuntimeDiscoveryObservation {
        runtime_kind: kind,
        discovery_status: RuntimeDiscoveryStatus::Found,
        executable_path: Some(canonical.to_string_lossy().to_string()),
        source: Some(candidate.source),
        reported_version: None,
        executable_fingerprint: Some(fingerprint.to_string()),
        search_path_source: candidate.search_path_source,
        entrypoint_kind: Some(candidate.entrypoint_kind),
        candidate_extension: Some(candidate.candidate_extension),
        resolved_native_target: candidate.resolved_native_target,
        version_probe_succeeded: None,
        search_generation: search.generation(),
        observed_at: chrono::Utc::now().to_rfc3339(),
        diagnostic_code: None,
        entrypoint_locator_identity: candidate.entrypoint_locator_identity.clone(),
    }
}

#[cfg(test)]
pub(crate) type TestSearchCapture = Arc<dyn Fn(u64) -> RuntimeSearchEnvironment + Send + Sync>;

impl Core {
    pub(super) async fn clear_run_version_read(&self, run_id: &str) {
        for read in self
            .runtime_check_activity
            .write()
            .await
            .version_reads
            .values_mut()
        {
            read.read_by_runs.remove(run_id);
        }
    }
    /// Bookkeeping around an existing formal-launch read, never a new preflight.
    /// Cached versions bypass this function entirely.
    pub(super) async fn observe_launch_version<F>(
        &self,
        runtime: &crate::agent_profile::FrozenAgentRuntimeConfig,
        search: &RuntimeSearchEnvironment,
        run_id: Option<&str>,
        read: F,
    ) -> Result<String>
    where
        F: std::future::Future<Output = Result<String>>,
    {
        let attempt = async {
            let target = version_target(
                runtime.adapter_kind,
                &runtime.installation_id,
                &runtime.executable_path,
                search,
                runtime.environment.clone(),
            )
            .await?;
            begin_version_read(
                &self.runtime_check_activity,
                &self.runtime_fleet,
                target,
                run_id,
            )
            .await
        }
        .await;
        let result = crate::runtime_discovery::with_runtime_configuration(
            runtime.adapter_kind,
            search,
            crate::runtime_discovery::with_launch_environment(runtime.environment.clone(), read),
        )
        .await;
        let attempt = match attempt {
            Ok(attempt) => attempt,
            Err(error) => {
                eprintln!("failed to track Runtime launch version: {error:#}");
                return result;
            }
        };
        {
            let path = std::path::PathBuf::from(&runtime.executable_path);
            let expected = runtime.executable_fingerprint.clone();
            let stable = tokio::task::spawn_blocking(move || {
                crate::agent_runtime_adapter::executable_fingerprint(&path)
                    .ok()
                    .as_deref()
                    == Some(expected.as_str())
            })
            .await
            .unwrap_or(false);
            if stable && let Some(_update) = self.runtime_check_update_guard(search).await {
                let saved = {
                    let mut database = self.database.lock().await;
                    let service = crate::agent_profile::AgentProfileService::default();
                    let mut state = self.runtime_check_activity.write().await;
                    (|| -> Result<bool> {
                        let current = service.recorded_executable_identity(
                            &database,
                            &runtime.installation_id,
                            &runtime.executable_path,
                        )?;
                        if !current.is_some_and(|(fingerprint, _)| {
                            fingerprint == runtime.executable_fingerprint
                        }) || !state.accept_version_read(&attempt)
                        {
                            return Ok(false);
                        }
                        // A completed failed read also supersedes older results,
                        // without changing the launch result or display version.
                        let Ok(version) = &result else {
                            return Ok(false);
                        };
                        service.record_runtime_version(
                            &mut database,
                            &runtime.installation_id,
                            &runtime.executable_path,
                            &runtime.executable_fingerprint,
                            version,
                        )
                    })()
                };
                if let Err(error) = &saved {
                    eprintln!("failed to persist Runtime launch version: {error:#}");
                }
                if saved.unwrap_or(false)
                    && let Ok(version) = &result
                {
                    self.runtime_fleet
                        .retire_changed_versions(&attempt.target, &attempt.baselines, version)
                        .await;
                    let observation = self
                        .runtime_discovery
                        .read()
                        .await
                        .get(&runtime.adapter_kind)
                        .cloned();
                    if let Some(mut observation) = observation
                        && observation.executable_path.as_deref()
                            == Some(runtime.executable_path.as_str())
                        && observation.executable_fingerprint.as_deref()
                            == Some(runtime.executable_fingerprint.as_str())
                    {
                        observation.reported_version = Some(version.clone());
                        observation.version_probe_succeeded = Some(true);
                        observation.diagnostic_code = None;
                        self.publish_verified_runtime_discovery(observation).await;
                    }
                }
            }
        }
        result
    }

    /// A Run never awaits admission or the version command. Recent attempts are
    /// checked without waiting for a lock; queued/in-flight work remains owned
    /// and merged by the existing Check Manager.
    pub(super) fn enqueue_automatic_version_refresh(
        &self,
        runtime: &crate::agent_profile::FrozenAgentRuntimeConfig,
        run_id: &str,
    ) {
        let Some(target) = RuntimeVersionTarget::for_launch(runtime) else {
            return;
        };
        let Ok(mut state) = self.runtime_check_activity.try_write() else {
            return;
        };
        let mut read_in_this_run = false;
        for (scope, read) in &mut state.version_reads {
            let consumed = read.read_by_runs.remove(run_id);
            read_in_this_run |= consumed
                && scope.installation_id == target.installation_id
                && scope.executable_path == target.executable_path;
        }
        if read_in_this_run {
            return;
        }
        if !state.automatic_version_is_due(&target) {
            return;
        }
        drop(state);
        let Ok(search) = self.runtime_search_environment.try_read() else {
            return;
        };
        let (acknowledged, _) = tokio::sync::oneshot::channel();
        let request = super::RuntimeCheckRequest {
            force_refresh: false,
            search: search.clone(),
            startup_preview: None,
            version_refresh: Some(Arc::new(runtime.clone())),
            version_target: Some(target),
            model_target: None,
            runtime_kind: runtime.adapter_kind,
            purpose: crate::runtime_discovery::RuntimeLaunchPurpose::DiscoveryVersion,
            trigger: super::RuntimeCheckTrigger::UserCheck,
            acknowledged,
            completion: None,
        };
        if self.runtime_check_requests.send(request.into()).is_err() {
            eprintln!("Runtime automatic version refresh manager is unavailable");
        }
    }

    pub(super) async fn refresh_runtime_version_for_launch(
        &self,
        runtime: &crate::agent_profile::FrozenAgentRuntimeConfig,
        search: Arc<RuntimeSearchEnvironment>,
    ) -> Result<Option<super::RuntimeVersionReadResult>> {
        let kind = runtime.adapter_kind;
        let (installation, locator, identity) = {
            let database = self.database.lock().await;
            let service = crate::agent_profile::AgentProfileService::default();
            let installation = service
                .managed_installation(&database, kind, &runtime.auth_scope)?
                .context("Runtime installation is unavailable")?;
            anyhow::ensure!(
                installation.id == runtime.installation_id
                    && installation.executable_path == runtime.executable_path,
                "Runtime installation changed before automatic version read"
            );
            let locator =
                service.runtime_entrypoint_locator_identity(&database, &installation.id)?;
            let identity = service.recorded_executable_identity(
                &database,
                &installation.id,
                &installation.executable_path,
            )?;
            (installation, locator, identity)
        };
        let path = runtime.executable_path.clone();
        let source = installation.source;
        let verified = tokio::task::spawn_blocking(move || {
            crate::agent_profile::VerifiedDiscoveredRuntimeEntry::discover(
                kind,
                path,
                source,
                locator,
                identity
                    .as_ref()
                    .map(|(fingerprint, identity)| (fingerprint.as_str(), identity)),
            )
        })
        .await??;
        let target = version_target(
            kind,
            &runtime.installation_id,
            &runtime.executable_path,
            &search,
            runtime.environment.clone(),
        )
        .await?;
        // A pending request can become fresh while waiting behind existing work.
        if !self
            .runtime_check_activity
            .read()
            .await
            .automatic_version_is_due(&target)
        {
            return Ok(None);
        }
        let attempt = begin_version_read(
            &self.runtime_check_activity,
            &self.runtime_fleet,
            target,
            None,
        )
        .await?;
        let mut observation = self
            .runtime_discovery
            .read()
            .await
            .get(&kind)
            .filter(|observation| {
                observation.executable_path.as_deref() == Some(runtime.executable_path.as_str())
            })
            .cloned()
            .unwrap_or_else(|| RuntimeDiscoveryObservation::detecting(kind, search.generation()));
        observation.search_generation = search.generation();
        observation.observed_at = chrono::Utc::now().to_rfc3339();
        observation.reported_version = None;
        observation.version_probe_succeeded = None;
        observation.diagnostic_code = None;
        observation.discovery_status = RuntimeDiscoveryStatus::Found;
        observation.executable_path = Some(verified.entry().executable_path.clone());
        observation.executable_fingerprint = Some(verified.entry().executable_fingerprint.clone());
        observation.entrypoint_locator_identity =
            verified.entry().entrypoint_locator_identity.clone();
        observation.source = Some(source);
        crate::runtime_discovery::with_launch_environment(
            runtime.environment.clone(),
            crate::runtime_discovery::discover_runtime_version(&mut observation, &search),
        )
        .await;
        let verified = tokio::task::spawn_blocking(move || {
            anyhow::ensure!(
                verified.is_current(),
                "runtime_entry_changed_during_version_read"
            );
            Ok::<_, anyhow::Error>(verified)
        })
        .await??;
        Ok(Some(super::RuntimeVersionReadResult {
            observation,
            verified,
            expected: Some((installation.id, installation.version)),
            attempt,
        }))
    }

    /// No activation, database writes, discovery events or probes. Drafts use only this half.
    pub(crate) async fn read_runtime_check_environment(&self) -> Result<RuntimeSearchEnvironment> {
        let generation = self
            .runtime_search_environment
            .read()
            .await
            .generation()
            .checked_add(1)
            .context("Runtime search generation exhausted")?;
        #[cfg(test)]
        let capture = self.runtime_search_capture.clone();
        tokio::task::spawn_blocking(move || {
            #[cfg(test)]
            if let Some(capture) = capture {
                return capture(generation);
            }
            RuntimeSearchEnvironment::rescan(generation)
        })
        .await
        .context("Runtime Search Environment worker failed")
    }

    pub(crate) async fn refresh_runtime_check_environment(
        &self,
    ) -> Result<Arc<RuntimeSearchEnvironment>> {
        // A stalled shell reader must not hold the local configuration commit lock.
        // Rebase generation and saved values at publication so an intervening Save
        // cannot be overwritten by this older capture.
        let search = self.read_runtime_check_environment().await?;
        let _update = self.runtime_search_update.lock().await;
        let current = self.runtime_search_environment.read().await.clone();
        let configurations = rovai_core::runtime_startup::load_all(&*self.database.lock().await)?;
        let search = search.with_startup_configurations(configurations);
        let changed = !current.same_inputs(&search);
        let generation = if changed {
            current
                .generation()
                .checked_add(1)
                .context("Runtime search generation exhausted")?
        } else {
            current.generation()
        };
        let search = Arc::new(search.with_generation(generation));
        let summary = search.summary();
        if changed {
            let mut database = self.database.lock().await;
            // Only a comparison of actual inputs invalidates shared catalogs;
            // startup's counter reset must not clear unrelated Runtime caches.
            database.connection().execute(
                "UPDATE adapter_capability_snapshot SET model_catalog_succeeded_at=NULL",
                [],
            )?;
            database.record_runtime_search_environment_generation(
                summary.generation,
                &summary.created_at,
            )?;
            drop(database);
            search.activate_for_runtime_commands();
            self.native_skill_discovery.invalidate_cache();
        }
        *self.runtime_search_environment.write().await = search.clone();
        Ok(search)
    }

    /// Held only around result commits, never across a Runtime process or probe.
    pub(crate) async fn runtime_check_update_guard(
        &self,
        search: &RuntimeSearchEnvironment,
    ) -> Option<MutexGuard<'_, ()>> {
        let update = self.runtime_search_update.lock().await;
        (self.runtime_search_environment.read().await.generation() == search.generation())
            .then_some(update)
    }
}
