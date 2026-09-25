//! Fresh discovery inputs are separate from publishing the active search snapshot.
use crate::application::{
    AdapterKind, Core, RuntimeDiscoveryObservation, RuntimeDiscoveryStatus,
    RuntimeExecutableCandidate, RuntimeSearchEnvironment,
};
use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::MutexGuard;

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
pub(crate) type TestSearchCapture =
    Arc<dyn Fn(u64, bool) -> RuntimeSearchEnvironment + Send + Sync>;

impl Core {
    /// No activation, database writes, discovery events or probes. Drafts use only this half.
    pub(crate) async fn read_runtime_check_environment(
        &self,
        interactive: bool,
    ) -> Result<RuntimeSearchEnvironment> {
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
                return capture(generation, interactive);
            }
            RuntimeSearchEnvironment::rescan(generation, interactive)
        })
        .await
        .context("Runtime Search Environment worker failed")
    }

    pub(crate) async fn refresh_runtime_check_environment(
        &self,
        interactive: bool,
    ) -> Result<Arc<RuntimeSearchEnvironment>> {
        // Serialize capture/publication with settings save. Load saved values *after*
        // capture, and never publish a copy of an editor's uncommitted overlay.
        let _update = self.runtime_search_update.lock().await;
        let search = self.read_runtime_check_environment(interactive).await?;
        let configurations = rovai_core::runtime_startup::load_all(&*self.database.lock().await)?;
        let search = Arc::new(search.with_startup_configurations(configurations));
        let summary = search.summary();
        self.database
            .lock()
            .await
            .record_runtime_search_environment_generation(
                summary.generation,
                &summary.created_at,
            )?;
        search.activate_for_runtime_commands();
        *self.runtime_search_environment.write().await = search.clone();
        self.native_skill_discovery.invalidate_cache();
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
