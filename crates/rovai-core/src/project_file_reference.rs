//! User file identity, lock-free filesystem preflight, and Core-owned publication.
//! A locator is not an authorization token. Every operation starts from the target Thread binding.
use crate::{
    camp_content::{
        ComposerAtom, ComposerDocument, ComposerSegment, StructuredThreadMessageContent,
        StructuredThreadMessageSegment,
    },
    command::CommandHandlerResult,
    project_files::{self, Binding},
};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path},
};

pub const MAX_FILES: usize = 32;
pub fn validate_locator(raw: &str, label: &str) -> Result<()> {
    ensure!(
        !raw.is_empty() && raw.len() <= 16_384 && !raw.chars().any(char::is_control),
        "invalid_reference"
    );
    ensure!(
        !label.is_empty() && !label.chars().any(char::is_control),
        "invalid_reference"
    );
    Ok(())
}

/// Shared Markdown projection. The path is already canonicalized by Host; URL performs platform encoding.
pub fn render_link(path: &str, label: &str) -> Result<String> {
    // Windows canonicalize() may freeze a verbatim drive or UNC prefix.
    // The stored path stays untouched; file URIs use its ordinary path spelling.
    let unc;
    let path = if let Some(relative) = path.strip_prefix(r"\\?\UNC\") {
        unc = format!(r"\\{relative}");
        unc.as_str()
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(path)
    };
    let uri = if let Ok(uri) = url::Url::from_file_path(path) {
        uri
    } else {
        // Preserve frozen Windows path semantics when another host OS reads history.
        let mut uri = url::Url::parse("file:///")?;
        if path.as_bytes().get(1) == Some(&b':')
            && path.as_bytes()[0].is_ascii_alphabetic()
            && matches!(path.as_bytes().get(2), Some(b'/' | b'\\'))
        {
            uri.set_path(&format!("/{}", path.replace('\\', "/").replace('%', "%25")));
        } else if let Some(unc) = path.strip_prefix("\\\\") {
            let (host, relative) = unc.split_once('\\').context("invalid_reference")?;
            uri.set_host(Some(host))
                .map_err(|_| anyhow::anyhow!("invalid_reference"))?;
            uri.set_path(&format!(
                "/{}",
                relative.replace('\\', "/").replace('%', "%25")
            ));
        } else {
            anyhow::bail!("invalid_reference")
        }
        uri
    };
    let label: String = label
        .chars()
        .flat_map(|c| {
            if c.is_ascii_punctuation() {
                vec!['\\', c]
            } else if c.is_control() {
                vec![' ']
            } else {
                vec![c]
            }
        })
        .collect();
    // Markdown destinations also need parentheses encoded, independently of URL's path rules.
    Ok(format!(
        "[{label}]({})",
        uri.as_str().replace('(', "%28").replace(')', "%29")
    ))
}

#[derive(Clone)]
pub(crate) struct Resolved {
    pub(crate) raw: String,
    pub(crate) path: String,
    pub(crate) label: String,
}

