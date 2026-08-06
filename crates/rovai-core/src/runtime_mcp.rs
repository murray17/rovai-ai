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
const STRICT_CONFIG_PREFIX: &str = "strict-mcp-";
const CONFIG_SUFFIX: &str = ".json";

#[derive(Debug, Clone, Copy)]
enum NativeFileDialect {
    Standard,
    Copilot,
}

pub(crate) fn write_ephemeral_strict_mcp_config(
    private_runtime_dir: &Path,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<EphemeralMcpConfigFile> {
    write_ephemeral_mcp_config(
        private_runtime_dir,
        STRICT_CONFIG_PREFIX,
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
    Ok(EphemeralMcpConfigFile { path })
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
        if entry.file_type()?.is_file()
            && (name.starts_with(COPILOT_CONFIG_PREFIX) || name.starts_with(STRICT_CONFIG_PREFIX))
            && name.ends_with(CONFIG_SUFFIX)
        {
            fs::remove_file(entry.path())
                .with_context(|| format!("failed to remove stale external MCP config {name}"))?;
        }
    }
    Ok(())
}

pub(crate) struct EphemeralMcpConfigFile {
    path: PathBuf,
}

impl EphemeralMcpConfigFile {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for EphemeralMcpConfigFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn set_private_directory_permissions(directory: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).with_context(|| {
            format!(
                "failed to restrict external MCP directory {}",
                directory.display()
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
            write_ephemeral_strict_mcp_config(&directory, &external_servers()).unwrap(),
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
}
