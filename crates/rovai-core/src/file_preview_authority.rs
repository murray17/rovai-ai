use std::path::{Component, Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    agent_run_file_change::{find_run_file_change_summary, read_run_file_changes},
    db::Database,
    managed_blob::ManagedBlobStore,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveFilePreviewSourceParams {
    pub kind: String,
    pub camp_id: String,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub raw_reference: Option<String>,
    #[serde(default)]
    pub agent_run_id: Option<String>,
    #[serde(default)]
    pub execution_epoch: Option<i64>,
    #[serde(default)]
    pub evidence_file_id: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResolvedFilePreviewSource {
    FileTarget {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "sourceIdentity")]
        source_identity: String,
        #[serde(rename = "rootPath")]
        root_path: String,
        #[serde(rename = "basePath")]
        base_path: String,
        #[serde(rename = "rawReference")]
        raw_reference: String,
        #[serde(rename = "allowChildren")]
        allow_children: bool,
    },
    EvidenceReview {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "agentRunId")]
        agent_run_id: String,
        #[serde(rename = "executionEpoch")]
        execution_epoch: i64,
        #[serde(rename = "evidenceFileId")]
        evidence_file_id: String,
    },
    EvidenceIdentityUnavailable {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "agentRunId")]
        agent_run_id: String,
        #[serde(rename = "executionEpoch")]
        execution_epoch: i64,
        #[serde(rename = "evidenceFileId")]
        evidence_file_id: String,
    },
}

fn required_bounded<'a>(value: Option<&'a str>, field: &str, maximum: usize) -> Result<&'a str> {
    let value = value.context(format!("{field} is required"))?.trim();
    if value.is_empty() || value.chars().count() > maximum || value.contains(['\0', '\r', '\n']) {
        anyhow::bail!("{field} is invalid");
    }
    Ok(value)
}

fn directory_camp_root(database: &Database, camp_id: &str) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT project_path
            FROM camp
            WHERE id = ?1
              AND activation_state = 'active'
              AND project_binding_kind = 'directory'
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to resolve the Camp workspace")
}

fn strip_balanced_reference_wrapper(value: &str) -> &str {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return value;
    };
    let expected = match first {
        '`' => '`',
        '"' => '"',
        '\'' => '\'',
        '(' => ')',
        '[' => ']',
        '{' => '}',
        '<' => '>',
        _ => return value,
    };
    value
        .strip_prefix(first)
        .and_then(|inner| inner.strip_suffix(expected))
        .unwrap_or(value)
}

