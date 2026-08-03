use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use rovai_core::{
    agent_runtime_adapter::executable_fingerprint,
    command::canonical_json_digest,
    team_tool::TeamToolBindingCredential,
    team_tool_catalog::{
        ANTIGRAVITY_TEAM_SERVER_NAME, ATTESTED_TEAM_PROTOCOL_VERSION,
        antigravity_team_tool_definitions, built_in_team_catalog_digest,
        identity_by_antigravity_alias, validate_builtin_team_tool_input,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
    net::{UnixListener, UnixStream},
    sync::Mutex,
    time::{Duration, Instant},
};

const BOOTSTRAP_EXPIRY: Duration = Duration::from_secs(20);
const MAX_IPC_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub parent_pid: u32,
    pub start_time_micros: u64,
    pub executable_path: PathBuf,
}

#[derive(Clone)]
pub struct AttestedRunRegistration {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: PathBuf,
    pub runtime_executable: PathBuf,
    pub runtime_executable_fingerprint: String,
    pub binding: TeamToolBindingCredential,
}

struct Claim {
    registration: AttestedRunRegistration,
    runtime: ProcessIdentity,
    bootstrap_expires_at: Instant,
    bound_bridge: Option<ProcessIdentity>,
    active_connection: bool,
    lease_generation: u64,
}

#[derive(Clone)]
pub struct AttestedLease {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: PathBuf,
    pub lease_generation: u64,
    pub bridge_pid: u32,
    pub binding: TeamToolBindingCredential,
}

pub struct AttestedTeamRegistry {
    claims: Mutex<HashMap<(String, i64), Claim>>,
    trusted_bridge_path: PathBuf,
    trusted_bridge_fingerprint: String,
}

impl AttestedTeamRegistry {
    pub fn new() -> Result<Self> {
        let trusted_bridge_path = canonical_path(&std::env::current_exe()?)?;
        let trusted_bridge_fingerprint = executable_fingerprint(&trusted_bridge_path)?;
        Ok(Self {
            claims: Mutex::new(HashMap::new()),
            trusted_bridge_path,
            trusted_bridge_fingerprint,
        })
    }

    pub async fn register(
        &self,
        registration: AttestedRunRegistration,
        runtime_pid: u32,
    ) -> Result<()> {
        let runtime = process_identity(runtime_pid)?;
        if runtime.parent_pid != std::process::id() {
            anyhow::bail!("Antigravity launch barrier child does not belong to this Core");
        }
        if canonical_path(&runtime.executable_path)? != self.trusted_bridge_path
            || executable_fingerprint(&runtime.executable_path)? != self.trusted_bridge_fingerprint
        {
            anyhow::bail!("Antigravity launch barrier executable identity is invalid");
        }
        let key = (
            registration.agent_run_id.clone(),
            registration.execution_epoch,
        );
        let mut claims = self.claims.lock().await;
        if claims.contains_key(&key) {
            anyhow::bail!("Antigravity Run Claim already exists for this epoch");
        }
        if claims
            .values()
            .any(|claim| claim.runtime.pid == runtime_pid)
        {
            anyhow::bail!("Antigravity Runtime PID is already claimed");
        }
        claims.insert(
            key,
            Claim {
                registration,
                runtime,
                bootstrap_expires_at: Instant::now() + BOOTSTRAP_EXPIRY,
                bound_bridge: None,
                active_connection: false,
                lease_generation: 0,
            },
        );
        Ok(())
    }

    pub async fn revoke(&self, agent_run_id: &str, execution_epoch: i64) {
        self.claims
            .lock()
            .await
            .remove(&(agent_run_id.to_string(), execution_epoch));
    }

