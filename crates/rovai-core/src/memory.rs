//! Single-effective-state Memory lifecycle and provenance domain for v0.21.

use std::collections::BTreeSet;

use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    collaboration::append_domain_event,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
    memory_secret,
};

pub const MEMORY_BODY_MAX_BYTES: usize = 2_048;
pub const MEMORY_RETRIEVAL_KEY_MIN_BYTES: usize = 2;
pub const MEMORY_RETRIEVAL_KEY_MAX_BYTES: usize = 24;
pub const MEMORY_RETRIEVAL_KEYS_TOTAL_MAX_BYTES: usize = 48;
pub const MEMORY_AGENT_MUTATIONS_PER_RUN: i64 = 4;
pub const HEARTH_MAX_COUNT: i64 = 32;
pub const COMPANION_MAX_COUNT: i64 = 32;
pub const RELATIONSHIP_PAIR_MAX_COUNT: i64 = 12;
pub const RELATIONSHIP_APPLICABLE_MAX_COUNT: i64 = 48;
pub const AGENT_COMPANION_MAX_COUNT: i64 = 8;
pub const AGENT_RELATIONSHIP_PAIR_MAX_COUNT: i64 = 4;
pub const AGENT_RELATIONSHIP_APPLICABLE_MAX_COUNT: i64 = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScopeKind {
    Hearth,
    Companion,
    Relationship,
}

impl MemoryScopeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hearth => "hearth",
            Self::Companion => "companion",
            Self::Relationship => "relationship",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "hearth" => Ok(Self::Hearth),
            "companion" => Ok(Self::Companion),
            "relationship" => Ok(Self::Relationship),
            _ => anyhow::bail!("unknown Memory scope: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Preference,
    Agreement,
    Lesson,
}

impl MemoryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Preference => "preference",
            Self::Agreement => "agreement",
            Self::Lesson => "lesson",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "preference" => Ok(Self::Preference),
            "agreement" => Ok(Self::Agreement),
            "lesson" => Ok(Self::Lesson),
            _ => anyhow::bail!("unknown Memory kind: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipDirection {
    Mutual,
    Directed,
}

impl RelationshipDirection {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mutual => "mutual",
            Self::Directed => "directed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "mutual" => Ok(Self::Mutual),
            "directed" => Ok(Self::Directed),
            _ => anyhow::bail!("unknown Relationship direction: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCreationOrigin {
    User,
    Agent,
    AcceptedHearthReview,
}

impl MemoryCreationOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::AcceptedHearthReview => "accepted_hearth_review",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "user" => Ok(Self::User),
            "agent" => Ok(Self::Agent),
            "accepted_hearth_review" => Ok(Self::AcceptedHearthReview),
            _ => anyhow::bail!("unknown Memory creation origin: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryRevisionActorKind {
    User,
    Agent,
}

impl MemoryRevisionActorKind {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "user" => Ok(Self::User),
            "agent" => Ok(Self::Agent),
            _ => anyhow::bail!("unknown Memory Revision actor kind: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryScope {
    pub kind: MemoryScopeKind,
    pub companion_agent_id: Option<String>,
    pub relationship_agent_low_id: Option<String>,
    pub relationship_agent_high_id: Option<String>,
    pub relationship_direction: Option<RelationshipDirection>,
    pub directed_actor_agent_id: Option<String>,
}

impl MemoryScope {
    fn hearth() -> Self {
        Self {
            kind: MemoryScopeKind::Hearth,
            companion_agent_id: None,
            relationship_agent_low_id: None,
            relationship_agent_high_id: None,
            relationship_direction: None,
            directed_actor_agent_id: None,
        }
    }

    fn companion(agent_id: String) -> Self {
        Self {
            kind: MemoryScopeKind::Companion,
            companion_agent_id: Some(agent_id),
            relationship_agent_low_id: None,
            relationship_agent_high_id: None,
            relationship_direction: None,
            directed_actor_agent_id: None,
        }
    }

    fn relationship(
        first: String,
        second: String,
        direction: RelationshipDirection,
        directed_actor: Option<String>,
    ) -> Result<Self> {
        if first.trim().is_empty() || second.trim().is_empty() || first == second {
            anyhow::bail!("memory.invalid_input: Relationship requires two different Agents");
        }
        let (low, high) = if first < second {
            (first, second)
        } else {
            (second, first)
        };
        let directed_actor = match direction {
            RelationshipDirection::Mutual => {
                if directed_actor.is_some() {
                    anyhow::bail!("memory.invalid_input: mutual Relationship has no actor");
                }
                None
            }
            RelationshipDirection::Directed => {
                let actor = directed_actor
                    .context("memory.invalid_input: directed Relationship requires actor")?;
                if actor != low && actor != high {
                    anyhow::bail!("memory.invalid_input: directed actor must be in the pair");
                }
                Some(actor)
            }
        };
        Ok(Self {
            kind: MemoryScopeKind::Relationship,
            companion_agent_id: None,
            relationship_agent_low_id: Some(low),
            relationship_agent_high_id: Some(high),
            relationship_direction: Some(direction),
            directed_actor_agent_id: directed_actor,
        })
    }

    fn same_identity(&self, other: &Self) -> bool {
        self == other
    }

    fn contains_agent(&self, agent_id: &str) -> bool {
        self.companion_agent_id.as_deref() == Some(agent_id)
            || self.relationship_agent_low_id.as_deref() == Some(agent_id)
            || self.relationship_agent_high_id.as_deref() == Some(agent_id)
    }

