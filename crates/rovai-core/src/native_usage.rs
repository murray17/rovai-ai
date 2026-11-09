//! Numeric Usage from verified, root-agent native journals. No journal content
//! is retained or forwarded; a prompt starts with a cursor and identity baseline.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, Metadata, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{
    agent_profile::AdapterKind,
    monitoring::{
        ParsedRuntimeUsage, RuntimeInputSemantics, RuntimeUsageCost, RuntimeUsageCounterMode,
        RuntimeUsageFields,
    },
};

const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LINE_BYTES: u64 = 1024 * 1024;
const MAX_IDENTITIES: usize = 8192;

#[derive(Clone, Copy, Debug)]
enum Dialect {
    CodeBuddy,
    Kimi,
    Qoder,
    Trae,
    Minimax,
}

pub(crate) struct NativeUsageObservation {
    pub source_identity: String,
    pub usage: ParsedRuntimeUsage,
}

#[derive(Clone)]
pub(crate) struct NativeContextModel {
    pub model_id: String,
    pub window_tokens: Option<i64>,
}

pub(crate) enum NativeUsageReader {
    Jsonl(NativeJsonlUsageReader),
    OpenCode(OpenCodeUsageReader),
}

impl NativeUsageReader {
    pub(crate) fn minimax_tail(
        &self,
        message_ids: BTreeSet<String>,
        tool_call_ids: BTreeSet<String>,
    ) -> Option<Self> {
        let Self::Jsonl(reader) = self else {
            return None;
        };
        if !matches!(reader.dialect, Dialect::Minimax)
            || (message_ids.is_empty() && tool_call_ids.is_empty())
        {
            return None;
        }
        let mut reader = reader.clone();
        reader.minimax_messages = Some(message_ids);
        reader.minimax_tool_calls = tool_call_ids;
        // Compaction can replace the active journal during a prompt. Only this
        // frozen, identity-filtered tail may revisit native history artifacts.
        reader.disabled = false;
        Some(Self::Jsonl(reader))
    }
    pub(crate) fn for_prompt(
        kind: AdapterKind,
        workspace: &Path,
        session_id: &str,
        context_model: Option<NativeContextModel>,
    ) -> Option<Self> {
        if kind == AdapterKind::OpencodeCli {
            OpenCodeUsageReader::for_prompt(workspace, session_id).map(Self::OpenCode)
        } else {
            NativeJsonlUsageReader::for_prompt(kind, workspace, session_id).map(|mut reader| {
                reader.context_model = context_model;
                Self::Jsonl(reader)
            })
        }
    }
    pub(crate) fn for_minimax_prompt(
        root: &Path,
        workspace: &Path,
        session_id: &str,
    ) -> Option<Self> {
        let root = fs::canonicalize(root).ok()?;
        let path = minimax_session_path(&root, workspace.to_str()?, session_id).ok()?;
        NativeJsonlUsageReader::baseline(
            Dialect::Minimax,
            root,
            path,
            workspace.to_str()?.to_owned(),
            session_id.to_owned(),
        )
        .ok()
        .map(Self::Jsonl)
    }

    pub(crate) fn for_kilo_prompt(root: &Path, workspace: &Path, session_id: &str) -> Option<Self> {
        OpenCodeUsageReader::from_root(AdapterKind::KiloCli, root, workspace, session_id)
            .map(Self::OpenCode)
    }

    pub(crate) fn poll(&mut self) -> Vec<NativeUsageObservation> {
        match self {
            Self::Jsonl(reader) => reader.poll(),
            Self::OpenCode(reader) => reader.poll(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct NativeJsonlUsageReader {
    dialect: Dialect,
    root: PathBuf,
    path: PathBuf,
    workspace: String,
    session_id: String,
    offset: u64,
    file_identity: Option<FileIdentity>,
    skip_partial: bool,
    seen: BTreeSet<String>,
    disabled: bool,
    context_model: Option<NativeContextModel>,
    // A terminal reader admits only message or tool-call identities observed on
    // this exact ACP prompt. Tool-only assistant messages have no display ID.
    minimax_messages: Option<BTreeSet<String>>,
    minimax_canonical_messages: BTreeMap<String, String>,
    minimax_tool_calls: BTreeSet<String>,
}

#[derive(Clone, PartialEq, Eq)]
struct FileIdentity {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(not(unix))]
    created: Option<std::time::SystemTime>,
}

impl FileIdentity {
    fn from_metadata(metadata: &Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Self {
                dev: metadata.dev(),
                ino: metadata.ino(),
            }
        }
        #[cfg(not(unix))]
        {
            Self {
                created: metadata.created().ok(),
            }
        }
    }
}

impl NativeJsonlUsageReader {
    pub(crate) fn for_prompt(
        kind: AdapterKind,
        workspace: &Path,
        session_id: &str,
    ) -> Option<Self> {
        // Select a native format by Runtime and validate each record's shape
        // and ownership. Reported version is evidence, never a reader gate.
        if kind == AdapterKind::TraeCnCli {
            if !safe_identity(session_id) {
                return None;
            }
            let root = fs::canonicalize(dirs::cache_dir()?.join("trae-cli")).ok()?;
            let path = root.join("sessions").join(session_id).join("events.jsonl");
            return Self::baseline(
                Dialect::Trae,
                root,
                path,
                workspace.to_str()?.to_string(),
                session_id.to_string(),
            )
            .ok();
        }
        let (dialect, env_key, default_home) = match kind {
            AdapterKind::CodebuddyCli => (Dialect::CodeBuddy, "CODEBUDDY_CONFIG_DIR", ".codebuddy"),
            AdapterKind::KimiCodeCli => (Dialect::Kimi, "KIMI_CODE_HOME", ".kimi-code"),
            AdapterKind::QoderCli => (Dialect::Qoder, "QODER_CONFIG_DIR", ".qoder"),
            _ => return None,
        };
        if !safe_identity(session_id) || session_id.starts_with("agent-") {
            return None;
        }
        let home = std::env::var_os(env_key)
            .filter(|s| !s.to_string_lossy().trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|p| p.join(default_home)))?;
        let home = if home.is_absolute() {
            home
        } else {
            workspace.join(home)
        };
        let root = fs::canonicalize(home).ok()?;
        let workspace = workspace.to_str()?.to_string();
        let path = match dialect {
            Dialect::CodeBuddy => codebuddy_session_path(&root, &workspace, session_id),
            Dialect::Kimi => root
                .join("sessions")
                .join(kimi_workspace_key(&workspace))
                .join(session_id)
                .join("agents/main/wire.jsonl"),
            Dialect::Qoder => root
                .join("projects")
                .join(qoder_workspace_key(&workspace))
                .join(format!("{session_id}.jsonl")),
            Dialect::Minimax => unreachable!("MiniMax uses the frozen Host data directory"),
            Dialect::Trae => unreachable!("TRAE uses the platform cache root"),
        };
        Self::baseline(dialect, root, path, workspace, session_id.to_string()).ok()
    }

    fn baseline(
        dialect: Dialect,
        root: PathBuf,
        path: PathBuf,
        workspace: String,
        session_id: String,
    ) -> Result<Self> {
        let mut reader = Self {
            dialect,
            root,
            path,
            workspace,
            session_id,
            offset: 0,
            file_identity: None,
            skip_partial: false,
            seen: BTreeSet::new(),
            disabled: false,
            context_model: None,
            minimax_messages: None,
            minimax_canonical_messages: BTreeMap::new(),
            minimax_tool_calls: BTreeSet::new(),
        };
        if let Some(mut file) = reader.open()? {
            let metadata = file.metadata()?;
            if metadata.len() > MAX_JOURNAL_BYTES {
                bail!("native Usage baseline exceeds bound");
            }
            reader.file_identity = Some(FileIdentity::from_metadata(&metadata));
            let end = metadata.len();
            reader.read_complete_lines(&mut file, end, true)?;
            if reader.disabled {
                bail!("native Usage baseline is incomplete");
            }
            // An unfinished historical line is never completed into new Usage.
            reader.skip_partial = reader.offset < end;
            reader.offset = end;
        }
        Ok(reader)
    }

    fn open(&self) -> Result<Option<File>> {
        if matches!(self.dialect, Dialect::Trae) {
            let metadata_path = self
                .path
                .parent()
                .context("native Session directory is missing")?
                .join("session.json");
            let Some(file) = open_native_file(&self.root, &metadata_path)? else {
                if self.path.exists() {
                    bail!("native Session metadata is missing");
                }
                return Ok(None);
            };
            if file.metadata()?.len() > MAX_LINE_BYTES {
                bail!("native Session metadata exceeds bound");
            }
            let record: TraeSessionMetadata = serde_json::from_reader(file.take(MAX_LINE_BYTES))?;
            if record.id != self.session_id || record.metadata.cwd != self.workspace {
                bail!("native Session identity does not match");
            }
        }
        if matches!(self.dialect, Dialect::Minimax)
            && minimax_session_path(&self.root, &self.workspace, &self.session_id)? != self.path
        {
            bail!("native Usage Session location changed");
        }
        open_native_file(&self.root, &self.path)
    }

    pub(crate) fn poll(&mut self) -> Vec<NativeUsageObservation> {
        if self.disabled {
            return Vec::new();
        }
        match self.poll_checked() {
            Ok(observations) => observations,
            Err(_) => {
                // A reset, replacement or gap cannot restart from byte zero and
                // silently claim historical consumption for this prompt.
                self.disabled = true;
                Vec::new()
            }
        }
    }

    fn poll_checked(&mut self) -> Result<Vec<NativeUsageObservation>> {
        if self.minimax_messages.is_some() {
            return self.poll_minimax_tail();
        }
        let Some(mut file) = self.open()? else {
            if self.file_identity.is_some() {
                bail!("native Usage journal disappeared");
            }
            return Ok(Vec::new());
        };
        let metadata = file.metadata()?;
        let identity = FileIdentity::from_metadata(&metadata);
        if metadata.len() < self.offset
            || metadata.len() > MAX_JOURNAL_BYTES
            || self
                .file_identity
                .as_ref()
                .is_some_and(|old| old != &identity)
        {
            bail!("native Usage journal continuity lost");
        }
        self.file_identity = Some(identity);
        file.seek(SeekFrom::Start(self.offset))?;
        self.read_complete_lines(&mut file, metadata.len(), false)
    }

    fn poll_minimax_tail(&mut self) -> Result<Vec<NativeUsageObservation>> {
        anyhow::ensure!(
            minimax_session_path(&self.root, &self.workspace, &self.session_id)? == self.path,
            "native Usage Session location changed"
        );
        self.minimax_canonical_messages = minimax_message_bindings(
            &self.root,
            &self.session_id,
            self.minimax_messages
                .as_ref()
                .context("missing terminal identities")?,
        )?;
        let paths = minimax_history_artifacts(&self.root, &self.path, &self.session_id)?;
        let mut remaining = MAX_JOURNAL_BYTES;
        let mut observations = Vec::new();
        // Active history wins over its older snapshots. The exact ACP identities
        // and original baseline remain mandatory, even after a file replacement.
        for path in paths {
            let Some(mut file) = open_native_file(&self.root, &path)? else {
                continue;
            };
            let end = file.metadata()?.len();
            anyhow::ensure!(end <= remaining, "native Usage history exceeds bound");
            remaining -= end;
            self.offset = 0;
            self.skip_partial = false;
            observations.extend(self.read_complete_lines(&mut file, end, false)?);
            if self.disabled {
                break;
            }
        }
        Ok(observations)
    }

    fn read_complete_lines(
        &mut self,
        file: &mut File,
        end: u64,
        baseline: bool,
    ) -> Result<Vec<NativeUsageObservation>> {
        let mut input = BufReader::new(file.take(end - self.offset));
        let mut observations = Vec::new();
        loop {
            let mut line = Vec::new();
            let count = match input
                .by_ref()
                .take(MAX_LINE_BYTES + 1)
                .read_until(b'\n', &mut line)
            {
                Ok(count) => count,
                Err(_) => {
                    self.disabled = true;
                    break;
                }
            };
            if count == 0 {
                break;
            }
            if count as u64 > MAX_LINE_BYTES {
                self.disabled = true;
                break;
            }
            if line.last() != Some(&b'\n') {
                break;
            }
            self.offset += count as u64;
            if self.skip_partial {
                self.skip_partial = false;
                continue;
            }
            let incoming = match self.dialect {
                Dialect::CodeBuddy => {
                    let Some(record) = codebuddy_record(&line, &self.session_id, &self.workspace)
                    else {
                        continue;
                    };
                    let baseline_id = format!(
                        "codebuddy-baseline:{}:{}",
                        self.session_id,
                        record
                            .provider_data
                            .as_ref()
                            .unwrap()
                            .message_id
                            .as_deref()
                            .unwrap()
                    );
                    if baseline {
                        if self.seen.len() >= MAX_IDENTITIES {
                            self.disabled = true;
                            break;
                        }
                        self.seen.insert(baseline_id);
                        continue;
                    }
                    if self.seen.contains(&baseline_id) {
                        continue;
                    }
                    let mut calls: Vec<_> =
                        parse_codebuddy(&line, &self.session_id, &self.workspace)
                            .into_iter()
                            .collect();
                    if let Some(call) = calls.first()
                        && let Some(context) = self.context_model.as_ref()
                        && let Some(gauge) = codebuddy_context(&line, call, context)
                    {
                        calls.push(gauge);
                    }
                    calls
                }
                Dialect::Minimax => {
                    let Some(record) = minimax_record(&line) else {
                        continue;
                    };
                    let id = format!("minimax-native:{}:{}", self.session_id, record.message_id);
                    if self.minimax_messages.is_some()
                        && !self
                            .minimax_canonical_messages
                            .get(&record.message_id)
                            .map_or_else(
                                || {
                                    record.turn_id.as_ref().is_some_and(|turn| {
                                        self.minimax_canonical_messages
                                            .values()
                                            .any(|observed| observed == turn)
                                    }) && !record
                                        .message
                                        .tool_call_ids
                                        .is_disjoint(&self.minimax_tool_calls)
                                },
                                |turn_id| record.turn_id.as_ref() == Some(turn_id),
                            )
                    {
                        continue;
                    }
                    if baseline {
                        if self.seen.len() >= MAX_IDENTITIES {
                            self.disabled = true;
                            break;
                        }
                        self.seen.insert(id);
                        continue;
                    }
                    parse_minimax(&line, &self.session_id).into_iter().collect()
                }
                Dialect::Kimi => parse_kimi(&line, &self.session_id).into_iter().collect(),
                Dialect::Trae => {
                    let Some(record) = trae_record(&line, &self.session_id) else {
                        continue;
                    };
                    let baseline_id = format!("trae-baseline:{}:{}", self.session_id, record.id);
                    if baseline {
                        if self.seen.len() >= MAX_IDENTITIES {
                            self.disabled = true;
                            break;
                        }
                        self.seen.insert(baseline_id);
                        continue;
                    }
                    if self.seen.contains(&baseline_id) {
                        continue;
                    }
                    let mut calls: Vec<_> =
                        parse_trae(record, &self.session_id).into_iter().collect();
                    if let Some(call) = calls.first()
                        && let Some(model) = self.context_model.as_ref()
                        && let Some(gauge) = trae_context(&line, call, model)
                    {
                        calls.push(gauge);
                    }
                    calls
                }
                Dialect::Qoder => {
                    let Some(record) = qoder_record(&line, &self.session_id, &self.workspace)
                    else {
                        continue;
                    };
                    // Qoder appends incomplete assistant snapshots before their
                    // Usage. An old pending message must also belong to the
                    // baseline, even if its final Usage arrives after this prompt.
                    let baseline_id =
                        format!("qoder-baseline:{}:{}", self.session_id, record.message.id);
                    if baseline {
                        if self.seen.len() >= MAX_IDENTITIES {
                            self.disabled = true;
                            break;
                        }
                        self.seen.insert(baseline_id);
                        continue;
                    }
                    if self.seen.contains(&baseline_id) {
                        continue;
                    }
                    let mut calls = parse_qoder(record, &self.session_id);
                    if let Some(model) = &self.context_model {
                        supplement_qoder_context(&line, &mut calls, model);
                    }
                    calls
                }
            };
            for observation in incoming {
                if self.seen.contains(&observation.source_identity) {
                    continue;
                }
                if self.seen.len() >= MAX_IDENTITIES {
                    self.disabled = true;
                    break;
                }
                self.seen.insert(observation.source_identity.clone());
                if !baseline {
                    observations.push(observation);
                }
            }
            if self.disabled {
                break;
            }
        }
        Ok(observations)
    }
}

// Only locators and explicit identity mappings are selected, never message bodies.
fn open_minimax_database(root: &Path) -> Result<rusqlite::Connection> {
    let path = root.join("v2/sqlite/runtime-state.sqlite");
    open_native_file(root, &path)?.context("MiniMax Session index missing")?;
    let c = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
            | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    c.busy_timeout(std::time::Duration::from_millis(250))?;
    Ok(c)
}

fn minimax_history_artifacts(root: &Path, active: &Path, session_id: &str) -> Result<Vec<PathBuf>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Catalog {
        schema_version: u32,
        session_id: String,
        artifacts: Vec<Artifact>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Artifact {
        generation: u64,
        kind: String,
        file_name: String,
    }
    let directory = active
        .parent()
        .context("missing native history directory")?;
    let mut paths = vec![active.to_path_buf()];
    let Some(file) = open_native_file(root, &directory.join("history-catalog.json"))? else {
        return Ok(paths);
    };
    anyhow::ensure!(
        file.metadata()?.len() <= MAX_LINE_BYTES,
        "native history catalog exceeds bound"
    );
    let catalog: Catalog = serde_json::from_reader(file.take(MAX_LINE_BYTES))?;
    anyhow::ensure!(
        catalog.schema_version == 1 && catalog.session_id == session_id,
        "native history catalog does not match"
    );
    anyhow::ensure!(
        catalog.artifacts.len() <= MAX_IDENTITIES,
        "native history catalog exceeds bound"
    );
    let mut snapshots: Vec<_> = catalog
        .artifacts
        .into_iter()
        .filter(|item| item.kind == "snapshot")
        .collect();
    snapshots.sort_by_key(|item| std::cmp::Reverse(item.generation));
    for item in snapshots.into_iter().take(63) {
        let prefix = format!("g{:012}--ctx_", item.generation);
        let identity = item
            .file_name
            .strip_prefix(&prefix)
            .and_then(|name| name.strip_suffix(".jsonl"));
        anyhow::ensure!(
            identity.is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()),
            "invalid native history artifact"
        );
        paths.push(directory.join("snapshots").join(item.file_name));
    }
    Ok(paths)
}

