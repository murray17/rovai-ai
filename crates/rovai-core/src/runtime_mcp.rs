use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use rovai_core::mcp::McpServerDefinition;
use serde_json::{Map, Value, json};

const COPILOT_CONFIG_PREFIX: &str = "copilot-mcp-";
const ADDITIVE_CONFIG_PREFIX: &str = "additional-mcp-";
const GROK_PLUGIN_PREFIX: &str = "grok-mcp-plugin-v2-";
const CONFIG_SUFFIX: &str = ".json";

#[derive(Debug, Clone, Copy)]
enum NativeFileDialect {
    Standard,
    Copilot,
}

pub(crate) fn write_ephemeral_additive_mcp_config(
    private_runtime_dir: &Path,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<EphemeralMcpConfigFile> {
    write_ephemeral_mcp_config(
        private_runtime_dir,
        ADDITIVE_CONFIG_PREFIX,
        external_servers,
        NativeFileDialect::Standard,
    )
}

pub(crate) fn write_ephemeral_copilot_config(
    private_runtime_dir: &Path,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<EphemeralMcpConfigFile> {
    write_ephemeral_mcp_config(
        private_runtime_dir,
        COPILOT_CONFIG_PREFIX,
        external_servers,
        NativeFileDialect::Copilot,
    )
}

pub(crate) fn write_ephemeral_grok_mcp_plugin(
    private_runtime_dir: &Path,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<EphemeralMcpConfigFile> {
    let parent = private_runtime_dir.join("external-mcp");
    create_private_directory(&parent, true)?;
    let root = parent.join(format!("{GROK_PLUGIN_PREFIX}{}", uuid::Uuid::new_v4()));
    create_private_directory(&root, false)?;
    let result = (|| -> Result<()> {
        write_private_json(
            &root.join("plugin.json"),
            &json!({"name": "rovai-external-mcp", "version": "1.0.0"}),
        )?;
        let servers = external_servers
            .iter()
            .map(|(name, definition)| {
                (
                    name.clone(),
                    native_file_server(definition, NativeFileDialect::Standard),
                )
            })
            .collect::<Map<_, _>>();
        write_private_json(&root.join(".mcp.json"), &json!({"mcpServers": servers}))?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&root);
        return Err(error);
    }
    Ok(EphemeralMcpConfigFile {
        path: root,
        cleanup: EphemeralMcpCleanup::Directory,
    })
}

fn write_ephemeral_mcp_config(
    private_runtime_dir: &Path,
    prefix: &str,
    external_servers: &BTreeMap<String, McpServerDefinition>,
    dialect: NativeFileDialect,
) -> Result<EphemeralMcpConfigFile> {
    let directory = private_runtime_dir.join("external-mcp");
    create_private_directory(&directory, true)?;
    let path = directory.join(format!("{prefix}{}{CONFIG_SUFFIX}", uuid::Uuid::new_v4()));
    let servers = external_servers
        .iter()
        .map(|(name, definition)| (name.clone(), native_file_server(definition, dialect)))
        .collect::<Map<_, _>>();
    let document = json!({"mcpServers": servers});
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    serde_json::to_writer(&mut file, &document)
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(EphemeralMcpConfigFile {
        path,
        cleanup: EphemeralMcpCleanup::File,
    })
}

fn write_private_json(path: &Path, value: &Value) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    serde_json::to_writer(&mut file, value)
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(())
}

pub(crate) fn external_acp_server(name: &str, definition: &McpServerDefinition) -> Value {
    match definition {
        McpServerDefinition::Stdio {
            command, args, env, ..
        } => json!({
            "name": name,
            "command": command,
            "args": args,
            "env": environment_pairs(env)
        }),
        McpServerDefinition::StreamableHttp { url, headers, .. } => json!({
            "name": name,
            "type": "http",
            "url": url,
            "headers": environment_pairs(headers)
        }),
    }
}

fn native_file_server(definition: &McpServerDefinition, dialect: NativeFileDialect) -> Value {
    match (dialect, definition) {
        (
            NativeFileDialect::Standard,
            McpServerDefinition::Stdio {
                command,
                args,
                cwd,
                env,
                ..
            },
        ) => json!({
            "type": "stdio",
            "command": command,
            "args": args,
            "cwd": cwd,
            "env": env
        }),
        (NativeFileDialect::Standard, McpServerDefinition::StreamableHttp { url, headers, .. }) => {
            json!({"type": "http", "url": url, "headers": headers})
        }
        (
            NativeFileDialect::Copilot,
            McpServerDefinition::Stdio {
                command, args, env, ..
            },
        ) => json!({
            "type": "local",
            "command": command,
            "args": args,
            "env": env,
            "tools": ["*"]
        }),
        (NativeFileDialect::Copilot, McpServerDefinition::StreamableHttp { url, headers, .. }) => {
            json!({"type": "http", "url": url, "headers": headers, "tools": ["*"]})
        }
    }
}

fn environment_pairs(values: &BTreeMap<String, String>) -> Vec<Value> {
    values
        .iter()
        .map(|(name, value)| json!({"name": name, "value": value}))
        .collect()
}

pub(crate) struct EphemeralMcpConfigFile {
    path: PathBuf,
    cleanup: EphemeralMcpCleanup,
}

enum EphemeralMcpCleanup {
    File,
    Directory,
}

impl EphemeralMcpConfigFile {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for EphemeralMcpConfigFile {
    fn drop(&mut self) {
        match self.cleanup {
            EphemeralMcpCleanup::File => {
                let _ = fs::remove_file(&self.path);
            }
            EphemeralMcpCleanup::Directory => {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
}

fn create_private_directory(directory: &Path, recursive: bool) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(recursive);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(directory).with_context(|| {
        format!(
            "failed to create private external MCP directory {}",
            directory.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn external_servers() -> BTreeMap<String, McpServerDefinition> {
        BTreeMap::from([
            (
                "docs".to_string(),
                McpServerDefinition::Stdio {
                    command: "/usr/bin/docs-mcp".to_string(),
                    args: vec!["--stdio".to_string()],
                    cwd: Some("/tmp/project".to_string()),
                    env: BTreeMap::from([("DOCS_TOKEN".to_string(), "secret".to_string())]),
                },
            ),
            (
                "remote".to_string(),
                McpServerDefinition::StreamableHttp {
                    url: "https://example.test/mcp".to_string(),
                    headers: BTreeMap::from([(
                        "Authorization".to_string(),
                        "Bearer secret".to_string(),
                    )]),
                },
            ),
        ])
    }

    #[test]
    fn external_configs_are_private_and_removed_on_drop() {
        for reuse_existing in [false, true] {
            let directory = std::env::temp_dir()
                .join(format!("rovai-runtime-mcp-test-{}", uuid::Uuid::new_v4()));
            let external = directory.join("external-mcp");
            let retained = external.join("previous-config.json");
            if reuse_existing {
                fs::create_dir_all(&external).unwrap();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&external, fs::Permissions::from_mode(0o755)).unwrap();
                }
                fs::write(&retained, b"retained configuration").unwrap();
            }
            let files = [
                write_ephemeral_copilot_config(&directory, &external_servers()).unwrap(),
                write_ephemeral_additive_mcp_config(&directory, &external_servers()).unwrap(),
            ];
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(&external).unwrap().permissions().mode() & 0o777,
                    if reuse_existing { 0o755 } else { 0o700 }
                );
            }
            for file in files {
                let path = file.path().to_path_buf();
                let body = std::fs::read_to_string(&path).unwrap();
                assert!(body.contains("Bearer secret"));
                assert!(!body.contains("rovai_team"));
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    assert_eq!(
                        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                        0o600
                    );
                }
                drop(file);
                assert!(!path.exists());
            }
            if reuse_existing {
                assert_eq!(fs::read(&retained).unwrap(), b"retained configuration");
            }
            // A real path error must fail delivery, not produce an empty MCP handle.
            let blocked = directory.join("blocked");
            fs::create_dir(&blocked).unwrap();
            fs::write(blocked.join("external-mcp"), b"retain non-directory").unwrap();
            assert!(write_ephemeral_copilot_config(&blocked, &external_servers()).is_err());
            assert!(write_ephemeral_additive_mcp_config(&blocked, &external_servers()).is_err());
            assert_eq!(
                fs::read(blocked.join("external-mcp")).unwrap(),
                b"retain non-directory"
            );
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn grok_plugin_is_private_additive_and_removed_on_drop() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-grok-mcp-test-{}",
            uuid::Uuid::new_v4()
        ));
        let external = directory.join("external-mcp");
        let fresh = write_ephemeral_grok_mcp_plugin(&directory, &external_servers()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&external).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let fresh_path = fresh.path().to_path_buf();
        drop(fresh);
        assert!(!fresh_path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&external, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let legacy = external.join("grok-mcp-plugin-legacy");
        let unrelated = external.join("user-plugin");
        let stale = external.join(format!("{GROK_PLUGIN_PREFIX}abandoned"));
        for path in [&legacy, &unrelated, &stale] {
            fs::create_dir_all(path).unwrap();
            fs::write(path.join(".mcp.json"), b"retained material").unwrap();
        }
        // Initialization cannot prove ownership of historical files. Preserve them;
        // only the live per-task handle removes its own generated plugin.
        #[cfg(feature = "extended-tests")]
        {
            let (incoming, _receiver) = tokio::sync::mpsc::unbounded_channel();
            let adapter = crate::acp::AcpCliRuntimeAdapter::deferred(
                crate::agent_profile::AdapterKind::GrokBuild,
                incoming,
                directory.clone(),
                std::sync::Arc::new(crate::runtime_fleet::AgentRuntimeFleetManager::new(
                    Default::default(),
                )),
                crate::compaction::CompactionDetectorPolicy::Disabled,
            );
            adapter.initialize_storage().unwrap();
            assert!(stale.exists());
        }
        assert!(stale.exists());
        for path in [&legacy, &unrelated, &stale] {
            assert_eq!(
                fs::read(path.join(".mcp.json")).unwrap(),
                b"retained material"
            );
        }
        let plugin = write_ephemeral_grok_mcp_plugin(&directory, &external_servers()).unwrap();
        let root = plugin.path().to_path_buf();
        assert!(
            root.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(GROK_PLUGIN_PREFIX)
        );
        let manifest = std::fs::read_to_string(root.join("plugin.json")).unwrap();
        let servers = std::fs::read_to_string(root.join(".mcp.json")).unwrap();
        assert!(create_private_directory(&root, false).is_err());
        assert!(write_private_json(&root.join(".mcp.json"), &json!({})).is_err());
        assert_eq!(fs::read_to_string(root.join(".mcp.json")).unwrap(), servers);
        assert!(manifest.contains("rovai-external-mcp"));
        assert!(manifest.contains("1.0.0"));
        assert!(servers.contains("docs"));
        assert!(servers.contains("remote"));
        assert!(servers.contains("Bearer secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&external).unwrap().permissions().mode() & 0o777,
                0o755
            );
            assert_eq!(
                std::fs::metadata(&root).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                std::fs::metadata(root.join(".mcp.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        drop(plugin);
        assert!(!root.exists());
        for path in [&legacy, &unrelated, &stale] {
            assert_eq!(
                fs::read(path.join(".mcp.json")).unwrap(),
                b"retained material"
            );
        }
        let blocked = directory.join("blocked");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("external-mcp"), b"retain non-directory").unwrap();
        assert!(write_ephemeral_grok_mcp_plugin(&blocked, &external_servers()).is_err());
        assert_eq!(
            fs::read(blocked.join("external-mcp")).unwrap(),
            b"retain non-directory"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
