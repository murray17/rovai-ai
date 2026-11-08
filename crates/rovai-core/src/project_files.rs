//! Lazy, bounded project browsing. Database work only resolves the current business root;
//! traversal and watcher installation run on the blocking pool, outside Core's command queue.
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ignore::WalkBuilder;
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{AccessKind, AccessMode},
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;

use crate::{db::Database, file_preview_authority::ResolvedFilePreviewSource};

const LEASE: Duration = Duration::from_secs(60);

fn invalidates_directory(event: &Event) -> bool {
    event.need_rescan()
        || matches!(
            event.kind,
            EventKind::Any
                | EventKind::Create(_)
                | EventKind::Modify(_)
                | EventKind::Remove(_)
                | EventKind::Access(AccessKind::Close(AccessMode::Write))
        )
}

// A reversible locator, not a per-file permission or server registration.
fn entry_path(id: &str) -> Result<PathBuf> {
    if id == "root" {
        return Ok(PathBuf::new());
    }
    let relative = String::from_utf8(
        URL_SAFE_NO_PAD.decode(id.strip_prefix("p:").context("entry_unavailable")?)?,
    )?;
    ensure!(
        !relative.is_empty()
            && Path::new(&relative)
                .components()
                .all(|c| matches!(c, Component::Normal(_))),
        "entry_unavailable"
    );
    Ok(relative.into())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    path: PathBuf,
    identity: String,
}

/// Metadata only: this must never create or restore a Mission worktree.
pub fn binding(database: &Database, thread: &str) -> Result<Binding> {
    ensure!(
        !thread.is_empty() && thread.len() <= 128,
        "root_unavailable"
    );
    binding_from_connection(database.connection(), thread)
}

pub(crate) fn binding_from_connection(
    connection: &rusqlite::Connection,
    thread: &str,
) -> Result<Binding> {
    let project: String = connection.query_row(
        "SELECT project_path FROM camp WHERE id=?1 AND activation_state IN ('pending','active') AND deletion_operation_id IS NULL AND project_binding_kind='directory'",
        [thread], |row| row.get(0),
    ).context("root_unavailable")?;
    let workspace: Option<(String, String, i64)> = connection.query_row(
        "SELECT w.id,w.working_directory,w.generation FROM mission_workspace w JOIN mission m ON m.id=w.mission_id WHERE m.camp_id=?1 AND w.state='ready' ORDER BY w.created_at LIMIT 1",
        [thread], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    Ok(match workspace {
        Some((id, path, generation)) => Binding {
            path: path.into(),
            identity: format!("{thread}:{id}:{generation}"),
        },
        None => Binding {
            path: project.into(),
            identity: format!("{thread}:project"),
        },
    })
}

pub(crate) fn root(binding: &Binding) -> Result<(PathBuf, String)> {
    let path = fs::canonicalize(&binding.path).context("root_unavailable")?;
    let metadata = fs::metadata(&path).context("root_unavailable")?;
    ensure!(metadata.is_dir(), "root_unavailable");
    #[cfg(unix)]
    let object = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", metadata.dev(), metadata.ino())
    };
    #[cfg(not(unix))]
    let object = format!("{:?}", metadata.created().ok());
    let identity = format!(
        "{:x}",
        Sha256::digest(format!(
            "{}\0{}\0{object}",
            binding.identity,
            path.display()
        ))
    );
    Ok((path, identity))
}