    pub async fn acquire(&self, bridge_pid: u32) -> Result<Option<AttestedLease>> {
        let bridge = match process_identity(bridge_pid) {
            Ok(identity) => identity,
            Err(_) => return Ok(None),
        };
        if canonical_path(&bridge.executable_path)? != self.trusted_bridge_path
            || executable_fingerprint(&bridge.executable_path)? != self.trusted_bridge_fingerprint
        {
            return Ok(None);
        }

        let mut claims = self.claims.lock().await;
        let Some(claim) = claims
            .values_mut()
            .find(|claim| claim.runtime.pid == bridge.parent_pid)
        else {
            return Ok(None);
        };
        if claim.bound_bridge.is_none() && Instant::now() > claim.bootstrap_expires_at {
            return Ok(None);
        }
        if claim.active_connection {
            return Ok(None);
        }
        if let Some(bound) = claim.bound_bridge.as_ref()
            && bound != &bridge
        {
            return Ok(None);
        }
        if bridge.start_time_micros < claim.runtime.start_time_micros {
            return Ok(None);
        }
        if !runtime_still_matches(claim)? {
            return Ok(None);
        }
        if claim.bound_bridge.is_none() {
            claim.bound_bridge = Some(bridge.clone());
        }
        claim.active_connection = true;
        claim.lease_generation = claim.lease_generation.saturating_add(1);
        Ok(Some(AttestedLease {
            agent_run_id: claim.registration.agent_run_id.clone(),
            execution_epoch: claim.registration.execution_epoch,
            workspace: claim.registration.workspace.clone(),
            lease_generation: claim.lease_generation,
            bridge_pid,
            binding: claim.registration.binding.clone(),
        }))
    }

    pub async fn release(&self, lease: &AttestedLease) {
        if let Some(claim) = self
            .claims
            .lock()
            .await
            .get_mut(&(lease.agent_run_id.clone(), lease.execution_epoch))
            && claim.lease_generation == lease.lease_generation
            && claim
                .bound_bridge
                .as_ref()
                .is_some_and(|bridge| bridge.pid == lease.bridge_pid)
        {
            claim.active_connection = false;
        }
    }
}

fn runtime_still_matches(claim: &Claim) -> Result<bool> {
    let current = match process_identity(claim.runtime.pid) {
        Ok(identity) => identity,
        Err(_) => return Ok(false),
    };
    if current.start_time_micros != claim.runtime.start_time_micros
        || current.parent_pid != claim.runtime.parent_pid
        || canonical_path(&current.executable_path)?
            != canonical_path(&claim.registration.runtime_executable)?
    {
        return Ok(false);
    }
    Ok(
        executable_fingerprint(&claim.registration.runtime_executable)?
            == claim.registration.runtime_executable_fingerprint,
    )
}

fn canonical_path(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to canonicalize {}", path.display()))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "operation", deny_unknown_fields)]
pub enum AttestedTeamRequest {
    List {
        protocol_version: u32,
        catalog_digest: String,
    },
    Call {
        protocol_version: u32,
        catalog_digest: String,
        runtime_alias: String,
        canonical_tool: String,
        runtime_tool_call_id: String,
        input: Value,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestedTeamResponse {
    pub bound: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AttestedTeamError>,
}

impl AttestedTeamResponse {
    pub fn unbound() -> Self {
        Self {
            bound: false,
            result: None,
            error: Some(AttestedTeamError::run_not_bound()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedTeamError {
    pub code: String,
    pub message: String,
}

impl AttestedTeamError {
    pub fn run_not_bound() -> Self {
        Self {
            code: "run_not_bound".to_string(),
            message: "This Antigravity process is not bound to an active Rovai AgentRun"
                .to_string(),
        }
    }
}

pub fn bind_attested_listener(socket_path: &Path) -> Result<UnixListener> {
    use std::os::unix::fs::MetadataExt;

    let directory = socket_path
        .parent()
        .context("attested Team rendezvous has no parent")?;
    fs::create_dir_all(directory)?;
    let directory_metadata = fs::symlink_metadata(directory)?;
    if !directory_metadata.file_type().is_dir()
        || directory_metadata.uid() != unsafe { libc::geteuid() }
    {
        anyhow::bail!("attested Team rendezvous directory identity is invalid");
    }
    restrict_directory(directory)?;
    if socket_path.exists() {
        if std::os::unix::net::UnixStream::connect(socket_path).is_ok() {
            anyhow::bail!("another Rovai Core owns the attested Team rendezvous");
        }
        validate_endpoint_file(socket_path)?;
        fs::remove_file(socket_path)?;
    }
    let listener = UnixListener::bind(socket_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(listener)
}

pub fn run_attested_runtime_launcher() -> Result<()> {
    use std::{io::Read, os::fd::FromRawFd, os::unix::process::CommandExt};

    let mut args = std::env::args_os().skip(2);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--launch-fd")) {
        anyhow::bail!("attested Runtime launcher requires --launch-fd");
    }
    let launch_fd = args
        .next()
        .context("attested Runtime launcher is missing its launch fd")?
        .to_string_lossy()
        .parse::<i32>()?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--runtime")) {
        anyhow::bail!("attested Runtime launcher requires --runtime");
    }
    let runtime = PathBuf::from(
        args.next()
            .context("attested Runtime launcher is missing its Runtime executable")?,
    );
    if !runtime.is_absolute() || !runtime.is_file() {
        anyhow::bail!("attested Runtime launcher executable is invalid");
    }
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
        anyhow::bail!("attested Runtime launcher argument boundary is missing");
    }
    let runtime_args = args.collect::<Vec<_>>();
    let mut barrier = unsafe { std::fs::File::from_raw_fd(launch_fd) };
    let mut release = [0_u8; 1];
    barrier
        .read_exact(&mut release)
        .context("Antigravity launch barrier closed before Run Claim registration")?;
    if release != *b"1" {
        anyhow::bail!("Antigravity launch barrier release is invalid");
    }
    drop(barrier);
    let error = std::process::Command::new(runtime)
        .args(runtime_args)
        .exec();
    Err(error).context("failed to exec the attested Antigravity Runtime")
}

pub async fn run_attested_team_bridge(rendezvous: PathBuf) -> Result<()> {
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut output = BufWriter::new(tokio::io::stdout());
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_mcp_response(
                    &mut output,
                    &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}),
                )
                .await?;
                continue;
            }
        };
        if let Some(response) = handle_attested_mcp_request(&rendezvous, &request).await {
            write_mcp_response(&mut output, &response).await?;
        }
    }
    output.flush().await?;
    Ok(())
}

