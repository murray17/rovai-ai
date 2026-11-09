//! Read-only discovery of Skills in the executing Host's native Harness paths.
//! Discovery neither projects Rovai content into a project nor mutates a
//! Harness configuration. A cache entry is only a candidate view, never an
//! authority for a frozen message or a Runtime's actual loaded state.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::OsString,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::agent_profile::AdapterKind;
use crate::command::{
    ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
    DomainCommandGateway, sealed,
};
use crate::db::Database;
use crate::runtime_startup::RuntimeStartupConfiguration;
use crate::skill::{SkillContentFile, SkillContentView};

const DIRECTORY_CACHE_CAPACITY: usize = 128;
const DIRECTORY_CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_NATIVE_PREVIEW_FILES: usize = 512;
const MAX_NATIVE_PREVIEW_ENTRIES: usize = 2048;
const MAX_NATIVE_PREVIEW_BYTES: u64 = 4 * 1024 * 1024;
const NATIVE_LARGE_PREVIEW_BYTES: usize = 256 * 1024;

/// Read an exact file under a previously validated native Skill directory.
/// Linked children are omitted so a dropdown cannot grant access outside it.
pub fn read_native_skill_content(root: &Path, selected: &str) -> Result<SkillContentView> {
    let relative = Path::new(selected);
    ensure!(
        !selected.is_empty()
            && !selected.contains('\\')
            && relative
                .components()
                .all(|part| matches!(part, Component::Normal(_))),
        "Native Skill file path is invalid"
    );
    // Enumeration used to supply both file admission and menu entries. Check only
    // the selected path chain now, retaining the no-linked-child boundary.
    let mut selected_path = root.to_path_buf();
    let mut selected_metadata = None;
    for component in relative.components() {
        selected_path.push(component);
        let metadata = fs::symlink_metadata(&selected_path)?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "Native Skill file path contains a link"
        );
        selected_metadata = Some(metadata);
    }
    let metadata = selected_metadata.context("Native Skill file is unavailable")?;
    ensure!(metadata.is_file(), "Native Skill file is unavailable");
    let selected_file = selected_path.canonicalize()?;
    ensure!(
        selected_file.starts_with(root),
        "Native Skill file left its source directory"
    );
    let read_limit = if metadata.len() > MAX_NATIVE_PREVIEW_BYTES {
        NATIVE_LARGE_PREVIEW_BYTES as u64
    } else {
        MAX_NATIVE_PREVIEW_BYTES
    };
    let mut bytes = Vec::new();
    // One extra byte detects growth beyond the full-preview limit without an
    // unbounded read. Large files only supply a bounded plain-text prefix.
    fs::File::open(selected_file)?
        .take(read_limit + 1)
        .read_to_end(&mut bytes)?;
    let large =
        metadata.len() > MAX_NATIVE_PREVIEW_BYTES || bytes.len() as u64 > MAX_NATIVE_PREVIEW_BYTES;
    let clipped = large && bytes.len() > NATIVE_LARGE_PREVIEW_BYTES;
    if large {
        bytes.truncate(NATIVE_LARGE_PREVIEW_BYTES);
    }
    let text = if bytes.contains(&0) {
        None
    } else {
        match std::str::from_utf8(&bytes) {
            Ok(text) => Some(text),
            // A byte boundary may split the final UTF-8 character; do not
            // replace invalid sequences or silently repair ordinary files.
            Err(error) if clipped && error.error_len().is_none() => {
                std::str::from_utf8(&bytes[..error.valid_up_to()]).ok()
            }
            Err(_) => None,
        }
    };
    let (status, content) = match text {
        Some(text) => (
            if large { "too_large" } else { "text" },
            Some(text.to_owned()),
        ),
        None => ("binary", None),
    };

    // Keep the selected document and entry point reachable even in a partial menu.
    let mut files = vec![SkillContentFile {
        path: selected.to_string(),
        bytes: metadata.len(),
    }];
    if selected != "SKILL.md"
        && let Ok(entry) = fs::symlink_metadata(root.join("SKILL.md"))
        && entry.is_file()
        && !entry.file_type().is_symlink()
    {
        files.push(SkillContentFile {
            path: "SKILL.md".into(),
            bytes: entry.len(),
        });
    }
    let mut listed: HashSet<String> = files.iter().map(|file| file.path.clone()).collect();
    let mut visited = 0;
    let mut pending = vec![(root.to_path_buf(), String::new(), 0usize)];
    'scan: while let Some((directory, prefix, depth)) = pending.pop() {
        if visited >= MAX_NATIVE_PREVIEW_ENTRIES || files.len() >= MAX_NATIVE_PREVIEW_FILES {
            break;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries {
            // Count directories and unreadable entries too, so empty subtrees
            // cannot make a small menu require an unbounded traversal.
            if visited >= MAX_NATIVE_PREVIEW_ENTRIES || files.len() >= MAX_NATIVE_PREVIEW_FILES {
                break 'scan;
            }
            visited += 1;
            let Ok(entry) = entry else { continue };
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if metadata.is_dir() {
                if depth < 8 {
                    pending.push((entry.path(), path, depth + 1));
                }
            } else if metadata.is_file() && listed.insert(path.clone()) {
                files.push(SkillContentFile {
                    path,
                    bytes: metadata.len(),
                });
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(SkillContentView {
        path: selected.to_string(),
        content,
        status,
        files,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_path: String,
    pub canonical_path: String,
    pub source_scope: String,
    pub adapter_kind: AdapterKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSkillScan {
    pub skills: Vec<NativeSkill>,
    pub diagnostics: Vec<NativeSkillDiagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeSkillDiagnosticKind {
    Metadata,
    FileRead,
    DirectoryRead,
    ScanTruncated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSkillDiagnostic {
    pub kind: NativeSkillDiagnosticKind,
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
}

impl NativeSkillDiagnostic {
    fn new(kind: NativeSkillDiagnosticKind, path: &Path, message: impl ToString) -> Self {
        Self {
            kind,
            path: path.to_string_lossy().into_owned(),
            message: message.to_string(),
            skill_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RememberNativeSkillReferencesCommand {
    pub skills: Vec<NativeSkill>,
}

impl sealed::Sealed for RememberNativeSkillReferencesCommand {}
impl DomainCommand for RememberNativeSkillReferencesCommand {
    const TYPE: &'static str = "native_skill.references.remember";
}

/// The displayed native candidates and the registration batch share this result.
pub fn deduplicate_native_skills(skills: &mut Vec<NativeSkill>) {
    let mut seen = HashSet::new();
    skills.retain(|skill| seen.insert(skill.id.clone()));
}

pub fn remember_native_skill_references(
    database: &mut Database,
    skills: &[NativeSkill],
) -> Result<CommandExecution> {
    let envelope = CommandEnvelope {
        command_id: Uuid::new_v4().to_string(),
        actor: ActorRef::System {
            component_id: "native_skill_discovery".to_string(),
        },
        camp_id: None,
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: RememberNativeSkillReferencesCommand {
            skills: skills.to_vec(),
        },
    };
    DomainCommandGateway.execute(database, &envelope, |transaction| {
        let now = chrono::Utc::now().to_rfc3339();
        for skill in &envelope.payload.skills {
            let adapter_kind = serde_json::to_value(skill.adapter_kind)?;
            transaction.execute(
                "INSERT INTO native_skill_reference(id, name, entry_path, canonical_path, source_scope, adapter_kind, discovered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, entry_path=excluded.entry_path, canonical_path=excluded.canonical_path, source_scope=excluded.source_scope, adapter_kind=excluded.adapter_kind, discovered_at=excluded.discovered_at",
                params![skill.id, skill.name, skill.entry_path, skill.canonical_path, skill.source_scope, adapter_kind.as_str(), now],
            )?;
        }
        Ok(CommandHandlerResult::applied(
            "native_skill.references.remembered",
            serde_json::json!({"count": envelope.payload.skills.len()}),
            None,
        ))
    })
}

#[derive(Debug, Clone)]
struct DirectorySkill {
    relative_entry_path: PathBuf,
    id: String,
    name: String,
    description: String,
    canonical_path: String,
}

#[derive(Debug, Clone)]
struct DirectoryScan {
    skills: Vec<DirectorySkill>,
    diagnostics: Vec<NativeSkillDiagnostic>,
}

#[derive(Debug, Clone)]
struct DirectoryCacheEntry {
    key: PathBuf,
    value: DirectoryScan,
    scanned_at: Instant,
}

#[derive(Default)]
struct DirectoryCache {
    entries: VecDeque<DirectoryCacheEntry>,
    inflight: HashMap<PathBuf, Arc<OnceLock<DirectoryScan>>>,
}

#[derive(Default)]
pub struct NativeSkillDiscovery {
    cache: Mutex<DirectoryCache>,
}

pub struct NativeSkillDiscoveryRequest<'a> {
    discovery: &'a NativeSkillDiscovery,
    refresh: bool,
    directories: HashMap<PathBuf, DirectoryScan>,
}

impl NativeSkillDiscovery {
    pub fn invalidate_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.entries.clear();
        }
    }

    pub fn discover(
        &self,
        adapter: AdapterKind,
        project: Option<&Path>,
        user_only: bool,
        refresh: bool,
        configuration: &RuntimeStartupConfiguration,
    ) -> Result<NativeSkillScan> {
        self.request(refresh)
            .discover(adapter, project, user_only, configuration)
    }

    pub fn request(&self, refresh: bool) -> NativeSkillDiscoveryRequest<'_> {
        NativeSkillDiscoveryRequest {
            discovery: self,
            refresh,
            directories: HashMap::new(),
        }
    }

    fn ensure_directory(&self, key: &Path, adapter: AdapterKind, refresh: bool) -> DirectoryScan {
        let flight = {
            let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(flight) = cache.inflight.get(key) {
                Arc::clone(flight)
            } else {
                if !refresh
                    && let Some(index) = cache.entries.iter().position(|entry| entry.key == key)
                {
                    let entry = cache.entries.remove(index).expect("cached index exists");
                    if entry.scanned_at.elapsed() < DIRECTORY_CACHE_TTL {
                        let value = entry.value.clone();
                        cache.entries.push_back(entry);
                        return value;
                    }
                }
                let flight = Arc::new(OnceLock::new());
                cache
                    .inflight
                    .insert(key.to_path_buf(), Arc::clone(&flight));
                flight
            }
        };
        // One initializer scans outside the cache lock; other callers wait on this cell.
        let value = flight.get_or_init(|| scan_directory(key, adapter)).clone();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        if cache
            .inflight
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, &flight))
        {
            cache.inflight.remove(key);
            if let Some(index) = cache.entries.iter().position(|entry| entry.key == key) {
                cache.entries.remove(index);
            }
            cache.entries.push_back(DirectoryCacheEntry {
                key: key.to_path_buf(),
                value: value.clone(),
                scanned_at: Instant::now(),
            });
            while cache.entries.len() > DIRECTORY_CACHE_CAPACITY {
                cache.entries.pop_front();
            }
        }
        value
    }
}

impl NativeSkillDiscoveryRequest<'_> {
    pub fn discover(
        &mut self,
        adapter: AdapterKind,
        project: Option<&Path>,
        user_only: bool,
        configuration: &RuntimeStartupConfiguration,
    ) -> Result<NativeSkillScan> {
        configuration.ensure_environment_available()?;
        let home = if adapter == AdapterKind::HermesCli {
            // Match the native ACP launch: legacy Runtime Home overrides cannot
            // redirect this integration's Skills into a private profile.
            dirs::home_dir()
        } else {
            runtime_variable(
                configuration,
                if cfg!(windows) { "USERPROFILE" } else { "HOME" },
            )
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
        }
        .context("executing Host home directory is unavailable")?;
        ensure!(
            home.is_absolute(),
            "executing Host home directory is not absolute"
        );
        let project =
            project.map(|path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf()));
        if let Some(project) = &project {
            ensure!(project.is_absolute(), "project path is not absolute");
        }
        let mut roots = user_roots(adapter, &home, configuration);
        if !user_only && let Some(project) = &project {
            roots.extend(project_roots(adapter, project));
        }
        let (disabled_paths, disabled_names, config_errors) =
            codex_disabled_skill_folders(adapter, &home, project.as_deref(), configuration);
        let mut scan = NativeSkillScan {
            skills: Vec::new(),
            diagnostics: config_errors,
        };
        let mut seen_roots = HashSet::new();
        let mut seen_files = HashSet::new();
        for (scope, root) in roots {
            let key = directory_key(&root);
            if !seen_roots.insert((scope, key.clone())) {
                continue;
            }
            let directory = self
                .directories
                .entry(key.clone())
                .or_insert_with(|| self.discovery.ensure_directory(&key, adapter, self.refresh));
            scan.diagnostics
                .extend(directory.diagnostics.iter().cloned());
            for skill in &directory.skills {
                if !seen_files.insert(skill.canonical_path.clone()) {
                    continue;
                }
                scan.skills.push(NativeSkill {
                    id: skill.id.clone(),
                    name: skill.name.clone(),
                    description: skill.description.clone(),
                    entry_path: root
                        .join(&skill.relative_entry_path)
                        .to_string_lossy()
                        .into_owned(),
                    canonical_path: skill.canonical_path.clone(),
                    source_scope: scope.to_owned(),
                    adapter_kind: adapter,
                });
            }
        }
        let mut disabled_ids = HashSet::new();
        scan.skills.retain(|skill| {
            let path = Path::new(&skill.canonical_path);
            let enabled = !disabled_names.contains(&skill.name)
                && !disabled_paths.contains(path)
                && path
                    .parent()
                    .is_none_or(|folder| !disabled_paths.contains(folder));
            if !enabled {
                disabled_ids.insert(skill.id.clone());
            }
            enabled
        });
        // Recoverable metadata of explicitly disabled entries is not actionable;
        // read failures stay reported because they never produced an entry.
        scan.diagnostics.retain(|diagnostic| {
            diagnostic.kind != NativeSkillDiagnosticKind::Metadata
                || diagnostic
                    .skill_id
                    .as_ref()
                    .is_none_or(|id| !disabled_ids.contains(id))
        });
        scan.skills.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.source_scope.cmp(&right.source_scope))
                .then_with(|| left.entry_path.cmp(&right.entry_path))
        });
        Ok(scan)
    }
}

