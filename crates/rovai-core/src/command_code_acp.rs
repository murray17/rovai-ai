//! Command Code's official stdio ACP profile. Fleet, routing, permissions,
//! replay and cancellation remain owned by the shared ACP Host.

use std::{fs, path::Path};

use anyhow::{Context, Result};
use serde_json::{Value, json};

pub const MINIMUM_VERSION: &str = "1.88.0";
pub const BOOTSTRAP_REVISION: &str = "command-code-system-bootstrap-v2";
const BOOTSTRAP: &str = include_str!("command_code/bootstrap.mjs");

/// Native ACP sends the proposed edit only on tool_call. Its old/new strings
/// are matched fragments, not complete file states. Promote them only after a
/// matching successful terminal. Only edit_file's explicit creation receipt
/// establishes a complete new file. write_file's "created" receipt also covers
/// an existing empty file: it proves an empty previous body, not creation.
pub fn enrich_tool_update(update: &mut Value, initial: Option<&Value>) {
    if let Some(meta) = update.get_mut("_meta").and_then(Value::as_object_mut) {
        meta.remove("rovaiCommandMutation");
    }
    if let Some(initial) = initial {
        for field in ["title", "kind", "rawInput", "locations"] {
            if update[field].is_null() && !initial[field].is_null() {
                update[field] = initial[field].clone();
            }
        }
    }
    // Pending native diffs are proposals, and edits contain fragments rather
    // than full file states. Promote only the terminal semantics below.
    if let Some(content) = update.get_mut("content").and_then(Value::as_array_mut) {
        content.retain(|block| block["type"] != "diff");
    }
    if update["status"] != "completed" || initial.is_none_or(|value| value["kind"] != "edit") {
        return;
    }
    let input = &initial.expect("checked initial")["rawInput"];
    let Some(path) = input["file_path"]
        .as_str()
        .or_else(|| input["path"].as_str())
        .filter(|path| !path.trim().is_empty())
    else {
        return;
    };
    if let Some(new) = input["content"].as_str() {
        if !new.is_empty()
            && has_text_result(update, &format!("File created successfully at: {path}"))
        {
            update["content"]
                .as_array_mut()
                .unwrap()
                .push(json!({"type":"diff", "path":path, "oldText":"", "newText":new}));
        }
        return;
    }
    let Some((old, new)) = input["old_string"]
        .as_str()
        .zip(input["new_string"].as_str())
    else {
        return;
    };
    if old == new {
        return;
    }
    if old.is_empty() {
        let lines = new.split('\n').count();
        let receipt = format!(
            "Created {path} ({lines} {})",
            if lines == 1 { "line" } else { "lines" }
        );
        if has_text_result(update, &receipt) {
            update["content"]
                .as_array_mut()
                .unwrap()
                .push(json!({"type":"diff", "path":path, "oldText":null, "newText":new}));
        }
        return;
    }
    if input["replace_all"] == true || input["replacement_count"].as_u64().is_some_and(|v| v != 1) {
        return;
    }
    let mutation = json!({"entries":[{"semantics":"reported_mutation", "path":path, "fragments":[{"oldText":old,"newText":new}]}]});
    if !update["_meta"].is_object() {
        update["_meta"] = json!({});
    }
    update["_meta"]["rovaiCommandMutation"] = mutation;
}

fn has_text_result(update: &Value, expected: &str) -> bool {
    update["content"].as_array().is_some_and(|blocks| {
        blocks.iter().any(|block| {
            block["type"] == "content"
                && block["content"]["type"] == "text"
                && block["content"]["text"].as_str() == Some(expected)
        })
    })
}

/// Deliver the official Mod in Host-owned temporary storage. Native HOME,
/// authentication, configuration and history remain entirely CLI-owned.
/// The returned nonce belongs only to the initialize handshake.
pub fn configure_host(command: &mut tokio::process::Command, root: &Path) -> Result<String> {
    fs::create_dir_all(root)?;
    let plugin = root.join("rovai-bootstrap.mjs");
    write_private(&plugin, BOOTSTRAP.as_bytes())?;
    let nonce = uuid::Uuid::new_v4().to_string();
    command
        .arg("--mod")
        .arg(plugin)
        .env("COMMANDCODE_SKIP_UPDATES", "1")
        .env("ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT", root)
        .env("ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE", &nonce);
    Ok(nonce)
}

