//! Small, optimistic text writes shared by Desktop and Web Host transports.
//! Call on the blocking pool, after Core resolves the business source.
use crate::file_preview_authority::{ResolveFilePreviewSourceParams, ResolvedFilePreviewSource};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, Metadata, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRequest {
    pub source: ResolveFilePreviewSourceParams,
    pub path: PathBuf,
    pub root: PathBuf,
    pub text: Option<String>,
    pub expected_version: Option<String>,
}

pub fn failure(code: &str) -> Value {
    let message = match code {
        "edit_conflict" => "文件已在外部更新",
        "file_not_found" => "文件已不存在，修改已保留",
        "file_too_large" => "文件超过 2 MiB，无法保存",
        "save_unknown" => "保存结果未知，修改已保留",
        "edit_unavailable" => "此文件只支持阅读",
        "source_not_authorized" => "文件位置已失效，修改已保留",
        _ => "保存失败，修改已保留",
    };
    json!({"ok":false,"error":{"code":code,"message":message}})
}

fn identity(meta: &Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    }
    #[cfg(not(unix))]
    {
        format!("{:?}", meta.created().ok())
    }
}

struct Snapshot {
    bytes: Vec<u8>,
    text: String,
    version: String,
    key: String,
    bom: bool,
    crlf: bool,
    permissions: fs::Permissions,
}

fn snapshot(path: &Path, root: &Path) -> Result<Snapshot> {
    let metadata = fs::symlink_metadata(path).context("file_not_found")?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "edit_unavailable"
    );
    ensure!(!metadata.permissions().readonly(), "edit_unavailable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            metadata.mode() & 0o222 != 0 && metadata.nlink() == 1,
            "edit_unavailable"
        );
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).context("edit_unavailable")?;
    let before = file.metadata()?;
    ensure!(
        before.is_file() && identity(&before) == identity(&metadata),
        "edit_conflict"
    );
    ensure!(before.len() <= MAX_TEXT_BYTES as u64, "file_too_large");
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((MAX_TEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= MAX_TEXT_BYTES, "file_too_large");
    let after = file.metadata()?;
    ensure!(
        before.len() == after.len() && before.modified().ok() == after.modified().ok(),
        "edit_conflict"
    );
    let raw = std::str::from_utf8(&bytes).context("edit_unavailable")?;
    ensure!(!raw.contains('\0'), "edit_unavailable");
    let bom = raw.starts_with('\u{feff}');
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let crlf = raw.contains("\r\n");
    let text = raw.replace("\r\n", "\n");
    // Mixed or lone-CR files remain read-only rather than silently normalizing them.
    ensure!(
        !text.contains('\r') && (!crlf || !raw.replace("\r\n", "").contains('\n')),
        "edit_unavailable"
    );
    let root_id = identity(&fs::metadata(root).context("source_not_authorized")?);
    let key = format!(
        "{:x}",
        Sha256::digest(format!("{root_id}\0{}", path.display()))
    );
    let mut digest = Sha256::new();
    digest.update(key.as_bytes());
    digest.update(identity(&after));
    digest.update(format!("{:?}", after.permissions()));
    digest.update(&bytes);
    Ok(Snapshot {
        bytes,
        text,
        version: format!("{:x}", digest.finalize()),
        key,
        bom,
        crlf,
        permissions: after.permissions(),
    })
}

fn value(s: &Snapshot) -> Value {
    json!({"key":s.key,"text":s.text,"version":s.version})
}

static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
fn file_lock(path: &Path) -> Arc<Mutex<()>> {
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .expect("edit lock registry");
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(path.to_owned(), Arc::downgrade(&lock));
    lock
}

struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn execute(
    request: EditRequest,
    resolved: Option<ResolvedFilePreviewSource>,
    saving: bool,
) -> Value {
    match operation(request, resolved, saving) {
        Ok(value) => value,
        Err(error) => failure(match error.to_string().as_str() {
            "edit_conflict" => "edit_conflict",
            "file_not_found" => "file_not_found",
            "file_too_large" => "file_too_large",
            "edit_unavailable" => "edit_unavailable",
            "source_not_authorized" => "source_not_authorized",
            "save_unknown" => "save_unknown",
            _ => "write_failed",
        }),
    }
}

