use std::collections::BTreeSet;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    db::Database,
    memory::{MemoryKind, MemoryScopeKind, MemoryService, MemoryView, RelationshipDirection},
    team_tool::{AuthenticatedTeamToolRun, TeamToolInvocationError, TeamToolService},
};

pub const MEMORY_SEARCH_TOOL_NAME: &str = "memory.search";
pub const MEMORY_READ_TOOL_NAME: &str = "memory.read";
pub const MEMORY_SEARCH_QUERY_MAX_BYTES: usize = 512;
pub const MEMORY_SEARCH_MAX_RESULTS: i64 = 6;
pub const MEMORY_SEARCH_SNIPPET_MAX_BYTES: usize = 256;
pub const MEMORY_SEARCH_ALL_SNIPPETS_MAX_BYTES: usize = 2_048;
pub const MEMORY_READ_MAX_IDS: usize = 4;
pub const MEMORY_READ_BODY_MAX_BYTES: usize = 8_192;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySearchInput {
    pub query: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchResult {
    pub memory_id: String,
    pub revision_id: String,
    pub kind: MemoryKind,
    pub retrieval_keys: Vec<String>,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchOutput {
    pub rovai_team_tool: &'static str,
    pub rovai_team_receipt: &'static str,
    pub results: Vec<MemorySearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryReadInput {
    pub memory_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCacheState {
    Current,
    RevisionChanged,
    Inactive,
    Deleted,
    AccessChanged,
    Unavailable,
}

impl MemoryCacheState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::RevisionChanged => "revision_changed",
            Self::Inactive => "inactive",
            Self::Deleted => "deleted",
            Self::AccessChanged => "access_changed",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReadResult {
    pub memory_id: String,
    pub cache_state: MemoryCacheState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<MemoryKind>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub retrieval_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReadOutput {
    pub rovai_team_tool: &'static str,
    pub rovai_team_receipt: &'static str,
    pub memories: Vec<MemoryReadResult>,
}

#[derive(Debug, Clone)]
pub struct MemoryRetrievalInvocation<T> {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: T,
}

#[derive(Debug, Clone)]
struct ReadIdentity {
    run: AuthenticatedTeamToolRun,
    native_binding_id: String,
    native_binding_generation: i64,
}

#[derive(Debug, Default)]
pub struct MemoryRetrievalService;

impl MemoryRetrievalService {
    pub fn search_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": MEMORY_SEARCH_QUERY_MAX_BYTES,
                    "description": "Specific text or Retrieval Keys to search in currently accessible active Memory."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MEMORY_SEARCH_MAX_RESULTS,
                    "default": MEMORY_SEARCH_MAX_RESULTS
                }
            }
        })
    }

    pub fn read_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["memoryIds"],
            "properties": {
                "memoryIds": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MEMORY_READ_MAX_IDS,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1},
                    "description": "Stable Memory IDs from the Entrypoint, memory.search, or an earlier memory.read."
                }
            }
        })
    }

    pub fn search(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemorySearchInput>,
    ) -> Result<MemorySearchOutput> {
        let identity = authenticate(database, invocation)?;
        let query = invocation.input.query.trim();
        if query.is_empty() || query.len() > MEMORY_SEARCH_QUERY_MAX_BYTES {
            return Err(tool_error(
                "memory.invalid_input",
                "query must contain 1 to 512 UTF-8 bytes",
            ));
        }
        let limit = invocation.input.limit.unwrap_or(MEMORY_SEARCH_MAX_RESULTS);
        if !(1..=MEMORY_SEARCH_MAX_RESULTS).contains(&limit) {
            return Err(tool_error(
                "memory.invalid_input",
                "limit must be between 1 and 6",
            ));
        }
        let search_status: String = database.connection().query_row(
            "SELECT status FROM memory_search_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        if search_status != "ready" {
            return Err(tool_error(
                "memory.search_unavailable",
                "Memory search index is unavailable and requires rebuild",
            ));
        }

        let accessible = accessible_active_memory_ids(database, &identity.run)?;
        if accessible.is_empty() {
            return Ok(MemorySearchOutput {
                rovai_team_tool: MEMORY_SEARCH_TOOL_NAME,
                rovai_team_receipt: "No currently accessible Memory matched.",
                results: Vec::new(),
            });
        }
        let accessible_json = serde_json::to_string(&accessible)?;
        let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
        let rows = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT memory_id, revision_id,
                       snippet(memory_fts, 3, '', '', '…', 32),
                       bm25(memory_fts, 0.0, 0.0, 6.0, 1.0)
                FROM memory_fts
                WHERE memory_fts MATCH ?1
                  AND memory_id IN (SELECT value FROM json_each(?2))
                ORDER BY 4, memory_id
                LIMIT ?3
                "#,
            )?;
            statement
                .query_map(params![fts_query, accessible_json, limit], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|error| {
                    tool_error(
                        "memory.search_unavailable",
                        &format!("Memory search failed closed: {error}"),
                    )
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut results = Vec::new();
        let mut snippet_budget = MEMORY_SEARCH_ALL_SNIPPETS_MAX_BYTES;
        let query_digest = sha256(query.as_bytes());
        for (memory_id, revision_id, raw_snippet) in rows {
            let Some(memory) = MemoryService::default().get(database, &memory_id)? else {
                mark_search_unavailable(database, "memory_fts_orphan")?;
                return Err(tool_error(
                    "memory.search_unavailable",
                    "Memory search index integrity check failed",
                ));
            };
            if memory.current_revision_id.as_deref() != Some(revision_id.as_str())
                || memory.lifecycle != "active"
            {
                mark_search_unavailable(database, "memory_fts_stale_revision")?;
                return Err(tool_error(
                    "memory.search_unavailable",
                    "Memory search index integrity check failed",
                ));
            }
            let snippet_limit = snippet_budget.min(MEMORY_SEARCH_SNIPPET_MAX_BYTES);
            let snippet = truncate_utf8(&raw_snippet, snippet_limit);
            snippet_budget = snippet_budget.saturating_sub(snippet.len());
            let kind = memory.kind.context("active Memory has no Kind")?;
            record_evidence(
                database,
                &identity,
                "search",
                Some(&query_digest),
                &memory_id,
                Some(&revision_id),
                MemoryCacheState::Current,
            )?;
            results.push(MemorySearchResult {
                memory_id,
                revision_id,
                kind,
                retrieval_keys: memory.current_retrieval_keys,
                snippet,
            });
        }
        Ok(MemorySearchOutput {
            rovai_team_tool: MEMORY_SEARCH_TOOL_NAME,
            rovai_team_receipt: "Search results are discovery hints; call memory.read before relying on content.",
            results,
        })
    }

    pub fn read(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryReadInput>,
    ) -> Result<MemoryReadOutput> {
        let identity = authenticate(database, invocation)?;
        if invocation.input.memory_ids.is_empty()
            || invocation.input.memory_ids.len() > MEMORY_READ_MAX_IDS
        {
            return Err(tool_error(
                "memory.invalid_input",
                "memory.read requires one to four Memory IDs",
            ));
        }
        let unique = invocation.input.memory_ids.iter().collect::<BTreeSet<_>>();
        if unique.len() != invocation.input.memory_ids.len()
            || invocation
                .input
                .memory_ids
                .iter()
                .any(|id| id.trim().is_empty())
        {
            return Err(tool_error(
                "memory.invalid_input",
                "Memory IDs must be unique and non-empty",
            ));
        }
        let mut results = Vec::new();
        let mut body_bytes = 0usize;
        for memory_id in &invocation.input.memory_ids {
            let evidence_revision = previous_authorized_revision(database, &identity, memory_id)?;
            let current = MemoryService::default().get(database, memory_id)?;
            let mut result = if let Some(memory) = current {
                let authorized = memory.lifecycle == "active"
                    && memory_accessible(database, &identity.run, &memory)?;
                if authorized {
                    let revision_id = memory
                        .current_revision_id
                        .clone()
                        .context("active Memory has no current Revision")?;
                    let body = memory
                        .current_body
                        .clone()
                        .context("active Memory has no current body")?;
                    body_bytes += body.len();
                    if body_bytes > MEMORY_READ_BODY_MAX_BYTES {
                        return Err(tool_error(
                            "memory.response_too_large",
                            "memory.read response exceeds 8 KiB",
                        ));
                    }
                    let state = if evidence_revision
                        .as_deref()
                        .is_some_and(|previous| previous != revision_id)
                    {
                        MemoryCacheState::RevisionChanged
                    } else {
                        MemoryCacheState::Current
                    };
                    MemoryReadResult {
                        memory_id: memory_id.clone(),
                        cache_state: state,
                        revision_id: Some(revision_id),
                        kind: memory.kind,
                        retrieval_keys: memory.current_retrieval_keys,
                        body: Some(body),
                    }
                } else if evidence_revision.is_some() {
                    let state = match memory.lifecycle.as_str() {
                        "retired" => MemoryCacheState::Inactive,
                        "forgotten" => MemoryCacheState::Deleted,
                        _ => MemoryCacheState::AccessChanged,
                    };
                    unavailable_result(memory_id, state)
                } else {
                    unavailable_result(memory_id, MemoryCacheState::Unavailable)
                }
            } else {
                unavailable_result(memory_id, MemoryCacheState::Unavailable)
            };
            record_evidence(
                database,
                &identity,
                "read",
                None,
                memory_id,
                result.revision_id.as_deref(),
                result.cache_state,
            )?;
            if result.body.is_none() {
                result.retrieval_keys.clear();
                result.kind = None;
                result.revision_id = None;
            }
            results.push(result);
        }
        Ok(MemoryReadOutput {
            rovai_team_tool: MEMORY_READ_TOOL_NAME,
            rovai_team_receipt: "Memory states were checked against current lifecycle and access.",
            memories: results,
        })
    }
}

