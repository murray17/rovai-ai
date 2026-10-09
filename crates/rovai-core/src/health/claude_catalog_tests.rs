use super::*;
use std::{fs, os::unix::fs::PermissionsExt};

// This owner crosses the actual managed-process/NDJSON boundary. Parser input
// matrices belong to agent_runtime_adapter's existing Claude catalog test.
#[tokio::test]
async fn claude_catalog_prefers_list_models_and_falls_back_only_when_unsupported() {
    let root = env::temp_dir().join(format!("rovai-claude-catalog-{}", uuid::Uuid::new_v4()));
    let _cleanup = ProbeRootCleanup(root.clone());
    fs::create_dir_all(&root).unwrap();
    let executable = root.join("claude-fixture");
    fs::write(&executable, r#"#!/bin/sh
root=$(/usr/bin/dirname "$0")
printf '%s\n' "$@" > "$root/argv"
printf '%s\n' "$PWD" > "$root/cwd"
printf '%s\n' "${HOME-__UNSET__}" "${CLAUDE_CONFIG_DIR-__UNSET__}" "${ANTHROPIC_MODEL-__UNSET__}" > "$root/environment"
printf '%s\n' "$$" > "$root/pid"
IFS= read -r request || exit 1
printf '%s\n' "$request" > "$root/requests"
id=$(printf '%s' "$request" | /usr/bin/sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '%s\n' '{"type":"system","subtype":"init","model":"current-is-not-the-catalog"}'
printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"unrelated","response":{"models":[{"value":"wrong-correlation"}]}}}'
printf '%s\n' '{"type":"control_response","response":{"subtype":"error","request_id":"unrelated","error":"Unsupported control request subtype: list_models"}}'
(sleep 60) &
descendant=$!
printf '%s\n' "$descendant" > "$root/descendant"
scenario=$(/bin/cat "$root/case")
case "$scenario" in
  fallback|fallback_large|fallback_rejected|fallback_timeout)
    printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"$id\",\"error\":\"Unsupported control request subtype: list_models\"}}"
    IFS= read -r request || exit 1
    printf '%s\n' "$request" >> "$root/requests"
    id=$(printf '%s' "$request" | /usr/bin/sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p') ;;
esac
case "$scenario" in
  success|fallback|large|fallback_large)
    if [ "$scenario" = large ] || [ "$scenario" = fallback_large ]; then
      printf '{"type":"system","padding":"'; head -c 5242880 /dev/zero | tr '\000' x; printf '"}\n'
      head -c 131072 /dev/zero >&2
    fi
    printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{"models":[{"value":"provider/new-alias[extended]","displayName":"Native model","description":"Native description"}],"commands":"' "$id"
    if [ "$scenario" = large ] || [ "$scenario" = fallback_large ]; then head -c 5242880 /dev/zero | tr '\000' x; fi
    printf '"}}}\r\n' ;;
  missing) printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"$id\",\"response\":{\"model\":\"only-current\"}}}" ;;
  rejected|fallback_rejected) printf '%s\n' "{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"$id\",\"error\":\"authentication required\\nPolicy denied list_models\"}}" ;;
  interaction) printf '%s\n' '{"type":"control_request","request_id":"permission","request":{"subtype":"can_use_tool"}}' ;;
  malformed) printf '%s\n' 'not json' ;;
  oversize) head -c 67108865 /dev/zero | tr '\000' x ;;
  eof) kill "$descendant"; wait "$descendant" 2>/dev/null; exit 0 ;;
  timeout|fallback_timeout) wait ;;
esac
while IFS= read -r request; do printf '%s\n' "$request" >> "$root/requests"; done
"#).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    for case in [
        "success",
        "fallback",
        "fallback_large",
        "fallback_rejected",
        "fallback_timeout",
        "large",
        "missing",
        "rejected",
        "interaction",
        "malformed",
        "oversize",
        "eof",
        "timeout",
    ] {
        fs::write(root.join("case"), case).unwrap();
        // Normal protocol cases must not accidentally test OS scheduling under
        // parallel migration/process load. Keep the intentional deadline case
        // short, and require every other failure to reach its actual protocol
        // branch instead of accepting a timeout as an equivalent error.
        let deadline = Duration::from_secs(if case.ends_with("timeout") { 1 } else { 10 });
        let result = if case == "success" {
            refresh_model_catalog(&executable, AdapterKind::ClaudeCodeCli)
                .await
                .map(|catalog| catalog.models)
        } else {
            claude_code_model_catalog(&executable, deadline).await
        };
        if matches!(case, "success" | "fallback" | "large" | "fallback_large") {
            let models = result.unwrap();
            assert_eq!(models.len(), 2);
            assert_eq!(models[1].id, "provider/new-alias[extended]");
            assert_eq!(models[1].display_name, "Native model");
            assert_eq!(models[1].description.as_deref(), Some("Native description"));
        } else {
            let expected = match case {
                "missing" => "model query did not return a non-empty models array",
                "rejected" => {
                    "Claude Code list_models rejected: authentication required\nPolicy denied list_models"
                }
                "fallback_rejected" => "Claude Code initialize rejected: authentication required",
                "interaction" => "model query requires interactive control",
                "malformed" => "invalid control frame",
                "oversize" => "runtime_probe_frame_capacity_exceeded",
                "eof" => "exited before returning the model catalog",
                "timeout" | "fallback_timeout" => "model query timed out",
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
            if case.starts_with("fallback") { 2 } else { 1 },
            "query must never submit user input, or fall back on unrelated errors"
        );
        assert_eq!(requests[0]["type"], "control_request");
        assert_eq!(requests[0]["request"], json!({"subtype":"list_models"}));
        if case.starts_with("fallback") {
            assert_eq!(requests[1]["request"], json!({"subtype":"initialize"}));
            assert_ne!(requests[0]["request_id"], requests[1]["request_id"]);
        }
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
        let descendant: i32 = fs::read_to_string(root.join("descendant"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        timeout(Duration::from_secs(2), async {
            while unsafe { libc::kill(descendant, 0) } == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("every outcome must kill descendants holding stdio");
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
        "Claude Code {:?}: {} selectable models",
        probe.result.reported_version,
        probe.models.len() - 1
    );
}
