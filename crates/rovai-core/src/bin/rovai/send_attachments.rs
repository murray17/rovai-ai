use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result};
use rovai_core::{
    builtin_tool_transport::{
        BuiltinToolCliContext, BuiltinToolIpcRequest, BuiltinToolIpcResponse, LocalIpcEndpoint,
    },
    local_attachment_snapshot::{
        LocalAttachmentError, LocalSnapshotRoot, MAX_DRAFT_ATTACHMENT_BYTES,
        local_attachment_byte_size, promote_local_snapshot_root, reject_symlink_path,
        remove_local_snapshot_tree, snapshot_local_attachment, sync_parent,
    },
};
use serde_json::{Value, json};

#[derive(Debug)]
pub(super) struct AttachmentFailure {
    code: &'static str,
    message: &'static str,
    ordinal: Option<usize>,
}
impl AttachmentFailure {
    fn source(error: anyhow::Error, ordinal: usize) -> Self {
        let (code, message) = if let Some(kind) = error.downcast_ref::<LocalAttachmentError>() {
            match kind {
                LocalAttachmentError::Unsupported => {
                    ("unsupported_type", "attachment type is unsupported")
                }
                LocalAttachmentError::Changed => {
                    ("source_changed", "attachment changed while being copied")
                }
                LocalAttachmentError::Limit => (
                    "limit_exceeded",
                    "attachment exceeds the size or tree limit",
                ),
                LocalAttachmentError::InvalidPath => ("invalid_path", "attachment path is invalid"),
            }
        } else if error
            .chain()
            .filter_map(|cause| cause.downcast_ref::<std::io::Error>())
            .any(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            ("source_unavailable", "attachment source is unavailable")
        } else {
            ("source_unreadable", "attachment source cannot be read")
        };
        Self {
            code,
            message,
            ordinal: Some(ordinal),
        }
    }
    fn staging() -> Self {
        Self {
            code: "snapshot_unavailable",
            message: "attachment snapshot could not be prepared",
            ordinal: None,
        }
    }
    pub(super) fn output(&self) -> Value {
        let mut error = json!({"code": format!("builtin_tool.attachment_{}", self.code), "message": self.message, "recovery": "fix_input"});
        if let Some(ordinal) = self.ordinal {
            error["details"] = json!({"attachmentIndex": ordinal});
        }
        json!({"error": error})
    }
}

/// The guard owns only this invocation's import. Transport uncertainty explicitly retains it.
#[derive(Default)]
pub(super) struct SendSnapshots {
    root: Option<LocalSnapshotRoot>,
    import_root: Option<LocalSnapshotRoot>,
    owned_path: Option<PathBuf>,
    retain_for_run: bool,
}
impl SendSnapshots {
    pub(super) async fn send(
        &mut self,
        endpoint: &LocalIpcEndpoint,
        request: &BuiltinToolIpcRequest,
    ) -> std::result::Result<BuiltinToolIpcResponse, super::BuiltinToolIpcFailure> {
        // Cancellation or a malformed response may follow a successful dispatch.
        self.retain_for_run();
        let response = super::send_with_retry(endpoint, request).await;
        if matches!(response, Err(super::BuiltinToolIpcFailure::BeforeDispatch)) {
            self.retain_for_run = false;
        }
        response
    }

    pub(super) fn retain_for_run(&mut self) {
        self.retain_for_run = true;
    }
    pub(super) fn response_received(&mut self) {
        self.retain_for_run = false;
    }
}
impl Drop for SendSnapshots {
    fn drop(&mut self) {
        if !self.retain_for_run
            && self
                .root
                .as_ref()
                .is_none_or(|root| root.validate().is_ok())
            && self
                .import_root
                .as_ref()
                .is_none_or(|root| root.validate().is_ok())
            && let Some(path) = &self.owned_path
        {
            let _ = remove_local_snapshot_tree(path);
        }
    }
}

struct Source {
    path: PathBuf,
    canonical: PathBuf,
    external: bool,
    byte_size: u64,
}

