use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

const BUILTIN_TOOL_REPLAY_CACHE_CAPACITY: usize = 1_024;

use anyhow::{Context, Result, bail};
use rovai_core::{
    builtin_tool_transport::{
        BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION, BuiltinToolAuth,
        BuiltinToolCliContext, BuiltinToolInvocationEnvelope, BuiltinToolLeaseContext,
        LocalIpcEndpoint, ROVAI_AGENT_CLI_ENV, ROVAI_CLI_CONTEXT_ENV, ROVAI_RUN_TMP_ENV,
    },
    command::canonical_json_digest,
    team_tool::BuiltinToolBindingCredential,
};
use serde_json::json;
use tokio::{
    process::Command,
    sync::{Mutex, MutexGuard},
    time::Instant,
};

#[derive(Clone)]
pub(crate) struct BuiltinToolProcessConfig {
    inner: Arc<BuiltinToolProcessConfigInner>,
}

struct BuiltinToolProcessConfigInner {
    cli_executable: PathBuf,
    core_endpoint: LocalIpcEndpoint,
    process_root: PathBuf,
    context_path: PathBuf,
    run_tmp: PathBuf,
    process_id: String,
    process_token: String,
}

impl Drop for BuiltinToolProcessConfigInner {
    fn drop(&mut self) {
        let outbox = self.process_root.join("compaction-observation-outbox");
        let has_uncertain_observation = fs::read_dir(&outbox)
            .ok()
            .and_then(|mut entries| entries.next())
            .is_some();
        if has_uncertain_observation {
            // Core owns durable reconciliation. Retain only process roots that
            // contain a concrete Hook observation with an unknown submission
            // outcome; ordinary Runtime/Host exit still cleans up normally.
            return;
        }
        let _ = fs::remove_dir_all(&self.process_root);
    }
}

impl BuiltinToolProcessConfig {
    pub(crate) fn create(
        cli_executable: &Path,
        core_endpoint: &LocalIpcEndpoint,
        private_root: &Path,
    ) -> Result<Self> {
        if !cli_executable.is_absolute() || !private_root.is_absolute() {
            bail!("Built-in Tool process paths must be absolute");
        }
        core_endpoint.validate()?;
        if !cli_executable.is_file() {
            bail!(
                "bundled Rovai Agent CLI is unavailable: {}",
                cli_executable.display()
            );
        }
        let process_id = uuid::Uuid::new_v4().to_string();
        let process_token = opaque_token();
        let process_root = private_root.join("builtin-tools").join(&process_id);
        let run_tmp = process_root.join("run-tmp");
        fs::create_dir_all(&run_tmp).with_context(|| {
            format!(
                "failed to create Built-in Tool process root {}",
                process_root.display()
            )
        })?;
        restrict_directory(&process_root)?;
        restrict_directory(&run_tmp)?;
        let config = Self {
            inner: Arc::new(BuiltinToolProcessConfigInner {
                cli_executable: cli_executable.to_path_buf(),
                core_endpoint: core_endpoint.clone(),
                context_path: process_root.join("context.json"),
                run_tmp,
                process_root,
                process_id,
                process_token,
            }),
        };
        config.write_context(None)?;
        Ok(config)
    }

    pub(crate) fn process_id(&self) -> &str {
        &self.inner.process_id
    }

    pub(crate) fn cli_executable(&self) -> &Path {
        &self.inner.cli_executable
    }

    pub(crate) fn process_token(&self) -> &str {
        &self.inner.process_token
    }

    pub(crate) fn context_path(&self) -> &Path {
        &self.inner.context_path
    }

    pub(crate) fn run_tmp(&self) -> &Path {
        &self.inner.run_tmp
    }

    pub(crate) fn configure_command(&self, command: &mut Command) -> Result<()> {
        let cli_directory = self
            .inner
            .cli_executable
            .parent()
            .context("Rovai Agent CLI has no parent directory")?;
        let current_path = command
            .as_std()
            .get_envs()
            .find_map(|(name, value)| {
                (name == "PATH")
                    .then(|| value.map(ToOwned::to_owned))
                    .flatten()
            })
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        let mut paths = vec![cli_directory.to_path_buf()];
        paths.extend(std::env::split_paths(&current_path));
        let path = std::env::join_paths(paths).context("failed to construct Runtime CLI PATH")?;
        command
            .env("PATH", path)
            .env(ROVAI_AGENT_CLI_ENV, &self.inner.cli_executable)
            .env(ROVAI_CLI_CONTEXT_ENV, &self.inner.context_path)
            .env(ROVAI_RUN_TMP_ENV, &self.inner.run_tmp);
        Ok(())
    }

