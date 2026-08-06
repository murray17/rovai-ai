use std::{
    collections::{BTreeSet, HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::agent_profile::AdapterKind;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{Mutex, oneshot},
    time::{Instant, MissedTickBehavior, timeout},
};

use crate::{
    acp::AcpHost,
    builtin_tool_runtime::{BuiltinToolLeaseRegistry, BuiltinToolProcessConfig},
    codex::CodexHost,
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
pub(crate) struct RuntimeCompatibilityKey {
    pub camp_id: String,
    pub agent_id: String,
    pub runtime_compatibility_digest: String,
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
}

impl RuntimeProcessHost {
    fn process_id(&self) -> &str {
        match self {
            Self::Codex(host) => host.host_instance_id(),
            Self::Acp(host) => host.host_instance_id(),
        }
    }

    fn is_healthy(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_alive(),
            Self::Acp(host) => host.is_alive(),
        }
    }

    async fn is_quiescent(&self) -> bool {
        match self {
            Self::Codex(host) => host.is_quiescent().await,
            Self::Acp(host) => host.is_quiescent().await,
        }
    }

    async fn shutdown_and_reap(&self) {
        match self {
            Self::Codex(host) => host.shutdown_and_reap().await,
            Self::Acp(host) => host.shutdown_and_reap().await,
        }
    }

    fn pid(&self) -> Option<u32> {
        match self {
            Self::Codex(host) => host.pid(),
            Self::Acp(host) => host.pid(),
        }
    }

    fn executable_path(&self) -> &Path {
        match self {
            Self::Codex(host) => host.executable_path(),
            Self::Acp(host) => host.executable_path(),
        }
    }

    fn builtin_tool_process_config(&self) -> Option<BuiltinToolProcessConfig> {
        match self {
            Self::Codex(host) => host.builtin_tool_process_config().cloned(),
            Self::Acp(host) => host.builtin_tool_process_config().cloned(),
        }
    }

    pub(crate) fn into_codex(self) -> Result<Arc<CodexHost>> {
        match self {
            Self::Codex(host) => Ok(host),
            Self::Acp(_) => bail!("Fleet returned an ACP Host to the Codex Adapter"),
        }
    }

    pub(crate) fn into_acp(self) -> Result<Arc<AcpHost>> {
        match self {
            Self::Acp(host) => Ok(host),
            Self::Codex(_) => bail!("Fleet returned a Codex Host to an ACP Adapter"),
        }
    }
}

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

impl FleetProcessState {
    fn is_resident(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::BusyResident | Self::IdleWarm | Self::Stopping
        )
    }
}

struct ProcessEntry {
    process_id: String,
    adapter_kind: AdapterKind,
    compatibility: RuntimeCompatibilityKey,
    state: FleetProcessState,
    host: Option<RuntimeProcessHost>,
    run_lease: Option<RunLeaseKey>,
    idle_since: Option<Instant>,
    last_used_sequence: u64,
    retire_after_run: bool,
}

#[derive(Default)]
struct FleetState {
    processes: HashMap<String, ProcessEntry>,
    process_by_run: HashMap<RunLeaseKey, String>,
    resident_processes: HashSet<String>,
    resident_processes_by_member: HashMap<String, HashSet<String>>,
    idle_lru: BTreeSet<(u64, String)>,
    next_sequence: u64,
}

impl FleetState {
    fn next_sequence(&mut self) -> u64 {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.next_sequence
    }

    fn resident_count_for_member(&self, agent_id: &str) -> usize {
        self.resident_processes_by_member
            .get(agent_id)
            .map_or(0, HashSet::len)
    }

    fn has_resident_capacity(&self, config: &AgentRuntimeFleetConfig, agent_id: &str) -> bool {
        self.resident_processes.len() < config.max_resident_processes_global
            && self.resident_count_for_member(agent_id) < config.max_resident_processes_per_member
    }

    fn insert_resident(&mut self, entry: ProcessEntry) {
        let process_id = entry.process_id.clone();
        let member_id = entry.compatibility.agent_id.clone();
        self.resident_processes.insert(process_id.clone());
        self.resident_processes_by_member
            .entry(member_id)
            .or_default()
            .insert(process_id.clone());
        self.processes.insert(process_id, entry);
    }

    fn remove_process(&mut self, process_id: &str) -> Option<ProcessEntry> {
        let entry = self.processes.remove(process_id)?;
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        if let Some(run_lease) = &entry.run_lease {
            self.process_by_run.remove(run_lease);
        }
        if entry.state.is_resident() {
            self.resident_processes.remove(process_id);
            let member_id = &entry.compatibility.agent_id;
            if let Some(processes) = self.resident_processes_by_member.get_mut(member_id) {
                processes.remove(process_id);
                if processes.is_empty() {
                    self.resident_processes_by_member.remove(member_id);
                }
            }
        }
        Some(entry)
    }