fn reference_has_disallowed_scheme(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("file://") {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
    {
        return false;
    }
    let Some(colon) = value.find(':') else {
        return false;
    };
    let prefix = &value[..colon];
    !prefix.is_empty()
        && prefix.as_bytes()[0].is_ascii_alphabetic()
        && prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn plausible_file_reference(value: &str) -> bool {
    let value = strip_balanced_reference_wrapper(value.trim());
    !value.is_empty()
        && value.chars().count() <= 4_096
        && !value.contains(['\0', '\r', '\n'])
        && !reference_has_disallowed_scheme(value)
}

fn known_file_extension(value: &str) -> bool {
    const EXTENSIONS: &[&str] = &[
        "md",
        "markdown",
        "mdown",
        "mkd",
        "mdx",
        "html",
        "htm",
        "ts",
        "tsx",
        "mts",
        "cts",
        "js",
        "jsx",
        "mjs",
        "cjs",
        "py",
        "pyw",
        "pyi",
        "rb",
        "rake",
        "php",
        "lua",
        "rs",
        "go",
        "java",
        "kt",
        "kts",
        "swift",
        "dart",
        "c",
        "h",
        "cc",
        "cpp",
        "cxx",
        "hh",
        "hpp",
        "hxx",
        "cs",
        "m",
        "mm",
        "sh",
        "bash",
        "zsh",
        "fish",
        "ps1",
        "psm1",
        "bat",
        "cmd",
        "css",
        "scss",
        "sass",
        "less",
        "vue",
        "svelte",
        "hbs",
        "handlebars",
        "pug",
        "json",
        "jsonc",
        "json5",
        "yaml",
        "yml",
        "toml",
        "ini",
        "cfg",
        "conf",
        "env",
        "properties",
        "xml",
        "xsd",
        "xsl",
        "plist",
        "sql",
        "pgsql",
        "graphql",
        "gql",
        "cypher",
        "tf",
        "tfvars",
        "hcl",
        "proto",
        "csv",
        "tsv",
        "txt",
        "log",
        "diff",
        "patch",
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "avif",
        "bmp",
        "ico",
        "svg",
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "zip",
        "tar",
        "gz",
        "7z",
        "rar",
    ];
    let path = value
        .split(['?', '#'])
        .next()
        .unwrap_or(value)
        .trim_end_matches(|character: char| character.is_ascii_digit() || character == ':');
    path.rsplit_once('.')
        .is_some_and(|(_, extension)| EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

fn high_confidence_bare_reference(value: &str) -> bool {
    if !plausible_file_reference(value) {
        return false;
    }
    let value = strip_balanced_reference_wrapper(value.trim());
    let bytes = value.as_bytes();
    let non_relative = value.starts_with('/')
        || value.starts_with("~/")
        || value.starts_with("~\\")
        || value.starts_with("./")
        || value.starts_with(".\\")
        || value.starts_with("../")
        || value.starts_with("..\\")
        || value.starts_with("\\\\")
        || value.starts_with("//")
        || value.to_ascii_lowercase().starts_with("file:///")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'));
    non_relative
        || ((value.contains('/') || value.contains('\\'))
            && (known_file_extension(value)
                || value
                    .rsplit_once(':')
                    .is_some_and(|(_, line)| line.bytes().all(|byte| byte.is_ascii_digit()))))
}

fn path_boundary(character: Option<char>) -> bool {
    character.is_none_or(|value| {
        !(value.is_alphanumeric()
            || matches!(
                value,
                '.' | '_' | '@' | '%' | '+' | '-' | '/' | '\\' | ':' | '#' | '?' | '~'
            ))
    })
}

fn visible_markdown_without_fences(body: &str) -> String {
    let mut result = String::with_capacity(body.len());
    let mut fence: Option<char> = None;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some('`')
        } else if trimmed.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        if marker.is_some_and(|candidate| fence.is_none() || fence == Some(candidate)) {
            fence = if fence.is_some() { None } else { marker };
            result.push('\n');
            continue;
        }
        if fence.is_some() {
            result.push('\n');
        } else {
            result.push_str(line);
        }
    }
    result
}

fn markdown_segment_authorizes_reference(segment: &str, raw_reference: &str) -> bool {
    for (offset, _) in segment.match_indices(raw_reference) {
        let before = &segment[..offset];
        let after = &segment[offset + raw_reference.len()..];
        let markdown_destination = if before.ends_with("](<") {
            after.starts_with('>')
        } else if before.ends_with("](") {
            after.starts_with(')') || after.starts_with(char::is_whitespace)
        } else {
            false
        };
        if markdown_destination {
            return true;
        }
        if !high_confidence_bare_reference(raw_reference) {
            continue;
        }
        if path_boundary(before.chars().next_back()) && path_boundary(after.chars().next()) {
            return true;
        }
    }
    false
}

fn message_authorizes_reference(body: &str, raw_reference: &str) -> bool {
    if !plausible_file_reference(raw_reference) {
        return false;
    }
    let visible = visible_markdown_without_fences(body);
    for (index, segment) in visible.split('`').enumerate() {
        if index % 2 == 1 {
            if segment.trim() == raw_reference
                && (known_file_extension(raw_reference)
                    || high_confidence_bare_reference(raw_reference))
            {
                return true;
            }
            continue;
        }
        if markdown_segment_authorizes_reference(segment, raw_reference) {
            return true;
        }
    }
    false
}

fn message_source(
    database: &Database,
    camp_id: &str,
    message_id: &str,
    raw_reference: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let row = database
        .connection()
        .query_row(
            r#"
            SELECT message.body, message.source_agent_run_id,
                   camp.project_binding_kind, camp.project_path,
                   source_run.workspace_json
            FROM camp_message AS message
            JOIN camp ON camp.id = message.camp_id
            LEFT JOIN agent_run AS source_run ON source_run.id = message.source_agent_run_id
            WHERE message.id = ?1 AND message.camp_id = ?2
              AND message.tombstoned_at IS NULL
              AND camp.activation_state = 'active'
            "#,
            params![message_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .context("failed to resolve the CampMessage file reference")?;
    let Some((body, source_agent_run_id, binding_kind, project_path, workspace_json)) = row else {
        return Ok(None);
    };
    if !message_authorizes_reference(&body, raw_reference) {
        return Ok(None);
    }
    let run_root = workspace_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|workspace| {
            workspace
                .get("executionRoot")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .filter(|path| Path::new(path).is_absolute());
    let root_path = match run_root {
        Some(path) => path,
        None if binding_kind == "directory" && Path::new(&project_path).is_absolute() => {
            project_path
        }
        None => return Ok(None),
    };
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "message_reference".to_string(),
        source_identity: format!(
            "message:{message_id}:{}",
            source_agent_run_id.as_deref().unwrap_or("camp")
        ),
        base_path: root_path.clone(),
        root_path,
        raw_reference: raw_reference.to_string(),
        allow_children: true,
    }))
}

fn evidence_review(
    database: &Database,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_file_id: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let exists = find_run_file_change_summary(
        database.connection(),
        camp_id,
        agent_run_id,
        execution_epoch,
        evidence_file_id,
    )?
    .is_some();
    Ok(exists.then(|| ResolvedFilePreviewSource::EvidenceReview {
        camp_id: camp_id.to_string(),
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        evidence_file_id: evidence_file_id.to_string(),
    }))
}

fn evidence_current_file(
    database: &Database,
    blob_store: &ManagedBlobStore,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_file_id: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let unavailable = || ResolvedFilePreviewSource::EvidenceIdentityUnavailable {
        camp_id: camp_id.to_string(),
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        evidence_file_id: evidence_file_id.to_string(),
    };
    let Some(summary) = find_run_file_change_summary(
        database.connection(),
        camp_id,
        agent_run_id,
        execution_epoch,
        evidence_file_id,
    )?
    else {
        return Ok(None);
    };
    let detail =
        match read_run_file_changes(database, blob_store, camp_id, agent_run_id, execution_epoch) {
            Ok(detail) => detail,
            Err(_) => return Ok(Some(unavailable())),
        };
    let Some(detail_file) = detail
        .files
        .iter()
        .find(|file| file.evidence_file_id == evidence_file_id)
    else {
        return Ok(Some(unavailable()));
    };
    if detail_file.path != summary.path {
        return Ok(Some(unavailable()));
    }
    let path = Path::new(&summary.path);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Ok(Some(unavailable()));
    }
    let Some(root_path) = directory_camp_root(database, camp_id)? else {
        return Ok(Some(unavailable()));
    };
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "run_evidence".to_string(),
        source_identity: format!(
            "run-evidence:{agent_run_id}:{execution_epoch}:{evidence_file_id}"
        ),
        base_path: root_path.clone(),
        root_path,
        raw_reference: summary.path,
        allow_children: true,
    }))
}