// Cross-thread equivalence deliberately excludes the Thread prefix, but retains workspace generation.
pub(crate) fn same_effective_root(left: &Binding, right: &Binding) -> Result<bool> {
    let (left_path, _) = root(left)?;
    let (right_path, _) = root(right)?;
    if left_path != right_path
        || left.identity.split_once(':').map(|x| x.1) != right.identity.split_once(':').map(|x| x.1)
    {
        return Ok(false);
    }
    let left_metadata = fs::metadata(&left_path)?;
    let right_metadata = fs::metadata(&right_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok((left_metadata.dev(), left_metadata.ino())
            == (right_metadata.dev(), right_metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        Ok(left_metadata.created().ok() == right_metadata.created().ok())
    }
}

/// A preview reference survives closing the browser, but never a root rebind/replacement.
/// Paths remain constrained to the root re-derived from the authenticated Thread.
pub fn resolve_source(
    binding: Binding,
    thread: String,
    reference: &str,
) -> Result<ResolvedFilePreviewSource> {
    ensure!(reference.len() <= 16_384, "source_not_authorized");
    let (expected, relative): (String, String) =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(reference)?)?;
    ensure!(
        !relative.is_empty()
            && Path::new(&relative)
                .components()
                .all(|c| matches!(c, Component::Normal(_))),
        "source_not_authorized"
    );
    let (path, identity) = root(&binding)?;
    ensure!(identity == expected, "source_not_authorized");
    let file = fs::canonicalize(path.join(relative)).context("file_not_found")?;
    ensure!(
        file.starts_with(&path) && file.is_file(),
        "source_not_authorized"
    );
    let raw_reference = url::Url::from_file_path(&file)
        .map_err(|_| anyhow::anyhow!("source_not_authorized"))?
        .to_string();
    let root_path = path.to_str().context("root_unavailable")?.to_owned();
    Ok(ResolvedFilePreviewSource::FileTarget {
        camp_id: thread,
        source_kind: "project_file".into(),
        source_identity: format!("project:{identity}"),
        root_path: root_path.clone(),
        base_path: root_path,
        raw_reference,
        allow_children: true,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub thread_id: String,
    pub action: String,
    pub raw_reference: Option<String>,
    pub target_kind: Option<crate::camp_content::ProjectFileTargetKind>,
    pub expected_path_at_send: Option<String>,
    pub scope_id: Option<String>,
    pub entry_id: Option<String>,
    pub entry_ids: Option<Vec<String>>,
    pub query: Option<String>,
    pub query_revision: Option<u64>,
    pub revision: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    relative_path: String,
    directory: bool,
    unavailable: bool,
}

struct WatchState {
    watcher: Option<RecommendedWatcher>,
    paths: HashSet<PathBuf>,
}
struct Scope {
    client: String,
    thread: String,
    root: PathBuf,
    identity: String,
    watch: Mutex<WatchState>,
    revision: AtomicU64,
    changed: Notify,
    watch_failed: AtomicBool,
    closed: AtomicBool,
    accessed: Mutex<Instant>,
    search: Mutex<(u64, Arc<AtomicBool>)>,
}
impl Scope {
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.search.lock().unwrap().1.store(true, Ordering::SeqCst);
        self.watch.lock().unwrap().watcher.take();
        self.changed.notify_waiters();
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        let relative = entry_path(id).context("entry_unavailable")?;
        let candidate = self.root.join(relative);
        let path = fs::canonicalize(&candidate).context("entry_unavailable")?;
        ensure!(path.starts_with(&self.root), "entry_unavailable");
        ensure!(
            !(path.is_dir() && fs::symlink_metadata(candidate)?.file_type().is_symlink()),
            "entry_unavailable"
        );
        Ok(path)
    }
    fn entry(&self, item: &ignore::DirEntry) -> Result<Entry> {
        let path = item.path();
        let relative = path.strip_prefix(&self.root)?;
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .context("entry_unavailable")?
            .to_owned();
        let relative_path = relative.to_str().context("entry_unavailable")?.to_owned();
        #[cfg(windows)]
        let relative_path = relative_path.replace('\\', "/");
        let id = format!("p:{}", URL_SAFE_NO_PAD.encode(relative_path.as_bytes()));
        let kind = item.file_type().context("entry_unavailable")?;
        // Ordinary entries already belong to the validated walk. Resolve links only;
        // actual opens/expansions validate the current target against the root.
        let (directory, unavailable) = if kind.is_symlink() {
            let target = fs::canonicalize(path).ok();
            let directory = target.as_ref().is_some_and(|p| p.is_dir());
            (
                directory,
                directory || target.as_ref().is_none_or(|p| !p.starts_with(&self.root)),
            )
        } else {
            (kind.is_dir(), !kind.is_dir() && !kind.is_file())
        };
        Ok(Entry {
            id,
            name,
            relative_path,
            directory,
            unavailable,
        })
    }
    fn watch(self: &Arc<Self>, ids: &[String]) -> Result<()> {
        ensure!(ids.len() <= 256, "browse_limit");
        let mut paths = HashSet::from([self.root.clone()]);
        if let Some(parent) = self.root.parent() {
            paths.insert(parent.into());
        }
        for id in ids {
            if let Ok(path) = self.path(id) {
                if path.is_dir() {
                    paths.insert(path);
                }
            }
        }
        let mut state = self.watch.lock().unwrap();
        if state.watcher.is_none() {
            let weak = Arc::downgrade(self);
            state.watcher = Some(notify::recommended_watcher(
                move |event: notify::Result<notify::Event>| {
                    let Some(scope) = weak.upgrade() else { return };
                    match event {
                        Ok(event)
                            if !invalidates_directory(&event)
                                || (!event.need_rescan()
                                    && !event.paths.iter().any(|p| p.starts_with(&scope.root))) =>
                        {
                            return;
                        }
                        Err(_) => {
                            scope.watch_failed.store(true, Ordering::SeqCst);
                        }
                        _ => {}
                    }
                    scope.revision.fetch_add(1, Ordering::SeqCst);
                    scope.changed.notify_one();
                },
            )?);
        }
        let previous = state.paths.clone();
        let mut installed: HashSet<PathBuf> = previous.intersection(&paths).cloned().collect();
        let watcher = state.watcher.as_mut().unwrap();
        for path in previous.difference(&paths) {
            let _ = watcher.unwatch(path);
        }
        let mut failed = false;
        for path in paths.difference(&previous) {
            if watcher.watch(path, RecursiveMode::NonRecursive).is_err() {
                failed = true;
            } else {
                installed.insert(path.clone());
            }
        }
        // Reinstall failed watches on an explicit retry rather than claiming they succeeded.
        state.paths = installed;
        self.watch_failed.store(failed, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Default)]
pub struct ProjectFiles {
    scopes: Mutex<HashMap<String, Arc<Scope>>>,
}
impl ProjectFiles {
    pub async fn request(
        self: &Arc<Self>,
        client: String,
        binding: Option<Binding>,
        request: Request,
    ) -> Value {
        match self.execute(client, binding, request).await {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => {
                let code = error.to_string();
                let code = match code.as_str() {
                    "root_unavailable" | "scope_expired" | "entry_unavailable" | "browse_limit" => {
                        code.as_str()
                    }
                    _ => "read_failed",
                };
                json!({"ok":false,"error":{"code":code}})
            }
        }
    }
    async fn execute(
        self: &Arc<Self>,
        client: String,
        binding: Option<Binding>,
        request: Request,
    ) -> Result<Value> {
        if request.action == "resolve" {
            let binding = binding.context("root_unavailable")?;
            let (path, identity) = tokio::task::spawn_blocking(move || root(&binding)).await??;
            let scope = Arc::new(Scope {
                client,
                thread: request.thread_id,
                root: path.clone(),
                identity: identity.clone(),
                watch: Mutex::new(WatchState {
                    watcher: None,
                    paths: HashSet::new(),
                }),
                revision: AtomicU64::new(0),
                changed: Notify::new(),
                watch_failed: AtomicBool::new(false),
                closed: AtomicBool::new(false),
                accessed: Mutex::new(Instant::now()),
                search: Mutex::new((0, Arc::new(AtomicBool::new(false)))),
            });
            let id = uuid::Uuid::new_v4().to_string();
            {
                let mut scopes = self.scopes.lock().unwrap();
                ensure!(scopes.len() < 64, "browse_limit");
                scopes.insert(id.clone(), scope);
            }
            // A disconnected page cannot retain native watches indefinitely. This expires
            // transport resources only; it does not scan the project or persist a lease.
            let weak = Arc::downgrade(self);
            let lease_id = id.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(LEASE / 2).await;
                    let Some(service) = weak.upgrade() else { break };
                    let mut scopes = service.scopes.lock().unwrap();
                    let Some(scope) = scopes.get(&lease_id) else {
                        break;
                    };
                    if scope.accessed.lock().unwrap().elapsed() >= LEASE {
                        scope.close();
                        scopes.remove(&lease_id);
                        break;
                    }
                }
            });
            return Ok(
                json!({"scopeId":id,"rootId":identity,"name":path.file_name().and_then(|n|n.to_str()).unwrap_or("/"),"revision":0}),
            );
        }
        let id = request.scope_id.as_deref().context("scope_expired")?;
        let scope = self
            .scopes
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("scope_expired")?;
        ensure!(
            scope.client == client
                && scope.thread == request.thread_id
                && !scope.closed.load(Ordering::SeqCst),
            "scope_expired"
        );
        *scope.accessed.lock().unwrap() = Instant::now();
        if request.action == "release" {
            scope.close();
            self.scopes.lock().unwrap().remove(id);
            return Ok(json!({}));
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        if matches!(request.action.as_str(), "search" | "cancelSearch") {
            let mut search = scope.search.lock().unwrap();
            let revision = request.query_revision.unwrap_or(0);
            if revision < search.0 {
                cancellation.store(true, Ordering::SeqCst);
            } else {
                search.1.store(true, Ordering::SeqCst);
                *search = (revision, cancellation.clone());
            }
            if request.action == "cancelSearch" {
                return Ok(json!({}));
            }
        }
        let binding = binding.context("root_unavailable")?;
        let root_binding = binding.clone();
        let (_, identity) = tokio::task::spawn_blocking(move || root(&root_binding)).await??;
        ensure!(scope.identity == identity, "scope_expired");
        if request.action == "poll" {
            let notified = scope.changed.notified();
            if scope.revision.load(Ordering::SeqCst) == request.revision.unwrap_or(0) {
                let _ = tokio::time::timeout(Duration::from_secs(8), notified).await;
            }
            ensure!(!scope.closed.load(Ordering::SeqCst), "scope_expired");
            if scope.revision.load(Ordering::SeqCst) != request.revision.unwrap_or(0) {
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            return Ok(
                json!({"revision":scope.revision.load(Ordering::SeqCst),"watchFailed":scope.watch_failed.load(Ordering::SeqCst)}),
            );
        }
        tokio::task::spawn_blocking(move || match request.action.as_str() {
            "watch" => {
                if scope.watch(&request.entry_ids.unwrap_or_default()).is_err() {
                    scope.watch_failed.store(true, Ordering::SeqCst);
                }
                Ok(json!({"watchFailed":scope.watch_failed.load(Ordering::SeqCst)}))
            }
            "open" => {
                let id = request.entry_id.context("entry_unavailable")?;
                let path = scope.path(&id)?;
                ensure!(path.is_file() || path.is_dir(), "entry_unavailable");
                let directory = path.is_dir();
                if let Some(kind) = request.target_kind {
                    ensure!(
                        (kind == crate::camp_content::ProjectFileTargetKind::Directory)
                            == directory,
                        "entry_unavailable"
                    );
                }
                let relative = entry_path(&id)?;
                ensure!(!relative.as_os_str().is_empty(), "entry_unavailable");
                if let Some(raw) = request.raw_reference.as_ref() {
                    let admitted = crate::project_file_reference::resolve_target(
                        &binding,
                        raw,
                        crate::camp_content::ProjectFileTargetKind::Directory,
                    )
                    .context("entry_unavailable")?;
                    ensure!(
                        admitted.label == relative
                            && admitted.path == path.to_str().context("entry_unavailable")?,
                        "entry_unavailable"
                    );
                    ensure!(
                        request
                            .expected_path_at_send
                            .as_ref()
                            .is_none_or(|expected| expected == &admitted.path),
                        "entry_unavailable"
                    );
                } else {
                    ensure!(request.expected_path_at_send.is_none(), "entry_unavailable");
                }
                let reference =
                    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(&scope.identity, relative))?);
                let mut source =
                    json!({"kind":"project_file","threadId":scope.thread,"rawReference":reference});
                if directory {
                    fs::read_dir(&path).context("read_failed")?;
                    source["targetKind"] = json!("directory");
                }
                Ok(source)
            }
            "list" | "search" => browse(&scope, &request, &cancellation),
            _ => anyhow::bail!("read_failed"),
        })
        .await?
    }
}

