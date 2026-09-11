use super::*;
use std::{fs, os::unix::fs::PermissionsExt};

// Owns the process/environment boundary: each case runs this test in a fresh
// process so no test mutates global env or reads the developer's credentials.
// The retired Grok config-copy test has no production contract after this change.
#[tokio::test]
async fn acp_probes_keep_native_homes_without_prompting() {
    const ROOT_ENV: &str = "ROVAI_TEST_ACP_PROBE_ROOT";
    const CASE_ENV: &str = "ROVAI_TEST_ACP_PROBE_CASE";
    const HOME_KEYS: [&str; 5] = [
        "HOME",
        "USERPROFILE",
        "GROK_HOME",
        "KIMI_CODE_HOME",
        "KIRO_HOME",
    ];
    if let Ok(root) = env::var(ROOT_ENV) {
        let root = PathBuf::from(root);
        let case = env::var(CASE_ENV).unwrap();
        let kind = match case.as_str() {
            "grok-byok" | "grok-account" => AdapterKind::GrokBuild,
            "kimi" => AdapterKind::KimiCodeCli,
            "kiro" => AdapterKind::KiroCli,
            _ => panic!("unknown fixture case"),
        };
        let result = run_acp_probe(
            &root.join("runtime"),
            kind,
            true,
            RuntimeLaunchPurpose::AvailabilityCheck,
        )
        .await;
        let rejected = env::var("ROVAI_TEST_ACP_PROBE_REJECT").unwrap() == "1";
        assert_eq!(result.is_err(), rejected, "{case}: {result:?}");
        let observed = fs::read_to_string(root.join("environment")).unwrap();
        let expected = HOME_KEYS
            .iter()
            .map(|key| env::var(key).unwrap_or_else(|_| "__UNSET__".to_string()))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        assert_eq!(
            observed, expected,
            "probe must preserve all native Home variables"
        );
        let cwd = fs::read_to_string(root.join("cwd")).unwrap();
        let cwd = Path::new(cwd.trim());
        assert!(
            cwd.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("rovai-acp-probe-")
        );
        assert!(
            !cwd.exists(),
            "probe-owned cwd must be removed on success and error"
        );
        assert_eq!(
            fs::read_to_string(root.join("home/native-state")).unwrap(),
            "keep native state"
        );
        let requests = fs::read_to_string(root.join("requests"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        let methods = requests
            .iter()
            .map(|request| request["method"].as_str().unwrap())
            .collect::<Vec<_>>();
        let mut expected_methods = vec!["initialize"];
        if kind == AdapterKind::GrokBuild {
            expected_methods.push("authenticate");
            assert_eq!(
                requests[1]["params"]["methodId"],
                if case == "grok-byok" {
                    "xai.api_key"
                } else {
                    "cached_token"
                }
            );
            assert_eq!(requests[1]["params"]["_meta"]["headless"], true);
        }
        expected_methods.push("session/new");
        if !rejected {
            if kind == AdapterKind::GrokBuild {
                expected_methods.push("session/resume");
            }
            if matches!(kind, AdapterKind::GrokBuild | AdapterKind::KiroCli) {
                expected_methods.push("session/set_model");
            }
        }
        assert_eq!(
            methods, expected_methods,
            "no prompt, compact, title or tool request is allowed"
        );
        if kind == AdapterKind::KiroCli {
            let agent: Value =
                serde_json::from_str(&fs::read_to_string(root.join("agent.json")).unwrap())
                    .unwrap();
            assert_eq!(agent["name"], KIRO_ADDITIVE_AGENT_NAME);
            assert_eq!(agent["includeMcpJson"], true);
            assert_eq!(agent["mcpServers"], json!({}));
            assert_eq!(
                fs::read_to_string(root.join("argv")).unwrap(),
                "acp\n--agent\nrovai\n"
            );
        }
        return;
    }

    for case in ["grok-byok", "grok-account", "kimi", "kiro"] {
        for custom_home in [false, true] {
            for rejected in [false, true] {
                let root = env::temp_dir()
                    .join(format!("rovai-native-home-test-{}", uuid::Uuid::new_v4()));
                let _cleanup = ProbeRootCleanup(root.clone());
                let home = root.join("home");
                fs::create_dir_all(&home).unwrap();
                fs::write(home.join("native-state"), "keep native state").unwrap();
                let grok_home = if custom_home {
                    root.join("custom grok 中文")
                } else {
                    home.join(".grok")
                };
                fs::create_dir_all(&grok_home).unwrap();
                let grok_config = if case == "grok-byok" {
                    "[models]\ndefault = \"fixture\"\n[model.fixture]\nmodel = \"fixture\"\nenv_key = \"FIXTURE_GROK_API_KEY\"\n"
                } else {
                    "[models]\ndefault = \"grok-build\"\n"
                };
                fs::write(grok_home.join("config.toml"), grok_config).unwrap();
                let env_file = grok_home.join(".env");
                fs::write(
                    &env_file,
                    if case == "grok-byok" {
                        "FIXTURE_GROK_API_KEY=test-only-key\n"
                    } else {
                        ""
                    },
                )
                .unwrap();
                fs::set_permissions(&env_file, fs::Permissions::from_mode(0o600)).unwrap();
                let kimi_config = root.join("kimi-code.env");
                fs::write(&kimi_config, "KIMI_MODEL_NAME=fixture\nKIMI_MODEL_PROVIDER_TYPE=anthropic\nKIMI_MODEL_API_KEY=test-only-key\nKIMI_MODEL_BASE_URL=https://fixture.invalid\n").unwrap();
                fs::set_permissions(&kimi_config, fs::Permissions::from_mode(0o600)).unwrap();
                let runtime = root.join("runtime");
                fs::write(&runtime, r#"#!/bin/sh
log="$ROVAI_TEST_ACP_PROBE_ROOT"
printf '%s\n' "$HOME" "${USERPROFILE-__UNSET__}" "${GROK_HOME-__UNSET__}" "${KIMI_CODE_HOME-__UNSET__}" "${KIRO_HOME-__UNSET__}" > "$log/environment"
printf '%s\n' "$PWD" > "$log/cwd"
printf '%s\n' "$@" > "$log/argv"
case "$ROVAI_TEST_ACP_PROBE_CASE" in
  grok-byok) test "$FIXTURE_GROK_API_KEY" = test-only-key || exit 81 ;;
  kimi) test "$KIMI_MODEL_API_KEY" = test-only-key || exit 82 ;;
  kiro) cat .kiro/agents/rovai.json > "$log/agent.json" || exit 83 ;;
esac
id=0
while IFS= read -r request; do
  printf '%s\n' "$request" >> "$log/requests"
  id=$((id + 1))
  case "$request" in
    *'"method":"initialize"'*) result='{"protocolVersion":1,"agentCapabilities":{"sessionCapabilities":{"resume":{}}},"authMethods":[{"id":"cached_token"},{"id":"xai.api_key"}],"_meta":{"defaultAuthMethodId":"cached_token"}}' ;;
    *'"method":"authenticate"'*) result='{}' ;;
    *'"method":"session/new"'*)
      if [ "$ROVAI_TEST_ACP_PROBE_REJECT" = 1 ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"fixture rejected Session"}}\n' "$id"
        continue
      fi
      result='{"sessionId":"fixture-session","models":{"currentModelId":"fixture","availableModels":[{"modelId":"fixture","name":"Fixture"}]}}' ;;
    *'"method":"session/resume"'*) result='{"sessionId":"fixture-session"}' ;;
    *'"method":"session/set_model"'*) result='null' ;;
    *) exit 84 ;;
  esac
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
"#).unwrap();
                fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
                let mut command = Command::new(env::current_exe().unwrap());
                command
                        .args([
                            "--exact",
                            "health::native_home_probe_tests::acp_probes_keep_native_homes_without_prompting",
                            "--nocapture",
                        ])
                        .env_clear()
                        .env("PATH", "/usr/bin:/bin")
                        .env("HOME", &home)
                        .env("USERPROFILE", root.join("profile 中文"))
                        .env(ROOT_ENV, &root)
                        .env(CASE_ENV, case)
                        .env(
                            "ROVAI_TEST_ACP_PROBE_REJECT",
                            if rejected { "1" } else { "0" },
                        )
                        .env("ROVAI_KIMI_CONFIG", &kimi_config)
                        .kill_on_drop(true);
                if custom_home {
                    command
                        .env("GROK_HOME", &grok_home)
                        .env("KIMI_CODE_HOME", root.join("custom kimi 中文"))
                        .env("KIRO_HOME", root.join("custom kiro 中文"));
                }
                let output = timeout(Duration::from_secs(15), command.output())
                    .await
                    .expect("isolated probe fixture must finish within its bound")
                    .unwrap();
                assert!(
                    output.status.success(),
                    "{case}, custom_home={custom_home}, rejected={rejected}: {}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                assert_eq!(
                    fs::read_to_string(grok_home.join("config.toml")).unwrap(),
                    grok_config
                );
                assert!(
                    env_file.is_file() && kimi_config.is_file(),
                    "native configuration must survive probe cleanup"
                );
            }
        }
    }
}