    fn counterparty(&self, agent_id: &str) -> Option<&str> {
        if self.relationship_agent_low_id.as_deref() == Some(agent_id) {
            self.relationship_agent_high_id.as_deref()
        } else if self.relationship_agent_high_id.as_deref() == Some(agent_id) {
            self.relationship_agent_low_id.as_deref()
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryCommand {
    pub scope: MemoryScopeKind,
    pub kind: MemoryKind,
    pub body: String,
    pub retrieval_keys: Vec<String>,
    pub companion_agent_id: Option<String>,
    #[serde(default)]
    pub relationship_agent_ids: Vec<String>,
    pub direction: Option<RelationshipDirection>,
    pub directed_actor_agent_id: Option<String>,
    pub review_after: Option<String>,
}

impl sealed::Sealed for CreateMemoryCommand {}
impl DomainCommand for CreateMemoryCommand {
    const TYPE: &'static str = "memory.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
    pub base_revision_id: String,
    pub body: String,
    pub retrieval_keys: Vec<String>,
    pub review_after: Option<String>,
}

impl sealed::Sealed for ReviseMemoryCommand {}
impl DomainCommand for ReviseMemoryCommand {
    const TYPE: &'static str = "memory.revise";
}

macro_rules! memory_version_command {
    ($name:ident, $command_type:literal) => {
        #[derive(Debug, Clone, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            pub memory_id: String,
            pub expected_version: i64,
        }
        impl sealed::Sealed for $name {}
        impl DomainCommand for $name {
            const TYPE: &'static str = $command_type;
        }
    };
}

memory_version_command!(RetireMemoryCommand, "memory.retire");
memory_version_command!(ReactivateMemoryCommand, "memory.reactivate");
memory_version_command!(ForgetMemoryCommand, "memory.forget");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleMemoryReviewCommand {
    pub memory_id: String,
    pub expected_version: i64,
    pub review_after: Option<String>,
}

impl sealed::Sealed for ScheduleMemoryReviewCommand {}
impl DomainCommand for ScheduleMemoryReviewCommand {
    const TYPE: &'static str = "memory.review.schedule";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SupersessionSuccessor {
    Existing {
        memory_id: String,
        expected_version: i64,
    },
    Create {
        candidate: CreateMemoryCommand,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryVersionRef {
    pub memory_id: String,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupersedeMemoriesCommand {
    pub predecessors: Vec<MemoryVersionRef>,
    pub successor: SupersessionSuccessor,
}

impl sealed::Sealed for SupersedeMemoriesCommand {}
impl DomainCommand for SupersedeMemoriesCommand {
    const TYPE: &'static str = "memory.supersede";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMemoryWriteCommand {
    pub action: String,
    pub scope: Option<MemoryScopeKind>,
    pub kind: Option<MemoryKind>,
    pub body: String,
    pub retrieval_keys: Vec<String>,
    pub counterparty_agent_id: Option<String>,
    pub direction: Option<RelationshipDirection>,
    pub memory_id: Option<String>,
    pub base_revision_id: Option<String>,
}

impl sealed::Sealed for AgentMemoryWriteCommand {}
impl DomainCommand for AgentMemoryWriteCommand {
    const TYPE: &'static str = "memory.write";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptHearthReviewItemCommand {
    pub review_item_id: String,
    pub expected_review_item_version: i64,
    pub final_body: Option<String>,
    pub final_retrieval_keys: Option<Vec<String>>,
}

impl sealed::Sealed for AcceptHearthReviewItemCommand {}
impl DomainCommand for AcceptHearthReviewItemCommand {
    const TYPE: &'static str = "memory.hearth_review.accept";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RejectHearthReviewItemCommand {
    pub review_item_id: String,
    pub expected_review_item_version: i64,
}

impl sealed::Sealed for RejectHearthReviewItemCommand {}
impl DomainCommand for RejectHearthReviewItemCommand {
    const TYPE: &'static str = "memory.hearth_review.reject";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRevisionView {
    pub id: String,
    pub body: Option<String>,
    pub body_utf8_bytes: Option<i64>,
    pub retrieval_keys: Vec<String>,
    pub actor_kind: Option<MemoryRevisionActorKind>,
    pub actor_id: Option<String>,
    pub source_camp_id: Option<String>,
    pub source_agent_run_id: Option<String>,
    pub source_execution_epoch: Option<i64>,
    pub created_from_hearth_review_item_id: Option<String>,
    pub created_at: String,
    pub cleared_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryView {
    pub id: String,
    pub scope: Option<MemoryScopeKind>,
    pub kind: Option<MemoryKind>,
    pub creation_origin: Option<MemoryCreationOrigin>,
    pub companion_agent_id: Option<String>,
    pub relationship_agent_ids: Vec<String>,
    pub direction: Option<RelationshipDirection>,
    pub directed_actor_agent_id: Option<String>,
    pub lifecycle: String,
    pub current_revision_id: Option<String>,
    pub current_body: Option<String>,
    pub current_body_utf8_bytes: Option<i64>,
    pub current_retrieval_keys: Vec<String>,
    pub review_after: Option<String>,
    pub review_due: bool,
    pub outgoing_successor_ids: Vec<String>,
    pub incoming_predecessor_ids: Vec<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub retired_at: Option<String>,
    pub forgotten_at: Option<String>,
    pub revisions: Vec<MemoryRevisionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCapacityView {
    pub scope: MemoryScopeKind,
    pub scope_key: String,
    pub active_count: i64,
    pub max_count: i64,
    pub agent_origin_count: i64,
    pub agent_origin_max_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListView {
    pub memories: Vec<MemoryView>,
    pub capacities: Vec<MemoryCapacityView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HearthReviewItemView {
    pub review_item_id: String,
    pub requested_action: String,
    pub status: String,
    pub candidate_kind: Option<MemoryKind>,
    pub candidate_body: Option<String>,
    pub candidate_retrieval_keys: Option<Vec<String>>,
    pub target_memory_id: Option<String>,
    pub base_revision_id: Option<String>,
    pub source_agent_id: String,
    pub source_camp_id: String,
    pub source_agent_run_id: String,
    pub source_execution_epoch: i64,
    pub stale: bool,
    pub accepted_memory_id: Option<String>,
    pub accepted_revision_id: Option<String>,
    pub resolved_by_user_id: Option<String>,
    pub invalidation_reason: Option<String>,
    pub edited_before_acceptance: Option<bool>,
    pub version: i64,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedMemoryEntry {
    pub memory_id: String,
    pub revision_id: String,
    pub kind: MemoryKind,
    pub direction: Option<RelationshipDirection>,
    pub retrieval_keys: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone)]
struct MemoryRecord {
    id: String,
    scope: Option<MemoryScope>,
    kind: Option<MemoryKind>,
    creation_origin: Option<MemoryCreationOrigin>,
    lifecycle: String,
    current_revision_id: Option<String>,
    current_body: Option<String>,
    current_body_utf8_bytes: Option<i64>,
    review_after: Option<String>,
    version: i64,
    created_at: String,
    updated_at: String,
    retired_at: Option<String>,
    forgotten_at: Option<String>,
}

#[derive(Debug, Clone)]
struct Candidate {
    scope: MemoryScope,
    kind: MemoryKind,
    body: String,
    body_bytes: i64,
    retrieval_keys: Vec<String>,
    review_after: Option<String>,
}

#[derive(Debug, Clone)]
struct RevisionActor {
    kind: MemoryRevisionActorKind,
    actor_id: String,
    source_camp_id: Option<String>,
    source_agent_run_id: Option<String>,
    source_execution_epoch: Option<i64>,
}

#[derive(Debug, Clone)]
struct HearthReviewRecord {
    id: String,
    action: String,
    status: String,
    kind: Option<MemoryKind>,
    body: Option<String>,
    retrieval_keys: Option<Vec<String>>,
    target_memory_id: Option<String>,
    base_revision_id: Option<String>,
    source_agent_id: String,
    source_camp_id: String,
    source_agent_run_id: String,
    source_execution_epoch: i64,
    accepted_memory_id: Option<String>,
    accepted_revision_id: Option<String>,
    resolved_by_user_id: Option<String>,
    invalidation_reason: Option<String>,
    edited_before_acceptance: Option<bool>,
    version: i64,
    created_at: String,
    resolved_at: Option<String>,
}

#[derive(Debug, Default)]
pub struct MemoryService {
    gateway: DomainCommandGateway,
}

impl MemoryService {
    pub fn create(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateMemoryCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        normalize_create_command(&mut normalized.payload)?;
        self.gateway.execute(database, &normalized, |transaction| {
            let actor = user_revision_actor(&normalized.actor)?;
            let candidate = candidate_from_create(transaction, &normalized.payload)?;
            validate_candidate(transaction, &candidate)?;
            ensure_capacity(
                transaction,
                &candidate.scope,
                MemoryCreationOrigin::User,
                None,
            )?;
            let now = Utc::now().to_rfc3339();
            let (memory_id, revision_id) = insert_memory(
                transaction,
                &candidate,
                MemoryCreationOrigin::User,
                &actor,
                None,
                &now,
            )?;
            if candidate.scope.kind == MemoryScopeKind::Hearth {
                invalidate_matching_pending_hearth_adds(
                    transaction,
                    candidate.kind,
                    &candidate.body,
                    None,
                    &now,
                )?;
            }
            append_memory_event(
                transaction,
                "memory.created",
                &memory_id,
                &normalized,
                json!({
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                    "scope": candidate.scope.kind,
                    "kind": candidate.kind,
                    "creationOrigin": MemoryCreationOrigin::User,
                    "version": 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_created",
                json!({
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                    "version": 1,
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: memory_id,
                }),
            ))
        })
    }

    pub fn revise(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReviseMemoryCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        normalized.payload.body = canonicalize_memory_body(&normalized.payload.body)?;
        normalized.payload.retrieval_keys =
            normalize_retrieval_keys(&normalized.payload.retrieval_keys)?;
        normalized.payload.review_after =
            normalize_review_after(normalized.payload.review_after.as_deref())?;
        self.gateway.execute(database, &normalized, |transaction| {
            let actor = user_revision_actor(&normalized.actor)?;
            if memory_secret::contains_secret(&normalized.payload.body) {
                return Ok(rejected(
                    "memory.secret_rejected",
                    "Credential-like secrets cannot be stored in Memory",
                ));
            }
            let Some(record) = load_memory_record(transaction, &normalized.payload.memory_id)?
            else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.lifecycle == "forgotten" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Forgotten Memory cannot be revised",
                ));
            }
            if record.version != normalized.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.current_revision_id.as_deref()
                != Some(normalized.payload.base_revision_id.as_str())
            {
                return Ok(rejected(
                    "memory.revision_conflict",
                    "Memory current Revision no longer matches baseRevisionId",
                ));
            }
            if revision_matches(
                transaction,
                &normalized.payload.base_revision_id,
                &normalized.payload.body,
                &normalized.payload.retrieval_keys,
            )? {
                return Ok(rejected(
                    "memory.no_change",
                    "Memory body and Retrieval Keys are unchanged",
                ));
            }
            let kind = record.kind.context("non-forgotten Memory has no Kind")?;
            let now = Utc::now().to_rfc3339();
            let revision_id = Uuid::new_v4().to_string();
            insert_revision(
                transaction,
                NewRevision {
                    id: &revision_id,
                    memory_id: &record.id,
                    body: &normalized.payload.body,
                    retrieval_keys: &normalized.payload.retrieval_keys,
                    actor: &actor,
                    created_from_hearth_review_item_id: None,
                    created_at: &now,
                },
            )?;
            let review_after = normalized
                .payload
                .review_after
                .clone()
                .or_else(|| default_review_after(kind));
            transaction.execute(
                r#"
                UPDATE memory
                SET current_revision_id = ?2, review_after = ?3,
                    version = version + 1, updated_at = ?4
                WHERE id = ?1
                "#,
                params![record.id, revision_id, review_after, now],
            )?;
            refresh_memory_fts(transaction, &record.id)?;
            if record.scope.as_ref().map(|scope| scope.kind) == Some(MemoryScopeKind::Hearth) {
                invalidate_matching_pending_hearth_adds(
                    transaction,
                    kind,
                    &normalized.payload.body,
                    None,
                    &now,
                )?;
            }
            append_memory_event(
                transaction,
                "memory.revised",
                &record.id,
                &normalized,
                json!({
                    "memoryId": record.id,
                    "revisionId": revision_id,
                    "previousRevisionId": normalized.payload.base_revision_id,
                    "version": record.version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_revised",
                json!({
                    "memoryId": record.id,
                    "revisionId": revision_id,
                    "version": record.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: record.id,
                }),
            ))
        })
    }

    pub fn retire(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RetireMemoryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user(&envelope.actor)?;
            let Some(record) = load_memory_record(transaction, &envelope.payload.memory_id)? else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != envelope.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.lifecycle != "active" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Only active Memory can be retired",
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE memory
                SET lifecycle_status = 'retired', retired_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![record.id, now],
            )?;
            refresh_memory_fts(transaction, &record.id)?;
            append_memory_event(
                transaction,
                "memory.retired",
                &record.id,
                envelope,
                json!({"memoryId": record.id, "version": record.version + 1}),
            )?;
            Ok(applied_memory_state(
                "memory_retired",
                &record.id,
                record.version + 1,
                "retired",
            ))
        })
    }

    pub fn reactivate(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReactivateMemoryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user(&envelope.actor)?;
            let Some(record) = load_memory_record(transaction, &envelope.payload.memory_id)? else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != envelope.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.lifecycle != "retired" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Only retired Memory can be reactivated",
                ));
            }
            let scope = record
                .scope
                .as_ref()
                .context("retired Memory has no Scope")?;
            let origin = record
                .creation_origin
                .context("retired Memory has no creation origin")?;
            ensure_capacity(transaction, scope, origin, Some(&record.id))?;
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE memory
                SET lifecycle_status = 'active', retired_at = NULL,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![record.id, now],
            )?;
            refresh_memory_fts(transaction, &record.id)?;
            append_memory_event(
                transaction,
                "memory.reactivated",
                &record.id,
                envelope,
                json!({"memoryId": record.id, "version": record.version + 1}),
            )?;
            Ok(applied_memory_state(
                "memory_reactivated",
                &record.id,
                record.version + 1,
                "active",
            ))
        })
    }

    pub fn forget(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ForgetMemoryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user(&envelope.actor)?;
            let Some(record) = load_memory_record(transaction, &envelope.payload.memory_id)? else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != envelope.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.lifecycle == "forgotten" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Memory is already forgotten",
                ));
            }
            let now = Utc::now().to_rfc3339();
            if record.scope.as_ref().map(|scope| scope.kind) == Some(MemoryScopeKind::Hearth) {
                let kind = record.kind.context("Hearth Memory has no Kind")?;
                let historical_bodies = {
                    let mut statement = transaction.prepare(
                        r#"
                        SELECT body FROM memory_revision
                        WHERE memory_id = ?1 AND body IS NOT NULL
                        ORDER BY created_at, id
                        "#,
                    )?;
                    statement
                        .query_map([&record.id], |row| row.get::<_, String>(0))?
                        .collect::<rusqlite::Result<Vec<_>>>()?
                };
                for body in historical_bodies {
                    invalidate_matching_pending_hearth_adds(transaction, kind, &body, None, &now)?;
                }
            }
            transaction.execute(
                r#"
                UPDATE hearth_review_item
                SET status = 'invalidated',
                    candidate_kind = NULL, candidate_body = NULL,
                    candidate_body_utf8_bytes = NULL,
                    candidate_retrieval_keys_json = NULL,
                    pending_key_digest = NULL,
                    invalidation_reason = 'target_forgotten',
                    candidate_cleared_at = ?2, resolved_at = ?2,
                    version = version + 1
                WHERE target_memory_id = ?1 AND status = 'pending'
                "#,
                params![record.id, now],
            )?;
            transaction.execute("DELETE FROM memory_fts WHERE memory_id = ?1", [&record.id])?;
            transaction.execute(
                r#"
                DELETE FROM memory_revision_retrieval_key
                WHERE revision_id IN (
                    SELECT id FROM memory_revision WHERE memory_id = ?1
                )
                "#,
                [&record.id],
            )?;
            transaction.execute(
                r#"
                UPDATE memory_revision
                SET body = NULL, body_utf8_bytes = NULL, body_digest = NULL,
                    actor_kind = NULL, actor_id = NULL,
                    source_camp_id = NULL, source_agent_run_id = NULL,
                    source_execution_epoch = NULL,
                    created_from_hearth_review_item_id = NULL,
                    cleared_at = ?2
                WHERE memory_id = ?1
                "#,
                params![record.id, now],
            )?;
            transaction.execute(
                r#"
                UPDATE hearth_review_item
                SET candidate_kind = NULL, candidate_body = NULL,
                    candidate_body_utf8_bytes = NULL,
                    candidate_retrieval_keys_json = NULL,
                    pending_key_digest = NULL,
                    candidate_cleared_at = COALESCE(candidate_cleared_at, ?2)
                WHERE accepted_memory_id = ?1
                "#,
                params![record.id, now],
            )?;
            transaction.execute(
                r#"
                UPDATE memory
                SET scope_kind = NULL, kind = NULL, creation_origin = NULL,
                    companion_agent_id = NULL,
                    relationship_agent_low_id = NULL,
                    relationship_agent_high_id = NULL,
                    relationship_direction = NULL,
                    directed_actor_agent_id = NULL,
                    lifecycle_status = 'forgotten',
                    current_revision_id = NULL, review_after = NULL,
                    retired_at = NULL, forgotten_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![record.id, now],
            )?;
            append_memory_event(
                transaction,
                "memory.forgotten",
                &record.id,
                envelope,
                json!({"memoryId": record.id, "version": record.version + 1}),
            )?;
            Ok(applied_memory_state(
                "memory_forgotten",
                &record.id,
                record.version + 1,
                "forgotten",
            ))
        })
    }

    pub fn schedule_review(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ScheduleMemoryReviewCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        normalized.payload.review_after =
            normalize_review_after(normalized.payload.review_after.as_deref())?;
        self.gateway.execute(database, &normalized, |transaction| {
            require_user(&normalized.actor)?;
            let Some(record) = load_memory_record(transaction, &normalized.payload.memory_id)?
            else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != normalized.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.lifecycle == "forgotten" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Forgotten Memory cannot be reviewed",
                ));
            }
            if record.review_after == normalized.payload.review_after {
                return Ok(rejected("memory.no_change", "Review schedule is unchanged"));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE memory
                SET review_after = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1
                "#,
                params![record.id, normalized.payload.review_after, now],
            )?;
            append_memory_event(
                transaction,
                "memory.review_scheduled",
                &record.id,
                &normalized,
                json!({
                    "memoryId": record.id,
                    "reviewAfter": normalized.payload.review_after,
                    "version": record.version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_review_scheduled",
                json!({
                    "memoryId": record.id,
                    "reviewAfter": normalized.payload.review_after,
                    "version": record.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: record.id,
                }),
            ))
        })
    }
}