async fn handle_attested_mcp_request(rendezvous: &Path, request: &Value) -> Option<Value> {
    let id = request.get("id").cloned()?;
    let method = request.get("method").and_then(Value::as_str);
    let result: std::result::Result<Value, (i64, String)> = match method {
        Some("initialize") => Ok(json!({
            "protocolVersion": request.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": {"tools":{"listChanged":false}},
            "serverInfo": {"name":"rovai-team-attested","version":env!("CARGO_PKG_VERSION")},
            "instructions": "Rovai-ai exposes the complete process-bound built-in Team, Context, and Memory catalog only for an active attested AgentRun."
        })),
        Some("ping") => Ok(json!({})),
        Some("tools/list") => {
            let catalog_digest = built_in_team_catalog_digest().ok();
            let bound = match catalog_digest.as_ref() {
                Some(catalog_digest) => request_core(
                    rendezvous,
                    &AttestedTeamRequest::List {
                        protocol_version: ATTESTED_TEAM_PROTOCOL_VERSION,
                        catalog_digest: catalog_digest.clone(),
                    },
                )
                .await
                .is_some_and(|response| response.bound && response.error.is_none()),
                None => false,
            };
            Ok(json!({
                "tools": if bound { antigravity_team_tool_definitions() } else { Vec::new() }
            }))
        }
        Some("tools/call") => call_attested_team_tool(rendezvous, request).await,
        Some(_) => Err((-32601, "Method not found".to_string())),
        None => Err((-32600, "Invalid Request".to_string())),
    };
    Some(match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err((code, message)) => {
            json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
        }
    })
}

