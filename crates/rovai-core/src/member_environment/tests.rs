use super::*;
use crate::{
    agent_identity::{LUOKE_AGENT_ID, MUWA_AGENT_ID},
    agent_profile::FrozenAgentRuntimeConfig,
    db::Database,
};

fn database() -> (Database, PathBuf) {
    let root =
        std::env::temp_dir().join(format!("rovai-member-environment-{}", uuid::Uuid::new_v4()));
    let database = crate::test_support::fresh_schema_database_at(&root);
    (database, root)
}

fn runtime(kind: AdapterKind) -> FrozenAgentRuntimeConfig {
    serde_json::from_value(json!({"adapterKind":kind,"installationId":"fixture-installation","installationGeneration":1,
        "searchEnvironmentGeneration":1,"executablePath":"/bin/sh","authScope":"default","reportedVersion":"2.1.287",
        "executableFingerprint":"fixture","capabilities":[],"protocolVersion":"fixture","model":{"source":"runtime_default","modelId":"default","options":{}},
        "permissions":{"adapterKind":kind,"schemaVersion":1,"values":{}},"nativeSessionCompatibilityKey":null,
        "bindingCompatibilityDigest":"binding","hostConfigDigest":"host","configDigest":"fixture"})).unwrap()
}
fn save(connection: &Connection, member: &str, revision: i64, values: Value) -> Result<()> {
    prepare(
        connection,
        member,
        AdapterKind::Pi,
        &ModelSelection::RuntimeDefault,
        EnvironmentEdit {
            inherit_common: None,
            expected_revision: revision,
            json: values.to_string(),
        },
    )?
    .commit(connection)
}