    fn mark_stopping(&mut self, process_id: &str) -> Option<RuntimeProcessHost> {
        let entry = self.processes.get_mut(process_id)?;
        self.idle_lru
            .remove(&(entry.last_used_sequence, process_id.to_string()));
        if let Some(run_lease) = entry.run_lease.take() {
            self.process_by_run.remove(&run_lease);
        }
        entry.idle_since = None;
        entry.state = FleetProcessState::Stopping;
        entry.host.clone()
    }

    fn oldest_idle_for_member(&self, agent_id: &str) -> Option<String> {
        self.idle_lru.iter().find_map(|(_, process_id)| {
            self.processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && entry.compatibility.agent_id == agent_id
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
        };
        std::fs::write(self.record_path(process_id), serde_json::to_vec(&record)?)?;
        Ok(())
    }

    fn remove(&self, process_id: &str) {
        let _ = std::fs::remove_file(self.record_path(process_id));
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
            if let Some(record) = record {
                #[cfg(unix)]
                if record.core_generation != self.core_generation
                    && record.pid > 1
                    && record.pid != std::process::id()
                    && unsafe { libc::getpgid(record.pid as i32) == record.process_group_id }
                    && owner_process_matches(record.pid, &record.executable_path)
                {
                    unsafe {
                        libc::killpg(record.pid as i32, libc::SIGKILL);
                    }
                    remove_record = true;
                }
                #[cfg(unix)]
                if unsafe { libc::getpgid(record.pid as i32) == -1 } {
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
    let expected = Path::new(executable_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(executable_path);
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .is_some_and(|command| command.contains(expected))
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
        let _operation = self.operations.lock().await;
        self.reap_stale_idle_locked(Instant::now()).await;

        let run_lease = request.run_lease();
        if let Some(lease) = self.existing_lease(&run_lease).await {
            return Ok(lease);
        }

        if let Some(lease) = self.acquire_compatible_idle(&request).await {
            return Ok(lease);
        }

        let mut residency = FleetResidency::Resident;
        let has_capacity = {
            self.state
                .lock()
                .await
                .has_resident_capacity(&self.config, &request.compatibility.agent_id)
        };
        if !has_capacity {
            let eviction = {
                let state = self.state.lock().await;
                if state.resident_count_for_member(&request.compatibility.agent_id)
                    >= self.config.max_resident_processes_per_member
                {
                    state.oldest_idle_for_member(&request.compatibility.agent_id)
                } else {
                    state
                        .oldest_idle_for_member(&request.compatibility.agent_id)
                        .or_else(|| state.oldest_idle_global())
                }
            };
            let freed_slot = if let Some(process_id) = eviction {
                self.stop_process_locked(&process_id).await
            } else {
                false
            };
            if !freed_slot
                || !self
                    .state
                    .lock()
                    .await
                    .has_resident_capacity(&self.config, &request.compatibility.agent_id)
            {
                residency = FleetResidency::Burst;
            }
        }

        let reservation_id = uuid::Uuid::new_v4().to_string();
        if residency == FleetResidency::Resident {
            let mut state = self.state.lock().await;
            let sequence = state.next_sequence();
            state.insert_resident(ProcessEntry {
                process_id: reservation_id.clone(),
                adapter_kind: request.adapter_kind,
                compatibility: request.compatibility.clone(),
                state: FleetProcessState::Starting,
                host: None,
                run_lease: Some(run_lease.clone()),
                idle_since: None,
                last_used_sequence: sequence,
                retire_after_run: false,
            });
            state
                .process_by_run
                .insert(run_lease.clone(), reservation_id.clone());
        }

        let host = match spawn().await {
            Ok(host) if host.is_healthy() => host,
            Ok(host) => {
                host.shutdown_and_reap().await;
                if residency == FleetResidency::Resident {
                    self.state.lock().await.remove_process(&reservation_id);
                }
                bail!("Runtime process exited during startup");
            }
            Err(error) => {
                if residency == FleetResidency::Resident {
                    self.state.lock().await.remove_process(&reservation_id);
                }
                return Err(error);
            }
        };
        if let Some(owner_records) = &self.owner_records
            && let Err(error) = owner_records.register(host.process_id(), &host)
        {
            host.shutdown_and_reap().await;
            if residency == FleetResidency::Resident {
                self.state.lock().await.remove_process(&reservation_id);
            }
            return Err(error).context("failed to persist Runtime process owner record");
        }
        let process_id = if residency == FleetResidency::Resident {
            reservation_id
        } else {
            host.process_id().to_string()
        };
        {
            let mut state = self.state.lock().await;
            if residency == FleetResidency::Resident {
                let entry = state
                    .processes
                    .get_mut(&process_id)
                    .expect("resident startup reservation disappeared");
                entry.host = Some(host.clone());
                entry.state = FleetProcessState::BusyResident;
            } else {
                let sequence = state.next_sequence();
                state.processes.insert(
                    process_id.clone(),
                    ProcessEntry {
                        process_id: process_id.clone(),
                        adapter_kind: request.adapter_kind,
                        compatibility: request.compatibility,
                        state: FleetProcessState::BusyBurst,
                        host: Some(host.clone()),
                        run_lease: Some(run_lease.clone()),
                        idle_since: None,
                        last_used_sequence: sequence,
                        retire_after_run: false,
                    },
                );
                state.process_by_run.insert(run_lease, process_id.clone());
            }
        }
        Ok(FleetLease {
            process_id,
            host,
            residency,
        })
    }

    async fn existing_lease(&self, run_lease: &RunLeaseKey) -> Option<FleetLease> {
        let state = self.state.lock().await;
        let process_id = state.process_by_run.get(run_lease)?;
        let entry = state.processes.get(process_id)?;
        let host = entry.host.clone()?;
        matches!(
            entry.state,
            FleetProcessState::BusyResident | FleetProcessState::BusyBurst
        )
        .then(|| FleetLease {
            process_id: process_id.clone(),
            host,
            residency: if entry.state == FleetProcessState::BusyResident {
                FleetResidency::Resident
            } else {
                FleetResidency::Burst
            },
        })
    }

    async fn acquire_compatible_idle(&self, request: &FleetAcquireRequest) -> Option<FleetLease> {
        let mut state = self.state.lock().await;
        let process_id = state.idle_lru.iter().find_map(|(_, process_id)| {
            state
                .processes
                .get(process_id)
                .filter(|entry| {
                    entry.state == FleetProcessState::IdleWarm
                        && entry.adapter_kind == request.adapter_kind
                        && entry.compatibility == request.compatibility
                        && entry
                            .host
                            .as_ref()
                            .is_some_and(RuntimeProcessHost::is_healthy)
                })
                .map(|_| process_id.clone())
        })?;
        let run_lease = request.run_lease();
        let (last_used_sequence, host) = {
            let entry = state.processes.get_mut(&process_id)?;
            let last_used_sequence = entry.last_used_sequence;
            entry.state = FleetProcessState::BusyResident;
            entry.run_lease = Some(run_lease.clone());
            entry.idle_since = None;
            (last_used_sequence, entry.host.clone()?)
        };
        state
            .idle_lru
            .remove(&(last_used_sequence, process_id.clone()));
        state.process_by_run.insert(run_lease, process_id.clone());
        Some(FleetLease {
            process_id,
            host,
            residency: FleetResidency::Resident,
        })
    }

    pub(crate) async fn release(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        disposition: FleetReleaseDisposition,
    ) {
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
            return;
        };
        let (state_kind, retire_after_run, host) = {
            let state = self.state.lock().await;
            let Some(entry) = state.processes.get(&process_id) else {
                return;
            };
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
                return;
            };
            entry.run_lease = None;
            entry.state = FleetProcessState::IdleWarm;
            entry.idle_since = Some(Instant::now());
            entry.last_used_sequence = sequence;
            state.idle_lru.insert((sequence, process_id));
        } else {
            self.stop_process_locked(&process_id).await;
        }
    }

    pub(crate) async fn invalidate_camp(&self, camp_id: &str) {
        self.invalidate_matching(|entry| entry.compatibility.camp_id == camp_id)
            .await;
    }

    pub(crate) async fn invalidate_member(&self, agent_id: &str) {
        self.invalidate_matching(|entry| entry.compatibility.agent_id == agent_id)
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
        if timeout(self.config.stop_timeout, host.shutdown_and_reap())
            .await
            .is_err()
        {
            return false;
        }
        self.state.lock().await.remove_process(process_id);
        if let Some(owner_records) = &self.owner_records {
            owner_records.remove(host.process_id());
        }
        true
    }

    pub(crate) async fn shutdown_all(&self) {
        let _operation = self.operations.lock().await;
        let process_ids = self
            .state
            .lock()
            .await
            .processes
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for process_id in process_ids {
            self.stop_process_locked(&process_id).await;
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

    #[test]
    fn default_limits_match_the_runtime_fleet_contract() {
        let config = AgentRuntimeFleetConfig::default();
        assert_eq!(config.max_resident_processes_per_member, 20);
        assert_eq!(config.max_resident_processes_global, 200);
        assert_eq!(config.idle_ttl, Duration::from_secs(30 * 60));
        assert_eq!(config.sweep_interval, Duration::from_secs(60));
    }

    #[test]
    fn stopping_is_a_resident_state_but_burst_is_not() {
        assert!(FleetProcessState::Starting.is_resident());
        assert!(FleetProcessState::BusyResident.is_resident());
        assert!(FleetProcessState::IdleWarm.is_resident());
        assert!(FleetProcessState::Stopping.is_resident());
        assert!(!FleetProcessState::BusyBurst.is_resident());
    }
}
