use std::collections::BTreeSet;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    db::Database,
    memory::{
        COMPANION_ACTIVE_BODY_MAX_BYTES, COMPANION_MAX_COUNT, HEARTH_ACTIVE_BODY_MAX_BYTES,
        HEARTH_MAX_COUNT, MEMORY_BODY_MAX_BYTES, MemoryKind, MemoryScopeKind, MemoryService,
        MemoryTarget, MemoryView as StoredMemoryView, RELATIONSHIP_PAIR_ACTIVE_BODY_MAX_BYTES,
        RELATIONSHIP_PAIR_MAX_COUNT, RelationshipDirection, canonicalize_memory_body,
        normalize_retrieval_keys,
    },
    team_tool::{AuthenticatedTeamToolRun, TeamToolInvocationError, TeamToolService},
};

pub const MEMORY_SEARCH_TOOL_NAME: &str = "memory.search";
pub const MEMORY_READ_TOOL_NAME: &str = "memory.read";
pub const MEMORY_VIEW_TOOL_NAME: &str = "memory.view";
pub const MEMORY_SEARCH_QUERY_MAX_BYTES: usize = 512;
pub const MEMORY_SEARCH_MAX_RESULTS: i64 = 6;
pub const MEMORY_SEARCH_SNIPPET_MAX_BYTES: usize = 256;
pub const MEMORY_SEARCH_ALL_SNIPPETS_MAX_BYTES: usize = 2_048;
pub const MEMORY_READ_MAX_IDS: usize = 4;
pub const MEMORY_READ_BODY_MAX_BYTES: usize = 8_192;
pub const MEMORY_VIEW_OUTPUT_MAX_BYTES: usize = 64 * 1_024;

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
    pub scope: MemoryScopeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counterparty_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<RelationshipDirection>,
    pub retrieval_keys: Vec<String>,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchOutput {
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
    pub target: Option<MemoryTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<MemoryKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_can_revise: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub retrieval_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReadOutput {
    pub memories: Vec<MemoryReadResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryViewInput {
    pub scope: MemoryScopeKind,
    pub counterparty_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryViewItem {
    pub target: MemoryTarget,
    pub kind: MemoryKind,
    pub retrieval_keys: Vec<String>,
    pub body: String,
    pub agent_can_revise: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryViewOutput {
    pub scope: MemoryScopeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counterparty_agent_id: Option<String>,
    pub complete: bool,
    pub item_count: usize,
    pub total_body_bytes: usize,
    pub items: Vec<MemoryViewItem>,
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

    pub fn view_input_schema() -> Value {
        json!({
            "oneOf": [
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["scope"],
                    "properties": {"scope": {"const": "hearth"}}
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["scope"],
                    "properties": {"scope": {"const": "companion"}}
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["scope", "counterpartyAgentId"],
                    "properties": {
                        "scope": {"const": "relationship"},
                        "counterpartyAgentId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Another present member of the current Camp."
                        }
                    }
                }
            ]
        })
    }

    pub fn search(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemorySearchInput>,
    ) -> Result<MemorySearchOutput> {
        self.search_authorized(database, invocation, None)
    }

    pub fn search_attested(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemorySearchInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<MemorySearchOutput> {
        self.search_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn search_authorized(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemorySearchInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<MemorySearchOutput> {
        let identity = authenticate(database, invocation, attested_run)?;
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
            let scope_identity = authorized_scope_identity(&memory, &identity.run.agent_id)?;
            record_evidence(
                database.connection(),
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
                scope: scope_identity.scope,
                counterparty_agent_id: scope_identity.counterparty_agent_id,
                direction: scope_identity.direction,
                retrieval_keys: memory.current_retrieval_keys,
                snippet,
            });
        }
        Ok(MemorySearchOutput { results })
    }

    pub fn read(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryReadInput>,
    ) -> Result<MemoryReadOutput> {
        self.read_authorized(database, invocation, None)
    }

    pub fn read_attested(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryReadInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<MemoryReadOutput> {
        self.read_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn read_authorized(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryReadInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<MemoryReadOutput> {
        let identity = authenticate(database, invocation, attested_run)?;
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
                    let target = authorized_target(&memory, &identity.run.agent_id)?;
                    let agent_can_revise = target.direction != Some(RelationshipDirection::Mutual);
                    MemoryReadResult {
                        memory_id: memory_id.clone(),
                        cache_state: state,
                        target: Some(target),
                        kind: memory.kind,
                        agent_can_revise: Some(agent_can_revise),
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
                database.connection(),
                &identity,
                "read",
                None,
                memory_id,
                result
                    .target
                    .as_ref()
                    .map(|target| target.revision_id.as_str()),
                result.cache_state,
            )?;
            if result.body.is_none() {
                result.retrieval_keys.clear();
                result.kind = None;
                result.target = None;
                result.agent_can_revise = None;
            }
            results.push(result);
        }
        Ok(MemoryReadOutput { memories: results })
    }

    pub fn view(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryViewInput>,
    ) -> Result<MemoryViewOutput> {
        self.view_authorized(database, invocation, None)
    }

    pub fn view_attested(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryViewInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<MemoryViewOutput> {
        self.view_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn view_authorized(
        &self,
        database: &mut Database,
        invocation: &MemoryRetrievalInvocation<MemoryViewInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<MemoryViewOutput> {
        validate_view_input(&invocation.input)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let identity = authenticate_on_connection(&transaction, invocation, attested_run)?;
        let counterparty = match invocation.input.scope {
            MemoryScopeKind::Relationship => {
                let counterparty = invocation
                    .input
                    .counterparty_agent_id
                    .as_deref()
                    .context("validated Relationship View has no counterparty")?;
                if counterparty == identity.run.agent_id
                    || !is_present_current_camp_member(
                        &transaction,
                        &identity.run.camp_id,
                        counterparty,
                    )?
                {
                    return Err(view_unavailable());
                }
                Some(counterparty)
            }
            MemoryScopeKind::Hearth | MemoryScopeKind::Companion => None,
        };
        let items = load_view_items(
            &transaction,
            invocation.input.scope,
            &identity.run.agent_id,
            counterparty,
        )?;
        let (max_items, max_body_bytes) = match invocation.input.scope {
            MemoryScopeKind::Hearth => (HEARTH_MAX_COUNT as usize, HEARTH_ACTIVE_BODY_MAX_BYTES),
            MemoryScopeKind::Companion => (
                COMPANION_MAX_COUNT as usize,
                COMPANION_ACTIVE_BODY_MAX_BYTES,
            ),
            MemoryScopeKind::Relationship => (
                RELATIONSHIP_PAIR_MAX_COUNT as usize,
                RELATIONSHIP_PAIR_ACTIVE_BODY_MAX_BYTES,
            ),
        };
        let total_body_bytes = items.iter().try_fold(0usize, |total, item| {
            total
                .checked_add(item.body.len())
                .context("Memory View body byte total overflowed")
        })?;
        if items.len() > max_items || total_body_bytes > max_body_bytes as usize {
            return Err(view_unavailable());
        }
        let output = MemoryViewOutput {
            scope: invocation.input.scope,
            counterparty_agent_id: counterparty.map(str::to_string),
            complete: true,
            item_count: items.len(),
            total_body_bytes,
            items,
        };
        let serialized = serde_json::to_vec(&output)?;
        if serialized.len() > MEMORY_VIEW_OUTPUT_MAX_BYTES {
            return Err(view_unavailable());
        }
        for item in &output.items {
            record_evidence(
                &transaction,
                &identity,
                "view",
                None,
                &item.target.memory_id,
                Some(&item.target.revision_id),
                MemoryCacheState::Current,
            )?;
        }
        transaction.commit()?;
        Ok(output)
    }
}

fn validate_view_input(input: &MemoryViewInput) -> Result<()> {
    match input.scope {
        MemoryScopeKind::Hearth | MemoryScopeKind::Companion => {
            if input.counterparty_agent_id.is_some() {
                return Err(tool_error(
                    "memory.invalid_input",
                    "Hearth and Companion View do not accept counterpartyAgentId",
                ));
            }
        }
        MemoryScopeKind::Relationship => {
            if input
                .counterparty_agent_id
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                return Err(tool_error(
                    "memory.invalid_input",
                    "Relationship View requires counterpartyAgentId",
                ));
            }
        }
    }
    Ok(())
}

fn load_view_items(
    connection: &Connection,
    scope: MemoryScopeKind,
    agent_id: &str,
    counterparty_agent_id: Option<&str>,
) -> Result<Vec<MemoryViewItem>> {
    let (sql, parameters): (&str, Vec<&str>) = match scope {
        MemoryScopeKind::Hearth => (
            r#"
            SELECT memory.id, memory.current_revision_id, memory.kind,
                   memory.relationship_direction, revision.body,
                   revision.body_utf8_bytes
            FROM memory
            JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.lifecycle_status = 'active'
              AND memory.scope_kind = 'hearth'
            ORDER BY CASE memory.kind
                         WHEN 'agreement' THEN 0
                         WHEN 'preference' THEN 1
                         WHEN 'lesson' THEN 2
                         ELSE 3
                     END,
                     memory.id
            "#,
            Vec::new(),
        ),
        MemoryScopeKind::Companion => (
            r#"
            SELECT memory.id, memory.current_revision_id, memory.kind,
                   memory.relationship_direction, revision.body,
                   revision.body_utf8_bytes
            FROM memory
            JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.lifecycle_status = 'active'
              AND memory.scope_kind = 'companion'
              AND memory.companion_agent_id = ?1
            ORDER BY CASE memory.kind
                         WHEN 'agreement' THEN 0
                         WHEN 'preference' THEN 1
                         WHEN 'lesson' THEN 2
                         ELSE 3
                     END,
                     memory.id
            "#,
            vec![agent_id],
        ),
        MemoryScopeKind::Relationship => {
            let counterparty =
                counterparty_agent_id.context("Relationship View query has no counterparty")?;
            let (low, high) = if agent_id < counterparty {
                (agent_id, counterparty)
            } else {
                (counterparty, agent_id)
            };
            (
                r#"
                SELECT memory.id, memory.current_revision_id, memory.kind,
                       memory.relationship_direction, revision.body,
                       revision.body_utf8_bytes
                FROM memory
                JOIN memory_revision AS revision
                  ON revision.id = memory.current_revision_id
                WHERE memory.lifecycle_status = 'active'
                  AND memory.scope_kind = 'relationship'
                  AND memory.relationship_agent_low_id = ?1
                  AND memory.relationship_agent_high_id = ?2
                  AND (
                        memory.relationship_direction = 'mutual'
                     OR (
                            memory.relationship_direction = 'directed'
                        AND memory.directed_actor_agent_id = ?3
                     )
                  )
                ORDER BY CASE memory.relationship_direction
                             WHEN 'directed' THEN 0
                             WHEN 'mutual' THEN 1
                             ELSE 2
                         END,
                         CASE memory.kind
                             WHEN 'agreement' THEN 0
                             WHEN 'lesson' THEN 1
                             ELSE 2
                         END,
                         memory.id
                "#,
                vec![low, high, agent_id],
            )
        }
    };
    let rows = {
        let mut statement = connection.prepare(sql)?;
        statement
            .query_map(rusqlite::params_from_iter(parameters), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    rows.into_iter()
        .map(
            |(memory_id, revision_id, kind, direction, body, stored_body_bytes)| {
                if stored_body_bytes != body.len() as i64
                    || !(1..=MEMORY_BODY_MAX_BYTES as i64).contains(&stored_body_bytes)
                    || canonicalize_memory_body(&body)
                        .map(|canonical| canonical != body)
                        .unwrap_or(true)
                {
                    return Err(view_unavailable());
                }
                let kind = MemoryKind::parse(&kind).map_err(|_| view_unavailable())?;
                let direction = direction
                    .as_deref()
                    .map(RelationshipDirection::parse)
                    .transpose()
                    .map_err(|_| view_unavailable())?;
                if (scope == MemoryScopeKind::Relationship) != direction.is_some()
                    || (scope == MemoryScopeKind::Relationship && kind == MemoryKind::Preference)
                {
                    return Err(view_unavailable());
                }
                let retrieval_keys = load_retrieval_keys(connection, &revision_id)?;
                if normalize_retrieval_keys(&retrieval_keys)
                    .map(|canonical| canonical != retrieval_keys)
                    .unwrap_or(true)
                {
                    return Err(view_unavailable());
                }
                Ok(MemoryViewItem {
                    target: MemoryTarget {
                        memory_id,
                        revision_id,
                        scope,
                        counterparty_agent_id: counterparty_agent_id.map(str::to_string),
                        direction,
                    },
                    kind,
                    retrieval_keys,
                    body,
                    agent_can_revise: direction != Some(RelationshipDirection::Mutual),
                })
            },
        )
        .collect()
}

fn is_present_current_camp_member(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<bool> {
    connection
        .query_row(
            r#"
            SELECT COUNT(*) = 1
            FROM camp_member
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_id = ?2
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![camp_id, agent_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn load_retrieval_keys(connection: &Connection, revision_id: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        r#"
        SELECT normalized_key
        FROM memory_revision_retrieval_key
        WHERE revision_id = ?1
        ORDER BY position
        "#,
    )?;
    statement
        .query_map([revision_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn view_unavailable() -> anyhow::Error {
    tool_error("memory.view_unavailable", "Memory View is unavailable")
}

#[derive(Debug)]
struct AuthorizedScopeIdentity {
    scope: MemoryScopeKind,
    counterparty_agent_id: Option<String>,
    direction: Option<RelationshipDirection>,
}

fn authorized_scope_identity(
    memory: &StoredMemoryView,
    agent_id: &str,
) -> Result<AuthorizedScopeIdentity> {
    let scope = memory.scope.context("active Memory has no Scope")?;
    match scope {
        MemoryScopeKind::Hearth | MemoryScopeKind::Companion => Ok(AuthorizedScopeIdentity {
            scope,
            counterparty_agent_id: None,
            direction: None,
        }),
        MemoryScopeKind::Relationship => {
            let counterparty_agent_id = memory
                .relationship_agent_ids
                .iter()
                .find(|candidate| candidate.as_str() != agent_id)
                .cloned()
                .context("authorized Relationship Memory has no counterparty")?;
            Ok(AuthorizedScopeIdentity {
                scope,
                counterparty_agent_id: Some(counterparty_agent_id),
                direction: memory.direction,
            })
        }
    }
}

fn authorized_target(memory: &StoredMemoryView, agent_id: &str) -> Result<MemoryTarget> {
    let scope_identity = authorized_scope_identity(memory, agent_id)?;
    Ok(MemoryTarget {
        memory_id: memory.id.clone(),
        revision_id: memory
            .current_revision_id
            .clone()
            .context("active Memory has no current Revision")?,
        scope: scope_identity.scope,
        counterparty_agent_id: scope_identity.counterparty_agent_id,
        direction: scope_identity.direction,
    })
}

fn authenticate<T>(
    database: &Database,
    invocation: &MemoryRetrievalInvocation<T>,
    attested_run: Option<(&str, i64)>,
) -> Result<ReadIdentity> {
    authenticate_on_connection(database.connection(), invocation, attested_run)
}

fn authenticate_on_connection<T>(
    connection: &Connection,
    invocation: &MemoryRetrievalInvocation<T>,
    attested_run: Option<(&str, i64)>,
) -> Result<ReadIdentity> {
    let team_tool = TeamToolService::default();
    let run = if let Some((agent_run_id, execution_epoch)) = attested_run {
        team_tool.authenticate_attested_binding_on_connection(
            connection,
            &invocation.native_binding_id,
            &invocation.binding_credential,
            &invocation.runtime_tool_call_id,
            agent_run_id,
            execution_epoch,
        )
    } else {
        team_tool.authenticate_read_binding_on_connection(
            connection,
            &invocation.native_binding_id,
            &invocation.binding_credential,
            &invocation.runtime_tool_call_id,
        )
    }
    .map_err(map_read_error)?;
    let generation: i64 = connection.query_row(
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
    memory: &StoredMemoryView,
) -> Result<bool> {
    match memory.scope {
        Some(MemoryScopeKind::Hearth) => Ok(true),
        Some(MemoryScopeKind::Companion) => {
            Ok(memory.companion_agent_id.as_deref() == Some(run.agent_id.as_str()))
        }
        Some(MemoryScopeKind::Relationship) => {
            if !memory
                .relationship_agent_ids
                .iter()
                .any(|id| id == &run.agent_id)
            {
                return Ok(false);
            }
            let counterparty = memory
                .relationship_agent_ids
                .iter()
                .find(|id| *id != &run.agent_id)
                .context("Relationship Memory has no counterparty")?;
            let present: bool = database.connection().query_row(
                r#"
                SELECT COUNT(*) = 1
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.agent_id = ?2
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
                        && memory.directed_actor_agent_id.as_deref()
                            == Some(run.agent_id.as_str()))))
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
    connection: &Connection,
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
            identity.run.agent_id,
            identity.run.camp_id,
            identity.native_binding_id,
            identity.native_binding_generation
        )
        .as_bytes(),
    );
    connection.execute(
        r#"
        INSERT INTO memory_access_evidence(
            id, native_binding_id, native_binding_generation,
            agent_id, camp_id, evidence_kind, query_digest,
            memory_id, observed_revision_id, authorization_basis_digest,
            outcome, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            Uuid::new_v4().to_string(),
            identity.native_binding_id,
            identity.native_binding_generation,
            identity.run.agent_id,
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
        target: None,
        kind: None,
        agent_can_revise: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::{canonicalize_memory_body, normalize_retrieval_keys};

    fn legal_extreme_view(
        scope: MemoryScopeKind,
        item_count: usize,
        body_bytes_per_item: usize,
        counterparty_agent_id: Option<&str>,
        direction: Option<RelationshipDirection>,
    ) -> MemoryViewOutput {
        let retrieval_keys =
            normalize_retrieval_keys(&["\"".repeat(16), "\\".repeat(16), "\"\\".repeat(8)])
                .unwrap();
        let identity_bits = usize::BITS as usize - (item_count - 1).leading_zeros() as usize;
        let items = (0..item_count)
            .map(|index| {
                let mut body = String::with_capacity(body_bytes_per_item);
                for bit in 0..identity_bits {
                    body.push(if index & (1 << bit) == 0 { '\\' } else { '"' });
                }
                body.push_str(&"\\".repeat(body_bytes_per_item - identity_bits));
                let body = canonicalize_memory_body(&body).unwrap();
                MemoryViewItem {
                    target: MemoryTarget {
                        memory_id: Uuid::from_u128(index as u128 + 1).to_string(),
                        revision_id: Uuid::from_u128(index as u128 + 101).to_string(),
                        scope,
                        counterparty_agent_id: counterparty_agent_id.map(str::to_string),
                        direction,
                    },
                    kind: if scope == MemoryScopeKind::Relationship {
                        MemoryKind::Agreement
                    } else {
                        MemoryKind::Preference
                    },
                    retrieval_keys: retrieval_keys.clone(),
                    body,
                    agent_can_revise: direction != Some(RelationshipDirection::Mutual),
                }
            })
            .collect::<Vec<_>>();
        MemoryViewOutput {
            scope,
            counterparty_agent_id: counterparty_agent_id.map(str::to_string),
            complete: true,
            item_count: items.len(),
            total_body_bytes: items.iter().map(|item| item.body.len()).sum(),
            items,
        }
    }

    #[test]
    fn every_legal_extreme_view_fits_the_production_minified_json_limit() {
        let cases = [
            legal_extreme_view(MemoryScopeKind::Hearth, 32, 512, None, None),
            legal_extreme_view(MemoryScopeKind::Companion, 32, 512, None, None),
            legal_extreme_view(
                MemoryScopeKind::Relationship,
                12,
                MEMORY_BODY_MAX_BYTES.min(1_024),
                Some("agent_9223372036854775807"),
                Some(RelationshipDirection::Directed),
            ),
        ];
        let expected_body_bytes = [
            HEARTH_ACTIVE_BODY_MAX_BYTES as usize,
            COMPANION_ACTIVE_BODY_MAX_BYTES as usize,
            RELATIONSHIP_PAIR_ACTIVE_BODY_MAX_BYTES as usize,
        ];
        for (output, expected_body_bytes) in cases.into_iter().zip(expected_body_bytes) {
            assert_eq!(output.total_body_bytes, expected_body_bytes);
            let encoded = serde_json::to_vec(&output).unwrap();
            assert!(
                encoded.len() <= MEMORY_VIEW_OUTPUT_MAX_BYTES,
                "legal extreme {:?} Memory View encoded to {} bytes, above {}",
                output.scope,
                encoded.len(),
                MEMORY_VIEW_OUTPUT_MAX_BYTES
            );
            assert_eq!(
                serde_json::from_slice::<Value>(&encoded).unwrap()["complete"],
                true
            );
        }
    }
}