fn minimax_message_bindings(
    root: &Path,
    session_id: &str,
    ids: &BTreeSet<String>,
) -> Result<BTreeMap<String, String>> {
    let c = open_minimax_database(root)?;
    let mut query = c.prepare(
        "SELECT json_extract(data_json,'$.canonical_message_id'),turn_id FROM local_runtime_message_rows
         WHERE session_id=?1 AND msg_id=?2 AND role='assistant' AND json_valid(data_json) LIMIT 2"
    )?;
    let mut bindings = BTreeMap::new();
    for id in ids {
        let rows = query
            .query_map(rusqlite::params![session_id, id], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if let [(Some(canonical), turn)] = rows.as_slice()
            && safe_identity(canonical)
            && safe_identity(turn)
        {
            if bindings
                .get(canonical)
                .is_some_and(|existing| existing != turn)
            {
                bail!("conflicting MiniMax message binding");
            }
            bindings.insert(canonical.clone(), turn.clone());
        }
    }
    Ok(bindings)
}

fn minimax_session_path(root: &Path, workspace: &str, session_id: &str) -> Result<PathBuf> {
    anyhow::ensure!(
        safe_identity(session_id),
        "invalid MiniMax Session identity"
    );
    let c = open_minimax_database(root)?;
    let (cwd, parent, relative): (String, Option<String>, String) = c.query_row(
        "SELECT workspace_dir,parent_session_id,history_relative_dir FROM local_runtime_sessions WHERE session_id=?1",
        [session_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    // ACP uses Win32 paths while the Core freezes canonical verbatim paths.
    // Compare their equivalent lexical representations without admitting a
    // different workspace or weakening the exact root-Session identity check.
    #[cfg(windows)]
    let same_workspace =
        dunce::simplified(Path::new(&cwd)) == dunce::simplified(Path::new(workspace));
    #[cfg(not(windows))]
    let same_workspace = cwd == workspace;
    anyhow::ensure!(
        same_workspace && parent.is_none(),
        "MiniMax root Session does not match"
    );
    anyhow::ensure!(
        !relative.is_empty()
            && Path::new(&relative)
                .components()
                .all(|part| matches!(part, Component::Normal(_))),
        "MiniMax history path is invalid"
    );
    Ok(root
        .join("v2/sessions")
        .join(relative)
        .join("messages.jsonl"))
}

#[derive(Deserialize)]
struct MinimaxRecord {
    message_id: String,
    turn_id: Option<String>,
    message: MinimaxMessage,
}
#[derive(Deserialize)]
struct MinimaxMessage {
    role: String,
    #[serde(rename = "stopReason")]
    stop_reason: Option<String>,
    usage: Option<MinimaxUsage>,
    timestamp: Option<i64>,
    #[serde(
        default,
        rename = "content",
        deserialize_with = "minimax_content_tool_ids"
    )]
    tool_call_ids: BTreeSet<String>,
}

fn minimax_content_tool_ids<'de, D>(
    deserializer: D,
) -> std::result::Result<BTreeSet<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Part {
        #[serde(rename = "type")]
        kind: Option<String>,
        id: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Content {
        Parts(Vec<Part>),
        Other(serde::de::IgnoredAny),
    }
    Ok(match Content::deserialize(deserializer)? {
        Content::Parts(parts) => parts
            .into_iter()
            .filter(|part| part.kind.as_deref() == Some("toolCall"))
            .filter_map(|part| part.id.filter(|id| !id.is_empty() && id.len() <= 256))
            .take(MAX_IDENTITIES)
            .collect(),
        Content::Other(_) => BTreeSet::new(),
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MinimaxUsage {
    input: Option<i64>,
    output: Option<i64>,
    cache_read: Option<i64>,
    cache_write: Option<i64>,
}

fn minimax_record(line: &[u8]) -> Option<MinimaxRecord> {
    let record: MinimaxRecord = serde_json::from_slice(line).ok()?;
    (record.message.role == "assistant" && safe_identity(&record.message_id)).then_some(record)
}
fn parse_minimax(line: &[u8], session_id: &str) -> Option<NativeUsageObservation> {
    let record = minimax_record(line)?;
    if !matches!(
        record.message.stop_reason.as_deref(),
        Some("stop" | "toolUse" | "length")
    ) {
        return None;
    }
    let raw = record.message.usage?;
    Some(observation(
        session_id,
        format!("minimax-native:{session_id}:{}", record.message_id),
        "minimax-native-message-usage-v1",
        record.turn_id,
        RuntimeInputSemantics::ExclusiveBuckets,
        RuntimeUsageFields {
            input_tokens: nonnegative(raw.input),
            output_tokens: nonnegative(raw.output),
            cache_read_input_tokens: nonnegative(raw.cache_read),
            cache_write_input_tokens: nonnegative(raw.cache_write),
            ..RuntimeUsageFields::default()
        },
        record.message.timestamp,
    ))
}

fn open_native_file(root: &Path, file_path: &Path) -> Result<Option<File>> {
    let relative = file_path.strip_prefix(root)?;
    let mut path = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            bail!("native Usage path is invalid");
        }
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => bail!("native Usage path is a link"),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => bail!("native Usage journal is unavailable"),
        }
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(file_path)
        .map_err(|_| anyhow::anyhow!("native Usage journal is unavailable"))?;
    if !file.metadata()?.is_file() {
        bail!("native Usage journal is not a regular file");
    }
    Ok(Some(file))
}

pub(crate) struct OpenCodeUsageReader {
    kind: AdapterKind,
    path: PathBuf,
    workspace: String,
    session_id: String,
    file_identity: FileIdentity,
    seen: BTreeSet<String>,
    disabled: bool,
}

impl OpenCodeUsageReader {
    fn for_prompt(workspace: &Path, session_id: &str) -> Option<Self> {
        let kind = AdapterKind::OpencodeCli;
        let data = crate::runtime_discovery::runtime_environment_variable(kind, "XDG_DATA_HOME")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                crate::runtime_discovery::runtime_home_directory(kind)
                    .map(|home| home.join(".local/share"))
            })?;
        if !data.is_absolute() {
            return None;
        }
        Self::from_root(kind, &data.join("opencode"), workspace, session_id)
    }

    fn from_root(
        kind: AdapterKind,
        root: &Path,
        workspace: &Path,
        session_id: &str,
    ) -> Option<Self> {
        if !safe_identity(session_id) {
            return None;
        }
        let app = if kind == AdapterKind::KiloCli {
            "kilo"
        } else {
            "opencode"
        };
        let root = fs::canonicalize(root).ok()?;
        let path = root.join(format!("{app}.db"));
        Self::baseline(
            path,
            workspace.to_str()?.to_string(),
            session_id.to_string(),
        )
        .ok()
        .map(|mut reader| {
            reader.kind = kind;
            reader
        })
    }

    fn baseline(path: PathBuf, workspace: String, session_id: String) -> Result<Self> {
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            bail!("native Usage database is not a regular file");
        }
        let mut reader = Self {
            kind: AdapterKind::OpencodeCli,
            path,
            workspace,
            session_id,
            file_identity: FileIdentity::from_metadata(&metadata),
            seen: BTreeSet::new(),
            disabled: false,
        };
        let database = reader.open()?;
        reader.validate_session(&database)?;
        let mut query = database.prepare("SELECT id FROM message WHERE session_id=?1 LIMIT ?2")?;
        let ids = query.query_map(
            rusqlite::params![reader.session_id, (MAX_IDENTITIES + 1) as i64],
            |row| row.get::<_, String>(0),
        )?;
        for id in ids {
            reader.seen.insert(id?);
        }
        if reader.seen.len() > MAX_IDENTITIES {
            bail!("native Usage baseline exceeds identity bound");
        }
        Ok(reader)
    }

    fn open(&self) -> Result<rusqlite::Connection> {
        let metadata = fs::symlink_metadata(&self.path)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || FileIdentity::from_metadata(&metadata) != self.file_identity
        {
            bail!("native Usage database continuity lost");
        }
        let database = rusqlite::Connection::open_with_flags(
            &self.path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        database.busy_timeout(std::time::Duration::from_millis(250))?;
        Ok(database)
    }

    fn validate_session(&self, database: &rusqlite::Connection) -> Result<()> {
        let (directory, parent) = database.query_row(
            "SELECT directory,parent_id FROM session WHERE id=?1",
            [&self.session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )?;
        if directory != self.workspace || parent.is_some() {
            bail!("native Usage root Session does not match");
        }
        Ok(())
    }

    fn poll(&mut self) -> Vec<NativeUsageObservation> {
        if self.disabled {
            return Vec::new();
        }
        match self.poll_checked() {
            Ok(value) => value,
            Err(_) => {
                self.disabled = true;
                Vec::new()
            }
        }
    }

    fn poll_checked(&mut self) -> Result<Vec<NativeUsageObservation>> {
        let database = self.open()?;
        self.validate_session(&database)?;
        // Only metadata scalars leave SQLite. Native parts and message bodies
        // are never selected into Core memory or its public Evidence channel.
        let mut query = database.prepare(
            "SELECT id,
            CASE WHEN json_type(data,'$.tokens.input')='integer' THEN json_extract(data,'$.tokens.input') END, CASE WHEN json_type(data,'$.tokens.output')='integer' THEN json_extract(data,'$.tokens.output') END,
            CASE WHEN json_type(data,'$.tokens.reasoning')='integer' THEN json_extract(data,'$.tokens.reasoning') END, CASE WHEN json_type(data,'$.tokens.cache.read')='integer' THEN json_extract(data,'$.tokens.cache.read') END,
            CASE WHEN json_type(data,'$.tokens.cache.write')='integer' THEN json_extract(data,'$.tokens.cache.write') END, json_extract(data,'$.time.completed'), CASE WHEN json_type(data,'$.providerID')='text' THEN json_extract(data,'$.providerID') END, CASE WHEN json_type(data,'$.modelID')='text' THEN json_extract(data,'$.modelID') END,
            CASE WHEN json_type(data,'$.cost') IN ('integer','real') THEN json_extract(data,'$.cost') END
            FROM message WHERE session_id=?1 AND json_valid(data)
                AND json_extract(data,'$.role')='assistant'
                AND json_type(data,'$.time.completed')='integer'
                AND (json_type(data,'$.error') IS NULL OR json_type(data,'$.error')='null')
            ORDER BY time_created,id LIMIT ?2",
        )?;
        let rows = query.query_map(
            rusqlite::params![self.session_id, (MAX_IDENTITIES + 1) as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    RuntimeUsageFields {
                        input_tokens: row.get(1)?,
                        output_tokens: row.get(2)?,
                        reasoning_output_tokens: row.get(3)?,
                        cache_read_input_tokens: row.get(4)?,
                        cache_write_input_tokens: row.get(5)?,
                        ..Default::default()
                    },
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<f64>>(9)?,
                ))
            },
        )?;
        let mut result = Vec::new();
        for row in rows {
            let (id, mut fields, time, provider, model, cost) = row?;
            if self.seen.contains(&id) {
                continue;
            }
            if self.seen.len() >= MAX_IDENTITIES || !safe_identity(&id) {
                self.disabled = true;
                break;
            }
            self.seen.insert(id.clone());
            fields.output_tokens = match (fields.output_tokens, fields.reasoning_output_tokens) {
                (Some(output), Some(reasoning)) if output >= 0 && reasoning >= 0 => {
                    output.checked_add(reasoning)
                }
                _ => None,
            };
            let mut consumption = observation(
                &self.session_id,
                format!(
                    "{}-native:{}:{id}",
                    self.kind.command_name(),
                    self.session_id
                ),
                if self.kind == AdapterKind::KiloCli {
                    "kilo-native-message-usage-v1"
                } else {
                    "opencode-native-message-usage-v1"
                },
                None,
                RuntimeInputSemantics::ExclusiveBuckets,
                fields.clone(),
                time,
            );
            if self.kind == AdapterKind::KiloCli {
                consumption.usage.cost = cost
                    .filter(|value| value.is_finite() && *value >= 0.0)
                    .map(|amount| RuntimeUsageCost {
                        amount: amount.to_string(),
                        currency: "USD".into(),
                        quality: "runtime_reported".into(),
                        grain: "model_call".into(),
                    });
            }
            result.push(consumption);
            // The installed ACPUsage.contextTokens() defines occupancy as the
            // latest call's input + both cache buckets, excluding output. ACP
            // supplies size from its effective Provider/Model catalog when
            // known. Preserve used alone when the native catalog has no limit.
            let used = fields
                .input_tokens
                .zip(fields.cache_read_input_tokens)
                .zip(fields.cache_write_input_tokens)
                .filter(|((input, read), write)| *input >= 0 && *read >= 0 && *write >= 0)
                .and_then(|((input, read), write)| input.checked_add(read)?.checked_add(write));
            if let Some(used) = used {
                let mut gauge = observation(
                    &self.session_id,
                    format!(
                        "{}-context:{}:{id}",
                        self.kind.command_name(),
                        self.session_id
                    ),
                    if self.kind == AdapterKind::KiloCli {
                        "kilo-native-call-context-v1"
                    } else {
                        "opencode-native-call-context-v1"
                    },
                    None,
                    RuntimeInputSemantics::Unknown,
                    RuntimeUsageFields {
                        context_used_tokens: Some(used),
                        ..Default::default()
                    },
                    time,
                );
                gauge.usage.scope = "session".into();
                gauge.usage.counter_mode = RuntimeUsageCounterMode::Gauge;
                gauge.usage.identity_suffix = "native_context".into();
                gauge.usage.context_model_id = provider
                    .zip(model)
                    .filter(|(provider, model)| !provider.is_empty() && !model.is_empty())
                    .map(|(provider, model)| format!("{provider}/{model}"));
                result.push(gauge);
            }
        }
        Ok(result)
    }
}

