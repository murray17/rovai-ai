use std::collections::BTreeMap;

use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::db::Database;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticStatus {
    Ok,
    Attention,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticGroup {
    LocalDependencies,
    ManagedContent,
    AgentRuntimes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticFact {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticCheck {
    pub id: String,
    pub group: DiagnosticGroup,
    pub subject_kind: String,
    pub subject_id: Option<String>,
    pub label: String,
    pub status: DiagnosticStatus,
    pub code: String,
    pub detail: String,
    pub observed_at: String,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub facts: Vec<DiagnosticFact>,
}

impl DiagnosticCheck {
    pub fn new(
        id: impl Into<String>,
        group: DiagnosticGroup,
        subject_kind: impl Into<String>,
        label: impl Into<String>,
        status: DiagnosticStatus,
        code: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            group,
            subject_kind: subject_kind.into(),
            subject_id: None,
            label: label.into(),
            status,
            code: code.into(),
            detail: detail.into(),
            observed_at: Utc::now().to_rfc3339(),
            stale: false,
            facts: Vec::new(),
        }
    }

    pub fn with_subject_id(mut self, subject_id: impl Into<String>) -> Self {
        self.subject_id = Some(subject_id.into());
        self
    }

    pub fn with_observed_at(mut self, observed_at: impl Into<String>) -> Self {
        self.observed_at = observed_at.into();
        self
    }

    pub fn with_stale(mut self, stale: bool) -> Self {
        self.stale = stale;
        self
    }

    pub fn with_fact(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.facts.push(DiagnosticFact {
            key: key.into(),
            value: value.into(),
        });
        self
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticSummary {
    pub ok: usize,
    pub attention: usize,
    pub unknown: usize,
}

impl DiagnosticSummary {
    pub fn from_checks(checks: &[DiagnosticCheck]) -> Self {
        let mut summary = Self::default();
        for check in checks {
            match check.status {
                DiagnosticStatus::Ok => summary.ok += 1,
                DiagnosticStatus::Attention => summary.attention += 1,
                DiagnosticStatus::Unknown => summary.unknown += 1,
            }
        }
        summary
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsReport {
    pub schema_version: u32,
    pub checked_at: String,
    pub summary: DiagnosticSummary,
    pub checks: Vec<DiagnosticCheck>,
}

impl DiagnosticsReport {
    pub fn new(checks: Vec<DiagnosticCheck>) -> Self {
        Self {
            schema_version: 1,
            checked_at: Utc::now().to_rfc3339(),
            summary: DiagnosticSummary::from_checks(&checks),
            checks,
        }
    }
}

pub fn database_integrity_check(database: &Database) -> DiagnosticCheck {
    let checked_at = Utc::now().to_rfc3339();
    match read_quick_check(database) {
        Ok(rows) if rows.len() == 1 && rows[0] == "ok" => DiagnosticCheck::new(
            "database",
            DiagnosticGroup::LocalDependencies,
            "database",
            "SQLite",
            DiagnosticStatus::Ok,
            "database_quick_check_ok",
            "SQLite quick_check completed successfully",
        )
        .with_observed_at(checked_at)
        .with_fact("quickCheck", "ok"),
        Ok(rows) => DiagnosticCheck::new(
            "database",
            DiagnosticGroup::LocalDependencies,
            "database",
            "SQLite",
            DiagnosticStatus::Attention,
            "database_integrity_issue",
            "SQLite quick_check reported an integrity problem",
        )
        .with_observed_at(checked_at)
        .with_fact("quickCheckResultCount", rows.len().to_string()),
        Err(error) => DiagnosticCheck::new(
            "database",
            DiagnosticGroup::LocalDependencies,
            "database",
            "SQLite",
            DiagnosticStatus::Unknown,
            "database_quick_check_failed",
            "SQLite integrity could not be confirmed",
        )
        .with_observed_at(checked_at)
        .with_fact("errorClass", diagnostic_error_class(&error)),
    }
}

fn read_quick_check(database: &Database) -> Result<Vec<String>> {
    let mut statement = database.connection().prepare("PRAGMA quick_check")?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn diagnostic_error_class(error: &anyhow::Error) -> String {
    error
        .chain()
        .last()
        .map(|cause| cause.to_string())
        .filter(|message| !message.trim().is_empty())
        .map(|_| "diagnostic_read_failed".to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn diagnostics_export_v5(
    app_version: &str,
    report: &DiagnosticsReport,
    aggregate: Value,
) -> Value {
    let value = json!({
        "format": "rovai-diagnostics-v5",
        "exportedAt": Utc::now().to_rfc3339(),
        "appVersion": app_version,
        "redaction": {
            "absolutePaths": "removed",
            "sensitiveValues": "removed",
            "excluded": [
                "tokens",
                "cookies",
                "login_data",
                "messages",
                "memory_bodies",
                "attachment_bodies",
                "tool_outputs"
            ]
        },
        "diagnostics": report,
        "aggregate": aggregate,
    });
    redact_diagnostics_value(value)
}

pub fn redact_diagnostics_value(value: Value) -> Value {
    redact_value(value, None)
}

fn redact_value(value: Value, key: Option<&str>) -> Value {
    match value {
        Value::Object(object) => Value::Object(redact_object(object)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| redact_value(value, key))
                .collect(),
        ),
        Value::String(_) if key.is_some_and(sensitive_key) => {
            Value::String("<redacted>".to_string())
        }
        Value::String(value) if looks_like_absolute_path(&value) => {
            Value::String("<absolute-path-redacted>".to_string())
        }
        other => other,
    }
}

fn redact_object(object: Map<String, Value>) -> Map<String, Value> {
    object
        .into_iter()
        .map(|(key, value)| {
            let redacted = if sensitive_key(&key) {
                Value::String("<redacted>".to_string())
            } else {
                redact_value(value, Some(&key))
            };
            (key, redacted)
        })
        .collect()
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    [
        "token",
        "cookie",
        "secret",
        "credential",
        "authorization",
        "password",
        "executablepath",
        "projectpath",
        "workspacepath",
        "databasedirectory",
        "databasedir",
        "databasedpath",
        "databasepath",
        "sourcepath",
        "entrypath",
        "executionroot",
    ]
    .iter()
    .any(|candidate| normalized.contains(candidate))
}

fn looks_like_absolute_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("file://")
        || (value.len() > 2
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'/' | b'\\'))
}

pub fn aggregate_counts(entries: impl IntoIterator<Item = (&'static str, usize)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), Value::from(value)))
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn report_counts_each_public_status() {
        let checks = vec![
            DiagnosticCheck::new(
                "ok",
                DiagnosticGroup::LocalDependencies,
                "fixture",
                "OK",
                DiagnosticStatus::Ok,
                "ok",
                "ok",
            ),
            DiagnosticCheck::new(
                "attention",
                DiagnosticGroup::ManagedContent,
                "fixture",
                "Attention",
                DiagnosticStatus::Attention,
                "attention",
                "attention",
            ),
            DiagnosticCheck::new(
                "unknown",
                DiagnosticGroup::AgentRuntimes,
                "fixture",
                "Unknown",
                DiagnosticStatus::Unknown,
                "unknown",
                "unknown",
            ),
        ];
        assert_eq!(
            DiagnosticsReport::new(checks).summary,
            DiagnosticSummary {
                ok: 1,
                attention: 1,
                unknown: 1,
            }
        );
    }

    #[test]
    fn database_check_is_read_only_and_reports_ok() {
        let root = std::env::temp_dir().join(format!("rovai-diagnostics-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = Database::open(&root).unwrap();
        let before = fs::metadata(database.path()).unwrap().len();
        let check = database_integrity_check(&database);
        let after = fs::metadata(database.path()).unwrap().len();
        assert_eq!(check.status, DiagnosticStatus::Ok);
        assert_eq!(check.code, "database_quick_check_ok");
        assert_eq!(before, after);
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_v5_removes_absolute_paths_and_sensitive_values() {
        let report = DiagnosticsReport::new(vec![
            DiagnosticCheck::new(
                "runtime:codex-cli",
                DiagnosticGroup::AgentRuntimes,
                "runtime",
                "Codex CLI",
                DiagnosticStatus::Ok,
                "runtime_ready",
                "/Users/example/.local/bin/codex",
            )
            .with_fact("entryPath", "/Users/example/project/.codex/skills/demo")
            .with_fact("reportedVersion", "1.2.3"),
        ]);
        let exported = diagnostics_export_v5(
            "0.0.1",
            &report,
            json!({
                "databasePath": "/Users/example/Library/Application Support/Rovai-ai/rovai.db",
                "token": "secret",
                "count": 2,
            }),
        );
        let serialized = serde_json::to_string(&exported).unwrap();
        assert!(serialized.contains("rovai-diagnostics-v5"));
        assert!(serialized.contains("1.2.3"));
        assert!(!serialized.contains("/Users/example"));
        assert!(!serialized.contains("secret"));
    }
}
