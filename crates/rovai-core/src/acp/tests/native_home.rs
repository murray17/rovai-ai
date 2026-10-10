use super::*;

#[tokio::test]
async fn kimi_stopped_host_inherits_native_home_and_exactly_resumes() {
    const FIXTURE_ENV: &str = "ROVAI_TEST_KIMI_NATIVE_CONFIG_ROOT";
    if std::env::var_os(FIXTURE_ENV).is_none() {
        // Exercise the production launch path with an obsolete overlay,
        // without ever reading the developer's credentials or changing env
        // in this shared test process.
        let fixture =
            std::env::temp_dir().join(format!("rovai-kimi-native-config-{}", uuid::Uuid::new_v4()));
        let home = fixture.join("home");
        let kimi_home = fixture.join("native kimi 中文");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&kimi_home).unwrap();
        let config = "default_model = \"native-fixture\"\n";
        std::fs::write(kimi_home.join("config.toml"), config).unwrap();
        let legacy = fixture.join("kimi-code.env");
        std::fs::write(&legacy, "KIMI_MODEL_NAME=obsolete\nKIMI_MODEL_PROVIDER_TYPE=anthropic\nKIMI_MODEL_API_KEY=test-only-key\nKIMI_MODEL_BASE_URL=https://obsolete.invalid\n").unwrap();
        std::fs::set_permissions(&legacy, std::fs::Permissions::from_mode(0o600)).unwrap();
        let output = tokio::time::timeout(
                Duration::from_secs(30),
                Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "acp::tests::native_home::kimi_stopped_host_inherits_native_home_and_exactly_resumes",
                        "--nocapture",
                    ])
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin")
                    .env("HOME", &home)
                    .env("KIMI_CODE_HOME", &kimi_home)
                    .env("ROVAI_KIMI_CONFIG", &legacy)
                    .env(FIXTURE_ENV, &fixture)
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .expect("isolated Kimi launch must finish within its bound")
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            std::fs::read_to_string(kimi_home.join("config.toml")).unwrap(),
            config
        );
        assert!(legacy.is_file());
        std::fs::remove_dir_all(fixture).unwrap();
        return;
    }
    let root =
        std::env::temp_dir().join(format!("rovai-kimi-cold-resume-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let executable = root.join("kimi");
    let protocol_log = root.join("protocol.jsonl");
    let invocation_log = root.join("invocations");
    let home_log = root.join("homes");
    let native_state_home = root.join("user-kimi-home");
    make_executable(
        &executable,
        &format!(
            r#"#!/bin/sh
printf '%s\n' "$*" >> '{}'
printf '%s\n' "${{KIMI_CODE_HOME-__UNSET__}}" >> '{}'
native_state_home='{}'
test -z "${{KIMI_MODEL_NAME+x}}${{KIMI_MODEL_PROVIDER_TYPE+x}}${{KIMI_MODEL_API_KEY+x}}${{KIMI_MODEL_BASE_URL+x}}${{KIMI_MODEL_MAX_CONTEXT_SIZE+x}}${{KIMI_MODEL_CAPABILITIES+x}}" || exit 4
test -f "$KIMI_CODE_HOME/config.toml" || exit 5
mkdir -p "$native_state_home"
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}}}}}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> '{}'
case "$session" in
  *'"method":"session/new"'*)
    printf '%s\n' 'session-kimi' > "$native_state_home/session-id"
    ;;
  *'"method":"session/resume"'*)
    test "$(cat "$native_state_home/session-id")" = 'session-kimi' || exit 2
    ;;
  *) exit 3 ;;