pub fn verify_ready(root: &Path, nonce: &str, owns_pid: impl FnOnce(u32) -> bool) -> Result<()> {
    let path = root.join("ready.json");
    let ready: Value = serde_json::from_slice(
        &fs::read(&path)
            .context("Command Code Bootstrap extension did not load; no prompt sent")?,
    )?;
    let pid = ready["pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0);
    anyhow::ensure!(
        ready["revision"] == BOOTSTRAP_REVISION
            && ready["nonce"] == nonce
            && pid.is_some_and(owns_pid),
        "command_code_bootstrap_readiness_invalid"
    );
    fs::remove_file(path)?;
    Ok(())
}

/// 1.88 applies native placeholder expansion even to ACP env/header pairs.
/// Escape once at this wire boundary so the server receives the resolved value;
/// native file serialization is not involved. Native ACP connects stdio servers
/// from the Session cwd; only a different cwd needs the argv launcher.
pub(crate) fn adapt_mcp_server(
    server: &mut Value,
    definition: &crate::mcp::McpServerDefinition,
    session_cwd: &Path,
) {
    for field in ["env", "headers"] {
        if let Some(pairs) = server.get_mut(field).and_then(Value::as_array_mut) {
            for pair in pairs {
                if let Some(value) = pair["value"].as_str() {
                    pair["value"] = json!(value.replace("${", "$${"));
                }
            }
        }
    }
    if let crate::mcp::McpServerDefinition::Stdio {
        command,
        args,
        cwd: Some(cwd),
        ..
    } = definition
        && !crate::git::persisted_workspace_path_matches_canonical(Path::new(cwd), session_cwd)
    {
        server["command"] = json!("node");
        server["args"] = json!(
            [
                vec![
                    "--eval".to_owned(),
                    include_str!("command_code/mcp-cwd.cjs").to_owned(),
                    "--".to_owned(),
                    cwd.clone(),
                    command.clone()
                ],
                args.clone(),
            ]
            .concat()
        );
    }
}

/// The registered Mod command consumes one JSON string without starting a
/// model turn. Escaping keeps multiline instructions in a single slash command.
pub fn bootstrap_prompt(bootstrap: &str) -> Result<String> {
    anyhow::ensure!(
        !bootstrap.trim().is_empty()
            && bootstrap.len() <= crate::context::MAX_SESSION_BOOTSTRAP_BYTES,
        "command_code_bootstrap_invalid"
    );
    Ok(format!(
        "/rovai-bootstrap {}",
        serde_json::to_string(bootstrap)?
    ))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes)?;
    private_mode(path, 0o600)
}
fn private_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}
pub fn supported_version(version: Option<&str>) -> bool {
    version
        .and_then(crate::agent_runtime_adapter::parse_reported_runtime_version)
        .is_some_and(|(version, prerelease)| !prerelease && version >= [1, 88, 0])
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure wire owner: the native cwd receipt is a separate opt-in acceptance.
    #[test]
    fn mcp_wire_uses_session_cwd_without_a_launcher_and_preserves_literals() {
        use crate::mcp::McpServerDefinition;
        use std::collections::BTreeMap;

        let session_cwd = Path::new("/project space");
        let command = "/tools/server space";
        let args = vec![
            "two words".to_owned(),
            "$() `literal`".to_owned(),
            String::new(),
        ];
        for cwd in [None, Some("/project space"), Some("/other space")] {
            let definition = McpServerDefinition::Stdio {
                command: command.into(),
                args: args.clone(),
                cwd: cwd.map(str::to_owned),
                env: BTreeMap::new(),
            };
            let mut server = json!({"name":"docs", "command":command, "args":args,
                "env":[{"name":"LITERAL", "value":"$${literal} \\ '"}]});
            adapt_mcp_server(&mut server, &definition, session_cwd);
            assert_eq!(server["env"][0]["value"], "$$${literal} \\ '");
            if cwd == Some("/other space") {
                assert_eq!(server["command"], "node");
                let argv = server["args"].as_array().unwrap();
                assert_eq!(argv[0], "--eval");
                assert_eq!(argv[1], include_str!("command_code/mcp-cwd.cjs"));
                assert_eq!(argv[2], "--");
                assert_eq!(argv[3], "/other space");
                assert_eq!(argv[4], command);
                assert_eq!(&argv[5..], json!(args).as_array().unwrap());
            } else {
                assert_eq!(server["command"], command);
                assert_eq!(server["args"], json!(args));
            }
        }
        let definition = McpServerDefinition::StreamableHttp {
            url: "https://example.test/mcp".into(),
            headers: BTreeMap::new(),
        };
        let mut server = json!({"name":"remote", "type":"http", "url":"https://example.test/mcp",
            "headers":[{"name":"X-Literal", "value":"$${literal}"}]});
        adapt_mcp_server(&mut server, &definition, session_cwd);
        assert_eq!(server["headers"][0]["value"], "$$${literal}");
        assert!(server.get("command").is_none());
    }

    #[test]
    fn version_gate_accepts_native_release_labels() {
        for (version, accepted) in [
            (None, false),
            (Some("development"), false),
            (Some("1.87.9"), false),
            (Some("1.88.0-beta.1"), false),
            (Some("1.88.0"), true),
            (Some("v1.88.0"), true),
            (Some("Command Code v1.88.0"), true),
            (Some("1.88.0+build-name"), true),
            (Some("1.89.0"), true),
        ] {
            assert_eq!(supported_version(version), accepted, "{version:?}");
        }
    }

    #[test]
    fn native_home_and_bootstrap_control() {
        let root =
            std::env::temp_dir().join(format!("command-code-profile-{}", uuid::Uuid::new_v4()));
        let mut command = tokio::process::Command::new("command-code");
        command.env("HOME", root.join("user-home"));
        let nonce = configure_host(&mut command, &root).unwrap();
        assert_eq!(
            command
                .as_std()
                .get_envs()
                .find(|(k, _)| *k == "HOME")
                .unwrap()
                .1,
            Some(root.join("user-home").as_os_str())
        );
        assert!(!root.join("user-home").exists());
        assert!(!root.join("home").exists());
        assert!(!root.join("nonce").exists());
        assert_eq!(
            command.as_std().get_args().collect::<Vec<_>>(),
            vec![
                std::ffi::OsStr::new("--mod"),
                root.join("rovai-bootstrap.mjs").as_os_str()
            ]
        );
        let ready = root.join("ready.json");
        fs::write(
            &ready,
            serde_json::to_vec(&json!({"revision":BOOTSTRAP_REVISION,"nonce":nonce,"pid":123}))
                .unwrap(),
        )
        .unwrap();
        assert!(verify_ready(&root, "wrong", |pid| pid == 123).is_err());
        assert!(verify_ready(&root, &nonce, |pid| pid == 456).is_err());
        for invalid in [
            json!(0),
            json!(-1),
            json!(u64::from(u32::MAX) + 1),
            json!("123"),
            Value::Null,
        ] {
            fs::write(
                &ready,
                serde_json::to_vec(
                    &json!({"revision":BOOTSTRAP_REVISION,"nonce":nonce,"pid":invalid}),
                )
                .unwrap(),
            )
            .unwrap();
            assert!(verify_ready(&root, &nonce, |_| true).is_err());
            assert!(ready.exists());
        }
        fs::write(
            &ready,
            serde_json::to_vec(&json!({"revision":"wrong","nonce":nonce,"pid":123})).unwrap(),
        )
        .unwrap();
        assert!(verify_ready(&root, &nonce, |_| true).is_err());
        fs::write(
            &ready,
            serde_json::to_vec(&json!({"revision":BOOTSTRAP_REVISION,"nonce":nonce,"pid":123}))
                .unwrap(),
        )
        .unwrap();
        verify_ready(&root, &nonce, |pid| pid == 123).unwrap();
        assert!(!ready.exists());
        for text in [
            "  中文\n\"quotes\" \\ = ${literal}\n  ".to_owned(),
            serde_json::to_string(&json!({"professionalResponsibilities": "\0".repeat(30_000)}))
                .unwrap(),
            "😀".repeat(65_536),
            "\"".repeat(crate::context::MAX_SESSION_BOOTSTRAP_BYTES),
        ] {
            let prompt = bootstrap_prompt(&text).unwrap();
            assert!(!prompt.contains('\n'));
            assert_eq!(
                serde_json::from_str::<String>(prompt.strip_prefix("/rovai-bootstrap ").unwrap())
                    .unwrap(),
                text
            );
        }
        for text in [
            String::new(),
            " \n".into(),
            format!("{}x", "😀".repeat(65_536)),
        ] {
            assert!(bootstrap_prompt(&text).is_err());
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        assert!(!root.join("bindings").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