fn authenticate<T>(
    database: &Database,
    invocation: &MemoryRetrievalInvocation<T>,
) -> Result<ReadIdentity> {
    let run = TeamToolService::default()
        .authenticate_read_binding(
            database,
            &invocation.native_binding_id,
            &invocation.binding_credential,
            &invocation.runtime_tool_call_id,
        )
        .map_err(map_read_error)?;
    let generation: i64 = database.connection().query_row(
        r#"
        SELECT conversation.native_binding_generation
        FROM agent_run
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE agent_run.id = ?1
          AND conversation.native_binding_id = ?2
        "#,
        params![run.agent_run_id, invocation.native_binding_id],
        |row| row.get(0),
    )?;
    if generation < 1 {
        return Err(tool_error(
            "memory.run_not_current",
            "Native Binding generation is unavailable",
        ));
    }
    Ok(ReadIdentity {
        run,
        native_binding_id: invocation.native_binding_id.clone(),
        native_binding_generation: generation,
    })
}

fn accessible_active_memory_ids(
    database: &Database,
    run: &AuthenticatedTeamToolRun,
) -> Result<Vec<String>> {
    Ok(MemoryService::default()
        .list(database)?
        .memories
        .into_iter()
        .filter(|memory| {
            memory.lifecycle == "active"
                && memory_accessible(database, run, memory).unwrap_or(false)
        })
        .map(|memory| memory.id)
        .collect())
}