pub(super) fn stage_external_send_files(
    input: &mut Value,
    context: &BuiltinToolCliContext,
    request_id: &str,
) -> std::result::Result<SendSnapshots, AttachmentFailure> {
    // JSON Schema defaults are annotations. Body-only CLI inputs do not contain a files key.
    let Some(files) = input.get_mut("files") else {
        return Ok(SendSnapshots::default());
    };
    let files = files
        .as_array_mut()
        .ok_or_else(AttachmentFailure::staging)?;
    if files.is_empty() {
        return Ok(SendSnapshots::default());
    }
    let lease = context
        .lease
        .as_ref()
        .ok_or_else(AttachmentFailure::staging)?;
    let workspace =
        fs::canonicalize(&lease.execution_root).map_err(|_| AttachmentFailure::staging())?;
    let run_tmp = fs::canonicalize(&lease.run_tmp).map_err(|_| AttachmentFailure::staging())?;
    let root = LocalSnapshotRoot::open(Path::new(&lease.run_tmp))
        .map_err(|_| AttachmentFailure::staging())?;
    let mut snapshots = SendSnapshots {
        root: Some(root),
        import_root: None,
        owned_path: None,
        retain_for_run: false,
    };
    let mut sources = Vec::with_capacity(files.len());
    let mut total = 0_u64;
    let mut identities = HashSet::new();
    for (ordinal, file) in files.iter().enumerate() {
        let planned = (|| -> Result<Source> {
            let requested = Path::new(file.as_str().context(LocalAttachmentError::InvalidPath)?);
            if requested
                .components()
                .any(|part| matches!(part, Component::ParentDir))
            {
                return Err(LocalAttachmentError::InvalidPath.into());
            }
            if !requested.is_absolute()
                && requested
                    .components()
                    .any(|part| matches!(part, Component::Prefix(_) | Component::RootDir))
            {
                return Err(LocalAttachmentError::InvalidPath.into());
            }
            let path = if requested.is_absolute() {
                requested.components().collect::<PathBuf>()
            } else {
                workspace.join(requested).components().collect::<PathBuf>()
            };
            // Inspect the original leaf before canonicalizing, preserving no-follow semantics.
            let byte_size = local_attachment_byte_size(&path)?;
            let canonical = fs::canonicalize(&path)?;
            let mut external = true;
            for (configured, canonical_root) in [
                (Path::new(&lease.execution_root), &workspace),
                (Path::new(&lease.run_tmp), &run_tmp),
            ] {
                // Reject links below an admitted root even when their target lies outside that root.
                let original_root = admitted_root_alias(&path, configured, canonical_root)?;
                if let Some(original_root) = &original_root {
                    reject_symlink_path(original_root, &path)?;
                }
                if canonical.starts_with(canonical_root) {
                    original_root.context(LocalAttachmentError::InvalidPath)?;
                    external = false;
                }
            }
            if external && run_tmp.starts_with(&canonical) {
                return Err(LocalAttachmentError::InvalidPath.into());
            }
            if !identities.insert(canonical.clone()) {
                return Err(LocalAttachmentError::InvalidPath.into());
            }
            total = total
                .checked_add(byte_size)
                .context(LocalAttachmentError::Limit)?;
            if total > MAX_DRAFT_ATTACHMENT_BYTES {
                return Err(LocalAttachmentError::Limit.into());
            }
            Ok(Source {
                path,
                canonical,
                external,
                byte_size,
            })
        })()
        .map_err(|error| AttachmentFailure::source(error, ordinal))?;
        sources.push(planned);
    }
    if sources.iter().all(|source| !source.external) {
        for (file, source) in files.iter_mut().zip(sources) {
            *file = path_value(&source.canonical).map_err(|_| AttachmentFailure::staging())?;
        }
        return Ok(snapshots);
    }
    uuid::Uuid::parse_str(request_id).map_err(|_| AttachmentFailure::staging())?;
    snapshots
        .root
        .as_ref()
        .unwrap()
        .validate()
        .map_err(|_| AttachmentFailure::staging())?;
    let import_root = run_tmp.join(".send-import");
    create_private_directory(&import_root, true).map_err(|_| AttachmentFailure::staging())?;
    // The import parent is shared by invocations, but cannot be a symlink/reparse point.
    snapshots.import_root =
        Some(LocalSnapshotRoot::open(&import_root).map_err(|_| AttachmentFailure::staging())?);
    let staging = import_root.join(format!(".{request_id}.staging"));
    let committed = import_root.join(request_id);
    create_private_directory(&staging, false).map_err(|_| AttachmentFailure::staging())?;
    snapshots.owned_path = Some(staging.clone());
    let mut rewritten = Vec::with_capacity(files.len());
    let mut actual_total = sources
        .iter()
        .filter(|source| !source.external)
        .map(|source| source.byte_size)
        .sum::<u64>();
    for (ordinal, source) in sources.iter().enumerate() {
        if !source.external {
            rewritten.push(source.canonical.clone());
            continue;
        }
        snapshots
            .root
            .as_ref()
            .unwrap()
            .validate()
            .map_err(|_| AttachmentFailure::staging())?;
        snapshots
            .import_root
            .as_ref()
            .unwrap()
            .validate()
            .map_err(|_| AttachmentFailure::staging())?;
        let snapshot = snapshot_local_attachment(&source.path, &staging.join(ordinal.to_string()))
            .map_err(|error| AttachmentFailure::source(error, ordinal))?;
        actual_total = actual_total
            .checked_add(snapshot.byte_size)
            .filter(|total| *total <= MAX_DRAFT_ATTACHMENT_BYTES)
            .ok_or_else(|| {
                AttachmentFailure::source(LocalAttachmentError::Limit.into(), ordinal)
            })?;
        rewritten.push(
            committed.join(
                snapshot
                    .path
                    .strip_prefix(&staging)
                    .map_err(|_| AttachmentFailure::staging())?,
            ),
        );
    }
    snapshots
        .root
        .as_ref()
        .unwrap()
        .validate()
        .map_err(|_| AttachmentFailure::staging())?;
    snapshots
        .import_root
        .as_ref()
        .unwrap()
        .validate()
        .map_err(|_| AttachmentFailure::staging())?;
    promote_local_snapshot_root(&staging, &committed).map_err(|_| AttachmentFailure::staging())?;
    // Rename transfers ownership even if the following durability operation fails.
    snapshots.owned_path = Some(committed.clone());
    sync_parent(&committed).map_err(|_| AttachmentFailure::staging())?;
    for (file, path) in files.iter_mut().zip(rewritten) {
        *file = path_value(&path).map_err(|_| AttachmentFailure::staging())?;
    }
    Ok(snapshots)
}