pub(crate) fn resolve(binding: &Binding, raw: &str) -> Result<Resolved> {
    ensure!(!raw.is_empty() && raw.len() <= 16_384, "invalid_reference");
    let decoded = URL_SAFE_NO_PAD.decode(raw).context("invalid_reference")?;
    let (expected, relative): (String, String) =
        serde_json::from_slice(&decoded).context("invalid_reference")?;
    ensure!(
        !relative.is_empty()
            && !relative.chars().any(char::is_control)
            && Path::new(&relative)
                .components()
                .all(|c| matches!(c, Component::Normal(_))),
        "invalid_reference"
    );
    let (root, identity) = project_files::root(binding)?;
    ensure!(expected == identity, "root_changed");
    let path = fs::canonicalize(root.join(&relative)).map_err(|e| {
        anyhow::anyhow!(if e.kind() == std::io::ErrorKind::PermissionDenied {
            "unreadable"
        } else {
            "file_missing"
        })
    })?;
    ensure!(path.starts_with(&root), "outside_root");
    ensure!(path.is_file(), "not_regular_file");
    fs::File::open(&path).context("unreadable")?;
    Ok(Resolved {
        raw: raw.into(),
        path: path.to_str().context("invalid_reference")?.into(),
        label: relative,
    })
}
fn reason(error: &anyhow::Error) -> &str {
    [
        "invalid_reference",
        "thread_mismatch",
        "root_unavailable",
        "root_changed",
        "file_missing",
        "outside_root",
        "not_regular_file",
        "unreadable",
    ]
    .into_iter()
    .find(|name| error.chain().any(|cause| cause.to_string() == *name))
    .unwrap_or("invalid_reference")
}
fn rejection(index: usize, thread: &str, raw: &str, why: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "project_file_reference_unavailable",
        json!({"message":"文件引用不可用，请重新选择或移除", "segmentIndex":index, "kind":"project_file_reference", "threadId":thread, "rawReference":raw, "reason":why}),
    )
}

