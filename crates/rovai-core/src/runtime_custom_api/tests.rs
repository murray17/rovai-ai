use super::*;
use crate::runtime_startup::{self, RuntimeEnvironmentVariable, RuntimeStartupConfiguration};
pub(super) fn configuration(kind: AdapterKind) -> CustomApiConfiguration {
    let base_url = "https://relay.example/prefix".into();
    match kind {
        AdapterKind::ClaudeCodeCli => CustomApiConfiguration::ClaudeCode {
            mode: Some(ConnectionMode::CustomApi),
            base_url,
            models: ClaudeApiModels {
                model: "main".into(),
                reasoning_model: "think".into(),
                haiku_model: "small".into(),
                sonnet_model: "medium".into(),
                opus_model: "large".into(),
            },
        },
        AdapterKind::CodexCli => CustomApiConfiguration::Codex {
            mode: Some(ConnectionMode::CustomApi),
            base_url,
            models: vec![
                CustomApiModel {
                    row_id: "one".into(),
                    id: "model-a".into(),
                    display_name: "Development".into(),
                },
                CustomApiModel {
                    row_id: "two".into(),
                    id: "model-b".into(),
                    display_name: String::new(),
                },
            ],
            default_model: "model-a".into(),
            default_row_id: Some("one".into()),
        },
        _ => unreachable!(),
    }
}
// This parser owner retains the URL/key/closed-schema boundaries from the superseded secret-store draft.
#[test]
fn configuration_rejects_ambiguous_connections_and_preserves_optional_models() {
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        let mut config = configuration(kind);
        config.validate(kind).unwrap();
        assert_eq!(config.base_url(), "https://relay.example/prefix");
        assert!(config.validate(AdapterKind::Pi).is_err());
    }
    for url in [
        "https://name:password@relay.example/prefix",
        "ftp://relay.example",
        "https://relay.example/#fragment",
        "",
    ] {
        let mut config = CustomApiConfiguration::ClaudeCode {
            mode: Some(ConnectionMode::CustomApi),
            base_url: url.into(),
            models: ClaudeApiModels::default(),
        };
        assert!(config.validate(AdapterKind::ClaudeCodeCli).is_err());
    }
    let mut claude = CustomApiConfiguration::ClaudeCode {
        mode: Some(ConnectionMode::CustomApi),
        base_url: "http://127.0.0.1/prefix".into(),
        models: ClaudeApiModels::default(),
    };
    claude.validate(AdapterKind::ClaudeCodeCli).unwrap();
    let mut codex = configuration(AdapterKind::CodexCli);
    if let CustomApiConfiguration::Codex { models, .. } = &mut codex {
        models.remove(0);
    }
    assert!(codex.validate(AdapterKind::CodexCli).is_err());
    if let CustomApiConfiguration::Codex { default_row_id, .. } = &mut codex {
        *default_row_id = Some("two".into());
    }
    codex.validate(AdapterKind::CodexCli).unwrap();
    if let CustomApiConfiguration::Codex { models, .. } = &mut codex {
        models.push(models[0].clone());
    }
    assert!(codex.validate(AdapterKind::CodexCli).is_err());
    for value in ["", "********", "bad\nkey"] {
        assert!(
            ApiKeyChange::Replace {
                value: value.into()
            }
            .validate()
            .is_err()
        );
    }
    assert!(serde_json::from_value::<CustomApiConfiguration>(json!({"kind":"grok-build","enabled":false,"baseUrl":"","model":"","apiKey":"never-store-me"})).is_err());
    assert!(
        serde_json::from_value::<RuntimeStartupConfiguration>(
            json!({"programPath":null,"environment":[],"customApiSnapshot":{}})
        )
        .is_err()
    );
}