fn admitted_root_alias(
    source: &Path,
    configured: &Path,
    canonical_root: &Path,
) -> Result<Option<PathBuf>> {
    for root in [configured, canonical_root] {
        if source.starts_with(root) {
            return Ok(Some(root.to_path_buf()));
        }
    }
    // Find the outermost spelling of the admitted root. Choosing a nearer alias could
    // hide a symlink below that root, such as workspace/link-back-to-workspace/file.
    for ancestor in source.ancestors().collect::<Vec<_>>().into_iter().rev() {
        if fs::canonicalize(ancestor)? == canonical_root {
            return Ok(Some(ancestor.to_path_buf()));
        }
    }
    Ok(None)
}

fn path_value(path: &Path) -> Result<Value> {
    Ok(Value::String(
        path.to_str()
            .context(LocalAttachmentError::InvalidPath)?
            .to_string(),
    ))
}

fn create_private_directory(path: &Path, reuse: bool) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => Ok(()),
        Err(error) if reuse && error.kind() == std::io::ErrorKind::AlreadyExists => {
            LocalSnapshotRoot::open(path)?.validate()
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rovai_core::{
        builtin_tool_transport::{
            BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
            BuiltinToolLeaseContext, LocalIpcEndpoint,
        },
        local_attachment_snapshot::MAX_ATTACHMENT_BYTES,
    };

    struct Fixture {
        root: PathBuf,
        context: BuiltinToolCliContext,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("rovai-send-snapshot-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            for name in ["workspace", "run-tmp", "external"] {
                fs::create_dir(root.join(name)).unwrap();
            }
            let context = BuiltinToolCliContext {
                contract_version: BUILTIN_TOOL_CONTRACT_VERSION,
                ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                core_endpoint: LocalIpcEndpoint::UnixSocket {
                    path: root.join("core.sock").to_str().unwrap().to_string(),
                },
                process_id: "process".into(),
                process_token: "process-token".into(),
                lease: Some(BuiltinToolLeaseContext {
                    execution_root: root.join("workspace").to_str().unwrap().into(),
                    run_tmp: root.join("run-tmp").to_str().unwrap().into(),
                    lease_id: "lease".into(),
                    lease_generation: 1,
                    lease_token: "lease-token".into(),
                }),
            };
            Self { root, context }
        }
        fn file(&self, path: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }
        fn sparse(&self, path: &str, bytes: u64) -> PathBuf {
            let path = self.file(path, b"");
            fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_len(bytes)
                .unwrap();
            path
        }
        fn request_root(&self, id: &str) -> PathBuf {
            self.root.join("run-tmp/.send-import").join(id)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            remove_local_snapshot_tree(&self.root).unwrap();
        }
    }

    #[test]
    fn body_only_and_empty_files_do_not_require_attachment_roots() {
        let mut fixture = Fixture::new();
        fixture.context.lease = None;
        for mut input in [json!({"body":"text"}), json!({"body":"text","files":[]})] {
            let original = input.clone();
            stage_external_send_files(&mut input, &fixture.context, "unused").unwrap();
            assert_eq!(input, original);
        }
    }

    #[test]
    fn mixed_sources_keep_order_names_and_frozen_bytes_until_transport_finishes() {
        let fixture = Fixture::new();
        let first = fixture.file("external/a/report.txt", b"first");
        let second = fixture.file("external/b/report.txt", b"second");
        let workspace = fixture.file("workspace/local.txt", b"workspace");
        let run_tmp = fixture.file("run-tmp/local.txt", b"tmp");
        fixture.file("external/tree/nested/file.txt", b"directory");
        let mut input = json!({"files":[first,"./local.txt",second,run_tmp,fixture.root.join("external/tree")]});
        let id = uuid::Uuid::new_v4().to_string();
        let mut snapshots = stage_external_send_files(&mut input, &fixture.context, &id).unwrap();
        let paths = input["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| PathBuf::from(p.as_str().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(paths[0], fixture.request_root(&id).join("0/report.txt"));
        assert_eq!(paths[1], workspace);
        assert_eq!(paths[2], fixture.request_root(&id).join("2/report.txt"));
        assert_eq!(paths[3], run_tmp);
        assert_eq!(
            fs::read(paths[4].join("nested/file.txt")).unwrap(),
            b"directory"
        );
        fs::write(first, b"changed after staging").unwrap();
        assert_eq!(fs::read(&paths[0]).unwrap(), b"first");
        assert_eq!(fs::read(&paths[2]).unwrap(), b"second");
        assert!(!input.to_string().contains("external"));
        snapshots.retain_for_run();
        drop(snapshots);
        assert!(
            fixture.request_root(&id).exists(),
            "an uncertain IPC must retain its snapshot"
        );
        // Lease cleanup must be able to remove the frozen nested directory without touching its source.
        remove_local_snapshot_tree(&fixture.root.join("run-tmp")).unwrap();
        assert!(fixture.root.join("external/tree/nested/file.txt").exists());
        let mut input = json!({"files":[workspace]});
        // Restore the stable Run tmp name, as the next lease does.
        fs::create_dir(fixture.root.join("run-tmp")).unwrap();
        let snapshots = stage_external_send_files(
            &mut input,
            &fixture.context,
            &uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
        drop(snapshots);
        assert!(!fixture.root.join("run-tmp/.send-import").exists());
    }

    #[test]
    fn invalid_sources_and_promotion_collision_publish_nothing_and_cleanup_owned_staging() {
        let fixture = Fixture::new();
        let good = fixture.file("external/good.txt", b"good");
        let oversized = fixture.sparse("external/oversized.bin", MAX_ATTACHMENT_BYTES + 1);
        let cases = [
            (
                json!([good, fixture.root.join("external/missing.txt")]),
                "source_unavailable",
            ),
            (json!(["../external/good.txt"]), "invalid_path"),
            (json!([oversized]), "limit_exceeded"),
            (json!([good, good]), "invalid_path"),
        ];
        for (files, code) in cases {
            let mut input = json!({"files":files});
            let original = input.clone();
            let id = uuid::Uuid::new_v4().to_string();
            let error = stage_external_send_files(&mut input, &fixture.context, &id)
                .err()
                .unwrap();
            assert_eq!(error.code, code);
            assert_eq!(input, original);
            assert!(
                !error
                    .output()
                    .to_string()
                    .contains(fixture.root.to_str().unwrap())
            );
            assert!(!fixture.request_root(&id).exists());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let collision = fixture.request_root(&id);
        fs::create_dir_all(&collision).unwrap();
        fs::write(collision.join("keep.txt"), b"keep").unwrap();
        let mut input = json!({"files":[good]});
        let original = input.clone();
        assert!(stage_external_send_files(&mut input, &fixture.context, &id).is_err());
        assert_eq!(input, original);
        assert_eq!(fs::read(collision.join("keep.txt")).unwrap(), b"keep");
        assert!(
            !collision
                .parent()
                .unwrap()
                .join(format!(".{id}.staging"))
                .exists()
        );
    }

    #[test]
    fn quota_includes_internal_sources_but_directory_limit_is_not_per_file_limit() {
        let fixture = Fixture::new();
        let inside = fixture.sparse("workspace/inside.bin", MAX_ATTACHMENT_BYTES);
        let outside = fixture.sparse("external/outside.bin", MAX_ATTACHMENT_BYTES);
        let extra = fixture.sparse("run-tmp/extra.bin", 15 * 1024 * 1024);
        let mut input = json!({"files":[inside,outside,extra]});
        let error = stage_external_send_files(
            &mut input,
            &fixture.context,
            &uuid::Uuid::new_v4().to_string(),
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "limit_exceeded");
        assert!(!fixture.root.join("run-tmp/.send-import").exists());
        fixture.sparse("external/large-tree/a.bin", 13 * 1024 * 1024);
        fixture.sparse("external/large-tree/b.bin", 13 * 1024 * 1024);
        let mut input = json!({"files":[fixture.root.join("external/large-tree")]});
        let id = uuid::Uuid::new_v4().to_string();
        let mut snapshots = stage_external_send_files(&mut input, &fixture.context, &id).unwrap();
        assert_eq!(
            local_attachment_byte_size(Path::new(input["files"][0].as_str().unwrap())).unwrap(),
            26 * 1024 * 1024
        );
        snapshots.retain_for_run();
        snapshots.response_received();
        drop(snapshots);
        assert!(!fixture.request_root(&id).exists());
    }

    #[cfg(unix)]
    #[test]
    fn original_links_special_files_and_import_parent_redirects_are_rejected() {
        use std::{
            ffi::CString,
            os::unix::{ffi::OsStrExt, fs::symlink},
        };
        let fixture = Fixture::new();
        let good = fixture.file("external/good.txt", b"secret");
        for link in [
            "external/link.txt",
            "workspace/link.txt",
            "external/tree/link.txt",
        ] {
            let path = fixture.root.join(link);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            symlink(&good, path).unwrap();
        }
        symlink(
            fixture.root.join("external"),
            fixture.root.join("workspace/alias"),
        )
        .unwrap();
        symlink(
            fixture.root.join("external/a-target"),
            fixture.root.join("external/dir-link"),
        )
        .unwrap();
        fs::create_dir(fixture.root.join("external/a-target")).unwrap();
        let fifo = fixture.root.join("external/fifo");
        let fifo_c = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // The fixture path is a live NUL-terminated string and names no existing node.
        assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
        for source in [
            "external/link.txt",
            "workspace/link.txt",
            "external/tree",
            "workspace/alias/good.txt",
            "external/fifo",
            "external/dir-link/",
        ] {
            let mut input = json!({"files":[fixture.root.join(source)]});
            let error = stage_external_send_files(
                &mut input,
                &fixture.context,
                &uuid::Uuid::new_v4().to_string(),
            )
            .err()
            .unwrap();
            assert_eq!(error.code, "unsupported_type", "{source}");
        }
        // An alias above an admitted root is allowed, but must not hide links below it.
        let local = fixture.file("workspace/local.txt", b"local");
        symlink(&fixture.root, fixture.root.join("root-alias")).unwrap();
        symlink(
            fixture.root.join("workspace"),
            fixture.root.join("workspace/link-back"),
        )
        .unwrap();
        let mut input = json!({"files":[fixture.root.join("root-alias/workspace/local.txt")]});
        let snapshots = stage_external_send_files(
            &mut input,
            &fixture.context,
            &uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
        assert_eq!(input["files"], json!([local]));
        drop(snapshots);
        assert!(!fixture.root.join("run-tmp/.send-import").exists());
        for source in [
            "root-alias/workspace/alias/good.txt",
            "root-alias/workspace/link-back/local.txt",
        ] {
            let mut input = json!({"files":[fixture.root.join(source)]});
            let error = stage_external_send_files(
                &mut input,
                &fixture.context,
                &uuid::Uuid::new_v4().to_string(),
            )
            .err()
            .unwrap();
            assert_eq!(error.code, "unsupported_type", "{source}");
        }
        symlink(
            fixture.root.join("external"),
            fixture.root.join("run-tmp/.send-import"),
        )
        .unwrap();
        let mut input = json!({"files":[good]});
        assert!(
            stage_external_send_files(
                &mut input,
                &fixture.context,
                &uuid::Uuid::new_v4().to_string()
            )
            .is_err()
        );
        assert_eq!(fs::read(&good).unwrap(), b"secret");
        fs::remove_file(fixture.root.join("run-tmp/.send-import")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut input = json!({"files":[good]});
        let snapshots = stage_external_send_files(&mut input, &fixture.context, &id).unwrap();
        let sentinel = fixture.file(&format!("external/{id}/keep.txt"), b"unowned");
        fs::rename(
            fixture.root.join("run-tmp/.send-import"),
            fixture.root.join("run-tmp/original-import"),
        )
        .unwrap();
        symlink(
            fixture.root.join("external"),
            fixture.root.join("run-tmp/.send-import"),
        )
        .unwrap();
        drop(snapshots);
        assert_eq!(
            fs::read(sentinel).unwrap(),
            b"unowned",
            "cleanup must not follow a replaced import parent"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ipc_failure_cleans_unsent_snapshots_but_retains_unconfirmed_dispatches() {
        use super::super::{BuiltinToolIpcFailure, CORE_ATTEMPTS};
        use rovai_core::builtin_tool_transport::BuiltinToolIpcRequestBody;
        use std::{
            io::{BufRead, BufReader, Write},
            os::unix::net::UnixListener,
        };

        let cases: [(Option<&[u8]>, BuiltinToolIpcFailure, bool); 4] = [
            (None, BuiltinToolIpcFailure::BeforeDispatch, false),
            (
                Some(b"not-json\n"),
                BuiltinToolIpcFailure::Predictable,
                true,
            ),
            (Some(b"\xff\n"), BuiltinToolIpcFailure::Predictable, true),
            (Some(b""), BuiltinToolIpcFailure::OutcomeIndeterminate, true),
        ];
        for (reply, expected_failure, retained) in cases {
            let fixture = Fixture::new();
            let source = fixture.file("external/result.txt", b"keep source");
            let id = uuid::Uuid::new_v4().to_string();
            let mut input = json!({"files":[source]});
            let mut snapshots =
                stage_external_send_files(&mut input, &fixture.context, &id).unwrap();
            let request = BuiltinToolIpcRequest {
                ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                auth: fixture.context.auth().unwrap(),
                body: BuiltinToolIpcRequestBody::Invoke {
                    request_id: id.clone(),
                    operation: "camp.message.send".into(),
                    input,
                },
            };
            let socket = PathBuf::from("/tmp").join(format!("rv-snf-{}.sock", &id[..8]));
            let endpoint = LocalIpcEndpoint::UnixSocket {
                path: socket.to_str().unwrap().into(),
            };
            let server = reply.map(|reply| {
                let listener = UnixListener::bind(&socket).unwrap();
                std::thread::spawn(move || {
                    // Response loss exhausts retries; invalid replies fail on their first frame.
                    let attempts = if reply.is_empty() { CORE_ATTEMPTS } else { 1 };
                    for _ in 0..attempts {
                        let (stream, _) = listener.accept().unwrap();
                        stream
                            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                            .unwrap();
                        let mut stream = BufReader::new(stream);
                        let mut frame = String::new();
                        stream.read_line(&mut frame).unwrap();
                        stream.get_mut().write_all(reply).unwrap();
                    }
                })
            });
            assert_eq!(
                snapshots.send(&endpoint, &request).await.unwrap_err(),
                expected_failure
            );
            if let Some(server) = server {
                server.join().unwrap();
                fs::remove_file(socket).unwrap();
            }
            drop(snapshots);
            assert_eq!(fixture.request_root(&id).exists(), retained);
            assert_eq!(fs::read(source).unwrap(), b"keep source");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ipc_retry_reuses_snapshot_when_original_source_has_disappeared() {
        use rovai_core::builtin_tool_transport::{
            BuiltinToolInvocationEnvelope, BuiltinToolIpcRequest, BuiltinToolIpcRequestBody,
            BuiltinToolIpcResponse,
        };
        use std::{
            io::{BufRead, BufReader, Write},
            os::unix::net::UnixListener,
        };
        let fixture = Fixture::new();
        let source = fixture.file("external/result.txt", b"frozen result");
        let id = uuid::Uuid::new_v4().to_string();
        let mut input = json!({"files":[source]});
        let mut snapshots = stage_external_send_files(&mut input, &fixture.context, &id).unwrap();
        let snapshot_path = PathBuf::from(input["files"][0].as_str().unwrap());
        let socket = PathBuf::from("/tmp").join(format!("rv-snp-{}.sock", &id[..8]));
        let listener = UnixListener::bind(&socket).unwrap();
        let endpoint = LocalIpcEndpoint::UnixSocket {
            path: socket.to_str().unwrap().into(),
        };
        let request = BuiltinToolIpcRequest {
            ipc_protocol_version: BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
            auth: fixture.context.auth().unwrap(),
            body: BuiltinToolIpcRequestBody::Invoke {
                request_id: id.clone(),
                operation: "camp.message.send".into(),
                input,
            },
        };
        let expected = BuiltinToolIpcResponse::Envelope { envelope: BuiltinToolInvocationEnvelope::success(
            "camp.message.send", &id, json!({"messageId":"message", "agentAddressingMode":"public_only", "effectiveRecipients":[], "deliveryIds":[]})
        ).unwrap() };
        let response = serde_json::to_vec(&expected).unwrap();
        let server = std::thread::spawn(move || {
            let mut previous = String::new();
            // The first accepted dispatch loses its response; the second must use identical input/bytes.
            for attempt in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut stream = BufReader::new(stream);
                let mut frame = String::new();
                stream.read_line(&mut frame).unwrap();
                assert_eq!(fs::read(&snapshot_path).unwrap(), b"frozen result");
                assert!(!frame.contains(source.to_str().unwrap()));
                if attempt == 0 {
                    previous = frame;
                    fs::remove_file(&source).unwrap();
                } else {
                    assert_eq!(frame, previous);
                    stream.get_mut().write_all(&response).unwrap();
                    stream.get_mut().write_all(b"\n").unwrap();
                }
            }
        });
        let actual = snapshots.send(&endpoint, &request).await.unwrap();
        assert_eq!(actual, expected);
        server.join().unwrap();
        fs::remove_file(socket).unwrap();
        snapshots.response_received();
        drop(snapshots);
        assert!(!fixture.request_root(&id).exists());
    }
}