/// Not a DTO: only this module can construct a proof. Filesystem work finishes before the SQL transaction.
pub struct Preflight {
    thread: String,
    document: ComposerDocument,
    binding: Option<Binding>,
    files: HashMap<String, Resolved>,
    error: Option<CommandHandlerResult>,
}
impl Preflight {
    pub fn prepare(thread: String, document: &ComposerDocument, binding: Option<Binding>) -> Self {
        let mut proof = Self {
            thread,
            document: document.clone(),
            binding,
            files: HashMap::new(),
            error: None,
        };
        if let Err(error) = crate::camp_content::validate_composer_document(document) {
            proof.error = Some(CommandHandlerResult::rejected(
                "camp_message.invalid_content",
                json!({"message":error.to_string(), "segmentIndex":error.downcast_ref::<crate::camp_content::ContentSegmentError>().map(|error|error.segment_index).unwrap_or(document.segments.len().saturating_sub(1))}),
            ));
            return proof;
        }
        for (index, segment) in document.segments.iter().enumerate() {
            let ComposerSegment::Atom {
                atom:
                    ComposerAtom::ProjectFileReference {
                        thread_id,
                        raw_reference,
                        ..
                    },
            } = segment
            else {
                continue;
            };
            let result = if thread_id != &proof.thread {
                Err(anyhow::anyhow!("thread_mismatch"))
            } else if proof.files.contains_key(raw_reference) {
                continue;
            } else if proof.files.len() >= MAX_FILES {
                proof.error = Some(CommandHandlerResult::rejected(
                    "camp_message.invalid_content",
                    json!({"message":"每条消息最多引用 32 个不同文件", "segmentIndex":index}),
                ));
                break;
            } else {
                proof
                    .binding
                    .as_ref()
                    .context("root_unavailable")
                    .and_then(|binding| resolve(binding, raw_reference))
            };
            match result {
                Ok(file) => {
                    proof.files.insert(raw_reference.clone(), file);
                }
                Err(error) => {
                    proof.error = Some(rejection(index, thread_id, raw_reference, reason(&error)));
                    break;
                }
            }
        }
        proof
    }
    pub(crate) fn publish(
        &self,
        connection: &rusqlite::Connection,
        thread: &str,
        document: &ComposerDocument,
    ) -> Result<std::result::Result<StructuredThreadMessageContent, CommandHandlerResult>> {
        if document != &self.document {
            return Ok(Err(CommandHandlerResult::rejected(
                "camp_message.invalid_content",
                json!({"message":"File preflight belongs to another document", "segmentIndex":0}),
            )));
        }
        if let Some(error) = &self.error {
            return Ok(Err(error.clone()));
        }
        let mut content = vec![];
        for (index, segment) in document.segments.iter().enumerate() {
            if let ComposerSegment::Atom {
                atom:
                    ComposerAtom::ProjectFileReference {
                        thread_id,
                        raw_reference,
                        ..
                    },
            } = segment
            {
                if thread != self.thread
                    || thread_id != thread
                    || project_files::binding_from_connection(connection, thread).ok()
                        != self.binding
                {
                    return Ok(Err(rejection(
                        index,
                        thread_id,
                        raw_reference,
                        "root_changed",
                    )));
                }
                let Some(file) = self.files.get(raw_reference) else {
                    return Ok(Err(rejection(
                        index,
                        thread_id,
                        raw_reference,
                        "invalid_reference",
                    )));
                };
                content.push(StructuredThreadMessageSegment::ProjectFileReference {
                    thread_id: thread.into(),
                    raw_reference: file.raw.clone(),
                    path_at_send: file.path.clone(),
                    label_at_send: file.label.clone(),
                });
            } else {
                content.extend(crate::camp_content::composer_document_to_content(
                    &ComposerDocument {
                        version: 2,
                        segments: vec![segment.clone()],
                    },
                )?);
            }
        }
        if let Err(error) = crate::camp_content::validate_content(&content) {
            return Ok(Err(CommandHandlerResult::rejected(
                "camp_message.invalid_content",
                json!({"message":error.to_string(), "segmentIndex":error.downcast_ref::<crate::camp_content::ContentSegmentError>().map(|error|error.segment_index).unwrap_or(document.segments.len().saturating_sub(1))}),
            )));
        }
        Ok(Ok(crate::camp_content::normalize_content(content)))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveRequest {
    pub thread_id: String,
    pub references: Vec<Reference>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub thread_id: String,
    pub raw_reference: String,
}

/// Take this metadata snapshot under the short database lock, then resolve on a blocking worker.
pub fn bindings(
    connection: &rusqlite::Connection,
    request: &ResolveRequest,
) -> Result<HashMap<String, Binding>> {
    ensure!(
        request.references.len() <= MAX_FILES,
        "Too many project file references"
    );
    let target = project_files::binding_from_connection(connection, &request.thread_id)?;
    let mut bindings = HashMap::from([(request.thread_id.clone(), target)]);
    for reference in &request.references {
        if let Ok(binding) =
            project_files::binding_from_connection(connection, &reference.thread_id)
        {
            bindings.insert(reference.thread_id.clone(), binding);
        }
    }
    Ok(bindings)
}
pub fn resolve_references(request: ResolveRequest, bindings: HashMap<String, Binding>) -> Value {
    let mut cache = HashMap::new();
    let values: Vec<Value> = request.references.iter().map(|reference| {
        cache.entry((reference.thread_id.clone(), reference.raw_reference.clone())).or_insert_with(|| {
            let Some(target) = bindings.get(&request.thread_id) else { return json!({"status":"unavailable", "reason":"root_unavailable"}) };
            let Some(source) = bindings.get(&reference.thread_id) else { return json!({"status":"needs_reselect", "reason":"source_unavailable"}) };
            let file = match resolve(source, &reference.raw_reference) {
                Ok(file) => file,
                Err(error) => return json!({"status":"unavailable", "reason":reason(&error)}),
            };
            let raw = if reference.thread_id == request.thread_id { file.raw } else {
                if !project_files::same_effective_root(source, target).unwrap_or(false) { return json!({"status":"needs_reselect", "reason":"root_mismatch"}) }
                let Ok((_, identity)) = project_files::root(target) else { return json!({"status":"unavailable", "reason":"root_unavailable"}) };
                let raw = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&(identity, &file.label)).expect("locator serialization"));
                if let Err(error) = resolve(target, &raw) { return json!({"status":"unavailable", "reason":reason(&error)}) }
                raw
            };
            json!({"status":"available", "reference":{"type":"project_file_reference", "threadId":request.thread_id, "rawReference":raw, "labelFallback":file.label}})
        }).clone()
    }).collect();
    json!({"ok":true, "value":values})
}