// Native storage + SQLite publication + field-level merge cannot be proved by a serializer-only test.
#[cfg(feature = "extended-tests")]
#[test]
fn native_editor_reads_without_writing_merges_fields_and_never_copies_credentials() {
    let mut db = crate::test_support::seeded_runtime_database_owned();
    let kind = AdapterKind::ClaudeCodeCli;
    let context =
        native::NativeContext::resolve(kind, &RuntimeStartupConfiguration::default(), db.path())
            .unwrap();
    let path = context.path();
    private_storage::atomic_write_private_bytes(&path, br#"{"env":{"ANTHROPIC_AUTH_TOKEN":"isolated-old-key","ANTHROPIC_BASE_URL":"https://relay.example/prefix","ANTHROPIC_MODEL":"before"},"permissions":{"defaultMode":"default"},"unknown":{"preserve":true}}"#).unwrap();
    let before = std::fs::read(&path).unwrap();
    let saved = runtime_startup::load(&db, kind).unwrap();
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "opening the editor is read-only"
    );
    assert_eq!(saved.credential.as_ref().unwrap().status, "available");
    assert_eq!(saved.revision, 0, "native use requires no initial save");
    let frozen = saved.configuration.custom_api_snapshot.clone().unwrap();
    assert_eq!(frozen.key().unwrap().as_deref(), Some("isolated-old-key"));
    let public = serde_json::to_string(&runtime_startup::public(saved.clone())).unwrap();
    assert!(!public.contains("isolated-old-key"));
    let edit = FieldEdit {
        path: vec!["claudeModels".into(), "model".into()],
        before: json!("before"),
        after: json!("after"),
        label: "主模型".into(),
    };
    let mut external = native::read_json(&path).unwrap();
    external["unknown"]["external"] = json!(12);
    private_storage::atomic_write_private_bytes(&path, &serde_json::to_vec(&external).unwrap())
        .unwrap();
    let prepared =
        runtime_startup::prepare_save(&db, kind, vec![edit.clone()], &ApiKeyChange::Keep).unwrap();
    assert!(prepared.conflicts.is_empty());
    runtime_startup::commit_save(&mut db, kind, prepared, 1, ApiKeyChange::Keep, None).unwrap();
    let native = native::read_json(&path).unwrap();
    assert_eq!(native["unknown"]["external"], 12);
    assert_eq!(native["env"]["ANTHROPIC_MODEL"], "after");
    assert_eq!(native["env"]["ANTHROPIC_AUTH_TOKEN"], "isolated-old-key");
    let mut stale = edit.clone();
    stale.after = json!("mine");
    let conflict =
        runtime_startup::prepare_save(&db, kind, vec![stale], &ApiKeyChange::Keep).unwrap();
    assert_eq!(conflict.conflicts.len(), 1);
    assert_eq!(conflict.conflicts[0].current, "after");
    let saved = runtime_startup::load(&db, kind).unwrap();
    let change = ApiKeyChange::Replace {
        value: "isolated-new-key".into(),
    };
    let replace = FieldEdit {
        path: vec!["credentialVersion".into()],
        before: json!(saved.credential.as_ref().unwrap().version),
        after: json!("replace"),
        label: "API Key".into(),
    };
    let prepared = runtime_startup::prepare_save(&db, kind, vec![replace], &change).unwrap();
    let saved = runtime_startup::commit_save(&mut db, kind, prepared, 2, change, None).unwrap();
    assert!(
        frozen.key().is_err(),
        "retained references must not quietly read a newer key"
    );
    assert!(
        frozen.assert_current().is_err(),
        "old executions cannot be resumed against a new connection"
    );
    let stored: String = db
        .connection()
        .query_row(
            "SELECT configuration_json FROM runtime_startup_setting",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !stored.contains("isolated-new-key")
            && !stored.contains("isolated-old-key")
            && !stored.contains("relay.example")
    );
    let snapshot = saved.configuration.custom_api_snapshot.unwrap();
    let mut message =
        json!({"echo":"isolated-new-key", "isolated-new-key":["prefix isolated-new-key suffix"]});
    snapshot.redactor().unwrap().value(&mut message);
    assert!(!message.to_string().contains("isolated-new-key"));
    assert!(
        !serde_json::to_string(&snapshot)
            .unwrap()
            .contains("isolated-new-key")
    );
    assert!(
        !snapshot
            .claude_settings()
            .unwrap()
            .to_string()
            .contains("isolated-new-key")
    );
    let artifact = snapshot.write_artifact("immutable.json", b"old").unwrap();
    assert!(
        snapshot
            .write_artifact("immutable.json", b"changed")
            .is_err()
    );
    assert!(snapshot.write_artifact("../escape", b"bad").is_err());
    assert_eq!(std::fs::read(artifact).unwrap(), b"old");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let mut preview = RuntimeStartupConfiguration {
        custom_api: Some(configuration(kind)),
        ..Default::default()
    };
    preview.environment.push(RuntimeEnvironmentVariable {
        name: "CLAUDE_CONFIG_DIR".into(),
        value: context.directory.to_string_lossy().into_owned(),
    });
    let bytes = std::fs::read(&path).unwrap();
    let (preview, _) = runtime_startup::resolve_draft(
        &db,
        kind,
        preview,
        ApiKeyChange::Replace {
            value: "preview-only-key".into(),
        },
    )
    .unwrap();
    assert_eq!(
        preview
            .custom_api_snapshot
            .unwrap()
            .key()
            .unwrap()
            .as_deref(),
        Some("preview-only-key")
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let current = runtime_startup::load(&db, kind).unwrap();
    let change = ApiKeyChange::Replace {
        value: "rollback-only-key".into(),
    };
    let edit = FieldEdit {
        path: vec!["credentialVersion".into()],
        before: json!(current.credential.unwrap().version),
        after: json!("replace"),
        label: "API Key".into(),
    };
    let prepared = runtime_startup::prepare_save(&db, kind, vec![edit], &change).unwrap();
    db.connection().execute_batch("CREATE TRIGGER reject_startup_update BEFORE UPDATE ON runtime_startup_setting BEGIN SELECT RAISE(FAIL, 'isolated storage failure'); END;").unwrap();
    assert!(runtime_startup::commit_save(&mut db, kind, prepared, 3, change, None).is_err());
    assert_eq!(
        std::fs::read(&path).unwrap(),
        bytes,
        "a failed state commit restores the native connection"
    );
    assert_eq!(
        runtime_startup::load(&db, kind).unwrap().revision,
        current.revision
    );
}

// File-based native precedence, comment preservation and read-only credential replacement owner.
#[test]
fn native_sources_keep_environment_references_and_replace_only_the_selected_connection() {
    let root = std::env::temp_dir().join(format!("rovai-native-config-{}", uuid::Uuid::new_v4()));
    let context = native::NativeContext {
        kind: AdapterKind::CodexCli,
        directory: root.clone(),
        artifact_root: root.join("artifacts"),
        environment: BTreeMap::from([("RELAY_KEY".into(), "isolated-environment-key".into())]),
    };
    let path = context.path();
    private_storage::atomic_write_private_bytes(&path, b"# keep this comment\nmodel_provider = 'relay'\nmodel = 'custom-id'\n[model_providers.relay]\nname = 'Relay'\nbase_url = 'https://relay.example/prefix'\nwire_api = 'responses'\nenv_key = 'RELAY_KEY'\n[mcp_servers.untouched]\ncommand = 'fixture'\n").unwrap();
    let auth = root.join("auth.json");
    private_storage::atomic_write_private_bytes(
        &auth,
        br#"{"tokens":{"access_token":"fake-official-token"},"unknown":true}"#,
    )
    .unwrap();
    let read = native::read(&context, None).unwrap();
    assert!(matches!(
        read.source,
        native::CredentialSource::Environment { .. }
    ));
    assert!(
        !read.credential.source_writable
            && read.credential.can_replace
            && !read.credential.can_clear
    );
    let mut desired = read.configuration.clone();
    if let CustomApiConfiguration::Codex { base_url, .. } = &mut desired {
        *base_url = "https://other.example/prefix".into();
    }
    let edit = FieldEdit {
        path: vec!["baseUrl".into()],
        before: json!(read.configuration.base_url()),
        after: json!(desired.base_url()),
        label: "接口地址".into(),
    };
    native_edit::write(
        &context,
        &read,
        &desired,
        &[edit],
        &ApiKeyChange::Keep,
        None,
    )
    .unwrap();
    assert_eq!(
        native::read(&context, None).unwrap().credential.status,
        "available",
        "static keys have no inferred URL binding"
    );
    let read = native::read(&context, None).unwrap();
    let auth_before = std::fs::read(&auth).unwrap();
    native_edit::write(
        &context,
        &read,
        &read.configuration,
        &[],
        &ApiKeyChange::Replace {
            value: "replacement-key".into(),
        },
        None,
    )
    .unwrap();
    let native = std::fs::read_to_string(&path).unwrap();
    assert!(native.contains("# keep this comment") && native.contains("[mcp_servers.untouched]"));
    assert!(!native.contains("isolated-environment-key") && !native.contains("env_key"));
    assert_eq!(
        std::fs::read(&auth).unwrap(),
        auth_before,
        "API edits must not rewrite official tokens"
    );
    let read = native::read(&context, None).unwrap();
    let snapshot = read.snapshot(&context, false);
    let mut command = tokio::process::Command::new("not-spawned");
    codex_catalog::configure(&snapshot, &mut command).unwrap();
    assert!(
        !format!("{:?}", command.as_std().get_args().collect::<Vec<_>>())
            .contains("replacement-key")
    );
    assert!(
        command
            .as_std()
            .get_envs()
            .any(|(name, value)| name == "ROVAI_CUSTOM_API_KEY"
                && value == Some(std::ffi::OsStr::new("replacement-key")))
    );
    let before = std::fs::read(&path).unwrap();
    std::fs::write(&path, b"bad = \"replacement-key\n").unwrap();
    let error = native::read(&context, None).err().unwrap().to_string();
    assert!(!error.contains("replacement-key"));
    std::fs::write(&path, before).unwrap();
    let mut doc = native::read_toml(&path).unwrap();
    doc["model_providers"]["relay"]["http_headers"]["x-routing-tag"] =
        toml_edit::value("private-routing-tag");
    std::fs::write(&path, doc.to_string()).unwrap();
    let read = native::read(&context, None).unwrap();
    let mut command = tokio::process::Command::new("not-spawned");
    codex_catalog::configure(&read.snapshot(&context, false), &mut command).unwrap();
    assert!(
        !format!("{:?}", command.as_std().get_args().collect::<Vec<_>>())
            .contains("private-routing-tag")
    );
    assert!(
        command
            .as_std()
            .get_envs()
            .any(|(_, value)| value == Some(std::ffi::OsStr::new("private-routing-tag")))
    );
    doc["model_providers"]["relay"]["http_headers"]["Authorization"] =
        toml_edit::value("Bearer unrelated-secret");
    std::fs::write(&path, doc.to_string()).unwrap();
    let read = native::read(&context, None).unwrap();
    let error = codex_catalog::configure(
        &read.snapshot(&context, false),
        &mut tokio::process::Command::new("not-spawned"),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("认证请求头") && !error.contains("unrelated-secret"));

    // An unrelated login file must never supply credentials to a provider which
    // does not opt into native OpenAI authentication.
    std::fs::write(&path, "model_provider='relay'\nmodel='custom-id'\n[model_providers.relay]\nbase_url='https://relay.example'\nwire_api='responses'\nrequires_openai_auth=false\n").unwrap();
    private_storage::atomic_write_private_bytes(&auth, br#"{"OPENAI_API_KEY":"inactive-file-key","tokens":{"access_token":"preserved-token"},"unknown":true}"#).unwrap();
    assert!(matches!(
        native::read(&context, None).unwrap().source,
        native::CredentialSource::Missing
    ));

    std::fs::write(&path, "model='custom-id'\nopenai_base_url='https://relay.example'\ncli_auth_credentials_store='keyring'\n").unwrap();
    let read = native::read(&context, None).unwrap();
    assert!(matches!(
        read.source,
        native::CredentialSource::NativeManaged { .. }
    ));
    assert!(read.snapshot(&context, false).key().unwrap().is_none());
    codex_catalog::validate_effective(
        &read.snapshot(&context, false),
        &json!({"config":{"model_provider":"openai","openai_base_url":"https://relay.example"}}),
    )
    .unwrap();
    let mut changed = read.configuration.clone();
    if let CustomApiConfiguration::Codex { base_url, .. } = &mut changed {
        *base_url = "https://new-api.example".into();
    }
    let before = std::fs::read(&path).unwrap();
    assert!(
        native_edit::write(
            &context,
            &read,
            &changed,
            &[FieldEdit {
                path: vec!["baseUrl".into()],
                before: json!("https://relay.example"),
                after: json!("https://new-api.example"),
                label: "接口地址".into()
            }],
            &ApiKeyChange::Keep,
            None
        )
        .unwrap_err()
        .to_string()
        .contains("Codex 原生系统管理")
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);

    // Explicit clear affects the API field only, retaining official tokens and
    // unrelated native data. The resulting provider cannot fall back to them.
    std::fs::write(
        &path,
        "model='custom-id'\nopenai_base_url='https://relay.example'\n",
    )
    .unwrap();
    let read = native::read(&context, None).unwrap();
    assert!(read.credential.can_clear);
    native_edit::write(
        &context,
        &read,
        &read.configuration,
        &[],
        &ApiKeyChange::Clear,
        None,
    )
    .unwrap();
    let auth = native::read_json(&auth).unwrap();
    assert!(auth.get("OPENAI_API_KEY").is_none());
    assert_eq!(auth["tokens"]["access_token"], "preserved-token");
    assert_eq!(auth["unknown"], true);
    assert!(matches!(
        native::read(&context, None).unwrap().source,
        native::CredentialSource::Missing
    ));

    // Keeping an official login must not silently send its token to a new API URL.
    std::fs::write(&path, "model='native-default'\n").unwrap();
    let read = native::read(&context, None).unwrap();
    assert_eq!(read.observation.login_status, "signed_in");
    assert!(matches!(read.source, native::CredentialSource::Missing));
    let mut desired = read.configuration.clone();
    if let CustomApiConfiguration::Codex { base_url, mode, .. } = &mut desired {
        *base_url = "https://new-api.example".into();
        *mode = Some(ConnectionMode::CustomApi);
    }
    native_edit::write(
        &context,
        &read,
        &desired,
        &[FieldEdit {
            path: vec!["baseUrl".into()],
            before: json!(""),
            after: json!("https://new-api.example"),
            label: "接口地址".into(),
        }],
        &ApiKeyChange::Keep,
        None,
    )
    .unwrap();
    assert!(matches!(
        native::read(&context, Some(ConnectionMode::CustomApi))
            .unwrap()
            .source,
        native::CredentialSource::Missing
    ));

    let claude = native::NativeContext {
        kind: AdapterKind::ClaudeCodeCli,
        directory: root.join("claude"),
        artifact_root: root.join("claude-artifacts"),
        environment: BTreeMap::from([
            ("ANTHROPIC_AUTH_TOKEN".into(), "shell-only-key".into()),
            ("ANTHROPIC_BASE_URL".into(), "https://relay.example".into()),
            (
                "ANTHROPIC_CUSTOM_HEADERS".into(),
                "x-routing-tag: private-routing-tag".into(),
            ),
        ]),
    };
    let snapshot = native::read(&claude, None)
        .unwrap()
        .snapshot(&claude, false);
    let mut command = tokio::process::Command::new("not-spawned");
    claude_native::configure(&snapshot, &mut command).unwrap();
    assert!(
        command
            .as_std()
            .get_envs()
            .any(|(name, value)| name == "ANTHROPIC_CUSTOM_HEADERS"
                && value == Some(std::ffi::OsStr::new("x-routing-tag: private-routing-tag")))
    );
    assert!(
        !snapshot
            .claude_settings()
            .unwrap()
            .to_string()
            .contains("private-routing-tag")
    );
    let mut settings = json!({"effective": snapshot.claude_settings().unwrap()});
    let status = json!({"sections":[{"rows":[{"label":"Auth token","value":"ANTHROPIC_AUTH_TOKEN"},{"label":"Anthropic base URL","value":"https://relay.example"}]}]});
    claude_native::validate(&snapshot, &settings, &status, None).unwrap();
    settings["effective"]["env"]["ANTHROPIC_AUTH_TOKEN"] = json!("wrong-shell-key");
    assert!(claude_native::validate(&snapshot, &settings, &status, None).is_err());
    let mut official = snapshot.clone();
    official
        .configuration
        .set_mode(Some(ConnectionMode::OfficialLogin));
    if let CustomApiConfiguration::ClaudeCode { models, .. } = &mut official.configuration {
        models.sonnet_model = "dormant-api-sonnet".into();
    }
    claude_native::validate(&official, &json!({"effective":official.claude_settings().unwrap(),"applied":{"model":"native-sonnet"}}), &json!({"sections":[{"rows":[]}]}), Some("sonnet")).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