esac
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-kimi","configOptions":[{{"id":"model","currentValue":"runtime_default","options":[{{"value":"runtime_default","name":"Runtime Default"}}]}},{{"id":"mode","currentValue":"default","options":[{{"value":"default","name":"Default"}}]}}]}}}}'
IFS= read -r mode || exit 1
printf '%s\n' "$mode" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":null}}'
while IFS= read -r ignored; do :; done
"#,
            invocation_log.display(),
            home_log.display(),
            native_state_home.display(),
            protocol_log.display(),
            protocol_log.display(),
            protocol_log.display(),
        ),
    );
    let builtin_tools = exact_builtin_tools(&root);
    let frozen = frozen_kimi_runtime(&executable);
    let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
    let attachment_root = exact_attachment_root(&root);
    let external_mcp_servers = BTreeMap::from([(
        "rovai-test".to_string(),
        McpServerDefinition::Stdio {
            command: "/usr/bin/printf".to_string(),
            args: vec!["mcp".to_string()],
            cwd: Some(root.to_string_lossy().to_string()),
            env: BTreeMap::new(),
        },
    )]);
    let (incoming, _receiver) = mpsc::unbounded_channel();
    let fleet = Arc::new(AgentRuntimeFleetManager::new(
        AgentRuntimeFleetConfig::default(),
    ));
    let private_runtime_dir = root.join("private");
    let adapter = AcpCliRuntimeAdapter::new(
        AdapterKind::KimiCodeCli,
        incoming,
        private_runtime_dir.clone(),
        fleet.clone(),
        CompactionDetectorPolicy::Disabled,
    )
    .unwrap();

    let first = adapter
        .ensure_agent_run_runtime(
            "agent-run-one",
            1,
            "camp-one",
            "agent-one",
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            &builtin_tools,
            &external_mcp_servers,
            "sha256:mcp",
            &attachment_root,
            "sha256:compatibility",
        )
        .await
        .unwrap();
    let first_host = first.host_instance_id().to_string();
    let session_id = first
        .start_or_resume_session(
            None,
            AcpSessionCapabilities {
                can_resume: true,
                can_load_history: true,
            },
            "runtime_default",
            "runtime_default",
            &json!({}),
            &external_mcp_servers,
        )
        .await
        .unwrap();
    assert_eq!(session_id, "session-kimi");
    adapter.forget_agent_run("agent-run-one", 1).await;

    assert_eq!(
        std::fs::read_to_string(native_state_home.join("session-id"))
            .unwrap()
            .trim(),
        session_id
    );

    let second = adapter
        .ensure_agent_run_runtime(
            "agent-run-two",
            1,
            "camp-one",
            "agent-one",
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            &builtin_tools,
            &external_mcp_servers,
            "sha256:mcp",
            &attachment_root,
            "sha256:compatibility",
        )
        .await
        .unwrap();
    assert_ne!(second.host_instance_id(), first_host);
    let successor_session = second
        .start_or_resume_session(
            Some(&session_id),
            AcpSessionCapabilities {
                can_resume: true,
                can_load_history: true,
            },
            "runtime_default",
            "runtime_default",
            &json!({}),
            &external_mcp_servers,
        )
        .await
        .unwrap();
    assert_eq!(successor_session, session_id);
    adapter.complete_agent_run("agent-run-two", 1).await;
    fleet.shutdown_all().await;

    let invocations = std::fs::read_to_string(&invocation_log).unwrap();
    assert_eq!(invocations.lines().count(), 2);
    let homes = std::fs::read_to_string(&home_log).unwrap();
    let homes = homes.lines().collect::<Vec<_>>();
    let inherited_kimi_home = std::env::var_os("KIMI_CODE_HOME")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "__UNSET__".to_string());
    assert_eq!(homes.len(), 2);
    assert_eq!(homes, vec![inherited_kimi_home.as_str(); 2]);
    let protocol = std::fs::read_to_string(&protocol_log).unwrap();
    assert_eq!(protocol.matches("\"method\":\"session/new\"").count(), 1);
    assert_eq!(protocol.matches("\"method\":\"session/resume\"").count(), 1);
    assert_eq!(protocol.matches("\"name\":\"rovai-test\"").count(), 2);
    assert!(!protocol.contains("\"method\":\"session/load\""));
    assert!(native_state_home.exists());
    assert!(!private_runtime_dir.join("home").exists());
    std::fs::remove_dir_all(root).unwrap();
}
