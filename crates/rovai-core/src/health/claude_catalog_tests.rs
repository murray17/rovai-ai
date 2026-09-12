use super::*;
use std::{fs, os::unix::fs::PermissionsExt};

// This owner crosses the actual managed-process/NDJSON boundary. Parser input
// matrices belong to agent_runtime_adapter's existing Claude catalog test.
#[tokio::test]
async fn claude_catalog_initializes_without_user_input_and_reaps_on_failure() {
    let root = env::temp_dir().join(format!("rovai-claude-catalog-{}", uuid::Uuid::new_v4()));
    let _cleanup = ProbeRootCleanup(root.clone());
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("claude-fixture");
    fs::write(&executable, r#"#!/bin/sh
root=$(dirname "$0")
printf '%s\n' "$@" > "$root/argv"
printf '%s\n' "$PWD" > "$root/cwd"
printf '%s\n' "${HOME-__UNSET__}" "${CLAUDE_CONFIG_DIR-__UNSET__}" "${ANTHROPIC_MODEL-__UNSET__}" > "$root/environment"
printf '%s\n' "$$" > "$root/pid"
IFS= read -r request || exit 1
printf '%s\n' "$request" > "$root/requests"
id=$(printf '%s' "$request" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '%s\n' '{"type":"system","subtype":"init","model":"current-is-not-the-catalog"}'
printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"unrelated","response":{"models":[{"value":"wrong-correlation"}]}}}'
case "$(cat "$root/case")" in
  success) printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":{\"models\":[{\"value\":\"provider/new-alias[extended]\",\"displayName\":\"Native model\",\"description\":\"Native description\"}]}}}" ;;
  missing) printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":{\"model\":\"only-current\"}}}" ;;
  rejected) printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"$id\",\"error\":\"unsupported initialize\"}}" ;;
  interaction) printf '%s\n' '{"type":"control_request","request_id":"permission","request":{"subtype":"can_use_tool"}}' ;;
  malformed) printf '%s\n' 'not json' ;;
  eof) exit 0 ;;
  timeout) sleep 60 & wait ;;
esac
while IFS= read -r request; do printf '%s\n' "$request" >> "$root/requests"; done
"#).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    for case in [
        "success",
        "missing",
        "rejected",
        "interaction",
        "malformed",
        "eof",
        "timeout",
    ] {
        fs::write(root.join("case"), case).unwrap();
        // Normal protocol cases must not accidentally test OS scheduling under
        // parallel migration/process load. Keep the intentional deadline case
        // short, and require every other failure to reach its actual protocol
        // branch instead of accepting a timeout as an equivalent error.
        let deadline = Duration::from_secs(if case == "timeout" { 1 } else { 10 });
        let result = claude_code_model_catalog(&executable, deadline).await;
        if case == "success" {
            let models = result.unwrap();
            assert_eq!(models.len(), 2);
            assert_eq!(models[1].id, "provider/new-alias[extended]");
            assert_eq!(models[1].display_name, "Native model");
            assert_eq!(models[1].description.as_deref(), Some("Native description"));
        } else {
            let expected = match case {
                "missing" => "initialize did not return a non-empty models array",
                "rejected" => "Claude Code initialize rejected",
                "interaction" => "initialization requires interactive control",
                "malformed" => "invalid initialization frame",
                "eof" => "exited before returning the initialization model catalog",
                "timeout" => "model initialization timed out",
                _ => unreachable!(),
            };
            let error = result.expect_err("must never synthesize a model catalog");
            assert!(format!("{error:#}").contains(expected), "{case}: {error:#}");
        }
        let requests: Vec<Value> = fs::read_to_string(root.join("requests"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(
            requests.len(),
            1,
            "initialization must never submit user input or control approval"
        );
        assert_eq!(requests[0]["type"], "control_request");
        assert_eq!(requests[0]["request"], json!({"subtype":"initialize"}));
        assert_eq!(
            fs::read_to_string(root.join("argv")).unwrap(),
            "--print\n--input-format\nstream-json\n--output-format\nstream-json\n--verbose\n--no-session-persistence\n"
        );
        let cwd = fs::read_to_string(root.join("cwd")).unwrap();
        assert_eq!(
            Path::new(cwd.trim()).canonicalize().unwrap(),
            env::current_dir().unwrap().canonicalize().unwrap()
        );
        let expected = ["HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_MODEL"]
            .iter()
            .map(|key| env::var(key).unwrap_or_else(|_| "__UNSET__".to_string()))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        assert_eq!(
            fs::read_to_string(root.join("environment")).unwrap(),
            expected
        );
        let pid: i32 = fs::read_to_string(root.join("pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "managed probe must be reaped for {case}"
        );
    }
}

#[tokio::test]
#[ignore = "manual installed Claude Code no-Prompt catalog smoke; inherits native authentication"]
async fn claude_catalog_real_runtime_smoke() {
    let executable =
        find_adapter(AdapterKind::ClaudeCodeCli).expect("Claude Code must be installed");
    let probe = claude_code_capability_probe_at(&executable).await;
    assert_eq!(
        probe.result.status,
        AgentRuntimeProbeStatus::Ready,
        "{:?}",
        probe.result.failure
    );
    assert!(
        probe
            .result
            .capabilities
            .iter()
            .any(|value| value == CLAUDE_MODEL_CATALOG_CAPABILITY)
    );
    assert!(probe.models.len() > 1);
    println!(
        "Claude Code {:?}: {}",
        probe.result.reported_version,
        serde_json::to_string(&probe.models).unwrap()
    );
}