fn browse(scope: &Scope, request: &Request, cancel: &AtomicBool) -> Result<Value> {
    let searching = request.action == "search";
    let query = request.query.as_deref().unwrap_or("").trim().to_lowercase();
    #[cfg(windows)]
    let query = query.replace('\\', "/");
    ensure!(
        query.len() <= 512 && (!searching || !query.is_empty()),
        "read_failed"
    );
    let directory = if searching {
        scope.root.clone()
    } else {
        scope.path(request.entry_id.as_deref().unwrap_or("root"))?
    };
    ensure!(directory.is_dir(), "entry_unavailable");
    // Probe the requested directory so unreadable roots are errors, not empty listings.
    let _ = fs::read_dir(&directory).context("read_failed")?;
    let mut builder = WalkBuilder::new(directory);
    builder
        .hidden(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| entry.file_name() != ".git");
    if !searching {
        builder.max_depth(Some(1));
    }
    let started = Instant::now();
    let mut entries = Vec::new();
    let mut partial = false;
    for (visited, item) in builder.build().enumerate() {
        if scope.closed.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
            partial = true;
            break;
        }
        if visited >= 50_000 || started.elapsed() > Duration::from_millis(500) {
            partial = true;
            break;
        }
        let item = match item {
            Ok(item) => item,
            Err(_) => {
                partial = true;
                continue;
            }
        };
        if item.depth() == 0 {
            continue;
        }
        if searching {
            let relative = item
                .path()
                .strip_prefix(&scope.root)?
                .to_string_lossy()
                .to_lowercase();
            #[cfg(windows)]
            let relative = relative.replace('\\', "/");
            if !relative.contains(&query) {
                continue;
            }
        }
        match scope.entry(&item) {
            Ok(entry) => entries.push(entry),
            Err(_) => {
                partial = true;
            }
        }
        if entries.len() >= if searching { 100 } else { 20_000 } {
            partial = true;
            break;
        }
    }
    entries.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(json!({"entries":entries,"partial":partial}))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("rovai-project-files-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn binding(&self) -> Binding {
            Binding {
                path: self.0.clone(),
                identity: "thread:project".into(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    async fn call(
        service: &Arc<ProjectFiles>,
        fixture: &Fixture,
        action: &str,
        scope: Option<&str>,
        extra: Value,
    ) -> Value {
        let mut params = json!({"threadId":"thread","action":action,"scopeId":scope});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        service
            .request(
                "desktop".into(),
                Some(fixture.binding()),
                serde_json::from_value(params).unwrap(),
            )
            .await
    }
    #[tokio::test]
    async fn lazy_listing_and_search_keep_filters_and_bounds_in_non_git_projects() {
        let fixture = Fixture::new();
        let service = Arc::new(ProjectFiles::default());
        fs::create_dir(fixture.0.join("src")).unwrap();
        fs::write(fixture.0.join("src/unexpanded.rs"), "fn main() {}").unwrap();
        fs::write(fixture.0.join(".env.example"), "visible").unwrap();
        fs::write(fixture.0.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(fixture.0.join("ignored.txt"), "ignored").unwrap();
        fs::create_dir(fixture.0.join(".git")).unwrap();
        fs::write(fixture.0.join(".git/config"), "private").unwrap();
        let resolved = call(&service, &fixture, "resolve", None, json!({})).await;
        let scope = resolved["value"]["scopeId"].as_str().unwrap();
        let listed = call(&service, &fixture, "list", Some(scope), json!({})).await;
        let names: Vec<_> = listed["value"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"src") && names.contains(&".env.example"));
        assert!(
            !names.contains(&"ignored.txt")
                && !names.contains(&".git")
                && !names.contains(&"unexpanded.rs")
        );
        let queries = if cfg!(windows) {
            vec!["unexpanded", "src/unexpanded.rs", r"src\unexpanded.rs"]
        } else {
            vec!["unexpanded", "src/unexpanded.rs"]
        };
        for query in queries {
            let found = call(
                &service,
                &fixture,
                "search",
                Some(scope),
                json!({"query":query}),
            )
            .await;
            assert_eq!(found["value"]["entries"].as_array().unwrap().len(), 1);
            assert_eq!(
                found["value"]["entries"][0]["relativePath"],
                "src/unexpanded.rs"
            );
        }
        for index in 0..210 {
            fs::write(fixture.0.join(format!("page-{index:03}.txt")), "").unwrap();
        }
        let first = call(&service, &fixture, "list", Some(scope), json!({})).await;
        assert_eq!(first["value"]["entries"].as_array().unwrap().len(), 213);
        assert_eq!(first["value"]["partial"], false);
        assert!(
            call(
                &service,
                &fixture,
                "search",
                Some(scope),
                json!({"query":"page-"})
            )
            .await["value"]["partial"]
                .as_bool()
                .unwrap()
        );
        let directories = call(
            &service,
            &fixture,
            "search",
            Some(scope),
            json!({"query":"src", "queryRevision":99}),
        )
        .await;
        assert!(
            directories["value"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["directory"] == true && entry["name"] == "src")
        );
        let opened_directory = call(
            &service,
            &fixture,
            "open",
            Some(scope),
            json!({"entryId":format!("p:{}",URL_SAFE_NO_PAD.encode("src"))}),
        )
        .await;
        assert_eq!(opened_directory["value"]["targetKind"], "directory");
        let mixed = fixture.0.join("name-order");
        fs::create_dir(&mixed).unwrap();
        for name in ["auth", "zebra"] {
            fs::create_dir(mixed.join(name)).unwrap();
        }
        for name in ["config.ts", "Login.ts"] {
            fs::write(mixed.join(name), "").unwrap();
        }
        for (action, params) in [
            (
                "list",
                json!({"entryId":format!("p:{}", URL_SAFE_NO_PAD.encode("name-order"))}),
            ),
            (
                "search",
                json!({"query":"name-order/", "queryRevision":100}),
            ),
        ] {
            let result = call(&service, &fixture, action, Some(scope), params).await;
            let names: Vec<_> = result["value"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry["name"].as_str().unwrap())
                .collect();
            assert_eq!(
                names,
                ["auth", "config.ts", "Login.ts", "zebra"],
                "{action}"
            );
            assert_eq!(result["value"]["partial"], false);
        }
        call(&service, &fixture, "release", Some(scope), json!({})).await;
    }
    #[tokio::test]
    async fn references_outlive_views_but_cannot_cross_roots_clients_or_rebound_generations() {
        let fixture = Fixture::new();
        let other = Fixture::new();
        let service = Arc::new(ProjectFiles::default());
        fs::write(fixture.0.join("same #1.txt"), "selected").unwrap();
        fs::write(other.0.join("same #1.txt"), "other").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&other.0, fixture.0.join("outside")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&fixture.0, fixture.0.join("cycle")).unwrap();
        let resolved = call(&service, &fixture, "resolve", None, json!({})).await;
        let scope = resolved["value"]["scopeId"].as_str().unwrap();
        // Opening an unlisted file works: there is no registration capacity to exhaust.
        assert_eq!(
            call(
                &service,
                &fixture,
                "open",
                Some(scope),
                json!({"entryId": format!("p:{}", URL_SAFE_NO_PAD.encode("same #1.txt"))})
            )
            .await["ok"],
            true
        );
        for relative in ["../other.txt", "/etc/passwd", "src/../../other.txt"] {
            assert_eq!(
                call(
                    &service,
                    &fixture,
                    "open",
                    Some(scope),
                    json!({"entryId": format!("p:{}", URL_SAFE_NO_PAD.encode(relative))})
                )
                .await["ok"],
                false
            );
        }
        let listed = call(&service, &fixture, "list", Some(scope), json!({})).await;
        let entries = listed["value"]["entries"].as_array().unwrap();
        #[cfg(unix)]
        {
            for name in ["outside", "cycle"] {
                let outside = entries.iter().find(|entry| entry["name"] == name).unwrap();
                assert_eq!(outside["unavailable"], true);
                assert_eq!(
                    call(
                        &service,
                        &fixture,
                        "list",
                        Some(scope),
                        json!({"entryId":outside["id"]})
                    )
                    .await["ok"],
                    false
                );
            }
        }
        let file = entries
            .iter()
            .find(|entry| entry["name"] == "same #1.txt")
            .unwrap();
        let source = call(
            &service,
            &fixture,
            "open",
            Some(scope),
            json!({"entryId":file["id"]}),
        )
        .await;
        let reference = source["value"]["rawReference"].as_str().unwrap();
        let foreign = service
            .request(
                "other-client".into(),
                Some(fixture.binding()),
                serde_json::from_value(
                    json!({"threadId":"thread","action":"list","scopeId":scope}),
                )
                .unwrap(),
            )
            .await;
        assert_eq!(foreign["ok"], false);
        call(&service, &fixture, "release", Some(scope), json!({})).await;
        let ResolvedFilePreviewSource::FileTarget {
            raw_reference,
            base_path,
            ..
        } = resolve_source(fixture.binding(), "thread".into(), reference).unwrap()
        else {
            panic!("file target")
        };
        assert_eq!(
            crate::file_reference_path::reference_path(&raw_reference, Path::new(&base_path))
                .unwrap(),
            fs::canonicalize(fixture.0.join("same #1.txt")).unwrap()
        );
        // File-reference admission owns the same containment and root-generation boundary.
        let admitted =
            crate::project_file_reference::resolve(&fixture.binding(), reference).unwrap();
        assert_eq!(admitted.label, "same #1.txt");
        let link =
            crate::project_file_reference::render_link(&admitted.path, &admitted.label).unwrap();
        assert!(link.ends_with("/same%20%231.txt)"));
        let target = Binding {
            path: fixture.0.clone(),
            identity: "target:project".into(),
        };
        let resolve_paste = |target: Binding| {
            crate::project_file_reference::resolve_references(
            serde_json::from_value(json!({"threadId":"target", "references":[{"threadId":"thread","rawReference":reference}]})).unwrap(),
            HashMap::from([("thread".into(), fixture.binding()), ("target".into(), target)]))
        };
        let pasted = resolve_paste(target.clone());
        assert_eq!(pasted["value"][0]["status"], "available");
        assert_eq!(pasted["value"][0]["reference"]["threadId"], "target");
        assert_ne!(pasted["value"][0]["reference"]["rawReference"], reference);
        assert_eq!(
            resolve_paste(Binding {
                path: other.0.clone(),
                identity: "target:project".into()
            })["value"][0]["status"],
            "needs_reselect"
        );
        assert_eq!(
            resolve_paste(Binding {
                path: target.path.clone(),
                identity: "target:workspace:2".into()
            })["value"][0]["status"],
            "needs_reselect"
        );
        let (root_path, root_identity) = root(&fixture.binding()).unwrap();
        for relative in ["../escape", "/absolute", "cycle", "missing.txt"] {
            let raw =
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(&root_identity, relative)).unwrap());
            assert!(crate::project_file_reference::resolve(&fixture.binding(), &raw).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                other.0.join("same #1.txt"),
                root_path.join("external-file"),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                root_path.join("same #1.txt"),
                root_path.join("internal-file"),
            )
            .unwrap();
            let raw = |relative| {
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(&root_identity, relative)).unwrap())
            };
            assert!(
                crate::project_file_reference::resolve(&fixture.binding(), &raw("external-file"))
                    .is_err()
            );
            assert!(
                crate::project_file_reference::resolve(&fixture.binding(), &raw("internal-file"))
                    .is_ok()
            );
        }
        // Directories share root-bound sources, but never silently change into files or links.
        use crate::camp_content::ProjectFileTargetKind;
        let relative = "目录 (a)#";
        fs::create_dir(root_path.join(relative)).unwrap();
        let directory_raw =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(&root_identity, relative)).unwrap());
        let directory = crate::project_file_reference::resolve_target(
            &fixture.binding(),
            &directory_raw,
            ProjectFileTargetKind::Directory,
        )
        .unwrap();
        assert_eq!(directory.label, relative);
        assert!(
            crate::project_file_reference::render_target_link(
                &directory.path,
                &directory.label,
                directory.target_kind
            )
            .unwrap()
            .ends_with("%E7%9B%AE%E5%BD%95%20%28a%29%23/)")
        );
        assert!(
            crate::project_file_reference::resolve(&fixture.binding(), &directory_raw).is_err()
        );
        let available = crate::project_file_reference::resolve_references(
            serde_json::from_value(json!({"threadId":"thread","references":[{"threadId":"thread","rawReference":directory_raw,"targetKind":"directory"}]})).unwrap(),
            HashMap::from([("thread".into(), fixture.binding())]));
        assert_eq!(
            available["value"][0]["reference"]["targetKind"],
            "directory"
        );
        fs::remove_dir(root_path.join(relative)).unwrap();
        fs::write(root_path.join(relative), "now a file").unwrap();
        assert!(
            crate::project_file_reference::resolve_target(
                &fixture.binding(),
                &directory_raw,
                ProjectFileTargetKind::Directory
            )
            .unwrap_err()
            .to_string()
            .contains("target_kind_changed")
        );
        #[cfg(unix)]
        {
            fs::create_dir(root_path.join("physical-directory")).unwrap();
            std::os::unix::fs::symlink(
                root_path.join("physical-directory"),
                root_path.join("directory-link"),
            )
            .unwrap();
            let linked = URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&(&root_identity, "directory-link")).unwrap());
            assert!(
                crate::project_file_reference::resolve_target(
                    &fixture.binding(),
                    &linked,
                    ProjectFileTargetKind::Directory
                )
                .is_err()
            );
        }
        fs::write(root_path.join("same #1.txt"), "changed live").unwrap();
        assert_eq!(
            crate::project_file_reference::resolve(&fixture.binding(), reference)
                .unwrap()
                .path,
            admitted.path
        );
        fs::remove_file(root_path.join("same #1.txt")).unwrap();
        assert!(crate::project_file_reference::resolve(&fixture.binding(), reference).is_err());
        fs::write(root_path.join("same #1.txt"), "restored").unwrap();
        assert!(resolve_source(other.binding(), "thread".into(), reference).is_err());
        let mut rebound = fixture.binding();
        rebound.identity = "thread:workspace:2".into();
        assert!(resolve_source(rebound, "thread".into(), reference).is_err());
        assert_eq!(
            call(&service, &fixture, "list", Some(scope), json!({})).await["ok"],
            false
        );
    }
    #[tokio::test]
    async fn native_changes_invalidate_visible_directories_and_release_cancels_poll() {
        use notify::event::{CreateKind, Flag, ModifyKind, RemoveKind};
        for kind in [
            AccessKind::Open(AccessMode::Any),
            AccessKind::Read,
            AccessKind::Close(AccessMode::Read),
        ] {
            assert!(!invalidates_directory(&Event::new(EventKind::Access(kind))));
        }
        for kind in [
            EventKind::Create(CreateKind::Any),
            EventKind::Modify(ModifyKind::Any),
            EventKind::Remove(RemoveKind::Any),
            EventKind::Access(AccessKind::Close(AccessMode::Write)),
        ] {
            assert!(invalidates_directory(&Event::new(kind)));
        }
        assert!(invalidates_directory(
            &Event::new(EventKind::Other).set_flag(Flag::Rescan)
        ));
        let fixture = Fixture::new();
        let service = Arc::new(ProjectFiles::default());
        let resolved = call(&service, &fixture, "resolve", None, json!({})).await;
        let id = resolved["value"]["scopeId"].as_str().unwrap();
        let watched = call(
            &service,
            &fixture,
            "watch",
            Some(id),
            json!({"entryIds":[]}),
        )
        .await;
        assert_eq!(watched["value"]["watchFailed"], false);
        fs::write(fixture.0.join("new.txt"), "new").unwrap();
        let changed = tokio::time::timeout(
            Duration::from_secs(8),
            call(&service, &fixture, "poll", Some(id), json!({"revision":0})),
        )
        .await
        .unwrap();
        assert!(changed["value"]["revision"].as_u64().unwrap() > 0);
        let retained = service.scopes.lock().unwrap().get(id).unwrap().clone();
        call(&service, &fixture, "release", Some(id), json!({})).await;
        assert!(retained.closed.load(Ordering::SeqCst));
        assert!(retained.watch.lock().unwrap().watcher.is_none());
        assert!(service.scopes.lock().unwrap().is_empty());
    }
}