#[cfg(test)]
// These focused storage tests stay beside the public validation helpers they exercise.
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    fn user_envelope<P>(command_id: impl Into<String>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.into(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn hearth_candidate(index: i64) -> CreateMemoryCommand {
        CreateMemoryCommand {
            scope: MemoryScopeKind::Hearth,
            kind: MemoryKind::Agreement,
            body: format!("Durable Hearth agreement number {index}."),
            retrieval_keys: vec![format!("agreement {index}")],
            companion_agent_id: None,
            relationship_agent_ids: Vec::new(),
            direction: None,
            directed_actor_agent_id: None,
            review_after: None,
        }
    }

    #[test]
    fn retrieval_keys_are_normalized_bounded_and_not_generic() {
        assert_eq!(
            normalize_retrieval_keys(&[
                "  Status   Updates ".to_string(),
                "接口 契约".to_string(),
                "STATUS UPDATES".to_string(),
            ])
            .unwrap(),
            vec!["status updates".to_string(), "接口 契约".to_string()]
        );
        assert!(normalize_retrieval_keys(&["memory".to_string()]).is_err());
        assert!(normalize_retrieval_keys(&["bad|table".to_string()]).is_err());
        assert!(normalize_retrieval_keys(&["x".to_string()]).is_err());
        assert!(
            normalize_retrieval_keys(&[
                "first retrieval phrase".to_string(),
                "second retrieval phrase".to_string(),
                "third retrieval phrase".to_string(),
            ])
            .is_err()
        );
    }

    #[test]
    fn user_memory_has_single_effective_revision_with_actor_and_keys() {
        let directory = std::env::temp_dir().join(format!("rovai-memory-v2-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let execution = MemoryService::default()
            .create(
                &mut database,
                &user_envelope("memory-create-v2", hearth_candidate(1)),
            )
            .unwrap();
        assert_eq!(execution.result.code, "memory_created");
        let memory_id = execution.result.payload["memoryId"].as_str().unwrap();
        let memory = MemoryService::default()
            .get(&database, memory_id)
            .unwrap()
            .unwrap();
        assert_eq!(memory.creation_origin, Some(MemoryCreationOrigin::User));
        assert_eq!(memory.current_retrieval_keys, vec!["agreement 1"]);
        assert_eq!(memory.revisions.len(), 1);
        assert_eq!(
            memory.revisions[0].actor_kind,
            Some(MemoryRevisionActorKind::User)
        );
        assert_eq!(memory.revisions[0].actor_id.as_deref(), Some("local_user"));
        let fts_rows: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM memory_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fts_rows, 1);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn hearth_capacity_is_32_without_aggregate_byte_quota() {
        let directory =
            std::env::temp_dir().join(format!("rovai-memory-capacity-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        for index in 0..HEARTH_MAX_COUNT {
            MemoryService::default()
                .create(
                    &mut database,
                    &user_envelope(format!("memory-capacity-{index}"), hearth_candidate(index)),
                )
                .unwrap();
        }
        let error = MemoryService::default()
            .create(
                &mut database,
                &user_envelope("memory-capacity-overflow", hearth_candidate(99)),
            )
            .unwrap_err();
        assert!(error.to_string().contains("memory.capacity_exceeded"));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn forget_clears_body_keys_and_search_index() {
        let directory =
            std::env::temp_dir().join(format!("rovai-memory-forget-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let created = MemoryService::default()
            .create(
                &mut database,
                &user_envelope("memory-forget-create", hearth_candidate(1)),
            )
            .unwrap();
        let memory_id = created.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        MemoryService::default()
            .forget(
                &mut database,
                &user_envelope(
                    "memory-forget",
                    ForgetMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();
        let memory = MemoryService::default()
            .get(&database, &memory_id)
            .unwrap()
            .unwrap();
        assert_eq!(memory.lifecycle, "forgotten");
        assert!(memory.current_body.is_none());
        assert!(memory.revisions[0].body.is_none());
        assert!(memory.revisions[0].retrieval_keys.is_empty());
        let fts_rows: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM memory_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fts_rows, 0);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

pub fn canonicalize_memory_body(input: &str) -> Result<String> {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = normalized.trim().to_string();
    if normalized.is_empty() {
        anyhow::bail!("memory.invalid_input: Memory body must not be empty");
    }
    if normalized.chars().any(|character| {
        let code = character as u32;
        code <= 0x1f && character != '\t' && character != '\n'
    }) {
        anyhow::bail!("memory.invalid_input: Memory body contains a forbidden control character");
    }
    if normalized.len() > MEMORY_BODY_MAX_BYTES {
        anyhow::bail!(
            "memory.invalid_input: Memory body exceeds {MEMORY_BODY_MAX_BYTES} UTF-8 bytes"
        );
    }
    Ok(normalized)
}

pub fn normalize_retrieval_keys(input: &[String]) -> Result<Vec<String>> {
    if input.is_empty() || input.len() > 3 {
        anyhow::bail!("memory.invalid_input: Retrieval Keys require one to three values");
    }
    let reserved = [
        "memory",
        "remember",
        "important",
        "general",
        "note",
        "thing",
        "stuff",
        "记忆",
        "重要",
        "通用",
        "其他",
    ];
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in input {
        let key = raw
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .map(|character| {
                if character.is_ascii() {
                    character.to_ascii_lowercase()
                } else {
                    character
                }
            })
            .collect::<String>();
        let bytes = key.len();
        if !(MEMORY_RETRIEVAL_KEY_MIN_BYTES..=MEMORY_RETRIEVAL_KEY_MAX_BYTES).contains(&bytes) {
            anyhow::bail!(
                "memory.invalid_input: each Retrieval Key must contain 2 to 24 UTF-8 bytes"
            );
        }
        if key.chars().any(|character| {
            character.is_control() || character == '\n' || character == '\r' || character == '|'
        }) {
            anyhow::bail!(
                "memory.invalid_input: Retrieval Keys cannot contain controls, newlines, or |"
            );
        }
        if reserved.contains(&key.as_str()) {
            anyhow::bail!("memory.invalid_input: Retrieval Key is too generic");
        }
        if seen.insert(key.clone()) {
            normalized.push(key);
        }
    }
    if normalized.is_empty() || normalized.len() > 3 {
        anyhow::bail!("memory.invalid_input: Retrieval Keys require one to three unique values");
    }
    let total_bytes = normalized.iter().map(String::len).sum::<usize>();
    if total_bytes > MEMORY_RETRIEVAL_KEYS_TOTAL_MAX_BYTES {
        anyhow::bail!(
            "memory.invalid_input: Retrieval Keys exceed {MEMORY_RETRIEVAL_KEYS_TOTAL_MAX_BYTES} total UTF-8 bytes"
        );
    }
    Ok(normalized)
}

fn normalize_create_command(command: &mut CreateMemoryCommand) -> Result<()> {
    command.body = canonicalize_memory_body(&command.body)?;
    command.retrieval_keys = normalize_retrieval_keys(&command.retrieval_keys)?;
    command.review_after = normalize_review_after(command.review_after.as_deref())?;
    command.relationship_agent_ids.sort();
    command.relationship_agent_ids.dedup();
    Ok(())
}

fn normalize_review_after(value: Option<&str>) -> Result<Option<String>> {
    value
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .context("memory.invalid_input: reviewAfter must be RFC 3339")
                .map(|date| date.to_utc().to_rfc3339())
        })
        .transpose()
}

fn default_review_after(kind: MemoryKind) -> Option<String> {
    (kind == MemoryKind::Lesson).then(|| (Utc::now() + Duration::days(90)).to_rfc3339())
}

fn candidate_from_create(
    transaction: &Transaction<'_>,
    command: &CreateMemoryCommand,
) -> Result<Candidate> {
    let scope = match command.scope {
        MemoryScopeKind::Hearth => {
            if command.companion_agent_id.is_some()
                || !command.relationship_agent_ids.is_empty()
                || command.direction.is_some()
                || command.directed_actor_agent_id.is_some()
            {
                anyhow::bail!("memory.invalid_input: Hearth Memory has no Agent target fields");
            }
            MemoryScope::hearth()
        }
        MemoryScopeKind::Companion => {
            if !command.relationship_agent_ids.is_empty()
                || command.direction.is_some()
                || command.directed_actor_agent_id.is_some()
            {
                anyhow::bail!(
                    "memory.invalid_input: Companion Memory cannot have Relationship fields"
                );
            }
            let agent = command
                .companion_agent_id
                .clone()
                .context("memory.invalid_input: Companion Memory requires companionAgentId")?;
            require_agent_profile(transaction, &agent)?;
            MemoryScope::companion(agent)
        }
        MemoryScopeKind::Relationship => {
            if command.companion_agent_id.is_some() || command.relationship_agent_ids.len() != 2 {
                anyhow::bail!(
                    "memory.invalid_input: Relationship Memory requires exactly two Agent IDs"
                );
            }
            let first = command.relationship_agent_ids[0].clone();
            let second = command.relationship_agent_ids[1].clone();
            require_agent_profile(transaction, &first)?;
            require_agent_profile(transaction, &second)?;
            MemoryScope::relationship(
                first,
                second,
                command
                    .direction
                    .context("memory.invalid_input: Relationship Memory requires direction")?,
                command.directed_actor_agent_id.clone(),
            )?
        }
    };
    validate_kind_for_scope(command.kind, &scope)?;
    Ok(Candidate {
        scope,
        kind: command.kind,
        body: command.body.clone(),
        body_bytes: command.body.len() as i64,
        retrieval_keys: command.retrieval_keys.clone(),
        review_after: command
            .review_after
            .clone()
            .or_else(|| default_review_after(command.kind)),
    })
}

fn validate_kind_for_scope(kind: MemoryKind, scope: &MemoryScope) -> Result<()> {
    if scope.kind == MemoryScopeKind::Relationship && kind == MemoryKind::Preference {
        anyhow::bail!("memory.invalid_input: Relationship allows only agreement or lesson");
    }
    Ok(())
}

fn validate_candidate(transaction: &Transaction<'_>, candidate: &Candidate) -> Result<()> {
    if memory_secret::contains_secret(&candidate.body) {
        anyhow::bail!("memory.secret_rejected: Credential-like secrets cannot be stored");
    }
    if active_exact_memory_exists(transaction, candidate)? {
        anyhow::bail!("memory.duplicate: An identical active Memory already exists");
    }
    Ok(())
}

fn require_agent_profile(transaction: &Transaction<'_>, agent_id: &str) -> Result<()> {
    let exists: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM agent_profile WHERE id = ?1",
        [agent_id],
        |row| row.get(0),
    )?;
    if exists != 1 {
        anyhow::bail!("memory.invalid_input: AgentProfile does not exist");
    }
    Ok(())
}

fn user_revision_actor(actor: &ActorRef) -> Result<RevisionActor> {
    let ActorRef::User { user_id } = actor else {
        anyhow::bail!("memory.capability_denied: only the user can perform this mutation");
    };
    Ok(RevisionActor {
        kind: MemoryRevisionActorKind::User,
        actor_id: user_id.clone(),
        source_camp_id: None,
        source_agent_run_id: None,
        source_execution_epoch: None,
    })
}

fn require_user(actor: &ActorRef) -> Result<&str> {
    let ActorRef::User { user_id } = actor else {
        anyhow::bail!("memory.capability_denied: only the user can govern Memory");
    };
    Ok(user_id)
}

fn insert_memory(
    transaction: &Transaction<'_>,
    candidate: &Candidate,
    origin: MemoryCreationOrigin,
    actor: &RevisionActor,
    hearth_review_item_id: Option<&str>,
    now: &str,
) -> Result<(String, String)> {
    let memory_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();
    insert_revision(
        transaction,
        NewRevision {
            id: &revision_id,
            memory_id: &memory_id,
            body: &candidate.body,
            retrieval_keys: &candidate.retrieval_keys,
            actor,
            created_from_hearth_review_item_id: hearth_review_item_id,
            created_at: now,
        },
    )?;
    transaction.execute(
        r#"
        INSERT INTO memory(
            id, scope_kind, kind, creation_origin,
            companion_agent_id,
            relationship_agent_low_id, relationship_agent_high_id,
            relationship_direction, directed_actor_agent_id,
            lifecycle_status, current_revision_id, review_after,
            version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            'active', ?10, ?11, 1, ?12, ?12
        )
        "#,
        params![
            memory_id,
            candidate.scope.kind.as_str(),
            candidate.kind.as_str(),
            origin.as_str(),
            candidate.scope.companion_agent_id,
            candidate.scope.relationship_agent_low_id,
            candidate.scope.relationship_agent_high_id,
            candidate
                .scope
                .relationship_direction
                .map(RelationshipDirection::as_str),
            candidate.scope.directed_actor_agent_id,
            revision_id,
            candidate.review_after,
            now,
        ],
    )?;
    refresh_memory_fts(transaction, &memory_id)?;
    Ok((memory_id, revision_id))
}

struct NewRevision<'a> {
    id: &'a str,
    memory_id: &'a str,
    body: &'a str,
    retrieval_keys: &'a [String],
    actor: &'a RevisionActor,
    created_from_hearth_review_item_id: Option<&'a str>,
    created_at: &'a str,
}

fn insert_revision(transaction: &Transaction<'_>, revision: NewRevision<'_>) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO memory_revision(
            id, memory_id, body, body_utf8_bytes, body_digest,
            actor_kind, actor_id, source_camp_id, source_agent_run_id,
            source_execution_epoch, created_from_hearth_review_item_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            revision.id,
            revision.memory_id,
            revision.body,
            revision.body.len() as i64,
            sha256(revision.body.as_bytes()),
            match revision.actor.kind {
                MemoryRevisionActorKind::User => "user",
                MemoryRevisionActorKind::Agent => "agent",
            },
            revision.actor.actor_id,
            revision.actor.source_camp_id,
            revision.actor.source_agent_run_id,
            revision.actor.source_execution_epoch,
            revision.created_from_hearth_review_item_id,
            revision.created_at,
        ],
    )?;
    for (position, key) in revision.retrieval_keys.iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO memory_revision_retrieval_key(
                revision_id, position, normalized_key
            ) VALUES (?1, ?2, ?3)
            "#,
            params![revision.id, position as i64, key],
        )?;
    }
    Ok(())
}

fn refresh_memory_fts(transaction: &Transaction<'_>, memory_id: &str) -> Result<()> {
    transaction.execute("DELETE FROM memory_fts WHERE memory_id = ?1", [memory_id])?;
    let row: Option<(String, String)> = transaction
        .query_row(
            r#"
            SELECT memory.current_revision_id, revision.body
            FROM memory
            JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.id = ?1 AND memory.lifecycle_status = 'active'
            "#,
            [memory_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((revision_id, body)) = row {
        let keys = load_retrieval_keys(transaction, &revision_id)?;
        transaction.execute(
            r#"
            INSERT INTO memory_fts(memory_id, revision_id, retrieval_keys, body)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![memory_id, revision_id, keys.join(" "), body],
        )?;
    }
    Ok(())
}

pub fn rebuild_memory_search_index(database: &mut Database) -> Result<()> {
    let transaction = database.connection_mut().transaction()?;
    transaction.execute("DELETE FROM memory_fts", [])?;
    let ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM memory WHERE lifecycle_status = 'active' ORDER BY id")?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for id in ids {
        refresh_memory_fts(&transaction, &id)?;
    }
    transaction.execute(
        r#"
        UPDATE memory_search_state
        SET status = 'ready', index_version = index_version + 1,
            diagnostic_code = NULL, rebuilt_at = ?1
        WHERE singleton = 1
        "#,
        [Utc::now().to_rfc3339()],
    )?;
    transaction.commit()?;
    Ok(())
}

fn load_memory_record(connection: &Connection, memory_id: &str) -> Result<Option<MemoryRecord>> {
    connection
        .query_row(
            r#"
            SELECT memory.id, memory.scope_kind, memory.kind, memory.creation_origin,
                   memory.companion_agent_id,
                   memory.relationship_agent_low_id,
                   memory.relationship_agent_high_id,
                   memory.relationship_direction,
                   memory.directed_actor_agent_id,
                   memory.lifecycle_status, memory.current_revision_id,
                   revision.body, revision.body_utf8_bytes,
                   memory.review_after, memory.version,
                   memory.created_at, memory.updated_at,
                   memory.retired_at, memory.forgotten_at
            FROM memory
            LEFT JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.id = ?1
            "#,
            [memory_id],
            memory_record_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn memory_record_from_row(row: &Row<'_>) -> rusqlite::Result<MemoryRecord> {
    let scope_kind = row.get::<_, Option<String>>(1)?;
    let scope = scope_kind
        .as_deref()
        .map(|value| {
            let kind = MemoryScopeKind::parse(value).map_err(anyhow_to_sqlite)?;
            let direction = row
                .get::<_, Option<String>>(7)?
                .as_deref()
                .map(RelationshipDirection::parse)
                .transpose()
                .map_err(anyhow_to_sqlite)?;
            Ok::<_, rusqlite::Error>(MemoryScope {
                kind,
                companion_agent_id: row.get(4)?,
                relationship_agent_low_id: row.get(5)?,
                relationship_agent_high_id: row.get(6)?,
                relationship_direction: direction,
                directed_actor_agent_id: row.get(8)?,
            })
        })
        .transpose()?;
    let kind = row
        .get::<_, Option<String>>(2)?
        .as_deref()
        .map(MemoryKind::parse)
        .transpose()
        .map_err(anyhow_to_sqlite)?;
    let creation_origin = row
        .get::<_, Option<String>>(3)?
        .as_deref()
        .map(MemoryCreationOrigin::parse)
        .transpose()
        .map_err(anyhow_to_sqlite)?;
    Ok(MemoryRecord {
        id: row.get(0)?,
        scope,
        kind,
        creation_origin,
        lifecycle: row.get(9)?,
        current_revision_id: row.get(10)?,
        current_body: row.get(11)?,
        current_body_utf8_bytes: row.get(12)?,
        review_after: row.get(13)?,
        version: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        retired_at: row.get(17)?,
        forgotten_at: row.get(18)?,
    })
}

fn load_active_memory_records(connection: &Connection) -> Result<Vec<MemoryRecord>> {
    let mut statement = connection.prepare(
        r#"
        SELECT memory.id, memory.scope_kind, memory.kind, memory.creation_origin,
               memory.companion_agent_id,
               memory.relationship_agent_low_id,
               memory.relationship_agent_high_id,
               memory.relationship_direction,
               memory.directed_actor_agent_id,
               memory.lifecycle_status, memory.current_revision_id,
               revision.body, revision.body_utf8_bytes,
               memory.review_after, memory.version,
               memory.created_at, memory.updated_at,
               memory.retired_at, memory.forgotten_at
        FROM memory
        JOIN memory_revision AS revision ON revision.id = memory.current_revision_id
        WHERE memory.lifecycle_status = 'active'
        ORDER BY memory.id
        "#,
    )?;
    statement
        .query_map([], memory_record_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
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

fn revision_matches(
    transaction: &Transaction<'_>,
    revision_id: &str,
    body: &str,
    retrieval_keys: &[String],
) -> Result<bool> {
    let existing_body: Option<String> = transaction
        .query_row(
            "SELECT body FROM memory_revision WHERE id = ?1",
            [revision_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(existing_body.as_deref() == Some(body)
        && load_retrieval_keys(transaction, revision_id)? == retrieval_keys)
}

fn active_exact_memory_exists(
    transaction: &Transaction<'_>,
    candidate: &Candidate,
) -> Result<bool> {
    Ok(load_active_memory_records(transaction)?
        .into_iter()
        .any(|record| {
            record.kind == Some(candidate.kind)
                && record.current_body.as_deref() == Some(candidate.body.as_str())
                && record
                    .scope
                    .as_ref()
                    .is_some_and(|scope| scope.same_identity(&candidate.scope))
        }))
}

fn hearth_add_digest(kind: MemoryKind, body: &str) -> Result<String> {
    canonical_json_digest(&json!({
        "domain": "rovai.memory.hearth-review.v1",
        "action": "add",
        "scope": "hearth",
        "kind": kind,
        "canonicalBody": body,
    }))
}

fn hearth_revise_digest(
    target_memory_id: &str,
    base_revision_id: &str,
    body: &str,
    retrieval_keys: &[String],
) -> Result<String> {
    canonical_json_digest(&json!({
        "domain": "rovai.memory.hearth-review.v1",
        "action": "revise",
        "targetMemoryId": target_memory_id,
        "baseRevisionId": base_revision_id,
        "canonicalBody": body,
        "normalizedRetrievalKeys": retrieval_keys,
    }))
}

fn invalidate_matching_pending_hearth_adds(
    transaction: &Transaction<'_>,
    kind: MemoryKind,
    body: &str,
    except_review_item_id: Option<&str>,
    now: &str,
) -> Result<usize> {
    let digest = hearth_add_digest(kind, body)?;
    Ok(transaction.execute(
        r#"
        UPDATE hearth_review_item
        SET status = 'invalidated',
            candidate_kind = NULL, candidate_body = NULL,
            candidate_body_utf8_bytes = NULL,
            candidate_retrieval_keys_json = NULL,
            pending_key_digest = NULL,
            invalidation_reason = 'exact_candidate_published',
            candidate_cleared_at = ?3, resolved_at = ?3,
            version = version + 1
        WHERE status = 'pending'
          AND requested_action = 'add'
          AND pending_key_digest = ?1
          AND (?2 IS NULL OR id <> ?2)
        "#,
        params![digest, except_review_item_id, now],
    )?)
}

fn ensure_capacity(
    transaction: &Transaction<'_>,
    candidate_scope: &MemoryScope,
    origin: MemoryCreationOrigin,
    exclude_memory_id: Option<&str>,
) -> Result<()> {
    let records = load_active_memory_records(transaction)?
        .into_iter()
        .filter(|record| exclude_memory_id != Some(record.id.as_str()))
        .collect::<Vec<_>>();
    let pair_count = |agent_only: bool| -> i64 {
        records
            .iter()
            .filter(|record| {
                (!agent_only || record.creation_origin == Some(MemoryCreationOrigin::Agent))
                    && record.scope.as_ref().is_some_and(|scope| {
                        scope.kind == MemoryScopeKind::Relationship
                            && scope.relationship_agent_low_id
                                == candidate_scope.relationship_agent_low_id
                            && scope.relationship_agent_high_id
                                == candidate_scope.relationship_agent_high_id
                    })
            })
            .count() as i64
    };
    let applicable_count = |agent_id: &str, agent_only: bool| -> i64 {
        records
            .iter()
            .filter(|record| {
                (!agent_only || record.creation_origin == Some(MemoryCreationOrigin::Agent))
                    && record.scope.as_ref().is_some_and(|scope| {
                        scope.kind == MemoryScopeKind::Relationship
                            && scope.contains_agent(agent_id)
                            && (scope.relationship_direction == Some(RelationshipDirection::Mutual)
                                || scope.directed_actor_agent_id.as_deref() == Some(agent_id))
                    })
            })
            .count() as i64
    };
    match candidate_scope.kind {
        MemoryScopeKind::Hearth => {
            let count = records
                .iter()
                .filter(|record| {
                    record.scope.as_ref().map(|scope| scope.kind) == Some(MemoryScopeKind::Hearth)
                })
                .count() as i64;
            if count >= HEARTH_MAX_COUNT {
                anyhow::bail!(
                    "memory.capacity_exceeded: Hearth already has {count}/{HEARTH_MAX_COUNT} active Memories"
                );
            }
            if origin == MemoryCreationOrigin::Agent {
                anyhow::bail!("memory.scope_forbidden: Agent cannot directly create Hearth Memory");
            }
        }
        MemoryScopeKind::Companion => {
            let agent = candidate_scope
                .companion_agent_id
                .as_deref()
                .context("Companion Scope has no Agent")?;
            let count = records
                .iter()
                .filter(|record| {
                    record.scope.as_ref().is_some_and(|scope| {
                        scope.kind == MemoryScopeKind::Companion
                            && scope.companion_agent_id.as_deref() == Some(agent)
                    })
                })
                .count() as i64;
            if count >= COMPANION_MAX_COUNT {
                anyhow::bail!(
                    "memory.capacity_exceeded: Companion already has {count}/{COMPANION_MAX_COUNT} active Memories"
                );
            }
            if origin == MemoryCreationOrigin::Agent {
                let agent_count = records
                    .iter()
                    .filter(|record| {
                        record.creation_origin == Some(MemoryCreationOrigin::Agent)
                            && record.scope.as_ref().is_some_and(|scope| {
                                scope.kind == MemoryScopeKind::Companion
                                    && scope.companion_agent_id.as_deref() == Some(agent)
                            })
                    })
                    .count() as i64;
                if agent_count >= AGENT_COMPANION_MAX_COUNT {
                    anyhow::bail!(
                        "memory.agent_origin_capacity_exceeded: Companion already has {agent_count}/{AGENT_COMPANION_MAX_COUNT} Agent-origin Memories"
                    );
                }
            }
        }
        MemoryScopeKind::Relationship => {
            let pair = pair_count(false);
            if pair >= RELATIONSHIP_PAIR_MAX_COUNT {
                anyhow::bail!(
                    "memory.capacity_exceeded: Relationship pair already has {pair}/{RELATIONSHIP_PAIR_MAX_COUNT} active Memories"
                );
            }
            let applicable_agents = match candidate_scope.relationship_direction {
                Some(RelationshipDirection::Mutual) => vec![
                    candidate_scope
                        .relationship_agent_low_id
                        .as_deref()
                        .context("Relationship has no low Agent")?,
                    candidate_scope
                        .relationship_agent_high_id
                        .as_deref()
                        .context("Relationship has no high Agent")?,
                ],
                Some(RelationshipDirection::Directed) => vec![
                    candidate_scope
                        .directed_actor_agent_id
                        .as_deref()
                        .context("Directed Relationship has no actor")?,
                ],
                None => anyhow::bail!("memory.invalid_input: Relationship has no direction"),
            };
            for agent in applicable_agents {
                let applicable = applicable_count(agent, false);
                if applicable >= RELATIONSHIP_APPLICABLE_MAX_COUNT {
                    anyhow::bail!(
                        "memory.capacity_exceeded: Agent already has {applicable}/{RELATIONSHIP_APPLICABLE_MAX_COUNT} applicable Relationship Memories"
                    );
                }
                if origin == MemoryCreationOrigin::Agent {
                    let agent_applicable = applicable_count(agent, true);
                    if agent_applicable >= AGENT_RELATIONSHIP_APPLICABLE_MAX_COUNT {
                        anyhow::bail!(
                            "memory.agent_origin_capacity_exceeded: Agent already has {agent_applicable}/{AGENT_RELATIONSHIP_APPLICABLE_MAX_COUNT} applicable Agent-origin Relationship Memories"
                        );
                    }
                }
            }
            if origin == MemoryCreationOrigin::Agent {
                let agent_pair = pair_count(true);
                if agent_pair >= AGENT_RELATIONSHIP_PAIR_MAX_COUNT {
                    anyhow::bail!(
                        "memory.agent_origin_capacity_exceeded: Relationship pair already has {agent_pair}/{AGENT_RELATIONSHIP_PAIR_MAX_COUNT} Agent-origin Memories"
                    );
                }
            }
        }
    }
    Ok(())
}

fn validate_agent_mutation<C: DomainCommand>(
    transaction: &Transaction<'_>,
    envelope: &CommandEnvelope<C>,
) -> Result<RevisionActor> {
    let ActorRef::Agent {
        agent_id,
        source_agent_run_id,
    } = &envelope.actor
    else {
        anyhow::bail!("memory.actor_not_allowed: Agent Memory mutation requires an AgentRun");
    };
    let camp_id = envelope
        .camp_id
        .as_deref()
        .context("memory.run_not_current: Agent Memory mutation has no Camp")?;
    let execution_epoch = envelope
        .execution_epoch
        .context("memory.run_not_current: Agent Memory mutation has no Epoch")?;
    let row: Option<(String, String, i64)> = transaction
        .query_row(
            r#"
            SELECT camp_turn.camp_id, conversation.agent_id,
                   agent_run.execution_epoch
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
              AND agent_run.status IN ('running', 'waiting')
            "#,
            [source_agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((run_camp, run_agent, run_epoch)) = row else {
        anyhow::bail!("memory.run_not_current: AgentRun is no longer current");
    };
    if run_camp != camp_id || run_agent != *agent_id || run_epoch != execution_epoch {
        anyhow::bail!("memory.run_not_current: AgentRun identity or fence does not match");
    }
    if !is_current_camp_member(transaction, camp_id, agent_id)? {
        anyhow::bail!("memory.run_not_current: Agent is not a present current Camp member");
    }
    Ok(RevisionActor {
        kind: MemoryRevisionActorKind::Agent,
        actor_id: agent_id.clone(),
        source_camp_id: Some(camp_id.to_string()),
        source_agent_run_id: Some(source_agent_run_id.clone()),
        source_execution_epoch: Some(execution_epoch),
    })
}

fn agent_identity<C>(envelope: &CommandEnvelope<C>) -> Result<(&str, &str)> {
    let ActorRef::Agent { agent_id, .. } = &envelope.actor else {
        anyhow::bail!("memory.actor_not_allowed: Agent identity is required");
    };
    Ok((
        agent_id,
        envelope
            .camp_id
            .as_deref()
            .context("memory.run_not_current: Agent mutation has no Camp")?,
    ))
}

fn enforce_agent_mutation_quota(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
) -> Result<()> {
    let revision_count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM memory_revision
        WHERE source_agent_run_id = ?1
        "#,
        [source_agent_run_id],
        |row| row.get(0),
    )?;
    let review_count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM hearth_review_item
        WHERE source_agent_run_id = ?1
        "#,
        [source_agent_run_id],
        |row| row.get(0),
    )?;
    if revision_count + review_count >= MEMORY_AGENT_MUTATIONS_PER_RUN {
        anyhow::bail!(
            "memory.run_quota_exceeded: AgentRun already persisted {MEMORY_AGENT_MUTATIONS_PER_RUN} Memory mutations"
        );
    }
    Ok(())
}

fn agent_add_scope(
    transaction: &Transaction<'_>,
    input: &AgentMemoryWriteCommand,
    agent_id: &str,
    camp_id: &str,
) -> Result<MemoryScope> {
    let scope = input.scope.context("add requires scope")?;
    match scope {
        MemoryScopeKind::Hearth => {
            if input.counterparty_agent_id.is_some() || input.direction.is_some() {
                anyhow::bail!("memory.invalid_input: Hearth add has no Relationship fields");
            }
            Ok(MemoryScope::hearth())
        }
        MemoryScopeKind::Companion => {
            if input.counterparty_agent_id.is_some() || input.direction.is_some() {
                anyhow::bail!("memory.invalid_input: Companion add has no Relationship fields");
            }
            Ok(MemoryScope::companion(agent_id.to_string()))
        }
        MemoryScopeKind::Relationship => {
            let counterparty = input
                .counterparty_agent_id
                .clone()
                .context("Relationship add requires counterpartyAgentId")?;
            if counterparty == agent_id
                || !is_current_camp_member(transaction, camp_id, &counterparty)?
            {
                anyhow::bail!(
                    "memory.direction_forbidden: counterparty must be another present Camp member"
                );
            }
            let direction = input
                .direction
                .context("Relationship add requires direction")?;
            if direction != RelationshipDirection::Directed {
                anyhow::bail!("memory.scope_forbidden: Agent Relationship writes must be directed");
            }
            MemoryScope::relationship(
                agent_id.to_string(),
                counterparty,
                direction,
                (direction == RelationshipDirection::Directed).then(|| agent_id.to_string()),
            )
        }
    }
}

fn memory_mutable_by_agent(
    transaction: &Transaction<'_>,
    record: &MemoryRecord,
    agent_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let Some(scope) = &record.scope else {
        return Ok(false);
    };
    match scope.kind {
        MemoryScopeKind::Hearth => Ok(false),
        MemoryScopeKind::Companion => Ok(scope.companion_agent_id.as_deref() == Some(agent_id)),
        MemoryScopeKind::Relationship => {
            if scope.relationship_direction != Some(RelationshipDirection::Directed)
                || scope.directed_actor_agent_id.as_deref() != Some(agent_id)
            {
                return Ok(false);
            }
            let Some(counterparty) = scope.counterparty(agent_id) else {
                return Ok(false);
            };
            is_current_camp_member(transaction, camp_id, counterparty)
        }
    }
}

pub(crate) fn is_current_camp_member(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
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
    )?;
    Ok(count == 1)
}

fn load_hearth_review_record(
    connection: &Connection,
    review_item_id: &str,
) -> Result<Option<HearthReviewRecord>> {
    connection
        .query_row(
            r#"
            SELECT id, requested_action, status, candidate_kind, candidate_body,
                   candidate_retrieval_keys_json,
                   target_memory_id, base_revision_id,
                   source_agent_id, source_camp_id,
                   source_agent_run_id, source_execution_epoch,
                   accepted_memory_id, accepted_revision_id,
                   resolved_by_user_id, invalidation_reason,
                   edited_before_acceptance, version, created_at, resolved_at
            FROM hearth_review_item WHERE id = ?1
            "#,
            [review_item_id],
            |row| {
                let kind = row
                    .get::<_, Option<String>>(3)?
                    .as_deref()
                    .map(MemoryKind::parse)
                    .transpose()
                    .map_err(anyhow_to_sqlite)?;
                let keys_json = row.get::<_, Option<String>>(5)?;
                let retrieval_keys = keys_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?;
                Ok(HearthReviewRecord {
                    id: row.get(0)?,
                    action: row.get(1)?,
                    status: row.get(2)?,
                    kind,
                    body: row.get(4)?,
                    retrieval_keys,
                    target_memory_id: row.get(6)?,
                    base_revision_id: row.get(7)?,
                    source_agent_id: row.get(8)?,
                    source_camp_id: row.get(9)?,
                    source_agent_run_id: row.get(10)?,
                    source_execution_epoch: row.get(11)?,
                    accepted_memory_id: row.get(12)?,
                    accepted_revision_id: row.get(13)?,
                    resolved_by_user_id: row.get(14)?,
                    invalidation_reason: row.get(15)?,
                    edited_before_acceptance: row.get(16)?,
                    version: row.get(17)?,
                    created_at: row.get(18)?,
                    resolved_at: row.get(19)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn reject_hearth_review_row(
    transaction: &Transaction<'_>,
    review_item_id: &str,
    user_id: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE hearth_review_item
        SET status = 'rejected', candidate_kind = NULL,
            candidate_body = NULL, candidate_body_utf8_bytes = NULL,
            candidate_retrieval_keys_json = NULL,
            pending_key_digest = NULL, resolved_by_user_id = ?2,
            candidate_cleared_at = ?3, resolved_at = ?3,
            version = version + 1
        WHERE id = ?1 AND status = 'pending'
        "#,
        params![review_item_id, user_id, now],
    )?;
    Ok(())
}

fn save_hearth_review_item<C: DomainCommand>(
    transaction: &Transaction<'_>,
    envelope: &CommandEnvelope<C>,
    actor: &RevisionActor,
    action: &str,
    kind: Option<MemoryKind>,
    target_memory_id: Option<&str>,
    base_revision_id: Option<&str>,
    body: &str,
    retrieval_keys: &[String],
) -> Result<CommandHandlerResult> {
    let pending_key = match action {
        "add" => hearth_add_digest(
            kind.context("memory.invalid_input: Hearth add requires kind")?,
            body,
        )?,
        "revise" => hearth_revise_digest(
            target_memory_id.context("memory.invalid_input: Hearth revise requires memoryId")?,
            base_revision_id
                .context("memory.invalid_input: Hearth revise requires baseRevisionId")?,
            body,
            retrieval_keys,
        )?,
        _ => anyhow::bail!("memory.invalid_input: action must be add or revise"),
    };
    let duplicate_exists: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM hearth_review_item
            WHERE status = 'pending' AND pending_key_digest = ?1
        )
        "#,
        [&pending_key],
        |row| row.get(0),
    )?;
    if duplicate_exists {
        return Ok(rejected(
            "memory.duplicate_pending",
            "An identical pending Hearth Review Item already exists",
        ));
    }

    let review_item_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (agent_id, camp_id) = agent_identity(envelope)?;
    let source_agent_run_id = actor
        .source_agent_run_id
        .as_deref()
        .context("Agent Revision actor has no source Run")?;
    transaction.execute(
        r#"
        INSERT INTO hearth_review_item(
            id, requested_action, status, candidate_kind,
            candidate_body, candidate_body_utf8_bytes,
            candidate_retrieval_keys_json,
            target_memory_id, base_revision_id, pending_key_digest,
            source_agent_id, source_camp_id,
            source_agent_run_id, source_execution_epoch,
            version, created_at
        ) VALUES (
            ?1, ?2, 'pending', ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14
        )
        "#,
        params![
            review_item_id,
            action,
            kind.map(MemoryKind::as_str),
            body,
            body.len() as i64,
            serde_json::to_string(retrieval_keys)?,
            target_memory_id,
            base_revision_id,
            pending_key,
            agent_id,
            camp_id,
            source_agent_run_id,
            actor.source_execution_epoch,
            now,
        ],
    )?;
    append_memory_event(
        transaction,
        "memory.hearth_review_created",
        &review_item_id,
        envelope,
        json!({
            "reviewItemId": review_item_id,
            "requestedAction": action,
        }),
    )?;
    Ok(CommandHandlerResult::accepted(
        "hearth_review_item_saved",
        json!({
            "outcome": "review_pending",
            "reviewItemId": review_item_id,
        }),
        Some(EntityReference {
            entity_type: "hearth_review_item".to_string(),
            entity_id: review_item_id,
        }),
    ))
}

fn memory_view_from_record(
    connection: &Connection,
    record: MemoryRecord,
    revisions: Vec<MemoryRevisionView>,
    current_retrieval_keys: Vec<String>,
) -> Result<MemoryView> {
    let relationship_agent_ids = record
        .scope
        .as_ref()
        .map(|scope| {
            [
                scope.relationship_agent_low_id.clone(),
                scope.relationship_agent_high_id.clone(),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let review_due = record
        .review_after
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|value| value <= Utc::now());
    let outgoing_successor_ids = load_edge_ids(connection, &record.id, true)?;
    let incoming_predecessor_ids = load_edge_ids(connection, &record.id, false)?;
    Ok(MemoryView {
        id: record.id,
        scope: record.scope.as_ref().map(|scope| scope.kind),
        kind: record.kind,
        creation_origin: record.creation_origin,
        companion_agent_id: record
            .scope
            .as_ref()
            .and_then(|scope| scope.companion_agent_id.clone()),
        relationship_agent_ids,
        direction: record
            .scope
            .as_ref()
            .and_then(|scope| scope.relationship_direction),
        directed_actor_agent_id: record
            .scope
            .as_ref()
            .and_then(|scope| scope.directed_actor_agent_id.clone()),
        lifecycle: record.lifecycle,
        current_revision_id: record.current_revision_id,
        current_body: record.current_body,
        current_body_utf8_bytes: record.current_body_utf8_bytes,
        current_retrieval_keys,
        review_after: record.review_after,
        review_due,
        outgoing_successor_ids,
        incoming_predecessor_ids,
        version: record.version,
        created_at: record.created_at,
        updated_at: record.updated_at,
        retired_at: record.retired_at,
        forgotten_at: record.forgotten_at,
        revisions,
    })
}

fn hearth_review_view(
    connection: &Connection,
    record: HearthReviewRecord,
) -> Result<HearthReviewItemView> {
    let stale = if record.status == "pending" && record.action == "revise" {
        match (
            record.target_memory_id.as_deref(),
            record.base_revision_id.as_deref(),
        ) {
            (Some(memory_id), Some(base_revision_id)) => load_memory_record(connection, memory_id)?
                .is_none_or(|memory| {
                    memory.lifecycle != "active"
                        || memory.scope.as_ref().map(|scope| scope.kind)
                            != Some(MemoryScopeKind::Hearth)
                        || memory.current_revision_id.as_deref() != Some(base_revision_id)
                }),
            _ => true,
        }
    } else {
        false
    };
    Ok(HearthReviewItemView {
        review_item_id: record.id,
        requested_action: record.action,
        status: record.status,
        candidate_kind: record.kind,
        candidate_body: record.body,
        candidate_retrieval_keys: record.retrieval_keys,
        target_memory_id: record.target_memory_id,
        base_revision_id: record.base_revision_id,
        source_agent_id: record.source_agent_id,
        source_camp_id: record.source_camp_id,
        source_agent_run_id: record.source_agent_run_id,
        source_execution_epoch: record.source_execution_epoch,
        stale,
        accepted_memory_id: record.accepted_memory_id,
        accepted_revision_id: record.accepted_revision_id,
        resolved_by_user_id: record.resolved_by_user_id,
        invalidation_reason: record.invalidation_reason,
        edited_before_acceptance: record.edited_before_acceptance,
        version: record.version,
        created_at: record.created_at,
        resolved_at: record.resolved_at,
    })
}

fn capacity_views(database: &Database) -> Result<Vec<MemoryCapacityView>> {
    let records = load_active_memory_records(database.connection())?;
    let mut views = vec![MemoryCapacityView {
        scope: MemoryScopeKind::Hearth,
        scope_key: "hearth".to_string(),
        active_count: records
            .iter()
            .filter(|record| {
                record.scope.as_ref().map(|scope| scope.kind) == Some(MemoryScopeKind::Hearth)
            })
            .count() as i64,
        max_count: HEARTH_MAX_COUNT,
        agent_origin_count: 0,
        agent_origin_max_count: 0,
    }];
    let mut companions = BTreeSet::new();
    let mut pairs = BTreeSet::new();
    let mut agents = BTreeSet::new();
    for record in &records {
        if let Some(scope) = &record.scope {
            match scope.kind {
                MemoryScopeKind::Hearth => {}
                MemoryScopeKind::Companion => {
                    if let Some(agent) = &scope.companion_agent_id {
                        companions.insert(agent.clone());
                    }
                }
                MemoryScopeKind::Relationship => {
                    if let (Some(low), Some(high)) = (
                        &scope.relationship_agent_low_id,
                        &scope.relationship_agent_high_id,
                    ) {
                        pairs.insert((low.clone(), high.clone()));
                        agents.insert(low.clone());
                        agents.insert(high.clone());
                    }
                }
            }
        }
    }
    for agent in companions {
        let matching = records.iter().filter(|record| {
            record.scope.as_ref().is_some_and(|scope| {
                scope.kind == MemoryScopeKind::Companion
                    && scope.companion_agent_id.as_deref() == Some(agent.as_str())
            })
        });
        let matching = matching.collect::<Vec<_>>();
        views.push(MemoryCapacityView {
            scope: MemoryScopeKind::Companion,
            scope_key: format!("companion:{agent}"),
            active_count: matching.len() as i64,
            max_count: COMPANION_MAX_COUNT,
            agent_origin_count: matching
                .iter()
                .filter(|record| record.creation_origin == Some(MemoryCreationOrigin::Agent))
                .count() as i64,
            agent_origin_max_count: AGENT_COMPANION_MAX_COUNT,
        });
    }
    for (low, high) in pairs {
        let matching = records
            .iter()
            .filter(|record| {
                record.scope.as_ref().is_some_and(|scope| {
                    scope.kind == MemoryScopeKind::Relationship
                        && scope.relationship_agent_low_id.as_deref() == Some(low.as_str())
                        && scope.relationship_agent_high_id.as_deref() == Some(high.as_str())
                })
            })
            .collect::<Vec<_>>();
        views.push(MemoryCapacityView {
            scope: MemoryScopeKind::Relationship,
            scope_key: format!("relationship:{low}:{high}"),
            active_count: matching.len() as i64,
            max_count: RELATIONSHIP_PAIR_MAX_COUNT,
            agent_origin_count: matching
                .iter()
                .filter(|record| record.creation_origin == Some(MemoryCreationOrigin::Agent))
                .count() as i64,
            agent_origin_max_count: AGENT_RELATIONSHIP_PAIR_MAX_COUNT,
        });
    }
    for agent in agents {
        let matching = records
            .iter()
            .filter(|record| {
                record.scope.as_ref().is_some_and(|scope| {
                    scope.kind == MemoryScopeKind::Relationship
                        && scope.contains_agent(&agent)
                        && (scope.relationship_direction == Some(RelationshipDirection::Mutual)
                            || scope.directed_actor_agent_id.as_deref() == Some(agent.as_str()))
                })
            })
            .collect::<Vec<_>>();
        views.push(MemoryCapacityView {
            scope: MemoryScopeKind::Relationship,
            scope_key: format!("relationship-applicable:{agent}"),
            active_count: matching.len() as i64,
            max_count: RELATIONSHIP_APPLICABLE_MAX_COUNT,
            agent_origin_count: matching
                .iter()
                .filter(|record| record.creation_origin == Some(MemoryCreationOrigin::Agent))
                .count() as i64,
            agent_origin_max_count: AGENT_RELATIONSHIP_APPLICABLE_MAX_COUNT,
        });
    }
    views.sort_by(|left, right| left.scope_key.cmp(&right.scope_key));
    Ok(views)
}

fn load_edge_ids(connection: &Connection, memory_id: &str, outgoing: bool) -> Result<Vec<String>> {
    let sql = if outgoing {
        r#"
        SELECT successor_memory_id FROM memory_supersession
        WHERE predecessor_memory_id = ?1 ORDER BY successor_memory_id
        "#
    } else {
        r#"
        SELECT predecessor_memory_id FROM memory_supersession
        WHERE successor_memory_id = ?1 ORDER BY predecessor_memory_id
        "#
    };
    let mut statement = connection.prepare(sql)?;
    statement
        .query_map([memory_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn supersession_path_exists(
    transaction: &Transaction<'_>,
    start_memory_id: &str,
    target_memory_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        WITH RECURSIVE reachable(id) AS (
            SELECT successor_memory_id
            FROM memory_supersession
            WHERE predecessor_memory_id = ?1
            UNION
            SELECT edge.successor_memory_id
            FROM memory_supersession AS edge
            JOIN reachable ON edge.predecessor_memory_id = reachable.id
        )
        SELECT COUNT(*) FROM reachable WHERE id = ?2
        "#,
        params![start_memory_id, target_memory_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn memory_kind_order(kind: MemoryKind) -> u8 {
    match kind {
        MemoryKind::Agreement => 0,
        MemoryKind::Preference => 1,
        MemoryKind::Lesson => 2,
    }
}

fn version_conflict(record: &MemoryRecord) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "memory.version_conflict",
        json!({
            "message": "Memory version no longer matches",
            "memoryId": record.id,
            "currentVersion": record.version,
        }),
    )
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message": message}))
}

fn applied_memory_state(
    code: &str,
    memory_id: &str,
    version: i64,
    lifecycle: &str,
) -> CommandHandlerResult {
    CommandHandlerResult::applied(
        code,
        json!({
            "memoryId": memory_id,
            "version": version,
            "lifecycle": lifecycle,
        }),
        Some(EntityReference {
            entity_type: "memory".to_string(),
            entity_id: memory_id.to_string(),
        }),
    )
}

fn append_memory_event<C: DomainCommand>(
    transaction: &Transaction<'_>,
    event_type: &str,
    entity_id: &str,
    envelope: &CommandEnvelope<C>,
    payload: Value,
) -> Result<()> {
    append_domain_event(
        transaction,
        event_type,
        envelope.camp_id.as_deref(),
        Some((
            if event_type.contains("hearth_review") {
                "hearth_review_item"
            } else {
                "memory"
            },
            entity_id,
        )),
        &envelope.actor,
        envelope.execution_epoch,
        &payload,
    )
}

fn anyhow_to_sqlite(error: anyhow::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(error.into())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl MemoryService {
    pub fn list(&self, database: &Database) -> Result<MemoryListView> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM memory ORDER BY created_at DESC, id")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let memories = ids
            .iter()
            .map(|id| {
                self.get(database, id)?
                    .with_context(|| format!("Memory {id} disappeared while listing"))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(MemoryListView {
            memories,
            capacities: capacity_views(database)?,
        })
    }

    pub fn get(&self, database: &Database, memory_id: &str) -> Result<Option<MemoryView>> {
        let Some(record) = load_memory_record(database.connection(), memory_id)? else {
            return Ok(None);
        };
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, body, body_utf8_bytes, actor_kind, actor_id,
                   source_camp_id, source_agent_run_id, source_execution_epoch,
                   created_from_hearth_review_item_id, created_at, cleared_at
            FROM memory_revision
            WHERE memory_id = ?1
            ORDER BY created_at DESC, id DESC
            "#,
        )?;
        let revisions = statement
            .query_map([memory_id], |row| {
                let actor_kind = row
                    .get::<_, Option<String>>(3)?
                    .as_deref()
                    .map(MemoryRevisionActorKind::parse)
                    .transpose()
                    .map_err(anyhow_to_sqlite)?;
                Ok(MemoryRevisionView {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    body_utf8_bytes: row.get(2)?,
                    retrieval_keys: Vec::new(),
                    actor_kind,
                    actor_id: row.get(4)?,
                    source_camp_id: row.get(5)?,
                    source_agent_run_id: row.get(6)?,
                    source_execution_epoch: row.get(7)?,
                    created_from_hearth_review_item_id: row.get(8)?,
                    created_at: row.get(9)?,
                    cleared_at: row.get(10)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|mut revision| {
                revision.retrieval_keys = load_retrieval_keys(database.connection(), &revision.id)?;
                Ok(revision)
            })
            .collect::<Result<Vec<_>>>()?;
        let current_retrieval_keys = match record.current_revision_id.as_deref() {
            Some(revision_id) => load_retrieval_keys(database.connection(), revision_id)?,
            None => Vec::new(),
        };
        Ok(Some(memory_view_from_record(
            database.connection(),
            record,
            revisions,
            current_retrieval_keys,
        )?))
    }

    pub fn list_hearth_review_items(
        &self,
        database: &Database,
    ) -> Result<Vec<HearthReviewItemView>> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM hearth_review_item ORDER BY created_at DESC, id DESC")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| {
                let record =
                    load_hearth_review_record(database.connection(), &id)?.with_context(|| {
                        format!("Hearth Review Item {id} disappeared while listing")
                    })?;
                hearth_review_view(database.connection(), record)
            })
            .collect()
    }

    pub fn projection_entries(
        &self,
        database: &Database,
        scope: MemoryScopeKind,
        agent_id: Option<&str>,
        counterparty_agent_id: Option<&str>,
    ) -> Result<Vec<ProjectedMemoryEntry>> {
        let records = load_active_memory_records(database.connection())?;
        let mut entries = Vec::new();
        for record in records {
            let Some(record_scope) = &record.scope else {
                continue;
            };
            let matches = match scope {
                MemoryScopeKind::Hearth => record_scope.kind == MemoryScopeKind::Hearth,
                MemoryScopeKind::Companion => {
                    record_scope.kind == MemoryScopeKind::Companion
                        && record_scope.companion_agent_id.as_deref() == agent_id
                }
                MemoryScopeKind::Relationship => {
                    let Some(agent) = agent_id else {
                        continue;
                    };
                    let Some(counterparty) = counterparty_agent_id else {
                        continue;
                    };
                    record_scope.kind == MemoryScopeKind::Relationship
                        && record_scope.contains_agent(agent)
                        && record_scope.counterparty(agent) == Some(counterparty)
                        && (record_scope.relationship_direction
                            == Some(RelationshipDirection::Mutual)
                            || record_scope.directed_actor_agent_id.as_deref() == Some(agent))
                }
            };
            if !matches {
                continue;
            }
            let revision_id = record
                .current_revision_id
                .as_deref()
                .context("active Memory has no current Revision")?;
            entries.push(ProjectedMemoryEntry {
                memory_id: record.id,
                revision_id: revision_id.to_string(),
                kind: record.kind.context("active Memory has no Kind")?,
                direction: record_scope.relationship_direction,
                retrieval_keys: load_retrieval_keys(database.connection(), revision_id)?,
                body: record.current_body.context("active Memory has no body")?,
            });
        }
        entries.sort_by(|left, right| {
            memory_kind_order(left.kind)
                .cmp(&memory_kind_order(right.kind))
                .then_with(|| left.memory_id.cmp(&right.memory_id))
        });
        Ok(entries)
    }

    pub fn export(&self, database: &Database) -> Result<Value> {
        let memories = self
            .list(database)?
            .memories
            .into_iter()
            .filter(|memory| memory.lifecycle != "forgotten")
            .collect::<Vec<_>>();
        let review_items = self.list_hearth_review_items(database)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT predecessor_memory_id, successor_memory_id, created_at
            FROM memory_supersession
            ORDER BY created_at, predecessor_memory_id, successor_memory_id
            "#,
        )?;
        let supersessions = statement
            .query_map([], |row| {
                Ok(json!({
                    "predecessorMemoryId": row.get::<_, String>(0)?,
                    "successorMemoryId": row.get::<_, String>(1)?,
                    "createdAt": row.get::<_, String>(2)?,
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!({
            "format": "rovai-memory-export-v3",
            "exportedAt": Utc::now().to_rfc3339(),
            "memories": memories,
            "hearthReviewItems": review_items,
            "supersessions": supersessions,
        }))
    }

    pub fn diagnostics(&self, database: &Database) -> Result<Value> {
        let memory_counts = database.connection().query_row(
            r#"
            SELECT
                SUM(CASE WHEN lifecycle_status = 'active' THEN 1 ELSE 0 END),
                SUM(CASE WHEN lifecycle_status = 'retired' THEN 1 ELSE 0 END),
                SUM(CASE WHEN lifecycle_status = 'forgotten' THEN 1 ELSE 0 END),
                SUM(CASE WHEN lifecycle_status = 'active'
                         AND creation_origin = 'agent' THEN 1 ELSE 0 END)
            FROM memory
            "#,
            [],
            |row| {
                Ok(json!({
                    "active": row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    "retired": row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    "forgotten": row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    "activeAgentOrigin": row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                }))
            },
        )?;
        let review_counts = database.connection().query_row(
            r#"
            SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'invalidated' THEN 1 ELSE 0 END)
            FROM hearth_review_item
            "#,
            [],
            |row| {
                Ok(json!({
                    "pending": row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    "accepted": row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    "rejected": row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    "invalidated": row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                }))
            },
        )?;
        let search_state = database.connection().query_row(
            r#"
            SELECT status, index_version, diagnostic_code, rebuilt_at
            FROM memory_search_state WHERE singleton = 1
            "#,
            [],
            |row| {
                Ok(json!({
                    "status": row.get::<_, String>(0)?,
                    "indexVersion": row.get::<_, i64>(1)?,
                    "diagnosticCode": row.get::<_, Option<String>>(2)?,
                    "rebuiltAt": row.get::<_, String>(3)?,
                }))
            },
        )?;
        Ok(json!({
            "counts": memory_counts,
            "hearthReviewCounts": review_counts,
            "search": search_state,
        }))
    }
}

impl MemoryService {
    pub fn accept_hearth_review_item(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcceptHearthReviewItemCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        if normalized.payload.final_body.is_some()
            != normalized.payload.final_retrieval_keys.is_some()
        {
            anyhow::bail!(
                "memory.invalid_input: finalBody and finalRetrievalKeys must be provided together"
            );
        }
        if let Some(body) = &mut normalized.payload.final_body {
            *body = canonicalize_memory_body(body)?;
        }
        if let Some(keys) = &mut normalized.payload.final_retrieval_keys {
            *keys = normalize_retrieval_keys(keys)?;
        }
        self.gateway.execute(database, &normalized, |transaction| {
            let actor = user_revision_actor(&normalized.actor)?;
            let user_id = actor.actor_id.as_str();
            let Some(review_item) =
                load_hearth_review_record(transaction, &normalized.payload.review_item_id)?
            else {
                return Ok(rejected(
                    "memory.review_not_found",
                    "Hearth Review Item does not exist",
                ));
            };
            if review_item.version != normalized.payload.expected_review_item_version {
                return Ok(CommandHandlerResult::rejected(
                    "memory.review_version_conflict",
                    json!({
                        "reviewItemId": review_item.id,
                        "currentVersion": review_item.version,
                    }),
                ));
            }
            if review_item.status != "pending" {
                return Ok(rejected(
                    "memory.review_conflict",
                    "Only pending Hearth Review Items can be accepted",
                ));
            }
            let body = normalized
                .payload
                .final_body
                .clone()
                .or_else(|| review_item.body.clone())
                .context("Hearth Review Item candidate body was cleared")?;
            let retrieval_keys = normalized
                .payload
                .final_retrieval_keys
                .clone()
                .or_else(|| review_item.retrieval_keys.clone())
                .context("Hearth Review Item candidate Retrieval Keys were cleared")?;
            let retrieval_keys = normalize_retrieval_keys(&retrieval_keys)?;
            if memory_secret::contains_secret(&body) {
                return Ok(rejected(
                    "memory.secret_rejected",
                    "Credential-like secrets cannot be stored in Memory",
                ));
            }
            let now = Utc::now().to_rfc3339();
            let (memory_id, revision_id, final_kind) = match review_item.action.as_str() {
                "add" => {
                    let kind = review_item.kind.context("Hearth Review add has no Kind")?;
                    let candidate = Candidate {
                        scope: MemoryScope::hearth(),
                        kind,
                        body: body.clone(),
                        body_bytes: 0,
                        retrieval_keys: retrieval_keys.clone(),
                        review_after: default_review_after(kind),
                    };
                    let mut candidate = candidate;
                    candidate.body_bytes = candidate.body.len() as i64;
                    if active_exact_memory_exists(transaction, &candidate)? {
                        return Ok(rejected(
                            "memory.duplicate",
                            "An identical active Memory already exists",
                        ));
                    }
                    ensure_capacity(
                        transaction,
                        &candidate.scope,
                        MemoryCreationOrigin::AcceptedHearthReview,
                        None,
                    )?;
                    let (memory_id, revision_id) = insert_memory(
                        transaction,
                        &candidate,
                        MemoryCreationOrigin::AcceptedHearthReview,
                        &actor,
                        Some(&review_item.id),
                        &now,
                    )?;
                    (memory_id, revision_id, kind)
                }
                "revise" => {
                    let memory_id = review_item
                        .target_memory_id
                        .as_deref()
                        .context("Hearth Review revise has no target")?;
                    let base_revision_id = review_item
                        .base_revision_id
                        .as_deref()
                        .context("Hearth Review revise has no base Revision")?;
                    let Some(record) = load_memory_record(transaction, memory_id)? else {
                        return Ok(rejected(
                            "memory.review_stale",
                            "Target Hearth Memory no longer exists",
                        ));
                    };
                    if record.lifecycle != "active"
                        || record.scope.as_ref().map(|scope| scope.kind)
                            != Some(MemoryScopeKind::Hearth)
                        || record.current_revision_id.as_deref() != Some(base_revision_id)
                    {
                        return Ok(rejected(
                            "memory.review_stale",
                            "Hearth Review revise is stale",
                        ));
                    }
                    if revision_matches(transaction, base_revision_id, &body, &retrieval_keys)? {
                        return Ok(rejected(
                            "memory.no_change",
                            "Memory body and Retrieval Keys are unchanged",
                        ));
                    }
                    let revision_id = Uuid::new_v4().to_string();
                    insert_revision(
                        transaction,
                        NewRevision {
                            id: &revision_id,
                            memory_id,
                            body: &body,
                            retrieval_keys: &retrieval_keys,
                            actor: &actor,
                            created_from_hearth_review_item_id: Some(&review_item.id),
                            created_at: &now,
                        },
                    )?;
                    let kind = record.kind.context("active Memory has no Kind")?;
                    transaction.execute(
                        r#"
                        UPDATE memory
                        SET current_revision_id = ?2, review_after = ?3,
                            version = version + 1, updated_at = ?4
                        WHERE id = ?1
                        "#,
                        params![memory_id, revision_id, default_review_after(kind), now],
                    )?;
                    refresh_memory_fts(transaction, memory_id)?;
                    (memory_id.to_string(), revision_id, kind)
                }
                _ => {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "Unknown Hearth Review Item action",
                    ));
                }
            };
            transaction.execute(
                r#"
                UPDATE hearth_review_item
                SET status = 'accepted',
                    candidate_kind = NULL, candidate_body = NULL,
                    candidate_body_utf8_bytes = NULL,
                    candidate_retrieval_keys_json = NULL,
                    pending_key_digest = NULL,
                    accepted_memory_id = ?2, accepted_revision_id = ?3,
                    resolved_by_user_id = ?4,
                    edited_before_acceptance = ?5,
                    candidate_cleared_at = ?6,
                    version = version + 1, resolved_at = ?6
                WHERE id = ?1
                "#,
                params![
                    review_item.id,
                    memory_id,
                    revision_id,
                    user_id,
                    normalized.payload.final_body.is_some(),
                    now,
                ],
            )?;
            invalidate_matching_pending_hearth_adds(
                transaction,
                final_kind,
                &body,
                Some(&review_item.id),
                &now,
            )?;
            append_memory_event(
                transaction,
                "memory.hearth_review_accepted",
                &review_item.id,
                &normalized,
                json!({
                    "reviewItemId": review_item.id,
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "hearth_review_item_accepted",
                json!({
                    "reviewItemId": review_item.id,
                    "status": "accepted",
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                    "version": review_item.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: memory_id,
                }),
            ))
        })
    }

    pub fn reject_hearth_review_item(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RejectHearthReviewItemCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let user_id = require_user(&envelope.actor)?;
            let Some(review_item) =
                load_hearth_review_record(transaction, &envelope.payload.review_item_id)?
            else {
                return Ok(rejected(
                    "memory.review_not_found",
                    "Hearth Review Item does not exist",
                ));
            };
            if review_item.version != envelope.payload.expected_review_item_version {
                return Ok(CommandHandlerResult::rejected(
                    "memory.review_version_conflict",
                    json!({
                        "reviewItemId": review_item.id,
                        "currentVersion": review_item.version,
                    }),
                ));
            }
            if review_item.status != "pending" {
                return Ok(rejected(
                    "memory.review_conflict",
                    "Only pending Hearth Review Items can be rejected",
                ));
            }
            reject_hearth_review_row(transaction, &review_item.id, user_id)?;
            append_memory_event(
                transaction,
                "memory.hearth_review_rejected",
                &review_item.id,
                envelope,
                json!({
                    "reviewItemId": review_item.id,
                    "version": review_item.version + 1
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "hearth_review_item_rejected",
                json!({
                    "reviewItemId": review_item.id,
                    "status": "rejected",
                    "version": review_item.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "hearth_review_item".to_string(),
                    entity_id: review_item.id,
                }),
            ))
        })
    }
}

impl MemoryService {
    pub fn supersede(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SupersedeMemoriesCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        if let SupersessionSuccessor::Create { candidate } = &mut normalized.payload.successor {
            normalize_create_command(candidate)?;
        }
        self.gateway.execute(database, &normalized, |transaction| {
            let actor = user_revision_actor(&normalized.actor)?;
            if normalized.payload.predecessors.is_empty()
                || normalized.payload.predecessors.len() > 8
            {
                return Ok(rejected(
                    "memory.invalid_input",
                    "Supersession requires one to eight predecessors",
                ));
            }
            let mut predecessor_ids = BTreeSet::new();
            let mut predecessors = Vec::new();
            for reference in &normalized.payload.predecessors {
                if !predecessor_ids.insert(reference.memory_id.clone()) {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "Supersession predecessors must be unique",
                    ));
                }
                let Some(record) = load_memory_record(transaction, &reference.memory_id)? else {
                    return Ok(rejected(
                        "memory.not_found",
                        "Supersession predecessor does not exist",
                    ));
                };
                if record.version != reference.expected_version {
                    return Ok(version_conflict(&record));
                }
                if record.lifecycle != "active" {
                    return Ok(rejected(
                        "memory.lifecycle_conflict",
                        "Supersession predecessors must be active",
                    ));
                }
                predecessors.push(record);
            }
            let now = Utc::now().to_rfc3339();
            let (successor_id, successor_revision_id, successor_scope, successor_kind) =
                match &normalized.payload.successor {
                    SupersessionSuccessor::Existing {
                        memory_id,
                        expected_version,
                    } => {
                        let Some(successor) = load_memory_record(transaction, memory_id)? else {
                            return Ok(rejected(
                                "memory.not_found",
                                "Supersession successor does not exist",
                            ));
                        };
                        if successor.version != *expected_version {
                            return Ok(version_conflict(&successor));
                        }
                        if successor.lifecycle != "active" {
                            return Ok(rejected(
                                "memory.lifecycle_conflict",
                                "Supersession successor must be active",
                            ));
                        }
                        if predecessor_ids.contains(memory_id) {
                            return Ok(rejected(
                                "memory.invalid_input",
                                "A predecessor cannot be its own successor",
                            ));
                        }
                        (
                            successor.id,
                            successor.current_revision_id,
                            successor.scope,
                            successor.kind,
                        )
                    }
                    SupersessionSuccessor::Create { candidate } => {
                        let candidate = candidate_from_create(transaction, candidate)?;
                        validate_candidate(transaction, &candidate)?;
                        ensure_capacity(
                            transaction,
                            &candidate.scope,
                            MemoryCreationOrigin::User,
                            None,
                        )?;
                        let (memory_id, revision_id) = insert_memory(
                            transaction,
                            &candidate,
                            MemoryCreationOrigin::User,
                            &actor,
                            None,
                            &now,
                        )?;
                        if candidate.scope.kind == MemoryScopeKind::Hearth {
                            invalidate_matching_pending_hearth_adds(
                                transaction,
                                candidate.kind,
                                &candidate.body,
                                None,
                                &now,
                            )?;
                        }
                        (
                            memory_id,
                            Some(revision_id),
                            Some(candidate.scope),
                            Some(candidate.kind),
                        )
                    }
                };
            for predecessor in &predecessors {
                if predecessor.scope != successor_scope || predecessor.kind != successor_kind {
                    return Ok(rejected(
                        "memory.scope_mismatch",
                        "Supersession must stay within the same Scope and Kind",
                    ));
                }
                if supersession_path_exists(transaction, &successor_id, &predecessor.id)? {
                    return Ok(rejected(
                        "memory.supersession_cycle",
                        "Supersession would create a cycle",
                    ));
                }
            }
            for predecessor in &predecessors {
                transaction.execute(
                    r#"
                    UPDATE memory
                    SET lifecycle_status = 'retired', retired_at = ?2,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1
                    "#,
                    params![predecessor.id, now],
                )?;
                transaction.execute(
                    r#"
                    INSERT INTO memory_supersession(
                        predecessor_memory_id, successor_memory_id, created_at
                    ) VALUES (?1, ?2, ?3)
                    "#,
                    params![predecessor.id, successor_id, now],
                )?;
                refresh_memory_fts(transaction, &predecessor.id)?;
            }
            append_memory_event(
                transaction,
                "memory.superseded",
                &successor_id,
                &normalized,
                json!({
                    "successorMemoryId": successor_id,
                    "successorRevisionId": successor_revision_id,
                    "predecessorMemoryIds": predecessors.iter()
                        .map(|record| record.id.clone()).collect::<Vec<_>>(),
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memories_superseded",
                json!({
                    "successorMemoryId": successor_id,
                    "successorRevisionId": successor_revision_id,
                    "predecessorMemoryIds": predecessors.iter()
                        .map(|record| record.id.clone()).collect::<Vec<_>>(),
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: successor_id,
                }),
            ))
        })
    }

    pub fn write(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AgentMemoryWriteCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        normalized.payload.body = canonicalize_memory_body(&normalized.payload.body)?;
        normalized.payload.retrieval_keys =
            normalize_retrieval_keys(&normalized.payload.retrieval_keys)?;
        self.gateway.execute(database, &normalized, |transaction| {
            let actor = validate_agent_mutation(transaction, &normalized)?;
            enforce_agent_mutation_quota(
                transaction,
                actor
                    .source_agent_run_id
                    .as_deref()
                    .context("Agent Revision actor has no source Run")?,
            )?;
            if memory_secret::contains_secret(&normalized.payload.body) {
                return Ok(rejected(
                    "memory.secret_rejected",
                    "Credential-like secrets cannot be stored in Memory",
                ));
            }
            match normalized.payload.action.as_str() {
                "add" => {
                    if normalized.payload.memory_id.is_some()
                        || normalized.payload.base_revision_id.is_some()
                    {
                        return Ok(rejected(
                            "memory.invalid_input",
                            "add cannot include memoryId or baseRevisionId",
                        ));
                    }
                    let (agent_id, camp_id) = agent_identity(&normalized)?;
                    let scope =
                        agent_add_scope(transaction, &normalized.payload, agent_id, camp_id)?;
                    let kind = normalized.payload.kind.context("add requires kind")?;
                    validate_kind_for_scope(kind, &scope)?;
                    let candidate = Candidate {
                        scope,
                        kind,
                        body: normalized.payload.body.clone(),
                        body_bytes: normalized.payload.body.len() as i64,
                        retrieval_keys: normalized.payload.retrieval_keys.clone(),
                        review_after: default_review_after(kind),
                    };
                    if candidate.scope.kind == MemoryScopeKind::Hearth {
                        if active_exact_memory_exists(transaction, &candidate)? {
                            return Ok(rejected(
                                "memory.duplicate",
                                "An identical active Memory already exists",
                            ));
                        }
                        return save_hearth_review_item(
                            transaction,
                            &normalized,
                            &actor,
                            "add",
                            Some(kind),
                            None,
                            None,
                            &candidate.body,
                            &candidate.retrieval_keys,
                        );
                    }
                    validate_candidate(transaction, &candidate)?;
                    ensure_capacity(
                        transaction,
                        &candidate.scope,
                        MemoryCreationOrigin::Agent,
                        None,
                    )?;
                    let now = Utc::now().to_rfc3339();
                    let (memory_id, revision_id) = insert_memory(
                        transaction,
                        &candidate,
                        MemoryCreationOrigin::Agent,
                        &actor,
                        None,
                        &now,
                    )?;
                    append_memory_event(
                        transaction,
                        "memory.agent_created",
                        &memory_id,
                        &normalized,
                        json!({
                            "memoryId": memory_id,
                            "revisionId": revision_id,
                            "scope": candidate.scope.kind,
                            "kind": candidate.kind,
                            "creationOrigin": MemoryCreationOrigin::Agent,
                        }),
                    )?;
                    Ok(CommandHandlerResult::applied(
                        "memory_write_applied",
                        json!({
                            "outcome": "effective",
                            "memoryId": memory_id,
                            "revisionId": revision_id,
                        }),
                        Some(EntityReference {
                            entity_type: "memory".to_string(),
                            entity_id: memory_id,
                        }),
                    ))
                }
                "revise" => {
                    if normalized.payload.scope.is_some()
                        || normalized.payload.kind.is_some()
                        || normalized.payload.counterparty_agent_id.is_some()
                        || normalized.payload.direction.is_some()
                    {
                        return Ok(rejected(
                            "memory.invalid_input",
                            "revise accepts only Memory, Revision, body and Retrieval Keys",
                        ));
                    }
                    let (agent_id, camp_id) = agent_identity(&normalized)?;
                    let memory_id = normalized
                        .payload
                        .memory_id
                        .as_deref()
                        .context("revise requires memoryId")?;
                    let base_revision_id = normalized
                        .payload
                        .base_revision_id
                        .as_deref()
                        .context("revise requires baseRevisionId")?;
                    let Some(record) = load_memory_record(transaction, memory_id)? else {
                        return Ok(rejected("memory.unavailable", "Memory is unavailable"));
                    };
                    if record.lifecycle != "active" {
                        return Ok(rejected("memory.unavailable", "Memory is unavailable"));
                    }
                    if record.current_revision_id.as_deref() != Some(base_revision_id) {
                        return Ok(rejected(
                            "memory.revision_conflict",
                            "baseRevisionId is not current",
                        ));
                    }
                    if revision_matches(
                        transaction,
                        base_revision_id,
                        &normalized.payload.body,
                        &normalized.payload.retrieval_keys,
                    )? {
                        return Ok(rejected(
                            "memory.no_change",
                            "Memory body and Retrieval Keys are unchanged",
                        ));
                    }
                    if record.scope.as_ref().map(|scope| scope.kind)
                        == Some(MemoryScopeKind::Hearth)
                    {
                        return save_hearth_review_item(
                            transaction,
                            &normalized,
                            &actor,
                            "revise",
                            None,
                            Some(memory_id),
                            Some(base_revision_id),
                            &normalized.payload.body,
                            &normalized.payload.retrieval_keys,
                        );
                    }
                    if !memory_mutable_by_agent(transaction, &record, agent_id, camp_id)? {
                        return Ok(rejected("memory.unavailable", "Memory is unavailable"));
                    }
                    let revision_id = Uuid::new_v4().to_string();
                    let now = Utc::now().to_rfc3339();
                    insert_revision(
                        transaction,
                        NewRevision {
                            id: &revision_id,
                            memory_id,
                            body: &normalized.payload.body,
                            retrieval_keys: &normalized.payload.retrieval_keys,
                            actor: &actor,
                            created_from_hearth_review_item_id: None,
                            created_at: &now,
                        },
                    )?;
                    let kind = record.kind.context("active Memory has no Kind")?;
                    transaction.execute(
                        r#"
                        UPDATE memory
                        SET current_revision_id = ?2, review_after = ?3,
                            version = version + 1, updated_at = ?4
                        WHERE id = ?1
                        "#,
                        params![memory_id, revision_id, default_review_after(kind), now],
                    )?;
                    refresh_memory_fts(transaction, memory_id)?;
                    append_memory_event(
                        transaction,
                        "memory.agent_revised",
                        memory_id,
                        &normalized,
                        json!({
                            "memoryId": memory_id,
                            "revisionId": revision_id,
                            "previousRevisionId": base_revision_id,
                        }),
                    )?;
                    Ok(CommandHandlerResult::applied(
                        "memory_write_applied",
                        json!({
                            "outcome": "effective",
                            "memoryId": memory_id,
                            "revisionId": revision_id,
                        }),
                        Some(EntityReference {
                            entity_type: "memory".to_string(),
                            entity_id: memory_id.to_string(),
                        }),
                    ))
                }
                _ => Ok(rejected(
                    "memory.invalid_input",
                    "action must be add or revise",
                )),
            }
        })
    }
}