fn safe_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

pub(crate) fn codebuddy_session_path(root: &Path, workspace: &str, session_id: &str) -> PathBuf {
    root.join("projects")
        .join(codebuddy_workspace_key(workspace))
        .join(format!("{session_id}.jsonl"))
}

fn codebuddy_workspace_key(workspace: &str) -> String {
    workspace
        .split(['/', '\\', ':', '-'])
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn qoder_workspace_key(workspace: &str) -> String {
    workspace
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn kimi_workspace_key(workspace: &str) -> String {
    let normalized = workspace.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let mut slug = String::new();
    for c in normalized
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_lowercase()
        .chars()
    {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            slug.push(c);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-').chars().take(40).collect::<String>();
    let slug = slug.trim_matches('-');
    let slug = if matches!(slug, "" | "." | "..") {
        "workspace"
    } else {
        slug
    };
    let digest = format!("{:x}", Sha256::digest(normalized.as_bytes()));
    format!("wd_{slug}_{}", &digest[..12])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeBuddyRecord {
    #[serde(rename = "type")]
    kind: String,
    role: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    timestamp: Option<i64>,
    provider_data: Option<CodeBuddyProvider>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeBuddyProvider {
    message_id: Option<String>,
    agent: Option<String>,
    model: Option<String>,
    raw_usage: Option<OpenAiUsage>,
}
#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    prompt_tokens_details: Option<PromptDetails>,
    completion_tokens_details: Option<CompletionDetails>,
}
#[derive(Deserialize)]
struct PromptDetails {
    cached_tokens: Option<i64>,
}
#[derive(Deserialize)]
struct CompletionDetails {
    reasoning_tokens: Option<i64>,
}

fn nonnegative(value: Option<i64>) -> Option<i64> {
    value.filter(|n| *n >= 0)
}

fn observation(
    session_id: &str,
    identity: String,
    dialect: &str,
    turn: Option<String>,
    semantics: RuntimeInputSemantics,
    fields: RuntimeUsageFields,
    time: Option<i64>,
) -> NativeUsageObservation {
    NativeUsageObservation {
        source_identity: identity,
        usage: ParsedRuntimeUsage {
            identity_suffix: "native_model_call".to_string(),
            dialect_id: dialect.to_string(),
            source: "runtime_private_extension".to_string(),
            scope: "model_call".to_string(),
            counter_mode: RuntimeUsageCounterMode::Delta,
            input_semantics: semantics,
            native_session_id: Some(session_id.to_string()),
            native_turn_id: turn,
            fields,
            cost: None,
            context_model_id: None,
            occurred_at: time
                .and_then(DateTime::<Utc>::from_timestamp_millis)
                .map(|t| t.to_rfc3339()),
        },
    }
}

fn codebuddy_record(line: &[u8], session_id: &str, workspace: &str) -> Option<CodeBuddyRecord> {
    let record: CodeBuddyRecord = serde_json::from_slice(line).ok()?;
    if record.session_id.as_deref() != Some(session_id)
        || record.cwd.as_deref() != Some(workspace)
        || !(record.kind == "function_call"
            || (record.kind == "message" && record.role.as_deref() == Some("assistant")))
    {
        return None;
    }
    let provider = record.provider_data.as_ref()?;
    if provider.agent.as_deref() != Some("cli")
        || !provider.message_id.as_deref().is_some_and(safe_identity)
    {
        return None;
    }
    Some(record)
}

fn parse_codebuddy(
    line: &[u8],
    session_id: &str,
    workspace: &str,
) -> Option<NativeUsageObservation> {
    let record = codebuddy_record(line, session_id, workspace)?;
    let provider = record.provider_data?;
    if provider.agent.as_deref() != Some("cli") {
        return None;
    }
    let id = provider.message_id.filter(|id| safe_identity(id))?;
    let raw = provider.raw_usage?;
    let output = nonnegative(raw.completion_tokens);
    Some(observation(
        session_id,
        format!("codebuddy-native:{session_id}:{id}"),
        "codebuddy-native-raw-usage-v1",
        None,
        RuntimeInputSemantics::CacheInclusiveTotal,
        RuntimeUsageFields {
            input_tokens: nonnegative(raw.prompt_tokens),
            output_tokens: output,
            cache_read_input_tokens: raw
                .prompt_tokens_details
                .and_then(|d| nonnegative(d.cached_tokens)),
            reasoning_output_tokens: raw
                .completion_tokens_details
                .and_then(|d| nonnegative(d.reasoning_tokens))
                .filter(|n| output.is_some_and(|out| *n <= out)),
            ..RuntimeUsageFields::default()
        },
        record.timestamp,
    ))
}

fn codebuddy_context(
    line: &[u8],
    call: &NativeUsageObservation,
    model: &NativeContextModel,
) -> Option<NativeUsageObservation> {
    // The native status line uses the most recent root call's inputTokens and
    // the selected model's maxInputTokens. Never use the whole Run's Usage.
    let record: CodeBuddyRecord = serde_json::from_slice(line).ok()?;
    if record.provider_data?.model.as_deref() != Some(model.model_id.as_str()) {
        return None;
    }
    let used = call.usage.fields.input_tokens?;
    let window = model.window_tokens.filter(|n| *n > 0);
    let mut gauge = observation(
        call.usage.native_session_id.as_deref()?,
        format!("{}:context", call.source_identity),
        "codebuddy-native-call-context-v1",
        None,
        RuntimeInputSemantics::Unknown,
        RuntimeUsageFields {
            context_used_tokens: Some(used),
            context_size_tokens: window,
            ..Default::default()
        },
        record.timestamp,
    );
    gauge.usage.scope = "session".into();
    gauge.usage.counter_mode = RuntimeUsageCounterMode::Gauge;
    gauge.usage.identity_suffix = "native_context".into();
    gauge.usage.context_model_id = Some(model.model_id.clone());
    Some(gauge)
}

#[derive(Deserialize)]
struct TraeSessionMetadata {
    id: String,
    metadata: TraeWorkspaceMetadata,
}
#[derive(Deserialize)]
struct TraeWorkspaceMetadata {
    cwd: String,
}
#[derive(Deserialize)]
struct TraeRecord {
    id: String,
    session_id: String,
    branch: String,
    agent_name: String,
    agent_id: String,
    parent_tool_call_id: String,
    created_at: String,
    message: TraeMessageEvent,
}
#[derive(Deserialize)]
struct TraeMessageEvent {
    message: TraeMessage,
}
#[derive(Deserialize)]
struct TraeMessage {
    role: String,
    response_meta: Option<TraeResponseMeta>,
    extra: Option<TraeMessageExtra>,
}
#[derive(Deserialize)]
struct TraeMessageExtra {
    #[serde(rename = "_source_model")]
    source_model: Option<String>,
}
#[derive(Deserialize)]
struct TraeResponseMeta {
    usage: Option<TraeUsage>,
}
#[derive(Deserialize)]
struct TraeUsage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    prompt_token_details: Option<PromptDetails>,
}
fn trae_record(line: &[u8], session_id: &str) -> Option<TraeRecord> {
    let record: TraeRecord = serde_json::from_slice(line).ok()?;
    (record.session_id == session_id
        && record.branch == "Trae CLI"
        && record.agent_name == "Trae CLI"
        && safe_identity(&record.agent_id)
        && record.parent_tool_call_id.is_empty()
        && safe_identity(&record.id)
        && record.message.message.role == "assistant")
        .then_some(record)
}
fn parse_trae(record: TraeRecord, session_id: &str) -> Option<NativeUsageObservation> {
    let time = DateTime::parse_from_rfc3339(&record.created_at)
        .ok()?
        .timestamp_millis();
    let usage = record.message.message.response_meta?.usage?;
    let fields = RuntimeUsageFields {
        input_tokens: nonnegative(usage.prompt_tokens),
        output_tokens: nonnegative(usage.completion_tokens),
        cache_read_input_tokens: usage
            .prompt_token_details
            .and_then(|v| nonnegative(v.cached_tokens)),
        ..Default::default()
    };
    if fields.input_tokens.is_none()
        && fields.output_tokens.is_none()
        && fields.cache_read_input_tokens.is_none()
    {
        return None;
    }
    Some(observation(
        session_id,
        format!("trae-native:{session_id}:{}", record.id),
        "trae-native-model-call-v1",
        None,
        RuntimeInputSemantics::CacheInclusiveTotal,
        fields,
        Some(time),
    ))
}

fn trae_context(
    line: &[u8],
    call: &NativeUsageObservation,
    model: &NativeContextModel,
) -> Option<NativeUsageObservation> {
    let record: TraeRecord = serde_json::from_slice(line).ok()?;
    if record.message.message.extra?.source_model.as_deref() != Some(model.model_id.as_str()) {
        return None;
    }
    // Native /context's calibrated used count is the latest root prompt_tokens,
    // excluding that response and prior calls. Verified against a long response.
    let used = call.usage.fields.input_tokens?;
    if used <= 0 {
        return None;
    }
    let mut context = call.usage.clone();
    context.identity_suffix = "native_context".into();
    context.dialect_id = "trae-native-calibrated-context-v1".into();
    context.context_model_id = Some(model.model_id.clone());
    context.scope = "session".into();
    context.counter_mode = RuntimeUsageCounterMode::Gauge;
    context.input_semantics = RuntimeInputSemantics::Unknown;
    context.fields = RuntimeUsageFields {
        context_used_tokens: Some(used),
        context_size_tokens: model.window_tokens,
        ..Default::default()
    };
    Some(NativeUsageObservation {
        source_identity: format!("{}:context", call.source_identity),
        usage: context,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KimiRecord {
    #[serde(rename = "type")]
    kind: String,
    agent_id: Option<String>,
    event: Option<KimiEvent>,
    time: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KimiEvent {
    #[serde(rename = "type")]
    kind: String,
    uuid: Option<String>,
    turn_id: Option<String>,
    usage: Option<KimiUsage>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KimiUsage {
    input_other: Option<i64>,
    output: Option<i64>,
    input_cache_read: Option<i64>,
    input_cache_creation: Option<i64>,
}

fn parse_kimi(line: &[u8], session_id: &str) -> Option<NativeUsageObservation> {
    let record: KimiRecord = serde_json::from_slice(line).ok()?;
    if record.kind != "context.append_loop_event" || record.agent_id.as_deref() != Some("main") {
        return None;
    }
    let event = record.event?;
    if event.kind != "step.end" {
        return None;
    }
    let id = event.uuid.filter(|id| safe_identity(id))?;
    let raw = event.usage?;
    Some(observation(
        session_id,
        format!("kimi-native:{session_id}:{id}"),
        "kimi-native-step-usage-v1",
        event.turn_id,
        RuntimeInputSemantics::ExclusiveBuckets,
        RuntimeUsageFields {
            input_tokens: nonnegative(raw.input_other),
            output_tokens: nonnegative(raw.output),
            cache_read_input_tokens: nonnegative(raw.input_cache_read),
            cache_write_input_tokens: nonnegative(raw.input_cache_creation),
            ..RuntimeUsageFields::default()
        },
        record.time,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QoderRecord {
    #[serde(rename = "type")]
    kind: String,
    session_id: String,
    cwd: String,
    is_sidechain: bool,
    entrypoint: String,
    model_source: Option<String>,
    timestamp: String,
    message: QoderMessage,
}
#[derive(Deserialize)]
struct QoderMessage {
    id: String,
    role: String,
    model: Option<String>,
    usage: Option<QoderUsage>,
}
#[derive(Deserialize)]
struct QoderUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_read_input_tokens: Option<i64>,
    cache_creation_input_tokens: Option<i64>,
    context_usage_ratio: Option<f64>,
}

pub(crate) fn qoder_context_model(model_id: String) -> Option<NativeContextModel> {
    use crate::runtime_discovery::{runtime_environment_variable, runtime_home_directory};
    let root = runtime_environment_variable(AdapterKind::QoderCli, "QODER_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| runtime_home_directory(AdapterKind::QoderCli).map(|p| p.join(".qoder")))?;
    if !root.is_absolute() {
        return None;
    }
    let mut file = open_native_file(&root, &root.join("settings.json")).ok()??;
    if file.metadata().ok()?.len() > MAX_LINE_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_LINE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_LINE_BYTES {
        return None;
    }
    Some(NativeContextModel {
        window_tokens: qoder_configured_window(&bytes, &model_id),
        model_id,
    })
}

fn qoder_configured_window(bytes: &[u8], model_id: &str) -> Option<i64> {
    #[derive(Deserialize)]
    struct Settings {
        providers: BTreeMap<String, Provider>,
    }
    #[derive(Deserialize)]
    struct Provider {
        models: Vec<Model>,
    }
    #[derive(Deserialize)]
    struct Model {
        model: String,
        #[serde(rename = "contextWindow")]
        window: Option<i64>,
    }
    let (provider, model) = model_id.split_once('/')?;
    let settings: Settings = serde_json::from_slice(bytes).ok()?;
    let mut matches = settings
        .providers
        .get(provider)?
        .models
        .iter()
        .filter(|m| m.model == model);
    let window = matches.next()?.window?;
    (matches.next().is_none() && window > 0 && window <= 9_007_199_254_740_991).then_some(window)
}

fn supplement_qoder_context(
    line: &[u8],
    calls: &mut [NativeUsageObservation],
    model: &NativeContextModel,
) {
    let Ok(record) = serde_json::from_slice::<QoderRecord>(line) else {
        return;
    };
    if record.model_source.as_deref() != Some("custom")
        || record.message.model.as_deref() != Some(model.model_id.as_str())
    {
        return;
    }
    let Some(window) = model.window_tokens else {
        return;
    };
    let Some(used) = calls
        .iter()
        .find(|c| c.usage.counter_mode == RuntimeUsageCounterMode::Delta)
        .and_then(|c| c.usage.fields.input_tokens)
        .filter(|n| *n > 0 && *n <= window)
    else {
        return;
    };
    for call in calls
        .iter_mut()
        .filter(|c| c.usage.counter_mode == RuntimeUsageCounterMode::Gauge)
    {
        // Native SH() computes ratio=input_tokens/window before redaction. Both
        // quantities are independently observed; ratio only validates their pair.
        // A conflicting override/configuration leaves the native ratio alone.
        if call
            .usage
            .fields
            .native_context_ratio
            .is_some_and(|ratio| (ratio - used as f64 / window as f64).abs() <= 1e-9)
        {
            call.usage.fields.context_used_tokens = Some(used);
            call.usage.fields.context_size_tokens = Some(window);
            call.usage.dialect_id = "qoder-native-call-context-v1".into();
        }
    }
}

pub(crate) fn kiro_session_root() -> Option<PathBuf> {
    use crate::runtime_discovery::{runtime_environment_variable, runtime_home_directory};
    let root = runtime_environment_variable(AdapterKind::KiroCli, "KIRO_HOME")
        .map(PathBuf::from)
        .or_else(|| runtime_home_directory(AdapterKind::KiroCli).map(|p| p.join(".kiro")))?;
    root.is_absolute().then(|| root.join("sessions/cli"))
}

pub(crate) fn kiro_context_window(
    root: &Path,
    workspace: &Path,
    session: &str,
    model: &str,
) -> Option<i64> {
    #[derive(Deserialize)]
    struct Session {
        session_id: String,
        cwd: String,
        session_state: State,
    }
    #[derive(Deserialize)]
    struct State {
        rts_model_state: ModelState,
    }
    #[derive(Deserialize)]
    struct ModelState {
        model_info: ModelInfo,
    }
    #[derive(Deserialize)]
    struct ModelInfo {
        model_id: String,
        context_window_tokens: Option<i64>,
    }
    if !safe_identity(session) {
        return None;
    }
    let file = open_native_file(root, &root.join(format!("{session}.json"))).ok()??;
    if file.metadata().ok()?.len() > MAX_LINE_BYTES {
        return None;
    }
    let native: Session = serde_json::from_reader(file.take(MAX_LINE_BYTES + 1)).ok()?;
    if native.session_id != session
        || native.cwd != workspace.to_str()?
        || native.session_state.rts_model_state.model_info.model_id != model
    {
        return None;
    }
    native
        .session_state
        .rts_model_state
        .model_info
        .context_window_tokens
        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
}

fn qoder_record(line: &[u8], session_id: &str, workspace: &str) -> Option<QoderRecord> {
    let record: QoderRecord = serde_json::from_slice(line).ok()?;
    (record.kind == "assistant"
        && record.message.role == "assistant"
        && record.entrypoint == "acp"
        && !record.is_sidechain
        && record.session_id == session_id
        && record.cwd == workspace
        && safe_identity(&record.message.id)
        && DateTime::parse_from_rfc3339(&record.timestamp).is_ok())
    .then_some(record)
}

fn parse_qoder(record: QoderRecord, session_id: &str) -> Vec<NativeUsageObservation> {
    let Some(raw) = record.message.usage else {
        return Vec::new();
    };
    let mut result = Vec::new();
    if record.model_source.as_deref() == Some("custom") {
        // Installed custom-provider Ag() copies OpenAI prompt_tokens into
        // input_tokens, including cache. The native redaction path for other
        // model sources replaces counts with zeros; it cannot establish Usage.
        let fields = RuntimeUsageFields {
            input_tokens: nonnegative(raw.input_tokens),
            output_tokens: nonnegative(raw.output_tokens),
            // Native normalization can synthesize zero for missing buckets.
            // Without original presence flags only positive caches are proven.
            cache_read_input_tokens: nonnegative(raw.cache_read_input_tokens).filter(|n| *n > 0),
            cache_write_input_tokens: nonnegative(raw.cache_creation_input_tokens)
                .filter(|n| *n > 0),
            ..Default::default()
        };
        if fields.input_tokens.is_some()
            || fields.output_tokens.is_some()
            || fields.cache_read_input_tokens.is_some()
            || fields.cache_write_input_tokens.is_some()
        {
            let mut item = observation(
                session_id,
                format!("qoder-native:{session_id}:{}", record.message.id),
                "qoder-custom-message-usage-1.1.64",
                None,
                RuntimeInputSemantics::CacheInclusiveTotal,
                fields,
                None,
            );
            item.usage.occurred_at = Some(record.timestamp.clone());
            result.push(item);
        }
    }
    if let Some(ratio) = raw
        .context_usage_ratio
        .filter(|n| n.is_finite() && (0.0..=1.0).contains(n))
    {
        let mut item = observation(
            session_id,
            format!(
                "qoder-context:{session_id}:{}:{}",
                record.message.id, record.timestamp
            ),
            "qoder-native-context-ratio-1.1.64",
            None,
            RuntimeInputSemantics::Unknown,
            RuntimeUsageFields {
                native_context_ratio: Some(ratio),
                ..Default::default()
            },
            None,
        );
        item.usage.scope = "session".into();
        item.usage.counter_mode = RuntimeUsageCounterMode::Gauge;
        item.usage.identity_suffix = "native_context".into();
        item.usage.occurred_at = Some(record.timestamp);
        result.push(item);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn minimax(id: &str) -> serde_json::Value {
        json!({"message_id":id,"turn_id":"turn-1","message":{"role":"assistant","content":"PRIVATE_MINIMAX_CANARY", "stopReason":"stop", "usage":{"input":100,"output":5,"cacheRead":20,"cacheWrite":3},"timestamp":1}})
    }

    fn trae(id: &str) -> serde_json::Value {
        json!({"id":id,"session_id":"session-1","branch":"Trae CLI","agent_name":"Trae CLI",
            "agent_id":"root-agent","parent_tool_call_id":"","created_at":"2026-10-02T21:55:27+08:00",
            "message":{"message":{"role":"assistant","content":"PRIVATE_TRAE_CANARY","response_meta":{
                "usage":{"prompt_tokens":18015,"completion_tokens":292,"prompt_token_details":{"cached_tokens":17920}}}}}})
    }

    fn codebuddy(id: &str) -> serde_json::Value {
        json!({"type":"message","role":"assistant","sessionId":"session-1","cwd":"/workspace",
            "providerData":{"agent":"cli","messageId":id,"rawUsage":{"prompt_tokens":123,"completion_tokens":9},
            "usage":{"input_tokens":9999}},"content":"NATIVE_PRIVATE_CANARY"})
    }
    fn kimi(id: &str) -> serde_json::Value {
        json!({"type":"context.append_loop_event","agentId":"main","event":{"type":"step.end","uuid":id,
            "turnId":"0","usage":{"inputOther":12,"output":3,"inputCacheRead":20,"inputCacheCreation":0}},
            "content":"NATIVE_PRIVATE_CANARY"})
    }

    fn qoder(id: &str) -> serde_json::Value {
        json!({"type":"assistant","sessionId":"session-1","cwd":"/workspace",
            "entrypoint":"acp","isSidechain":false,"modelSource":"custom",
            "timestamp":"2026-10-01T00:00:00Z","message":{"id":id,"role":"assistant",
            "content":"NATIVE_PRIVATE_CANARY","usage":{"input_tokens":123,"output_tokens":9,
            "cache_read_input_tokens":20,"cache_creation_input_tokens":0}}})
    }

    // New owner: the private journal's exact source, root identity and sparse
    // fields. ACP parser fixtures cannot exercise these persisted envelopes.
    #[test]
    fn native_dialects_select_root_calls_preserve_missing_and_ignore_restated_content() {
        let frame = minimax("call-1");
        let parsed = parse_minimax(frame.to_string().as_bytes(), "root-1").unwrap();
        assert_eq!(
            parsed.usage.input_semantics,
            RuntimeInputSemantics::ExclusiveBuckets
        );
        assert_eq!(parsed.usage.fields.input_tokens, Some(100));
        assert_eq!(parsed.usage.fields.cache_read_input_tokens, Some(20));
        assert_eq!(parsed.usage.fields.cache_write_input_tokens, Some(3));
        assert!(
            !serde_json::to_string(&parsed.usage)
                .unwrap()
                .contains("PRIVATE_MINIMAX_CANARY")
        );
        let mut tool_only = frame.clone();
        tool_only["message"]["content"] = json!([
            {"type":"toolCall","id":"call-1|provider-id","arguments":{"secret":"PRIVATE_TOOL_ARGUMENT"}},
            {"type":"thinking","id":"not-a-tool","text":"PRIVATE_REASONING"}
        ]);
        assert_eq!(
            minimax_record(tool_only.to_string().as_bytes())
                .unwrap()
                .message
                .tool_call_ids,
            ["call-1|provider-id".to_string()].into()
        );
        let usage = parse_minimax(tool_only.to_string().as_bytes(), "root-1").unwrap();
        assert!(
            !serde_json::to_string(&usage.usage)
                .unwrap()
                .contains("PRIVATE_")
        );
        for patch in [
            json!({"role":"user"}),
            json!({"stopReason":"error"}),
            json!({"stopReason":"aborted"}),
            json!({"usage":null}),
            json!({"usage":{"input":-1}}),
        ] {
            let mut value = frame.clone();
            for (key, field) in patch.as_object().unwrap() {
                value["message"][key] = field.clone();
            }
            let parsed = parse_minimax(value.to_string().as_bytes(), "root-1");
            assert!(parsed.is_none_or(|item| item.usage.fields.input_tokens.is_none()));
        }
        let mut frame = trae("call-1");
        let read = |v: &serde_json::Value| {
            trae_record(v.to_string().as_bytes(), "session-1")
                .and_then(|r| parse_trae(r, "session-1"))
        };
        let parsed = read(&frame).unwrap();
        assert_eq!(parsed.usage.fields.input_tokens, Some(18015));
        assert_eq!(parsed.usage.fields.output_tokens, Some(292));
        assert_eq!(parsed.usage.fields.cache_read_input_tokens, Some(17920));
        assert_eq!(parsed.usage.fields.cache_write_input_tokens, None);
        assert!(
            !serde_json::to_string(&parsed.usage)
                .unwrap()
                .contains("PRIVATE_TRAE_CANARY")
        );
        frame["message"]["message"]["extra"] = json!({"_source_model":"GLM-5.3"});
        let model = NativeContextModel {
            model_id: "GLM-5.3".into(),
            window_tokens: Some(168000),
        };
        let gauge = trae_context(frame.to_string().as_bytes(), &parsed, &model).unwrap();
        assert_eq!(gauge.usage.fields.context_used_tokens, Some(18015));
        assert_eq!(gauge.usage.fields.context_size_tokens, Some(168000));
        assert_eq!(gauge.usage.fields.output_tokens, None);
        for (id, window, expected) in [
            ("other", Some(168000), None),
            ("GLM-5.3", Some(100), Some(18015)),
            ("GLM-5.3", None, Some(18015)),
        ] {
            let model = NativeContextModel {
                model_id: id.into(),
                window_tokens: window,
            };
            assert_eq!(
                trae_context(frame.to_string().as_bytes(), &parsed, &model)
                    .and_then(|v| v.usage.fields.context_used_tokens),
                expected
            );
        }
        frame["message"]["message"]["extra"] = serde_json::Value::Null;
        assert!(trae_context(frame.to_string().as_bytes(), &parsed, &model).is_none());
        frame["message"]["message"]["response_meta"]["usage"]["prompt_token_details"] =
            serde_json::Value::Null;
        assert_eq!(
            read(&frame).unwrap().usage.fields.cache_read_input_tokens,
            None
        );
        frame["message"]["message"]["response_meta"]["usage"]["prompt_token_details"] =
            json!({"cached_tokens":0});
        assert_eq!(
            read(&frame).unwrap().usage.fields.cache_read_input_tokens,
            Some(0)
        );
        frame["parent_tool_call_id"] = json!("parent");
        assert!(read(&frame).is_none());
        frame["parent_tool_call_id"] = json!("");
        frame["session_id"] = json!("other-session");
        assert!(read(&frame).is_none());

        let value = codebuddy("call-1");
        let parsed = parse_codebuddy(
            &serde_json::to_vec(&value).unwrap(),
            "session-1",
            "/workspace",
        )
        .unwrap();
        assert_eq!(parsed.usage.fields.input_tokens, Some(123));
        assert_eq!(parsed.usage.fields.output_tokens, Some(9));
        assert_eq!(parsed.usage.fields.cache_read_input_tokens, None);
        assert_eq!(parsed.usage.fields.cache_write_input_tokens, None);
        assert!(
            !serde_json::to_string(&parsed.usage)
                .unwrap()
                .contains("NATIVE_PRIVATE_CANARY")
        );
        for (key, replacement) in [
            ("agent", json!("subagent")),
            ("messageId", json!(null)),
            ("rawUsage", json!(null)),
        ] {
            let mut value = codebuddy("call-1");
            value["providerData"][key] = replacement;
            assert!(
                parse_codebuddy(
                    &serde_json::to_vec(&value).unwrap(),
                    "session-1",
                    "/workspace"
                )
                .is_none()
            );
        }
        assert!(
            parse_codebuddy(
                &serde_json::to_vec(&value).unwrap(),
                "other-session",
                "/workspace"
            )
            .is_none()
        );
        assert!(
            parse_codebuddy(
                &serde_json::to_vec(&value).unwrap(),
                "session-1",
                "/other-workspace"
            )
            .is_none()
        );
        let mut value = codebuddy("call-1");
        value["providerData"]["rawUsage"]["prompt_tokens_details"] = json!({"cached_tokens":0});
        value["providerData"]["rawUsage"]["completion_tokens_details"] =
            json!({"reasoning_tokens":7});
        let parsed = parse_codebuddy(
            &serde_json::to_vec(&value).unwrap(),
            "session-1",
            "/workspace",
        )
        .unwrap();
        assert_eq!(parsed.usage.fields.cache_read_input_tokens, Some(0));
        assert_eq!(parsed.usage.fields.output_tokens, Some(9));
        assert_eq!(parsed.usage.fields.reasoning_output_tokens, Some(7));
        value["providerData"]["model"] = json!("native-model");
        let line = serde_json::to_vec(&value).unwrap();
        let mut model = NativeContextModel {
            model_id: "native-model".into(),
            window_tokens: Some(1000),
        };
        let gauge = codebuddy_context(&line, &parsed, &model).unwrap();
        assert_eq!(gauge.usage.fields.context_used_tokens, Some(123));
        assert_eq!(gauge.usage.fields.context_size_tokens, Some(1000));
        assert_eq!(gauge.usage.fields.output_tokens, None);
        model.window_tokens = None;
        assert_eq!(
            codebuddy_context(&line, &parsed, &model)
                .unwrap()
                .usage
                .fields
                .context_size_tokens,
            None
        );
        model.window_tokens = Some(100);
        assert_eq!(
            codebuddy_context(&line, &parsed, &model)
                .unwrap()
                .usage
                .fields
                .context_used_tokens,
            parsed.usage.fields.input_tokens
        );
        model.window_tokens = Some(1000);
        model.model_id = "changed-model".into();
        assert!(codebuddy_context(&line, &parsed, &model).is_none());
        let value = kimi("step-1");
        let parsed = parse_kimi(&serde_json::to_vec(&value).unwrap(), "session-1").unwrap();
        assert_eq!(
            parsed.usage.input_semantics,
            RuntimeInputSemantics::ExclusiveBuckets
        );
        assert_eq!(parsed.usage.fields.input_tokens, Some(12));
        assert_eq!(parsed.usage.fields.cache_write_input_tokens, Some(0));
        assert!(
            !serde_json::to_string(&parsed.usage)
                .unwrap()
                .contains("NATIVE_PRIVATE_CANARY")
        );
        for (key, value) in [("type", json!("usage.record")), ("agentId", json!("child"))] {
            let mut record = kimi("step-1");
            record[key] = value;
            assert!(parse_kimi(&serde_json::to_vec(&record).unwrap(), "session-1").is_none());
        }
        let mut value = kimi("step-1");
        value["event"]["usage"]
            .as_object_mut()
            .unwrap()
            .remove("inputCacheCreation");
        assert_eq!(
            parse_kimi(&serde_json::to_vec(&value).unwrap(), "session-1")
                .unwrap()
                .usage
                .fields
                .cache_write_input_tokens,
            None
        );
        assert_eq!(
            kimi_workspace_key(
                "/private/var/folders/pm/zmpfxggd0glcm8vx3p3y3mmr0000gq/T/rovai-observable-kimi-code-cli-QmbRQg/workspace"
            ),
            "wd_workspace_cbe2b4c8286f"
        );
        assert_eq!(
            codebuddy_workspace_key("/private/a---b/workspace/"),
            "private-a-b-workspace"
        );
        assert_eq!(
            qoder_workspace_key("/private/a_b/workspace"),
            "-private-a-b-workspace"
        );
        let mut frame = qoder("call-1");
        frame["message"]["usage"]["context_usage_ratio"] = json!(0.125);
        let parse = |v: &serde_json::Value| {
            qoder_record(&serde_json::to_vec(v).unwrap(), "session-1", "/workspace")
                .map(|r| parse_qoder(r, "session-1"))
                .unwrap_or_default()
        };
        let result = parse(&frame);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].usage.fields.input_tokens, Some(123));
        assert_eq!(
            result[0].usage.input_semantics,
            RuntimeInputSemantics::CacheInclusiveTotal
        );
        assert_eq!(
            result[0].usage.fields.cache_write_input_tokens, None,
            "native default zero has no provider presence evidence"
        );
        assert_eq!(result[1].usage.fields.native_context_ratio, Some(0.125));
        assert_eq!(result[1].usage.fields.context_used_tokens, None);
        assert_eq!(result[1].usage.fields.context_size_tokens, None);
        let configured = json!({"providers":{"custom":{"apiKey":"PRIVATE_CONFIG_SECRET","models":[{"model":"test","contextWindow":984}]}}});
        assert_eq!(
            qoder_configured_window(configured.to_string().as_bytes(), "custom/test"),
            Some(984)
        );
        assert_eq!(
            qoder_configured_window(configured.to_string().as_bytes(), "custom/other"),
            None
        );
        frame["message"]["model"] = json!("custom/test");
        let model = NativeContextModel {
            model_id: "custom/test".into(),
            window_tokens: Some(984),
        };
        let mut observed = parse(&frame);
        supplement_qoder_context(frame.to_string().as_bytes(), &mut observed, &model);
        assert_eq!(observed[1].usage.fields.context_used_tokens, Some(123));
        assert_eq!(observed[1].usage.fields.context_size_tokens, Some(984));
        assert!(
            !serde_json::to_string(&observed[1].usage)
                .unwrap()
                .contains("PRIVATE_CONFIG_SECRET")
        );
        for (model_id, window) in [
            ("custom/other", Some(984)),
            ("custom/test", Some(1000)),
            ("custom/test", None),
        ] {
            let mut observed = parse(&frame);
            supplement_qoder_context(
                frame.to_string().as_bytes(),
                &mut observed,
                &NativeContextModel {
                    model_id: model_id.into(),
                    window_tokens: window,
                },
            );
            assert_eq!(observed[1].usage.fields.context_used_tokens, None);
            assert_eq!(observed[1].usage.fields.native_context_ratio, Some(0.125));
        }

        assert!(
            !serde_json::to_string(&result[0].usage)
                .unwrap()
                .contains("NATIVE_PRIVATE_CANARY")
        );
        frame["modelSource"] = json!("native");
        assert_eq!(
            parse(&frame).len(),
            1,
            "redacted counts cannot establish zero Usage; ratio is independent"
        );
        for ratio in [json!(-0.01), json!(1.01), json!(null)] {
            frame["message"]["usage"]["context_usage_ratio"] = ratio;
            assert!(parse(&frame).is_empty());
        }
        frame["message"]["usage"]["context_usage_ratio"] = json!(0);
        assert_eq!(
            parse(&frame)[0].usage.fields.native_context_ratio,
            Some(0.0)
        );
        for (key, value) in [
            ("isSidechain", json!(true)),
            ("sessionId", json!("other")),
            ("cwd", json!("/other")),
            ("entrypoint", json!("cli")),
        ] {
            let mut invalid = frame.clone();
            invalid[key] = value;
            assert!(parse(&invalid).is_empty());
        }
        let witness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/research/runtime-monitoring/fixtures/round5-native-usage-context.json"
        ))
        .unwrap();
        // Replay sanitized installed-version fields, independently captured
        // before parsing, against their recorded per-call normalization.
        for entry in witness["entries"].as_array().unwrap() {
            let kind = entry["runtime"].as_str().unwrap();
            if !matches!(kind, "codebuddy-cli" | "kimi-code-cli") {
                continue;
            }
            for run in entry["runs"].as_array().unwrap() {
                for record in run["sourceRecords"].as_array().unwrap() {
                    let frame = serde_json::to_vec(&record["raw"]).unwrap();
                    let observed = if kind == "codebuddy-cli" {
                        parse_codebuddy(&frame, "session-1", "/workspace")
                    } else {
                        parse_kimi(&frame, "session-1")
                    }
                    .unwrap();
                    let fields = observed.usage.fields;
                    let total = if kind == "kimi-code-cli" {
                        fields.input_tokens.and_then(|input| {
                            Some(
                                input
                                    + fields.cache_read_input_tokens?
                                    + fields.cache_write_input_tokens?,
                            )
                        })
                    } else {
                        fields.input_tokens
                    };
                    assert_eq!(
                        json!({
                            "promptInputTotalTokens":total,"outputTokens":fields.output_tokens,
                            "cacheReadTokens":fields.cache_read_input_tokens,"cacheWriteTokens":fields.cache_write_input_tokens
                        }),
                        record["expectedParsed"],
                        "{kind} raw fixture must retain its independently recorded semantics"
                    );
                }
            }
        }
        let witness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/research/runtime-monitoring/fixtures/round8-native-format-compatibility.json"
        )).unwrap();
        for entry in witness["entries"].as_array().unwrap() {
            let kind = entry["runtime"].as_str().unwrap();
            if !matches!(kind, "codebuddy-cli" | "trae-cn-cli") {
                continue;
            }
            for run in entry["runs"].as_array().unwrap() {
                let mut totals = [0i64; 3];
                let mut latest_context = None;
                for raw in run["sourceRecords"].as_array().unwrap() {
                    let bytes = serde_json::to_vec(raw).unwrap();
                    let observed = if kind == "codebuddy-cli" {
                        parse_codebuddy(&bytes, "session-1", "/fixture/workspace").unwrap()
                    } else {
                        parse_trae(trae_record(&bytes, "session-1").unwrap(), "session-1").unwrap()
                    };
                    assert_eq!(
                        observed.usage.input_semantics,
                        RuntimeInputSemantics::CacheInclusiveTotal
                    );
                    let fields = &observed.usage.fields;
                    for (sum, value) in totals.iter_mut().zip([
                        fields.input_tokens,
                        fields.output_tokens,
                        fields.cache_read_input_tokens,
                    ]) {
                        *sum += value.unwrap_or(0);
                    }
                    assert_eq!(fields.cache_write_input_tokens, None);
                    if kind == "codebuddy-cli" {
                        latest_context = codebuddy_context(
                            &bytes,
                            &observed,
                            &NativeContextModel {
                                model_id: entry["model"].as_str().unwrap().into(),
                                window_tokens: None,
                            },
                        );
                    }
                }
                // Expected sums were read back from the isolated Core database,
                // independently of these native journal records.
                assert_eq!(
                    json!({"promptInputTotalTokens":totals[0],"outputTokens":totals[1],
                    "cacheReadTokens":totals[2],"cacheWriteTokens":null}),
                    run["expectedRunProjection"]
                );
                if let Some(context) = latest_context {
                    assert_eq!(
                        context.usage.fields.context_used_tokens,
                        run["expectedSessionProjection"][0]["usedTokens"].as_i64()
                    );
                    assert_eq!(context.usage.fields.context_size_tokens, None);
                }
            }
        }
        for source in [
            include_str!(
                "../../../docs/research/runtime-monitoring/fixtures/round6-native-context-ratio.json"
            ),
            include_str!(
                "../../../docs/research/runtime-monitoring/fixtures/round7-native-boundaries.json"
            ),
        ] {
            let witness: serde_json::Value = serde_json::from_str(source).unwrap();
            let entry = witness["entries"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["runtime"] == "qoder-cli")
                .unwrap();
            for run in entry["runs"].as_array().unwrap() {
                for record in run["sourceRecords"].as_array().unwrap() {
                    let frame = serde_json::to_vec(&record["raw"]).unwrap();
                    let observations = parse_qoder(
                        qoder_record(&frame, "session-1", "/workspace").unwrap(),
                        "session-1",
                    );
                    let fields = &observations[0].usage.fields;
                    assert_eq!(
                        json!({"promptInputTotalTokens":fields.input_tokens,
                        "outputTokens":fields.output_tokens,
                        "cacheReadTokens":fields.cache_read_input_tokens,
                        "cacheWriteTokens":fields.cache_write_input_tokens}),
                        record["expectedParsed"]
                    );
                    let context = &observations[1].usage.fields;
                    assert_eq!(
                        json!({"usedTokens":context.context_used_tokens,
                        "windowTokens":context.context_size_tokens,
                        "nativeRatio":context.native_context_ratio}),
                        record["expectedContext"]
                    );
                }
            }
        }
    }

    // New filesystem owner: byte/identity baseline, torn lines and continuity.
    // A parser alone cannot prove which bytes were already present at dispatch.
    #[cfg(feature = "extended-tests")]
    #[test]
    fn native_cursor_excludes_history_replays_partial_lines_and_file_resets() {
        use std::io::Write;
        for dialect in [
            Dialect::CodeBuddy,
            Dialect::Kimi,
            Dialect::Qoder,
            Dialect::Trae,
            Dialect::Minimax,
        ] {
            let root =
                std::env::temp_dir().join(format!("rovai-native-usage-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            let path = if matches!(dialect, Dialect::Minimax) {
                fs::create_dir_all(root.join("v2/sqlite")).unwrap();
                fs::create_dir_all(root.join("v2/sessions/current")).unwrap();
                let c = rusqlite::Connection::open(root.join("v2/sqlite/runtime-state.sqlite"))
                    .unwrap();
                c.execute_batch("CREATE TABLE local_runtime_sessions(session_id TEXT PRIMARY KEY,workspace_dir TEXT,parent_session_id TEXT,history_relative_dir TEXT); INSERT INTO local_runtime_sessions VALUES('session-1','/workspace',NULL,'current');").unwrap();
                root.join("v2/sessions/current/messages.jsonl")
            } else {
                root.join("wire.jsonl")
            };
            if matches!(dialect, Dialect::Trae) {
                fs::write(
                    root.join("session.json"),
                    json!({"id":"session-1","metadata":{"cwd":"/workspace"}}).to_string(),
                )
                .unwrap();
            }
            let make = |id| match dialect {
                Dialect::CodeBuddy => codebuddy(id),
                Dialect::Kimi => kimi(id),
                Dialect::Qoder => qoder(id),
                Dialect::Trae => trae(id),
                Dialect::Minimax => minimax(id),
            };
            let line = |id| format!("{}\n", make(id));
            let mut historical = make("old");
            if matches!(dialect, Dialect::CodeBuddy) {
                historical["providerData"]
                    .as_object_mut()
                    .unwrap()
                    .remove("rawUsage");
            }
            if matches!(dialect, Dialect::Trae) {
                historical["message"]["message"]
                    .as_object_mut()
                    .unwrap()
                    .remove("response_meta");
            }
            if matches!(dialect, Dialect::Qoder) {
                historical["message"]
                    .as_object_mut()
                    .unwrap()
                    .remove("usage");
            }
            fs::write(&path, format!("{historical}\n")).unwrap();
            let mut reader = NativeJsonlUsageReader::baseline(
                dialect,
                root.clone(),
                path.clone(),
                "/workspace".to_string(),
                "session-1".to_string(),
            )
            .unwrap();
            let mut file = OpenOptions::new().append(true).open(&path).unwrap();
            write!(file, "{}{}", line("old"), line("new").trim_end()).unwrap();
            file.flush().unwrap();
            assert!(
                reader.poll().is_empty(),
                "partial new frame waits for newline; history is excluded"
            );
            writeln!(file).unwrap();
            file.flush().unwrap();
            let first = reader.poll();
            assert_eq!(first.len(), 1);
            write!(file, "{}", line("new")).unwrap();
            file.flush().unwrap();
            assert!(
                reader.poll().is_empty(),
                "native repeat cannot claim another model call"
            );
            let mut next_run = NativeJsonlUsageReader::baseline(
                dialect,
                root.clone(),
                path.clone(),
                "/workspace".to_string(),
                "session-1".to_string(),
            )
            .unwrap();
            write!(file, "{}{}", line("new"), line("next-run")).unwrap();
            file.flush().unwrap();
            assert_eq!(
                next_run.poll().len(),
                1,
                "resume baseline claims only successor consumption"
            );
            drop(file);
            fs::write(&path, line("reset")).unwrap();
            assert!(next_run.poll().is_empty());
            assert!(next_run.disabled);
            fs::write(&path, line("old").trim_end()).unwrap();
            let mut partial = NativeJsonlUsageReader::baseline(
                dialect,
                root.clone(),
                path.clone(),
                "/workspace".to_string(),
                "session-1".to_string(),
            )
            .unwrap();
            let mut file = OpenOptions::new().append(true).open(&path).unwrap();
            write!(file, "\n{}", line("fresh")).unwrap();
            file.flush().unwrap();
            assert_eq!(
                partial.poll().len(),
                1,
                "completing historical partial bytes is not new Usage"
            );
            drop(file);
            let mut terminal = NativeUsageReader::Jsonl(
                NativeJsonlUsageReader::baseline(
                    dialect,
                    root.clone(),
                    path.clone(),
                    "/workspace".into(),
                    "session-1".into(),
                )
                .unwrap(),
            );
            assert!(terminal.poll().is_empty());
            let mut file = OpenOptions::new().append(true).open(&path).unwrap();
            write!(file, "{}", line("late-terminal")).unwrap();
            file.flush().unwrap();
            assert_eq!(
                terminal.poll().len(),
                1,
                "a later background read can collect the journal tail"
            );
            drop(file);
            assert!(terminal.poll().is_empty());
            if matches!(dialect, Dialect::Minimax) {
                assert!(
                    terminal
                        .minimax_tail(BTreeSet::new(), BTreeSet::new())
                        .is_none()
                );
                let c = rusqlite::Connection::open(root.join("v2/sqlite/runtime-state.sqlite"))
                    .unwrap();
                c.execute_batch("CREATE TABLE local_runtime_message_rows(session_id TEXT,msg_id TEXT,role TEXT,turn_id TEXT,data_json TEXT);
                    INSERT INTO local_runtime_message_rows VALUES
                    ('session-1','display-old','assistant','turn-1','{\"canonical_message_id\":\"old\"}'),
                    ('session-1','display-wrong-turn','assistant','another-turn','{\"canonical_message_id\":\"wrong-turn\"}'),
                    ('other-session','display-owned','assistant','turn-1','{\"canonical_message_id\":\"successor\"}');").unwrap();
                let mut tail = terminal
                    .minimax_tail(
                        [
                            "display-owned".into(),
                            "display-old".into(),
                            "display-wrong-turn".into(),
                        ]
                        .into(),
                        ["active-tool|provider-id".into()].into(),
                    )
                    .unwrap();
                let mut file = OpenOptions::new().append(true).open(&path).unwrap();
                write!(
                    file,
                    "{}{}{}{}",
                    line("old"),
                    line("successor"),
                    line("wrong-turn"),
                    line("owned-tail").trim_end()
                )
                .unwrap();
                file.flush().unwrap();
                assert!(
                    tail.poll().is_empty(),
                    "history, next turn and incomplete line are excluded"
                );
                writeln!(file).unwrap();
                file.flush().unwrap();
                assert!(
                    tail.poll().is_empty(),
                    "no inferred display/canonical identity mapping"
                );
                c.execute("INSERT INTO local_runtime_message_rows VALUES('session-1','display-owned','assistant','turn-1','{\"canonical_message_id\":\"owned-tail\"}')", []).unwrap();
                let observed = tail.poll();
                assert_eq!(observed.len(), 1);
                assert_eq!(
                    observed[0].source_identity,
                    "minimax-native:session-1:owned-tail"
                );
                assert!(tail.poll().is_empty(), "terminal retry cannot double count");
                let mut tool_only = make("owned-tool-only");
                tool_only["turn_id"] = json!("turn-1");
                tool_only["message"]["content"] = json!([{
                    "type":"toolCall", "id":"active-tool|provider-id", "name":"bash",
                    "arguments":{"command":"PRIVATE_ARGUMENT_MUST_NOT_ENTER_USAGE"}
                }]);
                let mut another_tool = tool_only.clone();
                another_tool["message_id"] = json!("unobserved-tool");
                another_tool["message"]["content"][0]["id"] = json!("another-prompt-tool");
                let mut wrong_type = tool_only.clone();
                wrong_type["message_id"] = json!("unknown-content-type");
                wrong_type["message"]["content"][0]["type"] = json!("thinking");
                let mut conflicting = tool_only.clone();
                conflicting["message_id"] = json!("wrong-turn");
                let mut reused_id = tool_only.clone();
                reused_id["message_id"] = json!("older-turn-reused-tool-id");
                reused_id["turn_id"] = json!("unobserved-historical-turn");
                write!(
                    file,
                    "{tool_only}\n{another_tool}\n{wrong_type}\n{conflicting}\n{reused_id}\n"
                )
                .unwrap();
                file.flush().unwrap();
                let observed = tail.poll();
                assert_eq!(
                    observed.len(),
                    1,
                    "only the frozen native tool-call ID admits a tool-only assistant"
                );
                assert_eq!(
                    observed[0].source_identity,
                    "minimax-native:session-1:owned-tool-only"
                );
                assert_eq!(observed[0].usage.fields.output_tokens, Some(5));
                assert!(
                    tail.poll().is_empty(),
                    "re-reading the tool-only tail cannot double count"
                );
                drop(file);
                let mut active = tool_only.clone();
                active["message_id"] = json!("after-compaction-active");
                let mut archived = tool_only.clone();
                archived["message_id"] = json!("before-compaction-archived");
                let archive_name = "g000000000001--ctx_11111111-1111-4111-8111-111111111111.jsonl";
                let directory = path.parent().unwrap();
                fs::create_dir_all(directory.join("snapshots")).unwrap();
                fs::write(
                    directory.join("snapshots").join(archive_name),
                    format!(
                        "{archived}\n{tool_only}\n{another_tool}\n{conflicting}\n{reused_id}\n"
                    ),
                )
                .unwrap();
                let catalog_path = directory.join("history-catalog.json");
                let mut catalog = json!({"schemaVersion":1,"sessionId":"session-1","artifacts":[
                    {"generation":1,"kind":"snapshot","fileName":archive_name}
                ]});
                fs::write(&catalog_path, catalog.to_string()).unwrap();
                fs::write(&path, format!("{}\n{active}\n", make("old"))).unwrap();
                assert!(terminal.poll().is_empty());
                let mut rotated = tail
                    .minimax_tail(
                        ["display-owned".into(), "display-wrong-turn".into()].into(),
                        ["active-tool|provider-id".into()].into(),
                    )
                    .unwrap();
                let observed = rotated.poll();
                assert_eq!(
                    observed.len(),
                    2,
                    "rotation admits only exact prompt identities in active and archived history"
                );
                assert!(
                    rotated.poll().is_empty(),
                    "compaction copies cannot duplicate consumption"
                );
                catalog["sessionId"] = json!("other-session");
                fs::write(&catalog_path, catalog.to_string()).unwrap();
                assert!(rotated.poll().is_empty());
                assert!(matches!(&rotated, NativeUsageReader::Jsonl(reader) if reader.disabled));
                catalog["sessionId"] = json!("session-1");
                catalog["artifacts"][0]["fileName"] = json!("../foreign.jsonl");
                fs::write(&catalog_path, catalog.to_string()).unwrap();
                assert!(minimax_history_artifacts(&root, &path, "session-1").is_err());
                assert!(minimax_session_path(&root, "/another", "session-1").is_err());
                assert!(minimax_session_path(&root, "/workspace", "other-session").is_err());
                let c = rusqlite::Connection::open(root.join("v2/sqlite/runtime-state.sqlite"))
                    .unwrap();
                #[cfg(windows)]
                {
                    let workspace = root.join("workspace");
                    fs::create_dir(&workspace).unwrap();
                    let canonical = workspace.canonicalize().unwrap();
                    let native_path = dunce::simplified(&canonical).to_str().unwrap();
                    c.execute(
                        "UPDATE local_runtime_sessions SET workspace_dir=?1",
                        [native_path],
                    )
                    .unwrap();
                    assert!(
                        NativeUsageReader::for_minimax_prompt(&root, &canonical, "session-1")
                            .is_some(),
                        "Windows ACP native paths and Core verbatim paths identify the same workspace"
                    );
                    assert!(
                        minimax_session_path(&root, &format!("{native_path}-other"), "session-1")
                            .is_err(),
                        "path normalization must not admit another workspace"
                    );
                    c.execute(
                        "UPDATE local_runtime_sessions SET workspace_dir='/workspace'",
                        [],
                    )
                    .unwrap();
                }
                c.execute(
                    "UPDATE local_runtime_sessions SET parent_session_id='parent'",
                    [],
                )
                .unwrap();
                assert!(minimax_session_path(&root, "/workspace", "session-1").is_err());
                c.execute("UPDATE local_runtime_sessions SET parent_session_id=NULL,history_relative_dir='../outside'", []).unwrap();
                assert!(minimax_session_path(&root, "/workspace", "session-1").is_err());
            }
            fs::remove_dir_all(root).unwrap();
        }
        let kiro_root =
            std::env::temp_dir().join(format!("rovai-kiro-window-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&kiro_root).unwrap();
        let mut native = json!({"session_id":"native-session","cwd":"/workspace","session_state":{"rts_model_state":{"model_info":{"model_id":"native-model","context_window_tokens":196000},"context_usage_percentage":7.7}},"text":"PRIVATE_KIRO_CANARY"});
        let path = kiro_root.join("native-session.json");
        fs::write(&path, native.to_string()).unwrap();
        assert_eq!(
            kiro_context_window(
                &kiro_root,
                Path::new("/workspace"),
                "native-session",
                "native-model"
            ),
            Some(196000)
        );
        assert_eq!(
            kiro_context_window(
                &kiro_root,
                Path::new("/workspace"),
                "native-session",
                "changed-model"
            ),
            None
        );
        assert_eq!(
            kiro_context_window(
                &kiro_root,
                Path::new("/other"),
                "native-session",
                "native-model"
            ),
            None
        );
        assert_eq!(
            kiro_context_window(
                &kiro_root,
                Path::new("/workspace"),
                "../native-session",
                "native-model"
            ),
            None
        );
        for field in [json!(null), json!(0), json!("196000")] {
            native["session_state"]["rts_model_state"]["model_info"]["context_window_tokens"] =
                field;
            fs::write(&path, native.to_string()).unwrap();
            assert_eq!(
                kiro_context_window(
                    &kiro_root,
                    Path::new("/workspace"),
                    "native-session",
                    "native-model"
                ),
                None
            );
        }
        fs::remove_dir_all(kiro_root).unwrap();
        let root =
            std::env::temp_dir().join(format!("rovai-trae-identity-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("events.jsonl");
        let baseline = || {
            NativeJsonlUsageReader::baseline(
                Dialect::Trae,
                root.clone(),
                path.clone(),
                "/workspace".into(),
                "session-1".into(),
            )
        };
        let mut fresh = baseline().unwrap();
        assert!(
            fresh.poll().is_empty(),
            "new sessions may create their journal after dispatch"
        );
        fs::write(
            root.join("session.json"),
            json!({"id":"session-1","metadata":{"cwd":"/workspace"}}).to_string(),
        )
        .unwrap();
        fs::write(&path, format!("{}\n", trae("new"))).unwrap();
        assert_eq!(fresh.poll().len(), 1);
        for metadata in [
            json!({"id":"other","metadata":{"cwd":"/workspace"}}),
            json!({"id":"session-1","metadata":{"cwd":"/other"}}),
        ] {
            fs::write(root.join("session.json"), metadata.to_string()).unwrap();
            assert!(
                baseline().is_err(),
                "native Session and cwd must both match"
            );
        }
        fs::remove_file(root.join("session.json")).unwrap();
        assert!(
            baseline().is_err(),
            "an existing journal requires matching metadata"
        );
        #[cfg(unix)]
        {
            fs::write(
                root.join("redirect.json"),
                json!({"id":"session-1","metadata":{"cwd":"/workspace"}}).to_string(),
            )
            .unwrap();
            std::os::unix::fs::symlink(root.join("redirect.json"), root.join("session.json"))
                .unwrap();
            assert!(
                baseline().is_err(),
                "native metadata cannot redirect through a symlink"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    // SQLite metadata has a different continuity boundary from the append-only
    // journals: existing incomplete messages must remain history on resume.
    #[cfg(feature = "extended-tests")]
    #[test]
    fn opencode_metadata_excludes_old_pending_child_and_repeated_calls() {
        let root =
            std::env::temp_dir().join(format!("rovai-native-opencode-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let path = root.join("opencode.db");
        let database = rusqlite::Connection::open(&path).unwrap();
        database.execute_batch("CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,parent_id TEXT);
            CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);
            INSERT INTO session VALUES('session-1','/workspace',NULL),('child','/workspace','session-1');").unwrap();
        let insert = |id: &str, session: &str, completed: Option<i64>| {
            database
                .execute(
                    "INSERT INTO message VALUES(?1,?2,1,?3)",
                    rusqlite::params![id, session, json!({
                "role":"assistant", "time":{"completed":completed},
                "tokens":{"input":12,"output":9,"reasoning":2,"cache":{"read":20,"write":0}},
                "content":"NATIVE_PRIVATE_CANARY"
            }).to_string()],
                )
                .unwrap();
        };
        insert("old-pending", "session-1", None);
        insert("old-completed", "session-1", Some(1));
        let mut reader =
            OpenCodeUsageReader::baseline(path.clone(), "/workspace".into(), "session-1".into())
                .unwrap();
        assert!(
            OpenCodeUsageReader::baseline(path.clone(), "/workspace".into(), "child".into())
                .is_err()
        );
        assert!(
            OpenCodeUsageReader::baseline(path.clone(), "/other".into(), "session-1".into())
                .is_err()
        );
        database.execute("UPDATE message SET data=json_set(data,'$.time.completed',2) WHERE id='old-pending'", []).unwrap();
        insert("child-call", "child", Some(2));
        insert("new-pending", "session-1", None);
        insert("new-call", "session-1", Some(3));
        let observations = reader.poll();
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[1].usage.fields.context_used_tokens, Some(32));
        assert_eq!(observations[1].usage.fields.context_size_tokens, None);
        assert_eq!(
            observations[1].usage.counter_mode,
            RuntimeUsageCounterMode::Gauge
        );
        let fields = &observations[0].usage.fields;
        assert_eq!(fields.input_tokens, Some(12));
        assert_eq!(
            fields.output_tokens,
            Some(11),
            "native output excludes reasoning, add it once"
        );
        assert_eq!(fields.cache_write_input_tokens, Some(0));
        assert!(
            !serde_json::to_string(&observations[0].usage)
                .unwrap()
                .contains("NATIVE_PRIVATE_CANARY")
        );
        assert!(reader.poll().is_empty());
        database.execute("UPDATE message SET data=json_set(data,'$.time.completed',4) WHERE id='new-pending'", []).unwrap();
        assert_eq!(reader.poll().len(), 2);
        // Positive cache write and independent reasoning formerly lived in the
        // ambiguous ACP terminal owner. The native call is now their owner.
        database
            .execute(
                "INSERT INTO message VALUES('positive-cache','session-1',4,?1)",
                [json!({"role":"assistant","time":{"completed":4},
                "tokens":{"input":100,"output":40,"reasoning":7,"cache":{"read":11,"write":13}}})
                .to_string()],
            )
            .unwrap();
        let positive = reader.poll();
        assert_eq!(positive.len(), 2);
        assert_eq!(positive[0].usage.fields.input_tokens, Some(100));
        assert_eq!(positive[0].usage.fields.cache_read_input_tokens, Some(11));
        assert_eq!(positive[0].usage.fields.cache_write_input_tokens, Some(13));
        assert_eq!(positive[0].usage.fields.output_tokens, Some(47));
        assert_eq!(positive[1].usage.fields.context_used_tokens, Some(124));
        database.execute("INSERT INTO message VALUES('failed-empty','session-1',5,?1)",
            [json!({"role":"assistant","time":{"completed":5},"error":{"name":"UnknownError"},
                "tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}).to_string()]).unwrap();
        assert!(
            reader.poll().is_empty(),
            "failed calls' initialized zeros are not Usage or Context"
        );
        database.execute("INSERT INTO message VALUES('sparse','session-1',6,?1)",
            [json!({"role":"assistant","time":{"completed":6},"tokens":{"input":"100","output":9,"reasoning":2,"cache":{"read":0}}}).to_string()]).unwrap();
        let sparse = reader.poll();
        assert_eq!(sparse.len(), 1);
        assert_eq!(sparse[0].usage.fields.input_tokens, None);
        assert_eq!(sparse[0].usage.fields.output_tokens, Some(11));
        assert_eq!(sparse[0].usage.fields.cache_write_input_tokens, None);
        assert!(!reader.disabled);
        let mut next =
            OpenCodeUsageReader::baseline(path.clone(), "/workspace".into(), "session-1".into())
                .unwrap();
        insert("next-call", "session-1", Some(5));
        assert_eq!(next.poll().len(), 2);
        for (source_index, source) in [
            include_str!("../../../docs/research/runtime-monitoring/fixtures/round5-native-usage-context.json"),
            include_str!("../../../docs/research/runtime-monitoring/fixtures/round6-native-context-ratio.json"),
            include_str!("../../../docs/research/runtime-monitoring/fixtures/round7-native-boundaries.json"),
        ].into_iter().enumerate() {
        let witness: serde_json::Value = serde_json::from_str(source).unwrap();
        let entry = witness["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["runtime"] == "opencode-cli")
            .unwrap();
        for (run_index, run) in entry["runs"].as_array().unwrap().iter().enumerate() {
            let mut replay = OpenCodeUsageReader::baseline(
                path.clone(),
                "/workspace".into(),
                "session-1".into(),
            )
            .unwrap();
            for (call_index, record) in run["sourceRecords"].as_array().unwrap().iter().enumerate()
            {
                database
                    .execute(
                        "INSERT INTO message VALUES(?1,'session-1',1,?2)",
                        rusqlite::params![
                            format!("witness-{source_index}-{run_index}-{call_index}"),
                            record["raw"].to_string()
                        ],
                    )
                    .unwrap();
                let observations = replay.poll();
                assert_eq!(observations.len(), 2);
                let fields = &observations[0].usage.fields;
                let total = fields.input_tokens.and_then(|input| {
                    Some(input + fields.cache_read_input_tokens? + fields.cache_write_input_tokens?)
                });
                assert_eq!(
                    json!({
                        "promptInputTotalTokens":total,"outputTokens":fields.output_tokens,
                        "cacheReadTokens":fields.cache_read_input_tokens,"cacheWriteTokens":fields.cache_write_input_tokens
                    }),
                    record["expectedParsed"]
                );
                if let Some(context) = record.get("expectedContext") {
                    assert_eq!(
                        json!({"usedTokens":observations[1].usage.fields.context_used_tokens,
                            "windowTokens":observations[1].usage.fields.context_size_tokens,
                            "nativeRatio":observations[1].usage.fields.native_context_ratio}),
                        *context
                    );
                }
                assert!(replay.poll().is_empty());
            }
        }
        }
        let witness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/research/runtime-monitoring/fixtures/round8-native-format-compatibility.json"
        )).unwrap();
        let entry = witness["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["runtime"] == "opencode-cli")
            .unwrap();
        for run in entry["runs"].as_array().unwrap() {
            let mut replay = OpenCodeUsageReader::baseline(
                path.clone(),
                "/workspace".into(),
                "session-1".into(),
            )
            .unwrap();
            let mut totals = [0i64; 4];
            let mut latest_context = None;
            for raw in run["sourceRecords"].as_array().unwrap() {
                database
                    .execute(
                        "INSERT INTO message VALUES(?1,'session-1',1,?2)",
                        rusqlite::params![raw["id"].as_str().unwrap(), raw.to_string()],
                    )
                    .unwrap();
                let observations = replay.poll();
                assert_eq!(observations.len(), 2);
                let fields = &observations[0].usage.fields;
                let input = fields.input_tokens.unwrap()
                    + fields.cache_read_input_tokens.unwrap()
                    + fields.cache_write_input_tokens.unwrap();
                for (sum, value) in totals.iter_mut().zip([
                    input,
                    fields.output_tokens.unwrap(),
                    fields.cache_read_input_tokens.unwrap(),
                    fields.cache_write_input_tokens.unwrap(),
                ]) {
                    *sum += value;
                }
                latest_context = observations[1].usage.fields.context_used_tokens;
                assert!(replay.poll().is_empty());
            }
            assert_eq!(
                json!({"promptInputTotalTokens":totals[0],"outputTokens":totals[1],
                "cacheReadTokens":totals[2],"cacheWriteTokens":totals[3]}),
                run["expectedRunProjection"]
            );
            assert_eq!(
                latest_context,
                run["expectedSessionProjection"][0]["usedTokens"].as_i64()
            );
        }
        let mut kilo =
            OpenCodeUsageReader::baseline(path.clone(), "/workspace".into(), "session-1".into())
                .unwrap();
        kilo.kind = AdapterKind::KiloCli;
        insert("kilo-call", "session-1", Some(7));
        database
            .execute(
                "UPDATE message SET data=json_set(data,'$.cost',0.0042) WHERE id='kilo-call'",
                [],
            )
            .unwrap();
        let observed = kilo.poll();
        assert_eq!(observed.len(), 2);
        assert!(observed[0].source_identity.starts_with("kilo-native:"));
        assert_eq!(observed[0].usage.cost.as_ref().unwrap().amount, "0.0042");
        assert_eq!(observed[0].usage.cost.as_ref().unwrap().currency, "USD");
        assert!(
            kilo.poll().is_empty(),
            "Kilo native message IDs must deduplicate cost as well as tokens"
        );
        database
            .execute(
                "UPDATE session SET directory='/changed' WHERE id='session-1'",
                [],
            )
            .unwrap();
        assert!(next.poll().is_empty());
        assert!(next.disabled);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }
}