pub fn resolve_file_preview_source(
    database: &Database,
    blob_store: &ManagedBlobStore,
    params: ResolveFilePreviewSourceParams,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let camp_id = required_bounded(Some(&params.camp_id), "campId", 128)?;
    match params.kind.as_str() {
        "camp_workspace" => {
            let raw_reference =
                required_bounded(params.raw_reference.as_deref(), "rawReference", 4_096)?;
            let Some(root_path) = directory_camp_root(database, camp_id)? else {
                return Ok(None);
            };
            Ok(Some(ResolvedFilePreviewSource::FileTarget {
                camp_id: camp_id.to_string(),
                source_kind: params.kind,
                source_identity: format!("camp:{camp_id}"),
                base_path: root_path.clone(),
                root_path,
                raw_reference: raw_reference.to_string(),
                allow_children: true,
            }))
        }
        "message_reference" => message_source(
            database,
            camp_id,
            required_bounded(params.message_id.as_deref(), "messageId", 128)?,
            required_bounded(params.raw_reference.as_deref(), "rawReference", 4_096)?,
        ),
        "run_evidence" if params.action.as_deref() == Some("review") => evidence_review(
            database,
            camp_id,
            required_bounded(params.agent_run_id.as_deref(), "agentRunId", 128)?,
            params
                .execution_epoch
                .context("executionEpoch is required")?,
            required_bounded(params.evidence_file_id.as_deref(), "evidenceFileId", 256)?,
        ),
        "run_evidence" if params.action.as_deref() == Some("open_current") => {
            evidence_current_file(
                database,
                blob_store,
                camp_id,
                required_bounded(params.agent_run_id.as_deref(), "agentRunId", 128)?,
                params
                    .execution_epoch
                    .context("executionEpoch is required")?,
                required_bounded(params.evidence_file_id.as_deref(), "evidenceFileId", 256)?,
            )
        }
        "run_evidence" => Ok(None),
        _ => anyhow::bail!("unsupported file preview source kind"),
    }
}

#[cfg(test)]
mod tests {
    use super::message_authorizes_reference;

    #[test]
    fn message_reference_requires_a_clickable_markdown_or_high_confidence_path_context() {
        assert!(message_authorizes_reference(
            "请看 [说明](README.md) 和 `notes.txt`。",
            "README.md"
        ));
        assert!(message_authorizes_reference(
            "请看 [说明](README.md) 和 `notes.txt`。",
            "notes.txt"
        ));
        assert!(message_authorizes_reference(
            "修改位于 ./src/app.ts:42。",
            "./src/app.ts:42"
        ));
        assert!(!message_authorizes_reference(
            "普通文字里提到了 README.md，但没有可点击语法。",
            "README.md"
        ));
        assert!(!message_authorizes_reference("请采用 `方案 B`。", "方案 B"));
    }

    #[test]
    fn message_reference_rejects_fenced_code_urls_and_partial_matches() {
        assert!(!message_authorizes_reference(
            "```text\n./src/app.ts\n```",
            "./src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "https://example.com/src/app.ts",
            "src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "prefix./src/app.ts-suffix",
            "./src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "[网页](https://example.com/src/app.ts)",
            "src/app.ts"
        ));
    }
}