fn directory_key(root: &Path) -> PathBuf {
    root.canonicalize().unwrap_or_else(|_| {
        let mut normalized = PathBuf::new();
        for part in root.components() {
            match part {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                _ => normalized.push(part.as_os_str()),
            }
        }
        normalized
    })
}

fn scan_directory(root: &Path, adapter: AdapterKind) -> DirectoryScan {
    let mut scan = NativeSkillScan {
        skills: Vec::new(),
        diagnostics: Vec::new(),
    };
    scan_root(adapter, "user", root, &mut HashSet::new(), &mut scan);
    DirectoryScan {
        skills: scan
            .skills
            .into_iter()
            .map(|skill| DirectorySkill {
                relative_entry_path: Path::new(&skill.entry_path)
                    .strip_prefix(root)
                    .expect("scanned Skill entry stays below its root")
                    .to_path_buf(),
                id: skill.id,
                name: skill.name,
                description: skill.description,
                canonical_path: skill.canonical_path,
            })
            .collect(),
        diagnostics: scan.diagnostics,
    }
}

fn codex_disabled_skill_folders(
    adapter: AdapterKind,
    home: &Path,
    project: Option<&Path>,
    configuration: &RuntimeStartupConfiguration,
) -> (
    HashSet<PathBuf>,
    HashSet<String>,
    Vec<NativeSkillDiagnostic>,
) {
    if adapter != AdapterKind::CodexCli {
        return (HashSet::new(), HashSet::new(), Vec::new());
    }
    let mut paths =
        vec![configured_root("CODEX_HOME", home.join(".codex"), configuration).join("config.toml")];
    if let Some(project) = project {
        paths.push(project.join(".codex/config.toml"));
    }
    let mut path_state = HashMap::<PathBuf, bool>::new();
    let mut name_state = HashMap::<String, bool>::new();
    let mut errors = Vec::new();
    for config_path in paths {
        let contents = match fs::read_to_string(&config_path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(NativeSkillDiagnostic::new(
                    NativeSkillDiagnosticKind::FileRead,
                    &config_path,
                    error,
                ));
                continue;
            }
        };
        let config: toml::Value = match toml::from_str(&contents) {
            Ok(value) => value,
            Err(error) => {
                errors.push(NativeSkillDiagnostic::new(
                    NativeSkillDiagnosticKind::Metadata,
                    &config_path,
                    error,
                ));
                continue;
            }
        };
        let Some(entries) = config.get("skills").and_then(|skills| skills.get("config")) else {
            continue;
        };
        let Some(entries) = entries.as_array() else {
            errors.push(NativeSkillDiagnostic::new(
                NativeSkillDiagnosticKind::Metadata,
                &config_path,
                "skills.config is not an array",
            ));
            continue;
        };
        for entry in entries {
            let Some(enabled) = entry.get("enabled").and_then(toml::Value::as_bool) else {
                continue;
            };
            if let Some(path) = entry.get("path").and_then(toml::Value::as_str) {
                let path = if let Some(suffix) = path.strip_prefix("~/") {
                    home.join(suffix)
                } else {
                    PathBuf::from(path)
                };
                if path.is_absolute() {
                    path_state.insert(path.canonicalize().unwrap_or(path), enabled);
                }
            } else if let Some(name) = entry.get("name").and_then(toml::Value::as_str) {
                name_state.insert(name.to_string(), enabled);
            }
        }
    }
    (
        path_state
            .into_iter()
            .filter_map(|(path, enabled)| (!enabled).then_some(path))
            .collect(),
        name_state
            .into_iter()
            .filter_map(|(name, enabled)| (!enabled).then_some(name))
            .collect(),
        errors,
    )
}