async fn call_attested_team_tool(
    rendezvous: &Path,
    request: &Value,
) -> std::result::Result<Value, (i64, String)> {
    let runtime_alias = request
        .pointer("/params/name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let identity = identity_by_antigravity_alias(runtime_alias)
        .ok_or_else(|| (-32601, "Requested Team Tool is unavailable".to_string()))?;
    let input = request
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    validate_builtin_team_tool_input(identity.canonical_name, &input).map_err(|_| {
        (
            -32602,
            format!("{runtime_alias} arguments do not match the narrow Tool schema"),
        )
    })?;
    let runtime_tool_call_id =
        runtime_tool_call_identity(request, identity, &input).map_err(|error| (-32602, error))?;
    let catalog_digest = built_in_team_catalog_digest()
        .map_err(|_| (-32603, "Team Tool catalog digest failed".to_string()))?;
    let response = request_core(
        rendezvous,
        &AttestedTeamRequest::Call {
            protocol_version: ATTESTED_TEAM_PROTOCOL_VERSION,
            catalog_digest,
            runtime_alias: identity.antigravity_alias.to_string(),
            canonical_tool: identity.canonical_name.to_string(),
            runtime_tool_call_id,
            input,
        },
    )
    .await
    .unwrap_or_else(AttestedTeamResponse::unbound);
    match (response.result, response.error) {
        (Some(result), None) if response.bound => Ok(json!({
            "content":[{"type":"text","text":serde_json::to_string(&result).unwrap_or_else(|_| "Team request completed".to_string())}],
            "structuredContent":result,
            "isError":false
        })),
        (structured, Some(error)) => {
            let structured = structured.unwrap_or_else(|| {
                json!({
                    "rovaiTeamTool": identity.canonical_name,
                    "errorCode": error.code,
                })
            });
            Ok(json!({
                "content":[{"type":"text","text":format!("{}: {}", error.code, error.message)}],
                "structuredContent":structured,
                "isError":true
            }))
        }
        _ => Err((
            -32603,
            "Rovai Core returned an ambiguous Team response".to_string(),
        )),
    }
}

fn runtime_tool_call_identity(
    request: &Value,
    identity: rovai_core::team_tool_catalog::BuiltInTeamToolIdentity,
    input: &Value,
) -> std::result::Result<String, String> {
    let conversation_id = request
        .pointer("/params/_meta/antigravity.google~1conversation_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Antigravity conversation identity is missing".to_string())?;
    let progress_token = request
        .pointer("/params/_meta/progressToken")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Antigravity progress token is missing".to_string())?;
    let digest = canonical_json_digest(&json!({
        "conversationId": conversation_id,
        "progressToken": progress_token,
        "server": ANTIGRAVITY_TEAM_SERVER_NAME,
        "runtimeAlias": identity.antigravity_alias,
        "canonicalTool": identity.canonical_name,
        "input": input,
    }))
    .map_err(|_| "Antigravity Tool Call identity could not be normalized".to_string())?;
    Ok(format!("agy-mcp:{digest}"))
}

async fn request_core(
    rendezvous: &Path,
    request: &AttestedTeamRequest,
) -> Option<AttestedTeamResponse> {
    if validate_endpoint_file(rendezvous).is_err() {
        return None;
    }
    let mut stream = UnixStream::connect(rendezvous).await.ok()?;
    if verify_core_peer(&stream).is_err() {
        return None;
    }
    let serialized = serde_json::to_vec(request).ok()?;
    if serialized.len() > MAX_IPC_BYTES {
        return None;
    }
    stream.write_all(&serialized).await.ok()?;
    stream.write_all(b"\n").await.ok()?;
    let line = BufReader::new(stream).lines().next_line().await.ok()??;
    if line.len() > MAX_IPC_BYTES {
        return None;
    }
    serde_json::from_str(&line).ok()
}

fn verify_core_peer(stream: &UnixStream) -> Result<()> {
    let pid = stream
        .peer_cred()?
        .pid()
        .context("attested Team Core peer PID is unavailable")?;
    let peer = process_identity(u32::try_from(pid)?)?;
    if canonical_path(&peer.executable_path)? != canonical_path(&std::env::current_exe()?)? {
        anyhow::bail!("attested Team rendezvous is not owned by this Rovai build");
    }
    Ok(())
}

fn validate_endpoint_file(path: &Path) -> Result<()> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
        anyhow::bail!("attested Team rendezvous owner or type is invalid");
    }
    if metadata.permissions().mode() & 0o777 != 0o600 {
        anyhow::bail!("attested Team rendezvous permissions are invalid");
    }
    let parent = path
        .parent()
        .context("attested Team rendezvous has no parent")?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.is_dir()
        || parent_metadata.uid() != unsafe { libc::geteuid() }
        || parent_metadata.permissions().mode() & 0o077 != 0
    {
        anyhow::bail!("attested Team rendezvous directory is not private");
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

async fn write_mcp_response(
    output: &mut BufWriter<tokio::io::Stdout>,
    response: &Value,
) -> Result<()> {
    output.write_all(&serde_json::to_vec(response)?).await?;
    output.write_all(b"\n").await?;
    output.flush().await?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn process_identity(pid: u32) -> Result<ProcessIdentity> {
    use std::{ffi::CStr, mem};
    let mut info = unsafe { mem::zeroed::<libc::proc_bsdinfo>() };
    let size = i32::try_from(mem::size_of::<libc::proc_bsdinfo>())?;
    let read = unsafe {
        libc::proc_pidinfo(
            i32::try_from(pid)?,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    if read != size || info.pbi_pid != pid {
        anyhow::bail!("process {pid} is unavailable");
    }
    let mut path = vec![0_i8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let path_len = unsafe {
        libc::proc_pidpath(
            i32::try_from(pid)?,
            path.as_mut_ptr().cast(),
            u32::try_from(path.len())?,
        )
    };
    if path_len <= 0 {
        anyhow::bail!("process {pid} executable path is unavailable");
    }
    let executable_path = PathBuf::from(
        CStr::from_bytes_until_nul(unsafe {
            std::slice::from_raw_parts(path.as_ptr().cast::<u8>(), path.len())
        })?
        .to_string_lossy()
        .to_string(),
    );
    Ok(ProcessIdentity {
        pid,
        parent_pid: info.pbi_ppid,
        start_time_micros: info
            .pbi_start_tvsec
            .saturating_mul(1_000_000)
            .saturating_add(info.pbi_start_tvusec),
        executable_path,
    })
}

#[cfg(target_os = "linux")]
pub fn process_identity(pid: u32) -> Result<ProcessIdentity> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let suffix = stat.rsplit_once(") ").context("invalid /proc stat")?.1;
    let fields = suffix.split_whitespace().collect::<Vec<_>>();
    let parent_pid = fields.get(1).context("missing /proc parent PID")?.parse()?;
    let start_time_micros = fields
        .get(19)
        .context("missing /proc start time")?
        .parse()?;
    Ok(ProcessIdentity {
        pid,
        parent_pid,
        start_time_micros,
        executable_path: fs::read_link(format!("/proc/{pid}/exe"))?,
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn process_identity(_pid: u32) -> Result<ProcessIdentity> {
    anyhow::bail!("attested process identity is unsupported on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_process_identity_has_stable_kernel_fields() {
        let identity = process_identity(std::process::id()).unwrap();
        assert_eq!(identity.pid, std::process::id());
        assert_ne!(identity.parent_pid, 0);
        assert_ne!(identity.start_time_micros, 0);
        assert_eq!(
            canonical_path(&identity.executable_path).unwrap(),
            canonical_path(&std::env::current_exe().unwrap()).unwrap()
        );
    }

    #[test]
    fn antigravity_call_identity_ignores_json_rpc_id() {
        let request = |id| {
            json!({
                "jsonrpc":"2.0",
                "id":id,
                "method":"tools/call",
                "params":{
                    "name":"call_member",
                    "arguments":{"recipient":"agent-b","content":"hello"},
                    "_meta":{
                        "antigravity.google/conversation_id":"conversation-1",
                        "progressToken":"turn-1:3"
                    }
                }
            })
        };
        let identity = identity_by_antigravity_alias("call_member").unwrap();
        let input = json!({
            "recipient":"agent-b",
            "content":"hello"
        });
        assert_eq!(
            runtime_tool_call_identity(&request(4), identity, &input).unwrap(),
            runtime_tool_call_identity(&request(1), identity, &input).unwrap()
        );
    }

    #[test]
    fn antigravity_call_identity_separates_tool_and_input() {
        let request = json!({
            "jsonrpc":"2.0",
            "id":4,
            "method":"tools/call",
            "params":{
                "name":"call_member",
                "_meta":{
                    "antigravity.google/conversation_id":"conversation-1",
                    "progressToken":"turn-1:3"
                }
            }
        });
        let member_call = identity_by_antigravity_alias("call_member").unwrap();
        let list = identity_by_antigravity_alias("list_tasks").unwrap();
        assert_ne!(
            runtime_tool_call_identity(
                &request,
                member_call,
                &json!({
                    "recipient":"a", "content":"one"
                })
            )
            .unwrap(),
            runtime_tool_call_identity(
                &request,
                member_call,
                &json!({
                    "recipient":"a", "content":"two"
                })
            )
            .unwrap()
        );
        assert_ne!(
            runtime_tool_call_identity(&request, member_call, &json!({})).unwrap(),
            runtime_tool_call_identity(&request, list, &json!({})).unwrap()
        );
    }

    #[test]
    fn missing_runtime_metadata_fails_before_core_call() {
        let request = json!({
            "id":4,
            "method":"tools/call",
            "params":{"name":"call_member","arguments":{}}
        });
        assert!(
            runtime_tool_call_identity(
                &request,
                identity_by_antigravity_alias("call_member").unwrap(),
                &json!({})
            )
            .is_err()
        );
    }
}