    fn write_context(&self, lease: Option<BuiltinToolLeaseContext>) -> Result<()> {
        let document = BuiltinToolCliContext {
            contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
            ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
            core_endpoint: self.inner.core_endpoint.clone(),
            process_id: self.inner.process_id.clone(),
            process_token: self.inner.process_token.clone(),
            lease,
        };
        atomic_write_private_json(&self.inner.context_path, &document)
    }
}

#[derive(Clone)]
pub(crate) struct AuthorizedBuiltinToolInvocation {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub native_binding: BuiltinToolBindingCredential,
    pub run_tmp: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct BuiltinToolLeaseError {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Clone)]
struct ActiveLease {
    lease_id: String,
    lease_generation: u64,
    lease_token: String,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding: BuiltinToolBindingCredential,
    replay: HashMap<String, ReplayEntry>,
    replay_order: VecDeque<String>,
}

#[derive(Clone)]
struct ReplayEntry {
    request_digest: String,
    envelope: BuiltinToolInvocationEnvelope,
}

struct RegisteredProcess {
    process_token: String,
    config: BuiltinToolProcessConfig,
    lease_generation: u64,
    active: Option<ActiveLease>,
}

#[derive(Default)]
pub(crate) struct BuiltinToolLeaseRegistry {
    processes: Mutex<HashMap<String, RegisteredProcess>>,
    invocation_gate: Mutex<()>,
}

