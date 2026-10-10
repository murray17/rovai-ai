use std::{
    collections::{BTreeSet, HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::agent_profile::AdapterKind;
use serde::{Deserialize, Serialize};
#[cfg(all(test, feature = "extended-tests"))]
use tokio::sync::Notify;
use tokio::{
    sync::{Mutex, oneshot},
    task::JoinSet,
    time::{Instant, MissedTickBehavior, timeout_at},
};

use crate::{
    acp::AcpHost,
    builtin_tool_runtime::{BuiltinToolLeaseRegistry, BuiltinToolProcessConfig},
    codex::CodexHost,
    pi::PiHost,
};

pub(crate) const DEFAULT_MAX_RESIDENT_PROCESSES_PER_MEMBER: usize = 20;
pub(crate) const DEFAULT_MAX_RESIDENT_PROCESSES_GLOBAL: usize = 200;
pub(crate) const DEFAULT_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
pub(crate) const DEFAULT_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
const DEFAULT_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(crate) struct AgentRuntimeFleetConfig {
    pub max_resident_processes_per_member: usize,
    pub max_resident_processes_global: usize,
    pub idle_ttl: Duration,
    pub sweep_interval: Duration,
    pub stop_timeout: Duration,
}

impl Default for AgentRuntimeFleetConfig {
    fn default() -> Self {
        Self {
            max_resident_processes_per_member: DEFAULT_MAX_RESIDENT_PROCESSES_PER_MEMBER,
            max_resident_processes_global: DEFAULT_MAX_RESIDENT_PROCESSES_GLOBAL,
            idle_ttl: DEFAULT_IDLE_TTL,
            sweep_interval: DEFAULT_SWEEP_INTERVAL,
            stop_timeout: DEFAULT_STOP_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum RuntimeReuseScope {
    Camp { camp_id: String },
    Member { camp_id: String, agent_id: String },
    Workspace { workspace_key: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct RuntimeCompatibilityKey {
    reuse_scope: RuntimeReuseScope,
    invalidation_camp_id: Option<String>,
    invalidation_agent_id: Option<String>,
    residency_bucket: String,
    pub runtime_compatibility_digest: String,
}

impl RuntimeCompatibilityKey {
    pub(crate) fn member(
        camp_id: impl Into<String>,
        agent_id: impl Into<String>,
        runtime_compatibility_digest: impl Into<String>,
    ) -> Self {
        let camp_id = camp_id.into();
        let agent_id = agent_id.into();
        Self {
            reuse_scope: RuntimeReuseScope::Member {
                camp_id: camp_id.clone(),
                agent_id: agent_id.clone(),
            },
            invalidation_camp_id: Some(camp_id),
            invalidation_agent_id: Some(agent_id.clone()),
            residency_bucket: agent_id,
            runtime_compatibility_digest: runtime_compatibility_digest.into(),
        }
    }

    pub(crate) fn camp(
        camp_id: impl Into<String>,
        agent_id: impl Into<String>,
        runtime_compatibility_digest: impl Into<String>,
    ) -> Self {
        let camp_id = camp_id.into();
        Self {
            reuse_scope: RuntimeReuseScope::Camp {
                camp_id: camp_id.clone(),
            },
            invalidation_camp_id: Some(camp_id.clone()),
            invalidation_agent_id: Some(agent_id.into()),
            residency_bucket: format!("camp:{camp_id}"),
            runtime_compatibility_digest: runtime_compatibility_digest.into(),
        }
    }

    pub(crate) fn workspace(
        camp_id: impl Into<String>,
        agent_id: impl Into<String>,
        workspace_key: impl Into<String>,
        runtime_compatibility_digest: impl Into<String>,
    ) -> Self {
        let camp_id = camp_id.into();
        let agent_id = agent_id.into();
        let workspace_key = workspace_key.into();
        Self {
            reuse_scope: RuntimeReuseScope::Workspace {
                workspace_key: workspace_key.clone(),
            },
            invalidation_camp_id: Some(camp_id),
            invalidation_agent_id: Some(agent_id),
            residency_bucket: format!("workspace:{workspace_key}"),
            runtime_compatibility_digest: runtime_compatibility_digest.into(),
        }
    }

    fn is_process_compatible_with(&self, candidate: &Self) -> bool {
        self.reuse_scope == candidate.reuse_scope
            && self.runtime_compatibility_digest == candidate.runtime_compatibility_digest
    }

    fn belongs_to_camp(&self, camp_id: &str) -> bool {
        self.invalidation_camp_id.as_deref() == Some(camp_id)
    }

    fn belongs_to_member(&self, agent_id: &str) -> bool {
        self.invalidation_agent_id.as_deref() == Some(agent_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
struct RunLeaseKey {
    agent_run_id: String,
    execution_epoch: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct FleetAcquireRequest {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub adapter_kind: AdapterKind,
    pub compatibility: RuntimeCompatibilityKey,
}

impl FleetAcquireRequest {
    fn run_lease(&self) -> RunLeaseKey {
        RunLeaseKey {
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FleetResidency {
    Resident,
    Burst,
}

#[derive(Clone)]
pub(crate) enum RuntimeProcessHost {
    Codex(Arc<CodexHost>),
    Acp(Arc<AcpHost>),
    Pi(Arc<PiHost>),
    #[cfg(all(test, feature = "extended-tests"))]
    Fake(Arc<FakeRuntimeProcessHost>),
}

#[cfg(all(test, feature = "extended-tests"))]
#[derive(Debug)]
pub(crate) struct FakeRuntimeProcessHost {
    process_id: String,
    shutdown_delay: Duration,
    reap_gate: Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Semaphore>)>,
    reaped: std::sync::atomic::AtomicBool,
    shutdown_calls: std::sync::atomic::AtomicUsize,
    zcode_background: AtomicBool,
}

#[cfg(all(test, feature = "extended-tests"))]
pub(crate) fn fake_runtime_process_host(process_id: impl Into<String>) -> RuntimeProcessHost {
    RuntimeProcessHost::Fake(Arc::new(FakeRuntimeProcessHost {
        process_id: process_id.into(),
        shutdown_delay: Duration::ZERO,
        reap_gate: None,
        reaped: std::sync::atomic::AtomicBool::new(false),
        shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
        zcode_background: AtomicBool::new(false),
    }))
}

#[cfg(all(test, feature = "extended-tests"))]
pub(crate) fn fake_runtime_process_host_with_reap_gate(
    process_id: &str,
) -> (
    RuntimeProcessHost,
    Arc<tokio::sync::Notify>,
    Arc<tokio::sync::Semaphore>,
) {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let mut host = fake_runtime_process_host(process_id);
    if let RuntimeProcessHost::Fake(fake) = &mut host {
        Arc::get_mut(fake).unwrap().reap_gate = Some((entered.clone(), release.clone()));
    }
    (host, entered, release)
}

impl RuntimeProcessHost {
    fn process_id(&self) -> &str {
        match self {
            Self::Codex(host) => host.host_instance_id(),
            Self::Acp(host) => host.host_instance_id(),
            Self::Pi(host) => host.host_instance_id(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => &host.process_id,
        }
    }

    fn is_healthy(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_alive(),
            Self::Acp(host) => host.is_alive(),
            Self::Pi(host) => host.is_alive(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => !host.reaped.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    fn has_zcode_background_tasks(&self) -> bool {
        match self {
            Self::Acp(host) => host.has_zcode_background_tasks(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => host.zcode_background.load(Ordering::Acquire),
            _ => false,
        }
    }

    async fn is_quiescent(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_quiescent().await,
            Self::Acp(host) => host.is_quiescent().await,
            Self::Pi(host) => host.is_quiescent().await,
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => !host.reaped.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    async fn shutdown_and_reap(&self) {
        match self {
            Self::Codex(host) => host.shutdown_and_reap().await,
            Self::Acp(host) => host.shutdown_and_reap().await,
            Self::Pi(host) => host.shutdown_and_reap().await,
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => {
                host.shutdown_calls
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Some((entered, release)) = &host.reap_gate {
                    entered.notify_one();
                    let permit = release.acquire().await.expect("test reap gate closed");
                    permit.forget();
                }
                tokio::time::sleep(host.shutdown_delay).await;
                host.reaped
                    .store(true, std::sync::atomic::Ordering::Release);
            }
        }
    }

    async fn force_reap_until(&self, deadline: Instant) -> bool {
        match self {
            Self::Codex(host) => host.force_reap_until(deadline).await,
            Self::Acp(host) => host.force_reap_until(deadline).await,
            Self::Pi(host) => host.force_reap_until(deadline).await,
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => {
                host.reaped.load(std::sync::atomic::Ordering::Acquire)
                    || timeout_at(deadline, self.shutdown_and_reap()).await.is_ok()
            }
        }
    }

    async fn shutdown_and_reap_until(&self, deadline: Instant) -> bool {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let reserve = std::cmp::min(Duration::from_millis(250), remaining / 4);
        let _ = timeout_at(deadline - reserve, self.shutdown_and_reap()).await;
        self.force_reap_until(deadline).await
    }

    fn pid(&self) -> Option<u32> {
        match self {
            Self::Codex(host) => host.pid(),
            Self::Acp(host) => host.pid(),
            Self::Pi(host) => host.pid(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(host) => {
                (!host.reaped.load(std::sync::atomic::Ordering::Acquire)).then_some(42)
            }
        }
    }

    fn executable_path(&self) -> &Path {
        match self {
            Self::Codex(host) => host.executable_path(),
            Self::Acp(host) => host.executable_path(),
            Self::Pi(host) => host.executable_path(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(_) => Path::new("fake-runtime"),
        }
    }

    fn builtin_tool_process_config(&self) -> Option<BuiltinToolProcessConfig> {
        match self {
            Self::Codex(host) => host.builtin_tool_process_config().cloned(),
            Self::Acp(host) => host.builtin_tool_process_config().cloned(),
            Self::Pi(host) => host.builtin_tool_process_config().cloned(),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(_) => None,
        }
    }

    pub(crate) fn into_codex(self) -> Result<Arc<CodexHost>> {
        match self {
            Self::Codex(host) => Ok(host),
            Self::Acp(_) => bail!("Fleet returned an ACP Host to the Codex Adapter"),
            Self::Pi(_) => bail!("Fleet returned a Pi Host to the Codex Adapter"),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(_) => bail!("Fleet returned a fake Host to the Codex Adapter"),
        }
    }

    pub(crate) fn into_acp(self) -> Result<Arc<AcpHost>> {
        match self {
            Self::Acp(host) => Ok(host),
            Self::Codex(_) => bail!("Fleet returned a Codex Host to an ACP Adapter"),
            Self::Pi(_) => bail!("Fleet returned a Pi Host to an ACP Adapter"),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(_) => bail!("Fleet returned a fake Host to the ACP Adapter"),
        }
    }

    pub(crate) fn into_pi(self) -> Result<Arc<PiHost>> {
        match self {
            Self::Pi(host) => Ok(host),
            Self::Codex(_) => bail!("Fleet returned a Codex Host to the Pi Adapter"),
            Self::Acp(_) => bail!("Fleet returned an ACP Host to the Pi Adapter"),
            #[cfg(all(test, feature = "extended-tests"))]
            Self::Fake(_) => bail!("Fleet returned a fake Host to the Pi Adapter"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeFleetShutdownOutcome {
    pub observed_processes: usize,
    pub reaped_processes: usize,
    pub force_kill_signals_sent: usize,
    pub deadline_expired: bool,
}

impl RuntimeFleetShutdownOutcome {
    pub(crate) fn all_reaped(self) -> bool {
        self.reaped_processes == self.observed_processes
    }
}

#[derive(Clone)]
pub(crate) struct FleetLease {
    pub process_id: String,
    pub host: RuntimeProcessHost,
    pub residency: FleetResidency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FleetReleaseDisposition {
    Reusable,
    Stop,
}

/// A missing lease is not evidence that a process was reaped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FleetReleaseOutcome {
    Reusable,
    Reaped,
    NoMatchingLease,
    ReapUnconfirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FleetProcessState {
    Starting,
    BusyResident,
    IdleWarm,
    Stopping,
    BusyBurst,
}

struct FleetStartupOperation {
    outcome: tokio::sync::watch::Sender<Option<std::result::Result<FleetLease, String>>>,
    cancelled: AtomicBool,
}

impl FleetStartupOperation {
    fn new() -> Self {
        let (outcome, _) = tokio::sync::watch::channel(None);
        Self {
            outcome,
            cancelled: AtomicBool::new(false),
        }
    }

    fn complete(&self, outcome: std::result::Result<FleetLease, String>) {
        self.outcome.send_replace(Some(outcome));
    }

    async fn wait(&self) -> Result<FleetLease> {
        let mut outcome = self.outcome.subscribe();
        loop {
            if let Some(result) = outcome.borrow().clone() {
                return result.map_err(anyhow::Error::msg);
            }
            outcome
                .changed()
                .await
                .context("Fleet startup completion channel closed")?;
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

struct FleetStopCompletion {
    outcome: tokio::sync::watch::Sender<Option<bool>>,
}

impl FleetStopCompletion {
    fn new() -> Self {
        let (outcome, _) = tokio::sync::watch::channel(None);
        Self { outcome }
    }

    fn complete(&self, reaped: bool) {
        self.outcome.send_replace(Some(reaped));
    }

    fn result(&self) -> Option<bool> {
        *self.outcome.borrow()
    }

    async fn wait(&self) -> bool {
        let mut outcome = self.outcome.subscribe();
        loop {
            if let Some(reaped) = *outcome.borrow() {
                return reaped;
            }
            if outcome.changed().await.is_err() {
                return false;
            }
        }
    }
}

#[derive(Clone)]
struct FleetStopLaunch {
    process_id: String,
    host: RuntimeProcessHost,
    completion: Arc<FleetStopCompletion>,
}

enum FleetStopPlan {
    Absent,
    Starting(Arc<FleetStartupOperation>),
    Wait(Arc<FleetStopCompletion>),
    Launch(FleetStopLaunch),
}

enum FleetStopWait {
    Absent,
    Starting(Arc<FleetStartupOperation>),
    Process(Arc<FleetStopCompletion>),
}

impl FleetStopWait {
    async fn wait(self) -> bool {
        match self {
            Self::Absent => true,
            Self::Starting(startup) => startup.wait().await.is_err(),
            Self::Process(stop) => stop.wait().await,
        }
    }
}

enum FleetAcquirePlan {
    Ready(FleetLease),
    Wait(Arc<FleetStartupOperation>),
    Blocked(String),
    Spawn {
        reservation_id: String,
        run_lease: RunLeaseKey,
        residency: FleetResidency,
        completion: Arc<FleetStartupOperation>,
        eviction: Option<FleetStopLaunch>,
    },
}

struct ProcessEntry {
    process_id: String,
    adapter_kind: AdapterKind,
    compatibility: RuntimeCompatibilityKey,
    state: FleetProcessState,
    residency: FleetResidency,
    host: Option<RuntimeProcessHost>,
    startup: Option<Arc<FleetStartupOperation>>,
    stop: Option<Arc<FleetStopCompletion>>,
    run_lease: Option<RunLeaseKey>,
    idle_since: Option<Instant>,
    last_used_sequence: u64,
    retire_after_run: bool,
    retirement: Option<Arc<FleetStopCompletion>>,
}

#[derive(Default)]
struct FleetState {
    shutdown_started: bool,
    deleting_camps: HashSet<String>,
    processes: HashMap<String, ProcessEntry>,
    process_by_run: HashMap<RunLeaseKey, String>,
    // Retain only Codex cleanup receipts until Core durably acknowledges them.
    // These are stop-operation evidence, not another process state machine.
    reaped_leases: HashSet<RunLeaseKey>,
    resident_processes: HashSet<String>,
    resident_processes_by_bucket: HashMap<String, HashSet<String>>,
    idle_lru: BTreeSet<(u64, String)>,
    next_sequence: u64,
}

impl FleetState {
    fn next_sequence(&mut self) -> u64 {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.next_sequence
    }

    fn resident_count_for_bucket(&self, residency_bucket: &str) -> usize {
        self.resident_processes_by_bucket
            .get(residency_bucket)
            .map_or(0, HashSet::len)
    }

    fn has_resident_capacity(
        &self,
        config: &AgentRuntimeFleetConfig,
        residency_bucket: &str,
    ) -> bool {
        self.resident_processes.len() < config.max_resident_processes_global
            && self.resident_count_for_bucket(residency_bucket)
                < config.max_resident_processes_per_member
    }

    fn insert_process(&mut self, entry: ProcessEntry) {
        let process_id = entry.process_id.clone();
        if entry.residency == FleetResidency::Resident {
            let residency_bucket = entry.compatibility.residency_bucket.clone();
            self.resident_processes.insert(process_id.clone());
            self.resident_processes_by_bucket
                .entry(residency_bucket)
                .or_default()
                .insert(process_id.clone());
        }
        self.processes.insert(process_id, entry);
    }

    fn remove_process(&mut self, process_id: &str) -> Option<ProcessEntry> {
        let entry = self.processes.remove(process_id)?;
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        if let Some(run_lease) = &entry.run_lease {
            self.process_by_run.remove(run_lease);
        }
        self.resident_processes.remove(process_id);
        let residency_bucket = &entry.compatibility.residency_bucket;
        if let Some(processes) = self.resident_processes_by_bucket.get_mut(residency_bucket) {
            processes.remove(process_id);
            if processes.is_empty() {
                self.resident_processes_by_bucket.remove(residency_bucket);
            }
        }
        if let Some(retirement) = &entry.retirement
            && retirement.result().is_none()
        {
            retirement.complete(true);
        }
        Some(entry)
    }

    fn plan_stop(&mut self, process_id: &str) -> FleetStopPlan {
        let Some(entry) = self.processes.get_mut(process_id) else {
            return FleetStopPlan::Absent;
        };
        if entry.state == FleetProcessState::Starting {
            entry.retire_after_run = true;
            let Some(startup) = entry.startup.clone() else {
                return FleetStopPlan::Absent;
            };
            startup.cancel();
            return FleetStopPlan::Starting(startup);
        }
        if entry.state == FleetProcessState::Stopping
            && let Some(completion) = entry.stop.clone()
            && completion.result().is_none()
        {
            return FleetStopPlan::Wait(completion);
        }
        let Some(host) = entry.host.clone() else {
            return FleetStopPlan::Absent;
        };
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        // Preserve the lease and capacity until a confirmed reap. A timeout
        // must not make the next cleanup attempt mistake an owned process for
        // an absent one.
        entry.idle_since = None;
        entry.state = FleetProcessState::Stopping;
        let completion = Arc::new(FleetStopCompletion::new());
        entry.stop = Some(completion.clone());
        FleetStopPlan::Launch(FleetStopLaunch {
            process_id: process_id.to_string(),
            host,
            completion,
        })
    }

    fn reserve_idle_eviction(&mut self, process_id: &str) -> Option<FleetStopLaunch> {
        let entry = self.processes.get_mut(process_id)?;
        if entry.state != FleetProcessState::IdleWarm
            || entry
                .host
                .as_ref()
                .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)
        {
            return None;
        }
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        self.resident_processes.remove(process_id);
        let residency_bucket = entry.compatibility.residency_bucket.clone();
        if let Some(processes) = self.resident_processes_by_bucket.get_mut(&residency_bucket) {
            processes.remove(process_id);
            if processes.is_empty() {
                self.resident_processes_by_bucket.remove(&residency_bucket);
            }
        }
        entry.idle_since = None;
        entry.state = FleetProcessState::Stopping;
        let host = entry.host.clone()?;
        let completion = Arc::new(FleetStopCompletion::new());
        entry.stop = Some(completion.clone());
        Some(FleetStopLaunch {
            process_id: process_id.to_string(),
            host,
            completion,
        })
    }

    fn restore_stopping_resident_capacity(
        &mut self,
        process_id: &str,
        completion: &Arc<FleetStopCompletion>,
    ) {
        let residency_bucket = self.processes.get(process_id).and_then(|entry| {
            (entry.state == FleetProcessState::Stopping
                && entry.residency == FleetResidency::Resident
                && entry
                    .stop
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, completion)))
            .then(|| entry.compatibility.residency_bucket.clone())
        });
        if let Some(residency_bucket) = residency_bucket {
            self.resident_processes.insert(process_id.to_string());
            self.resident_processes_by_bucket
                .entry(residency_bucket)
                .or_default()
                .insert(process_id.to_string());
        }
    }

    fn oldest_idle_for_bucket(&self, residency_bucket: &str) -> Option<String> {
        self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && entry.compatibility.residency_bucket == residency_bucket
                        && !entry
                            .host
                            .as_ref()
                            .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)
                })
                .map(|_| process_id.clone())
        })
    }

    fn oldest_idle_global(&self) -> Option<String> {
        self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && !entry
                            .host
                            .as_ref()
                            .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)
                })
                .map(|_| process_id.clone())
        })
    }

    fn plan_acquire(
        &mut self,
        config: &AgentRuntimeFleetConfig,
        request: &FleetAcquireRequest,
    ) -> FleetAcquirePlan {
        if self.shutdown_started {
            return FleetAcquirePlan::Blocked("Runtime Fleet is shutting down".to_string());
        }
        if request
            .compatibility
            .invalidation_camp_id
            .as_ref()
            .is_some_and(|camp_id| self.deleting_camps.contains(camp_id))
        {
            return FleetAcquirePlan::Blocked("Camp deletion is in progress".to_string());
        }
        let run_lease = request.run_lease();
        if let Some(process_id) = self.process_by_run.get(&run_lease)
            && let Some(entry) = self.processes.get(process_id)
        {
            if entry.state == FleetProcessState::Starting
                && let Some(completion) = entry.startup.clone()
            {
                return FleetAcquirePlan::Wait(completion);
            }
            if matches!(
                entry.state,
                FleetProcessState::BusyResident | FleetProcessState::BusyBurst
            ) && let Some(host) = entry.host.clone()
            {
                return FleetAcquirePlan::Ready(FleetLease {
                    process_id: process_id.clone(),
                    host,
                    residency: entry.residency,
                });
            }
            return FleetAcquirePlan::Blocked(
                "Runtime lease is being retired for this AgentRun epoch".to_string(),
            );
        }

        if request.adapter_kind == AdapterKind::CodexCli
            && self.processes.values().any(|entry| {
                entry.adapter_kind == AdapterKind::CodexCli
                    && entry.compatibility.reuse_scope == request.compatibility.reuse_scope
                    && (entry.state == FleetProcessState::Stopping
                        || (entry.state == FleetProcessState::Starting && entry.retire_after_run))
            })
        {
            return FleetAcquirePlan::Blocked(
                "Codex Native Session cleanup is not confirmed".to_string(),
            );
        }

        let compatible_idle = [true, false].into_iter().find_map(|background_first| {
            self.idle_lru.iter().find_map(|(_, process_id)| {
                self.processes
                    .get(process_id)
                    .filter(|entry| {
                        entry.state == FleetProcessState::IdleWarm
                            && (!background_first
                                || entry
                                    .host
                                    .as_ref()
                                    .is_some_and(RuntimeProcessHost::has_zcode_background_tasks))
                            && entry.adapter_kind == request.adapter_kind
                            && (!entry
                                .host
                                .as_ref()
                                .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)
                                || entry.compatibility.invalidation_agent_id
                                    == request.compatibility.invalidation_agent_id)
                            && entry
                                .compatibility
                                .is_process_compatible_with(&request.compatibility)
                            && entry
                                .host
                                .as_ref()
                                .is_some_and(RuntimeProcessHost::is_healthy)
                    })
                    .map(|_| process_id.clone())
            })
        });
        if let Some(process_id) = compatible_idle {
            let (last_used_sequence, host, residency) = {
                let entry = self
                    .processes
                    .get_mut(&process_id)
                    .expect("Fleet compatible idle process disappeared");
                let last_used_sequence = entry.last_used_sequence;
                entry.state = if entry.residency == FleetResidency::Burst {
                    FleetProcessState::BusyBurst
                } else {
                    FleetProcessState::BusyResident
                };
                entry.run_lease = Some(run_lease.clone());
                entry.idle_since = None;
                entry.compatibility = request.compatibility.clone();
                (
                    last_used_sequence,
                    entry
                        .host
                        .clone()
                        .expect("Fleet compatible idle Host disappeared"),
                    entry.residency,
                )
            };
            self.idle_lru
                .remove(&(last_used_sequence, process_id.clone()));
            self.process_by_run.insert(run_lease, process_id.clone());
            return FleetAcquirePlan::Ready(FleetLease {
                process_id,
                host,
                residency,
            });
        }

        let mut eviction = None;
        let residency =
            if self.has_resident_capacity(config, &request.compatibility.residency_bucket) {
                FleetResidency::Resident
            } else {
                let eviction_id = if self
                    .resident_count_for_bucket(&request.compatibility.residency_bucket)
                    >= config.max_resident_processes_per_member
                {
                    self.oldest_idle_for_bucket(&request.compatibility.residency_bucket)
                } else {
                    self.oldest_idle_for_bucket(&request.compatibility.residency_bucket)
                        .or_else(|| self.oldest_idle_global())
                };
                if let Some(process_id) = eviction_id
                    && let Some(stop) = self.reserve_idle_eviction(&process_id)
                {
                    eviction = Some(stop);
                    FleetResidency::Resident
                } else {
                    FleetResidency::Burst
                }
            };

        let reservation_id = uuid::Uuid::new_v4().to_string();
        let completion = Arc::new(FleetStartupOperation::new());
        let sequence = self.next_sequence();
        self.insert_process(ProcessEntry {
            process_id: reservation_id.clone(),
            adapter_kind: request.adapter_kind,
            compatibility: request.compatibility.clone(),
            state: FleetProcessState::Starting,
            residency,
            host: None,
            startup: Some(completion.clone()),
            stop: None,
            run_lease: Some(run_lease.clone()),
            idle_since: None,
            last_used_sequence: sequence,
            retire_after_run: false,
            retirement: None,
        });
        self.process_by_run
            .insert(run_lease.clone(), reservation_id.clone());
        FleetAcquirePlan::Spawn {
            reservation_id,
            run_lease,
            residency,
            completion,
            eviction,
        }
    }
}

pub(crate) struct AgentRuntimeFleetManager {
    config: AgentRuntimeFleetConfig,
    operations: Arc<Mutex<()>>,
    state: Arc<Mutex<FleetState>>,
    owner_records: Option<RuntimeOwnerRecordStore>,
    builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuntimeOwnerRecord {
    #[serde(default)]
    run_lease: Option<RunLeaseKey>,
    #[serde(default)]
    reaped: bool,
    core_generation: String,
    pid: u32,
    process_group_id: i32,
    executable_path: String,
    #[serde(default)]
    process_start_identity: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    windows_job_name: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeOwnerRecordStore {
    root: PathBuf,
    core_generation: String,
}

impl RuntimeOwnerRecordStore {
    fn new(data_dir: &Path) -> Result<Self> {
        let fleet_root = data_dir.join("runtime-fleet");
        let root = fleet_root.join("owners");
        #[cfg(windows)]
        {
            use crate::platform::private_storage::{
                admit_private_directory, prepare_legacy_managed_private_directory,
                repair_legacy_managed_private_file,
            };
            admit_private_directory(data_dir)?;
            prepare_legacy_managed_private_directory(&fleet_root)?;
            prepare_legacy_managed_private_directory(&root)?;
            for entry in std::fs::read_dir(&root)? {
                let path = entry?.path();
                if path.extension().is_some_and(|ext| ext == "json") {
                    repair_legacy_managed_private_file(&path)?;
                }
            }
        }
        #[cfg(not(windows))]
        {
            crate::platform::prepare_private_directory(&fleet_root)?;
            crate::platform::prepare_private_directory(&root)?;
        }
        let store = Self {
            root,
            core_generation: uuid::Uuid::new_v4().to_string(),
        };
        store.cleanup_stale();
        Ok(store)
    }

    fn record_path(&self, process_id: &str) -> PathBuf {
        self.root.join(format!("{process_id}.json"))
    }

    fn register(
        &self,
        process_id: &str,
        host: &RuntimeProcessHost,
        run_lease: Option<RunLeaseKey>,
    ) -> Result<()> {
        let record = RuntimeOwnerRecord {
            run_lease,
            reaped: false,
            core_generation: self.core_generation.clone(),
            pid: host.pid().context("Runtime process has no root PID")?,
            process_group_id: {
                #[cfg(unix)]
                {
                    let pid = host.pid().context("Runtime process has no root PID")?;
                    unsafe { libc::getpgid(pid as i32) }
                }
                #[cfg(not(unix))]
                {
                    0
                }
            },
            executable_path: host.executable_path().to_string_lossy().into_owned(),
            process_start_identity: owner_process_start_identity(
                host.pid().context("Runtime process has no root PID")?,
            ),
            windows_job_name: {
                #[cfg(windows)]
                {
                    match host {
                        RuntimeProcessHost::Codex(host) => Some(host.windows_job_name().to_owned()),
                        _ => None,
                    }
                }
                #[cfg(not(windows))]
                {
                    None
                }
            },
        };
        rovai_core::platform::private_storage::atomic_write_private_bytes(
            &self.record_path(process_id),
            &serde_json::to_vec(&record)?,
        )?;
        Ok(())
    }

    fn finish_stop(&self, process_id: &str) {
        let path = self.record_path(process_id);
        let record = std::fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<RuntimeOwnerRecord>(&data).ok());
        if let Some(mut record) = record.filter(|record| record.run_lease.is_some()) {
            record.reaped = true;
            if let Ok(data) = serde_json::to_vec(&record) {
                let _ =
                    rovai_core::platform::private_storage::atomic_write_private_bytes(&path, &data);
            }
        } else {
            self.remove(process_id);
        }
    }

    fn confirmed_stop(&self, key: &RunLeaseKey) -> bool {
        self.cleanup_stale();
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return false;
        };
        let records = entries
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| {
                std::fs::read(entry.path())
                    .ok()
                    .and_then(|data| serde_json::from_slice::<RuntimeOwnerRecord>(&data).ok())
            })
            .filter(|record| record.run_lease.as_ref() == Some(key))
            .collect::<Vec<_>>();
        !records.is_empty() && records.iter().all(|record| record.reaped)
    }

    fn acknowledge_cleanup(&self, key: &RunLeaseKey) {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let record = std::fs::read(entry.path())
                .ok()
                .and_then(|data| serde_json::from_slice::<RuntimeOwnerRecord>(&data).ok());
            if let Some(mut record) = record.filter(|record| record.run_lease.as_ref() == Some(key))
            {
                if record.reaped {
                    let _ = std::fs::remove_file(entry.path());
                } else {
                    record.run_lease = None;
                    if let Ok(data) = serde_json::to_vec(&record) {
                        let _ = rovai_core::platform::private_storage::atomic_write_private_bytes(
                            &entry.path(),
                            &data,
                        );
                    }
                }
            }
        }
    }

    fn remove(&self, process_id: &str) {
        let _ = std::fs::remove_file(self.record_path(process_id));
    }

    fn current_generation_records(&self) -> Vec<RuntimeOwnerRecord> {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| std::fs::read(entry.path()).ok())
            .filter_map(|bytes| serde_json::from_slice::<RuntimeOwnerRecord>(&bytes).ok())
            .filter(|record| record.core_generation == self.core_generation && !record.reaped)
            .collect()
    }

    /// Sends a final process-group kill only to ownership records created by
    /// this Core generation. Records intentionally remain durable until a
    /// later observation proves that the child was reaped.
    fn force_kill_current_generation(&self) -> usize {
        #[cfg(unix)]
        {
            self.force_kill_current_generation_with(owner_process_matches)
        }
        #[cfg(not(unix))]
        {
            0
        }
    }

    #[cfg(unix)]
    fn force_kill_current_generation_with(
        &self,
        matches_owner: impl Fn(u32, &str) -> bool,
    ) -> usize {
        self.current_generation_records()
            .into_iter()
            .filter(|record| {
                record.pid > 1
                    && record.process_group_id > 1
                    && record.pid != std::process::id()
                    && unsafe { libc::getpgid(record.pid as i32) == record.process_group_id }
                    && record.process_start_identity.is_some_and(|expected| {
                        owner_process_start_identity(record.pid) == Some(expected)
                    })
                    && matches_owner(record.pid, &record.executable_path)
                    && unsafe { libc::killpg(record.process_group_id, libc::SIGKILL) == 0 }
            })
            .count()
    }

    fn cleanup_stale(&self) {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let path = entry.path();
            let record = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<RuntimeOwnerRecord>(&bytes).ok());
            let mut remove_record = record.is_none();
            if let Some(mut _record) = record {
                if _record.reaped {
                    continue;
                }
                #[cfg(unix)]
                if _record.core_generation != self.core_generation
                    && _record.pid > 1
                    && _record.pid != std::process::id()
                    && unsafe { libc::getpgid(_record.pid as i32) == _record.process_group_id }
                    && _record.process_start_identity.is_some_and(|expected| {
                        owner_process_start_identity(_record.pid) == Some(expected)
                    })
                    && owner_process_matches(_record.pid, &_record.executable_path)
                {
                    unsafe {
                        libc::killpg(_record.process_group_id, libc::SIGKILL);
                    }
                }
                #[cfg(unix)]
                if unsafe { libc::getpgid(_record.pid as i32) == -1 } {
                    remove_record = true;
                }
                #[cfg(windows)]
                {
                    // Neither a missing Job nor ActiveProcesses=0 proves that
                    // every process handle has signaled. A restarted Core lacks
                    // the original owner's complete membership/exit witnesses.
                    // Scoped records require the durable receipt above.
                    remove_record = _record.run_lease.is_none();
                }
                #[cfg(not(any(unix, windows)))]
                {
                    // Legacy records have no scoped cleanup obligation. A new
                    // scoped record needs positive process-exit evidence.
                    remove_record = _record.run_lease.is_none();
                }
                if remove_record && _record.run_lease.is_some() {
                    _record.reaped = true;
                    if let Ok(data) = serde_json::to_vec(&_record) {
                        let _ = rovai_core::platform::private_storage::atomic_write_private_bytes(
                            &path, &data,
                        );
                    }
                    remove_record = false;
                }
            }
            if remove_record {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[cfg(unix)]
fn owner_process_matches(pid: u32, executable_path: &str) -> bool {
    let expected = PathBuf::from(executable_path);
    if owner_process_executable(pid)
        .is_some_and(|observed| process_path_matches(&observed, &expected))
    {
        return true;
    }
    owner_process_arguments(pid).is_some_and(|arguments| {
        arguments
            .iter()
            .any(|observed| process_path_matches(observed, &expected))
    })
}

#[cfg(unix)]
fn process_path_matches(observed: &Path, expected: &Path) -> bool {
    if observed == expected {
        return true;
    }
    let Some(observed) = std::fs::canonicalize(observed).ok() else {
        return false;
    };
    std::fs::canonicalize(expected).is_ok_and(|expected| observed == expected)
}

#[cfg(target_os = "macos")]
fn owner_process_start_identity(pid: u32) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some(
        info.pbi_start_tvsec
            .saturating_mul(1_000_000)
            .saturating_add(info.pbi_start_tvusec),
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn owner_process_start_identity(pid: u32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields = stat
        .rsplit_once(") ")?
        .1
        .split_whitespace()
        .collect::<Vec<_>>();
    fields.get(19)?.parse().ok()
}

#[cfg(windows)]
fn owner_process_start_identity(pid: u32) -> Option<u64> {
    crate::managed_process::ManagedProcess::windows_process_start_identity(pid)
}

#[cfg(not(any(unix, windows)))]
fn owner_process_start_identity(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
fn owner_process_executable(pid: u32) -> Option<PathBuf> {
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let length = unsafe {
        libc::proc_pidpath(
            pid as libc::c_int,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
        )
    };
    if length <= 0 {
        return None;
    }
    buffer.truncate(length as usize);
    Some(PathBuf::from(String::from_utf8(buffer).ok()?))
}

#[cfg(target_os = "macos")]
fn owner_process_arguments(pid: u32) -> Option<Vec<PathBuf>> {
    use std::mem::{size_of, size_of_val};

    let mut arg_max = 0_i32;
    let mut arg_max_size = size_of::<i32>();
    let mut arg_max_mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
    if unsafe {
        libc::sysctl(
            arg_max_mib.as_mut_ptr(),
            arg_max_mib.len() as u32,
            (&mut arg_max as *mut i32).cast(),
            &mut arg_max_size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || arg_max <= 0
    {
        return None;
    }

    let mut buffer = vec![0_u8; arg_max as usize];
    let mut buffer_size = buffer.len();
    let mut process_mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as i32];
    if unsafe {
        libc::sysctl(
            process_mib.as_mut_ptr(),
            process_mib.len() as u32,
            buffer.as_mut_ptr().cast(),
            &mut buffer_size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || buffer_size < size_of::<i32>()
    {
        return None;
    }
    buffer.truncate(buffer_size);
    let argc = i32::from_ne_bytes(buffer[..size_of::<i32>()].try_into().ok()?);
    if argc <= 0 {
        return Some(Vec::new());
    }

    let mut cursor = size_of_val(&argc);
    cursor += buffer.get(cursor..)?.iter().position(|byte| *byte == 0)? + 1;
    while buffer.get(cursor) == Some(&0) {
        cursor += 1;
    }
    let mut arguments = Vec::with_capacity(argc as usize);
    for _ in 0..argc {
        let remaining = buffer.get(cursor..)?;
        let length = remaining.iter().position(|byte| *byte == 0)?;
        if length == 0 {
            break;
        }
        let argument = std::str::from_utf8(&remaining[..length]).ok()?;
        arguments.push(PathBuf::from(argument));
        cursor += length + 1;
    }
    Some(arguments)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn owner_process_executable(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn owner_process_arguments(pid: u32) -> Option<Vec<PathBuf>> {
    let bytes = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    Some(
        bytes
            .split(|byte| *byte == 0)
            .filter(|argument| !argument.is_empty())
            .filter_map(|argument| std::str::from_utf8(argument).ok())
            .map(PathBuf::from)
            .collect(),
    )
}

impl AgentRuntimeFleetManager {
    #[cfg(all(test, feature = "extended-tests"))]
    pub(crate) fn new(config: AgentRuntimeFleetConfig) -> Self {
        Self::with_owner_records(config, None, Arc::new(BuiltinToolLeaseRegistry::default()))
    }

    pub(crate) fn new_with_builtin_tools(
        config: AgentRuntimeFleetConfig,
        data_dir: &Path,
        builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
    ) -> Result<Self> {
        Ok(Self::with_owner_records(
            config,
            Some(
                RuntimeOwnerRecordStore::new(data_dir)
                    .context("failed to prepare Runtime Fleet owner records")?,
            ),
            builtin_tool_leases,
        ))
    }

    fn with_owner_records(
        config: AgentRuntimeFleetConfig,
        owner_records: Option<RuntimeOwnerRecordStore>,
        builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
    ) -> Self {
        assert!(config.max_resident_processes_per_member > 0);
        assert!(config.max_resident_processes_global > 0);
        Self {
            config,
            operations: Arc::new(Mutex::new(())),
            state: Arc::new(Mutex::new(FleetState::default())),
            owner_records,
            builtin_tool_leases,
        }
    }

    pub(crate) async fn opencode_version_for_program(&self, identity: &str) -> Option<String> {
        self.state
            .lock()
            .await
            .processes
            .values()
            .find_map(|entry| {
                if entry.retire_after_run {
                    return None;
                }
                match &entry.host {
                    Some(RuntimeProcessHost::Acp(host)) => {
                        host.opencode_version_for_program(identity)
                    }
                    _ => None,
                }
            })
    }

    pub(crate) async fn acquire<F, Fut>(
        &self,
        request: FleetAcquireRequest,
        spawn: F,
    ) -> Result<FleetLease>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<RuntimeProcessHost>> + Send + 'static,
    {
        let plan = {
            let _operation = self.operations.lock().await;
            self.state.lock().await.plan_acquire(&self.config, &request)
        };
        let (reservation_id, run_lease, residency, completion, eviction) = match plan {
            FleetAcquirePlan::Ready(lease) => {
                if request.adapter_kind == AdapterKind::CodexCli
                    && let Some(records) = &self.owner_records
                {
                    records.register(
                        lease.host.process_id(),
                        &lease.host,
                        Some(request.run_lease()),
                    )?;
                }
                if request.adapter_kind == AdapterKind::CodexCli {
                    eprintln!(
                        "Codex acquire run={} epoch={} host={} path=reused",
                        request.agent_run_id,
                        request.execution_epoch,
                        lease.host.process_id()
                    );
                }
                return Ok(lease);
            }
            FleetAcquirePlan::Wait(completion) => return completion.wait().await,
            FleetAcquirePlan::Blocked(message) => bail!(message),
            FleetAcquirePlan::Spawn {
                reservation_id,
                run_lease,
                residency,
                completion,
                eviction,
            } => (reservation_id, run_lease, residency, completion, eviction),
        };

        // Once Reserve succeeds there are no further suspension points before
        // the Fleet launches the operation that owns this reservation.
        // Dropping any acquire waiter therefore cannot orphan Starting.
        let eviction_completion = eviction.as_ref().map(|stop| stop.completion.clone());
        if let Some(eviction) = eviction {
            self.launch_stop(eviction);
        }
        let startup_future = spawn();
        tokio::spawn(Self::drive_startup(
            self.config.clone(),
            self.operations.clone(),
            self.state.clone(),
            self.owner_records.clone(),
            reservation_id,
            run_lease,
            residency,
            completion.clone(),
            eviction_completion,
            startup_future,
        ));
        completion.wait().await
    }

    #[allow(clippy::too_many_arguments)]
    async fn drive_startup<Fut>(
        config: AgentRuntimeFleetConfig,
        operations: Arc<Mutex<()>>,
        state: Arc<Mutex<FleetState>>,
        owner_records: Option<RuntimeOwnerRecordStore>,
        reservation_id: String,
        run_lease: RunLeaseKey,
        residency: FleetResidency,
        completion: Arc<FleetStartupOperation>,
        eviction: Option<Arc<FleetStopCompletion>>,
        startup: Fut,
    ) where
        Fut: Future<Output = Result<RuntimeProcessHost>> + Send + 'static,
    {
        if let Some(eviction) = eviction
            && !eviction.wait().await
        {
            Self::fail_start_operation(
                &operations,
                &state,
                &reservation_id,
                &completion,
                "Runtime capacity eviction could not be reaped",
            )
            .await;
            return;
        }
        if completion.is_cancelled() {
            Self::fail_start_operation(
                &operations,
                &state,
                &reservation_id,
                &completion,
                "Fleet startup reservation was cancelled",
            )
            .await;
            return;
        }
        let host = match startup.await {
            Ok(host) => host,
            Err(error) => {
                Self::fail_start_operation(
                    &operations,
                    &state,
                    &reservation_id,
                    &completion,
                    &format!("{error:#}"),
                )
                .await;
                return;
            }
        };
        // Persist ownership before validation/retirement. A failed startup that
        // cannot be reaped must retain its Host, lease and capacity for retry.
        let ownership_error = owner_records.as_ref().and_then(|records| {
            records
                .register(
                    host.process_id(),
                    &host,
                    matches!(host, RuntimeProcessHost::Codex(_)).then(|| run_lease.clone()),
                )
                .err()
        });
        if !host.is_healthy() || completion.is_cancelled() || ownership_error.is_some() {
            Self::retire_failed_start(
                &config,
                &operations,
                &state,
                owner_records.as_ref(),
                &reservation_id,
                &completion,
                host,
                if completion.is_cancelled() {
                    "Fleet startup reservation was cancelled"
                } else {
                    "Runtime startup could not commit"
                },
            )
            .await;
            return;
        }
        let commit = {
            let _operation = operations.lock().await;
            let mut state = state.lock().await;
            (|| {
                let camp_is_deleting = state
                    .processes
                    .get(&reservation_id)
                    .and_then(|entry| entry.compatibility.invalidation_camp_id.as_ref())
                    .is_some_and(|camp_id| state.deleting_camps.contains(camp_id));
                let entry = state
                    .processes
                    .get_mut(&reservation_id)
                    .context("Fleet startup reservation disappeared before commit")?;
                if entry.state != FleetProcessState::Starting
                    || entry.run_lease.as_ref() != Some(&run_lease)
                    || entry.retire_after_run
                    || camp_is_deleting
                    || completion.is_cancelled()
                    || !entry
                        .startup
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &completion))
                {
                    bail!("Fleet startup reservation was invalidated before commit");
                }
                entry.host = Some(host.clone());
                entry.startup = None;
                entry.state = match residency {
                    FleetResidency::Resident => FleetProcessState::BusyResident,
                    FleetResidency::Burst => FleetProcessState::BusyBurst,
                };
                Ok(FleetLease {
                    process_id: reservation_id.clone(),
                    host: host.clone(),
                    residency,
                })
            })()
        };
        match commit {
            Ok(lease) => {
                if matches!(lease.host, RuntimeProcessHost::Codex(_)) {
                    eprintln!(
                        "Codex acquire run={} epoch={} host={} path=cold",
                        run_lease.agent_run_id,
                        run_lease.execution_epoch,
                        lease.host.process_id()
                    );
                }
                completion.complete(Ok(lease));
            }
            Err(error) => {
                Self::retire_failed_start(
                    &config,
                    &operations,
                    &state,
                    owner_records.as_ref(),
                    &reservation_id,
                    &completion,
                    host,
                    &format!("{error:#}"),
                )
                .await;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn retire_failed_start(
        config: &AgentRuntimeFleetConfig,
        operations: &Mutex<()>,
        state: &Mutex<FleetState>,
        records: Option<&RuntimeOwnerRecordStore>,
        reservation_id: &str,
        completion: &Arc<FleetStartupOperation>,
        host: RuntimeProcessHost,
        message: &str,
    ) {
        let reaped = host
            .shutdown_and_reap_until(Instant::now() + config.stop_timeout)
            .await;
        let _operation = operations.lock().await;
        let mut state = state.lock().await;
        if let Some(entry) = state.processes.get_mut(reservation_id) {
            entry.host = Some(host.clone());
            entry.startup = None;
            entry.state = FleetProcessState::Stopping;
            entry.retire_after_run = true;
            if reaped {
                if entry.adapter_kind == AdapterKind::CodexCli
                    && let Some(key) = entry.run_lease.clone()
                {
                    state.reaped_leases.insert(key);
                }
                state.remove_process(reservation_id);
                if let Some(records) = records {
                    records.finish_stop(host.process_id());
                }
            }
        }
        completion.complete(Err(message.to_string()));
    }

    async fn fail_start_operation(
        operations: &Mutex<()>,
        state: &Mutex<FleetState>,
        reservation_id: &str,
        completion: &Arc<FleetStartupOperation>,
        message: &str,
    ) {
        let _operation = operations.lock().await;
        let mut state = state.lock().await;
        let owns_reservation = state
            .processes
            .get(reservation_id)
            .and_then(|entry| entry.startup.as_ref())
            .is_some_and(|current| Arc::ptr_eq(current, completion));
        if owns_reservation {
            if let Some(entry) = state.processes.get(reservation_id)
                && entry.adapter_kind == AdapterKind::CodexCli
                && let Some(key) = entry.run_lease.clone()
            {
                state.reaped_leases.insert(key);
            }
            state.remove_process(reservation_id);
        }
        completion.complete(Err(message.to_string()));
    }

    fn launch_stop(&self, launch: FleetStopLaunch) {
        tokio::spawn(Self::drive_stop(
            self.config.stop_timeout,
            self.operations.clone(),
            self.state.clone(),
            self.owner_records.clone(),
            self.builtin_tool_leases.clone(),
            launch,
        ));
    }

    async fn drive_stop(
        stop_timeout: Duration,
        operations: Arc<Mutex<()>>,
        state: Arc<Mutex<FleetState>>,
        owner_records: Option<RuntimeOwnerRecordStore>,
        builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
        launch: FleetStopLaunch,
    ) {
        if let Some(config) = launch.host.builtin_tool_process_config() {
            builtin_tool_leases.unregister(config.process_id()).await;
        }
        let reaped = launch
            .host
            .shutdown_and_reap_until(Instant::now() + stop_timeout)
            .await;
        {
            let state = state.lock().await;
            if let Some(entry) = state.processes.get(&launch.process_id)
                && entry.adapter_kind == AdapterKind::CodexCli
                && let Some(key) = &entry.run_lease
            {
                eprintln!(
                    "Codex stop run={} epoch={} host={} disposition=Stop reaped={reaped}",
                    key.agent_run_id,
                    key.execution_epoch,
                    launch.host.process_id()
                );
            }
        }
        let (committed, failed_retirement) = if reaped {
            let _operation = operations.lock().await;
            let mut state = state.lock().await;
            match state.processes.get(&launch.process_id) {
                Some(entry)
                    if entry.state == FleetProcessState::Stopping
                        && entry
                            .stop
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(current, &launch.completion)) =>
                {
                    if entry.adapter_kind == AdapterKind::CodexCli
                        && let Some(key) = entry.run_lease.clone()
                    {
                        state.reaped_leases.insert(key);
                    }
                    state.remove_process(&launch.process_id);
                    (true, None)
                }
                None => (true, None),
                Some(entry) => (false, entry.retirement.clone()),
            }
        } else {
            let _operation = operations.lock().await;
            let mut state = state.lock().await;
            let retirement = state
                .processes
                .get(&launch.process_id)
                .and_then(|entry| entry.retirement.clone());
            state.restore_stopping_resident_capacity(&launch.process_id, &launch.completion);
            (false, retirement)
        };
        if let Some(retirement) = failed_retirement
            && retirement.result().is_none()
        {
            retirement.complete(false);
        }
        if committed && let Some(records) = &owner_records {
            records.finish_stop(launch.host.process_id());
        }
        launch.completion.complete(reaped && committed);
    }

    fn dispatch_stop_plan(&self, plan: FleetStopPlan) -> FleetStopWait {
        match plan {
            FleetStopPlan::Absent => FleetStopWait::Absent,
            FleetStopPlan::Starting(startup) => FleetStopWait::Starting(startup),
            FleetStopPlan::Wait(completion) => FleetStopWait::Process(completion),
            FleetStopPlan::Launch(launch) => {
                let completion = launch.completion.clone();
                self.launch_stop(launch);
                FleetStopWait::Process(completion)
            }
        }
    }

    /// Fence reuse as soon as a trusted failure is observed, before terminal
    /// publication or any slow flush. This never stops a successor's lease.
    pub(crate) async fn retire_agent_run_on_host(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        host_instance_id: &str,
    ) -> bool {
        let _operation = self.operations.lock().await;
        let mut state = self.state.lock().await;
        let key = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        let Some(id) = state.process_by_run.get(&key).cloned() else {
            return false;
        };
        let Some(entry) = state.processes.get_mut(&id) else {
            return false;
        };
        if entry.run_lease.as_ref() != Some(&key)
            || entry
                .host
                .as_ref()
                .is_none_or(|host| host.process_id() != host_instance_id)
        {
            return false;
        }
        entry.retire_after_run = true;
        true
    }

    pub(crate) async fn release(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        disposition: FleetReleaseDisposition,
    ) -> bool {
        self.release_with_outcome(agent_run_id, execution_epoch, disposition)
            .await
            != FleetReleaseOutcome::ReapUnconfirmed
    }

    async fn stop_outcome(&self, key: &RunLeaseKey, stopped: bool) -> FleetReleaseOutcome {
        let state = self.state.lock().await;
        if state.reaped_leases.contains(key) || (stopped && !state.process_by_run.contains_key(key))
        {
            FleetReleaseOutcome::Reaped
        } else {
            FleetReleaseOutcome::ReapUnconfirmed
        }
    }

    pub(crate) async fn acknowledge_cleanup(&self, agent_run_id: &str, execution_epoch: i64) {
        let key = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        self.state.lock().await.reaped_leases.remove(&key);
        if let Some(records) = &self.owner_records {
            records.acknowledge_cleanup(&key);
        }
    }

    pub(crate) async fn release_with_outcome(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        disposition: FleetReleaseDisposition,
    ) -> FleetReleaseOutcome {
        let run_lease = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        enum ReleasePlan {
            Stop(FleetStopPlan),
            CheckReusable {
                process_id: String,
                host: RuntimeProcessHost,
            },
        }
        let plan = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            let Some(process_id) = state.process_by_run.get(&run_lease).cloned() else {
                return if state.reaped_leases.contains(&run_lease) {
                    FleetReleaseOutcome::Reaped
                } else {
                    FleetReleaseOutcome::NoMatchingLease
                };
            };
            let Some(entry) = state.processes.get_mut(&process_id) else {
                return FleetReleaseOutcome::NoMatchingLease;
            };
            let should_stop = disposition == FleetReleaseDisposition::Stop
                || (entry.state != FleetProcessState::BusyResident
                    && !(entry.state == FleetProcessState::BusyBurst
                        && entry
                            .host
                            .as_ref()
                            .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)))
                || entry.retire_after_run
                || entry.host.is_none();
            if should_stop {
                ReleasePlan::Stop(state.plan_stop(&process_id))
            } else {
                ReleasePlan::CheckReusable {
                    process_id,
                    host: entry.host.clone().expect("checked above"),
                }
            }
        };
        let ReleasePlan::CheckReusable { process_id, host } = plan else {
            let ReleasePlan::Stop(stop) = plan else {
                unreachable!()
            };
            let stopped = self.dispatch_stop_plan(stop).wait().await;
            return self.stop_outcome(&run_lease, stopped).await;
        };
        if let Some(config) = host.builtin_tool_process_config() {
            self.builtin_tool_leases
                .unbind(config.process_id(), agent_run_id, execution_epoch)
                .await;
        }
        let quiescent = host.is_healthy() && host.is_quiescent().await;
        let stop = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            // A concurrent completion may already have released this lease.
            // Never stop a successor that acquired the same Host in the meantime.
            if state.process_by_run.get(&run_lease) != Some(&process_id) {
                return if state.reaped_leases.contains(&run_lease) {
                    FleetReleaseOutcome::Reaped
                } else {
                    FleetReleaseOutcome::NoMatchingLease
                };
            }
            let reusable = quiescent
                && state.process_by_run.get(&run_lease) == Some(&process_id)
                && state.processes.get(&process_id).is_some_and(|entry| {
                    matches!(
                        entry.state,
                        FleetProcessState::BusyResident | FleetProcessState::BusyBurst
                    ) && !entry.retire_after_run
                        && entry.run_lease.as_ref() == Some(&run_lease)
                        && entry.host.as_ref().is_some_and(|current| {
                            current.process_id() == host.process_id() && current.is_healthy()
                        })
                });
            if reusable {
                let sequence = state.next_sequence();
                state.process_by_run.remove(&run_lease);
                let entry = state
                    .processes
                    .get_mut(&process_id)
                    .expect("reusable Fleet entry disappeared");
                entry.run_lease = None;
                entry.state = FleetProcessState::IdleWarm;
                entry.idle_since = Some(Instant::now());
                entry.last_used_sequence = sequence;
                state.idle_lru.insert((sequence, process_id.clone()));
                None
            } else {
                Some(state.plan_stop(&process_id))
            }
        };
        match stop {
            None => FleetReleaseOutcome::Reusable,
            Some(stop) => {
                let stopped = self.dispatch_stop_plan(stop).wait().await;
                self.stop_outcome(&run_lease, stopped).await
            }
        }
    }

    /// Retire exactly this Run's lease. Never make a timed-out Host reusable.
    pub(crate) async fn stop_agent_run_until(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        deadline: Instant,
    ) -> bool {
        self.stop_agent_run_until_with_outcome(agent_run_id, execution_epoch, deadline)
            .await
            != FleetReleaseOutcome::ReapUnconfirmed
    }

    pub(crate) async fn stop_agent_run_until_with_outcome(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        deadline: Instant,
    ) -> FleetReleaseOutcome {
        let key = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        let persisted_reap = self
            .owner_records
            .as_ref()
            .is_some_and(|records| records.confirmed_stop(&key));
        let plan = {
            let Ok(_operation) = timeout_at(deadline, self.operations.lock()).await else {
                return FleetReleaseOutcome::ReapUnconfirmed;
            };
            let mut state = self.state.lock().await;
            let Some(id) = state.process_by_run.get(&key).cloned() else {
                return if state.reaped_leases.contains(&key) || persisted_reap {
                    FleetReleaseOutcome::Reaped
                } else {
                    FleetReleaseOutcome::NoMatchingLease
                };
            };
            if let Some(entry) = state.processes.get_mut(&id) {
                entry.retire_after_run = true;
            }
            state.plan_stop(&id)
        };
        let stopped = timeout_at(deadline, self.dispatch_stop_plan(plan).wait())
            .await
            .unwrap_or(false);
        self.stop_outcome(&key, stopped).await
    }

    pub(crate) async fn invalidate_camp(&self, camp_id: &str) {
        self.invalidate_matching(|entry| entry.compatibility.belongs_to_camp(camp_id))
            .await;
    }

    /// Installs the process-local projection of the durable Camp deletion
    /// marker and immediately starts retiring every matching Host. This call
    /// never waits for external process shutdown; the coordinator verifies
    /// reaping before it advances to database deletion.
    pub(crate) async fn mark_camp_deleting(&self, camp_id: &str) {
        self.install_camp_deletion_cutover(camp_id, || Ok(((), true)))
            .await
            .expect("infallible Camp deletion Fleet projection failed");
    }

    /// Serializes the durable database cutover with Runtime acquire/Starting
    /// commit. The closure commits authority while the Fleet admission gate is
    /// held; an accepted outcome installs the process-local tombstone before
    /// that gate is released.
    pub(crate) async fn install_camp_deletion_cutover<T>(
        &self,
        camp_id: &str,
        cutover: impl FnOnce() -> Result<(T, bool)>,
    ) -> Result<T> {
        let operation = self.operations.lock().await;
        let (value, accepted) = cutover()?;
        let plans = if accepted {
            let mut state = self.state.lock().await;
            state.deleting_camps.insert(camp_id.to_string());
            let process_ids = state
                .processes
                .iter()
                .filter(|(_, entry)| entry.compatibility.belongs_to_camp(camp_id))
                .map(|(process_id, _)| process_id.clone())
                .collect::<Vec<_>>();
            process_ids
                .into_iter()
                .map(|process_id| state.plan_stop(&process_id))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        drop(operation);
        for plan in plans {
            let _ = self.dispatch_stop_plan(plan);
        }
        Ok(value)
    }

    pub(crate) async fn fence_camp_for_attachment_mutation(&self, camp_id: &str) -> Result<()> {
        let plans = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            let mut process_ids = Vec::new();
            for (process_id, entry) in &state.processes {
                if !entry.compatibility.belongs_to_camp(camp_id) {
                    continue;
                }
                if !matches!(
                    entry.state,
                    FleetProcessState::IdleWarm | FleetProcessState::Stopping
                ) {
                    bail!("camp_attachment_view_busy: Camp Runtime Host is not reliably quiescent");
                }
                process_ids.push(process_id.clone());
            }
            process_ids
                .into_iter()
                .map(|process_id| state.plan_stop(&process_id))
                .collect::<Vec<_>>()
        };
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        for wait in waits {
            if !wait.wait().await {
                bail!("camp_attachment_view_busy: Camp Runtime Host could not be fenced");
            }
        }
        let retained = self
            .state
            .lock()
            .await
            .processes
            .values()
            .any(|entry| entry.compatibility.belongs_to_camp(camp_id));
        if retained {
            bail!("camp_attachment_view_busy: Camp Runtime Host remains resident");
        }
        Ok(())
    }

    pub(crate) async fn force_fence_camp_for_deletion(&self, camp_id: &str) -> Result<()> {
        let plans = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            state.deleting_camps.insert(camp_id.to_string());
            let process_ids = state
                .processes
                .iter()
                .filter(|(_, entry)| entry.compatibility.belongs_to_camp(camp_id))
                .map(|(process_id, _)| process_id.clone())
                .collect::<Vec<_>>();
            process_ids
                .into_iter()
                .map(|process_id| state.plan_stop(&process_id))
                .collect::<Vec<_>>()
        };
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        let deadline = Instant::now() + self.config.stop_timeout;
        for wait in waits {
            if !timeout_at(deadline, wait.wait()).await.unwrap_or(false) {
                bail!("camp_attachment_view_busy: Camp Runtime startup could not be fenced");
            }
        }
        if self
            .state
            .lock()
            .await
            .processes
            .values()
            .any(|entry| entry.compatibility.belongs_to_camp(camp_id))
        {
            bail!("camp_attachment_view_busy: Camp Runtime Host remains resident");
        }
        Ok(())
    }

    pub(crate) async fn invalidate_member(&self, agent_id: &str) {
        self.invalidate_matching(|entry| entry.compatibility.belongs_to_member(agent_id))
            .await;
    }

    /// Release native Session locks held by an obsolete configuration before
    /// a resumable Runtime starts its replacement Host in the same reuse scope.
    /// Active leases retain their normal retirement boundary.
    pub(crate) async fn retire_incompatible_hosts(
        &self,
        adapter_kind: AdapterKind,
        compatibility: &RuntimeCompatibilityKey,
    ) -> Result<()> {
        let (plans, retirements) = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            let matches = state
                .processes
                .iter()
                .filter(|(_, entry)| {
                    entry.adapter_kind == adapter_kind
                        && entry.compatibility.reuse_scope == compatibility.reuse_scope
                        && entry.compatibility.runtime_compatibility_digest
                            != compatibility.runtime_compatibility_digest
                })
                .map(|(process_id, entry)| (process_id.clone(), entry.state))
                .collect::<Vec<_>>();
            let mut plans = Vec::new();
            let mut retirements = Vec::new();
            for (process_id, process_state) in matches {
                if matches!(
                    process_state,
                    FleetProcessState::IdleWarm
                        | FleetProcessState::Stopping
                        | FleetProcessState::Starting
                ) {
                    plans.push(state.plan_stop(&process_id));
                } else if let Some(entry) = state.processes.get_mut(&process_id) {
                    entry.retire_after_run = true;
                    let retirement = entry
                        .retirement
                        .get_or_insert_with(|| Arc::new(FleetStopCompletion::new()))
                        .clone();
                    retirements.push(retirement);
                }
            }
            (plans, retirements)
        };
        for plan in plans {
            if !self.dispatch_stop_plan(plan).wait().await {
                bail!("Runtime Host could not release its native Session lock");
            }
        }
        for retirement in retirements {
            if !retirement.wait().await {
                bail!("Runtime Host could not release its native Session lock");
            }
        }
        Ok(())
    }

    pub(crate) async fn invalidate_adapter(&self, adapter_kind: AdapterKind) {
        self.invalidate_matching(|entry| entry.adapter_kind == adapter_kind)
            .await;
    }

    async fn invalidate_matching(&self, predicate: impl Fn(&ProcessEntry) -> bool) {
        let plans = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            let matches = state
                .processes
                .iter()
                .filter(|(_, entry)| predicate(entry))
                .map(|(process_id, entry)| (process_id.clone(), entry.state))
                .collect::<Vec<_>>();
            let mut plans = Vec::new();
            for (process_id, process_state) in matches {
                if matches!(
                    process_state,
                    FleetProcessState::IdleWarm
                        | FleetProcessState::Stopping
                        | FleetProcessState::Starting
                ) {
                    plans.push(state.plan_stop(&process_id));
                } else if let Some(entry) = state.processes.get_mut(&process_id) {
                    entry.retire_after_run = true;
                }
            }
            plans
        };
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        for wait in waits {
            let _ = wait.wait().await;
        }
    }

    pub(crate) async fn sweep_idle(&self) {
        let now = Instant::now();
        let plans = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            let process_ids = state
                .processes
                .iter()
                .filter_map(|(process_id, entry)| {
                    ((entry.state == FleetProcessState::IdleWarm
                        && (entry.idle_since.is_some_and(|idle_since| {
                            now.duration_since(idle_since) >= self.config.idle_ttl
                                && !entry
                                    .host
                                    .as_ref()
                                    .is_some_and(RuntimeProcessHost::has_zcode_background_tasks)
                        }) || entry.host.as_ref().is_none_or(|host| !host.is_healthy())
                            || entry.retire_after_run))
                        || entry.state == FleetProcessState::Stopping)
                        .then_some(process_id.clone())
                })
                .collect::<Vec<_>>();
            process_ids
                .into_iter()
                .map(|process_id| state.plan_stop(&process_id))
                .collect::<Vec<_>>()
        };
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        for wait in waits {
            let _ = wait.wait().await;
        }
    }

    /// Stops every process owned by this Fleet without allowing per-process
    /// grace periods to accumulate serially. `deadline` is absolute and also
    /// includes the final owner-record force-kill pass.
    pub(crate) async fn shutdown_all_until(
        &self,
        deadline: Instant,
    ) -> RuntimeFleetShutdownOutcome {
        let started_at = Instant::now();
        let remaining = deadline.saturating_duration_since(started_at);
        let force_kill_reserve = std::cmp::min(Duration::from_millis(250), remaining / 4);
        let graceful_deadline = deadline
            .checked_sub(force_kill_reserve)
            .unwrap_or(started_at);
        let mut deadline_expired = false;

        let (observed_ids, plans) = match timeout_at(graceful_deadline, async {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            state.shutdown_started = true;
            let observed_ids = state.processes.keys().cloned().collect::<Vec<_>>();
            let plans = observed_ids
                .iter()
                .map(|process_id| state.plan_stop(process_id))
                .collect::<Vec<_>>();
            (observed_ids, plans)
        })
        .await
        {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let observed_processes = self
                    .owner_records
                    .as_ref()
                    .map_or(0, |records| records.current_generation_records().len());
                let force_kill_signals_sent = self
                    .owner_records
                    .as_ref()
                    .map_or(0, RuntimeOwnerRecordStore::force_kill_current_generation);
                return RuntimeFleetShutdownOutcome {
                    observed_processes,
                    reaped_processes: 0,
                    force_kill_signals_sent,
                    deadline_expired: true,
                };
            }
        };
        let observed_processes = observed_ids.len();
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        let mut wait_tasks = JoinSet::new();
        for wait in waits {
            wait_tasks.spawn(wait.wait());
        }
        if timeout_at(graceful_deadline, async {
            while let Some(result) = wait_tasks.join_next().await {
                if !matches!(result, Ok(true)) {
                    deadline_expired = true;
                }
            }
        })
        .await
        .is_err()
        {
            deadline_expired = true;
            wait_tasks.abort_all();
        }
        drop(wait_tasks);
        let reaped_processes = {
            let state = self.state.lock().await;
            observed_ids
                .iter()
                .filter(|process_id| !state.processes.contains_key(*process_id))
                .count()
        };
        let unresolved_processes = observed_processes.saturating_sub(reaped_processes);
        let force_kill_signals_sent = if unresolved_processes == 0 && !deadline_expired {
            0
        } else {
            self.owner_records
                .as_ref()
                .map_or(0, RuntimeOwnerRecordStore::force_kill_current_generation)
        };
        deadline_expired |= Instant::now() >= deadline;

        RuntimeFleetShutdownOutcome {
            observed_processes,
            reaped_processes,
            force_kill_signals_sent,
            deadline_expired,
        }
    }

    pub(crate) async fn shutdown_all(&self) {
        let plans = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            state.shutdown_started = true;
            let process_ids = state.processes.keys().cloned().collect::<Vec<_>>();
            process_ids
                .into_iter()
                .map(|process_id| state.plan_stop(&process_id))
                .collect::<Vec<_>>()
        };
        let waits = plans
            .into_iter()
            .map(|plan| self.dispatch_stop_plan(plan))
            .collect::<Vec<_>>();
        let deadline = Instant::now() + self.config.stop_timeout;
        for wait in waits {
            let _ = timeout_at(deadline, wait.wait()).await;
        }
    }

    pub(crate) async fn run_idle_sweeper(self: Arc<Self>, mut shutdown: oneshot::Receiver<()>) {
        let mut interval = tokio::time::interval(self.config.sweep_interval);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            tokio::select! {
                _ = interval.tick() => self.sweep_idle().await,
                _ = &mut shutdown => break,
            }
        }
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    fn test_config(stop_timeout: Duration) -> AgentRuntimeFleetConfig {
        AgentRuntimeFleetConfig {
            stop_timeout,
            ..AgentRuntimeFleetConfig::default()
        }
    }

    fn fake_host(process_id: &str) -> RuntimeProcessHost {
        fake_runtime_process_host(process_id)
    }

    fn acquire_request(run: &str, camp: &str) -> FleetAcquireRequest {
        FleetAcquireRequest {
            agent_run_id: run.to_string(),
            execution_epoch: 1,
            adapter_kind: AdapterKind::TraeCnCli,
            compatibility: RuntimeCompatibilityKey::member(camp, "agent-1", "digest-1"),
        }
    }

    async fn insert_fake_process(
        fleet: &AgentRuntimeFleetManager,
        process_id: &str,
        shutdown_delay: Duration,
    ) -> Arc<FakeRuntimeProcessHost> {
        let run_lease = RunLeaseKey {
            agent_run_id: format!("run-{process_id}"),
            execution_epoch: 1,
        };
        let host = Arc::new(FakeRuntimeProcessHost {
            process_id: process_id.to_string(),
            shutdown_delay,
            reap_gate: None,
            reaped: std::sync::atomic::AtomicBool::new(false),
            shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
            zcode_background: AtomicBool::new(false),
        });
        let mut state = fleet.state.lock().await;
        state
            .process_by_run
            .insert(run_lease.clone(), process_id.to_string());
        state.processes.insert(
            process_id.to_string(),
            ProcessEntry {
                process_id: process_id.to_string(),
                adapter_kind: AdapterKind::CodexCli,
                compatibility: RuntimeCompatibilityKey::member(
                    "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
                    "agent-1",
                    "digest-1",
                ),
                state: FleetProcessState::BusyBurst,
                residency: FleetResidency::Burst,
                host: Some(RuntimeProcessHost::Fake(host.clone())),
                startup: None,
                stop: None,
                run_lease: Some(run_lease),
                idle_since: None,
                last_used_sequence: 0,
                retire_after_run: false,
                retirement: None,
            },
        );
        host
    }

    #[test]
    fn default_limits_match_the_runtime_fleet_contract() {
        let config = AgentRuntimeFleetConfig::default();
        assert_eq!(config.max_resident_processes_per_member, 20);
        assert_eq!(config.max_resident_processes_global, 200);
        assert_eq!(config.idle_ttl, Duration::from_secs(30 * 60));
        assert_eq!(config.sweep_interval, Duration::from_secs(60));
    }

    #[tokio::test]
    async fn different_runs_spawn_outside_the_global_fleet_lock() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(tokio::sync::Semaphore::new(0));
        let release = Arc::new(tokio::sync::Semaphore::new(0));

        let first = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("parallel-a", "camp-a"),
                        move || async move {
                            started.add_permits(1);
                            release.acquire().await.unwrap().forget();
                            Ok(fake_host("parallel-host-a"))
                        },
                    )
                    .await
            })
        };
        let second = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            tokio::spawn(async move {
                let mut request = acquire_request("parallel-b", "camp-b");
                request.adapter_kind = AdapterKind::CodexCli;
                fleet
                    .acquire(request, move || async move {
                        started.add_permits(1);
                        release.acquire().await.unwrap().forget();
                        Ok(fake_host("parallel-host-b"))
                    })
                    .await
            })
        };

        tokio::time::timeout(Duration::from_secs(1), started.acquire_many(2))
            .await
            .expect("both independent spawns must enter before either completes")
            .unwrap()
            .forget();
        release.add_permits(2);
        assert_eq!(
            first.await.unwrap().unwrap().host.process_id(),
            "parallel-host-a"
        );
        assert_eq!(
            second.await.unwrap().unwrap().host.process_id(),
            "parallel-host-b"
        );
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn starting_reservation_counts_toward_resident_capacity() {
        let mut config = test_config(Duration::from_secs(1));
        config.max_resident_processes_global = 1;
        config.max_resident_processes_per_member = 1;
        let fleet = Arc::new(AgentRuntimeFleetManager::new(config));
        let started = Arc::new(tokio::sync::Semaphore::new(0));
        let release = Arc::new(tokio::sync::Semaphore::new(0));

        let first = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("capacity-a", "camp-a"),
                        move || async move {
                            started.add_permits(1);
                            release.acquire().await.unwrap().forget();
                            Ok(fake_host("capacity-host-a"))
                        },
                    )
                    .await
            })
        };
        started.acquire().await.unwrap().forget();
        let second = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("capacity-b", "camp-a"),
                        move || async move {
                            started.add_permits(1);
                            release.acquire().await.unwrap().forget();
                            Ok(fake_host("capacity-host-b"))
                        },
                    )
                    .await
            })
        };
        tokio::time::timeout(Duration::from_secs(1), started.acquire())
            .await
            .expect("the burst spawn must not wait for the resident startup")
            .unwrap()
            .forget();
        release.add_permits(2);

        assert_eq!(
            first.await.unwrap().unwrap().residency,
            FleetResidency::Resident
        );
        assert_eq!(
            second.await.unwrap().unwrap().residency,
            FleetResidency::Burst
        );
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn same_run_waits_for_one_starting_reservation_and_shares_its_lease() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let spawn_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let request = acquire_request("singleflight", "camp-a");

        let first = {
            let fleet = fleet.clone();
            let spawn_count = spawn_count.clone();
            let started = started.clone();
            let release = release.clone();
            let request = request.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, move || async move {
                        spawn_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        started.notify_one();
                        release.notified().await;
                        Ok(fake_host("singleflight-host"))
                    })
                    .await
            })
        };
        started.notified().await;
        let second = {
            let fleet = fleet.clone();
            let spawn_count = spawn_count.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, move || async move {
                        spawn_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(fake_host("duplicate-host"))
                    })
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert_eq!(spawn_count.load(std::sync::atomic::Ordering::SeqCst), 1);
        release.notify_one();

        let first = first.await.unwrap().unwrap();
        let second = second.await.unwrap().unwrap();
        assert_eq!(first.process_id, second.process_id);
        assert_eq!(first.host.process_id(), "singleflight-host");
        assert_eq!(second.host.process_id(), "singleflight-host");
        assert_eq!(spawn_count.load(std::sync::atomic::Ordering::SeqCst), 1);
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn dropping_the_first_waiter_does_not_orphan_the_fleet_owned_startup() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(tokio::sync::Semaphore::new(0));
        let finish = Arc::new(tokio::sync::Semaphore::new(0));
        let spawn_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let request = acquire_request("detached-waiter", "camp-a");
        let first = {
            let fleet = fleet.clone();
            let started = started.clone();
            let finish = finish.clone();
            let spawn_count = spawn_count.clone();
            let request = request.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, move || async move {
                        spawn_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        started.add_permits(1);
                        finish.acquire().await.unwrap().forget();
                        Ok(fake_host("detached-waiter-host"))
                    })
                    .await
            })
        };
        started.acquire().await.unwrap().forget();
        first.abort();
        match first.await {
            Err(error) => assert!(error.is_cancelled()),
            Ok(_) => panic!("the first acquire waiter should have been cancelled"),
        }

        let second = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, || async {
                        panic!("the surviving waiter must share the existing startup")
                    })
                    .await
            })
        };
        finish.add_permits(1);
        let lease = tokio::time::timeout(Duration::from_secs(1), second)
            .await
            .expect("Fleet-owned startup must reach a terminal state")
            .unwrap()
            .unwrap();
        assert_eq!(lease.host.process_id(), "detached-waiter-host");
        assert_eq!(spawn_count.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(
            fleet
                .state
                .lock()
                .await
                .processes
                .values()
                .all(|entry| entry.state != FleetProcessState::Starting)
        );
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn a_slow_stop_does_not_block_an_unrelated_acquire() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        insert_fake_process(&fleet, "slow-stop", Duration::from_millis(300)).await;
        let stop = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .stop_agent_run_until(
                        "run-slow-stop",
                        1,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await
            })
        };
        loop {
            if fleet.state.lock().await.processes["slow-stop"].state == FleetProcessState::Stopping
            {
                break;
            }
            tokio::task::yield_now().await;
        }

        let unrelated = tokio::time::timeout(
            Duration::from_millis(100),
            fleet.acquire(acquire_request("unrelated", "camp-b"), || async {
                Ok(fake_host("unrelated-host"))
            }),
        )
        .await
        .expect("slow process I/O must not hold the Fleet operations lock")
        .unwrap();
        assert_eq!(unrelated.host.process_id(), "unrelated-host");
        assert!(stop.await.unwrap());
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn concurrent_stops_share_one_host_stop_operation() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let host = insert_fake_process(&fleet, "shared-stop", Duration::from_millis(100)).await;
        let first = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .stop_agent_run_until(
                        "run-shared-stop",
                        1,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await
            })
        };
        loop {
            if fleet.state.lock().await.processes["shared-stop"].state
                == FleetProcessState::Stopping
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        let second = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .stop_agent_run_until(
                        "run-shared-stop",
                        1,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await
            })
        };
        assert!(first.await.unwrap());
        assert!(second.await.unwrap());
        assert_eq!(
            host.shutdown_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[tokio::test]
    async fn same_run_waiter_observes_the_starting_reservation_failure() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let request = acquire_request("singleflight-failure", "camp-a");
        let first = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            let request = request.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, move || async move {
                        started.notify_one();
                        release.notified().await;
                        anyhow::bail!("controlled startup failure")
                    })
                    .await
            })
        };
        started.notified().await;
        let second = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(request, || async {
                        panic!("same Run must not execute a second spawn")
                    })
                    .await
            })
        };
        release.notify_one();
        let first = first
            .await
            .unwrap()
            .err()
            .expect("creator must observe the startup failure")
            .to_string();
        let second = second
            .await
            .unwrap()
            .err()
            .expect("waiter must observe the startup failure")
            .to_string();
        assert_eq!(first, "controlled startup failure");
        assert_eq!(second, first);
        assert!(fleet.state.lock().await.processes.is_empty());
    }

    #[tokio::test]
    async fn shutdown_retires_an_inflight_start_before_it_can_commit() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let spawned_host = Arc::new(FakeRuntimeProcessHost {
            process_id: "shutdown-starting-host".to_string(),
            shutdown_delay: Duration::ZERO,
            reap_gate: None,
            reaped: std::sync::atomic::AtomicBool::new(false),
            shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
            zcode_background: AtomicBool::new(false),
        });
        let acquire = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            let spawned_host = spawned_host.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("shutdown-starting", "camp-a"),
                        move || async move {
                            started.notify_one();
                            release.notified().await;
                            Ok(RuntimeProcessHost::Fake(spawned_host))
                        },
                    )
                    .await
            })
        };
        started.notified().await;
        let shutdown = {
            let fleet = fleet.clone();
            tokio::spawn(async move { fleet.shutdown_all().await })
        };
        loop {
            if fleet.state.lock().await.shutdown_started {
                break;
            }
            tokio::task::yield_now().await;
        }
        release.notify_one();

        let error = acquire
            .await
            .unwrap()
            .err()
            .expect("shutdown must invalidate the starting reservation")
            .to_string();
        assert!(error.contains("cancelled"));
        shutdown.await.unwrap();
        assert!(
            spawned_host
                .reaped
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert!(fleet.state.lock().await.processes.is_empty());
        let rejected = fleet
            .acquire(acquire_request("after-shutdown", "camp-a"), || async {
                panic!("Fleet shutdown must reject new spawn work")
            })
            .await
            .err()
            .expect("Fleet must remain closed after shutdown")
            .to_string();
        assert_eq!(rejected, "Runtime Fleet is shutting down");
    }

    #[tokio::test]
    async fn force_stop_waits_for_an_inflight_start_to_reap() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let spawned_host = Arc::new(FakeRuntimeProcessHost {
            process_id: "force-stop-starting-host".to_string(),
            shutdown_delay: Duration::ZERO,
            reap_gate: None,
            reaped: std::sync::atomic::AtomicBool::new(false),
            shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
            zcode_background: AtomicBool::new(false),
        });
        let acquire = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            let spawned_host = spawned_host.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("force-stop-starting", "camp-a"),
                        move || async move {
                            started.notify_one();
                            release.notified().await;
                            Ok(RuntimeProcessHost::Fake(spawned_host))
                        },
                    )
                    .await
            })
        };
        started.notified().await;
        let stop = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .stop_agent_run_until(
                        "force-stop-starting",
                        1,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await
            })
        };
        loop {
            if fleet
                .state
                .lock()
                .await
                .processes
                .values()
                .any(|entry| entry.retire_after_run)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        release.notify_one();

        assert!(stop.await.unwrap());
        assert!(acquire.await.unwrap().is_err());
        assert!(
            spawned_host
                .reaped
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert!(fleet.state.lock().await.processes.is_empty());
    }

    #[tokio::test]
    async fn forced_camp_deletion_waits_for_an_inflight_start_to_reap() {
        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_secs(1),
        )));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let spawned_host = Arc::new(FakeRuntimeProcessHost {
            process_id: "delete-starting-host".to_string(),
            shutdown_delay: Duration::ZERO,
            reap_gate: None,
            reaped: std::sync::atomic::AtomicBool::new(false),
            shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
            zcode_background: AtomicBool::new(false),
        });
        let acquire = {
            let fleet = fleet.clone();
            let started = started.clone();
            let release = release.clone();
            let spawned_host = spawned_host.clone();
            tokio::spawn(async move {
                fleet
                    .acquire(
                        acquire_request("delete-starting", "camp-a"),
                        move || async move {
                            started.notify_one();
                            release.notified().await;
                            Ok(RuntimeProcessHost::Fake(spawned_host))
                        },
                    )
                    .await
            })
        };
        started.notified().await;
        let deletion_fence = {
            let fleet = fleet.clone();
            tokio::spawn(async move { fleet.force_fence_camp_for_deletion("camp-a").await })
        };
        loop {
            if fleet
                .state
                .lock()
                .await
                .processes
                .values()
                .any(|entry| entry.retire_after_run)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        release.notify_one();

        deletion_fence.await.unwrap().unwrap();
        assert!(acquire.await.unwrap().is_err());
        assert!(
            spawned_host
                .reaped
                .load(std::sync::atomic::Ordering::Acquire)
        );
        assert!(fleet.state.lock().await.processes.is_empty());
    }

    #[tokio::test]
    async fn accepted_deletion_cutover_blocks_every_later_acquire() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        let value = fleet
            .install_camp_deletion_cutover("camp-a", || Ok(("accepted", true)))
            .await
            .unwrap();
        assert_eq!(value, "accepted");

        let result = fleet
            .acquire(acquire_request("after-delete", "camp-a"), || async {
                panic!("a deleting Camp must be rejected before Runtime spawn")
            })
            .await;
        let error = match result {
            Ok(_) => panic!("a deleting Camp unexpectedly acquired a Runtime"),
            Err(error) => error.to_string(),
        };
        assert_eq!(error, "Camp deletion is in progress");
    }

    #[tokio::test]
    async fn deletion_acceptance_never_waits_for_any_fleet_process_state() {
        struct Case {
            label: &'static str,
            process_state: Option<FleetProcessState>,
            has_host: bool,
            has_stop_completion: bool,
        }

        let cases = [
            Case {
                label: "no-host",
                process_state: None,
                has_host: false,
                has_stop_completion: false,
            },
            Case {
                label: "warm",
                process_state: Some(FleetProcessState::IdleWarm),
                has_host: true,
                has_stop_completion: false,
            },
            Case {
                label: "starting",
                process_state: Some(FleetProcessState::Starting),
                has_host: false,
                has_stop_completion: false,
            },
            Case {
                label: "running-resident",
                process_state: Some(FleetProcessState::BusyResident),
                has_host: true,
                has_stop_completion: false,
            },
            Case {
                label: "running-burst",
                process_state: Some(FleetProcessState::BusyBurst),
                has_host: true,
                has_stop_completion: false,
            },
            Case {
                label: "stopping",
                process_state: Some(FleetProcessState::Stopping),
                has_host: true,
                has_stop_completion: true,
            },
            Case {
                label: "inconsistent-hostless-entry",
                process_state: Some(FleetProcessState::BusyResident),
                has_host: false,
                has_stop_completion: false,
            },
        ];

        for case in cases {
            let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(5)));
            let startup = (case.process_state == Some(FleetProcessState::Starting))
                .then(|| Arc::new(FleetStartupOperation::new()));
            let stop = case
                .has_stop_completion
                .then(|| Arc::new(FleetStopCompletion::new()));

            if let Some(process_state) = case.process_state {
                let process_id = format!("delete-{}", case.label);
                let host = case.has_host.then(|| {
                    RuntimeProcessHost::Fake(Arc::new(FakeRuntimeProcessHost {
                        process_id: process_id.clone(),
                        shutdown_delay: Duration::from_secs(2),
                        reap_gate: None,
                        reaped: std::sync::atomic::AtomicBool::new(false),
                        shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
                        zcode_background: AtomicBool::new(false),
                    }))
                });
                let residency = if process_state == FleetProcessState::BusyBurst {
                    FleetResidency::Burst
                } else {
                    FleetResidency::Resident
                };
                let mut state = fleet.state.lock().await;
                state.insert_process(ProcessEntry {
                    process_id: process_id.clone(),
                    adapter_kind: AdapterKind::CodexCli,
                    compatibility: RuntimeCompatibilityKey::member(
                        "camp-matrix",
                        "agent-1",
                        "digest-1",
                    ),
                    state: process_state,
                    residency,
                    host,
                    startup: startup.clone(),
                    stop: stop.clone(),
                    run_lease: None,
                    idle_since: (process_state == FleetProcessState::IdleWarm).then(Instant::now),
                    last_used_sequence: 1,
                    retire_after_run: false,
                    retirement: None,
                });
                if process_state == FleetProcessState::IdleWarm {
                    state.idle_lru.insert((1, process_id));
                }
            }

            let accepted = tokio::time::timeout(
                Duration::from_millis(250),
                fleet.install_camp_deletion_cutover("camp-matrix", || Ok((case.label, true))),
            )
            .await
            .unwrap_or_else(|_| {
                panic!(
                    "{} deletion acceptance waited for Runtime shutdown",
                    case.label
                )
            })
            .unwrap();
            assert_eq!(accepted, case.label);

            let state = fleet.state.lock().await;
            assert!(state.deleting_camps.contains("camp-matrix"));
            if case.process_state == Some(FleetProcessState::Starting) {
                assert!(startup.as_ref().unwrap().is_cancelled());
                assert!(state.processes.values().all(|entry| entry.retire_after_run));
            }
        }
    }

    #[tokio::test]
    async fn rejected_deletion_cutover_does_not_install_a_tombstone() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        fleet
            .install_camp_deletion_cutover("camp-a", || Ok(((), false)))
            .await
            .unwrap();

        let lease = fleet
            .acquire(acquire_request("after-rejection", "camp-a"), || async {
                Ok(fake_host("after-rejection-host"))
            })
            .await
            .unwrap();
        assert_eq!(lease.host.process_id(), "after-rejection-host");
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn warm_hosts_never_cross_camp_compatibility_keys() {
        for camp_scope in [false, true] {
            let request = |run: &str, camp: &str, agent: &str| {
                let mut request = acquire_request(run, camp);
                request.adapter_kind = AdapterKind::DeepseekHarness;
                if camp_scope {
                    request.compatibility = RuntimeCompatibilityKey::camp(camp, agent, "digest-1");
                }
                request
            };
            let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
                Duration::from_secs(1),
            )));
            let camp_a = fleet
                .acquire(request("run-a1", "camp-a", "agent-a"), || async {
                    Ok(fake_host("host-a"))
                })
                .await
                .unwrap();
            assert_eq!(camp_a.host.process_id(), "host-a");
            fleet
                .release("run-a1", 1, FleetReleaseDisposition::Reusable)
                .await;

            let camp_b = fleet
                .acquire(request("run-b1", "camp-b", "agent-b"), || async {
                    Ok(fake_host("host-b"))
                })
                .await
                .unwrap();
            assert_eq!(camp_b.host.process_id(), "host-b");
            fleet
                .release("run-b1", 1, FleetReleaseDisposition::Reusable)
                .await;

            let camp_a_again = fleet
                .acquire(request("run-a2", "camp-a", "agent-c"), || async {
                    Ok(fake_host("unexpected-host"))
                })
                .await
                .unwrap();
            assert_eq!(camp_a_again.host.process_id(), "host-a");
            fleet
                .release("run-a2", 1, FleetReleaseDisposition::Reusable)
                .await;
            let mut changed = request("run-a3", "camp-a", "agent-c");
            fleet
                .retire_incompatible_hosts(changed.adapter_kind, &changed.compatibility)
                .await
                .unwrap();
            assert!(camp_a.host.is_healthy());
            changed.compatibility.runtime_compatibility_digest = "digest-2".to_string();
            fleet
                .retire_incompatible_hosts(changed.adapter_kind, &changed.compatibility)
                .await
                .unwrap();
            assert!(
                !camp_a.host.is_healthy(),
                "obsolete idle Host must release native Session locks"
            );
            assert!(
                camp_b.host.is_healthy(),
                "another Camp must retain its Host"
            );
            let busy = fleet
                .acquire(changed.clone(), || async {
                    Ok(fake_host("host-a-replacement"))
                })
                .await
                .unwrap();
            let mut next = changed.clone();
            next.compatibility.runtime_compatibility_digest = "digest-3".to_string();
            let retirement = {
                let fleet = fleet.clone();
                tokio::spawn(async move {
                    fleet
                        .retire_incompatible_hosts(next.adapter_kind, &next.compatibility)
                        .await
                })
            };
            loop {
                let retirement_is_waiting_for_release =
                    fleet.state.lock().await.processes.values().any(|entry| {
                        entry.adapter_kind == AdapterKind::DeepseekHarness
                            && entry.compatibility.runtime_compatibility_digest == "digest-2"
                            && entry.retire_after_run
                            && entry.retirement.is_some()
                    });
                if retirement_is_waiting_for_release {
                    break;
                }
                tokio::task::yield_now().await;
            }
            assert!(
                !retirement.is_finished(),
                "replacement must wait while the old Host is executing"
            );
            assert!(busy.host.is_healthy());
            assert!(
                fleet
                    .release("run-a3", 1, FleetReleaseDisposition::Reusable)
                    .await
            );
            retirement.await.unwrap().unwrap();
            assert!(
                !busy.host.is_healthy(),
                "replacement may proceed only after the old Host releases its Session lock"
            );
            fleet.shutdown_all().await;
        }

        let fleet = Arc::new(AgentRuntimeFleetManager::new(test_config(
            Duration::from_millis(5),
        )));
        let mut active = acquire_request("run-lock-timeout", "camp-lock-timeout");
        active.adapter_kind = AdapterKind::DeepseekHarness;
        let slow_host = Arc::new(FakeRuntimeProcessHost {
            process_id: "host-lock-timeout".to_string(),
            shutdown_delay: Duration::from_millis(100),
            reap_gate: None,
            reaped: std::sync::atomic::AtomicBool::new(false),
            shutdown_calls: std::sync::atomic::AtomicUsize::new(0),
            zcode_background: AtomicBool::new(false),
        });
        fleet
            .acquire(active.clone(), {
                let slow_host = slow_host.clone();
                move || async move { Ok(RuntimeProcessHost::Fake(slow_host)) }
            })
            .await
            .unwrap();
        let mut replacement = active;
        replacement.compatibility.runtime_compatibility_digest = "digest-2".to_string();
        let retirement = {
            let fleet = fleet.clone();
            tokio::spawn(async move {
                fleet
                    .retire_incompatible_hosts(replacement.adapter_kind, &replacement.compatibility)
                    .await
            })
        };
        loop {
            let waiting = fleet.state.lock().await.processes.values().any(|entry| {
                entry.adapter_kind == AdapterKind::DeepseekHarness
                    && entry.retire_after_run
                    && entry.retirement.is_some()
            });
            if waiting {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            !fleet
                .release("run-lock-timeout", 1, FleetReleaseDisposition::Reusable)
                .await,
            "a failed Host stop must not be reported as lock release"
        );
        assert_eq!(
            retirement
                .await
                .unwrap()
                .expect_err("replacement must fail when the native lock cannot be released")
                .to_string(),
            "Runtime Host could not release its native Session lock"
        );
        assert!(!slow_host.reaped.load(std::sync::atomic::Ordering::Acquire));
    }

    // Unique Fleet boundary: a foreground-free Host can retain native work.
    // Fake lifetime state is sufficient; real descendant cleanup has a Node owner.
    #[tokio::test]
    async fn zcode_background_pins_member_and_prevents_idle_and_capacity_eviction() {
        for capacity in [1, 2] {
            let mut config = test_config(Duration::from_secs(1));
            config.idle_ttl = Duration::ZERO;
            config.max_resident_processes_global = capacity;
            config.max_resident_processes_per_member = capacity;
            let fleet = AgentRuntimeFleetManager::new(config);
            let request = |run: &str, member: &str| FleetAcquireRequest {
                agent_run_id: run.to_string(),
                execution_epoch: 1,
                adapter_kind: AdapterKind::ZcodeApp,
                compatibility: RuntimeCompatibilityKey::camp("camp", member, "digest"),
            };
            let host = fake_host("background-host");
            let RuntimeProcessHost::Fake(fake) = &host else {
                unreachable!()
            };
            let fake = fake.clone();
            fake.zcode_background.store(true, Ordering::Release);
            fleet
                .acquire(request("a1", "a"), move || async move { Ok(host) })
                .await
                .unwrap();
            assert!(
                fleet
                    .release("a1", 1, FleetReleaseDisposition::Reusable)
                    .await
            );
            fleet.sweep_idle().await;
            assert!(!fake.reaped.load(Ordering::Acquire));
            let other = fleet
                .acquire(request("b1", "b"), || async {
                    Ok(fake_host("other-member"))
                })
                .await
                .unwrap();
            assert_eq!(
                other.residency,
                if capacity == 1 {
                    FleetResidency::Burst
                } else {
                    FleetResidency::Resident
                }
            );
            assert_eq!(other.host.process_id(), "other-member");
            let original = fleet
                .acquire(request("a2", "a"), || async {
                    panic!("original Host must remain available")
                })
                .await
                .unwrap();
            assert_eq!(original.host.process_id(), "background-host");
            fleet
                .release("b1", 1, FleetReleaseDisposition::Reusable)
                .await;
            fleet
                .release("a2", 1, FleetReleaseDisposition::Reusable)
                .await;
            let again = fleet
                .acquire(request("a3", "a"), || async {
                    panic!("background owner must take precedence over an older free Host")
                })
                .await
                .unwrap();
            assert_eq!(again.host.process_id(), "background-host");
            fleet
                .release("a3", 1, FleetReleaseDisposition::Reusable)
                .await;
            fleet.sweep_idle().await;
            assert!(!fake.reaped.load(Ordering::Acquire));
            fake.zcode_background.store(false, Ordering::Release);
            let shared = fleet
                .acquire(request("b2", "b"), || async {
                    panic!("completed jobs restore Camp reuse")
                })
                .await
                .unwrap();
            assert_eq!(shared.host.process_id(), "background-host");
            fleet
                .release("b2", 1, FleetReleaseDisposition::Reusable)
                .await;
            fleet.sweep_idle().await;
            assert!(fake.reaped.load(Ordering::Acquire));
        }
    }

    #[tokio::test]
    async fn workspace_hosts_reuse_across_camps_and_track_the_current_invalidation_scope() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        let request = |run: &str, camp: &str, agent: &str, workspace: &str| FleetAcquireRequest {
            agent_run_id: run.to_string(),
            execution_epoch: 1,
            adapter_kind: AdapterKind::Pi,
            compatibility: RuntimeCompatibilityKey::workspace(
                camp,
                agent,
                workspace,
                "pi-digest-1",
            ),
        };
        let first = fleet
            .acquire(
                request("run-a", "camp-a", "agent-a", "workspace-a"),
                || async { Ok(fake_host("pi-host-a")) },
            )
            .await
            .unwrap();
        assert_eq!(first.host.process_id(), "pi-host-a");
        fleet
            .release("run-a", 1, FleetReleaseDisposition::Reusable)
            .await;

        let second = fleet
            .acquire(
                request("run-b", "camp-b", "agent-b", "workspace-a"),
                || async { Ok(fake_host("unexpected-pi-host")) },
            )
            .await
            .unwrap();
        assert_eq!(second.host.process_id(), "pi-host-a");
        fleet
            .release("run-b", 1, FleetReleaseDisposition::Reusable)
            .await;

        let other_workspace = fleet
            .acquire(
                request("run-other", "camp-other", "agent-other", "workspace-b"),
                || async { Ok(fake_host("pi-host-b")) },
            )
            .await
            .unwrap();
        assert_eq!(other_workspace.host.process_id(), "pi-host-b");
        fleet
            .release("run-other", 1, FleetReleaseDisposition::Reusable)
            .await;

        fleet.invalidate_camp("camp-a").await;
        let second_again = fleet
            .acquire(
                request("run-b2", "camp-b", "agent-b", "workspace-a"),
                || async { Ok(fake_host("unexpected-pi-host-2")) },
            )
            .await
            .unwrap();
        assert_eq!(second_again.host.process_id(), "pi-host-a");
        fleet
            .release("run-b2", 1, FleetReleaseDisposition::Reusable)
            .await;

        fleet.invalidate_member("agent-b").await;
        let third = fleet
            .acquire(
                request("run-c", "camp-c", "agent-c", "workspace-a"),
                || async { Ok(fake_host("pi-host-c")) },
            )
            .await
            .unwrap();
        assert_eq!(third.host.process_id(), "pi-host-c");
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn failure_retirement_cannot_be_reversed_by_late_success_or_touch_a_successor() {
        let fleet = AgentRuntimeFleetManager::new(Default::default());
        let request = |run| {
            let mut request = acquire_request(run, "camp");
            request.adapter_kind = AdapterKind::CodexCli;
            request
        };
        fleet
            .acquire(request("failed"), || async { Ok(fake_host("host-a")) })
            .await
            .unwrap();
        assert!(!fleet.retire_agent_run_on_host("failed", 0, "host-a").await);
        assert!(
            !fleet
                .retire_agent_run_on_host("failed", 1, "other-host")
                .await
        );
        assert!(fleet.retire_agent_run_on_host("failed", 1, "host-a").await);
        assert_eq!(
            fleet
                .release_with_outcome("failed", 1, FleetReleaseDisposition::Reusable)
                .await,
            FleetReleaseOutcome::Reaped
        );
        let next = fleet
            .acquire(request("next"), || async { Ok(fake_host("host-b")) })
            .await
            .unwrap();
        assert_eq!(next.host.process_id(), "host-b");
        assert!(!fleet.retire_agent_run_on_host("failed", 1, "host-a").await);
        assert_eq!(
            fleet
                .release_with_outcome("failed", 1, FleetReleaseDisposition::Stop)
                .await,
            FleetReleaseOutcome::Reaped
        );
        assert!(next.host.is_healthy());
        fleet.shutdown_all().await;
    }

    #[tokio::test]
    async fn cancelled_run_retains_its_lease_until_a_confirmed_reap() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        insert_fake_process(&fleet, "cancelled", Duration::from_millis(50)).await;
        let key = RunLeaseKey {
            agent_run_id: "run-cancelled".into(),
            execution_epoch: 1,
        };
        for _ in 0..2 {
            assert_eq!(
                fleet
                    .stop_agent_run_until_with_outcome(
                        &key.agent_run_id,
                        1,
                        Instant::now() + Duration::from_millis(5)
                    )
                    .await,
                FleetReleaseOutcome::ReapUnconfirmed
            );
            let state = fleet.state.lock().await;
            assert_eq!(
                state.process_by_run.get(&key).map(String::as_str),
                Some("cancelled")
            );
            assert_eq!(
                state.processes["cancelled"].state,
                FleetProcessState::Stopping
            );
        }
        let mut successor =
            acquire_request("blocked-successor", "rvcamp_01h47kvsy5fk1shh6w1g60eecf");
        successor.adapter_kind = AdapterKind::CodexCli;
        assert!(
            fleet
                .acquire(successor, || async {
                    panic!("must not start before the old Host is reaped")
                })
                .await
                .is_err()
        );
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(
                    &key.agent_run_id,
                    1,
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            FleetReleaseOutcome::Reaped
        );
        assert!(fleet.state.lock().await.processes.is_empty());
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(&key.agent_run_id, 1, Instant::now())
                .await,
            FleetReleaseOutcome::Reaped
        );
        fleet.acknowledge_cleanup(&key.agent_run_id, 1).await;
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(
                    &key.agent_run_id,
                    1,
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            FleetReleaseOutcome::NoMatchingLease
        );
    }

    #[tokio::test]
    async fn deadline_shutdown_stops_hosts_concurrently_instead_of_accumulating_timeouts() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(2)));
        for process_id in ["process-1", "process-2", "process-3", "process-4"] {
            insert_fake_process(&fleet, process_id, Duration::from_millis(150)).await;
        }

        let started_at = Instant::now();
        let outcome = fleet
            .shutdown_all_until(started_at + Duration::from_millis(400))
            .await;

        assert_eq!(outcome.observed_processes, 4);
        assert_eq!(outcome.reaped_processes, 4);
        assert_eq!(outcome.force_kill_signals_sent, 0);
        assert!(!outcome.deadline_expired);
        assert!(outcome.all_reaped());
        assert!(started_at.elapsed() < Duration::from_millis(350));
        assert!(fleet.state.lock().await.processes.is_empty());
    }

    #[tokio::test]
    async fn deadline_shutdown_aborts_unreaped_stops_without_waiting_past_the_bound() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(5)));
        insert_fake_process(&fleet, "process-1", Duration::from_secs(2)).await;
        insert_fake_process(&fleet, "process-2", Duration::from_secs(2)).await;

        let started_at = Instant::now();
        let outcome = fleet
            .shutdown_all_until(started_at + Duration::from_millis(120))
            .await;

        assert_eq!(outcome.observed_processes, 2);
        assert_eq!(outcome.reaped_processes, 0);
        assert_eq!(outcome.force_kill_signals_sent, 0);
        assert!(outcome.deadline_expired);
        assert!(!outcome.all_reaped());
        assert!(started_at.elapsed() < Duration::from_millis(200));
        assert!(
            fleet
                .state
                .lock()
                .await
                .processes
                .values()
                .all(|entry| entry.state == FleetProcessState::Stopping)
        );
    }

    #[tokio::test]
    async fn scoped_cleanup_receipt_survives_restart_until_durable_ack() {
        let root =
            std::env::temp_dir().join(format!("rovai-stop-receipt-{}", uuid::Uuid::new_v4()));
        crate::platform::prepare_private_directory(&root).unwrap();
        let store = RuntimeOwnerRecordStore::new(&root).unwrap();
        let key = RunLeaseKey {
            agent_run_id: "old-run".into(),
            execution_epoch: 7,
        };
        let record = RuntimeOwnerRecord {
            run_lease: Some(key.clone()),
            reaped: true,
            core_generation: "old-core".into(),
            pid: u32::MAX,
            process_group_id: -1,
            executable_path: "fixture".into(),
            process_start_identity: None,
            windows_job_name: None,
        };
        crate::platform::atomic_write_private_bytes(
            &store.record_path("old-host"),
            &serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        let fleet = AgentRuntimeFleetManager::with_owner_records(
            Default::default(),
            Some(store.clone()),
            Arc::new(BuiltinToolLeaseRegistry::default()),
        );
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(
                    "old-run",
                    6,
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            FleetReleaseOutcome::NoMatchingLease
        );
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(
                    "old-run",
                    7,
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            FleetReleaseOutcome::Reaped
        );
        assert!(store.record_path("old-host").exists());
        fleet.acknowledge_cleanup("old-run", 7).await;
        assert!(!store.record_path("old-host").exists());
        assert_eq!(
            fleet
                .stop_agent_run_until_with_outcome(
                    "old-run",
                    7,
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            FleetReleaseOutcome::NoMatchingLease
        );

        #[cfg(windows)]
        {
            use crate::managed_process::{
                ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose,
                ManagedStdinPolicy, ManagedWindowsArgvDialect,
            };
            // Reuse the native Managed Process helper rather than cmd.exe,
            // whose command-line grammar is not the Microsoft CRT dialect.
            let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "managed_process::tests::windows_owned_runtime_helper",
                    "--ignored",
                ])
                .env_remove("ROVAI_MANAGED_PROCESS_HELPER_MODE")
                .current_dir(&root);
            let spec = ManagedProcessLaunchSpec::capture(
                &command,
                ManagedProcessPurpose::RuntimeHost,
                ManagedStdinPolicy::Null,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                "runtime-owner:receipt-test",
            )
            .unwrap();
            let mut child = ManagedProcess::spawn(spec).unwrap();
            let mut crashed_record = record.clone();
            crashed_record.reaped = false;
            // Deliberately use a live unrelated PID: only the persisted launch's
            // Job can prove cleanup, independently of PID reuse.
            crashed_record.pid = std::process::id();
            crashed_record.process_start_identity =
                owner_process_start_identity(child.id().unwrap());
            crashed_record.windows_job_name = Some(child.windows_job_name().to_owned());
            let path = store.record_path("crashed-host");
            crate::platform::atomic_write_private_bytes(
                &path,
                &serde_json::to_vec(&crashed_record).unwrap(),
            )
            .unwrap();
            assert!(
                tokio::time::timeout(Duration::from_secs(5), child.wait())
                    .await
                    .unwrap()
                    .unwrap()
                    .success()
            );
            // Even an observable empty Job is not a cross-Core exit receipt.
            assert!(child.tree_is_empty().unwrap());
            let handshake = root.join("live.pid");
            let mut live_command = tokio::process::Command::new(std::env::current_exe().unwrap());
            live_command
                .args([
                    "--exact",
                    "managed_process::tests::windows_owned_runtime_helper",
                    "--ignored",
                ])
                .env("ROVAI_MANAGED_PROCESS_HELPER_MODE", "owned-runtime")
                .env("ROVAI_MANAGED_PROCESS_HELPER_FILE", &handshake)
                .current_dir(&root);
            let live_spec = ManagedProcessLaunchSpec::capture(
                &live_command,
                ManagedProcessPurpose::RuntimeHost,
                ManagedStdinPolicy::Piped,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                "runtime-owner:live-receipt-test",
            )
            .unwrap();
            let mut live_child = ManagedProcess::spawn(live_spec).unwrap();
            tokio::time::timeout(Duration::from_secs(5), async {
                while std::fs::read_to_string(&handshake)
                    .ok()
                    .and_then(|pid| pid.trim().parse::<u32>().ok())
                    != live_child.id()
                {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("native helper did not enter its live state");
            let mut live_record = crashed_record.clone();
            live_record.windows_job_name = Some(live_child.windows_job_name().to_owned());
            let live_path = store.record_path("live-host");
            crate::platform::atomic_write_private_bytes(
                &live_path,
                &serde_json::to_vec(&live_record).unwrap(),
            )
            .unwrap();
            let restarted = AgentRuntimeFleetManager::new_with_builtin_tools(
                Default::default(),
                &root,
                Arc::new(BuiltinToolLeaseRegistry::default()),
            )
            .unwrap();
            assert_eq!(
                restarted
                    .stop_agent_run_until_with_outcome(
                        "old-run",
                        7,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await,
                FleetReleaseOutcome::NoMatchingLease
            );
            assert!(
                !serde_json::from_slice::<RuntimeOwnerRecord>(&std::fs::read(&live_path).unwrap())
                    .unwrap()
                    .reaped
            );
            assert!(
                !serde_json::from_slice::<RuntimeOwnerRecord>(&std::fs::read(&path).unwrap())
                    .unwrap()
                    .reaped
            );
            // Only the owner that confirms its current Job is empty persists this.
            store.finish_stop("crashed-host");
            live_child.force_terminate_tree().unwrap();
            tokio::time::timeout(Duration::from_secs(5), live_child.wait())
                .await
                .unwrap()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(5), async {
                while !live_child.tree_is_empty().unwrap() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("native Job did not finish descendant cleanup");
            store.finish_stop("live-host");
            assert_eq!(
                restarted
                    .stop_agent_run_until_with_outcome(
                        "old-run",
                        6,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await,
                FleetReleaseOutcome::NoMatchingLease
            );
            assert_eq!(
                restarted
                    .stop_agent_run_until_with_outcome(
                        "old-run",
                        7,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await,
                FleetReleaseOutcome::Reaped
            );
            assert!(path.exists());
            let retained: RuntimeOwnerRecord =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert!(retained.reaped);
            drop(child);
            drop(live_child);
            // Durable positive evidence remains valid after the Job disappears.
            assert_eq!(
                restarted
                    .stop_agent_run_until_with_outcome(
                        "old-run",
                        7,
                        Instant::now() + Duration::from_secs(1),
                    )
                    .await,
                FleetReleaseOutcome::Reaped
            );
            restarted.acknowledge_cleanup("old-run", 6).await;
            assert!(path.exists());
            restarted.acknowledge_cleanup("old-run", 7).await;
            assert!(!path.exists());
            assert!(!live_path.exists());

            // The real Job above is now gone. Neither a live root, an absent
            // PID, nor PID reuse can replace the missing tree-exit evidence.
            // These cases used to falsely grant Reaped for the last two rows.
            for (pid, start_identity) in [
                (
                    std::process::id(),
                    owner_process_start_identity(std::process::id()),
                ),
                (u32::MAX, None),
                (std::process::id(), crashed_record.process_start_identity),
            ] {
                crashed_record.pid = pid;
                crashed_record.process_start_identity = start_identity;
                crate::platform::atomic_write_private_bytes(
                    &path,
                    &serde_json::to_vec(&crashed_record).unwrap(),
                )
                .unwrap();
                let restarted = AgentRuntimeFleetManager::new_with_builtin_tools(
                    Default::default(),
                    &root,
                    Arc::new(BuiltinToolLeaseRegistry::default()),
                )
                .unwrap();
                assert_eq!(
                    restarted
                        .stop_agent_run_until_with_outcome(
                            "old-run",
                            7,
                            Instant::now() + Duration::from_secs(1)
                        )
                        .await,
                    FleetReleaseOutcome::NoMatchingLease
                );
                assert!(
                    !serde_json::from_slice::<RuntimeOwnerRecord>(&std::fs::read(&path).unwrap())
                        .unwrap()
                        .reaped,
                    "Job name absence must retain the scoped cleanup obligation"
                );
                assert!(path.exists());
                store.remove("crashed-host");
            }

            // Old anonymous Jobs and invalid identities cannot prove a tree
            // empty. Absence of a root PID alone must never grant a receipt.
            for job_name in [None, Some("invalid-job".to_string())] {
                crashed_record.windows_job_name = job_name;
                crashed_record.pid = u32::MAX;
                crate::platform::atomic_write_private_bytes(
                    &path,
                    &serde_json::to_vec(&crashed_record).unwrap(),
                )
                .unwrap();
                assert_eq!(
                    restarted
                        .stop_agent_run_until_with_outcome(
                            "old-run",
                            7,
                            Instant::now() + Duration::from_secs(1),
                        )
                        .await,
                    FleetReleaseOutcome::NoMatchingLease
                );
                assert!(
                    !serde_json::from_slice::<RuntimeOwnerRecord>(&std::fs::read(&path).unwrap())
                        .unwrap()
                        .reaped
                );
                store.remove("crashed-host");
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_owner_registration_admits_only_private_or_legacy_inherited_storage() {
        use std::os::windows::process::CommandExt;
        let icacls = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("icacls.exe");
        // This owner covers the private-storage migration seam. The receipt
        // owner above covers lifecycle/ACK; lower-level ACL tests cannot prove
        // that Fleet prepares every parent and preserves legacy scoped records.
        for legacy in [false, true] {
            let root =
                std::env::temp_dir().join(format!("rovai-owner-storage-{}", uuid::Uuid::new_v4()));
            crate::platform::prepare_private_directory(&root).unwrap();
            let fleet_root = root.join("runtime-fleet");
            let owners = fleet_root.join("owners");
            let key = RunLeaseKey {
                agent_run_id: "old-run".into(),
                execution_epoch: 7,
            };
            if legacy {
                // Elevated Windows runners can default ordinary child ownership
                // to Administrators. This migration admits only current-user
                // ownership: establish that explicitly, then reset only DACLs
                // to the private parent's inherited policy.
                crate::platform::prepare_private_directory(&fleet_root).unwrap();
                crate::platform::prepare_private_directory(&owners).unwrap();
                crate::platform::atomic_write_private_bytes(
                    &owners.join("legacy.json"),
                    &serde_json::to_vec(&RuntimeOwnerRecord {
                        run_lease: Some(key.clone()),
                        reaped: true,
                        core_generation: "old-core".into(),
                        pid: u32::MAX,
                        process_group_id: 0,
                        executable_path: "fixture".into(),
                        process_start_identity: None,
                        windows_job_name: None,
                    })
                    .unwrap(),
                )
                .unwrap();
                let reset = std::process::Command::new(&icacls)
                    .arg(&fleet_root)
                    .args(["/reset", "/T", "/Q"])
                    .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
                    .output()
                    .unwrap();
                assert!(
                    reset.status.success(),
                    "failed to establish inherited-ACL fixture"
                );
                assert!(crate::platform::prepare_private_directory(&owners).is_err());
            }
            let store = RuntimeOwnerRecordStore::new(&root).unwrap();
            store
                .register(
                    "new-host",
                    &fake_host("new-host"),
                    Some(RunLeaseKey {
                        agent_run_id: "new-run".into(),
                        execution_epoch: 8,
                    }),
                )
                .unwrap();
            crate::platform::prepare_private_directory(&root.join("runtime-fleet")).unwrap();
            crate::platform::prepare_private_directory(&owners).unwrap();
            crate::platform::open_private_read_file(&store.record_path("new-host")).unwrap();
            if legacy {
                assert!(store.confirmed_stop(&key));
                assert!(store.record_path("legacy").exists());
                store.acknowledge_cleanup(&key);
                assert!(!store.record_path("legacy").exists());
            }
            std::fs::remove_dir_all(root).unwrap();
        }
        // A broader ACL under the private Core root is not a legacy managed
        // child and must not be rewritten or silently ignored. Grant Everyone
        // explicitly so this case does not depend on the machine's TEMP ACL.
        let root =
            std::env::temp_dir().join(format!("rovai-owner-untrusted-{}", uuid::Uuid::new_v4()));
        crate::platform::prepare_private_directory(&root).unwrap();
        let destination = root.join("runtime-fleet");
        crate::platform::prepare_private_directory(&destination).unwrap();
        let grant = std::process::Command::new(icacls)
            .arg(&destination)
            .args(["/grant", "*S-1-1-0:(OI)(CI)F", "/Q"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(
            grant.status.success(),
            "failed to establish the explicit broad-ACL fixture"
        );
        assert!(RuntimeOwnerRecordStore::new(&root).is_err());
        assert!(crate::platform::prepare_private_directory(&destination).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn force_kill_targets_only_current_generation_and_preserves_unreaped_records() {
        use std::os::unix::process::CommandExt;
        use std::process::Command;

        let root = std::env::temp_dir().join(format!(
            "rovai-runtime-owner-force-kill-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let store = RuntimeOwnerRecordStore {
            root: root.clone(),
            core_generation: "current-generation".to_string(),
        };

        let spawn_group = || {
            let mut command = Command::new("/bin/sleep");
            command.arg("60").process_group(0);
            command.spawn().unwrap()
        };
        let mut current = spawn_group();
        let mut foreign = spawn_group();
        let mut mismatched = spawn_group();
        let current_pid = current.id();
        let foreign_pid = foreign.id();
        let mismatched_pid = mismatched.id();
        let current_executable = "/bin/sleep".to_string();
        let foreign_executable = "/bin/sleep".to_string();
        let current_record_path = store.record_path("current-process");
        let foreign_record_path = store.record_path("foreign-process");
        let mismatched_record_path = store.record_path("mismatched-process");
        std::fs::write(
            &current_record_path,
            serde_json::to_vec(&RuntimeOwnerRecord {
                run_lease: None,
                reaped: false,
                core_generation: store.core_generation.clone(),
                pid: current_pid,
                process_group_id: unsafe { libc::getpgid(current_pid as i32) },
                executable_path: current_executable,
                process_start_identity: owner_process_start_identity(current_pid),
                windows_job_name: None,
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            &foreign_record_path,
            serde_json::to_vec(&RuntimeOwnerRecord {
                run_lease: None,
                reaped: false,
                core_generation: "another-generation".to_string(),
                pid: foreign_pid,
                process_group_id: unsafe { libc::getpgid(foreign_pid as i32) },
                executable_path: foreign_executable,
                process_start_identity: owner_process_start_identity(foreign_pid),
                windows_job_name: None,
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            &mismatched_record_path,
            serde_json::to_vec(&RuntimeOwnerRecord {
                run_lease: None,
                reaped: false,
                core_generation: store.core_generation.clone(),
                pid: mismatched_pid,
                process_group_id: unsafe { libc::getpgid(mismatched_pid as i32) },
                executable_path: "/bin/not-the-owned-runtime".to_string(),
                process_start_identity: owner_process_start_identity(mismatched_pid),
                windows_job_name: None,
            })
            .unwrap(),
        )
        .unwrap();

        let signalled = store.force_kill_current_generation();
        let current_exited = (0..100).any(|_| {
            if current.try_wait().unwrap().is_some() {
                true
            } else {
                std::thread::sleep(Duration::from_millis(10));
                false
            }
        });
        let foreign_survived = foreign.try_wait().unwrap().is_none();
        let mismatched_survived = mismatched.try_wait().unwrap().is_none();
        let records_preserved = current_record_path.is_file()
            && foreign_record_path.is_file()
            && mismatched_record_path.is_file();

        unsafe {
            if !current_exited {
                libc::killpg(current_pid as i32, libc::SIGKILL);
            }
            if foreign_survived {
                libc::killpg(foreign_pid as i32, libc::SIGKILL);
            }
            if mismatched_survived {
                libc::killpg(mismatched_pid as i32, libc::SIGKILL);
            }
        }
        let _ = current.wait();
        let _ = foreign.wait();
        let _ = mismatched.wait();
        let _ = std::fs::remove_dir_all(root);

        assert_eq!(signalled, 1);
        assert!(current_exited);
        assert!(foreign_survived);
        assert!(mismatched_survived);
        assert!(records_preserved);
    }
}