fn memory_accessible(
    database: &Database,
    run: &AuthenticatedTeamToolRun,
    memory: &MemoryView,
) -> Result<bool> {
    match memory.scope {
        Some(MemoryScopeKind::Hearth) => Ok(true),
        Some(MemoryScopeKind::Companion) => {
            Ok(memory.companion_agent_profile_id.as_deref() == Some(run.agent_profile_id.as_str()))
        }
        Some(MemoryScopeKind::Relationship) => {
            if !memory
                .relationship_agent_profile_ids
                .iter()
                .any(|id| id == &run.agent_profile_id)
            {
                return Ok(false);
            }
            let counterparty = memory
                .relationship_agent_profile_ids
                .iter()
                .find(|id| *id != &run.agent_profile_id)
                .context("Relationship Memory has no counterparty")?;
            let present: bool = database.connection().query_row(
                r#"
                SELECT COUNT(*) = 1
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.agent_profile_id = ?2
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
                "#,
                params![run.camp_id, counterparty],
                |row| row.get(0),
            )?;
            Ok(present
                && (memory.direction == Some(RelationshipDirection::Mutual)
                    || (memory.direction == Some(RelationshipDirection::Directed)
                        && memory.directed_actor_agent_profile_id.as_deref()
                            == Some(run.agent_profile_id.as_str()))))
        }
        None => Ok(false),
    }
}