impl BuiltinToolLeaseRegistry {
    pub(crate) async fn invocation_guard(&self) -> MutexGuard<'_, ()> {
        self.invocation_gate.lock().await
    }

    pub(crate) async fn bind(
        &self,
        config: &BuiltinToolProcessConfig,
        agent_run_id: &str,
        execution_epoch: i64,
        native_binding: &BuiltinToolBindingCredential,
    ) -> Result<BuiltinToolAuth> {
        let _gate = self.invocation_gate.lock().await;
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            bail!("Built-in Tool lease requires one current AgentRun");
        }
        let mut processes = self.processes.lock().await;
        let process = processes
            .entry(config.process_id().to_string())
            .or_insert_with(|| RegisteredProcess {
                process_token: config.process_token().to_string(),
                config: config.clone(),
                lease_generation: 0,
                active: None,
            });
        if process.process_token != config.process_token()
            || process.config.context_path() != config.context_path()
        {
            bail!("Built-in Tool process identity conflict");
        }
        if let Some(active) = &process.active {
            if active.agent_run_id != agent_run_id || active.execution_epoch != execution_epoch {
                bail!("Built-in Tool process is already bound to another AgentRun");
            }
            // Every Fleet acquire gets a fresh lease, even when it resumes the same
            // Run on the same warm process. Any context copied from the prior acquire
            // is therefore fenced by generation and token.
            process.active = None;
        }
        process.lease_generation = process.lease_generation.saturating_add(1).max(1);
        let active = ActiveLease {
            lease_id: uuid::Uuid::new_v4().to_string(),
            lease_generation: process.lease_generation,
            lease_token: opaque_token(),
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
            native_binding: native_binding.clone(),
            replay: HashMap::new(),
            replay_order: VecDeque::new(),
        };
        let auth = BuiltinToolAuth {
            process_id: config.process_id().to_string(),
            process_token: config.process_token().to_string(),
            lease_id: active.lease_id.clone(),
            lease_generation: active.lease_generation,
            lease_token: active.lease_token.clone(),
        };
        config.write_context(Some(BuiltinToolLeaseContext {
            lease_id: active.lease_id.clone(),
            lease_generation: active.lease_generation,
            lease_token: active.lease_token.clone(),
        }))?;
        process.active = Some(active);
        Ok(auth)
    }

    pub(crate) async fn unbind(&self, process_id: &str, agent_run_id: &str, execution_epoch: i64) {
        let _gate = self.invocation_gate.lock().await;
        let mut processes = self.processes.lock().await;
        let Some(process) = processes.get_mut(process_id) else {
            return;
        };
        let matches = process.active.as_ref().is_some_and(|active| {
            active.agent_run_id == agent_run_id && active.execution_epoch == execution_epoch
        });
        if matches {
            process.active = None;
            if let Err(error) = process.config.write_context(None) {
                eprintln!("failed to fence Built-in Tool context: {error:#}");
            }
        }
    }

    pub(crate) async fn unregister(&self, process_id: &str) {
        let _gate = self.invocation_gate.lock().await;
        if let Some(process) = self.processes.lock().await.remove(process_id) {
            let _ = process.config.write_context(None);
        }
    }

    pub(crate) async fn fence_all(&self) -> usize {
        let _gate = self.invocation_gate.lock().await;
        let mut processes = self.processes.lock().await;
        let mut fenced = 0;
        for process in processes.values_mut() {
            if process.active.take().is_some() {
                fenced += 1;
            }
            if let Err(error) = process.config.write_context(None) {
                eprintln!("failed to fence Built-in Tool context: {error:#}");
            }
        }
        fenced
    }

    pub(crate) async fn fence_all_until(&self, deadline: Instant) -> Option<usize> {
        tokio::time::timeout_at(deadline, self.fence_all())
            .await
            .ok()
    }

    pub(crate) async fn authenticate(
        &self,
        auth: &BuiltinToolAuth,
    ) -> std::result::Result<AuthorizedBuiltinToolInvocation, BuiltinToolLeaseError> {
        let processes = self.processes.lock().await;
        let Some(process) = processes.get(&auth.process_id) else {
            return Err(run_not_bound());
        };
        if process.process_token != auth.process_token {
            return Err(run_not_bound());
        }
        let Some(active) = &process.active else {
            return Err(run_not_bound());
        };
        if active.lease_id != auth.lease_id
            || active.lease_generation != auth.lease_generation
            || active.lease_token != auth.lease_token
        {
            return Err(run_not_bound());
        }
        Ok(AuthorizedBuiltinToolInvocation {
            agent_run_id: active.agent_run_id.clone(),
            execution_epoch: active.execution_epoch,
            native_binding: active.native_binding.clone(),
            run_tmp: process.config.run_tmp().to_path_buf(),
        })
    }

    pub(crate) async fn authenticate_process(&self, process_id: &str, process_token: &str) -> bool {
        self.processes
            .lock()
            .await
            .get(process_id)
            .is_some_and(|process| process.process_token == process_token)
    }

    pub(crate) async fn replay(
        &self,
        auth: &BuiltinToolAuth,
        request_id: &str,
        request_digest: &str,
    ) -> std::result::Result<Option<BuiltinToolInvocationEnvelope>, BuiltinToolLeaseError> {
        let processes = self.processes.lock().await;
        let process = processes.get(&auth.process_id).ok_or_else(run_not_bound)?;
        if process.process_token != auth.process_token {
            return Err(run_not_bound());
        }
        let active = process.active.as_ref().ok_or_else(run_not_bound)?;
        if active.lease_id != auth.lease_id
            || active.lease_generation != auth.lease_generation
            || active.lease_token != auth.lease_token
        {
            return Err(run_not_bound());
        }
        match active.replay.get(request_id) {
            Some(entry) if entry.request_digest == request_digest => {
                Ok(Some(entry.envelope.clone()))
            }
            Some(_) => Err(BuiltinToolLeaseError {
                code: "builtin_tool.idempotency_conflict",
                message: "requestId was reused with a different operation or input",
            }),
            None => Ok(None),
        }
    }

    pub(crate) async fn record(
        &self,
        auth: &BuiltinToolAuth,
        request_id: &str,
        request_digest: &str,
        envelope: &BuiltinToolInvocationEnvelope,
    ) -> std::result::Result<(), BuiltinToolLeaseError> {
        let mut processes = self.processes.lock().await;
        let process = processes
            .get_mut(&auth.process_id)
            .ok_or_else(run_not_bound)?;
        if process.process_token != auth.process_token {
            return Err(run_not_bound());
        }
        let active = process.active.as_mut().ok_or_else(run_not_bound)?;
        if active.lease_id != auth.lease_id
            || active.lease_generation != auth.lease_generation
            || active.lease_token != auth.lease_token
        {
            return Err(run_not_bound());
        }
        if let Some(existing) = active.replay.get(request_id) {
            if existing.request_digest != request_digest {
                return Err(BuiltinToolLeaseError {
                    code: "builtin_tool.idempotency_conflict",
                    message: "requestId was reused with a different operation or input",
                });
            }
            return Ok(());
        }
        active.replay.insert(
            request_id.to_string(),
            ReplayEntry {
                request_digest: request_digest.to_string(),
                envelope: envelope.clone(),
            },
        );
        active.replay_order.push_back(request_id.to_string());
        while active.replay_order.len() > BUILTIN_TOOL_REPLAY_CACHE_CAPACITY {
            if let Some(expired_request_id) = active.replay_order.pop_front() {
                active.replay.remove(&expired_request_id);
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn active_count(&self) -> usize {
        self.processes
            .lock()
            .await
            .values()
            .filter(|process| process.active.is_some())
            .count()
    }
}

pub(crate) fn bundled_cli_executable() -> Result<PathBuf> {
    let current = std::env::current_exe().context("failed to locate rovai-core executable")?;
    let directory = current
        .parent()
        .context("rovai-core executable has no parent directory")?;
    let name: OsString = if cfg!(windows) {
        "rovai.exe".into()
    } else {
        "rovai".into()
    };
    Ok(directory.join(name))
}

pub(crate) fn builtin_tool_endpoint() -> LocalIpcEndpoint {
    static ENDPOINT: OnceLock<LocalIpcEndpoint> = OnceLock::new();
    ENDPOINT
        .get_or_init(|| {
            #[cfg(windows)]
            {
                LocalIpcEndpoint::WindowsNamedPipe {
                    name: format!(
                        r"\\.\pipe\rovai-ai-{}-{}",
                        std::process::id(),
                        uuid::Uuid::new_v4()
                    ),
                }
            }
            #[cfg(not(windows))]
            {
                LocalIpcEndpoint::UnixSocket {
                    path: PathBuf::from("/tmp")
                        .join(format!("rovai-builtin-{}", std::process::id()))
                        .join("core.sock")
                        .to_string_lossy()
                        .into_owned(),
                }
            }
        })
        .clone()
}

pub(crate) fn request_digest(operation: &str, input: &serde_json::Value) -> Result<String> {
    canonical_json_digest(&json!({
        "domain": "rovai.builtin-tool-request.v1",
        "operation": operation,
        "input": input,
    }))
}

fn run_not_bound() -> BuiltinToolLeaseError {
    BuiltinToolLeaseError {
        code: "builtin_tool.run_not_bound",
        message: "Built-in Tool CLI is not bound to the current AgentRun",
    }
}

fn opaque_token() -> String {
    format!(
        "{}.{}",
        uuid::Uuid::new_v4().as_hyphenated(),
        uuid::Uuid::new_v4().as_hyphenated()
    )
}

fn atomic_write_private_json(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    let parent = path.parent().context("private JSON path has no parent")?;
    fs::create_dir_all(parent)?;
    restrict_directory(parent)?;
    let temporary = parent.join(format!(".context-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    serde_json::to_writer(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn restrict_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn executable() -> PathBuf {
        std::env::current_exe().unwrap()
    }

    fn binding() -> BuiltinToolBindingCredential {
        BuiltinToolBindingCredential {
            native_binding_id: uuid::Uuid::new_v4().to_string(),
            native_binding_generation: 1,
            binding_credential: "binding-secret".to_string(),
            conversation_version: 1,
            adapter_installation_id: "installation".to_string(),
            native_session_id: None,
            binding_compatibility_digest: "digest".to_string(),
            binding_replaced: false,
        }
    }

    #[tokio::test]
    async fn lease_rotates_fences_and_replays_exact_request() {
        let root =
            std::env::temp_dir().join(format!("rovai-builtin-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: root.join("core.sock").to_string_lossy().into_owned(),
        };
        let config = BuiltinToolProcessConfig::create(&executable(), &endpoint, &root).unwrap();
        let registry = BuiltinToolLeaseRegistry::default();
        let first = registry
            .bind(&config, "run-1", 1, &binding())
            .await
            .unwrap();
        assert_eq!(registry.active_count().await, 1);
        let rotated = registry
            .bind(&config, "run-1", 1, &binding())
            .await
            .unwrap();
        assert!(rotated.lease_generation > first.lease_generation);
        assert_ne!(rotated.lease_id, first.lease_id);
        assert!(registry.authenticate(&first).await.is_err());
        let envelope = BuiltinToolInvocationEnvelope::success(
            "camp.list",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            json!({"camps": [], "truncated": false}),
        )
        .unwrap();
        registry
            .record(
                &rotated,
                "7b5db24c-4a43-4cab-9217-d982b08f7691",
                "digest-1",
                &envelope,
            )
            .await
            .unwrap();
        assert_eq!(
            registry
                .replay(&rotated, "7b5db24c-4a43-4cab-9217-d982b08f7691", "digest-1",)
                .await
                .unwrap(),
            Some(envelope)
        );
        registry.unbind(config.process_id(), "run-1", 1).await;
        assert!(registry.authenticate(&rotated).await.is_err());
        let second = registry
            .bind(&config, "run-2", 2, &binding())
            .await
            .unwrap();
        assert!(second.lease_generation > rotated.lease_generation);
        assert_ne!(second.lease_id, rotated.lease_id);
        assert!(registry.authenticate(&first).await.is_err());
        registry.unbind(config.process_id(), "run-2", 2).await;
        drop(config);
        let _ = fs::remove_dir_all(root);
    }
}
