use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
};

use tokio::{
    sync::{Mutex, Notify, OwnedRwLockReadGuard, RwLock},
    time::{Instant, timeout_at},
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
    fn complete_handoff(&mut self) {
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
    guard: Option<OwnedRwLockReadGuard<()>>,
}

/// A short-lived guard for one callback that arrived through a live Runtime
/// route. Planned shutdown keeps this admission open throughout the drain
/// window, then closes and drains it before Runtime reap.
#[derive(Debug)]
pub struct RuntimeRoutePermit {
    guard: Option<OwnedRwLockReadGuard<()>>,
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

    /// Release the terminal barrier immediately after the authoritative
    /// transaction finishes. Runtime cleanup and event emission are not part
    /// of terminal settlement admission.
    pub fn complete_settlement(&mut self) {
        self.guard.take();
    }
}

impl RuntimeRoutePermit {
    /// Release the live-route barrier once the callback's authoritative writes
    /// are complete. Adapter cleanup may continue after the route is fenced.
    pub fn complete_callback(&mut self) {
        self.guard.take();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalAdmissionError {
    Closed,
    ExecutionNotActive,
    RouteMismatch,
    PlannedStopNotRequested,
    ConflictingTerminal,
}

#[derive(Debug)]
pub enum RuntimeTerminalAdmission {
    Ordinary {
        guard: Option<OwnedRwLockReadGuard<()>>,
    },
    Planned(TerminalSettlementPermit),
}

impl RuntimeTerminalAdmission {
    pub fn planned_permit(&self) -> Option<&TerminalSettlementPermit> {
        match self {
            Self::Ordinary { .. } => None,
            Self::Planned(permit) => Some(permit),
        }
    }

    pub fn complete_settlement(&mut self) {
        match self {
            Self::Ordinary { guard } => {
                guard.take();
            }
            Self::Planned(permit) => permit.complete_settlement(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum ShutdownPhase {
    Accepting = 0,
    ClosingLaunch = 1,
    Draining = 2,
    TerminalClosed = 3,
}

impl ShutdownPhase {
    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Accepting,
            1 => Self::ClosingLaunch,
            2 => Self::Draining,
            _ => Self::TerminalClosed,
        }
    }
}

#[derive(Debug)]
pub struct PlannedShutdownCoordinator {
    generation: String,
    phase: AtomicU8,
    launch_gate: Arc<RwLock<()>>,
    terminal_gate: Arc<RwLock<()>>,
    runtime_routes_open: AtomicBool,
    runtime_route_gate: Arc<RwLock<()>>,
    active: Mutex<HashMap<ActiveExecutionKey, ActiveExecution>>,
    settled: Mutex<HashMap<ActiveExecutionKey, SettledExecution>>,
    active_changed: Notify,
}

impl PlannedShutdownCoordinator {
    pub fn new(generation: impl Into<String>) -> Arc<Self> {
        Arc::new(Self {
            generation: generation.into(),
            phase: AtomicU8::new(ShutdownPhase::Accepting as u8),
            launch_gate: Arc::new(RwLock::new(())),
            terminal_gate: Arc::new(RwLock::new(())),
            runtime_routes_open: AtomicBool::new(true),
            runtime_route_gate: Arc::new(RwLock::new(())),
            active: Mutex::new(HashMap::new()),
            settled: Mutex::new(HashMap::new()),
            active_changed: Notify::new(),
        })
    }

    pub fn generation(&self) -> &str {
        &self.generation
    }

    fn phase(&self) -> ShutdownPhase {
        ShutdownPhase::from_u8(self.phase.load(Ordering::Acquire))
    }

    /// True as soon as planned shutdown has closed execution launch admission.
    pub fn shutdown_started(&self) -> bool {
        self.phase() != ShutdownPhase::Accepting
    }

    pub async fn enter_launch(&self) -> Option<ExecutionLaunchPermit> {
        if self.phase() != ShutdownPhase::Accepting {
            return None;
        }
        let guard = self.launch_gate.clone().read_owned().await;
        if self.phase() != ShutdownPhase::Accepting {
            return None;
        }
        Some(ExecutionLaunchPermit {
            generation: self.generation.clone(),
            guard: Some(guard),
        })
    }

    /// Linearization point for planned shutdown. New launch permits are denied
    /// immediately, while terminals from handoffs already in progress continue
    /// through the ordinary route until the launch barrier closes.
    pub fn close_launch_admission(&self) {
        let _ = self.phase.compare_exchange(
            ShutdownPhase::Accepting as u8,
            ShutdownPhase::ClosingLaunch as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    /// Wait for every admitted launch to bind its route or abandon the launch.
    /// Only then does terminal classification switch to planned-shutdown rules.
    pub async fn finish_launch_closure_until(&self, deadline: Instant) -> bool {
        self.close_launch_admission();
        if self.phase() == ShutdownPhase::Draining {
            return true;
        }
        if self.phase() == ShutdownPhase::TerminalClosed {
            return false;
        }
        let Ok(barrier) = timeout_at(deadline, self.launch_gate.write()).await else {
            return false;
        };
        let transitioned = self
            .phase
            .compare_exchange(
                ShutdownPhase::ClosingLaunch as u8,
                ShutdownPhase::Draining as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
            || self.phase() == ShutdownPhase::Draining;
        drop(barrier);
        transitioned
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
        self.bind_route_inner(key, binding).await
    }

    async fn bind_route_inner(
        &self,
        key: &ActiveExecutionKey,
        binding: RuntimeRouteBinding,
    ) -> bool {
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

    /// Atomically establishes the generation-local route binding before the
    /// launch permit releases the handoff barrier.
    pub async fn complete_handoff(
        &self,
        permit: &mut ExecutionLaunchPermit,
        key: &ActiveExecutionKey,
        binding: RuntimeRouteBinding,
    ) -> bool {
        if permit.generation != self.generation || permit.guard.is_none() {
            return false;
        }
        if !self.bind_route_inner(key, binding).await {
            return false;
        }
        permit.complete_handoff();
        true
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

    /// A non-terminal launch/transport error cannot resolve an execution after
    /// its Runtime handoff is bound. From that point on, only a correlated
    /// Runtime terminal may remove the active execution; otherwise the outcome
    /// must remain unknown for generation-local settlement or startup recovery.
    pub async fn must_preserve_unresolved_after_nonterminal_error(
        &self,
        key: &ActiveExecutionKey,
    ) -> bool {
        self.active
            .lock()
            .await
            .get(key)
            .is_some_and(|execution| execution.binding.is_some())
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
    ) -> Result<RuntimeTerminalAdmission, TerminalAdmissionError> {
        if self.phase() == ShutdownPhase::TerminalClosed {
            return Err(TerminalAdmissionError::Closed);
        }
        let guard = self.terminal_gate.clone().read_owned().await;
        match self.phase() {
            ShutdownPhase::Accepting | ShutdownPhase::ClosingLaunch => {
                return Ok(RuntimeTerminalAdmission::Ordinary { guard: Some(guard) });
            }
            ShutdownPhase::Draining => {}
            ShutdownPhase::TerminalClosed => return Err(TerminalAdmissionError::Closed),
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
        Ok(RuntimeTerminalAdmission::Planned(
            TerminalSettlementPermit {
                generation: self.generation.clone(),
                observation,
                planned_stop_requested,
                guard: Some(guard),
            },
        ))
    }

    pub async fn enter_runtime_route(&self) -> Option<RuntimeRoutePermit> {
        if !self.runtime_routes_open.load(Ordering::Acquire) {
            return None;
        }
        let guard = self.runtime_route_gate.clone().read_owned().await;
        if !self.runtime_routes_open.load(Ordering::Acquire) {
            return None;
        }
        Some(RuntimeRoutePermit { guard: Some(guard) })
    }

    /// Close both correctness-sensitive admissions before waiting for either
    /// barrier. The shared absolute deadline prevents one drain from starving
    /// the other.
    pub async fn close_terminal_and_runtime_routes_until(&self, deadline: Instant) -> (bool, bool) {
        self.close_terminal_and_runtime_route_admission();
        self.drain_terminal_and_runtime_routes_until(deadline).await
    }

    /// Synchronously fence late terminal and callback admission. This must run
    /// before aborting guard-owning tasks at the settlement cutoff.
    pub fn close_terminal_and_runtime_route_admission(&self) {
        self.phase
            .store(ShutdownPhase::TerminalClosed as u8, Ordering::Release);
        self.runtime_routes_open.store(false, Ordering::Release);
    }

    pub async fn drain_terminal_and_runtime_routes_until(&self, deadline: Instant) -> (bool, bool) {
        let terminal_gate = self.terminal_gate.clone();
        let route_gate = self.runtime_route_gate.clone();
        tokio::join!(
            async move {
                timeout_at(deadline, terminal_gate.write())
                    .await
                    .map(drop)
                    .is_ok()
            },
            async move {
                timeout_at(deadline, route_gate.write())
                    .await
                    .map(drop)
                    .is_ok()
            }
        )
    }

    pub async fn wait_for_no_active_until(&self, deadline: Instant) -> bool {
        loop {
            let Ok(active) = timeout_at(deadline, self.active.lock()).await else {
                return false;
            };
            if active.is_empty() {
                return true;
            }
            drop(active);
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
        self.close_launch_admission();
        assert!(
            self.finish_launch_closure_until(Instant::now() + std::time::Duration::from_secs(1))
                .await
        );
        let _ = self
            .close_terminal_and_runtime_routes_until(
                Instant::now() + std::time::Duration::from_secs(1),
            )
            .await;
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

    fn planned(admission: RuntimeTerminalAdmission) -> TerminalSettlementPermit {
        match admission {
            RuntimeTerminalAdmission::Planned(permit) => permit,
            RuntimeTerminalAdmission::Ordinary { .. } => {
                panic!("expected planned-shutdown terminal admission")
            }
        }
    }

    async fn finish_launch_closure(coordinator: &PlannedShutdownCoordinator) {
        coordinator.close_launch_admission();
        assert!(
            coordinator
                .finish_launch_closure_until(Instant::now() + std::time::Duration::from_secs(1))
                .await
        );
    }

    #[tokio::test]
    async fn drain_waits_for_launch_handoff_and_rejects_new_launch() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 1);
        assert!(
            coordinator
                .register_active(&permit, key.clone(), AdapterKind::CodexCli)
                .await
        );
        coordinator.close_launch_admission();
        let draining = {
            let coordinator = coordinator.clone();
            tokio::spawn(async move {
                coordinator
                    .finish_launch_closure_until(Instant::now() + std::time::Duration::from_secs(1))
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert!(!draining.is_finished());
        assert!(coordinator.enter_launch().await.is_none());

        // A terminal can race ahead of the Core route binding after the
        // Provider has accepted the prompt. ClosingLaunch must keep it on the
        // ordinary path instead of rejecting it as RouteMismatch.
        assert!(matches!(
            coordinator
                .admit_terminal(RuntimeTerminalObservation {
                    key: key.clone(),
                    binding: binding(),
                    outcome: RuntimeTerminalOutcome::Failed,
                    fingerprint: "failed:turn-1".to_string(),
                })
                .await
                .unwrap(),
            RuntimeTerminalAdmission::Ordinary { .. }
        ));
        assert!(
            coordinator
                .complete_handoff(&mut permit, &key, binding())
                .await
        );
        assert!(draining.await.unwrap());
    }

    #[tokio::test]
    async fn stable_wrong_route_is_fenced_after_launch_handoff() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut permit = coordinator.enter_launch().await.expect("launch is open");
        let key = ActiveExecutionKey::new("run-1", 1);
        assert!(
            coordinator
                .register_active(&permit, key.clone(), AdapterKind::CodexCli)
                .await
        );
        assert!(
            coordinator
                .complete_handoff(&mut permit, &key, binding())
                .await
        );
        finish_launch_closure(&coordinator).await;

        let mut wrong_binding = binding();
        wrong_binding.adapter_turn_correlation = "wrong-turn".to_string();
        assert_eq!(
            coordinator
                .admit_terminal(RuntimeTerminalObservation {
                    key,
                    binding: wrong_binding,
                    outcome: RuntimeTerminalOutcome::Failed,
                    fingerprint: "failed:wrong-turn".to_string(),
                })
                .await
                .unwrap_err(),
            TerminalAdmissionError::RouteMismatch
        );
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
        assert!(
            coordinator
                .complete_handoff(&mut permit, &key, binding())
                .await
        );
        finish_launch_closure(&coordinator).await;

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
        let permit = planned(coordinator.admit_terminal(observation).await.unwrap());
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
        assert!(
            coordinator
                .complete_handoff(&mut permit, &key, binding())
                .await
        );
        finish_launch_closure(&coordinator).await;
        assert!(coordinator.mark_planned_stop_requested(&key).await);
        let accepted = RuntimeTerminalObservation {
            key: key.clone(),
            binding: binding(),
            outcome: RuntimeTerminalOutcome::Failed,
            fingerprint: "failed:turn-1".to_string(),
        };
        let permit = planned(coordinator.admit_terminal(accepted).await.unwrap());
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
        assert!(
            coordinator
                .complete_handoff(&mut permit, &key, binding())
                .await
        );
        finish_launch_closure(&coordinator).await;
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
    async fn launch_closure_respects_its_deadline_without_entering_drain() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let _permit = coordinator.enter_launch().await.expect("launch is open");
        coordinator.close_launch_admission();

        assert!(
            !coordinator
                .finish_launch_closure_until(Instant::now() + std::time::Duration::from_millis(5),)
                .await
        );
        assert!(coordinator.shutdown_started());
        assert!(matches!(
            coordinator
                .admit_terminal(RuntimeTerminalObservation {
                    key: ActiveExecutionKey::new("run-1", 1),
                    binding: binding(),
                    outcome: RuntimeTerminalOutcome::Failed,
                    fingerprint: "failed:turn-1".to_string(),
                })
                .await
                .unwrap(),
            RuntimeTerminalAdmission::Ordinary { .. }
        ));
    }

    #[tokio::test]
    async fn bound_handoff_always_preserves_unknown_after_nonterminal_error() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        let mut bound_permit = coordinator.enter_launch().await.expect("launch is open");
        let bound_key = ActiveExecutionKey::new("run-bound", 1);
        assert!(
            coordinator
                .register_active(&bound_permit, bound_key.clone(), AdapterKind::CodexCli)
                .await
        );
        assert!(
            coordinator
                .complete_handoff(&mut bound_permit, &bound_key, binding())
                .await
        );

        let unbound_permit = coordinator.enter_launch().await.expect("launch is open");
        let unbound_key = ActiveExecutionKey::new("run-unbound", 1);
        assert!(
            coordinator
                .register_active(&unbound_permit, unbound_key.clone(), AdapterKind::CodexCli)
                .await
        );

        assert!(
            coordinator
                .must_preserve_unresolved_after_nonterminal_error(&bound_key)
                .await
        );
        coordinator.close_launch_admission();
        assert!(
            !coordinator
                .must_preserve_unresolved_after_nonterminal_error(&unbound_key)
                .await
        );
        drop(unbound_permit);
        assert!(
            coordinator
                .finish_launch_closure_until(Instant::now() + std::time::Duration::from_secs(1),)
                .await
        );
        assert!(
            coordinator
                .must_preserve_unresolved_after_nonterminal_error(&bound_key)
                .await
        );
    }

    #[tokio::test]
    async fn terminal_and_route_drain_respect_one_absolute_deadline() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        finish_launch_closure(&coordinator).await;
        let terminal = coordinator.terminal_gate.clone().read_owned().await;
        let route = coordinator
            .enter_runtime_route()
            .await
            .expect("live routes remain admitted during drain");

        coordinator.close_terminal_and_runtime_route_admission();
        assert_eq!(
            coordinator
                .drain_terminal_and_runtime_routes_until(
                    Instant::now() + std::time::Duration::from_millis(5),
                )
                .await,
            (false, false)
        );
        assert!(coordinator.enter_runtime_route().await.is_none());
        assert_eq!(
            coordinator
                .admit_terminal(RuntimeTerminalObservation {
                    key: ActiveExecutionKey::new("run-1", 1),
                    binding: binding(),
                    outcome: RuntimeTerminalOutcome::Failed,
                    fingerprint: "failed:turn-1".to_string(),
                })
                .await
                .unwrap_err(),
            TerminalAdmissionError::Closed
        );

        drop(terminal);
        drop(route);
        assert_eq!(
            coordinator
                .drain_terminal_and_runtime_routes_until(
                    Instant::now() + std::time::Duration::from_secs(1),
                )
                .await,
            (true, true)
        );
    }

    #[tokio::test]
    async fn runtime_route_fence_waits_for_entered_callbacks_and_rejects_late_events() {
        let coordinator = PlannedShutdownCoordinator::new("generation-1");
        finish_launch_closure(&coordinator).await;
        let mut permit = coordinator
            .enter_runtime_route()
            .await
            .expect("live routes remain admitted during drain");
        let fencing = {
            let coordinator = coordinator.clone();
            tokio::spawn(async move {
                coordinator
                    .close_terminal_and_runtime_routes_until(
                        Instant::now() + std::time::Duration::from_secs(1),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert!(!fencing.is_finished());
        permit.complete_callback();
        assert_eq!(fencing.await.unwrap(), (true, true));
        assert!(coordinator.enter_runtime_route().await.is_none());
    }
}