fn previous_authorized_revision(
    database: &Database,
    identity: &ReadIdentity,
    memory_id: &str,
) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT observed_revision_id
            FROM memory_access_evidence
            WHERE native_binding_id = ?1
              AND native_binding_generation = ?2
              AND memory_id = ?3
              AND observed_revision_id IS NOT NULL
              AND outcome IN ('current', 'revision_changed')
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            "#,
            params![
                identity.native_binding_id,
                identity.native_binding_generation,
                memory_id
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn record_evidence(
    database: &Database,
    identity: &ReadIdentity,
    evidence_kind: &str,
    query_digest: Option<&str>,
    memory_id: &str,
    revision_id: Option<&str>,
    outcome: MemoryCacheState,
) -> Result<()> {
    let authorization_basis_digest = sha256(
        format!(
            "{}\n{}\n{}\n{}",
            identity.run.agent_profile_id,
            identity.run.camp_id,
            identity.native_binding_id,
            identity.native_binding_generation
        )
        .as_bytes(),
    );
    database.connection().execute(
        r#"
        INSERT INTO memory_access_evidence(
            id, native_binding_id, native_binding_generation,
            agent_profile_id, camp_id, evidence_kind, query_digest,
            memory_id, observed_revision_id, authorization_basis_digest,
            outcome, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            Uuid::new_v4().to_string(),
            identity.native_binding_id,
            identity.native_binding_generation,
            identity.run.agent_profile_id,
            identity.run.camp_id,
            evidence_kind,
            query_digest,
            memory_id,
            revision_id,
            authorization_basis_digest,
            outcome.as_str(),
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn unavailable_result(memory_id: &str, state: MemoryCacheState) -> MemoryReadResult {
    MemoryReadResult {
        memory_id: memory_id.to_string(),
        cache_state: state,
        revision_id: None,
        kind: None,
        retrieval_keys: Vec::new(),
        body: None,
    }
}

fn mark_search_unavailable(database: &Database, diagnostic_code: &str) -> Result<()> {
    database.connection().execute(
        r#"
        UPDATE memory_search_state
        SET status = 'unavailable', diagnostic_code = ?1
        WHERE singleton = 1
        "#,
        [diagnostic_code],
    )?;
    Ok(())
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_string()
}

fn map_read_error(error: anyhow::Error) -> anyhow::Error {
    if let Some(invocation) = error.downcast_ref::<TeamToolInvocationError>() {
        return TeamToolInvocationError {
            code: invocation.code.clone(),
            message: invocation.message.clone(),
        }
        .into();
    }
    error
}

fn tool_error(code: &str, message: &str) -> anyhow::Error {
    TeamToolInvocationError {
        code: code.to_string(),
        message: message.to_string(),
    }
    .into()
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
