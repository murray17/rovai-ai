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
const GROK_PLUGIN_PREFIX: &str = "grok-mcp-plugin-";
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
    fs::create_dir_all(&parent).with_context(|| {
        format!(
            "failed to create private external MCP directory {}",
            parent.display()
        )
    })?;
    set_private_directory_permissions(&parent)?;
    let root = parent.join(format!("{GROK_PLUGIN_PREFIX}{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root)
        .with_context(|| format!("failed to create Grok MCP plugin {}", root.display()))?;
    set_private_directory_permissions(&root)?;
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
    fs::create_dir_all(&directory).with_context(|| {
        format!(
            "failed to create private external MCP directory {}",
            directory.display()
        )
    })?;
    set_private_directory_permissions(&directory)?;
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

pub(crate) fn remove_stale_mcp_configs(private_runtime_dir: &Path) -> Result<()> {
    let directory = private_runtime_dir.join("external-mcp");
    if !directory.exists() {
        return Ok(());
    }
    set_private_directory_permissions(&directory)?;
    for entry in fs::read_dir(&directory)
        .with_context(|| format!("failed to inspect {}", directory.display()))?
    {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let file_type = entry.file_type()?;
        if file_type.is_file()
            && (name.starts_with(COPILOT_CONFIG_PREFIX) || name.starts_with(ADDITIVE_CONFIG_PREFIX))
            && name.ends_with(CONFIG_SUFFIX)
        {
            fs::remove_file(entry.path())
                .with_context(|| format!("failed to remove stale external MCP config {name}"))?;
        } else if file_type.is_dir() && name.starts_with(GROK_PLUGIN_PREFIX) {
            fs::remove_dir_all(entry.path())
                .with_context(|| format!("failed to remove stale Grok MCP plugin {name}"))?;
        }
    }
    Ok(())
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

fn set_private_directory_permissions(_directory: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(_directory, fs::Permissions::from_mode(0o700)).with_context(|| {
            format!(
                "failed to restrict external MCP directory {}",
                _directory.display()
            )
        })?;
    }
    Ok(())
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
        let directory =
            std::env::temp_dir().join(format!("rovai-runtime-mcp-test-{}", uuid::Uuid::new_v4()));
        let files = [
            write_ephemeral_copilot_config(&directory, &external_servers()).unwrap(),
            write_ephemeral_additive_mcp_config(&directory, &external_servers()).unwrap(),
        ];
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
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn grok_plugin_is_private_additive_and_removed_on_drop() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-grok-mcp-test-{}",
            uuid::Uuid::new_v4()
        ));
        let plugin = write_ephemeral_grok_mcp_plugin(&directory, &external_servers()).unwrap();
        let root = plugin.path().to_path_buf();
        let manifest = std::fs::read_to_string(root.join("plugin.json")).unwrap();
        let servers = std::fs::read_to_string(root.join(".mcp.json")).unwrap();
        assert!(manifest.contains("rovai-external-mcp"));
        assert!(manifest.contains("1.0.0"));
        assert!(servers.contains("docs"));
        assert!(servers.contains("remote"));
        assert!(servers.contains("Bearer secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
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
        std::fs::remove_dir_all(directory).unwrap();
    }
}