fn runtime_variable(configuration: &RuntimeStartupConfiguration, name: &str) -> Option<OsString> {
    configuration
        .environment
        .iter()
        .find(|entry| {
            if cfg!(windows) {
                entry.name.eq_ignore_ascii_case(name)
            } else {
                entry.name == name
            }
        })
        .map(|entry| OsString::from(&entry.value))
        .or_else(|| std::env::var_os(name))
}

fn configured_root(
    name: &str,
    fallback: PathBuf,
    configuration: &RuntimeStartupConfiguration,
) -> PathBuf {
    runtime_variable(configuration, name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(fallback)
}

fn user_roots(
    adapter: AdapterKind,
    home: &Path,
    configuration: &RuntimeStartupConfiguration,
) -> Vec<(&'static str, PathBuf)> {
    let mut paths = Vec::<PathBuf>::new();
    let agents = home.join(".agents/skills");
    let claude = home.join(".claude/skills");
    match adapter {
        AdapterKind::CodexCli => {
            paths.push(agents);
            paths.push(
                configured_root("CODEX_HOME", home.join(".codex"), configuration).join("skills"),
            );
        }
        AdapterKind::ClaudeCodeCli => paths.push(
            configured_root("CLAUDE_CONFIG_DIR", home.join(".claude"), configuration)
                .join("skills"),
        ),
        AdapterKind::Pi => {
            paths.push(
                configured_root("PI_CODING_AGENT_DIR", home.join(".pi/agent"), configuration)
                    .join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::KiloCli => {
            let xdg = configured_root("XDG_CONFIG_HOME", home.join(".config"), configuration);
            paths.push(
                configured_root("KILO_CONFIG_DIR", xdg.join("kilo"), configuration).join("skills"),
            );
            paths.push(agents);
            paths.push(claude);
        }
        AdapterKind::OpencodeCli => {
            let xdg = configured_root("XDG_CONFIG_HOME", home.join(".config"), configuration);
            paths.push(xdg.join("opencode/skills"));
            paths.push(agents);
            paths.push(claude);
        }
        AdapterKind::CopilotCli => {
            paths.push(home.join(".copilot/skills"));
            paths.push(agents);
            if let Some(extra) = runtime_variable(configuration, "COPILOT_SKILLS_DIRS") {
                paths.extend(
                    extra
                        .to_string_lossy()
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(PathBuf::from)
                        .filter(|path| path.is_absolute()),
                );
            }
        }
        AdapterKind::HermesCli => {
            paths.push(home.join(".hermes/skills"));
            paths.push(agents);
        }
        AdapterKind::KiroCli => paths.push(home.join(".kiro/skills")),
        AdapterKind::QoderCli => {
            paths.push(
                configured_root("QODER_CONFIG_DIR", home.join(".qoder"), configuration)
                    .join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::CodebuddyCli => paths.push(home.join(".codebuddy/skills")),
        AdapterKind::QwenCode => paths.push(
            configured_root("QWEN_CODE_HOME", home.join(".qwen"), configuration).join("skills"),
        ),
        AdapterKind::TraeCnCli => paths.extend(
            [
                ".traecli/skills",
                ".trae/skills",
                ".trae-cn/skills",
                ".coco/skills",
            ]
            .map(|part| home.join(part)),
        ),
        AdapterKind::CursorAgent => paths.extend(
            [
                ".cursor/skills",
                ".agents/skills",
                ".claude/skills",
                ".codex/skills",
                ".cursor/skills-cursor",
            ]
            .map(|part| home.join(part)),
        ),
        AdapterKind::MinimaxCodeCli => {
            paths.push(
                configured_root(
                    "MINIMAX_DATA_DIR",
                    configured_root("MAVIS_DATA_DIR", home.join(".minimax"), configuration),
                    configuration,
                )
                .join("skills"),
            );
            paths.push(agents);
            paths.push(claude);
            paths.push(home.join(".codex/skills"));
        }
        AdapterKind::KimiCodeCli => {
            paths.push(
                configured_root("KIMI_CODE_HOME", home.join(".kimi-code"), configuration)
                    .join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::GrokBuild => paths
            .push(configured_root("GROK_HOME", home.join(".grok"), configuration).join("skills")),
        AdapterKind::DeepseekHarness => {
            paths
                .push(configured_root("DSH_HOME", home.join(".dsh"), configuration).join("skills"));
            paths.push(
                configured_root("DSH_AGENTS_HOME", home.join(".agents"), configuration)
                    .join("skills"),
            );
        }
        AdapterKind::ZcodeApp => paths.push(home.join(".zcode/skills")),
        AdapterKind::CommandCodeCli => {
            paths.push(home.join(".commandcode/skills"));
            paths.push(agents);
        }
        AdapterKind::ClineCli => {
            paths.push(
                configured_root("CLINE_DIR", home.join(".cline"), configuration).join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::AntigravityApp => paths.extend(
            [".gemini/config/skills", ".gemini/antigravity/skills"].map(|part| home.join(part)),
        ),
    }
    paths.into_iter().map(|path| ("user", path)).collect()
}

fn project_roots(adapter: AdapterKind, project: &Path) -> Vec<(&'static str, PathBuf)> {
    let ancestors = matches!(
        adapter,
        AdapterKind::CodexCli
            | AdapterKind::ClaudeCodeCli
            | AdapterKind::Pi
            | AdapterKind::OpencodeCli
            | AdapterKind::KiloCli
            | AdapterKind::MinimaxCodeCli
    );
    let mut directories = vec![project.to_path_buf()];
    if ancestors {
        let mut current = project;
        while !current.join(".git").exists() {
            let Some(parent) = current.parent() else {
                break;
            };
            if parent == current {
                break;
            }
            directories.push(parent.to_path_buf());
            current = parent;
        }
    }
    let parts: &[&str] = match adapter {
        AdapterKind::CodexCli => &[".agents/skills", ".codex/skills"],
        AdapterKind::ClaudeCodeCli => &[".claude/skills"],
        AdapterKind::Pi => &[".pi/skills", ".agents/skills"],
        AdapterKind::OpencodeCli => &[".opencode/skills", ".agents/skills", ".claude/skills"],
        AdapterKind::KiloCli => &[
            ".kilo/skills",
            ".kilocode/skills",
            ".agents/skills",
            ".claude/skills",
        ],
        AdapterKind::CopilotCli => &[".github/skills", ".agents/skills", ".claude/skills"],
        AdapterKind::HermesCli => &[".hermes/skills", ".agents/skills"],
        AdapterKind::KiroCli => &[".kiro/skills"],
        AdapterKind::QoderCli => &[".qoder/skills", ".agents/skills"],
        AdapterKind::CodebuddyCli => &[".codebuddy/skills"],
        AdapterKind::QwenCode => &[".qwen/skills"],
        AdapterKind::TraeCnCli => &[".traecli/skills", ".trae/skills", ".agents/skills"],
        AdapterKind::CursorAgent => &[
            ".cursor/skills",
            ".agents/skills",
            ".claude/skills",
            ".codex/skills",
        ],
        AdapterKind::KimiCodeCli => &[".kimi-code/skills", ".agents/skills"],
        AdapterKind::MinimaxCodeCli => &[".minimax/skills", ".agents/skills", ".claude/skills"],
        AdapterKind::GrokBuild => &[".grok/skills"],
        AdapterKind::DeepseekHarness => &[".dsh/skills", ".agents/skills"],
        AdapterKind::ClineCli => &[".cline/skills", ".agents/skills", ".clinerules/skills"],
        AdapterKind::CommandCodeCli => &[".commandcode/skills", ".agents/skills"],
        AdapterKind::ZcodeApp => &[".zcode/skills"],
        AdapterKind::AntigravityApp => &[".agents/skills", ".agent/skills"],
    };
    directories
        .into_iter()
        .flat_map(|directory| {
            parts
                .iter()
                .map(move |part| ("project", directory.join(part)))
        })
        .collect()
}

fn scan_root(
    adapter: AdapterKind,
    scope: &str,
    root: &Path,
    seen: &mut HashSet<PathBuf>,
    scan: &mut NativeSkillScan,
) {
    use NativeSkillDiagnosticKind::{DirectoryRead, FileRead};
    let items = match fs::read_dir(root) {
        Ok(items) => items,
        Err(error) if missing_path(root, &error) => return,
        Err(error) => {
            scan.diagnostics
                .push(NativeSkillDiagnostic::new(DirectoryRead, root, error));
            return;
        }
    };
    for item in items {
        let item = match item {
            Ok(item) => item,
            Err(error) => {
                scan.diagnostics
                    .push(NativeSkillDiagnostic::new(DirectoryRead, root, error));
                continue;
            }
        };
        let entry = item.path();
        let kind = match item.file_type() {
            Ok(kind) => kind,
            Err(error) => {
                scan.diagnostics
                    .push(NativeSkillDiagnostic::new(FileRead, &entry, error));
                continue;
            }
        };
        if item.file_name() == ".system"
            && root.file_name().is_none_or(|name| name != ".system")
            && kind.is_dir()
        {
            scan_root(adapter, scope, &entry, seen, scan);
            continue;
        }
        // Preserve native entry links. Links to absent targets are not candidates;
        // other failed resolution is surfaced instead of becoming is_dir() == false.
        let metadata = match fs::metadata(&entry) {
            Ok(metadata) => metadata,
            Err(error) if missing_path(&entry, &error) => continue,
            Err(error) => {
                scan.diagnostics
                    .push(NativeSkillDiagnostic::new(FileRead, &entry, error));
                continue;
            }
        };
        let skill_file = if metadata.is_dir() {
            entry.join("SKILL.md")
        } else {
            entry
        };
        if skill_file.file_name().is_none_or(|name| name != "SKILL.md") {
            continue;
        }
        match fs::metadata(&skill_file) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => {
                scan.diagnostics.push(NativeSkillDiagnostic::new(
                    FileRead,
                    &skill_file,
                    "Skill entry is not a regular file",
                ));
                continue;
            }
            Err(error) if missing_path(&skill_file, &error) => continue,
            Err(error) => {
                scan.diagnostics
                    .push(NativeSkillDiagnostic::new(FileRead, &skill_file, error));
                continue;
            }
        }
        let canonical = match skill_file.canonicalize() {
            Ok(path) => path,
            Err(error) => {
                scan.diagnostics
                    .push(NativeSkillDiagnostic::new(FileRead, &skill_file, error));
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }
        match read_native_skill_with_diagnostics(&skill_file, &canonical, scope, adapter) {
            Ok((skill, diagnostics)) => {
                scan.skills.push(skill);
                scan.diagnostics.extend(diagnostics);
            }
            Err(error) => {
                let mut diagnostic =
                    NativeSkillDiagnostic::new(FileRead, &skill_file, format!("{error:#}"));
                diagnostic.skill_id = Some(native_skill_id(&canonical));
                scan.diagnostics.push(diagnostic);
            }
        }
    }
}

/// Absent paths and links whose target is absent are not candidates; loops,
/// permissions and other resolution failures remain reportable.
fn missing_path(path: &Path, error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
        && fs::symlink_metadata(path).map_or_else(
            |error| error.kind() == std::io::ErrorKind::NotFound,
            |metadata| metadata.file_type().is_symlink(),
        )
}

fn native_skill_id(canonical: &Path) -> String {
    format!(
        "native:{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    )
}

/// Original source is never rewritten. Diagnostics affect discovery UI only;
/// all source revalidation uses this same permissive reader.
pub fn read_native_skill(
    entry: &Path,
    canonical: &Path,
    scope: &str,
    adapter: AdapterKind,
) -> Result<NativeSkill> {
    read_native_skill_with_diagnostics(entry, canonical, scope, adapter).map(|(skill, _)| skill)
}

fn read_native_skill_with_diagnostics(
    entry: &Path,
    canonical: &Path,
    scope: &str,
    adapter: AdapterKind,
) -> Result<(NativeSkill, Vec<NativeSkillDiagnostic>)> {
    ensure!(
        fs::metadata(entry)?.is_file(),
        "Skill entry is not a regular file"
    );
    let content = fs::read_to_string(entry).context("Skill entry is unreadable")?;
    ensure!(
        !content.contains('\0'),
        "Skill entry is binary (contains NUL)"
    );
    let text = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let mut lines = text.split_inclusive('\n');
    let mut body = text;
    let mut metadata = serde_yaml::Value::Null;
    let mut problems = Vec::new();
    let first_line = lines.next().unwrap_or_default();
    if first_line.trim_end_matches(['\r', '\n']) == "---" {
        let mut offset = first_line.len();
        let yaml_start = offset;
        let mut closed = false;
        for line in lines {
            let start = offset;
            offset += line.len();
            if line.trim_end_matches(['\r', '\n']) == "---" {
                closed = true;
                body = &text[offset..];
                match serde_yaml::from_str::<serde_yaml::Value>(&text[yaml_start..start]) {
                    Ok(value) if value.is_mapping() || value.is_null() => metadata = value,
                    Ok(_) => problems.push("frontmatter must be a mapping".to_owned()),
                    Err(error) => problems.push(format!("Invalid frontmatter YAML: {error}")),
                }
                break;
            }
        }
        if !closed {
            // The reading view keeps the original document; never describe YAML as prose.
            body = "";
            problems.push("Skill frontmatter is unterminated".to_owned());
        }
    }
    let name = native_metadata_field(&metadata, "name", &mut problems).unwrap_or_else(|| {
        canonical
            .parent()
            .and_then(Path::file_name)
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let description = native_metadata_field(&metadata, "description", &mut problems)
        .unwrap_or_else(|| {
            body.lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .unwrap_or_default()
                .to_owned()
        });
    let id = native_skill_id(canonical);
    let diagnostics = problems
        .into_iter()
        .map(|message| NativeSkillDiagnostic {
            kind: NativeSkillDiagnosticKind::Metadata,
            path: canonical.to_string_lossy().into_owned(),
            message,
            skill_id: Some(id.clone()),
        })
        .collect();
    Ok((
        NativeSkill {
            id,
            name,
            description,
            entry_path: entry.to_string_lossy().into_owned(),
            canonical_path: canonical.to_string_lossy().into_owned(),
            source_scope: scope.to_owned(),
            adapter_kind: adapter,
        },
        diagnostics,
    ))
}

fn native_metadata_field(
    metadata: &serde_yaml::Value,
    field: &str,
    problems: &mut Vec<String>,
) -> Option<String> {
    match metadata.get(field) {
        None | Some(serde_yaml::Value::Null) => None,
        Some(serde_yaml::Value::String(value)) => (!value.trim().is_empty()).then(|| value.clone()),
        Some(_) => {
            problems.push(format!("{field} must be a string"));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_startup::RuntimeEnvironmentVariable;

    #[test]
    fn native_skill_file_preview_stays_inside_its_source_directory() {
        let fixture = std::env::temp_dir().join(format!("rovai-native-preview-{}", Uuid::new_v4()));
        let skill = fixture.join("skill");
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::write(skill.join("SKILL.md"), "# Guide\n").unwrap();
        fs::write(skill.join("references/example.md"), "# Example\n").unwrap();
        fs::write(fixture.join("private.md"), "outside\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            fixture.join("private.md"),
            skill.join("references/linked.md"),
        )
        .unwrap();
        let skill = skill.canonicalize().unwrap();
        let view = read_native_skill_content(&skill, "references/example.md").unwrap();
        assert_eq!(view.content.as_deref(), Some("# Example\n"));
        assert_eq!(view.files.len(), 2);
        assert!(read_native_skill_content(&skill, "../private.md").is_err());
        #[cfg(unix)]
        assert!(read_native_skill_content(&skill, "references/linked.md").is_err());
        for invalid in [
            "",
            "/SKILL.md",
            "./SKILL.md",
            "references/../SKILL.md",
            "references\\example.md",
        ] {
            assert!(
                read_native_skill_content(&skill, invalid).is_err(),
                "{invalid}"
            );
        }
        assert!(read_native_skill_content(&skill, "missing.md").is_err());
        assert!(read_native_skill_content(&skill, "references").is_err());
        fs::write(skill.join("binary.bin"), b"a\0b").unwrap();
        assert_eq!(
            read_native_skill_content(&skill, "binary.bin")
                .unwrap()
                .status,
            "binary"
        );
        fs::File::create(skill.join("large.txt"))
            .unwrap()
            .set_len(MAX_NATIVE_PREVIEW_BYTES + 1)
            .unwrap();
        let large = read_native_skill_content(&skill, "large.txt").unwrap();
        assert_eq!(large.status, "binary");
        assert!(large.content.is_none());
        for size in [1024 * 1024 + 1, MAX_NATIVE_PREVIEW_BYTES as usize] {
            let source = "a".repeat(size);
            fs::write(skill.join("ordinary.txt"), &source).unwrap();
            let view = read_native_skill_content(&skill, "ordinary.txt").unwrap();
            assert_eq!(view.status, "text");
            assert_eq!(view.content.as_deref(), Some(source.as_str()));
        }
        let mut source = "a".repeat(MAX_NATIVE_PREVIEW_BYTES as usize + 1);
        let boundary = NATIVE_LARGE_PREVIEW_BYTES - 1;
        source.replace_range(boundary..boundary + 3, "中");
        fs::write(skill.join("large.txt"), &source).unwrap();
        let large = read_native_skill_content(&skill, "large.txt").unwrap();
        assert_eq!(large.status, "too_large");
        assert_eq!(large.content.as_deref(), Some(&source[..boundary]));
        assert_eq!(fs::read_to_string(skill.join("large.txt")).unwrap(), source);
        // Invalid UTF-8 inside the prefix is still binary, unlike a character
        // split by the preview boundary.
        let mut invalid = source.into_bytes();
        invalid[4] = 0xff;
        fs::write(skill.join("large.txt"), invalid).unwrap();
        let invalid = read_native_skill_content(&skill, "large.txt").unwrap();
        assert_eq!(invalid.status, "binary");
        assert!(invalid.content.is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(skill.join("SKILL.md"), skill.join("local-link.md"))
                .unwrap();
            std::os::unix::fs::symlink(skill.join("references"), skill.join("linked-directory"))
                .unwrap();
            assert!(read_native_skill_content(&skill, "local-link.md").is_err());
            assert!(read_native_skill_content(&skill, "linked-directory/example.md").is_err());
        }
        let resources = skill.join("many");
        fs::create_dir(&resources).unwrap();
        for index in 0..=MAX_NATIVE_PREVIEW_FILES {
            fs::write(resources.join(format!("{index}.md")), "resource").unwrap();
        }
        for selected in ["SKILL.md", "references/example.md", "many/512.md"] {
            let view = read_native_skill_content(&skill, selected).unwrap();
            assert_eq!(view.status, "text");
            assert!(!view.content.unwrap().is_empty());
            assert!(view.files.len() <= MAX_NATIVE_PREVIEW_FILES);
            assert!(view.files.iter().any(|file| file.path == selected));
            assert!(view.files.iter().any(|file| file.path == "SKILL.md"));
        }
        fs::remove_dir_all(resources).unwrap();
        let deep = skill.join("deep/a/b/c/d/e/f/g/h/i");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("leaf.md"), "deep selected content").unwrap();
        let view = read_native_skill_content(&skill, "SKILL.md").unwrap();
        assert_eq!(view.content.as_deref(), Some("# Guide\n"));
        assert!(!view.files.iter().any(|file| file.path.ends_with("leaf.md")));
        // Menu depth bounds do not make an explicitly selected regular file unreadable.
        assert_eq!(
            read_native_skill_content(&skill, "deep/a/b/c/d/e/f/g/h/i/leaf.md")
                .unwrap()
                .content
                .as_deref(),
            Some("deep selected content")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let blocked = skill.join("unreadable");
            fs::create_dir(&blocked).unwrap();
            fs::write(blocked.join("private.md"), "blocked").unwrap();
            fs::set_permissions(&blocked, fs::Permissions::from_mode(0o000)).unwrap();
            let access_denied = fs::read_dir(&blocked).is_err();
            let body = read_native_skill_content(&skill, "SKILL.md");
            let selected = read_native_skill_content(&skill, "unreadable/private.md");
            fs::set_permissions(&blocked, fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(body.unwrap().content.as_deref(), Some("# Guide\n"));
            if access_denied {
                assert!(selected.is_err());
            }
        }
        fs::remove_dir_all(fixture).unwrap();
    }

    #[cfg(feature = "extended-tests")]
    #[test]
    fn native_reference_batch_rolls_back_when_one_source_is_invalid() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-register-{}", Uuid::new_v4()));
        let mut database = Database::open(&fixture).unwrap();
        let valid = NativeSkill {
            id: "native:valid".to_string(),
            name: "valid".to_string(),
            description: "Valid".to_string(),
            entry_path: "/tmp/valid/SKILL.md".to_string(),
            canonical_path: "/tmp/valid/SKILL.md".to_string(),
            source_scope: "user".to_string(),
            adapter_kind: AdapterKind::CodexCli,
        };
        let mut invalid = valid.clone();
        invalid.id = "native:invalid".to_string();
        invalid.source_scope = "invalid".to_string();
        assert!(remember_native_skill_references(&mut database, &[valid, invalid]).is_err());
        let count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM native_skill_reference WHERE id LIKE 'native:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        // Exercise the same aggregate -> register -> select -> preflight path as
        // skills.candidates. The first displayed source must also be registered.
        let home = fixture.join("home");
        let directory = home.join(".agents/skills/Canonical_Name");
        fs::create_dir_all(&directory).unwrap();
        let entry = directory.join("SKILL.md");
        fs::write(&entry, "# Native document").unwrap();
        #[cfg(unix)]
        for alias in [".codex/skills/first-entry", ".pi/agent/skills/second-entry"] {
            let alias = home.join(alias);
            fs::create_dir_all(alias.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(&directory, alias).unwrap();
        }
        let configuration = RuntimeStartupConfiguration {
            environment: vec![RuntimeEnvironmentVariable {
                name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.into(),
                value: home.to_string_lossy().into_owned(),
            }],
            ..RuntimeStartupConfiguration::default()
        };
        let discovery = NativeSkillDiscovery::default();
        let mut candidates = Vec::new();
        for adapter in [AdapterKind::CodexCli, AdapterKind::Pi] {
            candidates.extend(
                discovery
                    .discover(adapter, None, true, false, &configuration)
                    .unwrap()
                    .skills,
            );
        }
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].id, candidates[1].id);
        assert_eq!(candidates[0].name, "Canonical_Name");
        assert_eq!(candidates[1].name, "Canonical_Name");
        #[cfg(unix)]
        assert_ne!(candidates[0].entry_path, candidates[1].entry_path);
        let first = candidates[0].clone();
        deduplicate_native_skills(&mut candidates);
        assert_eq!(candidates, vec![first.clone()]);
        remember_native_skill_references(&mut database, &candidates).unwrap();
        let registered: (String, String) = database
            .connection()
            .query_row(
                "SELECT name, entry_path FROM native_skill_reference WHERE id=?1",
                [&first.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(registered, (first.name.clone(), first.entry_path.clone()));
        let content = vec![
            crate::camp_content::StructuredThreadMessageSegment::SkillMention {
                skill_id: first.id.clone(),
                name_at_send: first.name.clone(),
            },
        ];
        crate::camp_content::validate_user_authored_content(&content).unwrap();
        let transaction = database.connection().unchecked_transaction().unwrap();
        let selection = crate::current_input_skill::freeze_skill_selection(
            &transaction,
            &content,
            AdapterKind::Pi,
        )
        .unwrap();
        transaction.commit().unwrap();
        let digest = selection.canonical_digest().unwrap();
        let exposure = crate::skill_projection::PreparedSkillExposure {
            snapshot: crate::skill_projection::SkillExposureSnapshot::default(),
            digest: String::new(),
        };
        let resolve = || {
            crate::current_input_skill::resolve_current_input_skills(
                database.connection(),
                &selection,
                &digest,
                &exposure,
                AdapterKind::Pi,
            )
            .unwrap()
        };
        for text in [
            "# Native document",
            "---\nname:\n---\nMissing fields",
            "---\nname: [broken\n---\nBody",
            "---\nname: unclosed",
        ] {
            fs::write(&entry, text).unwrap();
            let claimed = crate::current_input_skill::projected_skill_links_for_claim(
                database.connection(),
                &selection,
                AdapterKind::Pi,
                &fixture,
            )
            .unwrap();
            let resolved = resolve();
            assert_eq!(claimed, resolved.links);
            assert_eq!(resolved.links.len(), 1, "{text}");
            assert_eq!(resolved.links[0].name, first.name);
        }
        let frozen = resolve();
        fs::write(&entry, "---\nname: renamed\n---\nBody").unwrap();
        assert!(resolve().links.is_empty());
        assert_eq!(selection.entries[0].name_at_send, "Canonical_Name");
        assert_eq!(selection.canonical_digest().unwrap(), digest);
        // Recovery validates frozen evidence without rereading the changed file.
        crate::current_input_skill::validate_persisted_resolution(
            &serde_json::to_string(&frozen.resolution).unwrap(),
            &frozen.digest,
            &selection,
            &digest,
            "",
        )
        .unwrap();
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn runtime_directory_overrides_change_native_candidates_without_explicit_refresh() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-roots-{}", uuid::Uuid::new_v4()));
        let home = fixture.join("home");
        let first = fixture.join("first");
        let second = fixture.join("second");
        for (root, name) in [
            (first.clone(), "one"),
            (second.clone(), "two"),
            (home.join(".agents"), "shared"),
            (home.join(".codex"), "default"),
            (home.join(".qoder"), "default"),
        ] {
            let directory = root.join("skills").join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Native source\n---\n"),
            )
            .unwrap();
        }
        // The adapter-specific override must not hide the shared user store.
        // Keep the default and cache-invalidation cases under the same discovery owner.
        for (adapter, variable) in [
            (AdapterKind::CodexCli, "CODEX_HOME"),
            (AdapterKind::QoderCli, "QODER_CONFIG_DIR"),
        ] {
            let discovery = NativeSkillDiscovery::default();
            for (root, expected) in [
                (None, vec!["default", "shared"]),
                (Some(&first), vec!["one", "shared"]),
                (Some(&second), vec!["shared", "two"]),
            ] {
                let mut configuration = RuntimeStartupConfiguration {
                    custom_api_snapshot: None,
                    common_environment_unavailable: false,
                    configuration_error: None,
                    program_path: None,
                    environment: vec![RuntimeEnvironmentVariable {
                        name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                        value: home.to_string_lossy().into_owned(),
                    }],
                };
                if let Some(root) = root {
                    configuration.environment.push(RuntimeEnvironmentVariable {
                        name: variable.to_owned(),
                        value: root.to_string_lossy().into_owned(),
                    });
                }
                let scan = discovery
                    .discover(adapter, None, true, false, &configuration)
                    .unwrap();
                let mut names = scan
                    .skills
                    .iter()
                    .map(|skill| skill.name.as_str())
                    .collect::<Vec<_>>();
                names.sort_unstable();
                assert_eq!(names, expected, "{adapter:?}, {root:?}");
                assert!(scan.diagnostics.is_empty());
                assert!(scan.skills.iter().all(|skill| skill.source_scope == "user"));
            }
        }
        let native_home = home.join(".hermes");
        fs::rename(&first, &native_home).unwrap();
        let first = native_home;
        // File discovery uses fixed roots, including non-Git projects. Native
        // configuration controls Hermes loading, not these explicit candidates.
        let project = fixture.join("project");
        let nested = project.join("subdir");
        fs::create_dir_all(&nested).unwrap();
        for (root, name) in [
            (first.join("created"), "created"),
            (project.join(".agents/skills"), "project-agents"),
            (project.join(".hermes/skills"), "project-hermes"),
        ] {
            fs::create_dir_all(root.join(name)).unwrap();
            fs::write(
                root.join(name).join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Native source\n---\n"),
            )
            .unwrap();
        }
        let configuration = RuntimeStartupConfiguration::default();
        let discovery = NativeSkillDiscovery::default();
        let names = |project: Option<&Path>| {
            let mut roots = user_roots(AdapterKind::HermesCli, &home, &configuration);
            assert_eq!(
                roots,
                vec![
                    ("user", first.join("skills")),
                    ("user", home.join(".agents/skills"))
                ]
            );
            if let Some(project) = project {
                roots.extend(project_roots(AdapterKind::HermesCli, project));
            }
            let mut names = Vec::new();
            for (_, root) in roots {
                let scanned =
                    discovery.ensure_directory(&directory_key(&root), AdapterKind::HermesCli, true);
                assert!(scanned.diagnostics.is_empty());
                names.extend(scanned.skills.into_iter().map(|skill| skill.name));
            }
            names.sort();
            names
        };
        let native_config = serde_json::json!({"skills": {
            "create_dir":"created", "external_dirs":[second.join("skills")],
            "disabled":["one"], "platform_disabled":{"acp":["shared"]},
            "project_discovery":false
        }})
        .to_string();
        for config in [native_config.as_str(), "skills: [invalid YAML"] {
            fs::write(first.join("config.yaml"), config).unwrap();
            assert_eq!(names(None), ["one", "shared"]);
            assert_eq!(
                names(Some(&project)),
                ["one", "project-agents", "project-hermes", "shared"]
            );
            assert_eq!(
                names(Some(&nested)),
                ["one", "shared"],
                "do not search ancestors"
            );
            assert_eq!(
                fs::read_to_string(first.join("config.yaml")).unwrap(),
                config
            );
        }
        let project = fixture.join("command-project");
        for (root, name) in [
            (home.join(".commandcode/skills"), "command-user"),
            (project.join(".commandcode/skills"), "command-project"),
            (project.join(".agents/skills"), "project-shared"),
        ] {
            let directory = root.join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Native source\n---\n"),
            )
            .unwrap();
        }
        let configuration = RuntimeStartupConfiguration {
            environment: vec![RuntimeEnvironmentVariable {
                name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                value: home.to_string_lossy().into_owned(),
            }],
            ..RuntimeStartupConfiguration::default()
        };
        let scan = NativeSkillDiscovery::default()
            .discover(
                AdapterKind::CommandCodeCli,
                Some(&project),
                false,
                false,
                &configuration,
            )
            .unwrap();
        assert!(scan.diagnostics.is_empty());
        assert_eq!(
            scan.skills
                .iter()
                .map(|skill| (skill.name.as_str(), skill.source_scope.as_str()))
                .collect::<Vec<_>>(),
            [
                ("command-project", "project"),
                ("command-user", "user"),
                ("project-shared", "project"),
                ("shared", "user")
            ]
        );

        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn codex_explicit_disable_removes_candidate_and_config_change_invalidates_cache() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-disabled-{}", uuid::Uuid::new_v4()));
        let home = fixture.join("home");
        let codex_home = home.join(".codex");
        let skill_dir = codex_home.join("skills/review");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: review\ndescription: Review\n---\n",
        )
        .unwrap();
        let configuration = RuntimeStartupConfiguration {
            custom_api_snapshot: None,
            common_environment_unavailable: false,
            configuration_error: None,
            program_path: None,
            environment: vec![RuntimeEnvironmentVariable {
                name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                value: home.to_string_lossy().into_owned(),
            }],
        };
        let discovery = NativeSkillDiscovery::default();
        fs::write(
            codex_home.join("config.toml"),
            format!(
                "[[skills.config]]\npath = {:?}\nenabled = false\n",
                skill_dir.join("SKILL.md").to_string_lossy()
            ),
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            "[[skills.config]]\nname = \"review\"\nenabled = false\n",
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            format!(
                "[[skills.config]]\npath = {:?}\nenabled = false\n",
                skill_dir.to_string_lossy()
            ),
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            "[[skills.config]]\nname = \"review\"\nenabled = true\n",
        )
        .unwrap();
        assert_eq!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .len(),
            1
        );

        // A disabled entry's recoverable metadata is not reported; a broken
        // disable config and real read failures still are.
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: review\ndescription: [list]\n---\nBody\n",
        )
        .unwrap();
        let blocked = home.join(".agents/skills/blocked");
        fs::create_dir_all(&blocked).unwrap();
        fs::create_dir(blocked.join("SKILL.md")).unwrap();
        let enabled = discovery
            .discover(AdapterKind::CodexCli, None, true, true, &configuration)
            .unwrap();
        assert_eq!(enabled.skills.len(), 1);
        assert!(enabled.diagnostics.iter().any(|item| {
            item.kind == NativeSkillDiagnosticKind::Metadata
                && item.skill_id.as_deref() == Some(enabled.skills[0].id.as_str())
        }));
        fs::write(
            codex_home.join("config.toml"),
            "[[skills.config]]\nname = \"review\"\nenabled = false\n",
        )
        .unwrap();
        let disabled = discovery
            .discover(AdapterKind::CodexCli, None, true, false, &configuration)
            .unwrap();
        assert!(disabled.skills.is_empty());
        assert!(
            !disabled
                .diagnostics
                .iter()
                .any(|item| item.kind == NativeSkillDiagnosticKind::Metadata)
        );
        assert!(disabled.diagnostics.iter().any(|item| {
            item.kind == NativeSkillDiagnosticKind::FileRead
                && item.path.ends_with("blocked/SKILL.md")
        }));
        fs::write(codex_home.join("config.toml"), "[skills\n").unwrap();
        let broken = discovery
            .discover(AdapterKind::CodexCli, None, true, false, &configuration)
            .unwrap();
        assert_eq!(broken.skills.len(), 1);
        assert!(broken.diagnostics.iter().any(|item| {
            item.kind == NativeSkillDiagnosticKind::Metadata
                && item.skill_id.is_none()
                && item.path.ends_with("config.toml")
        }));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn same_name_sources_keep_separate_identities_and_bad_entries_are_reported() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-skills-{}", uuid::Uuid::new_v4()));
        let user_root = fixture.join("user");
        let project_root = fixture.join("project");
        for root in [&user_root, &project_root] {
            fs::create_dir_all(root.join("review")).unwrap();
            fs::write(
                root.join("review/SKILL.md"),
                "---\nname: review\ndescription: Review code\n---\n",
            )
            .unwrap();
        }
        fs::create_dir_all(project_root.join("broken")).unwrap();
        fs::write(
            project_root.join("broken/SKILL.md"),
            "---\nname: [invalid\n---\n",
        )
        .unwrap();

        let mut scan = NativeSkillScan {
            skills: Vec::new(),
            diagnostics: Vec::new(),
        };
        let mut seen = HashSet::new();
        scan_root(
            AdapterKind::CodexCli,
            "user",
            &user_root,
            &mut seen,
            &mut scan,
        );
        scan_root(
            AdapterKind::CodexCli,
            "project",
            &project_root,
            &mut seen,
            &mut scan,
        );

        assert_eq!(scan.skills.len(), 3);
        let reviews = scan
            .skills
            .iter()
            .filter(|skill| skill.name == "review")
            .collect::<Vec<_>>();
        assert_eq!(reviews.len(), 2);
        assert_ne!(reviews[0].id, reviews[1].id);
        assert_eq!(scan.diagnostics.len(), 1);
        assert!(scan.diagnostics[0].path.contains("broken"));

        // Canonical paths remain identity evidence, while Runtime-facing links
        // must be usable by native file tools that reject Windows verbatim paths.
        let selection: crate::current_input_skill::SkillSelectionSnapshot =
            serde_json::from_value(serde_json::json!({
                "schemaVersion": 2,
                "entries": scan.skills.iter().enumerate().map(|(index, skill)| {
                    serde_json::json!({
                        "skillId": skill.id, "nameAtSend": skill.name,
                        "source": "native", "sourcePath": skill.canonical_path,
                        "firstMessageIndex": 0, "firstSegmentIndex": index,
                    })
                }).collect::<Vec<_>>()
            }))
            .unwrap();
        let digest = selection.canonical_digest().unwrap();
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        let claimed = crate::current_input_skill::projected_skill_links_for_claim(
            &connection,
            &selection,
            AdapterKind::MinimaxCodeCli,
            &project_root,
        )
        .unwrap();
        let resolved = crate::current_input_skill::resolve_current_input_skills(
            &connection,
            &selection,
            &digest,
            &crate::skill_projection::PreparedSkillExposure {
                snapshot: crate::skill_projection::SkillExposureSnapshot::default(),
                digest: String::new(),
            },
            AdapterKind::MinimaxCodeCli,
        )
        .unwrap();
        assert_eq!(claimed, resolved.links);
        assert_eq!(claimed.len(), 3);
        for (index, skill) in scan.skills.iter().enumerate() {
            assert_eq!(
                claimed[index].path,
                dunce::simplified(Path::new(&skill.canonical_path)).to_string_lossy()
            );
            assert_eq!(claimed[index].skill_id.as_deref(), Some(skill.id.as_str()));
            assert_eq!(
                resolved.resolution.entries[index].source_path.as_deref(),
                Some(skill.canonical_path.as_str())
            );
        }
        assert_eq!(selection.canonical_digest().unwrap(), digest);

        let document = fixture.join("canonical_name");
        fs::create_dir(&document).unwrap();
        let entry = document.join("SKILL.md");
        let cases = [
            ("# Plain\nBody", "canonical_name", "# Plain", 0),
            ("\u{feff}# BOM", "canonical_name", "# BOM", 0),
            (
                "---\n---\n# Empty header",
                "canonical_name",
                "# Empty header",
                0,
            ),
            (
                "---\nname:\ndescription: ''\n---\nBody",
                "canonical_name",
                "Body",
                0,
            ),
            (
                "---\nname: Native_Name\n---\nBody",
                "Native_Name",
                "Body",
                0,
            ),
            (
                "---\nname: [bad]\ndescription: valid\n---\nBody",
                "canonical_name",
                "valid",
                1,
            ),
            (
                "---\nname: valid\ndescription: 42\n---\nBody",
                "valid",
                "Body",
                1,
            ),
            ("---\nname: [bad\n---\nBody", "canonical_name", "Body", 1),
            ("---\nname: unclosed", "canonical_name", "", 1),
            (
                "\u{feff}---\r\nname: Native_Name\r\ndescription: >-\r\n  中文 \"quoted\"\r\n  next \\ path\r\n---\r\nBody",
                "Native_Name",
                "中文 \"quoted\" next \\ path",
                0,
            ),
            (
                "---\ndescription: |\n  第一行\n  second \\ line\n---\nBody",
                "canonical_name",
                "第一行\nsecond \\ line\n",
                0,
            ),
        ];
        for (source, name, description, problems) in cases {
            fs::write(&entry, source).unwrap();
            let canonical = entry.canonicalize().unwrap();
            let (skill, diagnostics) = read_native_skill_with_diagnostics(
                &entry,
                &canonical,
                "user",
                AdapterKind::CodexCli,
            )
            .unwrap();
            assert_eq!(
                (skill.name.as_str(), skill.description.as_str()),
                (name, description),
                "{source}"
            );
            assert_eq!(diagnostics.len(), problems, "{source}");
            assert!(
                diagnostics
                    .iter()
                    .all(|item| item.kind == NativeSkillDiagnosticKind::Metadata
                        && item.skill_id.as_deref() == Some(&skill.id))
            );
            assert_eq!(
                read_native_skill_content(&document.canonicalize().unwrap(), "SKILL.md")
                    .unwrap()
                    .content
                    .as_deref(),
                Some(source)
            );
        }
        fs::write(
            &entry,
            format!(
                "---\nname: canonical_name\ndescription: Large native document\n---\n{}",
                "a".repeat(MAX_NATIVE_PREVIEW_BYTES as usize + 1)
            ),
        )
        .unwrap();
        assert!(
            read_native_skill(
                &entry,
                &entry.canonicalize().unwrap(),
                "user",
                AdapterKind::CodexCli
            )
            .is_ok()
        );
        let preview =
            read_native_skill_content(&document.canonicalize().unwrap(), "SKILL.md").unwrap();
        assert_eq!(preview.status, "too_large");
        assert_eq!(preview.content.unwrap().len(), NATIVE_LARGE_PREVIEW_BYTES);
        for bytes in [b"text\0binary".as_slice(), &[0xff]] {
            fs::write(&entry, bytes).unwrap();
            let result = scan_directory(&document, AdapterKind::CodexCli);
            assert!(result.skills.is_empty());
            assert_eq!(
                result.diagnostics[0].kind,
                NativeSkillDiagnosticKind::FileRead
            );
            assert!(result.diagnostics[0].skill_id.is_some());
        }

        // Failed path checks must not be swallowed or discard unrelated successes.
        let failures = fixture.join("failures");
        fs::create_dir_all(failures.join("good")).unwrap();
        fs::write(failures.join("good/SKILL.md"), "Readable").unwrap();
        fs::create_dir_all(failures.join("ordinary-directory")).unwrap();
        fs::create_dir_all(failures.join("unsupported/SKILL.md")).unwrap();
        let result = scan_directory(&failures, AdapterKind::CodexCli);
        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(
            result.diagnostics[0].kind,
            NativeSkillDiagnosticKind::FileRead
        );
        assert!(result.diagnostics[0].path.ends_with("unsupported/SKILL.md"));
        assert_eq!(
            scan_directory(&entry, AdapterKind::CodexCli).diagnostics[0].kind,
            NativeSkillDiagnosticKind::DirectoryRead
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::{PermissionsExt, symlink};
            let broken = failures.join("dangling");
            symlink(failures.join("absent"), &broken).unwrap();
            fs::create_dir(failures.join("dangling-entry")).unwrap();
            symlink(
                failures.join("absent/SKILL.md"),
                failures.join("dangling-entry/SKILL.md"),
            )
            .unwrap();
            symlink(failures.join("good"), failures.join("linked-good")).unwrap();
            let loop_path = failures.join("loop");
            symlink(&loop_path, &loop_path).unwrap();
            let denied = failures.join("denied");
            fs::create_dir(&denied).unwrap();
            fs::write(denied.join("SKILL.md"), "blocked").unwrap();
            fs::set_permissions(&denied, fs::Permissions::from_mode(0o000)).unwrap();
            let permission_denied = fs::metadata(denied.join("SKILL.md")).is_err();
            let result = scan_directory(&failures, AdapterKind::CodexCli);
            let blocked_root = scan_directory(&denied, AdapterKind::CodexCli);
            fs::set_permissions(&denied, fs::Permissions::from_mode(0o700)).unwrap();
            // Links whose targets are absent are not candidates and not diagnostics.
            assert!(
                !result
                    .diagnostics
                    .iter()
                    .any(|item| { item.path.contains("dangling") || item.path.contains("absent") })
            );
            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|item| item.path == loop_path.to_string_lossy()
                        && item.kind == NativeSkillDiagnosticKind::FileRead)
            );
            if permission_denied {
                assert!(
                    result
                        .diagnostics
                        .iter()
                        .any(|item| item.path == denied.join("SKILL.md").to_string_lossy())
                );
                assert_eq!(
                    blocked_root.diagnostics[0].kind,
                    NativeSkillDiagnosticKind::DirectoryRead
                );
            }
            assert!(result.skills.iter().any(|skill| skill.name == "good"));

            let only_dangling = fixture.join("only-dangling");
            fs::create_dir(&only_dangling).unwrap();
            for name in ["lark-mail", "lark-doc"] {
                symlink(fixture.join("removed").join(name), only_dangling.join(name)).unwrap();
            }
            let result = scan_directory(&only_dangling, AdapterKind::CodexCli);
            assert!(result.skills.is_empty());
            assert!(result.diagnostics.is_empty());
            let dangling_root = fixture.join("dangling-root");
            symlink(fixture.join("removed-root"), &dangling_root).unwrap();
            let result = scan_directory(&dangling_root, AdapterKind::CodexCli);
            assert!(result.skills.is_empty() && result.diagnostics.is_empty());

            let linked_only = fixture.join("linked-only");
            fs::create_dir(&linked_only).unwrap();
            symlink(failures.join("good"), linked_only.join("linked-good")).unwrap();
            let result = scan_directory(&linked_only, AdapterKind::CodexCli);
            assert!(result.diagnostics.is_empty());
            assert_eq!(result.skills.len(), 1);
            assert_eq!(
                result.skills[0].canonical_path,
                failures
                    .join("good/SKILL.md")
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
            );
        }
        let complete = fixture.join("complete-discovery");
        fs::create_dir(&complete).unwrap();
        for index in 0..600 {
            fs::write(complete.join(format!("{index}.txt")), "not a Skill").unwrap();
            let directory = complete.join(format!("skill-{index}"));
            fs::create_dir(&directory).unwrap();
            fs::write(directory.join("SKILL.md"), "# Native document").unwrap();
        }
        fs::create_dir_all(complete.join(".system/bundled")).unwrap();
        fs::write(complete.join(".system/bundled/SKILL.md"), "# Bundled").unwrap();
        fs::create_dir_all(complete.join("unrelated/nested")).unwrap();
        fs::write(
            complete.join("unrelated/nested/SKILL.md"),
            "# Outside discovery scope",
        )
        .unwrap();
        let result = scan_directory(&complete, AdapterKind::CodexCli);
        assert_eq!(result.skills.len(), 601);
        assert!(result.diagnostics.is_empty());
        assert!(result.skills.iter().any(|skill| skill.name == "skill-599"));
        assert!(result.skills.iter().any(|skill| skill.name == "bundled"));
        assert!(!result.skills.iter().any(|skill| skill.name == "nested"));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn shared_directory_keeps_runtime_paths_and_refreshes_once_per_request() {
        let fixture = std::env::temp_dir().join(format!("rovai-native-shared-{}", Uuid::new_v4()));
        let home = fixture.join("home");
        let shared = home.join(".agents/skills");
        let entry = shared.join("review/SKILL.md");
        fs::create_dir_all(entry.parent().unwrap()).unwrap();
        fs::write(&entry, "---\nname: [broken\n---\nOne").unwrap();
        #[cfg(unix)]
        {
            let pi_root = home.join(".pi/agent/skills");
            fs::create_dir_all(pi_root.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(&shared, &pi_root).unwrap();
        }
        let configuration = RuntimeStartupConfiguration {
            custom_api_snapshot: None,
            common_environment_unavailable: false,
            configuration_error: None,
            program_path: None,
            environment: vec![RuntimeEnvironmentVariable {
                name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                value: home.to_string_lossy().into_owned(),
            }],
        };
        let discovery = NativeSkillDiscovery::default();
        let codex = discovery
            .discover(AdapterKind::CodexCli, None, true, false, &configuration)
            .unwrap();
        fs::write(&entry, "---\nname: review\ndescription: Two\n---\n").unwrap();
        let pi = discovery
            .discover(AdapterKind::Pi, None, true, false, &configuration)
            .unwrap();
        assert_eq!(codex.skills[0].description, "One");
        assert_eq!(pi.skills[0].description, "One");
        assert_eq!(codex.diagnostics, pi.diagnostics);
        assert_eq!(codex.diagnostics.len(), 1);
        assert_eq!(codex.skills[0].id, pi.skills[0].id);
        assert_eq!(pi.skills[0].adapter_kind, AdapterKind::Pi);
        #[cfg(unix)]
        assert_eq!(
            pi.skills[0].entry_path,
            home.join(".pi/agent/skills/review/SKILL.md")
                .to_string_lossy()
        );

        let mut refresh = discovery.request(true);
        let updated = refresh
            .discover(AdapterKind::CodexCli, None, true, &configuration)
            .unwrap();
        assert_eq!(updated.skills[0].description, "Two");
        assert!(updated.diagnostics.is_empty());
        fs::write(&entry, "---\nname: review\ndescription: Three\n---\n").unwrap();
        let reused = refresh
            .discover(AdapterKind::Pi, None, true, &configuration)
            .unwrap();
        assert_eq!(reused.skills[0].description, "Two");
        let next_request = discovery
            .discover(AdapterKind::Pi, None, true, true, &configuration)
            .unwrap();
        assert_eq!(next_request.skills[0].description, "Three");
        fs::remove_dir_all(fixture).unwrap();
    }
}