fn operation(
    request: EditRequest,
    resolved: Option<ResolvedFilePreviewSource>,
    saving: bool,
) -> Result<Value> {
    ensure!(
        matches!(
            request.source.kind.as_str(),
            "camp_workspace" | "message_reference"
        ),
        "edit_unavailable"
    );
    let Some(ResolvedFilePreviewSource::FileTarget {
        root_path,
        base_path,
        raw_reference,
        ..
    }) = resolved
    else {
        anyhow::bail!("source_not_authorized");
    };
    let root = fs::canonicalize(root_path).context("source_not_authorized")?;
    ensure!(root == request.root, "source_not_authorized");
    let candidate =
        crate::file_reference_path::reference_path(&raw_reference, Path::new(&base_path))?;
    let path = fs::canonicalize(&candidate).context("file_not_found")?;
    ensure!(
        path == request.path && path.starts_with(&root),
        "source_not_authorized"
    );
    let lock = file_lock(&path);
    let _guard = lock.lock().map_err(|_| anyhow::anyhow!("write_failed"))?;
    let before = snapshot(&path, &root)?;
    if !saving {
        return Ok(json!({"ok":true,"value":value(&before)}));
    }
    let expected = request
        .expected_version
        .as_deref()
        .context("edit_conflict")?;
    if before.version != expected {
        let mut result = failure("edit_conflict");
        result["current"] = value(&before);
        return Ok(result);
    }
    let text = request.text.context("write_failed")?;
    ensure!(text.len() <= MAX_TEXT_BYTES, "file_too_large");
    ensure!(!text.contains(['\0', '\r']), "edit_unavailable");
    let mut output = if before.bom {
        vec![0xef, 0xbb, 0xbf]
    } else {
        Vec::new()
    };
    output.extend(if before.crlf {
        text.replace('\n', "\r\n").into_bytes()
    } else {
        text.into_bytes()
    });
    ensure!(output.len() <= MAX_TEXT_BYTES, "file_too_large");
    let temporary = Temporary(
        path.parent()
            .context("source_not_authorized")?
            .join(format!(".rovai-save-{}", uuid::Uuid::new_v4())),
    );
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary.0)?;
    file.set_permissions(before.permissions)?;
    file.write_all(&output)?;
    file.sync_all()?;
    drop(file);
    // Check again after preparing the replacement. This is optimistic concurrency, not a process lock.
    ensure!(
        fs::canonicalize(&candidate).ok().as_ref() == Some(&path),
        "file_not_found"
    );
    let latest = snapshot(&path, &root)?;
    if latest.version != expected {
        let mut result = failure("edit_conflict");
        result["current"] = value(&latest);
        return Ok(result);
    }
    fs::rename(&temporary.0, &path)?;
    let saved = snapshot(&path, &root).context("save_unknown")?;
    ensure!(saved.bytes == output, "save_unknown");
    Ok(json!({"ok":true,"value":value(&saved)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns the shared write protocol. A directory and a file suffice; no Runtime/database fixture.
    struct Fixture {
        root: PathBuf,
        path: PathBuf,
    }
    impl Fixture {
        fn new(bytes: &[u8]) -> Self {
            let root =
                std::env::temp_dir().join(format!("rovai-text-edit-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            let path = root.join("example.ts");
            fs::write(&path, bytes).unwrap();
            Self { root, path }
        }
        fn run(&self, text: Option<&str>, version: Option<&str>, kind: &str) -> Value {
            let source = serde_json::from_value(
                json!({"kind":kind,"threadId":"thread","rawReference":"example.ts"}),
            )
            .unwrap();
            let resolved = ResolvedFilePreviewSource::FileTarget {
                camp_id: "thread".into(),
                source_kind: kind.into(),
                source_identity: "thread".into(),
                root_path: self.root.to_string_lossy().into(),
                base_path: self.root.to_string_lossy().into(),
                raw_reference: "example.ts".into(),
                allow_children: true,
            };
            execute(
                EditRequest {
                    source,
                    path: self.path.clone(),
                    root: self.root.clone(),
                    text: text.map(str::to_owned),
                    expected_version: version.map(str::to_owned),
                },
                Some(resolved),
                text.is_some(),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn writes_original_text_format_and_checks_same_size_external_changes() {
        let f = Fixture::new(b"\xef\xbb\xbfconst x = 1;\r\n// tail  ");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&f.path, fs::Permissions::from_mode(0o640)).unwrap();
        }
        let read = f.run(None, None, "camp_workspace");
        assert_eq!(read["value"]["text"], "const x = 1;\n// tail  ");
        let version = read["value"]["version"].as_str().unwrap();
        fs::write(&f.path, b"\xef\xbb\xbfconst x = 2;\r\n// tail  ").unwrap();
        let conflict = f.run(
            Some("const x = 3;\n// tail  "),
            Some(version),
            "camp_workspace",
        );
        assert_eq!(conflict["error"]["code"], "edit_conflict");
        let saved = f.run(
            Some("const x = 3;\n// tail  "),
            conflict["current"]["version"].as_str(),
            "camp_workspace",
        );
        assert_eq!(saved["ok"], true, "{saved}");
        assert_eq!(saved["value"]["key"], read["value"]["key"]);
        assert_ne!(saved["value"]["version"], read["value"]["version"]);
        assert_eq!(
            fs::read(&f.path).unwrap(),
            b"\xef\xbb\xbfconst x = 3;\r\n// tail  "
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&f.path).unwrap().permissions().mode() & 0o777,
                0o640
            );
        }
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 1);
    }

    #[test]
    fn refuses_deleted_replaced_readonly_and_non_roundtrippable_files() {
        let f = Fixture::new(b"original");
        let read = f.run(None, None, "camp_workspace");
        fs::remove_file(&f.path).unwrap();
        assert_eq!(
            f.run(
                Some("draft"),
                read["value"]["version"].as_str(),
                "camp_workspace"
            )["error"]["code"],
            "file_not_found"
        );
        assert!(!f.path.exists());
        fs::write(&f.path, b"replacement").unwrap();
        assert_eq!(
            f.run(
                Some("draft"),
                read["value"]["version"].as_str(),
                "camp_workspace"
            )["error"]["code"],
            "edit_conflict"
        );
        for bytes in [b"a\r\nb\n".as_slice(), b"\xff", b"a\0b"] {
            fs::write(&f.path, bytes).unwrap();
            assert_eq!(
                f.run(None, None, "camp_workspace")["error"]["code"],
                "edit_unavailable"
            );
        }
        fs::write(&f.path, b"text").unwrap();
        let mut permissions = fs::metadata(&f.path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&f.path, permissions).unwrap();
        assert_eq!(
            f.run(None, None, "camp_workspace")["error"]["code"],
            "edit_unavailable"
        );
        assert_eq!(
            f.run(Some("bad"), None, "run_activity_file")["error"]["code"],
            "edit_unavailable"
        );
    }

    #[test]
    fn bounds_utf8_bytes_and_serializes_competing_host_writes() {
        let f = Arc::new(Fixture::new(b"initial"));
        let read = f.run(None, None, "camp_workspace");
        let version = read["value"]["version"].as_str().unwrap().to_string();
        assert_eq!(
            f.run(
                Some(&"中".repeat(MAX_TEXT_BYTES / 3 + 1)),
                Some(&version),
                "camp_workspace"
            )["error"]["code"],
            "file_too_large"
        );
        let threads: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|text| {
                let f = f.clone();
                let version = version.clone();
                std::thread::spawn(move || f.run(Some(text), Some(&version), "camp_workspace"))
            })
            .collect();
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|result| result["ok"] == true).count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| result["error"]["code"] == "edit_conflict")
                .count(),
            1
        );
    }
}
