use std::{
    collections::{BTreeSet, HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::agent_profile::AdapterKind;
use serde::{Deserialize, Serialize};
#[cfg(test)]
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
    #[cfg(test)]
    Fake(Arc<FakeRuntimeProcessHost>),
}

#[cfg(test)]
#[derive(Debug)]
pub(crate) struct FakeRuntimeProcessHost {
    process_id: String,
    shutdown_delay: Duration,
    reaped: std::sync::atomic::AtomicBool,
}

impl RuntimeProcessHost {
    fn process_id(&self) -> &str {
        match self {
            Self::Codex(host) => host.host_instance_id(),
            Self::Acp(host) => host.host_instance_id(),
            Self::Pi(host) => host.host_instance_id(),
            #[cfg(test)]
            Self::Fake(host) => &host.process_id,
        }
    }

    fn is_healthy(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_alive(),
            Self::Acp(host) => host.is_alive(),
            Self::Pi(host) => host.is_alive(),
            #[cfg(test)]
            Self::Fake(host) => !host.reaped.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    async fn is_quiescent(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_quiescent().await,
            Self::Acp(host) => host.is_quiescent().await,
            Self::Pi(host) => host.is_quiescent().await,
            #[cfg(test)]
            Self::Fake(host) => !host.reaped.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    async fn shutdown_and_reap(&self) {
        match self {
            Self::Codex(host) => host.shutdown_and_reap().await,
            Self::Acp(host) => host.shutdown_and_reap().await,
            Self::Pi(host) => host.shutdown_and_reap().await,
            #[cfg(test)]
            Self::Fake(host) => {
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
            #[cfg(test)]
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
            #[cfg(test)]
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
            #[cfg(test)]
            Self::Fake(_) => Path::new("fake-runtime"),
        }
    }

    fn builtin_tool_process_config(&self) -> Option<BuiltinToolProcessConfig> {
        match self {
            Self::Codex(host) => host.builtin_tool_process_config().cloned(),
            Self::Acp(host) => host.builtin_tool_process_config().cloned(),
            Self::Pi(host) => host.builtin_tool_process_config().cloned(),
            #[cfg(test)]
            Self::Fake(_) => None,
        }
    }

    pub(crate) fn into_codex(self) -> Result<Arc<CodexHost>> {
        match self {
            Self::Codex(host) => Ok(host),
            Self::Acp(_) => bail!("Fleet returned an ACP Host to the Codex Adapter"),
            Self::Pi(_) => bail!("Fleet returned a Pi Host to the Codex Adapter"),
            #[cfg(test)]
            Self::Fake(_) => bail!("Fleet returned a fake Host to the Codex Adapter"),
        }
    }

    pub(crate) fn into_acp(self) -> Result<Arc<AcpHost>> {
        match self {
            Self::Acp(host) => Ok(host),
            Self::Codex(_) => bail!("Fleet returned a Codex Host to an ACP Adapter"),
            Self::Pi(_) => bail!("Fleet returned a Pi Host to an ACP Adapter"),
            #[cfg(test)]
            Self::Fake(_) => bail!("Fleet returned a fake Host to the ACP Adapter"),
        }
    }

    pub(crate) fn into_pi(self) -> Result<Arc<PiHost>> {
        match self {
            Self::Pi(host) => Ok(host),
            Self::Codex(_) => bail!("Fleet returned a Codex Host to the Pi Adapter"),
            Self::Acp(_) => bail!("Fleet returned an ACP Host to the Pi Adapter"),
            #[cfg(test)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FleetProcessState {
    Starting,
    BusyResident,
    IdleWarm,
    Stopping,
    BusyBurst,
}

struct FleetStartupCompletion {
    outcome: tokio::sync::watch::Sender<Option<std::result::Result<FleetLease, String>>>,
}

impl FleetStartupCompletion {
    fn new() -> Self {
        let (outcome, _) = tokio::sync::watch::channel(None);
        Self { outcome }
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
}

enum FleetAcquirePlan {
    Ready(FleetLease),
    Wait(Arc<FleetStartupCompletion>),
    Blocked(String),
    Spawn {
        reservation_id: String,
        run_lease: RunLeaseKey,
        residency: FleetResidency,
        completion: Arc<FleetStartupCompletion>,
        eviction: Option<(String, RuntimeProcessHost)>,
    },
}

struct ProcessEntry {
    process_id: String,
    adapter_kind: AdapterKind,
    compatibility: RuntimeCompatibilityKey,
    state: FleetProcessState,
    residency: FleetResidency,
    host: Option<RuntimeProcessHost>,
    startup: Option<Arc<FleetStartupCompletion>>,
    run_lease: Option<RunLeaseKey>,
    idle_since: Option<Instant>,
    last_used_sequence: u64,
    retire_after_run: bool,
}

#[derive(Default)]
struct FleetState {
    shutdown_started: bool,
    processes: HashMap<String, ProcessEntry>,
    process_by_run: HashMap<RunLeaseKey, String>,
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
        Some(entry)
    }

    fn mark_stopping(&mut self, process_id: &str) -> Option<RuntimeProcessHost> {
        let entry = self.processes.get_mut(process_id)?;
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        // Preserve the lease until a confirmed reap. A timeout must not make
        // the next cleanup attempt mistake an owned process for an absent one.
        entry.idle_since = None;
        entry.state = FleetProcessState::Stopping;
        entry.host.clone()
    }

    fn reserve_idle_eviction(&mut self, process_id: &str) -> Option<RuntimeProcessHost> {
        let entry = self.processes.get_mut(process_id)?;
        if entry.state != FleetProcessState::IdleWarm {
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
        entry.host.clone()
    }

    fn oldest_idle_for_bucket(&self, residency_bucket: &str) -> Option<String> {
        self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && entry.compatibility.residency_bucket == residency_bucket
                })
                .map(|_| process_id.clone())
        })
    }

    fn oldest_idle_global(&self) -> Option<String> {
        self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| entry.state == FleetProcessState::IdleWarm)
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

        let compatible_idle = self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && entry.adapter_kind == request.adapter_kind
                        && entry
                            .compatibility
                            .is_process_compatible_with(&request.compatibility)
                        && entry
                            .host
                            .as_ref()
                            .is_some_and(RuntimeProcessHost::is_healthy)
                })
                .map(|_| process_id.clone())
        });
        if let Some(process_id) = compatible_idle {
            let (last_used_sequence, host) = {
                let entry = self
                    .processes
                    .get_mut(&process_id)
                    .expect("Fleet compatible idle process disappeared");
                let last_used_sequence = entry.last_used_sequence;
                entry.state = FleetProcessState::BusyResident;
                entry.run_lease = Some(run_lease.clone());
                entry.idle_since = None;
                entry.compatibility = request.compatibility.clone();
                (
                    last_used_sequence,
                    entry
                        .host
                        .clone()
                        .expect("Fleet compatible idle Host disappeared"),
                )
            };
            self.idle_lru
                .remove(&(last_used_sequence, process_id.clone()));
            self.process_by_run.insert(run_lease, process_id.clone());
            return FleetAcquirePlan::Ready(FleetLease {
                process_id,
                host,
                residency: FleetResidency::Resident,
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
                    && let Some(host) = self.reserve_idle_eviction(&process_id)
                {
                    eviction = Some((process_id, host));
                    FleetResidency::Resident
                } else {
                    FleetResidency::Burst
                }
            };

        let reservation_id = uuid::Uuid::new_v4().to_string();
        let completion = Arc::new(FleetStartupCompletion::new());
        let sequence = self.next_sequence();
        self.insert_process(ProcessEntry {
            process_id: reservation_id.clone(),
            adapter_kind: request.adapter_kind,
            compatibility: request.compatibility.clone(),
            state: FleetProcessState::Starting,
            residency,
            host: None,
            startup: Some(completion.clone()),
            run_lease: Some(run_lease.clone()),
            idle_since: None,
            last_used_sequence: sequence,
            retire_after_run: false,
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
    operations: Mutex<()>,
    state: Mutex<FleetState>,
    owner_records: Option<RuntimeOwnerRecordStore>,
    builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuntimeOwnerRecord {
    core_generation: String,
    pid: u32,
    process_group_id: i32,
    executable_path: String,
    #[serde(default)]
    process_start_identity: Option<u64>,
}

#[derive(Debug, Clone)]
struct RuntimeOwnerRecordStore {
    root: PathBuf,
    core_generation: String,
}

impl RuntimeOwnerRecordStore {
    fn new(data_dir: &Path) -> Option<Self> {
        let root = data_dir.join("runtime-fleet").join("owners");
        if std::fs::create_dir_all(&root).is_err() {
            eprintln!("failed to create Runtime Fleet owner record directory");
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
        }
        let store = Self {
            root,
            core_generation: uuid::Uuid::new_v4().to_string(),
        };
        store.cleanup_stale();
        Some(store)
    }

    fn record_path(&self, process_id: &str) -> PathBuf {
        self.root.join(format!("{process_id}.json"))
    }

    fn register(&self, process_id: &str, host: &RuntimeProcessHost) -> Result<()> {
        let record = RuntimeOwnerRecord {
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
        };
        std::fs::write(self.record_path(process_id), serde_json::to_vec(&record)?)?;
        Ok(())
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
            .filter_map(|entry| std::fs::read(entry.path()).ok())
            .filter_map(|bytes| serde_json::from_slice::<RuntimeOwnerRecord>(&bytes).ok())
            .filter(|record| record.core_generation == self.core_generation)
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
            let path = entry.path();
            let record = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<RuntimeOwnerRecord>(&bytes).ok());
            let mut remove_record = record.is_none();
            if let Some(_record) = record {
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
                #[cfg(not(unix))]
                {
                    remove_record = true;
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

#[cfg(not(unix))]
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
    #[cfg(test)]
    pub(crate) fn new(config: AgentRuntimeFleetConfig) -> Self {
        Self::with_owner_records(config, None, Arc::new(BuiltinToolLeaseRegistry::default()))
    }

    pub(crate) fn new_with_builtin_tools(
        config: AgentRuntimeFleetConfig,
        data_dir: &Path,
        builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
    ) -> Self {
        Self::with_owner_records(
            config,
            RuntimeOwnerRecordStore::new(data_dir),
            builtin_tool_leases,
        )
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
            operations: Mutex::new(()),
            state: Mutex::new(FleetState::default()),
            owner_records,
            builtin_tool_leases,
        }
    }

    pub(crate) async fn acquire<F, Fut>(
        &self,
        request: FleetAcquireRequest,
        spawn: F,
    ) -> Result<FleetLease>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<RuntimeProcessHost>>,
    {
        let plan = {
            let _operation = self.operations.lock().await;
            self.state.lock().await.plan_acquire(&self.config, &request)
        };
        let (reservation_id, run_lease, residency, completion, eviction) = match plan {
            FleetAcquirePlan::Ready(lease) => return Ok(lease),
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

        if let Some((process_id, host)) = eviction {
            self.stop_reserved_eviction(&process_id, &host).await;
        }

        let host = match spawn().await {
            Ok(host) if host.is_healthy() => host,
            Ok(host) => {
                host.shutdown_and_reap().await;
                let message = "Runtime process exited during startup".to_string();
                self.fail_start(&reservation_id, &completion, &message)
                    .await;
                bail!(message);
            }
            Err(error) => {
                let message = format!("{error:#}");
                self.fail_start(&reservation_id, &completion, &message)
                    .await;
                return Err(error);
            }
        };
        if let Some(owner_records) = &self.owner_records
            && let Err(error) = owner_records.register(host.process_id(), &host)
        {
            host.shutdown_and_reap().await;
            let error = error.context("failed to persist Runtime process owner record");
            let message = format!("{error:#}");
            self.fail_start(&reservation_id, &completion, &message)
                .await;
            return Err(error);
        }
        let commit = {
            let _operation = self.operations.lock().await;
            let mut state = self.state.lock().await;
            (|| {
                let entry = state
                    .processes
                    .get_mut(&reservation_id)
                    .context("Fleet startup reservation disappeared before commit")?;
                if entry.state != FleetProcessState::Starting
                    || entry.run_lease.as_ref() != Some(&run_lease)
                    || entry.retire_after_run
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
                completion.complete(Ok(lease.clone()));
                Ok(lease)
            }
            Err(error) => {
                host.shutdown_and_reap().await;
                if let Some(owner_records) = &self.owner_records {
                    owner_records.remove(host.process_id());
                }
                let message = format!("{error:#}");
                self.fail_start(&reservation_id, &completion, &message)
                    .await;
                Err(error)
            }
        }
    }

    async fn fail_start(
        &self,
        reservation_id: &str,
        completion: &FleetStartupCompletion,
        message: &str,
    ) {
        let _operation = self.operations.lock().await;
        self.state.lock().await.remove_process(reservation_id);
        completion.complete(Err(message.to_string()));
    }

    async fn stop_reserved_eviction(&self, process_id: &str, host: &RuntimeProcessHost) {
        if let Some(config) = host.builtin_tool_process_config() {
            self.builtin_tool_leases
                .unregister(config.process_id())
                .await;
        }
        if host
            .shutdown_and_reap_until(Instant::now() + self.config.stop_timeout)
            .await
        {
            self.state.lock().await.remove_process(process_id);
            if let Some(owner_records) = &self.owner_records {
                owner_records.remove(host.process_id());
            }
        }
    }

    pub(crate) async fn release(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        disposition: FleetReleaseDisposition,
    ) -> bool {
        let _operation = self.operations.lock().await;
        let run_lease = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        let process_id = {
            self.state
                .lock()
                .await
                .process_by_run
                .get(&run_lease)
                .cloned()
        };
        let Some(process_id) = process_id else {
            return true;
        };
        let (state_kind, retire_after_run, host) = {
            let mut state = self.state.lock().await;
            let Some(entry) = state.processes.get_mut(&process_id) else {
                return true;
            };
            if entry.state == FleetProcessState::Starting {
                entry.retire_after_run = true;
            }
            (entry.state, entry.retire_after_run, entry.host.clone())
        };
        if let Some(config) = host
            .as_ref()
            .and_then(RuntimeProcessHost::builtin_tool_process_config)
        {
            self.builtin_tool_leases
                .unbind(config.process_id(), agent_run_id, execution_epoch)
                .await;
        }
        let reusable = disposition == FleetReleaseDisposition::Reusable
            && state_kind == FleetProcessState::BusyResident
            && !retire_after_run
            && host.as_ref().is_some_and(RuntimeProcessHost::is_healthy)
            && match host.as_ref() {
                Some(host) => host.is_quiescent().await,
                None => false,
            };
        if reusable {
            let mut state = self.state.lock().await;
            let sequence = state.next_sequence();
            state.process_by_run.remove(&run_lease);
            let Some(entry) = state.processes.get_mut(&process_id) else {
                return true;
            };
            entry.run_lease = None;
            entry.state = FleetProcessState::IdleWarm;
            entry.idle_since = Some(Instant::now());
            entry.last_used_sequence = sequence;
            state.idle_lru.insert((sequence, process_id));
            true
        } else {
            self.stop_process_locked(&process_id).await
        }
    }

    /// Retire exactly this Run's lease. Never make a timed-out Host reusable.
    pub(crate) async fn stop_agent_run_until(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        deadline: Instant,
    ) -> bool {
        let key = RunLeaseKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        {
            let mut state = self.state.lock().await;
            if let Some(id) = state.process_by_run.get(&key).cloned()
                && let Some(entry) = state.processes.get_mut(&id)
            {
                entry.retire_after_run = true;
            }
        }
        let Ok(_operation) = timeout_at(deadline, self.operations.lock()).await else {
            return false;
        };
        let target = {
            let mut state = self.state.lock().await;
            let Some(id) = state.process_by_run.get(&key).cloned() else {
                return true;
            };
            let Some(host) = state.mark_stopping(&id) else {
                return false;
            };
            (id, host)
        };
        if let Some(config) = target.1.builtin_tool_process_config() {
            self.builtin_tool_leases
                .unregister(config.process_id())
                .await;
        }
        if !target.1.force_reap_until(deadline).await {
            return false;
        }
        self.state.lock().await.remove_process(&target.0);
        if let Some(records) = &self.owner_records {
            records.remove(target.1.process_id());
        }
        true
    }

    pub(crate) async fn invalidate_camp(&self, camp_id: &str) {
        self.invalidate_matching(|entry| entry.compatibility.belongs_to_camp(camp_id))
            .await;
    }

    pub(crate) async fn fence_camp_for_attachment_mutation(&self, camp_id: &str) -> Result<()> {
        let _operation = self.operations.lock().await;
        let process_ids = {
            let state = self.state.lock().await;
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
        };
        for process_id in process_ids {
            if !self.stop_process_locked(&process_id).await {
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
        let _operation = self.operations.lock().await;
        let process_ids = {
            let mut state = self.state.lock().await;
            state
                .processes
                .iter_mut()
                .filter_map(|(process_id, entry)| {
                    if !entry.compatibility.belongs_to_camp(camp_id) {
                        return None;
                    }
                    if entry.state == FleetProcessState::Starting {
                        entry.retire_after_run = true;
                    }
                    Some(process_id.clone())
                })
                .collect::<Vec<_>>()
        };
        for process_id in process_ids {
            if !self.stop_process_locked(&process_id).await {
                bail!("camp_attachment_view_busy: Camp Runtime Host could not be fenced");
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

    pub(crate) async fn invalidate_runtime_config(&self, agent_id: &str) {
        self.invalidate_member(agent_id).await;
    }

    pub(crate) async fn invalidate_adapter(&self, adapter_kind: AdapterKind) {
        self.invalidate_matching(|entry| entry.adapter_kind == adapter_kind)
            .await;
    }

    async fn invalidate_matching(&self, predicate: impl Fn(&ProcessEntry) -> bool) {
        let _operation = self.operations.lock().await;
        let (idle, busy) = {
            let state = self.state.lock().await;
            let mut idle = Vec::new();
            let mut busy = Vec::new();
            for (process_id, entry) in &state.processes {
                if predicate(entry) {
                    if entry.state == FleetProcessState::IdleWarm {
                        idle.push(process_id.clone());
                    } else if matches!(
                        entry.state,
                        FleetProcessState::BusyResident | FleetProcessState::Starting
                    ) {
                        busy.push(process_id.clone());
                    }
                }
            }
            (idle, busy)
        };
        {
            let mut state = self.state.lock().await;
            for process_id in busy {
                if let Some(entry) = state.processes.get_mut(&process_id) {
                    entry.retire_after_run = true;
                }
            }
        }
        for process_id in idle {
            self.stop_process_locked(&process_id).await;
        }
    }

    pub(crate) async fn sweep_idle(&self) {
        let _operation = self.operations.lock().await;
        self.reap_stale_idle_locked(Instant::now()).await;
    }

    async fn reap_stale_idle_locked(&self, now: Instant) {
        let process_ids = {
            let state = self.state.lock().await;
            state
                .processes
                .iter()
                .filter_map(|(process_id, entry)| {
                    ((entry.state == FleetProcessState::IdleWarm
                        && (entry.idle_since.is_some_and(|idle_since| {
                            now.duration_since(idle_since) >= self.config.idle_ttl
                        }) || entry.host.as_ref().is_none_or(|host| !host.is_healthy())
                            || entry.retire_after_run))
                        || entry.state == FleetProcessState::Stopping)
                        .then_some(process_id.clone())
                })
                .collect::<Vec<_>>()
        };
        for process_id in process_ids {
            self.stop_process_locked(&process_id).await;
        }
    }

    async fn stop_process_locked(&self, process_id: &str) -> bool {
        let host = self.state.lock().await.mark_stopping(process_id);
        let Some(host) = host else {
            return false;
        };
        if let Some(config) = host.builtin_tool_process_config() {
            self.builtin_tool_leases
                .unregister(config.process_id())
                .await;
        }
        if !host
            .shutdown_and_reap_until(Instant::now() + self.config.stop_timeout)
            .await
        {
            return false;
        }
        self.state.lock().await.remove_process(process_id);
        if let Some(owner_records) = &self.owner_records {
            owner_records.remove(host.process_id());
        }
        true
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

        let operation = match timeout_at(graceful_deadline, self.operations.lock()).await {
            Ok(operation) => operation,
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

        let (observed_processes, targets, starting) = match timeout_at(graceful_deadline, async {
            let mut state = self.state.lock().await;
            state.shutdown_started = true;
            let process_ids = state.processes.keys().cloned().collect::<Vec<_>>();
            let observed_processes = process_ids.len();
            let mut targets = Vec::new();
            let mut starting = Vec::new();
            for fleet_process_id in process_ids {
                let is_starting = state
                    .processes
                    .get(&fleet_process_id)
                    .is_some_and(|entry| entry.state == FleetProcessState::Starting);
                if is_starting {
                    if let Some(entry) = state.processes.get_mut(&fleet_process_id) {
                        entry.retire_after_run = true;
                        if let Some(completion) = entry.startup.clone() {
                            starting.push((fleet_process_id, completion));
                        }
                    }
                } else if let Some(host) = state.mark_stopping(&fleet_process_id) {
                    targets.push((fleet_process_id, host));
                }
            }
            (observed_processes, targets, starting)
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
        drop(operation);

        let mut lease_cleanup_tasks = JoinSet::new();
        let mut stop_tasks = JoinSet::new();
        let mut startup_tasks = JoinSet::new();
        for (reservation_id, completion) in starting {
            startup_tasks.spawn(async move {
                let stopped_without_committing = completion.wait().await.is_err();
                (reservation_id, stopped_without_committing)
            });
        }
        for (fleet_process_id, host) in targets {
            if let Some(config) = host.builtin_tool_process_config() {
                let leases = self.builtin_tool_leases.clone();
                lease_cleanup_tasks.spawn(async move {
                    leases.unregister(config.process_id()).await;
                });
            }
            let owner_process_id = host.process_id().to_string();
            let stop_timeout = self.config.stop_timeout;
            stop_tasks.spawn(async move {
                let host_deadline = std::cmp::min(
                    graceful_deadline,
                    Instant::now()
                        .checked_add(stop_timeout)
                        .unwrap_or(graceful_deadline),
                );
                let reaped = host.shutdown_and_reap_until(host_deadline).await;
                (fleet_process_id, owner_process_id, reaped, !reaped)
            });
        }

        let mut reaped = Vec::new();
        let stop_wait = timeout_at(graceful_deadline, async {
            while let Some(result) = stop_tasks.join_next().await {
                match result {
                    Ok((fleet_process_id, owner_process_id, true, timed_out)) => {
                        deadline_expired |= timed_out;
                        reaped.push((fleet_process_id, owner_process_id));
                    }
                    Ok((_, _, false, timed_out)) => deadline_expired |= timed_out,
                    Err(_) => deadline_expired = true,
                }
            }
        })
        .await;
        if stop_wait.is_err() {
            deadline_expired = true;
            stop_tasks.abort_all();
        }
        drop(stop_tasks);

        let mut reaped_startups = Vec::new();
        let startup_wait = timeout_at(graceful_deadline, async {
            while let Some(result) = startup_tasks.join_next().await {
                match result {
                    Ok((reservation_id, true)) => reaped_startups.push(reservation_id),
                    Ok((_, false)) | Err(_) => deadline_expired = true,
                }
            }
        })
        .await;
        if startup_wait.is_err() {
            deadline_expired = true;
            startup_tasks.abort_all();
        }
        drop(startup_tasks);

        let lease_cleanup = timeout_at(graceful_deadline, async {
            while lease_cleanup_tasks.join_next().await.is_some() {}
        })
        .await;
        if lease_cleanup.is_err() {
            deadline_expired = true;
            lease_cleanup_tasks.abort_all();
        }
        drop(lease_cleanup_tasks);

        for (_, owner_process_id) in &reaped {
            if let Some(owner_records) = &self.owner_records {
                owner_records.remove(owner_process_id);
            }
        }
        if timeout_at(graceful_deadline, async {
            let mut state = self.state.lock().await;
            for (fleet_process_id, _) in &reaped {
                state.remove_process(fleet_process_id);
            }
            for reservation_id in &reaped_startups {
                state.remove_process(reservation_id);
            }
        })
        .await
        .is_err()
        {
            deadline_expired = true;
        }

        let reaped_processes = reaped.len() + reaped_startups.len();
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
        let starting = {
            let _operation = self.operations.lock().await;
            let (process_ids, starting) = {
                let mut state = self.state.lock().await;
                state.shutdown_started = true;
                let mut process_ids = Vec::new();
                let mut starting = Vec::new();
                for (process_id, entry) in &mut state.processes {
                    if entry.state == FleetProcessState::Starting {
                        entry.retire_after_run = true;
                        if let Some(completion) = entry.startup.clone() {
                            starting.push(completion);
                        }
                    } else {
                        process_ids.push(process_id.clone());
                    }
                }
                (process_ids, starting)
            };
            for process_id in process_ids {
                self.stop_process_locked(&process_id).await;
            }
            starting
        };
        for completion in starting {
            let _ = timeout_at(Instant::now() + self.config.stop_timeout, completion.wait()).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(stop_timeout: Duration) -> AgentRuntimeFleetConfig {
        AgentRuntimeFleetConfig {
            stop_timeout,
            ..AgentRuntimeFleetConfig::default()
        }
    }

    fn fake_host(process_id: &str) -> RuntimeProcessHost {
        RuntimeProcessHost::Fake(Arc::new(FakeRuntimeProcessHost {
            process_id: process_id.to_string(),
            shutdown_delay: Duration::ZERO,
            reaped: std::sync::atomic::AtomicBool::new(false),
        }))
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
    ) {
        let run_lease = RunLeaseKey {
            agent_run_id: format!("run-{process_id}"),
            execution_epoch: 1,
        };
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
                host: Some(RuntimeProcessHost::Fake(Arc::new(FakeRuntimeProcessHost {
                    process_id: process_id.to_string(),
                    shutdown_delay,
                    reaped: std::sync::atomic::AtomicBool::new(false),
                }))),
                startup: None,
                run_lease: Some(run_lease),
                idle_since: None,
                last_used_sequence: 0,
                retire_after_run: false,
            },
        );
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
            reaped: std::sync::atomic::AtomicBool::new(false),
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
        assert!(error.contains("invalidated before commit"));
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
    async fn warm_hosts_never_cross_camp_compatibility_keys() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        let camp_a = fleet
            .acquire(acquire_request("run-a1", "camp-a"), || async {
                Ok(fake_host("host-a"))
            })
            .await
            .unwrap();
        assert_eq!(camp_a.host.process_id(), "host-a");
        fleet
            .release("run-a1", 1, FleetReleaseDisposition::Reusable)
            .await;

        let camp_b = fleet
            .acquire(acquire_request("run-b1", "camp-b"), || async {
                Ok(fake_host("host-b"))
            })
            .await
            .unwrap();
        assert_eq!(camp_b.host.process_id(), "host-b");
        fleet
            .release("run-b1", 1, FleetReleaseDisposition::Reusable)
            .await;

        let camp_a_again = fleet
            .acquire(acquire_request("run-a2", "camp-a"), || async {
                Ok(fake_host("unexpected-host"))
            })
            .await
            .unwrap();
        assert_eq!(camp_a_again.host.process_id(), "host-a");
        fleet.shutdown_all().await;
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
    async fn cancelled_run_retains_its_lease_until_a_confirmed_reap() {
        let fleet = AgentRuntimeFleetManager::new(test_config(Duration::from_secs(1)));
        insert_fake_process(&fleet, "cancelled", Duration::from_millis(50)).await;
        let key = RunLeaseKey {
            agent_run_id: "run-cancelled".into(),
            execution_epoch: 1,
        };
        for _ in 0..2 {
            assert!(
                !fleet
                    .stop_agent_run_until(
                        &key.agent_run_id,
                        1,
                        Instant::now() + Duration::from_millis(5)
                    )
                    .await
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
        assert!(
            fleet
                .stop_agent_run_until(
                    &key.agent_run_id,
                    1,
                    Instant::now() + Duration::from_secs(1)
                )
                .await
        );
        assert!(fleet.state.lock().await.processes.is_empty());
        assert!(
            fleet
                .stop_agent_run_until(&key.agent_run_id, 1, Instant::now())
                .await
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
                core_generation: store.core_generation.clone(),
                pid: current_pid,
                process_group_id: unsafe { libc::getpgid(current_pid as i32) },
                executable_path: current_executable,
                process_start_identity: owner_process_start_identity(current_pid),
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            &foreign_record_path,
            serde_json::to_vec(&RuntimeOwnerRecord {
                core_generation: "another-generation".to_string(),
                pid: foreign_pid,
                process_group_id: unsafe { libc::getpgid(foreign_pid as i32) },
                executable_path: foreign_executable,
                process_start_identity: owner_process_start_identity(foreign_pid),
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            &mismatched_record_path,
            serde_json::to_vec(&RuntimeOwnerRecord {
                core_generation: store.core_generation.clone(),
                pid: mismatched_pid,
                process_group_id: unsafe { libc::getpgid(mismatched_pid as i32) },
                executable_path: "/bin/not-the-owned-runtime".to_string(),
                process_start_identity: owner_process_start_identity(mismatched_pid),
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
