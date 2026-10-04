//! Locations only: both entrypoints keep using the same stores and authority
//! admission. The standalone layout never falls back to Desktop's Home roots.
use crate::platform::private_storage::{
    create_private_new_file, open_private_append_file, open_private_read_file,
    prepare_private_directory,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LayoutMarker {
    schema_version: u32,
    layout: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPaths {
    pub data_dir: PathBuf,
    pub database: PathBuf,
    pub mcp_config_path: PathBuf,
    pub skill_library_root: PathBuf,
    pub runtime_camp_files_root: PathBuf,
    pub logs: PathBuf,
}

impl ServerPaths {
    pub fn prepare(data_dir: &Path) -> Result<Self> {
        Self::from_data_dir(data_dir)?;
        crate::camp_attachment_view::reject_existing_symlink_components(data_dir)?;
        if let Ok(metadata) = std::fs::symlink_metadata(data_dir) {
            ensure!(
                metadata.is_dir() && !metadata.file_type().is_symlink(),
                "--data-dir must name a directory, not a file or symbolic link"
            );
        }
        if !data_dir.join("server-layout.json").try_exists()? {
            for owned_entry in [
                "rovai.sqlite",
                "lumen.sqlite",
                "mcp.json",
                "skills",
                "instances",
                "logs",
                "server-token",
            ] {
                ensure!(
                    !data_dir.join(owned_entry).try_exists()?,
                    "server_legacy_layout: existing Rovai data uses a Desktop or legacy preview layout. No data or permissions were changed. Continue with the original Host command and complete associated paths; this entrypoint does not migrate that instance."
                );
            }
        }
        let root = prepare_private_directory(data_dir)?;
        let paths = Self::from_data_dir(&root)?;
        let marker_path = root.join("server-layout.json");
        if marker_path.try_exists()? {
            let mut bytes = Vec::new();
            open_private_read_file(&marker_path)?
                .take(4097)
                .read_to_end(&mut bytes)?;
            ensure!(bytes.len() <= 4096, "Server layout marker is too large");
            let marker: LayoutMarker = serde_json::from_slice(&bytes)
                .context("Server layout marker is invalid; existing data was not reset")?;
            ensure!(
                marker.schema_version == 1 && marker.layout == "standalone-root",
                "Server data layout is not supported by this version"
            );
        } else {
            ensure!(
                !paths.database.try_exists()?,
                "server_legacy_layout: existing Rovai data has no standalone-root marker. Keep using its original rovai-host run command and paths; this entrypoint does not move Desktop or legacy preview data. Back up the complete instance before migration."
            );
            let mut marker = create_private_new_file(&marker_path)?;
            marker.write_all(&serde_json::to_vec(&LayoutMarker {
                schema_version: 1,
                layout: "standalone-root".into(),
            })?)?;
            marker.sync_all()?;
        }
        // Runtime storage is admitted by Core after the data lease and database
        // assessment. Do not pre-create its marker or weaken those checks here.
        for directory in [&paths.skill_library_root, &paths.logs] {
            crate::camp_attachment_view::reject_existing_symlink_components(directory)?;
            prepare_private_directory(directory)?;
        }
        Ok(paths)
    }

    pub fn management_token(&self, generate: impl FnOnce() -> Result<String>) -> Result<String> {
        let path = self.data_dir.join("server-token");
        if !path.try_exists()? {
            let token = generate()?;
            ensure!(
                token.len() == 64 && token.bytes().all(|value| value.is_ascii_hexdigit()),
                "Invalid generated management token"
            );
            let mut file = create_private_new_file(&path)?;
            file.write_all(token.as_bytes())?;
            file.sync_all()?;
        }
        let mut token = String::new();
        open_private_read_file(&path)?
            .take(65)
            .read_to_string(&mut token)?;
        ensure!(
            token.len() == 64 && token.bytes().all(|value| value.is_ascii_hexdigit()),
            "Stored Server token is invalid; it has not been replaced"
        );
        Ok(token)
    }

    pub fn open_log(&self) -> Result<File> {
        open_private_append_file(&self.logs.join("server.log"))
    }

    /// The Host passes the admitted canonical data directory. No directory is
    /// created here, so callers can inspect paths before opening any store.
    pub fn from_data_dir(data_dir: &Path) -> Result<Self> {
        ensure!(
            data_dir.is_absolute()
                && !data_dir
                    .components()
                    .any(|part| matches!(part, Component::CurDir | Component::ParentDir)),
            "Server data directory must be a normalized absolute directory"
        );
        Ok(Self {
            data_dir: data_dir.to_owned(),
            database: data_dir.join("rovai.sqlite"),
            mcp_config_path: data_dir.join("mcp.json"),
            skill_library_root: data_dir.join("skills"),
            runtime_camp_files_root: server_runtime_root(data_dir)?,
            logs: data_dir.join("logs"),
        })
    }
}

pub fn server_runtime_root(canonical_data_dir: &Path) -> Result<PathBuf> {
    Ok(canonical_data_dir
        .join("instances")
        .join(crate::camp_attachment_view::instance_key(
            canonical_data_dir,
        )?)
        .join("runtime-files"))
}

/// The existing platform layout owns the instance identity. Output files are
/// ordinary siblings of legacy runtime storage, never an import destination.
pub fn camp_attachment_output_root(runtime_files_root: &Path, camp_id: &str) -> Result<PathBuf> {
    crate::camp_id::ThreadId::parse(camp_id)?;
    Ok(runtime_files_root
        .parent()
        .context("Runtime storage has no instance directory")?
        .join("attachments")
        .join(camp_id))
}

pub fn resolve_attachment_output_root(
    connection: &rusqlite::Connection,
    camp_id: &str,
) -> Result<String> {
    let runtime_root: String =
        connection.query_row("SELECT rovai_runtime_camp_files_root()", [], |row| {
            row.get(0)
        })?;
    Ok(
        camp_attachment_output_root(Path::new(&runtime_root), camp_id)?
            .to_string_lossy()
            .into_owned(),
    )
}

#[derive(Debug, Clone)]
pub struct ThreadOutputDirectory {
    pub camp_id: String,
    pub output_root: PathBuf,
}

impl ThreadOutputDirectory {
    pub fn prepare(database: &crate::db::Database, camp_id: &str) -> Result<Self> {
        ensure!(
            database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
                [camp_id],
                |row| row.get::<_, bool>(0),
            )?,
            "Camp no longer exists"
        );
        let output_root = camp_attachment_output_root(database.runtime_camp_files_root(), camp_id)?;
        crate::camp_attachment_view::reject_existing_symlink_components(&output_root)?;
        std::fs::create_dir_all(&output_root)?;
        Ok(Self {
            camp_id: camp_id.to_string(),
            output_root,
        })
    }
}

/// Only the Camp's computed output directory is owned. Source refs are never traversed.
pub fn remove_camp_attachment_output(runtime_files_root: &Path, camp_id: &str) -> Result<()> {
    let root = camp_attachment_output_root(runtime_files_root, camp_id)?;
    crate::camp_attachment_view::reject_existing_symlink_components(
        root.parent().context("Output root has no parent")?,
    )?;
    match std::fs::symlink_metadata(&root) {
        // remove_dir_all unlinks root symlinks without following them on both
        // Unix and Windows (where directory symlinks need directory removal).
        Ok(metadata) if metadata.is_dir() || metadata.file_type().is_symlink() => {
            std::fs::remove_dir_all(root)?
        }
        Ok(_) => std::fs::remove_file(root)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns location derivation, including changing the root as one unit. Process
    // admission/restart is covered by the Host lifecycle integration owner.
    #[test]
    fn server_owned_paths_follow_one_root_without_home_fallback() {
        for name in ["first-server", "second-server"] {
            let root = std::env::temp_dir().join(name);
            let paths = ServerPaths::from_data_dir(&root).unwrap();
            assert_eq!(paths.database, root.join("rovai.sqlite"));
            assert_eq!(paths.mcp_config_path, root.join("mcp.json"));
            assert_eq!(paths.skill_library_root, root.join("skills"));
            assert_eq!(paths.logs, root.join("logs"));
            assert_eq!(
                paths.runtime_camp_files_root,
                root.join("instances")
                    .join(crate::camp_attachment_view::instance_key(&root).unwrap())
                    .join("runtime-files")
            );
        }
        assert!(ServerPaths::from_data_dir(Path::new("relative")).is_err());
        assert!(ServerPaths::from_data_dir(&std::env::temp_dir().join("../escape")).is_err());
    }

    // The older root-admission fixture is Unix-only. This owner preserves its
    // standalone cases and also exercises Windows native private-directory ACLs.
    #[test]
    fn standalone_runtime_root_preserves_native_admission_and_owner() {
        use crate::camp_attachment_view::ThreadAttachmentViewStore;
        let parent = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let requested = parent.join(format!("rovai-server-layout-{}", uuid::Uuid::new_v4()));
        let paths = ServerPaths::prepare(&requested).unwrap();
        let root = &paths.runtime_camp_files_root;
        let server = ThreadAttachmentViewStore::admit(
            root,
            &paths.data_dir,
            std::slice::from_ref(&paths.skill_library_root),
        )
        .unwrap();
        assert_eq!(server.root(), root);
        assert!(
            ThreadAttachmentViewStore::admit(root, &paths.data_dir, &[]).is_err(),
            "the standalone root still has one owner"
        );
        assert!(
            ThreadAttachmentViewStore::admit(
                &paths.data_dir.join("instances/wrong/runtime-files"),
                &paths.data_dir,
                &[],
            )
            .is_err()
        );
        drop(server);
        assert!(
            ThreadAttachmentViewStore::admit(
                root,
                &paths.data_dir,
                &[paths.data_dir.join("instances")],
            )
            .is_err(),
            "standalone layout does not waive managed-root overlap checks"
        );
        let token = paths.management_token(|| Ok("1".repeat(64))).unwrap();
        let reopened = ServerPaths::prepare(&requested).unwrap();
        assert_eq!(reopened.runtime_camp_files_root, *root);
        assert_eq!(
            reopened
                .management_token(|| panic!("do not replace a stored token"))
                .unwrap(),
            token
        );
        let mut first_log = paths.open_log().unwrap();
        let mut second_log = paths.open_log().unwrap();
        first_log.write_all(b"first\n").unwrap();
        second_log.write_all(b"second\n").unwrap();
        first_log.write_all(b"third\n").unwrap();
        first_log.sync_data().unwrap();
        drop((first_log, second_log));
        assert_eq!(
            std::fs::read(paths.logs.join("server.log")).unwrap(),
            b"first\nsecond\nthird\n"
        );
        let server = ThreadAttachmentViewStore::admit(root, &paths.data_dir, &[]).unwrap();
        drop(server);
        std::fs::remove_dir_all(requested).unwrap();
    }
}
