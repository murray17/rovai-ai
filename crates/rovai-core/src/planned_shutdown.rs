use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use tokio::{
    sync::{Mutex, Notify, OwnedRwLockReadGuard, RwLock},
    time::Instant,
};

use crate::agent_profile::AdapterKind;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ActiveExecutionKey {
    pub agent_run_id: String,
    pub execution_epoch: i64,
}

impl ActiveExecutionKey {
    pub fn new(agent_run_id: impl Into<String>, execution_epoch: i64) -> Self {
        Self {
            agent_run_id: agent_run_id.into(),
            execution_epoch,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeRouteBinding {
    pub route_identity: String,
    pub adapter_turn_correlation: String,
    pub provider_turn_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeTerminalOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

impl RuntimeTerminalOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeTerminalObservation {
    pub key: ActiveExecutionKey,
    pub binding: RuntimeRouteBinding,
    pub outcome: RuntimeTerminalOutcome,
    pub fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct ActiveExecutionSnapshot {
    pub key: ActiveExecutionKey,
    pub adapter_kind: AdapterKind,
    pub binding: Option<RuntimeRouteBinding>,
    pub planned_stop_requested: bool,
}

#[derive(Debug)]
struct ActiveExecution {
    adapter_kind: AdapterKind,
    binding: Option<RuntimeRouteBinding>,
    planned_stop_requested: bool,
    terminal_fingerprint: Option<String>,
    terminal_outcome: Option<RuntimeTerminalOutcome>,
}

#[derive(Debug)]
struct SettledExecution {
    binding: RuntimeRouteBinding,
    planned_stop_requested: bool,
    terminal_fingerprint: String,
    terminal_outcome: RuntimeTerminalOutcome,
}

/// A launch permit spans claim through the Adapter-specific prompt-send handoff.
/// It is intentionally non-serializable and can only be obtained from the
/// generation-local coordinator.
#[derive(Debug)]
pub struct ExecutionLaunchPermit {
    generation: String,
    guard: Option<OwnedRwLockReadGuard<()>>,
}

impl ExecutionLaunchPermit {
    pub fn complete_handoff(&mut self) {
        self.guard.take();
    }
}

/// A short-lived capability proving that one matching terminal observation
/// entered settlement before terminal admission closed. The private fields keep
/// it out of public command and transport surfaces.
#[derive(Debug)]
pub struct TerminalSettlementPermit {
    generation: String,
    observation: RuntimeTerminalObservation,
    planned_stop_requested: bool,
    _guard: OwnedRwLockReadGuard<()>,
}

/// A short-lived guard for one callback that arrived through a live Runtime
/// route. Planned shutdown keeps this admission open throughout the drain
/// window, then closes and drains it before Runtime reap.
#[derive(Debug)]
pub struct RuntimeRoutePermit {
    _guard: OwnedRwLockReadGuard<()>,
}

impl TerminalSettlementPermit {
    pub(crate) fn authorizes(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        outcome: RuntimeTerminalOutcome,
    ) -> bool {
        !self.generation.is_empty()
            && self.observation.key.agent_run_id == agent_run_id
            && self.observation.key.execution_epoch == execution_epoch
            && self.observation.outcome == outcome
            && (outcome != RuntimeTerminalOutcome::Cancelled || self.planned_stop_requested)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalAdmissionError {
    NotDraining,
    Closed,
    ExecutionNotActive,
    RouteMismatch,
    PlannedStopNotRequested,
    ConflictingTerminal,
}

#[derive(Debug)]
pub struct PlannedShutdownCoordinator {
    generation: String,
    launch_open: AtomicBool,
    launch_gate: Arc<RwLock<()>>,
    terminal_open: AtomicBool,
    terminal_gate: Arc<RwLock<()>>,
    runtime_routes_open: AtomicBool,
    runtime_route_gate: Arc<RwLock<()>>,
    draining: AtomicBool,
    active: Mutex<HashMap<ActiveExecutionKey, ActiveExecution>>,
    settled: Mutex<HashMap<ActiveExecutionKey, SettledExecution>>,
    active_changed: Notify,
}

impl PlannedShutdownCoordinator {
    pub fn new(generation: impl Into<String>) -> Arc<Self> {
        Arc::new(Self {
            generation: generation.into(),
            launch_open: AtomicBool::new(true),
            launch_gate: Arc::new(RwLock::new(())),
            terminal_open: AtomicBool::new(true),
            terminal_gate: Arc::new(RwLock::new(())),
            runtime_routes_open: AtomicBool::new(true),
            runtime_route_gate: Arc::new(RwLock::new(())),
            draining: AtomicBool::new(false),
            active: Mutex::new(HashMap::new()),
            settled: Mutex::new(HashMap::new()),
            active_changed: Notify::new(),
        })
    }

    pub fn generation(&self) -> &str {
        &self.generation
    }

    pub fn is_draining(&self) -> bool {
        self.draining.load(Ordering::Acquire)
    }

    pub async fn enter_launch(&self) -> Option<ExecutionLaunchPermit> {
        if !self.launch_open.load(Ordering::Acquire) {
            return None;
        }
        let guard = self.launch_gate.clone().read_owned().await;
        if !self.launch_open.load(Ordering::Acquire) {
            return None;
        }
        Some(ExecutionLaunchPermit {
            generation: self.generation.clone(),
            guard: Some(guard),
        })
    }

    pub async fn begin_drain(&self) {
        self.draining.store(true, Ordering::Release);
        self.launch_open.store(false, Ordering::Release);
        let barrier = self.launch_gate.write().await;
        drop(barrier);
    }

    pub async fn register_active(
        &self,
        permit: &ExecutionLaunchPermit,
        key: ActiveExecutionKey,
        adapter_kind: AdapterKind,
    ) -> bool {
        if permit.generation != self.generation || permit.guard.is_none() {
            return false;
        }
        let mut active = self.active.lock().await;
        if active.contains_key(&key) {
            return false;
        }
        active.insert(
            key,
            ActiveExecution {
                adapter_kind,
                binding: None,
                planned_stop_requested: false,
                terminal_fingerprint: None,
                terminal_outcome: None,
            },
        );
        self.active_changed.notify_waiters();
        true
    }

    pub async fn bind_route(&self, key: &ActiveExecutionKey, binding: RuntimeRouteBinding) -> bool {
        let mut active = self.active.lock().await;
        let Some(execution) = active.get_mut(key) else {
            return false;
        };
        match &execution.binding {
            Some(existing) if existing != &binding => false,
            Some(_) => true,
            None => {
                execution.binding = Some(binding);
                self.active_changed.notify_waiters();
                true
            }
        }
    }

    pub async fn mark_planned_stop_requested(&self, key: &ActiveExecutionKey) -> bool {
        let mut active = self.active.lock().await;
        let Some(execution) = active.get_mut(key) else {
            return false;
        };
        execution.planned_stop_requested = true;
        true
    }

    pub async fn active_snapshots(&self) -> Vec<ActiveExecutionSnapshot> {
        self.active
            .lock()
            .await
            .iter()
            .map(|(key, execution)| ActiveExecutionSnapshot {
                key: key.clone(),
                adapter_kind: execution.adapter_kind,
                binding: execution.binding.clone(),
                planned_stop_requested: execution.planned_stop_requested,
            })
            .collect()
    }

    pub async fn remove_active(&self, key: &ActiveExecutionKey) -> bool {
        let removed = self.active.lock().await.remove(key);
        if let Some(execution) = removed {
            if let (Some(binding), Some(terminal_fingerprint), Some(terminal_outcome)) = (
                execution.binding,
                execution.terminal_fingerprint,
                execution.terminal_outcome,
            ) {
                self.settled.lock().await.insert(
                    key.clone(),
                    SettledExecution {
                        binding,
                        planned_stop_requested: execution.planned_stop_requested,
                        terminal_fingerprint,
                        terminal_outcome,
                    },
                );
            }
            self.active_changed.notify_waiters();
            return true;
        }
        false
    }

    pub async fn remove_active_if_unbound(&self, key: &ActiveExecutionKey) -> bool {
        let mut active = self.active.lock().await;
        if active
            .get(key)
            .is_none_or(|execution| execution.binding.is_some())
        {
            return false;
        }
        active.remove(key);
        self.active_changed.notify_waiters();
        true
    }

    pub async fn admit_terminal(
        &self,
        observation: RuntimeTerminalObservation,
    ) -> Result<TerminalSettlementPermit, TerminalAdmissionError> {
        if !self.is_draining() {
            return Err(TerminalAdmissionError::NotDraining);
        }
        if !self.terminal_open.load(Ordering::Acquire) {
            return Err(TerminalAdmissionError::Closed);
        }
        let guard = self.terminal_gate.clone().read_owned().await;
        if !self.terminal_open.load(Ordering::Acquire) {
            return Err(TerminalAdmissionError::Closed);
        }
        let planned_stop_requested = {
            let mut active = self.active.lock().await;
            if let Some(execution) = active.get_mut(&observation.key) {
                if execution.binding.as_ref() != Some(&observation.binding) {
                    return Err(TerminalAdmissionError::RouteMismatch);
                }
                if observation.outcome == RuntimeTerminalOutcome::Cancelled
                    && !execution.planned_stop_requested
                {
                    return Err(TerminalAdmissionError::PlannedStopNotRequested);
                }
                match (
                    execution.terminal_fingerprint.as_deref(),
                    execution.terminal_outcome,
                ) {
                    (Some(existing), Some(existing_outcome))
                        if existing != observation.fingerprint
                            || existing_outcome != observation.outcome =>
                    {
                        return Err(TerminalAdmissionError::ConflictingTerminal);
                    }
                    (Some(_), Some(_)) => {}
                    (None, None) => {
                        execution.terminal_fingerprint = Some(observation.fingerprint.clone());
                        execution.terminal_outcome = Some(observation.outcome);
                    }
                    _ => return Err(TerminalAdmissionError::ConflictingTerminal),
                }
                execution.planned_stop_requested
            } else {
                drop(active);
                let settled = self.settled.lock().await;
                let execution = settled
                    .get(&observation.key)
                    .ok_or(TerminalAdmissionError::ExecutionNotActive)?;
                if execution.binding != observation.binding {
                    return Err(TerminalAdmissionError::RouteMismatch);
                }
                if execution.terminal_fingerprint != observation.fingerprint
                    || execution.terminal_outcome != observation.outcome
                {
                    return Err(TerminalAdmissionError::ConflictingTerminal);
                }
                if observation.outcome == RuntimeTerminalOutcome::Cancelled
                    && !execution.planned_stop_requested
                {
                    return Err(TerminalAdmissionError::PlannedStopNotRequested);
                }
                execution.planned_stop_requested
            }
        };
        Ok(TerminalSettlementPermit {
            generation: self.generation.clone(),
            observation,
            planned_stop_requested,
            _guard: guard,
        })
    }

    pub async fn close_terminal_admission_and_drain(&self) {
        self.terminal_open.store(false, Ordering::Release);
        let barrier = self.terminal_gate.write().await;
        drop(barrier);
    }

    pub async fn enter_runtime_route(&self) -> Option<RuntimeRoutePermit> {
        if !self.runtime_routes_open.load(Ordering::Acquire) {
            return None;
        }
        let guard = self.runtime_route_gate.clone().read_owned().await;
        if !self.runtime_routes_open.load(Ordering::Acquire) {
            return None;
        }
        Some(RuntimeRoutePermit { _guard: guard })
    }

    pub async fn close_runtime_routes_and_drain(&self) {
        self.runtime_routes_open.store(false, Ordering::Release);
        let barrier = self.runtime_route_gate.write().await;
        drop(barrier);
    }

    pub async fn wait_for_no_active_until(&self, deadline: Instant) -> bool {
        loop {
            if self.active.lock().await.is_empty() {
                return true;
            }
            let notified = self.active_changed.notified();
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            if tokio::time::timeout(deadline.saturating_duration_since(now), notified)
                .await
                .is_err()
            {
                return false;
            }
        }
    }

    #[cfg(test)]
    pub async fn close_for_test(&self) {
        self.begin_drain().await;
        self.close_terminal_admission_and_drain().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> RuntimeRouteBinding {
        RuntimeRouteBinding {
            route_identity: "host-1".to_string(),
            adapter_turn_correlation: "turn-1".to_string(),
            provider_turn_id: Some("turn-1".to_string()),
        }
    }

    #[tokio::test]
    async fn drain_waits_for_launch_handoff_and_rejects_new_launch() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let draining = {
            let coordinator = coordinator.clone();
            tokio::spawn(async move { coordinator.begin_drain().await })
        };
        tokio::task::yield_now().await;
        assert!(!draining.is_finished());
        permit.complete_handoff();
        draining.await.unwrap();
        assert!(coordinator.enter_launch().await.is_none());
    }

    #[tokio::test]
    async fn cancelled_terminal_requires_matching_route_and_planned_stop() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 2);
        assert!(
            coordinator
                .register_active(&permit, key.clone(), AdapterKind::CodexCli)
                .await
        );
        assert!(coordinator.bind_route(&key, binding()).await);
        permit.complete_handoff();
        coordinator.begin_drain().await;

        let observation = RuntimeTerminalObservation {
            key: key.clone(),
            binding: binding(),
            outcome: RuntimeTerminalOutcome::Cancelled,
            fingerprint: "cancelled:turn-1".to_string(),
        };
        assert_eq!(
            coordinator
                .admit_terminal(observation.clone())
                .await
                .unwrap_err(),
            TerminalAdmissionError::PlannedStopNotRequested
        );
        assert!(coordinator.mark_planned_stop_requested(&key).await);
        let permit = coordinator.admit_terminal(observation).await.unwrap();
        assert!(permit.authorizes("run-1", 2, RuntimeTerminalOutcome::Cancelled));
    }

    #[tokio::test]
    async fn conflicting_terminal_is_fenced() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 2);
        assert!(
            coordinator
                .register_active(&permit, key.clone(), AdapterKind::CodexCli)
                .await
        );
        assert!(coordinator.bind_route(&key, binding()).await);
        permit.complete_handoff();
        coordinator.begin_drain().await;
        assert!(coordinator.mark_planned_stop_requested(&key).await);
        let accepted = RuntimeTerminalObservation {
            key: key.clone(),
            binding: binding(),
            outcome: RuntimeTerminalOutcome::Failed,
            fingerprint: "failed:turn-1".to_string(),
        };
        let permit = coordinator.admit_terminal(accepted).await.unwrap();
        drop(permit);
        let conflicting = RuntimeTerminalObservation {
            key,
            binding: binding(),
            outcome: RuntimeTerminalOutcome::Cancelled,
            fingerprint: "cancelled:turn-1".to_string(),
        };
        assert_eq!(
            coordinator.admit_terminal(conflicting).await.unwrap_err(),
            TerminalAdmissionError::ConflictingTerminal
        );
    }

    #[tokio::test]
    async fn exact_terminal_duplicate_remains_admissible_after_active_handle_is_removed() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 2);
        assert!(
            coordinator
                .register_active(&permit, key.clone(), AdapterKind::CodexCli)
                .await
        );
        assert!(coordinator.bind_route(&key, binding()).await);
        permit.complete_handoff();
        coordinator.begin_drain().await;
        assert!(coordinator.mark_planned_stop_requested(&key).await);
        let observation = RuntimeTerminalObservation {
            key: key.clone(),
            binding: binding(),
            outcome: RuntimeTerminalOutcome::Failed,
            fingerprint: "failed:turn-1".to_string(),
        };

        drop(
            coordinator
                .admit_terminal(observation.clone())
                .await
                .unwrap(),
        );
        assert!(coordinator.remove_active(&key).await);
        assert!(coordinator.active_snapshots().await.is_empty());
        drop(
            coordinator
                .admit_terminal(observation.clone())
                .await
                .unwrap(),
        );

        let conflicting = RuntimeTerminalObservation {
            outcome: RuntimeTerminalOutcome::Cancelled,
            fingerprint: "cancelled:turn-1".to_string(),
            ..observation
        };
        assert_eq!(
            coordinator.admit_terminal(conflicting).await.unwrap_err(),
            TerminalAdmissionError::ConflictingTerminal
        );
    }

    #[tokio::test]
    async fn wait_for_active_is_bounded() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 1);
        assert!(
            coordinator
                .register_active(&permit, key, AdapterKind::CodexCli)
                .await
        );
        assert!(
            !coordinator
                .wait_for_no_active_until(Instant::now() + std::time::Duration::from_millis(5),)
                .await
        );
    }

    #[tokio::test]
    async fn runtime_route_fence_waits_for_entered_callbacks_and_rejects_late_events() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        coordinator.begin_drain().await;
        let permit = coordinator
            .enter_runtime_route()
            .await
            .expect("live routes remain admitted during drain");
        let fencing = {
            let coordinator = coordinator.clone();
            tokio::spawn(async move { coordinator.close_runtime_routes_and_drain().await })
        };
        tokio::task::yield_now().await;
        assert!(!fencing.is_finished());
        drop(permit);
        fencing.await.unwrap();
        assert!(coordinator.enter_runtime_route().await.is_none());
    }
}
