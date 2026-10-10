use super::*;
use crate::{
    agent_identity::{LUOKE_AGENT_ID, MUWA_AGENT_ID},
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
fn save(
    connection: &Connection,
    member: &str,
    revision: i64,
    values: Value,
    confirm: bool,
) -> Result<()> {
    prepare(
        connection,
        member,
        AdapterKind::Pi,
        &ModelSelection::RuntimeDefault,
        EnvironmentEdit {
            expected_revision: revision,
            json: values.to_string(),
            confirm_target_change: confirm,
        },
    )?
    .commit(connection)
}

#[test]
fn private_versions_preserve_credentials_and_freeze_retries_across_reopen() {
    let (mut database, root) = database();
    let connection = database.connection();
    let a = LUOKE_AGENT_ID;
    let b = MUWA_AGENT_ID;
    save(connection,a,0,json!({"ANTHROPIC_BASE_URL":"https://a.example","ANTHROPIC_API_KEY":"fixture-private-a","CLEARED_TOKEN":"","LITERAL":" '$HOME' ${NOT_EXPANDED}\n~ $(touch forbidden)"}),false).unwrap();
    assert_eq!(
        get(connection, a, AdapterKind::Pi, false).unwrap()["environment"]["CLEARED_TOKEN"],
        ""
    );
    assert_eq!(
        get(connection, a, AdapterKind::Pi, false).unwrap()["environment"]["ANTHROPIC_API_KEY"],
        SAVED
    );
    assert!(
        !format!(
            "{:?}",
            prepare(
                connection,
                a,
                AdapterKind::Pi,
                &ModelSelection::RuntimeDefault,
                EnvironmentEdit {
                    expected_revision: 1,
                    json: "{}".into(),
                    confirm_target_change: false
                }
            )
            .unwrap()
            .receipt
        )
        .contains("fixture-private-a")
    );
    let raw: Vec<u8> = connection
        .query_row(
            "SELECT ciphertext FROM member_runtime_environment LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("fixture-private-a"));
    assert_eq!(
        get(connection, b, AdapterKind::Pi, false).unwrap()["revision"],
        0
    );
    assert!(save(connection, a, 0, json!({}), false).is_err());
    assert!(
        save(
            connection,
            a,
            1,
            json!({"ANTHROPIC_BASE_URL":"https://b.example","ANTHROPIC_API_KEY":SAVED}),
            false
        )
        .is_err()
    );
    let mut admitted = runtime(AdapterKind::Pi);
    freeze(connection, a, &mut admitted).unwrap();
    let snapshot = serde_json::to_string(&admitted).unwrap();
    assert!(!snapshot.contains("fixture-private-a") && !snapshot.contains("a.example"));
    save(
        connection,
        a,
        1,
        json!({"ANTHROPIC_BASE_URL":"https://b.example","ANTHROPIC_API_KEY":SAVED}),
        true,
    )
    .unwrap();
    let mut changed = runtime(AdapterKind::Pi);
    freeze(connection, a, &mut changed).unwrap();
    assert_ne!(admitted.host_config_digest, changed.host_config_digest);
    assert_ne!(
        admitted.binding_compatibility_digest,
        changed.binding_compatibility_digest
    );
    save(
        connection,
        b,
        0,
        json!({"ANTHROPIC_BASE_URL":"https://b.example","ANTHROPIC_API_KEY":"fixture-private-a"}),
        false,
    )
    .unwrap();
    let mut equal = runtime(AdapterKind::Pi);
    freeze(connection, b, &mut equal).unwrap();
    assert_eq!(
        equal.host_config_digest, changed.host_config_digest,
        "member identity/revision must not narrow existing warm reuse"
    );
    // The overlay and profile mutation share the caller's transaction.
    {
        let tx = database.connection_mut().transaction().unwrap();
        save(&tx, a, 2, json!({"X":"rolled-back"}), false).unwrap();
    }
    assert_eq!(
        latest(database.connection(), a, AdapterKind::Pi).unwrap(),
        2
    );
    drop(database);
    let database = Database::open(&root).unwrap();
    let mut retry: FrozenAgentRuntimeConfig = serde_json::from_str(&snapshot).unwrap();
    retry
        .environment
        .as_mut()
        .unwrap()
        .hydrate(database.connection())
        .unwrap();
    let env = retry.environment.as_ref().unwrap();
    assert_eq!(
        env.values.as_ref().unwrap()["ANTHROPIC_BASE_URL"],
        "https://a.example"
    );
    assert!(
        !env.redactor()
            .text("error: fixture-private-a")
            .contains("fixture-private-a")
    );
    assert!(!format!("{retry:?}").contains("fixture-private-a"));
    save(database.connection(), a, 2, json!({}), false).unwrap();
    assert_eq!(
        get(database.connection(), a, AdapterKind::Pi, false).unwrap()["environment"],
        json!({})
    );
    assert_eq!(
        get(database.connection(), a, AdapterKind::ClaudeCodeCli, false).unwrap()["revision"],
        0
    );
    let key_path = root.join("member-environment/key");
    std::fs::remove_file(key_path).unwrap();
    assert!(
        retry
            .environment
            .as_mut()
            .unwrap()
            .hydrate(database.connection())
            .is_err(),
        "never fall back to Host credentials when private state is missing"
    );
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn parallel_child_processes_get_literal_frozen_values_without_changing_parent() {
    let (database, root) = database();
    let original = std::env::var_os("ANTHROPIC_API_KEY");
    let literal = "space ' quote \" $HOME ${HOME} ~ $(touch forbidden)\nnext";
    let mut plans = Vec::new();
    for (member, key) in [
        (LUOKE_AGENT_ID, "fixture-key-a"),
        (MUWA_AGENT_ID, "fixture-key-b"),
    ] {
        let mut values = json!({"ANTHROPIC_API_KEY":key,"LITERAL":literal,"PATH":"/member/path/that/does/not/select/the/cli"});
        if member == LUOKE_AGENT_ID {
            values["MEMBER_A_ONLY"] = json!("private-a");
        }
        save(database.connection(), member, 0, values, false).unwrap();
        let mut frozen = runtime(AdapterKind::Pi);
        freeze(database.connection(), member, &mut frozen).unwrap();
        let plan = frozen.environment.as_mut().unwrap();
        plan.hydrate(database.connection()).unwrap();
        plans.push(plan.clone());
    }
    crate::runtime_discovery::with_frozen_environment(Some(plans[0].clone()), async {
        let mut other = runtime(AdapterKind::Pi);
        freeze(database.connection(), MUWA_AGENT_ID, &mut other).unwrap();
        let other = other.environment.as_mut().unwrap();
        other.hydrate(database.connection()).unwrap();
        assert_eq!(other.identity, plans[1].identity);
        assert!(
            !other.values.as_ref().unwrap().contains_key("MEMBER_A_ONLY"),
            "admission cannot inherit a different Run's task-local environment"
        );
    })
    .await;
    let child = |plan: FrozenEnvironment| async move {
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args([
            "-c",
            "printf '%s\\0%s\\0%s' \"$ANTHROPIC_API_KEY\" \"$LITERAL\" \"$PATH\"",
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
            [key, literal, "/member/path/that/does/not/select/the/cli"]
        );
    }
    assert_eq!(std::env::var_os("ANTHROPIC_API_KEY"), original);
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_archive_is_inert_read_only_and_acknowledgment_survives_path_edits() {
    let (database, root) = database();
    database.connection().execute("INSERT INTO runtime_startup_setting(runtime_kind,revision,configuration_json,updated_at) VALUES('claude-code-cli',1,?1,datetime('now'))",
        [json!({"programPath":null,"environment":[{"name":"ANTHROPIC_API_KEY","value":"fixture-old-key"},{"name":"HTTP_PROXY","value":"http://legacy.example"}]}).to_string()]).unwrap();
    // Exercise the actual upgrade: schema, archive, old source and receipt are atomic.
    database.connection().execute_batch("DROP TABLE member_runtime_environment;
        DROP TABLE runtime_environment_plan; DROP TABLE runtime_environment_legacy;
        DELETE FROM schema_migration WHERE version=191;
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
    let mut database = Database::open(&root).unwrap();
    let identity = legacy_list(database.connection()).unwrap()[0]["identity"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        legacy_get(database.connection(), AdapterKind::ClaudeCodeCli, false).unwrap()["ANTHROPIC_API_KEY"],
        SAVED
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
        legacy_get(database.connection(), AdapterKind::ClaudeCodeCli, true).unwrap()["ANTHROPIC_API_KEY"],
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
