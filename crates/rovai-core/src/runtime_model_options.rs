//! Target-option observations live in the existing catalog metadata and queue.
//! DSH retains its historical keys and native preparation; MiniMax only observes
//! its own configuration identity. Neither path changes business Host reuse.
use crate::{agent_profile::AdapterKind, command::canonical_json_digest};
use anyhow::{Context, Result, bail, ensure};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy)]
pub(crate) struct MetadataKeys {
    pub resolved: &'static str,
    pub context: &'static str,
    pub observed_at: &'static str,
}

pub(crate) fn metadata_keys(kind: AdapterKind) -> Option<MetadataKeys> {
    match kind {
        AdapterKind::DeepseekHarness => Some(MetadataKeys {
            resolved: "dshOptionsResolved",
            context: "dshOptionsContext",
            observed_at: "dshOptionsObservedAt",
        }),
        AdapterKind::MinimaxCodeCli => Some(MetadataKeys {
            resolved: "modelOptionsResolved",
            context: "modelOptionsContext",
            observed_at: "modelOptionsObservedAt",
        }),
        _ => None,
    }
}

pub(crate) fn context(kind: AdapterKind, executable: &Path) -> Result<String> {
    if kind == AdapterKind::DeepseekHarness {
        return crate::dsh::model_options_context(executable);
    }
    ensure!(
        kind == AdapterKind::MinimaxCodeCli,
        "Runtime does not support target options"
    );
    let environment = crate::runtime_discovery::runtime_environment(kind);
    let value = |key: &str| {
        crate::runtime_discovery::runtime_environment_variable(kind, key)
            .filter(|value| !value.to_string_lossy().trim().is_empty())
            .map(PathBuf::from)
    };
    let root = value("MINIMAX_DATA_DIR")
        .or_else(|| value("MAVIS_DATA_DIR"))
        .or_else(|| {
            crate::runtime_discovery::runtime_home_directory(kind).map(|home| home.join(".minimax"))
        })
        .context("MiniMax native configuration directory is unavailable")?;
    // Relative data roots refer to the disposable cwd and cannot own reusable observations.
    ensure!(
        root.is_absolute(),
        "MiniMax target options require an absolute native data directory"
    );
    let root = if root.exists() {
        crate::runtime_discovery::runtime_visible_path(root.canonicalize()?)
    } else {
        root
    };
    let executable = crate::runtime_discovery::runtime_visible_path(executable.canonicalize()?);
    let identity = crate::agent_runtime_adapter::observe_executable_file_identity(&executable)?;
    let files = native_inputs(&root)?;
    canonical_json_digest(&json!({"revision": 1, "root": root, "files": files,
        "executable": executable,
        "identity": [identity.byte_size.to_string(), identity.modified_at_unix_nanos.to_string(), identity.file_id.unwrap_or_default()],
        "environment": environment}))
}

fn native_inputs(root: &Path) -> Result<BTreeMap<String, String>> {
    let mut paths = vec![root.join("config.yaml")];
    // Auth/profile changes also invalidate observations. Only the native auth tree
    // is traversed; lock files, Session databases, logs and probe cwd are excluded.
    let mut pending = vec![(root.join("auth"), 0)];
    while let Some((directory, depth)) = pending.pop() {
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => bail!("MiniMax native options identity is unreadable"),
        };
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                ensure!(
                    depth < 6,
                    "MiniMax native auth identity exceeds its depth limit"
                );
                pending.push((entry.path(), depth + 1));
            } else if entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                paths.push(entry.path());
            }
            ensure!(
                paths.len() + pending.len() <= 128,
                "MiniMax native options identity exceeds its file limit"
            );
        }
    }
    let mut inputs = BTreeMap::new();
    for path in paths {
        let mut file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => bail!("MiniMax native options identity is unreadable"),
        };
        // Stream configuration digests without a configuration-size admission gate.
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            let count = file
                .read(&mut buffer)
                .context("MiniMax native options identity is unreadable")?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        inputs.insert(
            path.strip_prefix(root)?.to_string_lossy().into_owned(),
            format!("{:x}", digest.finalize()),
        );
    }
    Ok(inputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    // Owns the new native file-identity seam; parser/DB owners cannot prove that
    // Session writes do not invalidate an otherwise unchanged options context.
    #[test]
    fn native_inputs_track_configuration_and_auth_but_exclude_session_state() {
        let root =
            std::env::temp_dir().join(format!("rovai-minimax-context-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("auth/profile")).unwrap();
        fs::write(root.join("config.yaml"), "provider: initial").unwrap();
        let initial = native_inputs(&root).unwrap();
        fs::create_dir_all(root.join("v2/sessions")).unwrap();
        fs::write(root.join("v2/sessions/state.json"), "changed").unwrap();
        fs::write(root.join("auth/profile/auth.lock"), "changed").unwrap();
        assert_eq!(native_inputs(&root).unwrap(), initial);
        fs::write(root.join("auth/profile/auth.json"), "synthetic-identity").unwrap();
        let authenticated = native_inputs(&root).unwrap();
        // Native initialization refreshes this download cache; it is directory
        // freshness, not a change of user installation/configuration identity.
        fs::create_dir_all(root.join("cache")).unwrap();
        fs::write(
            root.join("cache/models-dev-catalog.json"),
            vec![b'x'; 2 * 1024 * 1024 + 1],
        )
        .unwrap();
        assert_eq!(native_inputs(&root).unwrap(), authenticated);
        assert_ne!(authenticated, initial);
        fs::write(root.join("config.yaml"), vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
        assert_ne!(native_inputs(&root).unwrap(), authenticated);
        fs::remove_dir_all(root).unwrap();
    }
}
