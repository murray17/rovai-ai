//! Format 4 content reductions. Full details remain in the existing input/result carriers.
use serde_json::{Map, Value};

pub(super) const PREVIEW_BYTES: usize = 16 * 1024;

// These fields are identities or executable/path facts, never prefix approximations.
fn exact_field(key: &str) -> bool {
    key.ends_with("Id")
        || key.ends_with("Digest")
        || matches!(
            key,
            "id" | "type"
                | "status"
                | "phase"
                | "outcome"
                | "path"
                | "sourcePath"
                | "sendInputFilePath"
                | "cwd"
                | "command"
                | "commandLine"
                | "CommandLine"
                | "cmd"
                | "tool"
                | "toolName"
                | "canonicalTool"
                | "operation"
                | "sourceAuthority"
                | "schemaVersion"
                | "idempotentReplay"
        )
}

fn priority(key: &str) -> u8 {
    match key {
        key if exact_field(key) => 0,
        "_rovaiContent"
        | "_rovaiLifecycle"
        | "zcodeBackground"
        | "runtimeFileOperation"
        | "coreEnvelope"
        | "item"
        | "input" => 1,
        "exitCode" | "errorCode" | "authorizationDecision" => 2,
        "runtimeDiff" | "runtimeRunDiff" | "changes" | "diff" | "before" | "after" | "output"
        | "aggregatedOutput" | "result" | "content" => 4,
        _ => 3,
    }
}

// Reserve room for the small identity/status fields in later siblings before filling a
// potentially large nested preview. Arbitrary arguments/diffs do not reserve space.
fn reserved_bytes(key: &str, value: &Value) -> usize {
    if exact_field(key)
        || matches!(
            key,
            "exitCode" | "errorCode" | "authorizationDecision" | "ok"
        )
    {
        let bytes = size(value);
        return if bytes <= 4096 { bytes } else { 0 };
    }
    if matches!(key, "_rovaiContent" | "_rovaiLifecycle") {
        return size(value).min(1024);
    }
    if matches!(
        key,
        "item" | "input" | "zcodeBackground" | "runtimeFileOperation" | "coreEnvelope"
    ) {
        if let Some(fields) = value.as_object() {
            return 24
                + fields
                    .iter()
                    .map(|(key, value)| {
                        let bytes = reserved_bytes(key, value);
                        if bytes == 0 {
                            0
                        } else {
                            serde_json::to_string(key).unwrap().len() + 2 + bytes
                        }
                    })
                    .sum::<usize>();
        }
    }
    0
}

fn size(value: &Value) -> usize {
    serde_json::to_vec(value)
        .expect("JSON value serializes")
        .len()
}

fn fit(value: &Value, budget: usize, key: &str, depth: usize) -> Option<Value> {
    if budget < 2 || depth > 12 {
        return None;
    }
    match value {
        Value::Object(fields) => {
            let mut out = Map::new();
            out.insert("_rovaiTruncated".into(), Value::Bool(true));
            let mut used = size(&Value::Object(out.clone()));
            if used > budget {
                return None;
            }
            let mut fields: Vec<_> = fields
                .iter()
                .filter(|(k, _)| k.as_str() != "_rovaiTruncated")
                .collect();
            fields.sort_by_key(|(key, _)| (priority(key), key.as_str()));
            fields.truncate(24);
            let mut reserved: usize = fields
                .iter()
                .map(|(key, value)| {
                    let bytes = reserved_bytes(key, value);
                    if bytes == 0 {
                        0
                    } else {
                        serde_json::to_string(key).unwrap().len() + 2 + bytes
                    }
                })
                .sum();
            for (key, value) in fields.into_iter().take(24) {
                let overhead = serde_json::to_string(key).unwrap().len() + 2; // comma and colon
                let own_reserved = reserved_bytes(key, value);
                reserved = reserved.saturating_sub(if own_reserved == 0 {
                    0
                } else {
                    overhead + own_reserved
                });
                let remaining = budget.saturating_sub(used + overhead + reserved);
                if let Some(value) = fit(value, remaining, key, depth + 1) {
                    used += overhead + size(&value);
                    out.insert(key.clone(), value);
                }
            }
            Some(Value::Object(out))
        }
        Value::Array(values) => {
            let mut out = Vec::new();
            let mut used = 2;
            for value in values.iter().take(24) {
                let comma = usize::from(!out.is_empty());
                let Some(value) = fit(value, budget.saturating_sub(used + comma), key, depth + 1)
                else {
                    break;
                };
                used += comma + size(&value);
                out.push(value);
            }
            Some(Value::Array(out))
        }
        Value::String(text) => {
            if exact_field(key) || key == "input" {
                return (size(value) <= budget).then(|| value.clone());
            }
            let mut out = String::new();
            let mut used = 2;
            let mut chars = text.chars().peekable();
            for _ in 0..4000 {
                let Some(&c) = chars.peek() else {
                    break;
                };
                let bytes = match c {
                    '"' | '\\' | '\n' | '\r' | '\t' | '\u{0008}' | '\u{000c}' => 2,
                    c if c < ' ' => 6,
                    c => c.len_utf8(),
                };
                if used + bytes + 3 > budget {
                    break;
                }
                used += bytes;
                out.push(c);
                chars.next();
            }
            if chars.peek().is_some() && used + 3 <= budget {
                out.push('…');
            }
            Some(Value::String(out))
        }
        _ => (size(value) <= budget).then(|| value.clone()),
    }
}