fn conversation(connection: &Connection, camp: &str, member: &str) -> String {
    connection.execute("INSERT OR IGNORE INTO camp(id,title,project_binding_kind,project_path,last_message_sequence,version,created_at,updated_at)
        VALUES(?1,'Env','directory','/tmp',0,1,datetime('now'),datetime('now'))", [camp]).unwrap();
    let id = format!("{camp}-{member}");
    connection.execute("INSERT OR IGNORE INTO conversation(id,camp_id,agent_id,version,created_at,updated_at) VALUES(?1,?2,?3,1,datetime('now'),datetime('now'))",
        params![id,camp,member]).unwrap();
    id
}

#[test]
fn private_versions_preserve_credentials_and_new_launches_read_current_configuration() {
    let (mut database, root) = database();
    let a = LUOKE_AGENT_ID;
    let c = conversation(database.connection(), "camp-a", a);
    database
        .connection()
        .execute(
            "UPDATE conversation SET native_session_id='native-existing' WHERE id=?1",
            [&c],
        )
        .unwrap();
    save(
        database.connection(),
        a,
        0,
        json!({"ANTHROPIC_BASE_URL":"https://a.example","CLEARED_TOKEN":""}),
    )
    .unwrap();
    let mut admitted = runtime(AdapterKind::Pi);
    admitted.environment = Some(
        launch_with_host(database.connection(), a, AdapterKind::Pi, || {
            Environment::from([
                ("ANTHROPIC_API_KEY".into(), "fixture-host-a".into()),
                ("HOST_ONLY".into(), "old".into()),
            ])
        })
        .unwrap(),
    );
    let serialized = serde_json::to_value(&admitted).unwrap();
    assert!(serialized.get("environment").is_none());
    assert!(!serialized.to_string().contains("fixture-host-a"));
    let mut historical = serialized.clone();
    historical["environment"] = json!({"brokenHistoricalReference":true});
    let recovered: FrozenAgentRuntimeConfig = serde_json::from_value(historical).unwrap();
    assert!(recovered.environment.is_none());
    assert_eq!(recovered.config_digest, admitted.config_digest);
    save(database.connection(), a, 1, json!({"ANTHROPIC_BASE_URL":"https://b.example","ANTHROPIC_API_KEY":"fixture-member-b","CLEARED_TOKEN":""})).unwrap();
    let snapshot = get(database.connection(), a, AdapterKind::Pi).unwrap();
    assert_eq!(
        snapshot["environment"]["ANTHROPIC_API_KEY"],
        "fixture-member-b"
    );
    assert_eq!(snapshot["environment"]["CLEARED_TOKEN"], "");
    let raw: Vec<u8> = database
        .connection()
        .query_row(
            "SELECT ciphertext FROM member_runtime_environment WHERE revision=2",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("fixture-member-b"));
    assert!(save(database.connection(), a, 0, json!({})).is_err());
    assert!(
        prepare(
            database.connection(),
            a,
            AdapterKind::Pi,
            &ModelSelection::RuntimeDefault,
            EnvironmentEdit {
                inherit_common: None,
                expected_revision: 1,
                json: json!({"ANTHROPIC_API_KEY":"different"}).to_string()
            }
        )
        .is_err()
    );
    save(
        database.connection(),
        a,
        2,
        json!({"ANTHROPIC_BASE_URL":"https://c.example","ANTHROPIC_API_KEY":"fixture-member-b"}),
    )
    .unwrap();
    {
        let tx = database.connection_mut().transaction().unwrap();
        save(&tx, a, 3, json!({"X":"rolled-back"})).unwrap();
    }
    assert_eq!(
        latest(database.connection(), a, AdapterKind::Pi).unwrap(),
        3
    );
    // Existing process context stays A; after reopening the same native session,
    // each new launch uses today's configuration without any historical lookup.
    assert_eq!(
        admitted
            .environment
            .as_ref()
            .unwrap()
            .values
            .as_ref()
            .unwrap()["ANTHROPIC_API_KEY"],
        "fixture-host-a"
    );
    drop(database);
    let database = Database::open(&root).unwrap();
    let current = current_for_launch(database.connection(), a, AdapterKind::Pi).unwrap();
    assert_eq!(
        current.values.as_ref().unwrap()["ANTHROPIC_API_KEY"],
        "fixture-member-b"
    );
    assert_eq!(
        current.values.as_ref().unwrap()["ANTHROPIC_BASE_URL"],
        "https://c.example"
    );
    assert_eq!(
        database
            .connection()
            .query_row(
                "SELECT native_session_id FROM conversation WHERE id=?1",
                [&c],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "native-existing"
    );
    // Owner editors expose values, while output scrubbing still treats credential
    // names as secrets, even when a real credential is a short literal.
    let mut display_env = admitted.environment.as_ref().unwrap().clone();
    let values = display_env.values.as_mut().unwrap();
    for (name, value) in [
        ("AUTH_ENABLED", "1"),
        ("TOKEN_LIMIT", "2048"),
        ("KEY_PATH", "/tmp/keys"),
        ("AUTH_MODE", "bearer"),
        ("XAI_API_KEY", "x"),
    ] {
        values.insert(name.into(), value.into());
    }
    let redactor = display_env.redactor();
    let original = json!({"sessionId":"session-1", "flag":"1", "limit":"2048",
        "path":"/tmp/keys", "mode":"bearer", "secret":"x", "known":"fixture-host-a"});
    let displayed = redactor.redacted_value(&original);
    for field in ["sessionId", "flag", "limit", "path", "mode"] {
        assert_eq!(displayed[field], original[field]);
    }
    assert_eq!(displayed["secret"], "[redacted]");
    assert_eq!(displayed["known"], "[redacted]");
    assert_eq!(original["secret"], "x");
    assert!(!format!("{admitted:?}").contains("fixture-host-a"));
    save(database.connection(), a, 3, json!({})).unwrap();
    let cleared = launch_with_host(database.connection(), a, AdapterKind::Pi, || {
        Environment::from([("ANTHROPIC_API_KEY".into(), "fixture-host-new".into())])
    })
    .unwrap();
    assert_eq!(
        cleared.values.as_ref().unwrap()["ANTHROPIC_API_KEY"],
        "fixture-host-new"
    );
    // The shared layer belongs to a Runtime, and never mutates an already captured launch.
    let common_edit = |revision, value: Value| common::Edit {
        expected_revision: revision,
        json: value.to_string(),
    };
    common::prepare(database.connection(), AdapterKind::Pi, common_edit(0,
        json!({"COMMON_ONLY":"shared", "ANTHROPIC_API_KEY":"fixture-common-secret", "EMPTY":"common"})))
        .unwrap().commit(database.connection()).unwrap();
    assert_eq!(
        common::get(database.connection(), AdapterKind::Pi).unwrap()["environment"]["ANTHROPIC_API_KEY"],
        "fixture-common-secret"
    );
    let bytes: Vec<u8> = database
        .connection()
        .query_row(
            "SELECT ciphertext FROM runtime_common_environment",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("fixture-common-secret"));
    assert!(
        common::current(database.connection(), AdapterKind::CodexCli)
            .unwrap()
            .is_empty()
    );
    assert!(
        common::prepare(
            database.connection(),
            AdapterKind::Pi,
            common_edit(0, json!({}))
        )
        .is_err()
    );
    let inherited = launch_with_host(database.connection(), a, AdapterKind::Pi, || {
        Environment::from([("HOST_ONLY".into(), "host".into())])
    })
    .unwrap();
    assert_eq!(inherited.values.as_ref().unwrap()["COMMON_ONLY"], "shared");
    assert_eq!(inherited.values.as_ref().unwrap()["HOST_ONLY"], "host");
    assert!(!cleared.values.as_ref().unwrap().contains_key("COMMON_ONLY"));
    prepare(
        database.connection(),
        a,
        AdapterKind::Pi,
        &ModelSelection::RuntimeDefault,
        EnvironmentEdit {
            expected_revision: 4,
            json: json!({"EMPTY":"", "ANTHROPIC_API_KEY":"member-secret"}).to_string(),
            inherit_common: Some(true),
        },
    )
    .unwrap()
    .commit(database.connection())
    .unwrap();
    let merged = current_for_launch(database.connection(), a, AdapterKind::Pi).unwrap();
    assert_eq!(
        merged.values.as_ref().unwrap()["ANTHROPIC_API_KEY"],
        "member-secret"
    );
    assert_eq!(merged.values.as_ref().unwrap()["EMPTY"], "");
    assert_eq!(merged.values.as_ref().unwrap()["COMMON_ONLY"], "shared");
    prepare(
        database.connection(),
        a,
        AdapterKind::Pi,
        &ModelSelection::RuntimeDefault,
        EnvironmentEdit {
            expected_revision: 5,
            json: "{}".into(),
            inherit_common: Some(false),
        },
    )
    .unwrap()
    .commit(database.connection())
    .unwrap();
    assert!(
        !current_for_launch(database.connection(), a, AdapterKind::Pi)
            .unwrap()
            .values
            .as_ref()
            .unwrap()
            .contains_key("COMMON_ONLY")
    );
    assert_eq!(
        get(database.connection(), a, AdapterKind::Pi).unwrap()["inheritCommon"],
        false
    );
    // Simulate a pre-upgrade nonempty revision. A missing preference must not opt it in.
    database
        .connection()
        .execute(
            "DELETE FROM member_environment_inheritance WHERE member_id=?1 AND revision=5",
            [a],
        )
        .unwrap();
    assert!(
        !inheritance(
            database.connection(),
            a,
            AdapterKind::Pi,
            5,
            &read_version(database.connection(), a, AdapterKind::Pi, 5).unwrap()
        )
        .unwrap()
    );
    assert!(
        inheritance(
            database.connection(),
            a,
            AdapterKind::Pi,
            0,
            &Environment::new()
        )
        .unwrap()
    );
    let mut startup = crate::runtime_startup::RuntimeStartupConfiguration::default();
    crate::runtime_startup::apply_common(database.connection(), AdapterKind::Pi, &mut startup)
        .unwrap();
    assert!(
        startup
            .environment
            .iter()
            .any(|entry| entry.name == "COMMON_ONLY" && entry.value == "shared")
    );
    // Common deletion and an unrelated runtime do not affect member/private values.
    common::prepare(
        database.connection(),
        AdapterKind::Pi,
        common_edit(1, json!({})),
    )
    .unwrap()
    .commit(database.connection())
    .unwrap();
    assert!(
        common::current(database.connection(), AdapterKind::Pi)
            .unwrap()
            .is_empty()
    );
    // One damaged common record cannot prevent Host startup or independent members.
    database.connection().execute("UPDATE runtime_common_environment SET ciphertext=x'00' WHERE runtime_kind='pi' AND revision=2", []).unwrap();
    let startup = crate::runtime_startup::load_all(&database).unwrap();
    assert!(
        startup[&AdapterKind::Pi]
            .ensure_environment_available()
            .is_err()
    );
    assert!(
        !startup.contains_key(&AdapterKind::CodexCli)
            || startup[&AdapterKind::CodexCli]
                .ensure_environment_available()
                .is_ok()
    );
    assert!(current_for_launch(database.connection(), a, AdapterKind::Pi).is_ok());
    assert!(current_for_launch(database.connection(), MUWA_AGENT_ID, AdapterKind::Pi).is_err());
    let damaged = common::get(database.connection(), AdapterKind::Pi).unwrap();
    assert_eq!(damaged["revision"], 2);
    assert!(damaged["error"].is_string());
    assert!(
        common::prepare(
            database.connection(),
            AdapterKind::Pi,
            common_edit(1, json!({}))
        )
        .is_err()
    );
    common::prepare(
        database.connection(),
        AdapterKind::Pi,
        common_edit(2, json!({})),
    )
    .unwrap()
    .commit(database.connection())
    .unwrap();
    assert!(
        common::get(database.connection(), AdapterKind::Pi)
            .unwrap()
            .get("error")
            .is_none()
    );
    assert!(
        crate::runtime_startup::load_all(&database)
            .unwrap()
            .get(&AdapterKind::Pi)
            .is_none_or(|configuration| configuration.ensure_environment_available().is_ok())
    );
    assert_eq!(database.connection().query_row("SELECT ciphertext FROM runtime_common_environment WHERE runtime_kind='pi' AND revision=2", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(), vec![0]);
    database
        .connection()
        .execute(
            "UPDATE member_runtime_environment SET ciphertext=x'00' WHERE revision=6",
            [],
        )
        .unwrap();
    assert!(current_for_launch(database.connection(), a, AdapterKind::Pi).is_err());
    assert!(current_for_launch(database.connection(), MUWA_AGENT_ID, AdapterKind::Pi).is_ok());

    // Explicit writes report actual value/inheritance changes. Whitespace and
    // key order must not retire a Command Host; this is not a launch-time scan.
    for (revision, (text, inherit_common, changed)) in [
        ("{}", None, false),
        (r#"{"B":"2","A":"1"}"#, None, true),
        ("{\n  \"A\": \"1\", \"B\": \"2\"\n}", None, false),
        (r#"{"A":"1","B":"2"}"#, Some(true), false),
        (r#"{"A":"1","B":"2"}"#, Some(false), true),
        (r#"{"B":"2","A":"1"}"#, None, false),
        (r#"{"A":"changed","B":"2"}"#, None, true),
        ("{}", None, true),
        ("{ }", None, false),
    ]
    .into_iter()
    .enumerate()
    {
        let prepare_edit = || {
            prepare(
                database.connection(),
                a,
                AdapterKind::CommandCodeCli,
                &ModelSelection::RuntimeDefault,
                EnvironmentEdit {
                    expected_revision: revision as i64,
                    json: text.into(),
                    inherit_common,
                },
            )
            .unwrap()
        };
        let prepared = prepare_edit();
        assert_eq!(prepared.changed, changed, "revision {revision}");
        prepared.commit(database.connection()).unwrap();
        assert_eq!(
            prepare_edit().changed,
            changed,
            "replay keeps the original mutation fact"
        );
    }
    std::fs::remove_file(root.join("member-environment/key")).unwrap();
    assert!(current_for_launch(database.connection(), a, AdapterKind::Pi).is_err());
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn parallel_child_processes_inherit_their_cli_environment_without_changing_parent() {
    let (database, root) = database();
    let original = std::env::var_os("ANTHROPIC_API_KEY");
    let literal = "space ' quote \" $HOME ${HOME} ~ $(touch forbidden)\nnext";
    common::prepare(database.connection(), AdapterKind::Pi, common::Edit {
        expected_revision: 0,
        json: json!({"TIMEOUT_MS":"60000", "FEATURE_ENABLED":"true", "RETRY_COUNT":"3", "EMPTY":"common", "PADDED":"00123"}).to_string(),
    }).unwrap().commit(database.connection()).unwrap();
    let mut plans = Vec::new();
    for (member, key) in [
        (LUOKE_AGENT_ID, "fixture-key-a"),
        (MUWA_AGENT_ID, "fixture-key-b"),
    ] {
        let mut values = json!({"ANTHROPIC_API_KEY":key,"LITERAL":literal,"PATH":"/member/path/that/does/not/select/the/cli", "FEATURE_ENABLED":"false", "RETRY_COUNT":"0", "EMPTY":"", "LITERAL_MARKER":"<saved>"});
        if member == LUOKE_AGENT_ID {
            values["MEMBER_A_ONLY"] = json!("private-a");
        }
        prepare(
            database.connection(),
            member,
            AdapterKind::Pi,
            &ModelSelection::RuntimeDefault,
            EnvironmentEdit {
                expected_revision: 0,
                json: values.to_string(),
                inherit_common: Some(true),
            },
        )
        .unwrap()
        .commit(database.connection())
        .unwrap();
        assert_eq!(
            get(database.connection(), member, AdapterKind::Pi).unwrap()["environment"]["LITERAL_MARKER"],
            "<saved>"
        );
        plans.push(current_for_launch(database.connection(), member, AdapterKind::Pi).unwrap());
    }
    crate::runtime_discovery::with_launch_environment(Some(plans[0].clone()), async {
        let other =
            current_for_launch(database.connection(), MUWA_AGENT_ID, AdapterKind::Pi).unwrap();
        assert!(
            !other.values.as_ref().unwrap().contains_key("MEMBER_A_ONLY"),
            "new launches cannot inherit another CLI's task-local environment"
        );
    })
    .await;
    let child = |plan: LaunchEnvironment| async move {
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args([
            "-c",
            "printf '%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s' \"$ANTHROPIC_API_KEY\" \"$LITERAL\" \"$PATH\" \"$TIMEOUT_MS\" \"$FEATURE_ENABLED\" \"$RETRY_COUNT\" \"$EMPTY\" \"$PADDED\"",
        ]);
        plan.apply(&mut command).unwrap();
        use crate::managed_process::{
            ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
            ManagedWindowsArgvDialect,
        };
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "member-environment-fixture",
        )
        .unwrap();
        let mut child = ManagedProcess::spawn(spec).unwrap();
        let mut reader = child.take_stdout().unwrap();
        let mut bytes = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut reader, &mut bytes)
            .await
            .unwrap();
        let status = child.wait().await.unwrap();
        child.force_terminate_tree().unwrap();
        (status, bytes)
    };
    let (a, b) = tokio::join!(child(plans[0].clone()), child(plans[1].clone()));
    for (output, key) in [(a, "fixture-key-a"), (b, "fixture-key-b")] {
        assert!(output.0.success());
        let text = String::from_utf8(output.1).unwrap();
        let fields = text.split('\0').collect::<Vec<_>>();
        assert_eq!(
            fields,
            [
                key,
                literal,
                "/member/path/that/does/not/select/the/cli",
                "60000",
                "false",
                "0",
                "",
                "00123"
            ]
        );
    }
    save(database.connection(), LUOKE_AGENT_ID, 1,
        json!({"ANTHROPIC_API_KEY":"fixture-key-new","LITERAL":literal,"PATH":"/member/path/that/does/not/select/the/cli"})).unwrap();
    // Managed terminal/tool processes inherit their parent CLI's launch map,
    // even after configuration changes. Only the request overlay is applied.
    let mut command = tokio::process::Command::new("/bin/sh");
    plans[0].apply(&mut command).unwrap();
    use crate::managed_process::{
        ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    };
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeHost,
        ManagedStdinPolicy::Piped,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        "parent-cli",
    )
    .unwrap();
    let child_spec = spec
        .derive_runtime_one_shot_command(
            std::ffi::OsStr::new("/bin/sh"),
            vec![],
            root.clone(),
            BTreeMap::from([("REQUEST_ONLY".into(), "child".into())]),
            "tool-child",
        )
        .unwrap();
    assert_eq!(
        child_spec
            .environment()
            .get(std::ffi::OsStr::new("ANTHROPIC_API_KEY"))
            .unwrap(),
        "fixture-key-a"
    );
    assert_eq!(
        child_spec
            .environment()
            .get(std::ffi::OsStr::new("REQUEST_ONLY"))
            .unwrap(),
        "child"
    );
    drop(database);
    let database = Database::open(&root).unwrap();
    let plan = current_for_launch(database.connection(), LUOKE_AGENT_ID, AdapterKind::Pi).unwrap();
    let (status, bytes) = child(plan).await;
    assert!(status.success());
    assert_eq!(
        String::from_utf8(bytes).unwrap().split('\0').next(),
        Some("fixture-key-new")
    );
    assert_eq!(std::env::var_os("ANTHROPIC_API_KEY"), original);
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_archive_is_inert_read_only_and_acknowledgment_survives_path_edits() {
    let (database, root) = database();
    crate::db::downgrade_run_bootstrap_for_test(database.connection());
    database.connection().execute("INSERT INTO runtime_startup_setting(runtime_kind,revision,configuration_json,updated_at) VALUES('claude-code-cli',1,?1,datetime('now'))",
        [json!({"programPath":null,"environment":[{"name":"ANTHROPIC_API_KEY","value":"fixture-old-key"},{"name":"HTTP_PROXY","value":"http://legacy.example"}]}).to_string()]).unwrap();
    // Exercise the actual upgrade: schema, archive, old source and receipt are atomic.
    database.connection().execute_batch("DROP TABLE IF EXISTS conversation_runtime_environment; DROP TABLE member_runtime_environment;
        DROP TABLE IF EXISTS runtime_environment_plan; DROP TABLE runtime_environment_legacy;
        DELETE FROM schema_migration WHERE version>=191;
        UPDATE rovai_data_contract SET projection_schema_version=140 WHERE singleton=1;
        CREATE TRIGGER fail_member_environment_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=191
        BEGIN SELECT RAISE(ABORT,'fixture environment receipt failure'); END;").unwrap();
    drop(database);
    assert!(Database::open(&root).is_err());
    let raw = Connection::open(root.join("rovai.sqlite")).unwrap();
    assert_eq!(
        raw.query_row(
            "SELECT projection_schema_version FROM rovai_data_contract",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        140
    );
    assert_eq!(
        raw.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='runtime_environment_legacy'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert!(raw.query_row("SELECT configuration_json FROM runtime_startup_setting WHERE runtime_kind='claude-code-cli'", [], |r| r.get::<_, String>(0)).unwrap().contains("fixture-old-key"));
    raw.execute_batch("DROP TRIGGER fail_member_environment_receipt;")
        .unwrap();
    drop(raw);
    let raw = Connection::open(root.join("rovai.sqlite")).unwrap();
    raw.execute_batch("CREATE TRIGGER fail_session_environment_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=192
        BEGIN SELECT RAISE(ABORT,'fixture session receipt failure'); END;").unwrap();
    drop(raw);
    assert!(Database::open(&root).is_err());
    let raw = Connection::open(root.join("rovai.sqlite")).unwrap();
    assert_eq!(
        raw.query_row(
            "SELECT projection_schema_version FROM rovai_data_contract",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        141
    );
    assert_eq!(
        raw.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='conversation_runtime_environment'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        legacy_get(&raw, AdapterKind::ClaudeCodeCli).unwrap()["ANTHROPIC_API_KEY"],
        "fixture-old-key"
    );
    raw.execute_batch("DROP TRIGGER fail_session_environment_receipt;")
        .unwrap();
    drop(raw);
    let raw = Connection::open(root.join("rovai.sqlite")).unwrap();
    raw.execute_batch("CREATE TRIGGER fail_retirement_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=193
        BEGIN SELECT RAISE(ABORT,'fixture retirement receipt failure'); END;").unwrap();
    drop(raw);
    assert!(Database::open(&root).is_err());
    let raw = Connection::open(root.join("rovai.sqlite")).unwrap();
    assert_eq!(
        raw.query_row(
            "SELECT projection_schema_version FROM rovai_data_contract",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        142
    );
    assert_eq!(raw.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('conversation_runtime_environment','runtime_environment_plan')", [], |r| r.get::<_,i64>(0)).unwrap(),2);
    raw.execute_batch("DROP TRIGGER fail_retirement_receipt;")
        .unwrap();
    drop(raw);
    let mut database = Database::open(&root).unwrap();
    let identity = legacy_list(database.connection()).unwrap()[0]["identity"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        legacy_get(database.connection(), AdapterKind::ClaudeCodeCli).unwrap()["ANTHROPIC_API_KEY"],
        "fixture-old-key"
    );
    legacy_acknowledge(database.connection(), AdapterKind::ClaudeCodeCli, &identity).unwrap();
    assert!(
        crate::runtime_startup::load(&database, AdapterKind::ClaudeCodeCli)
            .unwrap()
            .configuration
            .environment
            .is_empty()
    );
    crate::runtime_startup::save(
        &mut database,
        AdapterKind::ClaudeCodeCli,
        1,
        RuntimeStartupConfiguration {
            program_path: Some(root.join("claude").to_string_lossy().into()),
            ..Default::default()
        },
        2,
    )
    .unwrap();
    assert_eq!(
        legacy_list(database.connection()).unwrap()[0]["handled"],
        true
    );
    assert_eq!(
        legacy_get(database.connection(), AdapterKind::ClaudeCodeCli).unwrap()["ANTHROPIC_API_KEY"],
        "fixture-old-key"
    );
    drop(database);
    let database = Database::open(&root).unwrap();
    assert_eq!(
        legacy_list(database.connection()).unwrap()[0]["handled"],
        true
    );
    assert!(
        legacy_acknowledge(database.connection(), AdapterKind::ClaudeCodeCli, "stale").is_err()
    );
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}
