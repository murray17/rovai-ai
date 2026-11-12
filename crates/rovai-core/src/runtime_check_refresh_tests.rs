//! Integration owner: live Check Manager + private database + synthetic programs.
//! The capture seam never reads a developer's PATH, registry, shell or accounts.
use super::*;
use crate::application::{RuntimeCheckOutcome, RuntimeCheckTrigger, RuntimeLaunchPurpose};
#[cfg(unix)]
use rovai_core::agent_runtime_adapter::executable_fingerprint as fingerprint_executable;
use rovai_core::runtime_startup::RuntimeStartupConfiguration;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{
        Mutex as StdMutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

const KIND: AdapterKind = AdapterKind::CodexCli;

struct Fixture {
    root: PathBuf,
    core: Arc<Core>,
    paths: Arc<StdMutex<Vec<PathBuf>>>,
    captures: Arc<AtomicUsize>,
    shutdown: Option<oneshot::Sender<()>>,
    manager: Option<tokio::task::JoinHandle<()>>,
}

impl Fixture {
    fn new() -> Self {
        Self::with_capture(None)
    }

    fn with_capture(capture: Option<TestSearchCapture>) -> Self {
        let root =
            std::env::temp_dir().join(format!("rovai-check-refresh-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root =
            rovai_core::runtime_discovery::runtime_visible_path(root.canonicalize().unwrap());
        let paths = Arc::new(StdMutex::new(Vec::new()));
        let captures = Arc::new(AtomicUsize::new(0));
        let mut core = crate::application::tests::runtime_resolution_test_core(&root).unwrap();
        let configurations =
            rovai_core::runtime_startup::load_all(&*core.database.try_lock().unwrap()).unwrap();
        *core.runtime_search_environment.get_mut() = Arc::new(
            core.runtime_search_environment
                .get_mut()
                .as_ref()
                .clone()
                .with_startup_configurations(configurations),
        );
        core.runtime_search_capture = capture.or_else(|| {
            Some({
                let paths = paths.clone();
                let captures = captures.clone();
                Arc::new(move |generation| {
                    captures.fetch_add(1, Ordering::SeqCst);
                    RuntimeSearchEnvironment::for_test_paths(
                        generation,
                        paths.lock().unwrap().clone(),
                    )
                })
            })
        });
        let (requests, receiver) = mpsc::unbounded_channel();
        core.runtime_check_requests = requests;
        let core = Arc::new(core);
        let (shutdown, stopped) = oneshot::channel();
        let manager = tokio::spawn(crate::application::process_runtime_check_manager(
            core.clone(),
            receiver,
            stopped,
        ));
        Self {
            root,
            core,
            paths,
            captures,
            shutdown: Some(shutdown),
            manager: Some(manager),
        }
    }

    async fn close(mut self) {
        self.shutdown.take().unwrap().send(()).unwrap();
        self.manager.take().unwrap().await.unwrap();
        // Drop all private owners before removing only this fixture's unique directory.
        drop(self.core);
        std::fs::remove_dir_all(self.root).unwrap();
    }

    fn program(&self, directory: &str, version: &str, gate: bool) -> PathBuf {
        let directory = self.root.join(directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(if cfg!(windows) { "codex.cmd" } else { "codex" });
        let marker = directory.join("environment.txt");
        let started = self.root.join("probe-started");
        let released = self.root.join("probe-release");
        #[cfg(windows)]
        let body = format!(
            "@echo off\r\necho %CHECK_REFRESH_VALUE%>\"{}\"\r\nif \"%~1\"==\"--version\" (\r\necho codex-cli {}\r\nexit /b 0\r\n)\r\n{}exit /b 1\r\n",
            marker.display(),
            version,
            if gate {
                format!(
                    "echo started>\"{}\"\r\n:wait\r\nif not exist \"{}\" goto wait\r\n",
                    started.display(),
                    released.display()
                )
            } else {
                String::new()
            },
        );
        #[cfg(not(windows))]
        let body = format!(
            "#!/bin/sh\nprintf '%s' \"${{CHECK_REFRESH_VALUE-unset}}\" > '{}'\nif [ \"$1\" = '--version' ]; then printf 'codex-cli {}\\n'; exit 0; fi\n{}exit 1\n",
            marker.display(),
            version,
            if gate {
                format!(
                    "printf started > '{}'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\n",
                    started.display(),
                    released.display()
                )
            } else {
                String::new()
            },
        );
        std::fs::write(&path, body).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        path
    }

    #[cfg(unix)]
    fn claude_program(&self, directory: &str, version: &str, complete_help: bool) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let directory = self.root.join(directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("claude");
        let help = "--print --output-format --input-format --resume --session-id --append-system-prompt --mcp-config --allowedTools --add-dir --permission-mode --model";
        let body = format!(
            "#!/bin/sh\ncase \"$1\" in\n--version) printf '{} (Claude Code)\\n'; exit 0;;\n--help) {}printf '%s\\n' '{} {}'; exit 0;;\nauth) printf '{{\"loggedIn\":false}}\\n'; exit 1;;\nesac\nexit 1\n",
            version,
            if complete_help {
                String::new()
            } else {
                format!(
                    "printf started > '{}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done; ",
                    self.root.join("probe-started").display(),
                    self.root.join("probe-release").display()
                )
            },
            help,
            if complete_help {
                "--no-session-persistence"
            } else {
                ""
            },
        );
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    async fn check(&self) -> RuntimeCheckOutcome {
        check(self.core.clone()).await
    }

    async fn seed_ready(&self) {
        use rovai_core::{
            agent_profile::{AgentProfileService, ModelDescriptor, VerifiedManagedInstallation},
            agent_runtime_adapter::AgentRuntimeAdapterRegistry,
        };
        let service = AgentProfileService::default();
        let mut database = self.core.database.lock().await;
        let installation = service
            .managed_installation(&database, KIND, "default")
            .unwrap()
            .unwrap();
        let (fingerprint, identity) = service
            .recorded_executable_identity(
                &database,
                &installation.id,
                &installation.executable_path,
            )
            .unwrap()
            .unwrap();
        let mut snapshot = AgentRuntimeAdapterRegistry::default()
            .light_ready_snapshot(
                KIND,
                Some("1.0.0".into()),
                fingerprint,
                chrono::Utc::now().to_rfc3339(),
            )
            .unwrap();
        snapshot.probe_status = "ready".into();
        snapshot.authentication_status = "authenticated".into();
        snapshot.capabilities = vec!["old-program-capability".into()];
        snapshot.protocols = vec!["codex-app-server".into()];
        snapshot.native_session_compatibility_key = Some("codex-cli:app-server-v2".into());
        snapshot.models.push(ModelDescriptor {
            id: "old-program-model".into(),
            display_name: "Fixture".into(),
            description: None,
            runtime_metadata: None,
            is_default: true,
            hidden: false,
            deprecated: false,
            options: Vec::new(),
        });
        let locator = service
            .runtime_entrypoint_locator_identity(&database, &installation.id)
            .unwrap();
        service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    model_catalog_complete: true,
                    executable_file_identity: Some(identity),
                    adapter_kind: KIND,
                    executable_path: installation.executable_path,
                    command_name: KIND.command_name().into(),
                    source: installation.source,
                    auth_scope: "default".into(),
                    snapshot,
                    entrypoint_locator_identity: locator,
                },
            )
            .unwrap();
    }

    async fn settings(&self) -> Value {
        self.core
            .handle_runtime_startup("runtime.startup.get", json!({"runtimeKind": KIND}))
            .await
            .unwrap()
    }

    async fn save(&self, revision: u64, configuration: &RuntimeStartupConfiguration) {
        self.core.handle_runtime_startup("runtime.startup.save", json!({
            "runtimeKind": KIND, "expectedRevision": revision, "configuration": configuration,
        })).await.unwrap();
    }

    async fn public_state(&self) -> Value {
        let mut payload = self.core.runtime_health_payload().await.unwrap();
        // Unobserved runtimes synthesize a fresh detecting timestamp on every
        // read. Keep every status/diagnostic/selection, excluding only that clock.
        for entry in payload["runtimeAvailability"].as_array_mut().unwrap() {
            if entry["discovery"]["searchGeneration"] == 0 {
                entry["discovery"]
                    .as_object_mut()
                    .unwrap()
                    .remove("observedAt");
            }
        }
        payload
    }

    async fn health(&self) -> Value {
        self.health_for(KIND).await
    }

    async fn health_for(&self, kind: AdapterKind) -> Value {
        let payload = self.core.runtime_health_payload().await.unwrap();
        payload["runtimeAvailability"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["runtimeKind"] == kind.as_str())
            .unwrap()
            .clone()
    }
}

async fn check(core: Arc<Core>) -> RuntimeCheckOutcome {
    tokio::time::timeout(
        Duration::from_secs(15),
        core.await_runtime_check(
            KIND,
            RuntimeLaunchPurpose::AvailabilityCheck,
            RuntimeCheckTrigger::UserCheck,
        ),
    )
    .await
    .unwrap()
    .unwrap()
}

fn configuration(path: Option<&Path>) -> RuntimeStartupConfiguration {
    RuntimeStartupConfiguration {
        program_path: path.map(|path| path.to_string_lossy().to_string()),
        ..Default::default()
    }
}

// A real manager/database seam is needed: a pure discovery test cannot prove
// which version is publicly returned after a failed probe or draft isolation.
#[tokio::test]
async fn fresh_formal_and_draft_checks_preserve_program_selection_and_private_state() {
    let fixture = Fixture::new();
    let old = fixture.program("old", "1.0.0", false);
    let new = fixture.program("new", "2.0.0", false);
    *fixture.paths.lock().unwrap() = vec![old.parent().unwrap().into()];
    fixture.settings().await;
    fixture.health().await;
    assert_eq!(
        fixture.captures.load(Ordering::SeqCst),
        0,
        "status reads do not check programs"
    );
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 1.0.0");
    *fixture.paths.lock().unwrap() = vec![new.parent().unwrap().into()];
    assert!(
        old.is_file(),
        "an existing entry must not suppress PATH refresh"
    );
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 2.0.0");
    assert_eq!(
        fixture.captures.load(Ordering::SeqCst),
        2,
        "each user check refreshes PATH even while the old entry still exists"
    );
    fixture
        .core
        .refresh_runtime_check_environment()
        .await
        .unwrap();
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 2.0.0");
    assert_ne!(
        fixture.health().await["status"],
        "ready",
        "version alone is not a successful check"
    );
    fixture.program("new", "3.0.0", false);
    fixture.check().await;
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 3.0.0");

    let saved = configuration(Some(&old));
    fixture.save(0, &saved).await;
    fixture.check().await;
    assert_eq!(
        fixture.health().await["reportedVersion"],
        "codex-cli 1.0.0",
        "process PATH does not select the main executable"
    );
    assert_ne!(
        std::fs::read_to_string(old.parent().unwrap().join("environment.txt"))
            .unwrap()
            .trim(),
        "saved-private"
    );
    let public_before = fixture.public_state().await;
    let settings_before = fixture.settings().await;
    let draft = configuration(Some(&new));
    let preview = fixture
        .core
        .handle_runtime_startup(
            "runtime.startup.check",
            json!({
                "runtimeKind": KIND, "configuration": draft,
            }),
        )
        .await
        .unwrap();
    assert_eq!(preview["reportedVersion"], "codex-cli 3.0.0");
    assert_ne!(
        std::fs::read_to_string(new.parent().unwrap().join("environment.txt"))
            .unwrap()
            .trim(),
        "draft-private"
    );
    assert_eq!(fixture.settings().await, settings_before);
    assert_eq!(fixture.public_state().await, public_before);
    // Replace the program between its version and authentication probes. A
    // private preview must reject the mixed identity without touching public state.
    fixture.program("new", "3.1.0", true);
    let draft_core = fixture.core.clone();
    let changed_draft = configuration(Some(&new));
    let changing_preview = tokio::spawn(async move {
        draft_core
            .handle_runtime_startup(
                "runtime.startup.check",
                json!({
                    "runtimeKind": KIND, "configuration": changed_draft,
                }),
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !fixture.root.join("probe-started").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture.program("new", "3.2.0", false);
    std::fs::write(fixture.root.join("probe-release"), b"release").unwrap();
    assert!(changing_preview.await.unwrap().is_err());
    assert_eq!(fixture.public_state().await, public_before);
    // Republishing identical inputs preserves the directory; a real PATH
    // change invalidates it even when the selected executable stays pinned.
    fixture.seed_ready().await;
    let service = rovai_core::agent_profile::AgentProfileService::default();
    let before = service
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert!(before.model_catalog.observed_at.is_some());
    let unchanged = fixture
        .core
        .refresh_runtime_check_environment()
        .await
        .unwrap();
    let same = service
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert_eq!(
        same.model_catalog.observed_at,
        before.model_catalog.observed_at
    );
    fixture
        .paths
        .lock()
        .unwrap()
        .push(fixture.root.join("new-search-input"));
    let changed = fixture
        .core
        .refresh_runtime_check_environment()
        .await
        .unwrap();
    assert_eq!(changed.generation(), unchanged.generation() + 1);
    let invalidated = service
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert_eq!(invalidated.id, before.id);
    assert_eq!(invalidated.executable_path, before.executable_path);
    assert!(invalidated.model_catalog.observed_at.is_none());
    std::fs::rename(&old, old.with_extension("moved")).unwrap();
    fixture.check().await;
    let missing = fixture.health().await;
    assert_eq!(missing["discovery"]["discoveryStatus"], "missing");
    assert!(
        missing["reportedVersion"].is_null(),
        "never label a missing manual program with an old version"
    );
    assert_eq!(fixture.settings().await, settings_before);

    let other = configuration(None);
    fixture
        .core
        .handle_runtime_startup(
            "runtime.startup.save",
            json!({"runtimeKind": "pi", "expectedRevision": 0, "configuration": other}),
        )
        .await
        .unwrap();
    // Restore-auto may be explicitly inspected, but saving only records that
    // selection. It must not publish the draft's fresh discovery.
    let latest = fixture.program("latest", "4.0.0", false);
    *fixture.paths.lock().unwrap() = vec![latest.parent().unwrap().into()];
    let public_before = fixture.public_state().await;
    let automatic = configuration(None);
    let preview = fixture
        .core
        .handle_runtime_startup(
            "runtime.startup.inspect",
            json!({
                "runtimeKind": KIND, "configuration": automatic,
            }),
        )
        .await
        .unwrap();
    assert_eq!(preview["reportedVersion"], "codex-cli 4.0.0");
    assert_eq!(
        fixture.settings().await,
        settings_before,
        "restore-auto is still only a draft"
    );
    assert_eq!(fixture.public_state().await, public_before);
    assert!(!public_before.to_string().contains("saved-private"));
    assert!(!preview.to_string().contains("draft-auto"));
    assert!(fixture.captures.load(Ordering::SeqCst) >= 6);

    assert!(
        fixture
            .core
            .handle_runtime_startup(
                "runtime.startup.save",
                json!({
                    "runtimeKind": KIND, "expectedRevision": 0, "configuration": automatic,
                })
            )
            .await
            .is_err(),
        "a stale save cannot publish the fresh search environment"
    );
    assert_eq!(fixture.settings().await, settings_before);
    assert_eq!(fixture.public_state().await, public_before);
    let captures_before_save = fixture.captures.load(Ordering::SeqCst);
    let discovery_before_save = public_before["runtimeAvailability"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["runtimeKind"] == KIND.as_str())
        .unwrap()["discovery"]
        .clone();
    fixture.save(1, &automatic).await;
    assert_eq!(
        fixture.captures.load(Ordering::SeqCst),
        captures_before_save
    );
    assert_eq!(
        fixture.health().await["discovery"],
        discovery_before_save,
        "save cannot trigger or publish discovery"
    );
    assert_eq!(
        fixture
            .core
            .runtime_search_environment
            .read()
            .await
            .startup_configuration(AdapterKind::Pi),
        other,
        "refreshing the base environment preserves other saved Runtime settings"
    );
    let captures = fixture.captures.load(Ordering::SeqCst);
    fixture.save(1, &automatic).await;
    assert_eq!(
        fixture.captures.load(Ordering::SeqCst),
        captures,
        "same-write retries remain idempotent"
    );
    // Removed editor requests are closed, including old clients holding a Key draft.
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        for removed in [
            json!({"apiKey":{"action":"replace","value":"private-rpc-test-key"}}),
            json!({"edits":[{"path":["baseUrl"],"before":null,"after":"https://unused.invalid","label":"URL"}]}),
        ] {
            let mut params = removed;
            params["runtimeKind"] = json!(kind);
            let error = fixture
                .core
                .handle_runtime_startup("runtime.startup.save", params)
                .await
                .unwrap_err();
            assert!(!format!("{error:#}").contains("private-rpc-test-key"));
        }
        assert!(
            fixture
                .core
                .handle_runtime_startup("runtime.startup.observe", json!({"runtimeKind":kind}))
                .await
                .is_err()
        );
    }
    // Shared credentials are private; saved checks use them, draft checks don't publish them.
    fixture
        .core
        .refresh_runtime_check_environment()
        .await
        .unwrap();
    fixture.core.run_runtime_discovery().await;
    fixture.check().await;
    fixture.seed_ready().await;
    let installation_before = rovai_core::agent_profile::AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    let generation_before = fixture
        .core
        .runtime_search_environment
        .read()
        .await
        .generation();
    let shared = fixture.core.handle_runtime_startup("runtime.startup.save", json!({"runtimeKind":KIND,"edits":[],
        "commonEnvironment":{"expectedRevision":0,"json":r#"{"CHECK_REFRESH_VALUE":"shared-private","API_KEY":"fixture-common-key"}"#}})).await.unwrap();
    assert_eq!(
        shared["commonEnvironment"]["environment"]["API_KEY"],
        "fixture-common-key"
    );
    assert!(
        shared["configuration"]["environment"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        fixture
            .core
            .runtime_search_environment
            .read()
            .await
            .generation()
            > generation_before
    );
    let installation_after = rovai_core::agent_profile::AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert_eq!(
        installation_after.generation, installation_before.generation,
        "environment saves must not replace live hosts through installation identity"
    );
    assert_ne!(fixture.health().await["status"], "ready");
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(
        std::fs::read_to_string(latest.parent().unwrap().join("environment.txt"))
            .unwrap()
            .trim(),
        "shared-private"
    );
    let before = fixture.public_state().await;
    let preview = fixture.core.handle_runtime_startup("runtime.startup.check", json!({"runtimeKind":KIND,"configuration":automatic,
        "commonEnvironment":{"expectedRevision":1,"json":r#"{"CHECK_REFRESH_VALUE":"draft-private","API_KEY":"fixture-common-key"}"#}})).await.unwrap();
    assert!(!preview.to_string().contains("fixture-common-key"));
    assert_eq!(
        std::fs::read_to_string(latest.parent().unwrap().join("environment.txt"))
            .unwrap()
            .trim(),
        "draft-private"
    );
    assert_eq!(fixture.public_state().await, before);
    assert_eq!(
        fixture.settings().await["commonEnvironment"]["environment"]["CHECK_REFRESH_VALUE"],
        "shared-private"
    );
    assert!(
        fixture
            .core
            .handle_runtime_startup(
                "runtime.startup.save",
                json!({"runtimeKind":KIND,"edits":[],
        "commonEnvironment":{"expectedRevision":0,"json":"{}"}})
            )
            .await
            .is_err()
    );
    // A stalled optional native process cannot own the settings page's response.
    let stalled = fixture.program("settings-only", "0.159.2", true);
    let native_home = fixture.root.join("settings-native");
    std::fs::create_dir_all(&native_home).unwrap();
    std::fs::write(native_home.join("config.toml"), "model_provider='relay'\nmodel='local-model'\n[model_providers.relay]\nbase_url='https://local.example'\nexperimental_bearer_token='local-fake-key'\n").unwrap();
    let startup = configuration(Some(&stalled));
    {
        let mut db = fixture.core.database.lock().await;
        let before = rovai_core::runtime_startup::load(&db, KIND).unwrap();
        rovai_core::runtime_startup::save(&mut db, KIND, before.revision, startup, 100).unwrap();
    }
    let local = tokio::time::timeout(Duration::from_secs(2), fixture.settings())
        .await
        .expect("local settings must not await the stalled auxiliary child");
    assert!(local["configuration"].get("customApi").is_none());
    assert!(local.get("credential").is_none());
    assert!(!local.to_string().contains("local-fake-key"));
    assert!(!stalled.parent().unwrap().join("environment.txt").exists());
    let rejected = tokio::time::timeout(Duration::from_secs(2), fixture.core.handle_runtime_startup("runtime.startup.save", json!({
        "runtimeKind":KIND,"edits":[{"path":["environment","VISIBLE_SETTING"],"before":null,"after":"on","label":""}]
    }))).await.unwrap();
    assert!(
        rejected.is_err(),
        "retired environment field edits are rejected"
    );
    let original = std::fs::read(native_home.join("config.toml")).unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), fixture.core.handle_runtime_startup("runtime.startup.save", json!({
        "runtimeKind":KIND,"edits":[{"path":["baseUrl"],"before":"https://local.example","after":"https://never-write.example","label":""}]
    }))).await.unwrap().unwrap_err();
    assert!(error.to_string().contains("修改字段无效"));
    assert_eq!(
        std::fs::read(native_home.join("config.toml")).unwrap(),
        original
    );
    fixture.close().await;
}

// Controlled child/file barriers own the interleaving, not scheduler timing.
#[tokio::test]
async fn independent_checks_refresh_unchanged_inputs_and_join_same_target() {
    use rovai_core::agent_profile::AgentProfileService;
    // No health evidence and stale pre-upgrade Ready evidence must both leave
    // the already discovered target stable when a diagnostic begins.
    for scenario in [
        "unverified",
        "upgraded",
        "first_install",
        "first_install_unpublished",
    ] {
        if scenario == "first_install_unpublished" && !cfg!(unix) {
            continue;
        }
        let first_install = scenario.starts_with("first_install");
        let upgraded = scenario == "upgraded";
        let fixture = Fixture::new();
        let first_program = fixture.program("first", "1.0.0", true);
        if scenario == "first_install_unpublished" {
            let body = std::fs::read_to_string(&first_program).unwrap().replace(
                "if [ \"$1\" = '--version' ]; then",
                &format!("if [ \"$1\" = '--version' ]; then printf started > '{}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done; printf call >> '{}';",
                    fixture.root.join("version-started").display(), fixture.root.join("version-release").display(), fixture.root.join("version-calls").display()),
            );
            std::fs::write(&first_program, body).unwrap();
        }
        let second_program = fixture.program("second", "2.0.0", false);
        fixture.save(0, &configuration(Some(&first_program))).await;
        fixture
            .core
            .handle_runtime_startup(
                "runtime.startup.save",
                json!({
                    "runtimeKind": "qwen-code", "expectedRevision": 0,
                    "configuration": configuration(Some(&second_program)),
                }),
            )
            .await
            .unwrap();
        if !first_install {
            fixture.core.run_runtime_discovery().await;
        }
        if upgraded {
            fixture.seed_ready().await;
            let before = AgentProfileService::default()
                .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                .unwrap()
                .unwrap();
            fixture.program("first", "2.0.0-upgraded", true);
            fixture.core.run_runtime_discovery().await;
            let after = AgentProfileService::default()
                .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                .unwrap()
                .unwrap();
            assert_eq!(after.version, before.version + 1);
            assert_eq!(after.generation, before.generation + 1);
            let old_snapshot = after.snapshot.unwrap();
            assert_eq!(old_snapshot.probe_status, "ready");
            assert!(old_snapshot.stale_at.is_some());
            assert_eq!(
                old_snapshot.executable_fingerprint,
                before.snapshot.unwrap().executable_fingerprint
            );
        }
        let initial_target = fixture
            .core
            .runtime_check_installation_target(KIND)
            .await
            .unwrap();
        assert_eq!(initial_target.is_none(), first_install);
        let generation = fixture
            .core
            .runtime_search_environment
            .read()
            .await
            .generation();
        let first = tokio::spawn(check(fixture.core.clone()));
        let early_duplicate = if scenario == "first_install_unpublished" {
            tokio::time::timeout(Duration::from_secs(10), async {
                while !fixture.root.join("version-started").exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            // Hold publication after the commit. Another client must already
            // be able to share the worker that owns the new installation.
            let publication = fixture.core.runtime_discovery.write().await;
            std::fs::write(fixture.root.join("version-release"), "").unwrap();
            tokio::time::timeout(Duration::from_secs(10), async {
                while fixture
                    .core
                    .runtime_check_installation_target(KIND)
                    .await
                    .unwrap()
                    .is_none()
                {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            let (acknowledged, acknowledgement) = oneshot::channel();
            let (completed, completion) = oneshot::channel();
            fixture
                .core
                .runtime_check_requests
                .send(
                    crate::application::RuntimeCheckRequest {
                        force_refresh: false,
                        search: fixture.core.runtime_search_environment.read().await.clone(),
                        startup_preview: None,
                        version_refresh: None,
                        version_target: None,
                        model_target: None,
                        runtime_kind: KIND,
                        purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                        trigger: RuntimeCheckTrigger::UserCheck,
                        acknowledged,
                        completion: Some(completed),
                    }
                    .into(),
                )
                .unwrap();
            acknowledgement.await.unwrap();
            drop(publication);
            Some(completion)
        } else {
            None
        };
        tokio::time::timeout(Duration::from_secs(10), async {
            while !fixture.root.join("probe-started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            fixture
                .core
                .runtime_check_installation_target(KIND)
                .await
                .unwrap(),
            if first_install {
                let created = fixture
                    .core
                    .runtime_check_installation_target(KIND)
                    .await
                    .unwrap();
                assert!(created.is_some());
                created
            } else {
                initial_target
            },
            "a diagnostic must reuse the current static identity, even with an old health snapshot"
        );
        if upgraded {
            let installation = AgentProfileService::default()
                .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                .unwrap()
                .unwrap();
            let snapshot = installation.snapshot.unwrap();
            assert_eq!(
                snapshot.probe_status, "installed_unverified",
                "saving the new program's version cannot relabel old Ready evidence"
            );
            assert!(snapshot.last_successful_probe_at.is_none());
            assert!(
                !snapshot
                    .capabilities
                    .contains(&"old-program-capability".to_string())
            );
            assert_eq!(
                snapshot.executable_fingerprint,
                fixture.core.runtime_discovery.read().await[&KIND].executable_fingerprint
            );
        }
        let (acknowledged, acknowledgement) = oneshot::channel();
        let (completed, duplicate) = oneshot::channel();
        fixture
            .core
            .runtime_check_requests
            .send(
                crate::application::RuntimeCheckRequest {
                    force_refresh: false,
                    search: fixture.core.runtime_search_environment.read().await.clone(),
                    startup_preview: None,
                    version_refresh: None,
                    version_target: None,
                    model_target: None,
                    runtime_kind: KIND,
                    purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                    trigger: RuntimeCheckTrigger::UserCheck,
                    acknowledged,
                    completion: Some(completed),
                }
                .into(),
            )
            .unwrap();
        assert!(
            !acknowledgement.await.unwrap(),
            "the duplicate must join the current installation's check"
        );
        let second = tokio::time::timeout(
            Duration::from_secs(10),
            fixture.core.await_runtime_check(
                AdapterKind::QwenCode,
                RuntimeLaunchPurpose::AvailabilityCheck,
                RuntimeCheckTrigger::UserCheck,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(second, RuntimeCheckOutcome::StableFailure);
        assert!(
            !first.is_finished(),
            "B must complete while A is still running"
        );
        // Even an explicit rescan with the same effective inputs must leave A valid.
        fixture
            .core
            .refresh_runtime_check_environment()
            .await
            .unwrap();
        assert_eq!(
            fixture
                .core
                .runtime_search_environment
                .read()
                .await
                .generation(),
            generation
        );
        assert_eq!(
            fixture.captures.load(Ordering::SeqCst),
            3,
            "both user checks and the explicit rescan capture without invalidating unchanged inputs"
        );
        std::fs::write(fixture.root.join("probe-release"), b"release").unwrap();
        assert_eq!(first.await.unwrap(), RuntimeCheckOutcome::StableFailure);
        if let Some(duplicate) = early_duplicate {
            assert_eq!(
                duplicate.await.unwrap().unwrap(),
                RuntimeCheckOutcome::StableFailure
            );
            assert_eq!(
                std::fs::read_to_string(fixture.root.join("version-calls")).unwrap(),
                "call",
                "a request admitted before target synchronization must share this full check"
            );
        }
        assert_eq!(
            duplicate.await.unwrap().unwrap(),
            RuntimeCheckOutcome::StableFailure
        );
        let health = fixture.public_state().await;
        for kind in ["codex-cli", "qwen-code"] {
            let row = health["runtimeAvailability"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["runtimeKind"] == kind)
                .unwrap();
            assert_ne!(row["status"], "checking");
            assert_eq!(row["checking"], false);
            assert_eq!(row["discovery"]["discoveryStatus"], "found");
            assert!(
                row["diagnosticCode"].is_null(),
                "the detection row cannot inherit a full check failure"
            );
            assert!(
                AgentProfileService::default()
                    .managed_installation(
                        &*fixture.core.database.lock().await,
                        kind.parse::<AdapterKind>().unwrap(),
                        "default"
                    )
                    .unwrap()
                    .unwrap()
                    .last_probe_attempt
                    .is_some()
            );
        }
        fixture.close().await;
    }
}

// Controlled child/file barriers own the interleaving, not scheduler timing.
#[tokio::test]
async fn saved_configuration_and_new_check_cannot_join_or_be_overwritten_by_old_probe() {
    for change in ["search", "configuration", "installation"] {
        let save_configuration = change == "configuration";
        let fixture = Fixture::new();
        let old = fixture.program("old", "1.0.0", true);
        let new = fixture.program("new", "2.0.0", false);
        *fixture.paths.lock().unwrap() = vec![old.parent().unwrap().into()];
        let first = tokio::spawn(check(fixture.core.clone()));
        tokio::time::timeout(Duration::from_secs(10), async {
            while !fixture.root.join("probe-started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let generation = fixture
            .core
            .runtime_search_environment
            .read()
            .await
            .generation();
        if save_configuration {
            fixture.save(0, &configuration(Some(&new))).await;
        } else if change == "installation" {
            fixture.program("old", "2.0.0", false);
            fixture.core.run_runtime_discovery().await;
            assert_eq!(
                fixture
                    .core
                    .runtime_search_environment
                    .read()
                    .await
                    .generation(),
                generation
            );
        } else {
            *fixture.paths.lock().unwrap() = vec![new.parent().unwrap().into()];
            fixture
                .core
                .refresh_runtime_check_environment()
                .await
                .unwrap();
        }
        let (acknowledged, acknowledgement) = oneshot::channel();
        let (completed, second) = oneshot::channel();
        fixture
            .core
            .runtime_check_requests
            .send(
                crate::application::RuntimeCheckRequest {
                    force_refresh: false,
                    search: fixture.core.runtime_search_environment.read().await.clone(),
                    startup_preview: None,
                    version_refresh: None,
                    version_target: None,
                    model_target: None,
                    runtime_kind: KIND,
                    purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                    trigger: if change == "installation" {
                        RuntimeCheckTrigger::CatalogOpen
                    } else {
                        RuntimeCheckTrigger::UserCheck
                    },
                    acknowledged,
                    completion: Some(completed),
                }
                .into(),
            )
            .unwrap();
        assert!(
            acknowledgement.await.unwrap(),
            "new target must queue its own check instead of joining the old one"
        );
        assert_eq!(
            fixture.captures.load(Ordering::SeqCst),
            if change == "search" { 2 } else { 1 }
        );
        assert!(
            !first.is_finished(),
            "save/refresh must not stop the existing probe"
        );
        std::fs::write(fixture.root.join("probe-release"), b"release").unwrap();
        // Existing bounded file-update retry may revalidate the replacement.
        // The acknowledgement above proves the new request did not join that old worker.
        assert_eq!(first.await.unwrap(), RuntimeCheckOutcome::Superseded);
        let second = second.await.unwrap();
        if change == "installation" {
            assert!(second.unwrap_err().contains("模型目录"));
            assert!(
                fixture.health().await["reportedVersion"].is_null(),
                "directory reads cannot manufacture a version for a replaced entry"
            );
            assert_eq!(
                fixture
                    .core
                    .await_runtime_check(
                        KIND,
                        RuntimeLaunchPurpose::DiscoveryVersion,
                        RuntimeCheckTrigger::UserCheck,
                    )
                    .await
                    .unwrap(),
                RuntimeCheckOutcome::Ready
            );
        } else {
            assert_eq!(second.unwrap(), RuntimeCheckOutcome::StableFailure);
        }
        assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 2.0.0");
        assert_eq!(
            fixture.settings().await["revision"],
            u64::from(save_configuration)
        );
        fixture.close().await;
    }
}

// Exercise the real terminal handler directly: a timeout has no post-probe
// identity result. A clock wait would not add coverage to this ownership seam.
#[test]
fn supervisor_failure_belongs_only_to_the_captured_installation() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .unwrap()
        .block_on(async {
            use crate::application::{
                RuntimeCheckActivity, RuntimeCheckAttempt, RuntimeCheckFinalization, finalize_runtime_check,
            };
            use rovai_core::agent_profile::AgentProfileService;
            let fixture = Fixture::new();
            let program = fixture.program("timeout", "1.0.0", false);
            fixture.save(0, &configuration(Some(&program))).await;
            fixture.core.run_runtime_discovery().await;
            for (index, change) in [
                "unchanged",
                "upgraded",
                "upgraded_static",
                "upgraded_verified",
                "unobserved_replacement",
                "rescanned_replacement",
                "unknown",
                "created",
                "version_during_io",
                "identity_during_io",
            ]
            .into_iter()
            .enumerate()
            {
                fixture
                    .core
                    .runtime_product_diagnostics
                    .write()
                    .await
                    .clear();
                if change.starts_with("upgraded") {
                    fixture.seed_ready().await;
                    fixture.program("timeout", &format!("2.0.{index}-upgraded"), false);
                    fixture.core.run_runtime_discovery().await;
                    assert!(AgentProfileService::default()
                        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                        .unwrap().unwrap().last_probe_attempt.is_none(),
                        "an old F1 failure must not be selected for F2");
                }
                let search = fixture.core.runtime_search_environment.read().await.clone();
                let installation_target = if matches!(change, "unknown" | "created") {
                    None
                } else {
                    fixture
                        .core
                        .runtime_check_installation_target(KIND)
                        .await
                        .unwrap()
                };
                if change == "upgraded_verified" {
                    fixture.seed_ready().await;
                    assert_eq!(
                        fixture
                            .core
                            .runtime_check_installation_target(KIND)
                            .await
                            .unwrap(),
                        installation_target,
                        "a successful F2 diagnostic must not advance an already discovered F2 installation"
                    );
                } else if change == "upgraded" {
                    // The live merge test owns starting this pre-probe write. Here the
                    // actual Supervisor terminal handler must still accept its timeout.
                    let candidate = search.candidates(KIND, std::iter::empty()).remove(0);
                    let installation = AgentProfileService::default()
                        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                        .unwrap()
                        .unwrap();
                    let verified = rovai_core::agent_profile::VerifiedDiscoveredRuntimeEntry::discover(
                        KIND, installation.executable_path.clone(), installation.source,
                        candidate.entrypoint_locator_identity.clone(), None,
                    ).unwrap();
                    assert!(fixture.core.commit_rebound_runtime_candidate(
                        KIND, &verified, &candidate, search.generation(),
                        &Some((installation.id.clone(), installation.version)),
                        None,
                    ).await.unwrap().is_some());
                    assert_eq!(
                        fixture
                            .core
                            .runtime_check_installation_target(KIND)
                            .await
                            .unwrap(),
                        installation_target
                    );
                }
                let attempt_id = format!("timeout-{index}");
                let (completed, completion) = oneshot::channel();
                let mut attempt = RuntimeCheckAttempt {
                    force_refresh: false,
                    installation_target,
                    search: search.clone(),
                    startup_preview: None,
                    version_refresh: None,
                    version_target: None,
                    model_target: None,
                    attempt_id: attempt_id.clone(),
                    runtime_kind: KIND,
                    purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                    trigger: RuntimeCheckTrigger::UserCheck,
                    catalog_only: false,
                    started_at: tokio::time::Instant::now(),
                    deadline: tokio::time::Instant::now(),
                    waiters: vec![completed],
                };
                if change == "created" {
                    let mut committed_target = None;
                    let current = fixture.core.runtime_check_installation_target(KIND).await.unwrap().unwrap();
                    let _ack = crate::application::RuntimeCheckWorkerContext {
                        force_refresh: false,
                        attempt_id: &attempt_id, installation_target: &mut committed_target,
                    }.publish_target(&fixture.core, KIND, current.clone()).unwrap();
                    assert_eq!(committed_target, Some(current));
                    // The worker result carries this guarded-commit proof even
                    // if its total deadline expires before the Manager's ack.
                    attempt.installation_target = committed_target;
                }
                fixture.core.runtime_check_activity.write().await.activity.insert(
                    KIND,
                    RuntimeCheckActivity {
                        attempt_id,
                        runtime_kind: KIND,
                        deadline: chrono::Utc::now(),
                        running: true,
                    },
                );
                if change.ends_with("replacement") {
                    fixture.program("timeout", &format!("2.0.{index}-replacement"), false);
                    if change == "rescanned_replacement" {
                        fixture.core.run_runtime_discovery().await;
                    }
                }
                assert_eq!(
                    fixture
                        .core
                        .runtime_search_environment
                        .read()
                        .await
                        .generation(),
                    search.generation()
                );
                let before = AgentProfileService::default()
                    .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                    .unwrap()
                    .unwrap();
                let failure_count = || async {
                    fixture
                        .core
                        .database
                        .lock()
                        .await
                        .connection()
                        .query_row(
                            "SELECT COUNT(*) FROM adapter_probe_attempt WHERE installation_id = ?1",
                            [&before.id],
                            |row| row.get::<_, i64>(0),
                        )
                        .unwrap()
                };
                let attempts_before = failure_count().await;
                let diagnostic_before = fixture.health().await["diagnosticCode"].clone();
                let mut finalization = Box::pin(finalize_runtime_check(
                    &fixture.core,
                    attempt,
                    Err("runtime_check_timed_out".into()),
                    RuntimeCheckFinalization::Supervisor,
                ));
                if change.ends_with("during_io") {
                    // A held blocking worker makes the lock boundary deterministic, on
                    // native files as well as Windows shims, without timing thresholds.
                    let (started, ready) = oneshot::channel();
                    let (release, blocked) = std::sync::mpsc::channel();
                    let worker = tokio::task::spawn_blocking(move || {
                        started.send(()).unwrap();
                        blocked.recv().unwrap();
                    });
                    ready.await.unwrap();
                    std::future::poll_fn(|context| {
                        assert!(finalization.as_mut().poll(context).is_pending());
                        std::task::Poll::Ready(())
                    })
                    .await;
                    {
                        let database = fixture
                            .core
                            .database
                            .try_lock()
                            .expect("Supervisor file work must leave the global database available");
                        database.connection().execute(
                            if change == "version_during_io" {
                                "UPDATE adapter_installation SET version = version + 1 WHERE id = ?1"
                            } else {
                                "UPDATE runtime_executable_identity SET byte_size = byte_size + 1 WHERE installation_id = ?1"
                            },
                            [&before.id],
                        ).unwrap();
                    }
                    release.send(()).unwrap();
                    worker.await.unwrap();
                }
                finalization.await;
                assert_eq!(
                    completion.await.unwrap(),
                    Err("runtime_check_timed_out".into()),
                    "the original request retains its own timeout"
                );
                let after = AgentProfileService::default()
                    .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
                    .unwrap()
                    .unwrap();
                if matches!(change, "unchanged" | "upgraded" | "upgraded_static" | "upgraded_verified" | "created") {
                    assert_eq!(failure_count().await, attempts_before + 1);
                    fixture.core.runtime_product_diagnostics.write().await.clear();
                    assert_eq!(
                        fixture.health().await["diagnosticCode"],
                        Value::Null
                    );
                    assert_eq!(after.last_probe_attempt.as_ref().unwrap().diagnostic_code.as_deref(), Some("runtime_check_timed_out"));
                } else {
                    assert_eq!(failure_count().await, attempts_before);
                    let mut expected = before.clone();
                    if change == "version_during_io" {
                        expected.version += 1;
                    }
                    assert_eq!(
                        after, expected,
                        "a stale or unproven timeout cannot write the current installation"
                    );
                    assert!(
                        !fixture
                            .core
                            .runtime_product_diagnostics
                            .read()
                            .await
                            .contains_key(&KIND)
                    );
                    assert_eq!(
                        fixture.health().await["diagnosticCode"],
                        diagnostic_before,
                        "an older legitimate diagnostic may remain, but this timeout must not change it"
                    );
                }
                fixture.core.run_runtime_discovery().await;
            }
            fixture.close().await;
        });
}

// The version must outlive cancellation of the production resolution future,
// exactly as when the existing Check Manager's total timeout drops that future.
// A pure version-reader test cannot prove the DB commit and public projection.
#[cfg(unix)]
#[tokio::test]
async fn full_probe_saves_version_before_connection_and_cancellation() {
    use rovai_core::agent_profile::AgentProfileService;
    let fixture = Fixture::new();
    let program = fixture.program("selected", "1.0.0", true);
    let version_file = fixture.root.join("selected/reported-version");
    let calls = fixture.root.join("selected/version-calls");
    let body = std::fs::read_to_string(&program).unwrap().replace(
        "printf 'codex-cli 1.0.0\\n'",
        &format!(
            "printf call >> '{}'; /bin/cat '{}'",
            calls.display(),
            version_file.display()
        ),
    );
    std::fs::write(&program, body).unwrap();
    fixture.save(0, &configuration(Some(&program))).await;
    fixture.core.run_runtime_discovery().await;
    fixture.seed_ready().await;
    let before = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap()
        .snapshot
        .unwrap();
    let fingerprint = fingerprint_executable(&program).unwrap();
    std::fs::write(&version_file, b"codex-cli 2.0.0\n").unwrap();
    let search = fixture.core.runtime_search_environment.read().await.clone();
    {
        let resolution = fixture.core.run_product_runtime_resolution_in_environment(
            KIND,
            RuntimeLaunchPurpose::AvailabilityCheck,
            tokio::time::Instant::now() + Duration::from_secs(90),
            search,
            false,
            None,
        );
        tokio::pin!(resolution);
        tokio::select! {
            result = &mut resolution => panic!("connection must remain held: {result:?}"),
            _ = async {
                tokio::time::timeout(Duration::from_secs(10), async {
                    while !fixture.root.join("probe-started").exists() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                }).await.unwrap();
            } => {}
        }
        let current = fixture.health().await;
        assert_eq!(current["reportedVersion"], "codex-cli 2.0.0");
        assert_eq!(current["discovery"]["versionProbeSucceeded"], true);
        let saved = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap()
            .snapshot
            .unwrap();
        assert_eq!(saved.reported_version.as_deref(), Some("codex-cli 2.0.0"));
        assert_eq!(saved.capabilities, before.capabilities);
        assert_eq!(
            saved.last_successful_probe_at,
            before.last_successful_probe_at
        );
        assert!(
            tokio::time::timeout(Duration::ZERO, &mut resolution)
                .await
                .is_err()
        );
    }
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 2.0.0");
    assert_eq!(std::fs::read_to_string(&calls).unwrap(), "call");
    std::fs::write(fixture.root.join("probe-release"), b"release").unwrap();
    std::fs::write(&version_file, b"codex-cli 3.0.0\n").unwrap();
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 3.0.0");
    assert_eq!(
        fixture.health().await["discovery"]["versionProbeSucceeded"],
        true
    );
    assert_eq!(fingerprint_executable(&program).unwrap(), fingerprint);
    assert_eq!(
        std::fs::read_to_string(&calls).unwrap(),
        "callcall",
        "each full check reads once, including when later connection checks fail"
    );
    fixture.close().await;

    // A version observation belongs to the selected entry. Merely trying a
    // second installation must not replace it before that candidate is ready.
    // Cover both an existing installation and the first check without one.
    for (kind, existing_entry) in [
        (KIND, "selected"),
        (KIND, "alternate"),
        (KIND, "none"),
        (AdapterKind::ClaudeCodeCli, "selected"),
        (AdapterKind::ClaudeCodeCli, "alternate"),
        (AdapterKind::ClaudeCodeCli, "none"),
    ] {
        let fixture = Fixture::new();
        let (selected, alternate, expected_version) = if kind == AdapterKind::ClaudeCodeCli {
            (
                fixture.claude_program("selected", "2.1.311", true),
                fixture.claude_program("alternate", "2.0.47", false),
                "2.1.311 (Claude Code)",
            )
        } else {
            (
                fixture.program("selected", "2.0.0", false),
                fixture.program("alternate", "1.0.0", true),
                "codex-cli 2.0.0",
            )
        };
        let existing_program = if existing_entry == "alternate" {
            &alternate
        } else {
            &selected
        };
        *fixture.paths.lock().unwrap() = vec![existing_program.parent().unwrap().into()];
        if existing_entry != "none" {
            fixture
                .core
                .refresh_runtime_check_environment()
                .await
                .unwrap();
            fixture.core.run_runtime_discovery().await;
            if kind == KIND {
                fixture.seed_ready().await;
            }
        } else {
            assert!(
                AgentProfileService::default()
                    .managed_installation(&*fixture.core.database.lock().await, kind, "default")
                    .unwrap()
                    .is_none()
            );
        }
        *fixture.paths.lock().unwrap() = vec![
            selected.parent().unwrap().into(),
            alternate.parent().unwrap().into(),
        ];
        let checking = tokio::spawn({
            let core = fixture.core.clone();
            async move {
                core.await_runtime_check(
                    kind,
                    RuntimeLaunchPurpose::AvailabilityCheck,
                    RuntimeCheckTrigger::UserCheck,
                )
                .await
                .unwrap()
            }
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            while !fixture.root.join("probe-started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let during = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        let during_public = fixture.health_for(kind).await;
        std::fs::write(fixture.root.join("probe-release"), "release").unwrap();
        let outcome = checking.await.unwrap();
        let after = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        let after_public = fixture.health_for(kind).await;
        let relocations: i64 = fixture
            .core
            .database
            .lock()
            .await
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM adapter_relocation_audit WHERE installation_id = ?1 AND next_path = ?2 AND result = 'succeeded'",
                rusqlite::params![after.id, alternate.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        fixture.close().await;

        assert_eq!(outcome, RuntimeCheckOutcome::StableFailure);
        assert_eq!(
            during.executable_path,
            selected.to_string_lossy(),
            "an unverified alternate must not replace the selected entry while connecting"
        );
        assert_eq!(
            after.executable_path,
            selected.to_string_lossy(),
            "a failed alternate must not become the installed entry"
        );
        assert_eq!(during_public["reportedVersion"], expected_version);
        assert_eq!(after_public["reportedVersion"], expected_version);
        assert_eq!(
            after.snapshot.unwrap().reported_version.as_deref(),
            Some(expected_version)
        );
        assert_eq!(
            relocations, 0,
            "failed alternatives cannot create successful relocation records"
        );
        if kind == AdapterKind::ClaudeCodeCli {
            assert_eq!(after_public["diagnosticCode"], Value::Null);
            assert_eq!(after_public["failure"]["code"], Value::Null);
            assert_eq!(
                after
                    .last_probe_attempt
                    .as_ref()
                    .unwrap()
                    .diagnostic_code
                    .as_deref(),
                Some("runtime_authentication_required")
            );
        }
    }

    // An alternate that actually passes the ACP probe must still be admitted,
    // with its own version published exactly once after the held connection.
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let python = std::process::Command::new("python3")
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .unwrap();
    assert!(python.status.success());
    let python = String::from_utf8(python.stdout).unwrap();
    let protocol = r#"
import json, pathlib, sys, time
root = pathlib.Path(__file__).parent
if '--version' in sys.argv:
    with (root / 'version-calls').open('a') as f: f.write('call\n')
    print((root / 'reported-version').read_text().strip()); sys.exit(0)
for line in sys.stdin:
    request=json.loads(line); method=request['method']
    if method == 'initialize':
        (root / 'started').touch()
        while (root / 'gate').exists(): time.sleep(.01)
        if (root / 'fail').exists():
            print(json.dumps({'jsonrpc':'2.0','id':request['id'],'error':{'code':-32603,'message':'fixture connection failed'}}),flush=True)
            continue
        result={'protocolVersion':1,'agentCapabilities':{'loadSession':True}}
    elif method == 'session/new':
        result={'sessionId':'fixture-session','configOptions':[
            {'id':'model','name':'Model','category':'model','type':'select','currentValue':'model-0','options':[{'value':'model-0','name':'Model 0'}]},
            {'id':'thinkingEffort','name':'Thinking','type':'select','currentValue':'high','options':[{'value':'high','name':'High'}]}]}
    else: raise AssertionError(method)
    print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':result}),flush=True)
"#;
    let selected_dir = fixture.root.join("selected");
    let alternate_dir = fixture.root.join("alternate");
    for (directory, version) in [(&selected_dir, "0.6.12"), (&alternate_dir, "0.6.13")] {
        std::fs::create_dir_all(directory).unwrap();
        let program = directory.join("mcode");
        std::fs::write(&program, format!("#!{}\n{}", python.trim(), protocol)).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(directory.join("reported-version"), version).unwrap();
    }
    std::fs::write(selected_dir.join("fail"), "").unwrap();
    std::fs::write(alternate_dir.join("gate"), "").unwrap();
    *fixture.paths.lock().unwrap() = vec![selected_dir.clone(), alternate_dir.clone()];
    let kind = AdapterKind::MinimaxCodeCli;
    let checking = tokio::spawn({
        let core = fixture.core.clone();
        async move {
            core.await_runtime_check(
                kind,
                RuntimeLaunchPurpose::AvailabilityCheck,
                RuntimeCheckTrigger::UserCheck,
            )
            .await
            .unwrap()
        }
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !alternate_dir.join("started").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let during = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, kind, "default")
        .unwrap()
        .unwrap();
    let during_public = fixture.health_for(kind).await;
    std::fs::remove_file(alternate_dir.join("gate")).unwrap();
    let outcome = checking.await.unwrap();
    let after = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, kind, "default")
        .unwrap()
        .unwrap();
    let after_public = fixture.health_for(kind).await;
    for directory in [&selected_dir, &alternate_dir] {
        assert_eq!(
            std::fs::read_to_string(directory.join("version-calls"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }
    fixture.close().await;
    assert_eq!(
        during.executable_path,
        selected_dir.join("mcode").to_string_lossy()
    );
    assert_eq!(during_public["reportedVersion"], "0.6.12");
    assert_eq!(outcome, RuntimeCheckOutcome::Ready);
    assert_eq!(
        after.executable_path,
        alternate_dir.join("mcode").to_string_lossy()
    );
    assert_eq!(
        after.snapshot.unwrap().reported_version.as_deref(),
        Some("0.6.13")
    );
    assert_eq!(after_public["reportedVersion"], "0.6.13");
    assert_eq!(
        after_public["discovery"]["executablePath"],
        alternate_dir.join("mcode").to_string_lossy().as_ref()
    );
}

// The full-check/rescan race must cross the production manager and snapshot
// writer. Both health success and failure must retain the rescan's newer version.
#[cfg(unix)]
#[tokio::test]
async fn full_check_finishes_without_overwriting_a_later_rescan_version() {
    use rovai_core::agent_profile::AgentProfileService;
    use std::os::unix::fs::PermissionsExt;
    let python = std::process::Command::new("python3")
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .unwrap();
    assert!(python.status.success());
    let python = String::from_utf8(python.stdout).unwrap();
    let kind = AdapterKind::MinimaxCodeCli;
    for fails in [false, true] {
        let fixture = Fixture::new();
        let program = fixture.root.join("mcode");
        std::fs::write(&program, format!("#!{}\n{}", python.trim(), r#"
import json, pathlib, sys, time
root = pathlib.Path(__file__).parent
if '--version' in sys.argv:
    with (root / 'version-calls').open('a') as f: f.write('call\n')
    print((root / 'reported-version').read_text().strip()); sys.exit(0)
for line in sys.stdin:
    request=json.loads(line); method=request['method']
    if method == 'initialize':
        (root / 'started').touch()
        while (root / 'gate').exists(): time.sleep(.01)
        if (root / 'fail').exists():
            print(json.dumps({'jsonrpc':'2.0','id':request['id'],'error':{'code':-32603,'message':'fixture connection failed'}}),flush=True)
            continue
        result={'protocolVersion':1,'agentCapabilities':{'loadSession':True}}
    elif method == 'session/new':
        result={'sessionId':'fixture-session','configOptions':[
            {'id':'model','name':'Model','category':'model','type':'select','currentValue':'model-0','options':[{'value':'model-0','name':'Model 0'}]},
            {'id':'thinkingEffort','name':'Thinking','type':'select','currentValue':'high','options':[{'value':'high','name':'High'}]}]}
    else: raise AssertionError(method)
    print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':result}),flush=True)
"#)).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(fixture.root.join("reported-version"), "0.6.12").unwrap();
        std::fs::write(fixture.root.join("gate"), "").unwrap();
        if fails {
            std::fs::write(fixture.root.join("fail"), "").unwrap();
        }
        fixture.core.handle_runtime_startup("runtime.startup.save", json!({
            "runtimeKind": kind, "expectedRevision": 0, "configuration": configuration(Some(&program)),
        })).await.unwrap();
        fixture.core.run_runtime_discovery().await;
        let fingerprint = fingerprint_executable(&program).unwrap();
        let check = tokio::spawn({
            let core = fixture.core.clone();
            async move {
                core.await_runtime_check(
                    kind,
                    RuntimeLaunchPurpose::AvailabilityCheck,
                    RuntimeCheckTrigger::UserCheck,
                )
                .await
                .unwrap()
            }
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            while !fixture.root.join("started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let row = |payload: Value| {
            payload["runtimeAvailability"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["runtimeKind"] == "minimax-code-cli")
                .unwrap()
                .clone()
        };
        assert_eq!(
            row(fixture.public_state().await)["reportedVersion"],
            "0.6.12"
        );
        std::fs::write(fixture.root.join("reported-version"), "0.6.13").unwrap();
        fixture.core.rescan_runtime_discovery().await.unwrap();
        let scanned = row(fixture.public_state().await);
        assert_eq!(scanned["reportedVersion"], "0.6.13");
        assert_eq!(fingerprint_executable(&program).unwrap(), fingerprint);
        std::fs::remove_file(fixture.root.join("gate")).unwrap();
        assert_eq!(
            check.await.unwrap(),
            if fails {
                RuntimeCheckOutcome::StableFailure
            } else {
                RuntimeCheckOutcome::Ready
            }
        );
        let completed = row(fixture.public_state().await);
        assert_eq!(completed["reportedVersion"], "0.6.13");
        assert_eq!(completed["discovery"]["versionProbeSucceeded"], true);
        assert_eq!(
            completed["discovery"]["observedAt"],
            scanned["discovery"]["observedAt"]
        );
        let installation = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            installation.snapshot.unwrap().reported_version.as_deref(),
            Some("0.6.13")
        );
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("version-calls"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        fixture.close().await;
    }
}

// The manual rescan owns bounded version reads; passive discovery stays static.
#[cfg(unix)]
#[tokio::test]
async fn manual_rescan_reads_versions_and_discards_replaced_version_responses() {
    use rovai_core::agent_profile::AgentProfileService;
    let fixture = Fixture::new();
    let program = fixture.program("versions", "1.0.0", false);
    // The public single check is installation/version only, even on a program
    // whose connection/capability branch fails. It must not discover other kinds.
    fixture.save(0, &configuration(Some(&program))).await;
    let passive_before = fixture.core.runtime_discovery.read().await.clone();
    assert_eq!(
        fixture
            .core
            .await_runtime_check(
                KIND,
                RuntimeLaunchPurpose::DiscoveryVersion,
                RuntimeCheckTrigger::UserCheck,
            )
            .await
            .unwrap(),
        RuntimeCheckOutcome::Ready
    );
    {
        let observations = fixture.core.runtime_discovery.read().await;
        for (kind, observation) in observations.iter().filter(|(kind, _)| **kind != KIND) {
            assert_eq!(
                serde_json::to_value(Some(observation)).unwrap(),
                serde_json::to_value(passive_before.get(kind)).unwrap()
            );
        }
        let database = fixture.core.database.lock().await;
        let installation = AgentProfileService::default()
            .managed_installation(&database, KIND, "default")
            .unwrap()
            .unwrap();
        let snapshot = installation.snapshot.unwrap();
        assert_eq!(snapshot.authentication_status, "unknown");
        assert_eq!(snapshot.last_successful_probe_at, None);
        assert!(installation.last_probe_attempt.is_none());
        assert!(!fixture.root.join("probe-started").exists());
    }
    let log = fixture.root.join("versions/commands");
    let version_file = fixture.root.join("versions/reported-version");
    std::fs::write(&version_file, b"codex-cli 1.0.0\n").unwrap();
    let body = std::fs::read_to_string(&program).unwrap().replace(
        "printf 'codex-cli 1.0.0\\n'",
        &format!("/bin/cat '{}'", version_file.display()),
    );
    std::fs::write(&program, body).unwrap();
    let instrument = |program: &Path| {
        let body = std::fs::read_to_string(program).unwrap().replace(
            "#!/bin/sh\n",
            &format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\n", log.display()),
        );
        std::fs::write(program, body).unwrap();
    };
    instrument(&program);
    let revision = fixture.settings().await["revision"].as_u64().unwrap();
    fixture.save(revision, &configuration(Some(&program))).await;
    fixture.core.run_runtime_discovery().await;
    assert!(
        !log.exists(),
        "passive discovery cannot execute a version command"
    );
    for _ in 0..3 {
        fixture.core.rescan_runtime_discovery().await.unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&log)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        ["--version", "--version", "--version"]
    );
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 1.0.0");
    let fingerprint = fingerprint_executable(&program).unwrap();
    std::fs::write(&version_file, b"codex-cli 1.1.0\n").unwrap();
    fixture.core.rescan_runtime_discovery().await.unwrap();
    assert_eq!(fingerprint_executable(&program).unwrap(), fingerprint);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 1.1.0");
    std::fs::write(&version_file, b"codex-cli 1.2.0\n").unwrap();
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 1.2.0");
    assert_eq!(
        fixture.health().await["discovery"]["versionProbeSucceeded"],
        true
    );
    let failure = fixture.health().await["diagnosticCode"].clone();
    fixture.core.rescan_runtime_discovery().await.unwrap();
    assert_eq!(
        fixture.health().await["diagnosticCode"],
        failure,
        "rescan cannot clear a same-program check failure"
    );
    assert_eq!(
        std::fs::read_to_string(&log)
            .unwrap()
            .lines()
            .filter(|line| *line == "--version")
            .count(),
        6
    );
    let retained_attempt = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap()
        .last_probe_attempt;
    std::fs::write(&version_file, b"").unwrap();
    fixture.core.rescan_runtime_discovery().await.unwrap();
    let failed = fixture.health().await;
    assert_eq!(failed["reportedVersion"], "codex-cli 1.2.0");
    assert_eq!(failed["discovery"]["versionProbeSucceeded"], false);
    assert_eq!(failed["diagnosticCode"], "runtime_version_empty");
    assert_eq!(failed["failure"]["code"], failed["diagnosticCode"]);
    assert_eq!(
        AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap()
            .last_probe_attempt,
        retained_attempt,
        "light version failure must retain the full check's failure record"
    );
    assert_eq!(fixture.check().await, RuntimeCheckOutcome::StableFailure);
    let failed = fixture.health().await;
    assert_eq!(failed["reportedVersion"], "codex-cli 1.2.0");
    assert_eq!(failed["discovery"]["versionProbeSucceeded"], false);
    assert_eq!(failed["diagnosticCode"], "runtime_version_empty");
    assert_eq!(failed["failure"]["code"], failed["diagnosticCode"]);
    assert!(
        failed["failure"]["detail"]
            .as_str()
            .unwrap()
            .contains("runtime_version_empty")
    );
    let search = fixture.core.runtime_search_environment.read().await.clone();
    let private = rovai_core::runtime_discovery::with_runtime_configuration(
        KIND,
        &search,
        Box::pin(fixture.core.deep_probe_candidate(
            KIND,
            &program,
            RuntimeLaunchPurpose::InstallationRefresh,
            None,
            None,
            false,
            None,
        )),
    )
    .await
    .unwrap();
    assert!(!private.version_probe_succeeded);
    assert_eq!(
        private.snapshot.executable_fingerprint.as_deref(),
        Some(fingerprint.as_str()),
        "a failed direct check without a cached fingerprint still describes the selected program"
    );
    let retained_read_failure = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap()
        .last_probe_attempt;
    std::fs::write(&version_file, b"codex-cli 1.3.0\n").unwrap();
    fixture.core.rescan_runtime_discovery().await.unwrap();
    let recovered = fixture.health().await;
    assert_eq!(recovered["reportedVersion"], "codex-cli 1.3.0");
    assert_eq!(recovered["discovery"]["versionProbeSucceeded"], true);
    assert!(recovered["diagnosticCode"].is_null());
    assert!(
        recovered["failure"].is_null(),
        "a newer successful read supersedes both historical read-error sources"
    );
    assert_eq!(
        AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap()
            .last_probe_attempt,
        retained_read_failure
    );
    for code in [
        "runtime_version_below_minimum",
        "runtime_authentication_required",
        "runtime_capability_incompatible",
    ] {
        fixture
            .core
            .runtime_product_diagnostics
            .write()
            .await
            .insert(
                KIND,
                crate::application::ProductRuntimeDiagnostic {
                    status: "needs_attention",
                    diagnostic_code: code.into(),
                    priority: 2,
                    failure: None,
                },
            );
        assert!(fixture.health().await["diagnosticCode"].is_null());
        assert_eq!(
            fixture
                .core
                .runtime_product_diagnostics
                .read()
                .await
                .get(&KIND)
                .unwrap()
                .diagnostic_code,
            code,
            "light feedback ignores, but never deletes, historical diagnostics"
        );
    }
    fixture.program("versions", "2.0.0-upgraded", false);
    instrument(&program);
    fixture.core.rescan_runtime_discovery().await.unwrap();
    assert_eq!(
        fixture.health().await["reportedVersion"],
        "codex-cli 2.0.0-upgraded"
    );
    let before = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    let replacement = fixture.program("replacement", "4.0.0", false);
    fixture.program("versions", "3.0.0", false);
    let body = std::fs::read_to_string(&program).unwrap().replace(
        "if [ \"$1\" = '--version' ]; then",
        &format!(
            "if [ \"$1\" = '--version' ]; then /bin/mv '{}' '{}';",
            replacement.display(),
            program.display()
        ),
    );
    std::fs::write(&program, body).unwrap();
    fixture.core.rescan_runtime_discovery().await.unwrap();
    let after = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert_eq!(
        after.version, before.version,
        "a replaced version response cannot publish an installation"
    );
    assert_eq!(
        fixture.health().await["reportedVersion"],
        "codex-cli 2.0.0-upgraded"
    );
    fixture.core.rescan_runtime_discovery().await.unwrap();
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 4.0.0");
    // A light check and a directory read never satisfy each other, while
    // duplicate light requests still share one bounded version command.
    let version_started = fixture.root.join("light-version-started");
    let version_release = fixture.root.join("light-version-release");
    let version_calls = fixture.root.join("light-version-calls");
    let body = std::fs::read_to_string(&program).unwrap().replace(
        "if [ \"$1\" = '--version' ]; then",
        &format!("if [ \"$1\" = '--version' ]; then printf v >> '{}'; printf started > '{}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done;",
            version_calls.display(), version_started.display(), version_release.display()),
    );
    std::fs::write(&program, body).unwrap();
    let search = fixture.core.runtime_search_environment.read().await.clone();
    fixture
        .core
        .discover_runtime_installations_for(false, Some(KIND), search.clone())
        .await;
    let prior_attempt = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap()
        .last_probe_attempt;
    let light = tokio::spawn({
        let core = fixture.core.clone();
        async move {
            core.await_runtime_check(
                KIND,
                RuntimeLaunchPurpose::DiscoveryVersion,
                RuntimeCheckTrigger::UserCheck,
            )
            .await
            .unwrap()
        }
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !version_started.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let (acknowledged, acknowledgement) = oneshot::channel();
    let (completion, duplicate) = oneshot::channel();
    fixture
        .core
        .runtime_check_requests
        .send(
            crate::application::RuntimeCheckRequest {
                force_refresh: false,
                search,
                startup_preview: None,
                version_refresh: None,
                version_target: None,
                model_target: None,
                runtime_kind: KIND,
                purpose: RuntimeLaunchPurpose::DiscoveryVersion,
                trigger: RuntimeCheckTrigger::UserCheck,
                acknowledged,
                completion: Some(completion),
            }
            .into(),
        )
        .unwrap();
    assert!(
        !acknowledgement.await.unwrap(),
        "same-purpose light requests must merge"
    );
    let (acknowledged, acknowledgement) = oneshot::channel();
    let (completion, mut catalog) = oneshot::channel();
    fixture
        .core
        .runtime_check_requests
        .send(
            crate::application::RuntimeCheckRequest {
                force_refresh: false,
                search: fixture.core.runtime_search_environment.read().await.clone(),
                startup_preview: None,
                version_refresh: None,
                version_target: None,
                model_target: None,
                runtime_kind: KIND,
                purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                trigger: RuntimeCheckTrigger::CatalogOpen,
                acknowledged,
                completion: Some(completion),
            }
            .into(),
        )
        .unwrap();
    assert!(
        acknowledgement.await.unwrap(),
        "a directory request must queue its own work instead of joining a light check"
    );
    assert!(matches!(
        catalog.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    assert!(
        !light.is_finished(),
        "queuing a directory request cannot complete a held version check"
    );
    assert_eq!(
        AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap()
            .last_probe_attempt,
        prior_attempt
    );
    std::fs::write(&version_release, "").unwrap();
    assert_eq!(light.await.unwrap(), RuntimeCheckOutcome::Ready);
    assert_eq!(
        duplicate.await.unwrap().unwrap(),
        RuntimeCheckOutcome::Ready
    );
    assert!(catalog.await.unwrap().unwrap_err().contains("模型目录"));
    assert_eq!(std::fs::read_to_string(version_calls).unwrap(), "v");
    fixture.close().await;

    // Unchanged wrapper, two independent reads: a late old result cannot write
    // over the newer accepted result or retire a Host started with that result.
    use crate::agent_profile::{
        AdapterPermissionConfig, FrozenAgentRuntimeConfig, ResolvedModelSelection,
    };
    use crate::runtime_fleet::{
        FleetAcquireRequest, FleetReleaseDisposition, FleetReleaseOutcome, RuntimeCompatibilityKey,
        fake_runtime_process_host,
    };
    let fixture = Fixture::new();
    let program = fixture.program("ordered", "1.0.0", false);
    let version = fixture.root.join("version");
    let calls = fixture.root.join("version-calls");
    let hold = fixture.root.join("hold-next");
    let started = fixture.root.join("version-started");
    let release = fixture.root.join("version-release");
    std::fs::write(&version, "codex-cli 1.0.0").unwrap();
    std::fs::write(&program, format!(
        "#!/bin/sh\n[ \"$1\" = '--version' ] || exit 79\nprintf '%s' \"$VERSION_SCOPE_FIXTURE\" > \"$0.env\"\nprintf '%s\\n' \"$*\" >> '{}'\nversion=$(/bin/cat '{}')\nif [ -f '{}' ]; then /bin/mv '{}' '{}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done; fi\nprintf '%s\\n' \"$version\"\n",
        calls.display(), version.display(), hold.display(), hold.display(), started.display(), release.display(),
    )).unwrap();
    let saved_configuration = configuration(Some(&program));
    fixture.save(0, &saved_configuration).await;
    fixture.core.handle_runtime_startup("runtime.startup.save", json!({
        "runtimeKind":KIND, "edits":[], "commonEnvironment":{
            "expectedRevision":0, "json":json!({"VERSION_SCOPE_FIXTURE":"formal"}).to_string(),
        },
    })).await.unwrap();
    assert_eq!(
        fixture
            .core
            .await_runtime_check(
                KIND,
                RuntimeLaunchPurpose::DiscoveryVersion,
                RuntimeCheckTrigger::UserCheck
            )
            .await
            .unwrap(),
        RuntimeCheckOutcome::Ready
    );
    let search = fixture.core.runtime_search_environment.read().await.clone();
    let installation = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    let environment =
        rovai_core::runtime_discovery::with_runtime_configuration(KIND, &search, async {
            let mut values = rovai_core::runtime_discovery::capture_host_runtime_environment();
            let mut command = tokio::process::Command::new(&program);
            rovai_core::runtime_discovery::configure_runtime_command(KIND, &mut command);
            for (name, value) in command.as_std().get_envs() {
                if let Some(value) = value {
                    values.insert(
                        name.to_string_lossy().into_owned(),
                        value.to_string_lossy().into_owned(),
                    );
                }
            }
            crate::member_environment::LaunchEnvironment {
                values: Some(values),
                overlay: None,
            }
        })
        .await;
    let runtime = FrozenAgentRuntimeConfig {
        environment: Some(environment),
        custom_api: None,
        camp_fast: None,
        adapter_kind: KIND,
        installation_id: installation.id.clone(),
        installation_generation: installation.version,
        // Another Runtime's settings can advance the global search generation
        // without changing this Host's actual entry or environment.
        search_environment_generation: search.generation().saturating_sub(1) as i64,
        executable_path: installation.executable_path.clone(),
        auth_scope: "default".into(),
        reported_version: Some("codex-cli 1.0.0".into()),
        executable_fingerprint: fingerprint_executable(&program).unwrap(),
        capabilities: vec![],
        protocol_version: "app-server".into(),
        model: ResolvedModelSelection {
            source: "runtime_default".into(),
            model_id: "default".into(),
            options: json!({}),
            dsh_source: None,
        },
        permissions: AdapterPermissionConfig {
            adapter_kind: KIND,
            schema_version: 1,
            values: json!({}),
        },
        native_session_compatibility_key: None,
        binding_compatibility_digest: None,
        host_config_digest: None,
        config_digest: "fixture".into(),
    };
    let target = RuntimeVersionTarget::for_launch(&runtime).unwrap();
    let empty = std::collections::BTreeMap::new();
    assert_eq!(
        version_target(
            KIND,
            &runtime.installation_id,
            &runtime.executable_path,
            &search,
            Some(crate::member_environment::LaunchEnvironment {
                values: Some(empty.clone()),
                overlay: None
            })
        )
        .await
        .unwrap(),
        RuntimeVersionTarget::new(
            KIND,
            &runtime.installation_id,
            &runtime.executable_path,
            &empty
        )
        .unwrap(),
        "a captured environment cannot regain variables from the current Host environment"
    );
    assert!(
        fixture
            .core
            .runtime_check_activity
            .read()
            .await
            .version_reads
            .contains_key(&target),
        "manual and actual-launch scopes share equivalent effective environments"
    );
    let request = |run: &str, member: &str| FleetAcquireRequest {
        agent_run_id: run.into(),
        execution_epoch: 1,
        adapter_kind: KIND,
        compatibility: RuntimeCompatibilityKey::member("ordered", member, "same"),
    };
    let old_host = fake_runtime_process_host("old-v1");
    let old = fixture
        .core
        .runtime_fleet
        .acquire(request("old-run", "old"), || async { Ok(old_host) })
        .await
        .unwrap();
    let mut passive = fixture.core.runtime_discovery.read().await[&KIND].clone();
    passive.version_probe_succeeded = None;
    std::fs::write(&hold, "").unwrap();
    let older = tokio::spawn({
        let core = fixture.core.clone();
        let search = search.clone();
        async move {
            core.discover_runtime_installations_for(true, Some(KIND), search)
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while !started.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    std::fs::write(&version, "codex-cli 2.0.0").unwrap();
    assert_eq!(
        fixture
            .core
            .await_runtime_check(
                KIND,
                RuntimeLaunchPurpose::DiscoveryVersion,
                RuntimeCheckTrigger::UserCheck
            )
            .await
            .unwrap(),
        RuntimeCheckOutcome::Ready
    );
    let new_host = fake_runtime_process_host("new-v2");
    let new = fixture
        .core
        .runtime_fleet
        .acquire(request("new-run", "new"), || async { Ok(new_host) })
        .await
        .unwrap();
    std::fs::write(&release, "").unwrap();
    assert!(
        older.await.unwrap().is_none(),
        "a late discovery cannot publish a terminal result"
    );
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 2.0.0");
    assert_eq!(
        fixture
            .core
            .runtime_fleet
            .release_with_outcome("old-run", 1, FleetReleaseDisposition::Reusable)
            .await,
        FleetReleaseOutcome::Reusable
    );
    assert_eq!(
        fixture
            .core
            .runtime_fleet
            .release_with_outcome("new-run", 1, FleetReleaseDisposition::Reusable)
            .await,
        FleetReleaseOutcome::Reusable
    );
    assert_ne!(old.process_id, new.process_id);
    let verified = fixture
        .core
        .verify_runtime_entry(&passive, None)
        .await
        .unwrap();
    fixture
        .core
        .publish_runtime_discovery(
            passive,
            Some(verified),
            Some((installation.id.clone(), installation.version)),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        fixture.health().await["reportedVersion"],
        "codex-cli 2.0.0",
        "passive cache publication also cannot overwrite an accepted actual read"
    );

    // Automatic failures consume the interval but do not change public state.
    let count = || std::fs::read_to_string(&calls).unwrap().lines().count();
    let initial_calls = count();
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "fresh-run");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(count(), initial_calls);
    let previous_sequence = {
        let mut state = fixture.core.runtime_check_activity.write().await;
        let read = state.version_reads.get_mut(&target).unwrap();
        read.attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        read.accepted
    };
    std::fs::write(&version, "").unwrap();
    let before = fixture.public_state().await;
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "auto-one");
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "auto-two");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if fixture
                .core
                .runtime_check_activity
                .read()
                .await
                .version_reads[&target]
                .accepted
                > previous_sequence
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(count(), initial_calls + 1);
    assert_eq!(fixture.public_state().await, before);
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "auto-after-failure");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(count(), initial_calls + 1);

    // A manual waiter joining that same background command still receives and
    // publishes the concrete failure. It must not silently start another read.
    fixture
        .core
        .runtime_check_activity
        .write()
        .await
        .version_reads
        .get_mut(&target)
        .unwrap()
        .attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
    std::fs::remove_file(&started).unwrap();
    std::fs::remove_file(&release).unwrap();
    std::fs::write(&hold, "").unwrap();
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "auto-with-waiter");
    tokio::time::timeout(Duration::from_secs(10), async {
        while !started.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let (acknowledged, acknowledgement) = oneshot::channel();
    let (completion, completed) = oneshot::channel();
    fixture
        .core
        .runtime_check_requests
        .send(
            crate::application::RuntimeCheckRequest {
                force_refresh: false,
                search: search.clone(),
                startup_preview: None,
                version_refresh: None,
                version_target: None,
                model_target: None,
                runtime_kind: KIND,
                purpose: RuntimeLaunchPurpose::DiscoveryVersion,
                trigger: RuntimeCheckTrigger::UserCheck,
                acknowledged,
                completion: Some(completion),
            }
            .into(),
        )
        .unwrap();
    assert!(
        !acknowledgement.await.unwrap(),
        "manual request joins the actual in-flight read"
    );
    std::fs::write(&release, "").unwrap();
    assert_eq!(
        completed.await.unwrap().unwrap(),
        RuntimeCheckOutcome::StableFailure
    );
    let failed = fixture.health().await;
    assert_eq!(failed["discovery"]["versionProbeSucceeded"], false);
    assert_eq!(failed["diagnosticCode"], "runtime_version_empty");
    assert_eq!(failed["failure"]["code"], failed["diagnosticCode"]);
    assert_eq!(failed["reportedVersion"], "codex-cli 2.0.0");
    assert_eq!(count(), initial_calls + 2);

    // An actual launch failure counts; a cached nonempty display string alone
    // does not. Consuming this Run's receipt never retries its failed command.
    let failed_read = fixture
        .core
        .observe_launch_version(&runtime, &search, Some("launch-read"), async {
            anyhow::bail!("synthetic launch read failed")
        })
        .await;
    assert!(failed_read.is_err());
    let state_before = {
        let mut state = fixture.core.runtime_check_activity.write().await;
        let read = state.version_reads.get_mut(&target).unwrap();
        read.attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        (read.next, read.accepted, read.attempted_at)
    };
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "launch-read");
    tokio::time::sleep(Duration::from_millis(30)).await;
    {
        let state = fixture.core.runtime_check_activity.read().await;
        let read = &state.version_reads[&target];
        assert_eq!((read.next, read.accepted, read.attempted_at), state_before);
        assert!(
            !state
                .version_read_runs
                .iter()
                .any(|(run_id, ..)| run_id == "launch-read")
        );
    }
    std::fs::write(&version, "codex-cli 2.0.0").unwrap();
    let draft = saved_configuration.clone();
    fixture
        .core
        .handle_runtime_startup(
            "runtime.startup.inspect",
            json!({
                "runtimeKind": KIND, "configuration": draft,
                "commonEnvironment":{"expectedRevision":1, "json":json!({"VERSION_SCOPE_FIXTURE":"draft-private"}).to_string()},
            }),
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(program.with_file_name("codex.env")).unwrap(),
        "draft-private"
    );
    let state = fixture.core.runtime_check_activity.read().await;
    let read = &state.version_reads[&target];
    assert_eq!(
        (read.next, read.accepted, read.attempted_at),
        state_before,
        "unsaved draft reads cannot update the formal target's clock or ordering"
    );
    drop(state);
    assert_eq!(
        count(),
        initial_calls + 3,
        "the only extra command was the explicit draft check"
    );
    // A later due successful read updates the installation without claiming a
    // full health check or changing the old Host's reuse/lifecycle decisions.
    std::fs::write(&version, "codex-cli 3.0.0").unwrap();
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "auto-success");
    tokio::time::timeout(Duration::from_secs(10), async {
        while fixture.health().await["reportedVersion"] != "codex-cli 3.0.0" {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture.core.runtime_fleet.sweep_idle().await;
    let retained = fixture
        .core
        .runtime_fleet
        .acquire(request("after-version-refresh", "old"), || async {
            panic!("version publication must not replace a healthy Warm Host")
        })
        .await
        .unwrap();
    assert_eq!(retained.process_id, old.process_id);
    assert_eq!(
        fixture
            .core
            .runtime_fleet
            .release_with_outcome(
                "after-version-refresh",
                1,
                FleetReleaseDisposition::Reusable,
            )
            .await,
        FleetReleaseOutcome::Reusable
    );
    let saved = AgentProfileService::default()
        .managed_installation(&*fixture.core.database.lock().await, KIND, "default")
        .unwrap()
        .unwrap();
    assert!(saved.last_probe_attempt.is_none());
    let snapshot = saved.snapshot.unwrap();
    assert_eq!(snapshot.authentication_status, "unknown");
    assert!(snapshot.last_successful_probe_at.is_none());
    assert_eq!(count(), initial_calls + 4);
    assert_eq!(
        std::fs::read_to_string(program.with_file_name("codex.env")).unwrap(),
        "formal"
    );
    assert!(
        std::fs::read_to_string(&calls)
            .unwrap()
            .lines()
            .all(|line| line == "--version")
    );
    // An unavailable selected entry is an actual failed automatic attempt,
    // not a cache hit. It must not restart the same work on every later Run.
    let before_missing = fixture.public_state().await;
    let prior = {
        let mut state = fixture.core.runtime_check_activity.write().await;
        let read = state.version_reads.get_mut(&target).unwrap();
        read.attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        read.next
    };
    let temporarily_missing = program.with_file_name("codex-held");
    std::fs::rename(&program, &temporarily_missing).unwrap();
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "missing-entry");
    tokio::time::timeout(Duration::from_secs(10), async {
        while fixture
            .core
            .runtime_check_activity
            .read()
            .await
            .version_reads[&target]
            .next
            == prior
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "missing-entry-again");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        fixture
            .core
            .runtime_check_activity
            .read()
            .await
            .version_reads[&target]
            .next,
        prior + 1
    );
    assert_eq!(
        count(),
        initial_calls + 4,
        "a failed entry read cannot execute or retry a command"
    );
    assert_eq!(fixture.public_state().await, before_missing);
    std::fs::rename(&temporarily_missing, &program).unwrap();

    // Replacing the saved entry immediately forgets its interval, without
    // forgetting an active Run's actual read. Returning to A creates a new
    // scope; a read from A's previous selection cannot commit or mark Hosts.
    let old_search = fixture.core.runtime_search_environment.read().await.clone();
    let old_expected = crate::application::runtime_installation_revision(
        &*fixture.core.database.lock().await,
        KIND,
    )
    .unwrap();
    let (reading, read_started) = oneshot::channel();
    let (finish, held) = oneshot::channel();
    let late = {
        let core = fixture.core.clone();
        let runtime = runtime.clone();
        let search = old_search.clone();
        tokio::spawn(async move {
            core.observe_launch_version(&runtime, &search, Some("switch-in-flight"), async {
                reading.send(()).unwrap();
                held.await.unwrap();
                Ok("codex-cli 0.5.0".to_owned())
            })
            .await
        })
    };
    read_started.await.unwrap();
    let old_scope = fixture
        .core
        .runtime_check_activity
        .read()
        .await
        .version_reads[&target]
        .scope_id;
    let replacement = fixture.program("replacement", "4.0.0", false);
    let revision = fixture.settings().await["revision"].as_u64().unwrap();
    fixture
        .save(revision, &configuration(Some(&replacement)))
        .await;
    {
        let state = fixture.core.runtime_check_activity.read().await;
        assert!(!state.version_reads.keys().any(|target| target.kind == KIND));
        assert!(
            state
                .version_read_runs
                .iter()
                .any(|(run_id, ..)| run_id == "switch-in-flight")
        );
    }
    assert!(
        begin_version_read(
            &fixture.core.runtime_check_activity,
            &fixture.core.database,
            target.clone(),
            old_search.generation(),
            &old_expected,
        )
        .await
        .is_err(),
        "an old worker cannot recreate the removed scope"
    );
    let revision = fixture.settings().await["revision"].as_u64().unwrap();
    fixture.save(revision, &saved_configuration).await;
    assert_eq!(
        fixture
            .core
            .await_runtime_check(
                KIND,
                RuntimeLaunchPurpose::DiscoveryVersion,
                RuntimeCheckTrigger::UserCheck,
            )
            .await
            .unwrap(),
        RuntimeCheckOutcome::Ready
    );
    let calls_after_return = count();
    let current_target = {
        let mut state = fixture.core.runtime_check_activity.write().await;
        let scopes: Vec<_> = state
            .version_reads
            .keys()
            .filter(|target| target.kind == KIND)
            .cloned()
            .collect();
        assert_eq!(
            scopes.len(),
            1,
            "only the current entry remains after A -> B -> A"
        );
        let current_target = scopes[0].clone();
        let current = state.version_reads.get_mut(&current_target).unwrap();
        assert_ne!(current.scope_id, old_scope);
        current.attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        current_target
    };
    finish.send(()).unwrap();
    assert_eq!(late.await.unwrap().unwrap(), "codex-cli 0.5.0");
    assert_eq!(fixture.health().await["reportedVersion"], "codex-cli 3.0.0");
    let before = fixture
        .core
        .runtime_check_activity
        .read()
        .await
        .version_reads[&current_target]
        .next;
    fixture
        .core
        .enqueue_automatic_version_refresh(&runtime, "switch-in-flight");
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        fixture
            .core
            .runtime_check_activity
            .read()
            .await
            .version_reads[&current_target]
            .next,
        before
    );
    assert_eq!(
        count(),
        calls_after_return,
        "entry cleanup cannot add a second version query to the same Run"
    );
    fixture.core.runtime_fleet.shutdown_all().await;
    fixture.close().await;

    // A package manager can replace a stable launcher while keeping the old
    // canonical executable and its Warm Host alive (Homebrew Cellar layout).
    for explicit_launcher in [false, true] {
        let linked = Fixture::new();
        let original = linked.program("cellar/1", "1.0.0", false);
        let upgraded = linked.program("cellar/2", "2.0.0", false);
        for path in [&original, &upgraded] {
            let body = std::fs::read_to_string(path).unwrap();
            std::fs::write(
                path,
                body.replace(
                    "if [ \"$1\" = '--version' ]; then",
                    &format!(
                        "if [ \"$1\" = '--version' ]; then printf 'version\\n' >> '{}';",
                        path.with_extension("calls").display()
                    ),
                ),
            )
            .unwrap();
        }
        let bin = linked.root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let launcher = bin.join("codex");
        std::os::unix::fs::symlink(&original, &launcher).unwrap();
        *linked.paths.lock().unwrap() = vec![bin];
        if explicit_launcher {
            linked.save(0, &configuration(Some(&launcher))).await;
        } else {
            linked
                .core
                .refresh_runtime_check_environment()
                .await
                .unwrap();
        }
        assert_eq!(
            linked
                .core
                .await_runtime_check(
                    KIND,
                    RuntimeLaunchPurpose::DiscoveryVersion,
                    RuntimeCheckTrigger::UserCheck,
                )
                .await
                .unwrap(),
            RuntimeCheckOutcome::Ready
        );
        let installation = AgentProfileService::default()
            .managed_installation(&*linked.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap();
        let mut running = runtime.clone();
        running.installation_id = installation.id.clone();
        running.installation_generation = installation.version;
        running.executable_path = installation.executable_path.clone();
        running.executable_fingerprint = fingerprint_executable(&original).unwrap();
        running.reported_version = Some("codex-cli 1.0.0".into());
        let original_target = RuntimeVersionTarget::for_launch(&running).unwrap();
        linked
            .core
            .runtime_check_activity
            .write()
            .await
            .version_reads
            .entry(original_target.clone())
            .or_default()
            .attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        let held_host = fake_runtime_process_host("linked-old-v1");
        let warm = linked
            .core
            .runtime_fleet
            .acquire(request("linked-old", "linked"), || async { Ok(held_host) })
            .await
            .unwrap();
        linked
            .core
            .runtime_fleet
            .release_with_outcome("linked-old", 1, FleetReleaseDisposition::Reusable)
            .await;
        let reads = |path: &Path| {
            std::fs::read_to_string(path.with_extension("calls"))
                .unwrap_or_default()
                .lines()
                .count()
        };
        assert_eq!(reads(&original), 1);
        std::fs::remove_file(&launcher).unwrap();
        std::os::unix::fs::symlink(&upgraded, &launcher).unwrap();
        linked
            .core
            .enqueue_automatic_version_refresh(&running, "linked-upgrade");
        tokio::time::timeout(Duration::from_secs(10), async {
            while linked.health().await["reportedVersion"] != "codex-cli 2.0.0" {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("background refresh must follow the current launcher, not the old Host path");
        assert!(original.exists());
        assert_eq!(
            reads(&original),
            1,
            "the retained executable must not be queried"
        );
        assert_eq!(reads(&upgraded), 1);
        assert_eq!(running.reported_version.as_deref(), Some("codex-cli 1.0.0"));
        assert_eq!(running.executable_path, original.to_string_lossy());
        let current = AgentProfileService::default()
            .managed_installation(&*linked.core.database.lock().await, KIND, "default")
            .unwrap()
            .unwrap();
        assert_eq!(current.id, installation.id);
        assert_eq!(current.executable_path, upgraded.to_string_lossy());
        let mut current_target = original_target.clone();
        current_target.executable_path = current.executable_path;
        let previous = {
            let state = linked.core.runtime_check_activity.read().await;
            assert!(!state.version_reads.contains_key(&original_target));
            assert!(!state.automatic_version_is_due(&current_target));
            state.version_reads[&current_target].next
        };
        let current_search = linked.core.runtime_search_environment.read().await.clone();
        assert!(
            linked
                .core
                .refresh_runtime_version_for_launch(&running, current_search)
                .await
                .unwrap()
                .is_none(),
            "an old Warm Host shares the current installation's fresh interval"
        );
        linked
            .core
            .runtime_check_activity
            .write()
            .await
            .version_reads
            .get_mut(&current_target)
            .unwrap()
            .attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        linked
            .core
            .enqueue_automatic_version_refresh(&running, "linked-old-host-next-interval");
        tokio::time::timeout(Duration::from_secs(10), async {
            while linked
                .core
                .runtime_check_activity
                .read()
                .await
                .version_reads[&current_target]
                .accepted
                <= previous
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(reads(&original), 1);
        assert_eq!(reads(&upgraded), 2);
        let reused = linked
            .core
            .runtime_fleet
            .acquire(request("linked-after", "linked"), || async {
                panic!("updating the installed version cannot retire a healthy Host")
            })
            .await
            .unwrap();
        assert_eq!(reused.process_id, warm.process_id);
        linked
            .core
            .runtime_fleet
            .release_with_outcome("linked-after", 1, FleetReleaseDisposition::Reusable)
            .await;

        // A failed new target stays silent and cannot fall back to a retained
        // old executable. A fresh resolved target is a cache hit, not a read.
        let broken = linked.program("cellar/broken", "3.0.0", false);
        std::fs::write(
            &broken,
            format!(
                "#!/bin/sh\nprintf 'version\\n' >> '{}'\nexit 2\n",
                broken.with_extension("calls").display(),
            ),
        )
        .unwrap();
        std::fs::remove_file(&launcher).unwrap();
        std::os::unix::fs::symlink(&broken, &launcher).unwrap();
        let public_before_failure = linked.public_state().await;
        linked
            .core
            .runtime_check_activity
            .write()
            .await
            .version_reads
            .get_mut(&current_target)
            .unwrap()
            .attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
        let mut broken_target = current_target.clone();
        broken_target.executable_path = broken.to_string_lossy().into_owned();
        linked
            .core
            .enqueue_automatic_version_refresh(&running, "linked-broken-target");
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state = linked.core.runtime_check_activity.read().await;
                if state
                    .version_reads
                    .get(&broken_target)
                    .is_some_and(|read| read.accepted > 0)
                {
                    break;
                }
                drop(state);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(linked.public_state().await, public_before_failure);
        assert_eq!(reads(&original), 1);
        assert_eq!(reads(&upgraded), 2);
        assert_eq!(reads(&broken), 1);
        let before_resolved_cache_hit = {
            let mut state = linked.core.runtime_check_activity.write().await;
            let read = state.version_reads.get_mut(&current_target).unwrap();
            read.attempted_at = Some(tokio::time::Instant::now() - Duration::from_secs(601));
            (read.next, read.attempted_at)
        };
        let search = linked.core.runtime_search_environment.read().await.clone();
        assert!(
            linked
                .core
                .refresh_runtime_version_for_launch(&running, search)
                .await
                .unwrap()
                .is_none()
        );
        let state = linked.core.runtime_check_activity.read().await;
        let read = &state.version_reads[&current_target];
        assert_eq!((read.next, read.attempted_at), before_resolved_cache_hit);
        drop(state);
        assert_eq!(reads(&broken), 1);

        // A user explicitly pinning the old canonical executable keeps that
        // selection, even though the normal PATH launcher points to the new one.
        let revision = linked.settings().await["revision"].as_u64().unwrap();
        linked.save(revision, &configuration(Some(&original))).await;
        assert_eq!(
            linked
                .core
                .await_runtime_check(
                    KIND,
                    RuntimeLaunchPurpose::DiscoveryVersion,
                    RuntimeCheckTrigger::UserCheck,
                )
                .await
                .unwrap(),
            RuntimeCheckOutcome::Ready
        );
        let before_pin = reads(&original);
        linked
            .core
            .enqueue_automatic_version_refresh(&running, "linked-explicit-pin");
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state = linked.core.runtime_check_activity.read().await;
                if state
                    .version_reads
                    .get(&original_target)
                    .is_some_and(|read| read.accepted > 0)
                    && reads(&original) > before_pin
                {
                    break;
                }
                drop(state);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(linked.health().await["reportedVersion"], "codex-cli 1.0.0");
        assert_eq!(reads(&upgraded), 2);
        linked.core.runtime_fleet.shutdown_all().await;
        linked.close().await;
    }
}

// Owns the save/refresh lock interleaving and the absence of indirect operations.
// The existing probe race starts after environment capture and cannot cover this.
#[tokio::test]
async fn local_saves_finish_while_environment_capture_is_held_and_never_launch_work() {
    let (started, ready) = oneshot::channel();
    let started = StdMutex::new(Some(started));
    let (release, blocked) = std::sync::mpsc::channel();
    let blocked = StdMutex::new(blocked);
    let captures = Arc::new(AtomicUsize::new(0));
    let count = captures.clone();
    let fixture = Fixture::with_capture(Some(Arc::new(move |generation| {
        assert_eq!(
            count.fetch_add(1, Ordering::SeqCst),
            0,
            "save must not capture the environment"
        );
        started.lock().unwrap().take().unwrap().send(()).unwrap();
        blocked.lock().unwrap().recv().unwrap();
        RuntimeSearchEnvironment::for_test_paths(generation, Vec::new())
    })));
    let program = fixture.root.join(if cfg!(windows) {
        "offline.exe"
    } else {
        "offline"
    });
    std::fs::write(
        &program,
        b"synthetic native executable: must never be launched",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let refresh = {
        let core = fixture.core.clone();
        tokio::spawn(async move { core.refresh_runtime_check_environment().await })
    };
    ready.await.unwrap();
    let discovery = serde_json::to_value(&*fixture.core.runtime_discovery.read().await).unwrap();
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        let home = fixture.root.join(kind.as_str());
        std::fs::create_dir_all(&home).unwrap();
        let file = home.join(if kind == AdapterKind::CodexCli {
            "config.toml"
        } else {
            "settings.json"
        });
        let initial = if kind == AdapterKind::CodexCli {
            "model_provider='relay'\nmodel='first'\nkeep_unknown=42\n[model_providers.relay]\nbase_url='https://offline.invalid'\nexperimental_bearer_token='fixture-key'\n".to_string()
        } else {
            json!({"keep_unknown":42,"env":{"ANTHROPIC_BASE_URL":"https://offline.invalid","ANTHROPIC_AUTH_TOKEN":"fixture-key"}}).to_string()
        };
        std::fs::write(&file, initial).unwrap();
        let configuration = configuration(Some(&program));
        rovai_core::runtime_startup::save(
            &mut *fixture.core.database.lock().await,
            kind,
            0,
            configuration,
            1,
        )
        .unwrap();
        let context = rovai_core::runtime_custom_api::native::NativeContext {
            kind,
            directory: home,
            artifact_root: fixture.root.join("unused-native-artifacts"),
            launcher: None,
            codex_source: None,
            environment: Default::default(),
        };
        let old = rovai_core::runtime_custom_api::native::read(&context, None)
            .unwrap()
            .snapshot(&context, false);
        let original = std::fs::read(&file).unwrap();
        for (before, after) in [
            (json!(program.to_string_lossy()), Value::Null),
            (Value::Null, json!(program.to_string_lossy())),
        ] {
            let path = json!(["programPath"]);
            let saved = tokio::time::timeout(Duration::from_secs(2), fixture.core.handle_runtime_startup("runtime.startup.save", json!({
                "runtimeKind":kind,"edits":[{"path":path,"before":before,"after":after,"label":"fixture"}]
            }))).await.expect("a blocked reader must not delay local commit").unwrap();
            assert!(saved.get("status").is_none());
            assert!(!saved.to_string().contains("fixture-key"));
            assert_eq!(captures.load(Ordering::SeqCst), 1);
            assert_eq!(
                serde_json::to_value(&*fixture.core.runtime_discovery.read().await).unwrap(),
                discovery
            );
            assert!(!refresh.is_finished());
            assert_eq!(
                std::fs::read(&file).unwrap(),
                original,
                "startup save must never edit native configuration"
            );
        }
        // A stale field-edit retry is already applied. Even an entry temporarily
        // moved by an external upgrade must not turn that no-op into an error.
        let moved = program.with_extension("moved");
        std::fs::rename(&program, &moved).unwrap();
        let before =
            rovai_core::runtime_startup::load(&*fixture.core.database.lock().await, kind).unwrap();
        let generation = fixture
            .core
            .runtime_search_environment
            .read()
            .await
            .generation();
        let retried = fixture.core.handle_runtime_startup("runtime.startup.save", json!({
            "runtimeKind":kind,"edits":[{"path":["programPath"],"before":null,"after":program,"label":"fixture"}]
        })).await.unwrap();
        assert_eq!(retried["revision"], before.revision);
        assert_eq!(
            fixture
                .core
                .runtime_search_environment
                .read()
                .await
                .generation(),
            generation
        );
        std::fs::rename(&moved, &program).unwrap();
        old.assert_current().unwrap();
        // An external native edit still fences the previous connection.
        std::fs::write(
            &file,
            String::from_utf8(original)
                .unwrap()
                .replace("fixture-key", "rotated-key"),
        )
        .unwrap();
        assert!(old.assert_current().is_err());
    }
    let generation = fixture
        .core
        .runtime_search_environment
        .read()
        .await
        .generation();
    release.send(()).unwrap();
    let published = refresh.await.unwrap().unwrap();
    assert_eq!(
        published.generation(),
        generation,
        "unchanged inputs must not invalidate other checks"
    );
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        assert_eq!(
            published
                .startup_configuration(kind)
                .program_path
                .as_deref(),
            program.to_str(),
            "late refresh must merge the latest saved path"
        );
        assert!(published.startup_configuration(kind).environment.is_empty());
    }
    fixture.close().await;
}

#[tokio::test]
async fn failed_environment_reader_cannot_prevent_a_local_save() {
    let mut fixture = Fixture::new();
    fixture.shutdown.take().unwrap().send(()).unwrap();
    fixture.manager.take().unwrap().await.unwrap();
    let mut core = Arc::try_unwrap(fixture.core).ok().unwrap();
    core.runtime_search_capture =
        Some(Arc::new(|_| panic!("synthetic environment reader failure")));
    let before = core.runtime_search_environment.read().await.summary();
    assert!(core.refresh_runtime_check_environment().await.is_err());
    assert!(
        core.inspect_runtime_startup(KIND, RuntimeStartupConfiguration::default(), false)
            .await
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(core.runtime_search_environment.read().await.summary()).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    let saved = core
        .handle_runtime_startup(
            "runtime.startup.save",
            json!({
                "runtimeKind": KIND, "expectedRevision": 0,
                "configuration": RuntimeStartupConfiguration::default(),
            }),
        )
        .await
        .unwrap();
    assert_eq!(saved["revision"], 1);
    assert_eq!(
        serde_json::to_value(core.runtime_search_environment.read().await.summary().shell).unwrap(),
        serde_json::to_value(before.shell).unwrap(),
        "save preserves the captured environment instead of retrying its failed reader"
    );
    drop(core);
    std::fs::remove_dir_all(fixture.root).unwrap();
}

// Owns the MiniMax/Kilo health/catalog boundary through the production manager and DB.
// A pure merge test cannot prove first-use fallback or preserve catalog timestamps.
#[cfg(unix)]
#[tokio::test]
async fn minimax_check_and_catalog_keep_their_intent_and_target_options() {
    use rovai_core::agent_profile::{AgentProfileService, RuntimeModelCatalogCacheStatus};
    use std::os::unix::fs::PermissionsExt;
    let python = std::process::Command::new("python3")
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .unwrap();
    assert!(python.status.success());
    let python = String::from_utf8(python.stdout).unwrap();
    for (kind, count, first_trigger) in [
        (
            AdapterKind::MinimaxCodeCli,
            3,
            RuntimeCheckTrigger::UserCheck,
        ),
        (
            AdapterKind::MinimaxCodeCli,
            8,
            RuntimeCheckTrigger::CatalogOpen,
        ),
        (AdapterKind::KiloCli, 3, RuntimeCheckTrigger::UserCheck),
        (AdapterKind::KiloCli, 1, RuntimeCheckTrigger::CatalogOpen),
        (AdapterKind::KiloCli, 2, RuntimeCheckTrigger::CatalogOpen),
    ] {
        let fixture = Fixture::new();
        let program = fixture.root.join(if kind == AdapterKind::KiloCli {
            "kilo"
        } else {
            "mcode"
        });
        std::fs::write(&program, format!("#!{}\n{}", python.trim(), r#"
import json, os, pathlib, sys, time
root = pathlib.Path(__file__).parent
kilo = pathlib.Path(__file__).name == 'kilo'
with (root / 'launches').open('a') as f: f.write(json.dumps(sys.argv[1:]) + '\n')
if '--version' in sys.argv:
    print('7.8.27' if kilo else '0.6.12'); sys.exit(0)
count = int((root / 'count').read_text())
def model_id(i): return ('fixture/' if kilo else '') + f'model-{i}'
def wait_gate():
    if (root / 'gate').exists():
        (root / 'started').touch()
        while (root / 'gate').exists(): time.sleep(.01)
if kilo and sys.argv[1:] == ['models','--verbose']:
    wait_gate()
    if (root/'cli-fault').exists():
        fault=(root/'cli-fault').read_text()
        if fault=='exit': sys.exit(1)
        if fault=='malformed': print('fixture/model-0\n{')
        sys.exit(0)
    for i in range(count):
        print(model_id(i))
        # A real verbose catalog exceeds the ordinary 64 KiB diagnostic capture.
        print(json.dumps({'name':f'Model {i}', 'unused':('x'*70000 if i==0 else ''),
            'variants':{value:{} for value in (['low','high'] if i==0 else ['medium','max'] if i==1 else [])}},indent=2))
    sys.exit(0)
current = model_id(0)
def session():
    values = ['low','high'] if current == model_id(0) else (['medium','max'] if kilo else ['xhigh','max'])
    result = {'sessionId':'fixture-session', 'configOptions':[
        {'id':'model','name':'Model','category':'model','type':'select','currentValue':current,
         'options':[{'value':model_id(i),'name':f'Model {i}'} for i in range(count)]},
        {'id':'effort' if kilo else 'thinkingEffort','name':'Thinking','type':'select','currentValue':values[-1] if kilo else 'high',
         'options':[{'value':value,'name':value.title()} for value in values]}]}
    if not kilo and current=='model-2': result['configOptions'].pop()
    return result
for line in sys.stdin:
    request=json.loads(line); method=request['method']
    with (root / 'methods').open('a') as f: f.write(json.dumps({'pid':os.getpid(), 'method':method, 'value':request.get('params',{}).get('value'), 'current':current})+'\n')
    if method == 'initialize':
        wait_gate()
        result={'protocolVersion':1,'agentCapabilities':{'loadSession':True}}
    elif method == 'session/new': result=session()
    elif method == 'session/set_config_option':
        assert not kilo, 'Kilo directory discovery must not select Session models'
        assert request['params']['configId']=='model'
        if request['params']['value']=='model-1' and (root/'fault').exists():
            fault=(root/'fault').read_text()
            if fault=='timeout': time.sleep(31)
            if fault=='disconnect': sys.exit(1)
            if fault=='malformed':
                print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':{'configOptions':'broken'}}),flush=True); continue
            errors={
                'reject': {'code':-32602,'message':'Model selection is not advertised.'},
                'internal': {'code':-32603,'message':'Model selection is not advertised.'},
                'method': {'code':-32601,'message':'Method not found'},
                'invalid-params': {'code':-32602,'message':'model unavailable'},
                'unknown-data': {'code':-32602,'message':'Model selection is not advertised.','data':{'sessionError':True}}}
            if fault in errors:
                print(json.dumps({'jsonrpc':'2.0','id':request['id'],'error':errors[fault]}),flush=True)
                continue
        current=request['params']['value']; result=session()
        if current=='model-1' and (root/'fault').exists():
            fault=(root/'fault').read_text()
            if fault=='mismatch': result['configOptions'][0]['currentValue']='model-0'
            if fault=='conflict': result['models']={'currentModelId':'model-0'}
            if fault=='effort': result['configOptions'][1]['options']=[{'value':123}]
            if fault=='missing': result.pop('configOptions')
    else: raise AssertionError(method)
    print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':result}),flush=True)
"#)).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(fixture.root.join("count"), count.to_string()).unwrap();
        fixture.core.handle_runtime_startup("runtime.startup.save", json!({
            "runtimeKind":kind,"expectedRevision":0,
            "edits":[{"path":["programPath"],"before":null,"after":program,"label":"Program"}],
            "commonEnvironment":{"expectedRevision":0,"json":json!({"MINIMAX_DATA_DIR":fixture.root}).to_string()},
        })).await.unwrap();
        fixture.core.run_runtime_discovery().await;
        if first_trigger == RuntimeCheckTrigger::UserCheck {
            assert_eq!(
                fixture
                    .core
                    .await_runtime_check(
                        kind,
                        RuntimeLaunchPurpose::AvailabilityCheck,
                        first_trigger
                    )
                    .await
                    .unwrap(),
                RuntimeCheckOutcome::Ready
            );
            let installation = AgentProfileService::default()
                .managed_installation(&*fixture.core.database.lock().await, kind, "default")
                .unwrap()
                .unwrap();
            assert_eq!(
                installation.model_catalog.status,
                RuntimeModelCatalogCacheStatus::Unavailable
            );
            assert!(installation.model_catalog.observed_at.is_none());
            let snapshot = installation.snapshot.unwrap();
            assert_eq!(snapshot.probe_status, "ready");
            assert_eq!(
                snapshot
                    .models
                    .iter()
                    .filter(|model| !model.options.is_empty())
                    .count(),
                1
            );
            assert!(
                !std::fs::read_to_string(fixture.root.join("methods"))
                    .unwrap()
                    .contains("session/set_config_option")
            );
        }
        std::fs::write(fixture.root.join("methods"), "").unwrap();
        std::fs::write(fixture.root.join("launches"), "").unwrap();
        std::fs::write(fixture.root.join("gate"), "").unwrap();
        let target = fixture
            .core
            .runtime_check_installation_target(kind)
            .await
            .unwrap();
        let first = tokio::spawn({
            let core = fixture.core.clone();
            async move {
                core.await_runtime_check(
                    kind,
                    RuntimeLaunchPurpose::AvailabilityCheck,
                    first_trigger,
                )
                .await
                .unwrap()
            }
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            while !fixture.root.join("started").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let other = if first_trigger == RuntimeCheckTrigger::UserCheck {
            RuntimeCheckTrigger::CatalogOpen
        } else {
            RuntimeCheckTrigger::UserCheck
        };
        let mut waiters = Vec::new();
        for (trigger, queued) in [(first_trigger, false), (other, true), (other, false)] {
            let (acknowledged, ack) = oneshot::channel();
            let (completion, done) = oneshot::channel();
            fixture
                .core
                .runtime_check_requests
                .send(
                    crate::application::RuntimeCheckRequest {
                        force_refresh: false,
                        search: fixture.core.runtime_search_environment.read().await.clone(),
                        startup_preview: None,
                        version_refresh: None,
                        version_target: None,
                        model_target: None,
                        runtime_kind: kind,
                        purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                        trigger,
                        acknowledged,
                        completion: Some(completion),
                    }
                    .into(),
                )
                .unwrap();
            assert_eq!(
                ack.await.unwrap(),
                queued,
                "active and pending must merge only equal catalog/check intents"
            );
            waiters.push(done);
        }
        std::fs::remove_file(fixture.root.join("gate")).unwrap();
        assert_eq!(first.await.unwrap(), RuntimeCheckOutcome::Ready);
        for waiter in waiters {
            assert_eq!(waiter.await.unwrap().unwrap(), RuntimeCheckOutcome::Ready);
        }
        assert_eq!(
            fixture
                .core
                .runtime_check_installation_target(kind)
                .await
                .unwrap(),
            target
        );
        let methods = std::fs::read_to_string(fixture.root.join("methods"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            methods
                .iter()
                .filter(|m| m["method"] == "session/new")
                .count(),
            if kind == AdapterKind::KiloCli { 1 } else { 2 }
        );
        assert_eq!(
            methods
                .iter()
                .filter(|m| m["method"] == "session/set_config_option")
                .count(),
            0
        );
        let mut settings_by_process = std::collections::BTreeMap::new();
        for method in &methods {
            let count = settings_by_process
                .entry(method["pid"].as_u64().unwrap())
                .or_insert(0);
            if method["method"] == "session/set_config_option" {
                *count += 1;
            }
        }
        let mut settings = settings_by_process.into_values().collect::<Vec<_>>();
        settings.sort();
        assert_eq!(
            settings,
            vec![0; if kind == AdapterKind::KiloCli { 1 } else { 2 }],
            "directory discovery never traverses Session models"
        );
        if kind == AdapterKind::KiloCli {
            assert_eq!(
                std::fs::read_to_string(fixture.root.join("launches"))
                    .unwrap()
                    .lines()
                    .filter(|line| line.contains("models"))
                    .count(),
                1,
                "one CLI command supplies every model's options"
            );
        }
        assert!(!methods.iter().any(|m| m["method"] == "session/prompt"));
        let complete = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            complete.model_catalog.status,
            RuntimeModelCatalogCacheStatus::Fresh
        );
        if kind == AdapterKind::KiloCli {
            for model in &complete.snapshot.as_ref().unwrap().models {
                assert!(!model.is_default);
                assert!(model.runtime_metadata.is_none());
                if model.id == "fixture/model-2" {
                    assert!(
                        model.options.is_empty(),
                        "native models without variants have no effort control"
                    );
                    continue;
                }
                let option = &model.options[0];
                assert_eq!(option.key, "effort");
                let values = if model.id == "fixture/model-0" {
                    ["low", "high"]
                } else {
                    ["medium", "max"]
                };
                assert_eq!(
                    option
                        .values
                        .iter()
                        .map(|choice| choice.value.as_str())
                        .collect::<Vec<_>>(),
                    values
                );
                assert_eq!(option.default_value, None);
            }
        } else {
            assert!(
                complete
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .models
                    .iter()
                    .filter(|model| !model.options.is_empty())
                    .count()
                    == 1
            );
        }
        // A later health result cannot erase options or advance the complete catalog's clock.
        assert_eq!(
            fixture
                .core
                .await_runtime_check(
                    kind,
                    RuntimeLaunchPurpose::AvailabilityCheck,
                    RuntimeCheckTrigger::UserCheck
                )
                .await
                .unwrap(),
            RuntimeCheckOutcome::Ready
        );
        let latest = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            latest.model_catalog.observed_at,
            complete.model_catalog.observed_at
        );
        assert_eq!(
            serde_json::to_value(&latest.snapshot.as_ref().unwrap().models).unwrap(),
            serde_json::to_value(&complete.snapshot.as_ref().unwrap().models).unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("launches"))
                .unwrap()
                .lines()
                .filter(|line| line.contains("--version"))
                .count(),
            2
        );
        // Existing invalidation must not be undone by a partial health observation.
        fixture
            .core
            .database
            .lock()
            .await
            .connection()
            .execute(
                "UPDATE adapter_capability_snapshot SET stale_at = ?2, model_catalog_succeeded_at = NULL WHERE installation_id = ?1",
                rusqlite::params![latest.id, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        assert_eq!(
            fixture
                .core
                .await_runtime_check(
                    kind,
                    RuntimeLaunchPurpose::AvailabilityCheck,
                    RuntimeCheckTrigger::UserCheck
                )
                .await
                .unwrap(),
            RuntimeCheckOutcome::Ready
        );
        let invalidated = AgentProfileService::default()
            .managed_installation(&*fixture.core.database.lock().await, kind, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            invalidated.model_catalog.status,
            RuntimeModelCatalogCacheStatus::Unavailable
        );
        assert!(invalidated.model_catalog.observed_at.is_none());
        let catalog = fixture
            .core
            .open_runtime_model_catalog(kind, true, false)
            .await
            .unwrap();
        assert_eq!(catalog["refreshStatus"], "completed");
        assert_eq!(catalog["cache"]["status"], "fresh");
        if kind == AdapterKind::KiloCli {
            if count == 3 {
                let methods_before = std::fs::read_to_string(fixture.root.join("methods")).unwrap();
                for fault in ["empty", "malformed", "exit"] {
                    std::fs::write(fixture.root.join("cli-fault"), fault).unwrap();
                    let failure = fixture
                        .core
                        .open_runtime_model_catalog(kind, true, true)
                        .await
                        .unwrap_err();
                    assert!(
                        failure
                            .to_string()
                            .contains("runtime_model_catalog_unavailable")
                    );
                    let retained = AgentProfileService::default()
                        .managed_installation(&*fixture.core.database.lock().await, kind, "default")
                        .unwrap()
                        .unwrap();
                    assert_eq!(
                        serde_json::to_value(&retained.snapshot.as_ref().unwrap().models).unwrap(),
                        catalog["models"],
                        "last good CLI catalog survives {fault}"
                    );
                    assert_eq!(
                        serde_json::to_value(&retained.model_catalog.observed_at).unwrap(),
                        catalog["cache"]["observedAt"]
                    );
                    assert_eq!(
                        std::fs::read_to_string(fixture.root.join("methods")).unwrap(),
                        methods_before,
                        "a failed CLI query must not fall back to ACP"
                    );
                }
                std::fs::remove_file(fixture.root.join("cli-fault")).unwrap();
            }
            fixture.close().await;
            continue;
        }
        // Initial current model is already confirmed by the directory read.
        std::fs::write(fixture.root.join("methods"), "").unwrap();
        let cached = fixture
            .core
            .open_target_model_options(kind, "model-0", None, true, false)
            .await
            .unwrap();
        assert_eq!(cached["refreshStatus"], "not_required");
        let initial_at = cached["models"][0]["runtimeMetadata"]["modelOptionsObservedAt"].clone();
        let b = fixture
            .core
            .open_target_model_options(kind, "model-1", None, false, false)
            .await
            .unwrap();
        assert_eq!(b["selectedModelId"], "model-1");
        assert_eq!(
            b["models"][0]["runtimeMetadata"]["modelOptionsObservedAt"],
            initial_at
        );
        assert!(b["models"][0]["isDefault"] == true);
        let chosen = b["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == "model-1")
            .unwrap();
        assert_eq!(chosen["isDefault"], false);
        assert_eq!(chosen["options"][0]["values"][0]["value"], "xhigh");
        let after_b = std::fs::read_to_string(fixture.root.join("methods")).unwrap();
        assert_eq!(after_b.matches("session/set_config_option").count(), 1);
        fixture
            .core
            .open_target_model_options(kind, "model-1", None, false, false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("methods")).unwrap(),
            after_b,
            "fresh target starts no probe"
        );
        let c = fixture
            .core
            .open_target_model_options(kind, "model-2", None, false, false)
            .await
            .unwrap();
        let chosen = c["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == "model-2")
            .unwrap();
        assert_eq!(chosen["runtimeMetadata"]["modelOptionsResolved"], true);
        assert_eq!(chosen["options"], json!([]));
        let after_c = std::fs::read_to_string(fixture.root.join("methods")).unwrap();
        fixture
            .core
            .open_target_model_options(kind, "model-2", None, false, false)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("methods")).unwrap(),
            after_c
        );
        // A forced read of the initial current model does not select it again.
        fixture
            .core
            .open_target_model_options(kind, "model-0", None, false, true)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("methods"))
                .unwrap()
                .matches("session/set_config_option")
                .count(),
            2
        );
        if count == 3 {
            for fault in [
                "disconnect",
                "malformed",
                "internal",
                "method",
                "invalid-params",
                "unknown-data",
                "reject",
                "mismatch",
                "conflict",
                "effort",
                "missing",
                "timeout",
            ] {
                let availability_before =
                    fixture.core.current_runtime_availability_status(kind).await;
                let before = fixture
                    .core
                    .runtime_model_catalog_payload(kind, "not_required")
                    .await
                    .unwrap();
                std::fs::write(fixture.root.join("fault"), fault).unwrap();
                let result = fixture
                    .core
                    .open_target_model_options(kind, "model-1", None, false, true)
                    .await;
                assert!(result.is_err(), "{fault} must fail the target read");
                let retained = fixture
                    .core
                    .runtime_model_catalog_payload(kind, "not_required")
                    .await
                    .unwrap();
                assert_eq!(
                    retained["models"], before["models"],
                    "{fault} preserves capabilities"
                );
                assert_eq!(
                    retained["cache"], before["cache"],
                    "{fault} does not advance success"
                );
                assert_eq!(
                    fixture.core.current_runtime_availability_status(kind).await,
                    availability_before
                );
                std::fs::remove_file(fixture.root.join("fault")).unwrap();
            }
            // Two concurrent callers of B share one native read; A has a separate queued read.
            std::fs::write(fixture.root.join("methods"), "").unwrap();
            std::fs::write(fixture.root.join("gate"), "").unwrap();
            std::fs::remove_file(fixture.root.join("started")).unwrap();
            let b1 = tokio::spawn({
                let core = fixture.core.clone();
                async move {
                    core.open_target_model_options(kind, "model-1", None, false, true)
                        .await
                }
            });
            tokio::time::timeout(Duration::from_secs(5), async {
                while !fixture.root.join("started").exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            let mut joined = Vec::new();
            for model_id in ["model-1", "model-0"] {
                let (_, context, _) = fixture
                    .core
                    .target_model_options_payload(kind, model_id, None)
                    .await
                    .unwrap();
                let (acknowledged, ack) = oneshot::channel();
                let (completion, done) = oneshot::channel();
                fixture
                    .core
                    .runtime_check_requests
                    .send(
                        crate::application::RuntimeCheckRequest {
                            force_refresh: true,
                            search: fixture.core.runtime_search_environment.read().await.clone(),
                            startup_preview: None,
                            version_refresh: None,
                            version_target: None,
                            model_target: Some(crate::application::ModelOptionsTarget {
                                model_id: model_id.into(),
                                source: None,
                                context,
                            }),
                            runtime_kind: kind,
                            purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                            trigger: RuntimeCheckTrigger::CatalogOpen,
                            acknowledged,
                            completion: Some(completion),
                        }
                        .into(),
                    )
                    .unwrap();
                assert_eq!(ack.await.unwrap(), model_id == "model-0");
                joined.push(done);
            }
            std::fs::remove_file(fixture.root.join("gate")).unwrap();
            b1.await.unwrap().unwrap();
            for done in joined {
                assert_eq!(done.await.unwrap().unwrap(), RuntimeCheckOutcome::Ready);
            }
            let methods = std::fs::read_to_string(fixture.root.join("methods")).unwrap();
            assert_eq!(methods.matches("session/new").count(), 2);
            assert_eq!(methods.matches("session/set_config_option").count(), 1);
            let merged = fixture
                .core
                .runtime_model_catalog_payload(kind, "not_required")
                .await
                .unwrap();
            assert!(
                merged["models"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|model| model["runtimeMetadata"]["modelOptionsResolved"] == true)
            );
            let b_at = merged["models"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["id"] == "model-1")
                .unwrap()["runtimeMetadata"]["modelOptionsObservedAt"]
                .clone();
            let refreshed = fixture
                .core
                .open_runtime_model_catalog(kind, true, true)
                .await
                .unwrap();
            assert_eq!(
                refreshed["models"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|m| m["id"] == "model-1")
                    .unwrap()["runtimeMetadata"]["modelOptionsObservedAt"],
                b_at
            );
            // Editing configuration while a probe is live cannot publish old-identity success.
            let before_change = fixture
                .core
                .runtime_model_catalog_payload(kind, "not_required")
                .await
                .unwrap();
            std::fs::write(fixture.root.join("gate"), "").unwrap();
            std::fs::remove_file(fixture.root.join("started")).unwrap();
            let changing = tokio::spawn({
                let core = fixture.core.clone();
                async move {
                    core.open_target_model_options(kind, "model-1", None, false, true)
                        .await
                }
            });
            tokio::time::timeout(Duration::from_secs(5), async {
                while !fixture.root.join("started").exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            std::fs::write(
                fixture.root.join("config.yaml"),
                "defaultModel: changed/config\n",
            )
            .unwrap();
            std::fs::remove_file(fixture.root.join("gate")).unwrap();
            assert!(changing.await.unwrap().is_err());
            let after_change = fixture
                .core
                .runtime_model_catalog_payload(kind, "not_required")
                .await
                .unwrap();
            assert_eq!(after_change["models"], before_change["models"]);
            assert_eq!(after_change["cache"], before_change["cache"]);
            // The cache-only read detects this mismatch without starting a process.
            let methods_before = std::fs::read_to_string(fixture.root.join("methods")).unwrap();
            let invalid = fixture
                .core
                .open_target_model_options(kind, "model-1", None, true, false)
                .await
                .unwrap();
            assert_eq!(invalid["refreshStatus"], "deferred");
            assert!(
                invalid["models"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|m| m["runtimeMetadata"]["modelOptionsResolved"] != true)
            );
            assert_eq!(
                std::fs::read_to_string(fixture.root.join("methods")).unwrap(),
                methods_before
            );
        }
        fixture.close().await;
    }
}