pub(super) fn preview(value: &Value) -> Value {
    fit(value, PREVIEW_BYTES, "", 0).unwrap_or(Value::Null)
}

// Remove only the exact native body already represented by an admitted Codex entry.
// Paths/kinds/unknown native metadata survive; failed/partial/unmatched normalization is untouched.
pub(super) fn deduplicate_codex_diff(payload: &mut Value, workspace_json: Option<&str>) {
    if payload
        .pointer("/runtimeDiff/status")
        .and_then(Value::as_str)
        != Some("available")
        || payload
            .pointer("/runtimeDiff/sourceMetadata/adapterKind")
            .and_then(Value::as_str)
            != Some("codex-cli")
        || payload.pointer("/item/status").and_then(Value::as_str) != Some("completed")
    {
        return;
    }
    let Some(root) = workspace_json
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v["executionRoot"].as_str().map(str::to_owned))
    else {
        return;
    };
    let Some(entries) = payload
        .pointer("/runtimeDiff/entries")
        .and_then(Value::as_array)
        .cloned()
    else {
        return;
    };
    let Some(changes) = payload
        .pointer_mut("/item/changes")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for change in changes {
        let Some(body) = change.get("diff").and_then(Value::as_str) else {
            continue;
        };
        let kind = change.pointer("/kind/type").and_then(Value::as_str);
        let moved = (kind == Some("update"))
            .then(|| {
                change
                    .pointer("/kind/movePath")
                    .or_else(|| change.pointer("/kind/move_path"))
            })
            .flatten();
        let path = moved
            .filter(|v| v.is_string())
            .or_else(|| change.get("path"))
            .and_then(Value::as_str)
            .and_then(|path| {
                crate::runtime_diff::normalize_reported_path_for_display(
                    std::path::Path::new(&root),
                    path,
                )
            });
        let represented = entries.iter().any(|entry| {
            if entry.get("path").and_then(Value::as_str) != path.as_deref()
                || entry.get("changeKind").and_then(Value::as_str) != kind
            {
                return false;
            }
            let field = match (kind, entry.get("semantics").and_then(Value::as_str)) {
                (Some("update"), Some("unified_diff_snapshot")) => "diff",
                (Some("add"), Some("full_before_after")) => "after",
                (Some("delete"), Some("full_before_after")) => "before",
                _ => return false,
            };
            entry.get(field).and_then(Value::as_str) == Some(body)
        });
        if represented {
            change.as_object_mut().unwrap().remove("diff");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn codex_dedup_requires_matching_admitted_path_kind_and_body() {
        use crate::test_support::absolute_test_path;

        let root = absolute_test_path("/fixture/repo");
        let workspace = json!({"executionRoot":root}).to_string();
        for (kind, path, moved) in [
            ("update", "src/file.rs".to_owned(), None),
            ("update", format!("{root}/src/file.rs"), None),
            (
                "update",
                format!("{root}/src/old.rs"),
                Some(format!("{root}/src/new.rs")),
            ),
            ("add", format!("{root}/src/界.rs"), None),
            ("delete", absolute_test_path("/outside/removed.rs"), None),
        ] {
            let (_, mut payload) = crate::codex::normalize_event(
                "item/completed",
                &json!({"item":{
                "id":"file-operation","type":"fileChange","status":"completed",
                "changes":[{"path":path,"kind":{"type":kind,"movePath":moved},"diff":"exact body\n","extra":"keep"}]}}),
            );
            crate::execution_evidence::normalize_runtime_diff_evidence(
                &mut payload,
                Some(&workspace),
                Some("codex-cli"),
                None,
                None,
            );
            assert_eq!(payload["runtimeDiff"]["status"], "available");
            let original = payload.clone();
            let admitted = payload["runtimeDiff"].clone();
            deduplicate_codex_diff(&mut payload, Some(&workspace));
            assert!(
                payload.pointer("/item/changes/0/diff").is_none(),
                "{kind} {path}"
            );
            assert_eq!(payload["runtimeDiff"], admitted);
            assert_eq!(payload["item"]["changes"][0]["extra"], "keep");
            assert_eq!(
                payload["item"]["changes"][0]["kind"],
                original["item"]["changes"][0]["kind"]
            );
            for pointer in [
                "/runtimeDiff/status",
                "/runtimeDiff/entries/0/path",
                "/runtimeDiff/entries/0/changeKind",
                "/runtimeDiff/sourceMetadata/adapterKind",
                "/item/status",
                "/item/changes/0/diff",
            ] {
                let mut unmatched = original.clone();
                *unmatched.pointer_mut(pointer).unwrap() = json!("different");
                let expected = unmatched.clone();
                deduplicate_codex_diff(&mut unmatched, Some(&workspace));
                assert_eq!(
                    unmatched, expected,
                    "unadmitted or distinct content remains available: {pointer}"
                );
            }
        }
    }

    #[test]
    fn previews_bound_serialized_utf8_and_preserve_exact_control_fields() {
        for text in ["a".repeat(4000), "界🙂\n\"\\".repeat(4000)] {
            let fields = (0..24)
                .map(|i| (format!("field{i}"), json!(text)))
                .collect::<Map<_, _>>();
            let value = json!({"input":fields,"status":"completed","resultDigest":"exact-digest",
                "runtimeFileOperation":{"schemaVersion":1,"path":"src/界.rs","status":"available"},
                "item":{"id":"operation","type":"commandExecution","status":"completed"},
                "zcodeBackground":{"identityDigest":"identity","toolCallId":"background-tool","status":"running","argv":vec![text;24]}});
            let preview = preview(&value);
            assert!(size(&preview) <= PREVIEW_BYTES);
            assert_eq!(preview["status"], value["status"]);
            assert_eq!(preview["resultDigest"], value["resultDigest"]);
            assert_eq!(
                preview["runtimeFileOperation"]["path"],
                value["runtimeFileOperation"]["path"]
            );
            assert_eq!(preview["zcodeBackground"]["identityDigest"], "identity");
            assert_eq!(preview["zcodeBackground"]["status"], "running");
            assert_eq!(preview["item"]["id"], "operation");
            serde_json::from_slice::<Value>(&serde_json::to_vec(&preview).unwrap()).unwrap();
        }
        let oversized_path = "x".repeat(PREVIEW_BYTES * 2);
        let value = preview(&json!({"path":oversized_path}));
        assert!(
            value.get("path").is_none(),
            "an authority path must never become a truncated path"
        );
        let value = preview(
            &json!({"input":format!("rovai task get --task-id fixture {} ; echo next", " ".repeat(PREVIEW_BYTES)),"idempotentReplay":false}),
        );
        assert!(
            value.get("input").is_none(),
            "a clipped command must never become an exact CLI carrier"
        );
        assert_eq!(value["idempotentReplay"], false);
    }
}
