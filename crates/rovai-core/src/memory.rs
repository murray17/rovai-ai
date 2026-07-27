use std::collections::{BTreeMap, BTreeSet};

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

pub const MEMORY_BODY_MAX_BYTES: usize = 2 * 1024;
pub const MEMORY_PROPOSALS_PER_RUN: i64 = 4;
pub const HEARTH_MAX_COUNT: i64 = 32;
pub const HEARTH_MAX_BYTES: i64 = 32 * 1024;
pub const COMPANION_MAX_COUNT: i64 = 64;
pub const COMPANION_MAX_BYTES: i64 = 64 * 1024;
pub const COMPANION_PROVISIONAL_MAX_COUNT: i64 = 8;
pub const MEMORY_POLICY_AUTO_PER_RUN: i64 = 1;
pub const MEMORY_AUTO_POLICY_SCHEMA_VERSION: i64 = 1;
pub const RELATIONSHIP_MAX_COUNT: i64 = 32;
pub const RELATIONSHIP_MAX_BYTES: i64 = 32 * 1024;
pub const MEMORY_PROPOSE_CHANGE_CAPABILITY: &str = "memory.propose_change";

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
pub enum MemoryRevisionAuthority {
    UserConfirmed,
    Provisional,
}

impl MemoryRevisionAuthority {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::UserConfirmed => "user_confirmed",
            Self::Provisional => "provisional",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "user_confirmed" => Ok(Self::UserConfirmed),
            "provisional" => Ok(Self::Provisional),
            _ => anyhow::bail!("unknown Memory Revision authority: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryProposalResolutionMode {
    User,
    PolicyAuto,
}

impl MemoryProposalResolutionMode {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "user" => Ok(Self::User),
            "policy_auto" => Ok(Self::PolicyAuto),
            _ => anyhow::bail!("unknown Memory Proposal resolution mode: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryScope {
    pub kind: MemoryScopeKind,
    pub companion_agent_profile_id: Option<String>,
    pub relationship_agent_low_id: Option<String>,
    pub relationship_agent_high_id: Option<String>,
    pub relationship_direction: Option<RelationshipDirection>,
    pub directed_actor_agent_profile_id: Option<String>,
}

impl MemoryScope {
    fn hearth() -> Self {
        Self {
            kind: MemoryScopeKind::Hearth,
            companion_agent_profile_id: None,
            relationship_agent_low_id: None,
            relationship_agent_high_id: None,
            relationship_direction: None,
            directed_actor_agent_profile_id: None,
        }
    }

    fn companion(agent_profile_id: String) -> Self {
        Self {
            kind: MemoryScopeKind::Companion,
            companion_agent_profile_id: Some(agent_profile_id),
            relationship_agent_low_id: None,
            relationship_agent_high_id: None,
            relationship_direction: None,
            directed_actor_agent_profile_id: None,
        }
    }

    fn relationship(
        first: String,
        second: String,
        direction: RelationshipDirection,
        directed_actor: Option<String>,
    ) -> Result<Self> {
        if first.trim().is_empty() || second.trim().is_empty() || first == second {
            anyhow::bail!("Relationship Memory requires two different AgentProfiles");
        }
        let (low, high) = if first < second {
            (first, second)
        } else {
            (second, first)
        };
        let directed_actor = match direction {
            RelationshipDirection::Mutual => {
                if directed_actor.is_some() {
                    anyhow::bail!("Mutual Relationship Memory cannot have a directed actor");
                }
                None
            }
            RelationshipDirection::Directed => {
                let actor = directed_actor
                    .context("Directed Relationship Memory requires directedActorAgentProfileId")?;
                if actor != low && actor != high {
                    anyhow::bail!("Directed actor must be one of the Relationship members");
                }
                Some(actor)
            }
        };
        Ok(Self {
            kind: MemoryScopeKind::Relationship,
            companion_agent_profile_id: None,
            relationship_agent_low_id: Some(low),
            relationship_agent_high_id: Some(high),
            relationship_direction: Some(direction),
            directed_actor_agent_profile_id: directed_actor,
        })
    }

    fn identity_json(&self) -> Value {
        json!({
            "scope": self.kind,
            "companionAgentProfileId": self.companion_agent_profile_id,
            "relationshipAgentLowId": self.relationship_agent_low_id,
            "relationshipAgentHighId": self.relationship_agent_high_id,
            "direction": self.relationship_direction,
            "directedActorAgentProfileId": self.directed_actor_agent_profile_id,
        })
    }

    fn same_identity(&self, other: &Self) -> bool {
        self == other
    }

    fn contains_agent(&self, agent_profile_id: &str) -> bool {
        self.companion_agent_profile_id.as_deref() == Some(agent_profile_id)
            || self.relationship_agent_low_id.as_deref() == Some(agent_profile_id)
            || self.relationship_agent_high_id.as_deref() == Some(agent_profile_id)
    }

    fn counterparty(&self, agent_profile_id: &str) -> Option<&str> {
        if self.relationship_agent_low_id.as_deref() == Some(agent_profile_id) {
            self.relationship_agent_high_id.as_deref()
        } else if self.relationship_agent_high_id.as_deref() == Some(agent_profile_id) {
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
    pub companion_agent_profile_id: Option<String>,
    #[serde(default)]
    pub relationship_agent_profile_ids: Vec<String>,
    pub direction: Option<RelationshipDirection>,
    pub directed_actor_agent_profile_id: Option<String>,
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
    pub review_after: Option<String>,
}

impl sealed::Sealed for ReviseMemoryCommand {}
impl DomainCommand for ReviseMemoryCommand {
    const TYPE: &'static str = "memory.revise";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetireMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RetireMemoryCommand {}
impl DomainCommand for RetireMemoryCommand {
    const TYPE: &'static str = "memory.retire";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactivateMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ReactivateMemoryCommand {}
impl DomainCommand for ReactivateMemoryCommand {
    const TYPE: &'static str = "memory.reactivate";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgetMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ForgetMemoryCommand {}
impl DomainCommand for ForgetMemoryCommand {
    const TYPE: &'static str = "memory.forget";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
    pub base_revision_id: String,
}

impl sealed::Sealed for ConfirmMemoryCommand {}
impl DomainCommand for ConfirmMemoryCommand {
    const TYPE: &'static str = "memory.confirm";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoAutoAppliedMemoryCommand {
    pub memory_id: String,
    pub expected_version: i64,
    pub revision_id: String,
}

impl sealed::Sealed for UndoAutoAppliedMemoryCommand {}
impl DomainCommand for UndoAutoAppliedMemoryCommand {
    const TYPE: &'static str = "memory.autoApply.undo";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMemoryAutoPolicyCommand {
    pub expected_version: i64,
    pub companion_lesson_auto_apply_enabled: bool,
}

impl sealed::Sealed for SetMemoryAutoPolicyCommand {}
impl DomainCommand for SetMemoryAutoPolicyCommand {
    const TYPE: &'static str = "memory.autoPolicy.set";
}

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
pub struct SaveMemoryProposalCommand {
    pub action: String,
    pub scope: Option<MemoryScopeKind>,
    pub kind: Option<MemoryKind>,
    pub body: String,
    pub counterparty_agent_id: Option<String>,
    pub direction: Option<RelationshipDirection>,
    pub memory_id: Option<String>,
    pub base_revision_id: Option<String>,
}

impl sealed::Sealed for SaveMemoryProposalCommand {}
impl DomainCommand for SaveMemoryProposalCommand {
    const TYPE: &'static str = "memory.propose_change";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptMemoryProposalCommand {
    pub proposal_id: String,
    pub expected_version: i64,
    pub final_candidate: Option<CreateMemoryCommand>,
    pub final_body: Option<String>,
}

impl sealed::Sealed for AcceptMemoryProposalCommand {}
impl DomainCommand for AcceptMemoryProposalCommand {
    const TYPE: &'static str = "memory.proposal.accept";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectMemoryProposalCommand {
    pub proposal_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RejectMemoryProposalCommand {}
impl DomainCommand for RejectMemoryProposalCommand {
    const TYPE: &'static str = "memory.proposal.reject";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectMemoryProposalsCommand {
    pub proposals: Vec<ProposalVersionRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalVersionRef {
    pub proposal_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RejectMemoryProposalsCommand {}
impl DomainCommand for RejectMemoryProposalsCommand {
    const TYPE: &'static str = "memory.proposal.reject_batch";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCampMemberMemoryProposalCommand {
    pub camp_id: String,
    pub agent_profile_id: String,
    pub expected_version: i64,
    pub enabled: bool,
}

impl sealed::Sealed for SetCampMemberMemoryProposalCommand {}
impl DomainCommand for SetCampMemberMemoryProposalCommand {
    const TYPE: &'static str = "camp_member.memory_proposal.set";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRevisionView {
    pub id: String,
    pub body: Option<String>,
    pub body_utf8_bytes: Option<i64>,
    pub created_from_proposal_id: Option<String>,
    pub authority: MemoryRevisionAuthority,
    pub confirmed_from_revision_id: Option<String>,
    pub created_at: String,
    pub cleared_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryView {
    pub id: String,
    pub scope: Option<MemoryScopeKind>,
    pub kind: Option<MemoryKind>,
    pub companion_agent_profile_id: Option<String>,
    pub relationship_agent_profile_ids: Vec<String>,
    pub direction: Option<RelationshipDirection>,
    pub directed_actor_agent_profile_id: Option<String>,
    pub lifecycle: String,
    pub current_revision_id: Option<String>,
    pub current_authority: Option<MemoryRevisionAuthority>,
    pub current_body: Option<String>,
    pub current_body_utf8_bytes: Option<i64>,
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
    pub active_body_bytes: i64,
    pub max_body_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListView {
    pub memories: Vec<MemoryView>,
    pub capacities: Vec<MemoryCapacityView>,
    pub provisional_counts: Vec<MemoryProvisionalCountView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProvisionalCountView {
    pub companion_agent_profile_id: String,
    pub active_count: i64,
    pub max_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryAutoPolicyView {
    pub companion_lesson_auto_apply_enabled: bool,
    pub acknowledged_at: Option<String>,
    pub version: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProposalView {
    pub id: String,
    pub action: String,
    pub status: String,
    pub scope: Option<MemoryScopeKind>,
    pub kind: Option<MemoryKind>,
    pub companion_agent_profile_id: Option<String>,
    pub relationship_agent_profile_ids: Vec<String>,
    pub direction: Option<RelationshipDirection>,
    pub directed_actor_agent_profile_id: Option<String>,
    pub body: Option<String>,
    pub target_memory_id: Option<String>,
    pub base_revision_id: Option<String>,
    pub proposed_by_agent_profile_id: String,
    pub source_camp_id: String,
    pub source_agent_run_id: String,
    pub source_execution_epoch: i64,
    pub source_unavailable: bool,
    pub stale: bool,
    pub accepted_memory_id: Option<String>,
    pub accepted_revision_id: Option<String>,
    pub resolution_mode: Option<MemoryProposalResolutionMode>,
    pub resolution_policy_version: Option<i64>,
    pub version: i64,
    pub proposed_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedMemoryEntry {
    pub memory_id: String,
    pub revision_id: String,
    pub authority: MemoryRevisionAuthority,
    pub kind: MemoryKind,
    pub direction: Option<RelationshipDirection>,
    pub body: String,
}

#[derive(Debug, Clone)]
struct MemoryRecord {
    id: String,
    scope: Option<MemoryScope>,
    kind: Option<MemoryKind>,
    lifecycle: String,
    current_revision_id: Option<String>,
    current_authority: Option<MemoryRevisionAuthority>,
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
    review_after: Option<String>,
}

#[derive(Debug, Clone)]
struct ProposalRecord {
    id: String,
    action: String,
    status: String,
    scope: Option<MemoryScope>,
    kind: Option<MemoryKind>,
    body: Option<String>,
    target_memory_id: Option<String>,
    base_revision_id: Option<String>,
    proposed_by_agent_profile_id: String,
    source_camp_id: String,
    source_agent_run_id: String,
    source_execution_epoch: i64,
    accepted_memory_id: Option<String>,
    accepted_revision_id: Option<String>,
    resolution_mode: Option<MemoryProposalResolutionMode>,
    resolution_policy_version: Option<i64>,
    version: i64,
    proposed_at: String,
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
            if !matches!(normalized.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "memory.capability_denied",
                    "Only the user can create formal Memory",
                ));
            }
            let candidate = candidate_from_create(transaction, &normalized.payload)?;
            if memory_secret::contains_secret(&candidate.body) {
                return Ok(rejected(
                    "memory.secret_rejected",
                    "Credential-like secrets cannot be stored in Memory",
                ));
            }
            if active_exact_memory_exists(transaction, &candidate)? {
                return Ok(rejected(
                    "memory.already_exists",
                    "An identical active Memory already exists",
                ));
            }
            ensure_capacity(transaction, &candidate.scope, None, candidate.body_bytes, 1)?;
            let now = Utc::now().to_rfc3339();
            let (memory_id, revision_id) = insert_memory(
                transaction,
                &candidate,
                None,
                MemoryRevisionAuthority::UserConfirmed,
                &now,
            )?;
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
        normalized.payload.review_after =
            normalize_review_after(normalized.payload.review_after.as_deref())?;
        self.gateway.execute(database, &normalized, |transaction| {
            if !matches!(normalized.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "memory.capability_denied",
                    "Only the user can revise formal Memory",
                ));
            }
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
            if record.current_body.as_deref() == Some(normalized.payload.body.as_str()) {
                return Ok(rejected("memory.no_change", "Memory body is unchanged"));
            }
            let scope = record
                .scope
                .clone()
                .context("non-forgotten Memory has no Scope")?;
            let kind = record.kind.context("non-forgotten Memory has no Kind")?;
            let body_bytes = normalized.payload.body.len() as i64;
            if record.lifecycle == "active" {
                ensure_capacity(transaction, &scope, Some(&record.id), body_bytes, 1)?;
            }
            let review_after =
                if record.current_authority == Some(MemoryRevisionAuthority::Provisional) {
                    default_review_after(kind)
                } else {
                    normalized
                        .payload
                        .review_after
                        .clone()
                        .or_else(|| default_review_after(kind))
                };
            let revision_id = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            insert_revision(
                transaction,
                NewRevision {
                    id: &revision_id,
                    memory_id: &record.id,
                    body: &normalized.payload.body,
                    body_bytes,
                    proposal_id: None,
                    authority: MemoryRevisionAuthority::UserConfirmed,
                    confirmed_from_revision_id: None,
                    created_at: &now,
                },
            )?;
            transaction.execute(
                r#"
                UPDATE memory
                SET current_revision_id = ?2, review_after = ?3,
                    version = version + 1, updated_at = ?4
                WHERE id = ?1
                "#,
                params![record.id, revision_id, review_after, now],
            )?;
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
            require_user_lifecycle(&envelope.actor)?;
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
            require_user_lifecycle(&envelope.actor)?;
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
            let outgoing: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM memory_supersession WHERE predecessor_memory_id = ?1",
                [&record.id],
                |row| row.get(0),
            )?;
            if outgoing > 0 {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "A superseded predecessor cannot be reactivated",
                ));
            }
            let scope = record
                .scope
                .clone()
                .context("retired Memory has no Scope")?;
            ensure_capacity(
                transaction,
                &scope,
                None,
                record.current_body_utf8_bytes.unwrap_or_default(),
                1,
            )?;
            if record.current_authority == Some(MemoryRevisionAuthority::Provisional) {
                let companion_agent_profile_id = scope
                    .companion_agent_profile_id
                    .as_deref()
                    .context("provisional Memory must have Companion Scope")?;
                ensure_provisional_companion_capacity(
                    transaction,
                    companion_agent_profile_id,
                    None,
                )?;
            }
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
            require_user_lifecycle(&envelope.actor)?;
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
            clear_memory_contents(transaction, &record.id, &now)?;
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

    pub fn confirm(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ConfirmMemoryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            let Some(record) = load_memory_record(transaction, &envelope.payload.memory_id)? else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != envelope.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.lifecycle != "active" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Only active provisional Memory can be confirmed",
                ));
            }
            if record.current_revision_id.as_deref()
                != Some(envelope.payload.base_revision_id.as_str())
            {
                return Ok(rejected(
                    "memory.revision_conflict",
                    "Memory current Revision no longer matches baseRevisionId",
                ));
            }
            if record.current_authority != Some(MemoryRevisionAuthority::Provisional) {
                return Ok(rejected(
                    "memory.authority_conflict",
                    "Only provisional Memory can be confirmed",
                ));
            }
            let body = record
                .current_body
                .as_deref()
                .context("active provisional Memory has no body")?;
            let revision_id = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            insert_revision(
                transaction,
                NewRevision {
                    id: &revision_id,
                    memory_id: &record.id,
                    body,
                    body_bytes: record.current_body_utf8_bytes.unwrap_or(body.len() as i64),
                    proposal_id: None,
                    authority: MemoryRevisionAuthority::UserConfirmed,
                    confirmed_from_revision_id: Some(&envelope.payload.base_revision_id),
                    created_at: &now,
                },
            )?;
            let review_after =
                default_review_after(record.kind.context("active Memory has no Kind")?);
            transaction.execute(
                r#"
                UPDATE memory
                SET current_revision_id = ?2, review_after = ?3,
                    version = version + 1, updated_at = ?4
                WHERE id = ?1
                "#,
                params![record.id, revision_id, review_after, now],
            )?;
            append_memory_event(
                transaction,
                "memory.provisional_confirmed",
                &record.id,
                envelope,
                json!({
                    "memoryId": record.id,
                    "revisionId": revision_id,
                    "confirmedFromRevisionId": envelope.payload.base_revision_id,
                    "authority": MemoryRevisionAuthority::UserConfirmed,
                    "version": record.version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_provisional_confirmed",
                json!({
                    "memoryId": record.id,
                    "revisionId": revision_id,
                    "authority": MemoryRevisionAuthority::UserConfirmed,
                    "version": record.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: record.id,
                }),
            ))
        })
    }

    pub fn undo_auto_applied(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UndoAutoAppliedMemoryCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            let Some(record) = load_memory_record(transaction, &envelope.payload.memory_id)? else {
                return Ok(rejected("memory.not_found", "Memory does not exist"));
            };
            if record.version != envelope.payload.expected_version {
                return Ok(version_conflict(&record));
            }
            if record.version != 1
                || record.lifecycle != "active"
                || record.current_revision_id.as_deref()
                    != Some(envelope.payload.revision_id.as_str())
                || record.current_authority != Some(MemoryRevisionAuthority::Provisional)
            {
                return Ok(rejected(
                    "memory.undo_conflict",
                    "Automatic Memory changed and can no longer be narrowly undone",
                ));
            }
            let eligible: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM memory_revision AS revision
                JOIN memory_proposal AS proposal
                  ON proposal.id = revision.created_from_proposal_id
                WHERE revision.id = ?1
                  AND revision.memory_id = ?2
                  AND revision.authority_status = 'provisional'
                  AND proposal.action = 'add'
                  AND proposal.status = 'accepted'
                  AND proposal.resolution_mode = 'policy_auto'
                  AND proposal.accepted_memory_id = ?2
                  AND proposal.accepted_revision_id = ?1
                "#,
                params![envelope.payload.revision_id, record.id],
                |row| row.get(0),
            )?;
            let supersession_count: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM memory_supersession
                WHERE predecessor_memory_id = ?1 OR successor_memory_id = ?1
                "#,
                [&record.id],
                |row| row.get(0),
            )?;
            if eligible != 1 || supersession_count != 0 {
                return Ok(rejected(
                    "memory.undo_conflict",
                    "Memory is not an unchanged policy-auto add",
                ));
            }
            let now = Utc::now().to_rfc3339();
            clear_memory_contents(transaction, &record.id, &now)?;
            append_memory_event(
                transaction,
                "memory.auto_apply_undone",
                &record.id,
                envelope,
                json!({
                    "memoryId": record.id,
                    "revisionId": envelope.payload.revision_id,
                    "version": record.version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_auto_apply_undone",
                json!({
                    "memoryId": record.id,
                    "version": record.version + 1,
                    "lifecycle": "forgotten",
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: record.id,
                }),
            ))
        })
    }

    pub fn get_auto_policy(&self, database: &Database) -> Result<MemoryAutoPolicyView> {
        load_memory_auto_policy(database.connection())
    }

    pub fn set_auto_policy(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetMemoryAutoPolicyCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            let policy = load_memory_auto_policy(transaction)?;
            if policy.version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "memory.version_conflict",
                    json!({
                        "message": "Memory auto policy version no longer matches",
                        "currentVersion": policy.version,
                    }),
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE memory_auto_policy
                SET companion_lesson_auto_apply_enabled = ?1,
                    acknowledged_at = ?2,
                    version = version + 1,
                    updated_at = ?2
                WHERE singleton = 1
                "#,
                params![envelope.payload.companion_lesson_auto_apply_enabled, now,],
            )?;
            append_domain_event(
                transaction,
                "memory.auto_policy_changed",
                None,
                Some(("memory_auto_policy", "1")),
                &envelope.actor,
                None,
                &json!({
                    "enabled": envelope.payload.companion_lesson_auto_apply_enabled,
                    "policyVersion": policy.version + 1,
                    "policySchemaVersion": MEMORY_AUTO_POLICY_SCHEMA_VERSION,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_auto_policy_set",
                json!({
                    "companionLessonAutoApplyEnabled":
                        envelope.payload.companion_lesson_auto_apply_enabled,
                    "acknowledgedAt": now,
                    "version": policy.version + 1,
                }),
                Some(EntityReference {
                    entity_type: "memory_auto_policy".to_string(),
                    entity_id: "1".to_string(),
                }),
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
            require_user_lifecycle(&normalized.actor)?;
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
                    "hasReviewAfter": normalized.payload.review_after.is_some(),
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
            require_user_lifecycle(&normalized.actor)?;
            if normalized.payload.predecessors.is_empty() {
                return Ok(rejected(
                    "memory.invalid_input",
                    "Supersession requires at least one predecessor",
                ));
            }
            let mut unique = BTreeSet::new();
            let mut predecessors = Vec::new();
            for reference in &normalized.payload.predecessors {
                if !unique.insert(reference.memory_id.clone()) {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "Supersession predecessor IDs must be unique",
                    ));
                }
                let Some(record) = load_memory_record(transaction, &reference.memory_id)? else {
                    return Ok(rejected(
                        "memory.not_found",
                        "Predecessor Memory does not exist",
                    ));
                };
                if record.version != reference.expected_version {
                    return Ok(version_conflict(&record));
                }
                if record.lifecycle != "active" {
                    return Ok(rejected(
                        "memory.lifecycle_conflict",
                        "Supersession predecessor must be active",
                    ));
                }
                predecessors.push(record);
            }
            let now = Utc::now().to_rfc3339();
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
            }
            let (successor_id, successor_revision_id) = match &normalized.payload.successor {
                SupersessionSuccessor::Existing {
                    memory_id,
                    expected_version,
                } => {
                    let Some(record) = load_memory_record(transaction, memory_id)? else {
                        return Ok(rejected(
                            "memory.not_found",
                            "Successor Memory does not exist",
                        ));
                    };
                    if record.version != *expected_version {
                        return Ok(version_conflict(&record));
                    }
                    if record.lifecycle != "active" {
                        return Ok(rejected(
                            "memory.lifecycle_conflict",
                            "Existing successor must be active",
                        ));
                    }
                    (
                        record.id,
                        record
                            .current_revision_id
                            .context("active successor has no current Revision")?,
                    )
                }
                SupersessionSuccessor::Create { candidate } => {
                    let candidate = candidate_from_create(transaction, candidate)?;
                    if memory_secret::contains_secret(&candidate.body) {
                        return Ok(rejected(
                            "memory.secret_rejected",
                            "Credential-like secrets cannot be stored in Memory",
                        ));
                    }
                    if active_exact_memory_exists(transaction, &candidate)? {
                        return Ok(rejected(
                            "memory.already_exists",
                            "An identical active Memory already exists",
                        ));
                    }
                    ensure_capacity(transaction, &candidate.scope, None, candidate.body_bytes, 1)?;
                    insert_memory(
                        transaction,
                        &candidate,
                        None,
                        MemoryRevisionAuthority::UserConfirmed,
                        &now,
                    )?
                }
            };
            for predecessor in &predecessors {
                if predecessor.id == successor_id
                    || supersession_path_exists(transaction, &successor_id, &predecessor.id)?
                {
                    return Ok(rejected(
                        "memory.supersession_cycle",
                        "Supersession would create a cycle",
                    ));
                }
                transaction.execute(
                    r#"
                    INSERT INTO memory_supersession(
                        predecessor_memory_id, successor_memory_id, created_at
                    ) VALUES (?1, ?2, ?3)
                    "#,
                    params![predecessor.id, successor_id, now],
                )?;
            }
            append_memory_event(
                transaction,
                "memory.superseded",
                &successor_id,
                &normalized,
                json!({
                    "successorMemoryId": successor_id,
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

    pub fn save_proposal(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SaveMemoryProposalCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        normalized.payload.body = canonicalize_memory_body(&normalized.payload.body)?;
        self.gateway.execute(database, &normalized, |transaction| {
            let (agent_profile_id, source_agent_run_id) = match &normalized.actor {
                ActorRef::Agent {
                    agent_profile_id,
                    source_agent_run_id,
                } => (agent_profile_id.as_str(), source_agent_run_id.as_str()),
                _ => {
                    return Ok(rejected(
                        "memory.capability_denied",
                        "Memory Proposal requires a current AgentRun",
                    ));
                }
            };
            let source_camp_id = normalized
                .camp_id
                .as_deref()
                .context("Agent Memory Proposal has no Camp")?;
            let execution_epoch = normalized
                .execution_epoch
                .context("Agent Memory Proposal has no Execution Epoch")?;
            if !validate_proposal_run(
                transaction,
                source_agent_run_id,
                agent_profile_id,
                source_camp_id,
                execution_epoch,
            )? {
                return Ok(rejected(
                    "memory.run_not_current",
                    "AgentRun is not current for Memory Proposal",
                ));
            }
            if memory_secret::contains_secret(&normalized.payload.body) {
                return Ok(rejected(
                    "memory.secret_rejected",
                    "Credential-like secrets cannot be stored in Memory",
                ));
            }
            let persisted: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM memory_proposal WHERE source_agent_run_id = ?1",
                [source_agent_run_id],
                |row| row.get(0),
            )?;
            if persisted >= MEMORY_PROPOSALS_PER_RUN {
                return Ok(rejected(
                    "memory.run_quota_exhausted",
                    "AgentRun Memory Proposal quota is exhausted",
                ));
            }
            let now = Utc::now().to_rfc3339();
            let proposal_id = Uuid::new_v4().to_string();
            let (
                scope,
                kind,
                target_memory_id,
                base_revision_id,
                pending_key,
                auto_candidate,
            ) = match normalized.payload.action.as_str() {
                "add" => {
                    if normalized.payload.memory_id.is_some()
                        || normalized.payload.base_revision_id.is_some()
                    {
                        return Ok(rejected(
                            "memory.invalid_input",
                            "add cannot include memoryId or baseRevisionId",
                        ));
                    }
                    let scope = proposal_add_scope(
                        transaction,
                        &normalized.payload,
                        agent_profile_id,
                        source_camp_id,
                    )?;
                    let kind = normalized.payload.kind.context("add requires kind")?;
                    validate_kind_for_scope(kind, &scope)?;
                    let candidate = Candidate {
                        scope: scope.clone(),
                        kind,
                        body: normalized.payload.body.clone(),
                        body_bytes: normalized.payload.body.len() as i64,
                        review_after: None,
                    };
                    if active_exact_memory_exists(transaction, &candidate)? {
                        return Ok(rejected(
                            "memory.already_exists",
                            "An identical active Memory already exists",
                        ));
                    }
                    let key = proposal_add_key(&candidate)?;
                    (
                        Some(scope),
                        Some(kind),
                        None,
                        None,
                        key,
                        Some(candidate),
                    )
                }
                "revise" => {
                    if normalized.payload.scope.is_some()
                        || normalized.payload.kind.is_some()
                        || normalized.payload.counterparty_agent_id.is_some()
                        || normalized.payload.direction.is_some()
                    {
                        return Ok(rejected(
                            "memory.invalid_input",
                            "revise accepts only memoryId, baseRevisionId and body",
                        ));
                    }
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
                        return Ok(rejected("memory.not_found", "Memory does not exist"));
                    };
                    if record.lifecycle != "active"
                        || !memory_applicable_to_agent(
                            transaction,
                            &record,
                            agent_profile_id,
                            source_camp_id,
                        )?
                    {
                        return Ok(rejected(
                            "memory.scope_forbidden",
                            "Memory is not in the Agent's current applicable Projection",
                        ));
                    }
                    if record.current_revision_id.as_deref() != Some(base_revision_id) {
                        return Ok(rejected(
                            "memory.revision_conflict",
                            "baseRevisionId is not current",
                        ));
                    }
                    if record.current_body.as_deref() == Some(normalized.payload.body.as_str()) {
                        return Ok(rejected("memory.no_change", "Memory body is unchanged"));
                    }
                    let key =
                        proposal_revise_key(memory_id, base_revision_id, &normalized.payload.body)?;
                    (
                        None,
                        None,
                        Some(memory_id.to_string()),
                        Some(base_revision_id.to_string()),
                        key,
                        None,
                    )
                }
                _ => {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "action must be add or revise",
                    ));
                }
            };
            let duplicate: Option<String> = transaction
                .query_row(
                    r#"
                    SELECT id FROM memory_proposal
                    WHERE status = 'pending' AND pending_key_digest = ?1
                    "#,
                    [&pending_key],
                    |row| row.get(0),
                )
                .optional()?;
            if duplicate.is_some() {
                return Ok(rejected(
                    "memory.duplicate_pending",
                    "An identical pending Proposal already exists",
                ));
            }
            let scope_ref = scope.as_ref();
            transaction.execute(
                r#"
                INSERT INTO memory_proposal(
                    id, action, status,
                    candidate_scope_kind, candidate_kind,
                    candidate_companion_agent_profile_id,
                    candidate_relationship_agent_low_id,
                    candidate_relationship_agent_high_id,
                    candidate_relationship_direction,
                    candidate_directed_actor_agent_profile_id,
                    candidate_body, candidate_body_utf8_bytes,
                    target_memory_id, base_revision_id, pending_key_digest,
                    proposed_by_agent_profile_id, source_camp_id,
                    source_agent_run_id, source_execution_epoch,
                    version, proposed_at
                ) VALUES (
                    ?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1, ?19
                )
                "#,
                params![
                    proposal_id,
                    normalized.payload.action,
                    scope_ref.map(|scope| scope.kind.as_str()),
                    kind.map(|kind| kind.as_str()),
                    scope_ref.and_then(|scope| scope.companion_agent_profile_id.as_deref()),
                    scope_ref.and_then(|scope| scope.relationship_agent_low_id.as_deref()),
                    scope_ref.and_then(|scope| scope.relationship_agent_high_id.as_deref()),
                    scope_ref
                        .and_then(|scope| scope.relationship_direction)
                        .map(RelationshipDirection::as_str),
                    scope_ref
                        .and_then(|scope| { scope.directed_actor_agent_profile_id.as_deref() }),
                    normalized.payload.body,
                    normalized.payload.body.len() as i64,
                    target_memory_id,
                    base_revision_id,
                    pending_key,
                    agent_profile_id,
                    source_camp_id,
                    source_agent_run_id,
                    execution_epoch,
                    now,
                ],
            )?;
            let policy = load_memory_auto_policy(transaction)?;
            let policy_auto_count: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM memory_proposal
                WHERE source_agent_run_id = ?1
                  AND resolution_mode = 'policy_auto'
                "#,
                [source_agent_run_id],
                |row| row.get(0),
            )?;
            let auto_matrix_matches = auto_candidate.as_ref().is_some_and(|candidate| {
                candidate.scope.kind == MemoryScopeKind::Companion
                    && candidate.scope.companion_agent_profile_id.as_deref()
                        == Some(agent_profile_id)
                    && candidate.kind == MemoryKind::Lesson
            });
            let auto_capacity_available = if auto_matrix_matches {
                let candidate = auto_candidate
                    .as_ref()
                    .context("automatic Memory candidate disappeared")?;
                let companion_agent_profile_id = candidate
                    .scope
                    .companion_agent_profile_id
                    .as_deref()
                    .context("automatic Memory candidate has no Companion")?;
                capacity_available(
                    transaction,
                    &candidate.scope,
                    None,
                    candidate.body_bytes,
                    1,
                )? && active_provisional_companion_count(
                    transaction,
                    companion_agent_profile_id,
                    None,
                )? < COMPANION_PROVISIONAL_MAX_COUNT
            } else {
                false
            };
            if policy.companion_lesson_auto_apply_enabled
                && policy.acknowledged_at.is_some()
                && policy_auto_count < MEMORY_POLICY_AUTO_PER_RUN
                && auto_matrix_matches
                && auto_capacity_available
            {
                let mut candidate = auto_candidate
                    .context("automatic Memory candidate disappeared")?;
                candidate.review_after = default_review_after_for_authority(
                    candidate.kind,
                    MemoryRevisionAuthority::Provisional,
                );
                let (memory_id, revision_id) = insert_memory(
                    transaction,
                    &candidate,
                    Some(&proposal_id),
                    MemoryRevisionAuthority::Provisional,
                    &now,
                )?;
                transaction.execute(
                    r#"
                    UPDATE memory_proposal
                    SET status = 'accepted', pending_key_digest = NULL,
                        accepted_memory_id = ?2, accepted_revision_id = ?3,
                        resolution_mode = 'policy_auto',
                        resolution_policy_version = ?4,
                        version = version + 1, resolved_at = ?5
                    WHERE id = ?1
                    "#,
                    params![
                        proposal_id,
                        memory_id,
                        revision_id,
                        policy.version,
                        now,
                    ],
                )?;
                append_memory_event(
                    transaction,
                    "memory.proposal_auto_applied",
                    &proposal_id,
                    &normalized,
                    json!({
                        "proposalId": proposal_id,
                        "memoryId": memory_id,
                        "revisionId": revision_id,
                        "companionAgentProfileId": agent_profile_id,
                        "resolutionMode": MemoryProposalResolutionMode::PolicyAuto,
                        "policyVersion": policy.version,
                        "authority": MemoryRevisionAuthority::Provisional,
                    }),
                )?;
                return Ok(CommandHandlerResult::applied(
                    "memory_proposal_auto_applied",
                    json!({
                        "rovaiTeamTool": "memory.propose_change",
                        "rovaiTeamReceipt": "Provisional Companion Lesson applied under user policy; not user-confirmed.",
                        "proposalId": proposal_id,
                        "status": "accepted",
                        "resolutionMode": MemoryProposalResolutionMode::PolicyAuto,
                        "effective": true,
                        "authority": MemoryRevisionAuthority::Provisional,
                        "memoryId": memory_id,
                        "revisionId": revision_id,
                    }),
                    Some(EntityReference {
                        entity_type: "memory".to_string(),
                        entity_id: memory_id,
                    }),
                ));
            }
            append_memory_event(
                transaction,
                "memory.proposal_saved",
                &proposal_id,
                &normalized,
                json!({
                    "proposalId": proposal_id,
                    "status": "pending",
                    "effective": false,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "memory_proposal_saved",
                json!({
                    "rovaiTeamTool": "memory.propose_change",
                    "rovaiTeamReceipt": "Proposal saved; awaiting user confirmation.",
                    "proposalId": proposal_id,
                    "status": "pending",
                    "effective": false,
                }),
                Some(EntityReference {
                    entity_type: "memory_proposal".to_string(),
                    entity_id: proposal_id,
                }),
            ))
        })
    }

    pub fn accept_proposal(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AcceptMemoryProposalCommand>,
    ) -> Result<CommandExecution> {
        let mut normalized = envelope.clone();
        if let Some(candidate) = &mut normalized.payload.final_candidate {
            normalize_create_command(candidate)?;
        }
        if let Some(body) = &mut normalized.payload.final_body {
            *body = canonicalize_memory_body(body)?;
        }
        self.gateway.execute(database, &normalized, |transaction| {
            require_user_lifecycle(&normalized.actor)?;
            let Some(proposal) =
                load_proposal_record(transaction, &normalized.payload.proposal_id)?
            else {
                return Ok(rejected(
                    "memory.not_found",
                    "Memory Proposal does not exist",
                ));
            };
            if proposal.version != normalized.payload.expected_version {
                return Ok(rejected(
                    "memory.version_conflict",
                    "Memory Proposal version no longer matches",
                ));
            }
            if proposal.status != "pending" {
                return Ok(rejected(
                    "memory.lifecycle_conflict",
                    "Only pending Proposal can be accepted",
                ));
            }
            let now = Utc::now().to_rfc3339();
            let (memory_id, revision_id) = if proposal.action == "add" {
                if normalized.payload.final_body.is_some() {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "add Proposal edit must submit finalCandidate",
                    ));
                }
                let candidate = if let Some(command) = &normalized.payload.final_candidate {
                    candidate_from_create(transaction, command)?
                } else {
                    candidate_from_proposal(&proposal)?
                };
                if memory_secret::contains_secret(&candidate.body) {
                    return Ok(rejected(
                        "memory.secret_rejected",
                        "Credential-like secrets cannot be stored in Memory",
                    ));
                }
                if active_exact_memory_exists(transaction, &candidate)? {
                    return Ok(rejected(
                        "memory.already_exists",
                        "An identical active Memory already exists",
                    ));
                }
                ensure_capacity(transaction, &candidate.scope, None, candidate.body_bytes, 1)?;
                insert_memory(
                    transaction,
                    &candidate,
                    Some(&proposal.id),
                    MemoryRevisionAuthority::UserConfirmed,
                    &now,
                )?
            } else {
                if normalized.payload.final_candidate.is_some() {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "revise Proposal cannot change Memory identity",
                    ));
                }
                let memory_id = proposal
                    .target_memory_id
                    .as_deref()
                    .context("revise Proposal has no target Memory")?;
                let base_revision_id = proposal
                    .base_revision_id
                    .as_deref()
                    .context("revise Proposal has no base Revision")?;
                let Some(record) = load_memory_record(transaction, memory_id)? else {
                    return Ok(rejected("memory.not_found", "Target Memory does not exist"));
                };
                if record.lifecycle != "active"
                    || record.current_revision_id.as_deref() != Some(base_revision_id)
                {
                    return Ok(rejected(
                        "memory.proposal_stale",
                        "Proposal base Revision is no longer current",
                    ));
                }
                let body = normalized
                    .payload
                    .final_body
                    .as_deref()
                    .or(proposal.body.as_deref())
                    .context("revise Proposal body was cleared")?;
                if memory_secret::contains_secret(body) {
                    return Ok(rejected(
                        "memory.secret_rejected",
                        "Credential-like secrets cannot be stored in Memory",
                    ));
                }
                if record.current_body.as_deref() == Some(body) {
                    return Ok(rejected("memory.no_change", "Memory body is unchanged"));
                }
                let scope = record
                    .scope
                    .as_ref()
                    .context("active Memory has no Scope")?;
                ensure_capacity(transaction, scope, Some(&record.id), body.len() as i64, 1)?;
                let revision_id = Uuid::new_v4().to_string();
                insert_revision(
                    transaction,
                    NewRevision {
                        id: &revision_id,
                        memory_id: &record.id,
                        body,
                        body_bytes: body.len() as i64,
                        proposal_id: Some(&proposal.id),
                        authority: MemoryRevisionAuthority::UserConfirmed,
                        confirmed_from_revision_id: None,
                        created_at: &now,
                    },
                )?;
                let review_after =
                    default_review_after(record.kind.context("active Memory has no Kind")?);
                transaction.execute(
                    r#"
                    UPDATE memory
                    SET current_revision_id = ?2, review_after = ?3,
                        version = version + 1, updated_at = ?4
                    WHERE id = ?1
                    "#,
                    params![record.id, revision_id, review_after, now],
                )?;
                (record.id, revision_id)
            };
            transaction.execute(
                r#"
                UPDATE memory_proposal
                SET status = 'accepted', pending_key_digest = NULL,
                    accepted_memory_id = ?2, accepted_revision_id = ?3,
                    resolution_mode = 'user', resolution_policy_version = NULL,
                    version = version + 1, resolved_at = ?4
                WHERE id = ?1
                "#,
                params![proposal.id, memory_id, revision_id, now],
            )?;
            append_memory_event(
                transaction,
                "memory.proposal_accepted",
                &proposal.id,
                &normalized,
                json!({
                    "proposalId": proposal.id,
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_proposal_accepted",
                json!({
                    "proposalId": proposal.id,
                    "memoryId": memory_id,
                    "revisionId": revision_id,
                    "status": "accepted",
                }),
                Some(EntityReference {
                    entity_type: "memory".to_string(),
                    entity_id: memory_id,
                }),
            ))
        })
    }

    pub fn reject_proposal(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RejectMemoryProposalCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            if let Some(rejection) = proposal_rejection_conflict(
                transaction,
                &envelope.payload.proposal_id,
                envelope.payload.expected_version,
            )? {
                return Ok(rejection);
            }
            clear_rejected_proposal(transaction, &envelope.payload.proposal_id)?;
            append_memory_event(
                transaction,
                "memory.proposal_rejected",
                &envelope.payload.proposal_id,
                envelope,
                json!({"proposalId": envelope.payload.proposal_id, "status": "rejected"}),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_proposal_rejected",
                json!({
                    "proposalId": envelope.payload.proposal_id,
                    "status": "rejected",
                }),
                Some(EntityReference {
                    entity_type: "memory_proposal".to_string(),
                    entity_id: envelope.payload.proposal_id.clone(),
                }),
            ))
        })
    }

    pub fn reject_proposals(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RejectMemoryProposalsCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            if envelope.payload.proposals.is_empty() {
                return Ok(rejected(
                    "memory.invalid_input",
                    "Batch rejection requires at least one Proposal",
                ));
            }
            let mut ids = BTreeSet::new();
            for proposal in &envelope.payload.proposals {
                if !ids.insert(proposal.proposal_id.clone()) {
                    return Ok(rejected(
                        "memory.invalid_input",
                        "Batch rejection Proposal IDs must be unique",
                    ));
                }
                if let Some(rejection) = proposal_rejection_conflict(
                    transaction,
                    &proposal.proposal_id,
                    proposal.expected_version,
                )? {
                    return Ok(rejection);
                }
            }
            for proposal in &envelope.payload.proposals {
                clear_rejected_proposal(transaction, &proposal.proposal_id)?;
            }
            append_memory_event(
                transaction,
                "memory.proposals_rejected",
                &envelope.command_id,
                envelope,
                json!({
                    "proposalIds": ids.iter().cloned().collect::<Vec<_>>(),
                    "count": ids.len(),
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "memory_proposals_rejected",
                json!({
                    "proposalIds": ids.iter().cloned().collect::<Vec<_>>(),
                    "count": ids.len(),
                }),
                None,
            ))
        })
    }

    pub fn set_member_proposal_capability(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetCampMemberMemoryProposalCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            require_user_lifecycle(&envelope.actor)?;
            let current = transaction
                .query_row(
                    r#"
                    SELECT capability_overrides_json, version
                    FROM camp_member
                    WHERE camp_id = ?1 AND agent_profile_id = ?2
                    "#,
                    params![envelope.payload.camp_id, envelope.payload.agent_profile_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            let Some((overrides_json, version)) = current else {
                return Ok(rejected("memory.not_found", "Camp member does not exist"));
            };
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "memory.version_conflict",
                    json!({
                        "campId": envelope.payload.camp_id,
                        "agentProfileId": envelope.payload.agent_profile_id,
                        "currentVersion": version,
                    }),
                ));
            }
            let mut overrides =
                serde_json::from_str::<serde_json::Map<String, Value>>(&overrides_json)
                    .context("Camp member capability overrides are invalid")?;
            overrides.insert(
                MEMORY_PROPOSE_CHANGE_CAPABILITY.to_string(),
                Value::String(
                    if envelope.payload.enabled {
                        "allow"
                    } else {
                        "deny"
                    }
                    .to_string(),
                ),
            );
            let now = Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE camp_member
                SET capability_overrides_json = ?3,
                    version = version + 1
                WHERE camp_id = ?1
                  AND agent_profile_id = ?2
                  AND version = ?4
                "#,
                params![
                    envelope.payload.camp_id,
                    envelope.payload.agent_profile_id,
                    serde_json::to_string(&overrides)?,
                    version,
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "memory.version_conflict",
                    "Camp member changed concurrently",
                ));
            }
            append_memory_event(
                transaction,
                "camp_member.memory_proposal_capability_changed",
                &envelope.payload.agent_profile_id,
                envelope,
                json!({
                    "campId": envelope.payload.camp_id,
                    "agentProfileId": envelope.payload.agent_profile_id,
                    "enabled": envelope.payload.enabled,
                    "version": version + 1,
                    "changedAt": now,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp_member_memory_proposal_capability_set",
                json!({
                    "campId": envelope.payload.camp_id,
                    "agentProfileId": envelope.payload.agent_profile_id,
                    "enabled": envelope.payload.enabled,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "camp_member".to_string(),
                    entity_id: format!(
                        "{}:{}",
                        envelope.payload.camp_id, envelope.payload.agent_profile_id
                    ),
                }),
            ))
        })
    }

    pub fn list(&self, database: &Database) -> Result<MemoryListView> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM memory ORDER BY created_at DESC, id")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let memories = ids
            .iter()
            .map(|id| self.get(database, id))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let capacities = capacity_views(database)?;
        let provisional_counts = provisional_count_views(database)?;
        Ok(MemoryListView {
            memories,
            capacities,
            provisional_counts,
        })
    }

    pub fn get(&self, database: &Database, memory_id: &str) -> Result<Option<MemoryView>> {
        let Some(record) = load_memory_record(database.connection(), memory_id)? else {
            return Ok(None);
        };
        let mut revision_statement = database.connection().prepare(
            r#"
            SELECT id, body, body_utf8_bytes, created_from_proposal_id,
                   authority_status, confirmed_from_revision_id,
                   created_at, cleared_at
            FROM memory_revision
            WHERE memory_id = ?1
            ORDER BY created_at DESC, id DESC
            "#,
        )?;
        let revisions = revision_statement
            .query_map([memory_id], |row| {
                Ok(MemoryRevisionView {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    body_utf8_bytes: row.get(2)?,
                    created_from_proposal_id: row.get(3)?,
                    authority: MemoryRevisionAuthority::parse(&row.get::<_, String>(4)?)
                        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?,
                    confirmed_from_revision_id: row.get(5)?,
                    created_at: row.get(6)?,
                    cleared_at: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let outgoing_successor_ids = load_edge_ids(database.connection(), memory_id, true)?;
        let incoming_predecessor_ids = load_edge_ids(database.connection(), memory_id, false)?;
        Ok(Some(memory_view_from_record(
            record,
            revisions,
            outgoing_successor_ids,
            incoming_predecessor_ids,
        )))
    }

    pub fn list_proposals(&self, database: &Database) -> Result<Vec<MemoryProposalView>> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM memory_proposal ORDER BY proposed_at DESC, id DESC")?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| {
                let proposal = load_proposal_record(database.connection(), &id)?
                    .context("Memory Proposal disappeared during read")?;
                proposal_view(database, proposal)
            })
            .collect()
    }

    pub fn projection_entries(
        &self,
        database: &Database,
        scope_kind: MemoryScopeKind,
        agent_profile_id: Option<&str>,
        counterparty_agent_profile_id: Option<&str>,
    ) -> Result<Vec<ProjectedMemoryEntry>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT memory.id, revision.id, revision.authority_status, memory.kind,
                   memory.relationship_direction,
                   memory.directed_actor_agent_profile_id,
                   memory.companion_agent_profile_id,
                   memory.relationship_agent_low_id,
                   memory.relationship_agent_high_id,
                   revision.body
            FROM memory
            JOIN memory_revision AS revision ON revision.id = memory.current_revision_id
            WHERE memory.lifecycle_status = 'active'
              AND memory.scope_kind = ?1
            ORDER BY CASE revision.authority_status
                        WHEN 'user_confirmed' THEN 0
                        ELSE 1 END,
                     CASE memory.kind
                        WHEN 'preference' THEN 0
                        WHEN 'agreement' THEN 1
                        ELSE 2 END,
                     memory.id
            "#,
        )?;
        let rows = statement
            .query_map([scope_kind.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut entries = Vec::new();
        for (
            memory_id,
            revision_id,
            authority,
            kind,
            direction,
            directed_actor,
            companion_agent,
            relationship_low,
            relationship_high,
            body,
        ) in rows
        {
            let include = match scope_kind {
                MemoryScopeKind::Hearth => true,
                MemoryScopeKind::Companion => companion_agent.as_deref() == agent_profile_id,
                MemoryScopeKind::Relationship => {
                    let Some(agent) = agent_profile_id else {
                        continue;
                    };
                    let Some(counterparty) = counterparty_agent_profile_id else {
                        continue;
                    };
                    let pair_matches = (relationship_low.as_deref() == Some(agent)
                        && relationship_high.as_deref() == Some(counterparty))
                        || (relationship_low.as_deref() == Some(counterparty)
                            && relationship_high.as_deref() == Some(agent));
                    pair_matches
                        && (direction.as_deref() == Some("mutual")
                            || (direction.as_deref() == Some("directed")
                                && directed_actor.as_deref() == Some(agent)))
                }
            };
            if include {
                entries.push(ProjectedMemoryEntry {
                    memory_id,
                    revision_id,
                    authority: MemoryRevisionAuthority::parse(&authority)?,
                    kind: MemoryKind::parse(&kind)?,
                    direction: direction
                        .as_deref()
                        .map(RelationshipDirection::parse)
                        .transpose()?,
                    body,
                });
            }
        }
        Ok(entries)
    }

    pub fn export(&self, database: &Database) -> Result<Value> {
        let memories = self
            .list(database)?
            .memories
            .into_iter()
            .filter(|memory| memory.lifecycle != "forgotten")
            .collect::<Vec<_>>();
        let included_ids = memories
            .iter()
            .map(|memory| memory.id.as_str())
            .collect::<BTreeSet<_>>();
        let mut statement = database.connection().prepare(
            r#"
            SELECT predecessor_memory_id, successor_memory_id, created_at
            FROM memory_supersession
            ORDER BY created_at, predecessor_memory_id, successor_memory_id
            "#,
        )?;
        let supersessions = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|(predecessor, successor, _)| {
                included_ids.contains(predecessor.as_str())
                    && included_ids.contains(successor.as_str())
            })
            .map(|(predecessor_memory_id, successor_memory_id, created_at)| {
                json!({
                    "predecessorMemoryId": predecessor_memory_id,
                    "successorMemoryId": successor_memory_id,
                    "createdAt": created_at,
                })
            })
            .collect::<Vec<_>>();
        let proposals = self
            .list_proposals(database)?
            .into_iter()
            .map(|proposal| {
                let include_body = proposal.status == "accepted";
                json!({
                    "id": proposal.id,
                    "action": proposal.action,
                    "status": proposal.status,
                    "scope": proposal.scope,
                    "kind": proposal.kind,
                    "companionAgentProfileId": proposal.companion_agent_profile_id,
                    "relationshipAgentProfileIds": proposal.relationship_agent_profile_ids,
                    "direction": proposal.direction,
                    "directedActorAgentProfileId": proposal.directed_actor_agent_profile_id,
                    "body": if include_body {
                        proposal.body
                    } else {
                        None
                    },
                    "targetMemoryId": proposal.target_memory_id,
                    "baseRevisionId": proposal.base_revision_id,
                    "proposedByAgentProfileId": proposal.proposed_by_agent_profile_id,
                    "sourceCampId": proposal.source_camp_id,
                    "sourceAgentRunId": proposal.source_agent_run_id,
                    "sourceExecutionEpoch": proposal.source_execution_epoch,
                    "acceptedMemoryId": proposal.accepted_memory_id,
                    "acceptedRevisionId": proposal.accepted_revision_id,
                    "resolutionMode": proposal.resolution_mode,
                    "resolutionPolicyVersion": proposal.resolution_policy_version,
                    "version": proposal.version,
                    "proposedAt": proposal.proposed_at,
                    "resolvedAt": proposal.resolved_at,
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "format": "rovai-memory-export-v2",
            "exportedAt": Utc::now().to_rfc3339(),
            "memories": memories,
            "proposals": proposals,
            "supersessions": supersessions,
        }))
    }

    pub fn diagnostics(&self, database: &Database) -> Result<Value> {
        let memory_counts = database.connection().query_row(
            r#"
            SELECT
                SUM(CASE WHEN lifecycle_status = 'active' THEN 1 ELSE 0 END),
                SUM(CASE WHEN lifecycle_status = 'retired' THEN 1 ELSE 0 END),
                SUM(CASE WHEN lifecycle_status = 'forgotten' THEN 1 ELSE 0 END)
            FROM memory
            "#,
            [],
            |row| {
                Ok(json!({
                    "active": row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    "retired": row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    "forgotten": row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                }))
            },
        )?;
        let proposal_counts = database.connection().query_row(
            r#"
            SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)
            FROM memory_proposal
            "#,
            [],
            |row| {
                Ok(json!({
                    "pending": row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    "accepted": row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    "rejected": row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                }))
            },
        )?;
        let projection_counts = database.connection().query_row(
            r#"
            SELECT
                SUM(CASE WHEN state = 'ready' THEN 1 ELSE 0 END),
                SUM(CASE WHEN state = 'empty' THEN 1 ELSE 0 END),
                SUM(CASE WHEN state = 'unavailable' THEN 1 ELSE 0 END),
                SUM(CASE WHEN state = 'write_failed' THEN 1 ELSE 0 END)
            FROM memory_projection_observation
            "#,
            [],
            |row| {
                Ok(json!({
                    "ready": row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    "empty": row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    "unavailable": row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    "writeFailed": row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                }))
            },
        )?;
        let projection_formatter_version: i64 = database.connection().query_row(
            "SELECT COALESCE(MAX(formatter_version), 0) FROM memory_projection_observation",
            [],
            |row| row.get(0),
        )?;
        let active_provisional_count: i64 = database.connection().query_row(
            r#"
            SELECT COUNT(*)
            FROM memory
            JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.lifecycle_status = 'active'
              AND revision.authority_status = 'provisional'
            "#,
            [],
            |row| row.get(0),
        )?;
        let policy_auto_accepted_count: i64 = database.connection().query_row(
            r#"
            SELECT COUNT(*)
            FROM memory_proposal
            WHERE status = 'accepted' AND resolution_mode = 'policy_auto'
            "#,
            [],
            |row| row.get(0),
        )?;
        let policy = load_memory_auto_policy(database.connection())?;
        Ok(json!({
            "counts": memory_counts,
            "activeProvisionalCount": active_provisional_count,
            "proposalCounts": proposal_counts,
            "policyAutoAcceptedProposalCount": policy_auto_accepted_count,
            "autoPolicy": {
                "enabled": policy.companion_lesson_auto_apply_enabled,
                "version": policy.version,
                "acknowledged": policy.acknowledged_at.is_some(),
                "schemaVersion": MEMORY_AUTO_POLICY_SCHEMA_VERSION,
            },
            "projectionHealth": {
                "formatterVersion": projection_formatter_version,
                "counts": projection_counts,
            },
        }))
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

fn normalize_create_command(command: &mut CreateMemoryCommand) -> Result<()> {
    command.body = canonicalize_memory_body(&command.body)?;
    command.review_after = normalize_review_after(command.review_after.as_deref())?;
    command.relationship_agent_profile_ids.sort();
    command.relationship_agent_profile_ids.dedup();
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
    default_review_after_for_authority(kind, MemoryRevisionAuthority::UserConfirmed)
}

fn default_review_after_for_authority(
    kind: MemoryKind,
    authority: MemoryRevisionAuthority,
) -> Option<String> {
    (kind == MemoryKind::Lesson).then(|| {
        let days = match authority {
            MemoryRevisionAuthority::UserConfirmed => 90,
            MemoryRevisionAuthority::Provisional => 30,
        };
        (Utc::now() + Duration::days(days)).to_rfc3339()
    })
}

fn candidate_from_create(
    transaction: &Transaction<'_>,
    command: &CreateMemoryCommand,
) -> Result<Candidate> {
    let scope = match command.scope {
        MemoryScopeKind::Hearth => {
            if command.companion_agent_profile_id.is_some()
                || !command.relationship_agent_profile_ids.is_empty()
                || command.direction.is_some()
                || command.directed_actor_agent_profile_id.is_some()
            {
                anyhow::bail!("memory.invalid_input: Hearth Memory has no Agent target fields");
            }
            MemoryScope::hearth()
        }
        MemoryScopeKind::Companion => {
            if !command.relationship_agent_profile_ids.is_empty()
                || command.direction.is_some()
                || command.directed_actor_agent_profile_id.is_some()
            {
                anyhow::bail!(
                    "memory.invalid_input: Companion Memory cannot have Relationship fields"
                );
            }
            let agent = command.companion_agent_profile_id.clone().context(
                "memory.invalid_input: Companion Memory requires companionAgentProfileId",
            )?;
            require_agent_profile(transaction, &agent)?;
            MemoryScope::companion(agent)
        }
        MemoryScopeKind::Relationship => {
            if command.companion_agent_profile_id.is_some()
                || command.relationship_agent_profile_ids.len() != 2
            {
                anyhow::bail!(
                    "memory.invalid_input: Relationship Memory requires exactly two AgentProfile IDs"
                );
            }
            let first = command.relationship_agent_profile_ids[0].clone();
            let second = command.relationship_agent_profile_ids[1].clone();
            require_agent_profile(transaction, &first)?;
            require_agent_profile(transaction, &second)?;
            MemoryScope::relationship(
                first,
                second,
                command
                    .direction
                    .context("memory.invalid_input: Relationship Memory requires direction")?,
                command.directed_actor_agent_profile_id.clone(),
            )?
        }
    };
    validate_kind_for_scope(command.kind, &scope)?;
    Ok(Candidate {
        scope,
        kind: command.kind,
        body: command.body.clone(),
        body_bytes: command.body.len() as i64,
        review_after: command
            .review_after
            .clone()
            .or_else(|| default_review_after(command.kind)),
    })
}

fn candidate_from_proposal(proposal: &ProposalRecord) -> Result<Candidate> {
    let scope = proposal
        .scope
        .clone()
        .context("Memory Proposal candidate Scope was cleared")?;
    let kind = proposal
        .kind
        .context("Memory Proposal candidate Kind was cleared")?;
    let body = proposal
        .body
        .clone()
        .context("Memory Proposal candidate body was cleared")?;
    Ok(Candidate {
        scope,
        kind,
        body_bytes: body.len() as i64,
        body,
        review_after: default_review_after(kind),
    })
}

fn validate_kind_for_scope(kind: MemoryKind, scope: &MemoryScope) -> Result<()> {
    if scope.kind == MemoryScopeKind::Relationship && kind == MemoryKind::Preference {
        anyhow::bail!("memory.invalid_input: Relationship Memory allows only agreement or lesson");
    }
    Ok(())
}

fn require_agent_profile(transaction: &Transaction<'_>, agent_profile_id: &str) -> Result<()> {
    let exists: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM agent_profile WHERE id = ?1",
        [agent_profile_id],
        |row| row.get(0),
    )?;
    if exists != 1 {
        anyhow::bail!("memory.invalid_input: AgentProfile does not exist");
    }
    Ok(())
}

fn insert_memory(
    transaction: &Transaction<'_>,
    candidate: &Candidate,
    proposal_id: Option<&str>,
    authority: MemoryRevisionAuthority,
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
            body_bytes: candidate.body_bytes,
            proposal_id,
            authority,
            confirmed_from_revision_id: None,
            created_at: now,
        },
    )?;
    transaction.execute(
        r#"
        INSERT INTO memory(
            id, scope_kind, kind,
            companion_agent_profile_id,
            relationship_agent_low_id, relationship_agent_high_id,
            relationship_direction, directed_actor_agent_profile_id,
            lifecycle_status, current_revision_id, review_after,
            version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            'active', ?9, ?10, 1, ?11, ?11
        )
        "#,
        params![
            memory_id,
            candidate.scope.kind.as_str(),
            candidate.kind.as_str(),
            candidate.scope.companion_agent_profile_id,
            candidate.scope.relationship_agent_low_id,
            candidate.scope.relationship_agent_high_id,
            candidate
                .scope
                .relationship_direction
                .map(RelationshipDirection::as_str),
            candidate.scope.directed_actor_agent_profile_id,
            revision_id,
            candidate.review_after,
            now,
        ],
    )?;
    Ok((memory_id, revision_id))
}

struct NewRevision<'a> {
    id: &'a str,
    memory_id: &'a str,
    body: &'a str,
    body_bytes: i64,
    proposal_id: Option<&'a str>,
    authority: MemoryRevisionAuthority,
    confirmed_from_revision_id: Option<&'a str>,
    created_at: &'a str,
}

fn insert_revision(transaction: &Transaction<'_>, revision: NewRevision<'_>) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO memory_revision(
            id, memory_id, body, body_utf8_bytes, body_digest,
            created_from_proposal_id, authority_status,
            confirmed_from_revision_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            revision.id,
            revision.memory_id,
            revision.body,
            revision.body_bytes,
            sha256(revision.body.as_bytes()),
            revision.proposal_id,
            revision.authority.as_str(),
            revision.confirmed_from_revision_id,
            revision.created_at,
        ],
    )?;
    Ok(())
}

fn load_memory_record(connection: &Connection, memory_id: &str) -> Result<Option<MemoryRecord>> {
    connection
        .query_row(
            r#"
            SELECT memory.id, memory.scope_kind, memory.kind,
                   memory.companion_agent_profile_id,
                   memory.relationship_agent_low_id,
                   memory.relationship_agent_high_id,
                   memory.relationship_direction,
                   memory.directed_actor_agent_profile_id,
                   memory.lifecycle_status, memory.current_revision_id,
                   revision.authority_status,
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
            let kind = MemoryScopeKind::parse(value)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
            let direction = row
                .get::<_, Option<String>>(6)?
                .as_deref()
                .map(RelationshipDirection::parse)
                .transpose()
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
            Ok::<_, rusqlite::Error>(MemoryScope {
                kind,
                companion_agent_profile_id: row.get(3)?,
                relationship_agent_low_id: row.get(4)?,
                relationship_agent_high_id: row.get(5)?,
                relationship_direction: direction,
                directed_actor_agent_profile_id: row.get(7)?,
            })
        })
        .transpose()?;
    let kind = row
        .get::<_, Option<String>>(2)?
        .as_deref()
        .map(MemoryKind::parse)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
    let current_authority = row
        .get::<_, Option<String>>(10)?
        .as_deref()
        .map(MemoryRevisionAuthority::parse)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
    Ok(MemoryRecord {
        id: row.get(0)?,
        scope,
        kind,
        lifecycle: row.get(8)?,
        current_revision_id: row.get(9)?,
        current_authority,
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

fn active_exact_memory_exists(
    transaction: &Transaction<'_>,
    candidate: &Candidate,
) -> Result<bool> {
    let mut statement = transaction.prepare(
        r#"
        SELECT memory.id, memory.scope_kind, memory.kind,
               memory.companion_agent_profile_id,
               memory.relationship_agent_low_id,
               memory.relationship_agent_high_id,
               memory.relationship_direction,
               memory.directed_actor_agent_profile_id,
               memory.lifecycle_status, memory.current_revision_id,
               revision.authority_status,
               revision.body, revision.body_utf8_bytes,
               memory.review_after, memory.version,
               memory.created_at, memory.updated_at,
               memory.retired_at, memory.forgotten_at
        FROM memory
        JOIN memory_revision AS revision ON revision.id = memory.current_revision_id
        WHERE memory.lifecycle_status = 'active'
          AND memory.kind = ?1 AND revision.body = ?2
        "#,
    )?;
    let records = statement
        .query_map(
            params![candidate.kind.as_str(), candidate.body],
            memory_record_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(records.into_iter().any(|record| {
        record
            .scope
            .as_ref()
            .is_some_and(|scope| scope.same_identity(&candidate.scope))
    }))
}

fn ensure_capacity(
    transaction: &Transaction<'_>,
    scope: &MemoryScope,
    exclude_memory_id: Option<&str>,
    proposed_body_bytes: i64,
    proposed_count: i64,
) -> Result<()> {
    let (max_count, max_bytes) = scope_limits(scope.kind);
    let (active_count, active_bytes) = active_scope_usage(transaction, scope, exclude_memory_id)?;
    let count = active_count + proposed_count;
    let bytes = active_bytes + proposed_body_bytes;
    if count > max_count || bytes > max_bytes {
        anyhow::bail!(
            "memory.capacity_exceeded: active Scope would contain {count}/{max_count} entries and {bytes}/{max_bytes} bytes"
        );
    }
    Ok(())
}

fn capacity_available(
    transaction: &Transaction<'_>,
    scope: &MemoryScope,
    exclude_memory_id: Option<&str>,
    proposed_body_bytes: i64,
    proposed_count: i64,
) -> Result<bool> {
    let (max_count, max_bytes) = scope_limits(scope.kind);
    let (active_count, active_bytes) = active_scope_usage(transaction, scope, exclude_memory_id)?;
    Ok(active_count + proposed_count <= max_count
        && active_bytes + proposed_body_bytes <= max_bytes)
}

fn active_scope_usage(
    transaction: &Transaction<'_>,
    scope: &MemoryScope,
    exclude_memory_id: Option<&str>,
) -> Result<(i64, i64)> {
    let mut statement = transaction.prepare(
        r#"
        SELECT memory.id, memory.scope_kind,
               memory.companion_agent_profile_id,
               memory.relationship_agent_low_id,
               memory.relationship_agent_high_id,
               memory.relationship_direction,
               memory.directed_actor_agent_profile_id,
               revision.body_utf8_bytes
        FROM memory
        JOIN memory_revision AS revision ON revision.id = memory.current_revision_id
        WHERE memory.lifecycle_status = 'active'
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            let direction = row
                .get::<_, Option<String>>(5)?
                .as_deref()
                .map(RelationshipDirection::parse)
                .transpose()
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
            Ok((
                row.get::<_, String>(0)?,
                MemoryScope {
                    kind: MemoryScopeKind::parse(&row.get::<_, String>(1)?)
                        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?,
                    companion_agent_profile_id: row.get(2)?,
                    relationship_agent_low_id: row.get(3)?,
                    relationship_agent_high_id: row.get(4)?,
                    relationship_direction: direction,
                    directed_actor_agent_profile_id: row.get(6)?,
                },
                row.get::<_, i64>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut count = 0;
    let mut bytes = 0;
    for (memory_id, candidate_scope, body_bytes) in rows {
        if exclude_memory_id == Some(memory_id.as_str()) {
            continue;
        }
        let same_bucket = match scope.kind {
            MemoryScopeKind::Hearth => candidate_scope.kind == MemoryScopeKind::Hearth,
            MemoryScopeKind::Companion => {
                candidate_scope.kind == MemoryScopeKind::Companion
                    && candidate_scope.companion_agent_profile_id
                        == scope.companion_agent_profile_id
            }
            MemoryScopeKind::Relationship => {
                candidate_scope.kind == MemoryScopeKind::Relationship
                    && candidate_scope.relationship_agent_low_id == scope.relationship_agent_low_id
                    && candidate_scope.relationship_agent_high_id
                        == scope.relationship_agent_high_id
            }
        };
        if same_bucket {
            count += 1;
            bytes += body_bytes;
        }
    }
    Ok((count, bytes))
}

fn scope_limits(kind: MemoryScopeKind) -> (i64, i64) {
    match kind {
        MemoryScopeKind::Hearth => (HEARTH_MAX_COUNT, HEARTH_MAX_BYTES),
        MemoryScopeKind::Companion => (COMPANION_MAX_COUNT, COMPANION_MAX_BYTES),
        MemoryScopeKind::Relationship => (RELATIONSHIP_MAX_COUNT, RELATIONSHIP_MAX_BYTES),
    }
}

fn active_provisional_companion_count(
    connection: &Connection,
    companion_agent_profile_id: &str,
    exclude_memory_id: Option<&str>,
) -> Result<i64> {
    connection
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM memory
            JOIN memory_revision AS revision
              ON revision.id = memory.current_revision_id
            WHERE memory.lifecycle_status = 'active'
              AND memory.scope_kind = 'companion'
              AND memory.companion_agent_profile_id = ?1
              AND revision.authority_status = 'provisional'
              AND (?2 IS NULL OR memory.id <> ?2)
            "#,
            params![companion_agent_profile_id, exclude_memory_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn ensure_provisional_companion_capacity(
    transaction: &Transaction<'_>,
    companion_agent_profile_id: &str,
    exclude_memory_id: Option<&str>,
) -> Result<()> {
    let active_count = active_provisional_companion_count(
        transaction,
        companion_agent_profile_id,
        exclude_memory_id,
    )?;
    if active_count >= COMPANION_PROVISIONAL_MAX_COUNT {
        anyhow::bail!(
            "memory.provisional_capacity_exceeded: Companion already has {active_count}/{COMPANION_PROVISIONAL_MAX_COUNT} active provisional Memories"
        );
    }
    Ok(())
}

fn provisional_count_views(database: &Database) -> Result<Vec<MemoryProvisionalCountView>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT agent_profile.id,
               COUNT(memory.id)
        FROM agent_profile
        LEFT JOIN memory
          ON memory.companion_agent_profile_id = agent_profile.id
         AND memory.lifecycle_status = 'active'
         AND memory.scope_kind = 'companion'
         AND EXISTS (
             SELECT 1
             FROM memory_revision
             WHERE memory_revision.id = memory.current_revision_id
               AND memory_revision.authority_status = 'provisional'
         )
        GROUP BY agent_profile.id
        ORDER BY agent_profile.member_order, agent_profile.id
        "#,
    )?;
    statement
        .query_map([], |row| {
            Ok(MemoryProvisionalCountView {
                companion_agent_profile_id: row.get(0)?,
                active_count: row.get(1)?,
                max_count: COMPANION_PROVISIONAL_MAX_COUNT,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn capacity_views(database: &Database) -> Result<Vec<MemoryCapacityView>> {
    let mut scopes = BTreeMap::<String, MemoryScope>::new();
    scopes.insert("hearth".to_string(), MemoryScope::hearth());
    let mut statement = database.connection().prepare(
        r#"
        SELECT DISTINCT scope_kind, companion_agent_profile_id,
               relationship_agent_low_id, relationship_agent_high_id
        FROM memory
        WHERE lifecycle_status <> 'forgotten'
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (kind, companion, low, high) in rows {
        match kind.as_str() {
            "companion" => {
                if let Some(agent) = companion {
                    scopes.insert(format!("companion:{agent}"), MemoryScope::companion(agent));
                }
            }
            "relationship" => {
                if let (Some(low), Some(high)) = (low, high) {
                    scopes.insert(
                        format!("relationship:{low}:{high}"),
                        MemoryScope::relationship(low, high, RelationshipDirection::Mutual, None)?,
                    );
                }
            }
            _ => {}
        }
    }
    scopes
        .into_iter()
        .map(|(scope_key, scope)| {
            let transaction = database.connection().unchecked_transaction()?;
            let (active_count, active_body_bytes) = active_scope_usage(&transaction, &scope, None)?;
            transaction.commit()?;
            let (max_count, max_body_bytes) = scope_limits(scope.kind);
            Ok(MemoryCapacityView {
                scope: scope.kind,
                scope_key,
                active_count,
                max_count,
                active_body_bytes,
                max_body_bytes,
            })
        })
        .collect()
}

fn validate_proposal_run(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    agent_profile_id: &str,
    camp_id: &str,
    execution_epoch: i64,
) -> Result<bool> {
    let row: Option<(String, String, i64, String)> = transaction
        .query_row(
            r#"
            SELECT camp_turn.camp_id, conversation.agent_profile_id,
                   agent_run.execution_epoch, agent_run.effective_config_json
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
              AND agent_run.status IN ('running', 'waiting')
            "#,
            [agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((run_camp, run_agent, run_epoch, effective_config)) = row else {
        return Ok(false);
    };
    if run_camp != camp_id || run_agent != agent_profile_id || run_epoch != execution_epoch {
        return Ok(false);
    }
    let config: Value =
        serde_json::from_str(&effective_config).context("AgentRun effective config is invalid")?;
    Ok(config["capabilities"]
        .as_array()
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|value| value.as_str() == Some(MEMORY_PROPOSE_CHANGE_CAPABILITY))
        }))
}

fn proposal_add_scope(
    transaction: &Transaction<'_>,
    input: &SaveMemoryProposalCommand,
    agent_profile_id: &str,
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
            Ok(MemoryScope::companion(agent_profile_id.to_string()))
        }
        MemoryScopeKind::Relationship => {
            let counterparty = input
                .counterparty_agent_id
                .clone()
                .context("Relationship add requires counterpartyAgentId")?;
            if counterparty == agent_profile_id
                || !is_current_camp_member(transaction, camp_id, &counterparty)?
            {
                anyhow::bail!(
                    "memory.direction_forbidden: counterparty must be another current Camp member"
                );
            }
            let direction = input
                .direction
                .context("Relationship add requires direction")?;
            MemoryScope::relationship(
                agent_profile_id.to_string(),
                counterparty,
                direction,
                (direction == RelationshipDirection::Directed)
                    .then(|| agent_profile_id.to_string()),
            )
        }
    }
}

fn memory_applicable_to_agent(
    transaction: &Transaction<'_>,
    record: &MemoryRecord,
    agent_profile_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let Some(scope) = &record.scope else {
        return Ok(false);
    };
    match scope.kind {
        MemoryScopeKind::Hearth => Ok(true),
        MemoryScopeKind::Companion => {
            Ok(scope.companion_agent_profile_id.as_deref() == Some(agent_profile_id))
        }
        MemoryScopeKind::Relationship => {
            if !scope.contains_agent(agent_profile_id) {
                return Ok(false);
            }
            let counterparty = scope
                .counterparty(agent_profile_id)
                .context("Relationship Memory pair is invalid")?;
            if !is_current_camp_member(transaction, camp_id, counterparty)? {
                return Ok(false);
            }
            Ok(
                scope.relationship_direction == Some(RelationshipDirection::Mutual)
                    || (scope.relationship_direction == Some(RelationshipDirection::Directed)
                        && scope.directed_actor_agent_profile_id.as_deref()
                            == Some(agent_profile_id)),
            )
        }
    }
}

fn is_current_camp_member(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_profile_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM camp_member
        JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
        WHERE camp_member.camp_id = ?1
          AND camp_member.agent_profile_id = ?2
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'active'
        "#,
        params![camp_id, agent_profile_id],
        |row| row.get(0),
    )?;
    Ok(count == 1)
}

fn proposal_add_key(candidate: &Candidate) -> Result<String> {
    canonical_json_digest(&json!({
        "action": "add",
        "scope": candidate.scope.identity_json(),
        "kind": candidate.kind,
        "body": candidate.body,
    }))
}

fn proposal_revise_key(memory_id: &str, base_revision_id: &str, body: &str) -> Result<String> {
    canonical_json_digest(&json!({
        "action": "revise",
        "memoryId": memory_id,
        "baseRevisionId": base_revision_id,
        "body": body,
    }))
}

fn load_proposal_record(
    connection: &Connection,
    proposal_id: &str,
) -> Result<Option<ProposalRecord>> {
    connection
        .query_row(
            r#"
            SELECT id, action, status,
                   candidate_scope_kind, candidate_kind,
                   candidate_companion_agent_profile_id,
                   candidate_relationship_agent_low_id,
                   candidate_relationship_agent_high_id,
                   candidate_relationship_direction,
                   candidate_directed_actor_agent_profile_id,
                   candidate_body, target_memory_id, base_revision_id,
                   proposed_by_agent_profile_id, source_camp_id,
                   source_agent_run_id, source_execution_epoch,
                   accepted_memory_id, accepted_revision_id,
                   resolution_mode, resolution_policy_version,
                   version, proposed_at, resolved_at
            FROM memory_proposal WHERE id = ?1
            "#,
            [proposal_id],
            |row| {
                let scope = row
                    .get::<_, Option<String>>(3)?
                    .as_deref()
                    .map(|scope| {
                        Ok::<_, rusqlite::Error>(MemoryScope {
                            kind: MemoryScopeKind::parse(scope).map_err(|error| {
                                rusqlite::Error::ToSqlConversionFailure(error.into())
                            })?,
                            companion_agent_profile_id: row.get(5)?,
                            relationship_agent_low_id: row.get(6)?,
                            relationship_agent_high_id: row.get(7)?,
                            relationship_direction: row
                                .get::<_, Option<String>>(8)?
                                .as_deref()
                                .map(RelationshipDirection::parse)
                                .transpose()
                                .map_err(|error| {
                                    rusqlite::Error::ToSqlConversionFailure(error.into())
                                })?,
                            directed_actor_agent_profile_id: row.get(9)?,
                        })
                    })
                    .transpose()?;
                let kind = row
                    .get::<_, Option<String>>(4)?
                    .as_deref()
                    .map(MemoryKind::parse)
                    .transpose()
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
                Ok(ProposalRecord {
                    id: row.get(0)?,
                    action: row.get(1)?,
                    status: row.get(2)?,
                    scope,
                    kind,
                    body: row.get(10)?,
                    target_memory_id: row.get(11)?,
                    base_revision_id: row.get(12)?,
                    proposed_by_agent_profile_id: row.get(13)?,
                    source_camp_id: row.get(14)?,
                    source_agent_run_id: row.get(15)?,
                    source_execution_epoch: row.get(16)?,
                    accepted_memory_id: row.get(17)?,
                    accepted_revision_id: row.get(18)?,
                    resolution_mode: row
                        .get::<_, Option<String>>(19)?
                        .as_deref()
                        .map(MemoryProposalResolutionMode::parse)
                        .transpose()
                        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?,
                    resolution_policy_version: row.get(20)?,
                    version: row.get(21)?,
                    proposed_at: row.get(22)?,
                    resolved_at: row.get(23)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn load_memory_auto_policy(connection: &Connection) -> Result<MemoryAutoPolicyView> {
    connection
        .query_row(
            r#"
            SELECT companion_lesson_auto_apply_enabled,
                   acknowledged_at, version, updated_at
            FROM memory_auto_policy
            WHERE singleton = 1
            "#,
            [],
            |row| {
                Ok(MemoryAutoPolicyView {
                    companion_lesson_auto_apply_enabled: row.get(0)?,
                    acknowledged_at: row.get(1)?,
                    version: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .context("memory auto policy singleton is missing")
}

fn clear_memory_contents(transaction: &Transaction<'_>, memory_id: &str, now: &str) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE memory_revision
        SET body = NULL, body_utf8_bytes = NULL, body_digest = NULL,
            cleared_at = ?2
        WHERE memory_id = ?1 AND body IS NOT NULL
        "#,
        params![memory_id, now],
    )?;
    transaction.execute(
        r#"
        UPDATE memory_proposal
        SET status = CASE WHEN status = 'pending' THEN 'rejected' ELSE status END,
            resolution_mode = CASE
                WHEN status = 'pending' THEN 'user' ELSE resolution_mode END,
            candidate_scope_kind = NULL, candidate_kind = NULL,
            candidate_companion_agent_profile_id = NULL,
            candidate_relationship_agent_low_id = NULL,
            candidate_relationship_agent_high_id = NULL,
            candidate_relationship_direction = NULL,
            candidate_directed_actor_agent_profile_id = NULL,
            candidate_body = NULL, candidate_body_utf8_bytes = NULL,
            target_memory_id = NULL, base_revision_id = NULL,
            pending_key_digest = NULL,
            version = CASE WHEN status = 'pending' THEN version + 1 ELSE version END,
            resolved_at = CASE
                WHEN status = 'pending' THEN ?2 ELSE resolved_at END,
            candidate_cleared_at = COALESCE(candidate_cleared_at, ?2)
        WHERE target_memory_id = ?1 OR accepted_memory_id = ?1
        "#,
        params![memory_id, now],
    )?;
    transaction.execute(
        r#"
        UPDATE memory
        SET scope_kind = NULL, kind = NULL,
            companion_agent_profile_id = NULL,
            relationship_agent_low_id = NULL,
            relationship_agent_high_id = NULL,
            relationship_direction = NULL,
            directed_actor_agent_profile_id = NULL,
            lifecycle_status = 'forgotten',
            current_revision_id = NULL, review_after = NULL,
            retired_at = NULL, forgotten_at = ?2,
            version = version + 1, updated_at = ?2
        WHERE id = ?1
        "#,
        params![memory_id, now],
    )?;
    Ok(())
}

fn proposal_rejection_conflict(
    transaction: &Transaction<'_>,
    proposal_id: &str,
    expected_version: i64,
) -> Result<Option<CommandHandlerResult>> {
    let Some(proposal) = load_proposal_record(transaction, proposal_id)? else {
        return Ok(Some(rejected(
            "memory.not_found",
            "Memory Proposal does not exist",
        )));
    };
    if proposal.version != expected_version {
        return Ok(Some(rejected(
            "memory.version_conflict",
            "Memory Proposal version no longer matches",
        )));
    }
    if proposal.status != "pending" {
        return Ok(Some(rejected(
            "memory.lifecycle_conflict",
            "Only pending Proposal can be rejected",
        )));
    }
    Ok(None)
}

fn clear_rejected_proposal(transaction: &Transaction<'_>, proposal_id: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE memory_proposal
        SET status = 'rejected',
            resolution_mode = 'user', resolution_policy_version = NULL,
            candidate_scope_kind = NULL, candidate_kind = NULL,
            candidate_companion_agent_profile_id = NULL,
            candidate_relationship_agent_low_id = NULL,
            candidate_relationship_agent_high_id = NULL,
            candidate_relationship_direction = NULL,
            candidate_directed_actor_agent_profile_id = NULL,
            candidate_body = NULL, candidate_body_utf8_bytes = NULL,
            target_memory_id = NULL, base_revision_id = NULL,
            pending_key_digest = NULL, version = version + 1,
            resolved_at = ?2, candidate_cleared_at = ?2
        WHERE id = ?1
        "#,
        params![proposal_id, now],
    )?;
    Ok(())
}

fn proposal_view(database: &Database, proposal: ProposalRecord) -> Result<MemoryProposalView> {
    let source_exists: i64 = database.connection().query_row(
        r#"
        SELECT COUNT(*)
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        WHERE agent_run.id = ?1
          AND camp_turn.camp_id = ?2
          AND agent_run.execution_epoch >= ?3
        "#,
        params![
            proposal.source_agent_run_id,
            proposal.source_camp_id,
            proposal.source_execution_epoch,
        ],
        |row| row.get(0),
    )?;
    let stale = if proposal.status == "pending" && proposal.action == "revise" {
        if let (Some(memory_id), Some(base_revision_id)) = (
            proposal.target_memory_id.as_deref(),
            proposal.base_revision_id.as_deref(),
        ) {
            load_memory_record(database.connection(), memory_id)?.is_none_or(|record| {
                record.lifecycle != "active"
                    || record.current_revision_id.as_deref() != Some(base_revision_id)
            })
        } else {
            true
        }
    } else {
        false
    };
    let scope = proposal.scope.as_ref();
    Ok(MemoryProposalView {
        id: proposal.id,
        action: proposal.action,
        status: proposal.status,
        scope: scope.map(|scope| scope.kind),
        kind: proposal.kind,
        companion_agent_profile_id: scope
            .and_then(|scope| scope.companion_agent_profile_id.clone()),
        relationship_agent_profile_ids: scope
            .and_then(|scope| {
                Some(vec![
                    scope.relationship_agent_low_id.clone()?,
                    scope.relationship_agent_high_id.clone()?,
                ])
            })
            .unwrap_or_default(),
        direction: scope.and_then(|scope| scope.relationship_direction),
        directed_actor_agent_profile_id: scope
            .and_then(|scope| scope.directed_actor_agent_profile_id.clone()),
        body: proposal.body,
        target_memory_id: proposal.target_memory_id,
        base_revision_id: proposal.base_revision_id,
        proposed_by_agent_profile_id: proposal.proposed_by_agent_profile_id,
        source_camp_id: proposal.source_camp_id,
        source_agent_run_id: proposal.source_agent_run_id,
        source_execution_epoch: proposal.source_execution_epoch,
        source_unavailable: source_exists == 0,
        stale,
        accepted_memory_id: proposal.accepted_memory_id,
        accepted_revision_id: proposal.accepted_revision_id,
        resolution_mode: proposal.resolution_mode,
        resolution_policy_version: proposal.resolution_policy_version,
        version: proposal.version,
        proposed_at: proposal.proposed_at,
        resolved_at: proposal.resolved_at,
    })
}

fn memory_view_from_record(
    record: MemoryRecord,
    revisions: Vec<MemoryRevisionView>,
    outgoing_successor_ids: Vec<String>,
    incoming_predecessor_ids: Vec<String>,
) -> MemoryView {
    let review_due = record
        .review_after
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|value| value <= Utc::now());
    let scope = record.scope.as_ref();
    MemoryView {
        id: record.id,
        scope: scope.map(|scope| scope.kind),
        kind: record.kind,
        companion_agent_profile_id: scope
            .and_then(|scope| scope.companion_agent_profile_id.clone()),
        relationship_agent_profile_ids: scope
            .and_then(|scope| {
                Some(vec![
                    scope.relationship_agent_low_id.clone()?,
                    scope.relationship_agent_high_id.clone()?,
                ])
            })
            .unwrap_or_default(),
        direction: scope.and_then(|scope| scope.relationship_direction),
        directed_actor_agent_profile_id: scope
            .and_then(|scope| scope.directed_actor_agent_profile_id.clone()),
        lifecycle: record.lifecycle,
        current_revision_id: record.current_revision_id,
        current_authority: record.current_authority,
        current_body: record.current_body,
        current_body_utf8_bytes: record.current_body_utf8_bytes,
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
    }
}

fn load_edge_ids(
    connection: &rusqlite::Connection,
    memory_id: &str,
    outgoing: bool,
) -> Result<Vec<String>> {
    let sql = if outgoing {
        r#"
        SELECT successor_memory_id
        FROM memory_supersession
        WHERE predecessor_memory_id = ?1
        ORDER BY successor_memory_id
        "#
    } else {
        r#"
        SELECT predecessor_memory_id
        FROM memory_supersession
        WHERE successor_memory_id = ?1
        ORDER BY predecessor_memory_id
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

fn require_user_lifecycle(actor: &ActorRef) -> Result<()> {
    if !matches!(actor, ActorRef::User { .. }) {
        anyhow::bail!("memory.capability_denied: only the user can govern formal Memory");
    }
    Ok(())
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
            if event_type.contains("proposal") {
                "memory_proposal"
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

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_envelope<P: Clone + Serialize>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn test_database() -> (Database, std::path::PathBuf) {
        let directory = std::env::temp_dir().join(format!("rovai-memory-test-{}", Uuid::new_v4()));
        (Database::open(&directory).unwrap(), directory)
    }

    fn hearth(body: &str, kind: MemoryKind) -> CreateMemoryCommand {
        CreateMemoryCommand {
            scope: MemoryScopeKind::Hearth,
            kind,
            body: body.to_string(),
            companion_agent_profile_id: None,
            relationship_agent_profile_ids: Vec::new(),
            direction: None,
            directed_actor_agent_profile_id: None,
            review_after: None,
        }
    }

    #[test]
    fn canonical_body_is_bounded_and_preserves_internal_unicode() {
        assert_eq!(
            canonicalize_memory_body(" \r\n 你好\t世界 \r ").unwrap(),
            "你好\t世界"
        );
        assert!(canonicalize_memory_body("\u{0001}").is_err());
        assert!(canonicalize_memory_body(&"界".repeat(683)).is_err());
    }

    #[test]
    fn direct_create_revise_retire_reactivate_and_forget_are_versioned() {
        let (mut database, directory) = test_database();
        let service = MemoryService::default();
        let created = service
            .create(
                &mut database,
                &user_envelope(
                    "create-memory",
                    hearth("Prefer concise explanations.", MemoryKind::Preference),
                ),
            )
            .unwrap();
        let memory_id = created.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let revision_id = created.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let revised = service
            .revise(
                &mut database,
                &user_envelope(
                    "revise-memory",
                    ReviseMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 1,
                        base_revision_id: revision_id,
                        body: "Prefer concise explanations with examples.".to_string(),
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(revised.result.code, "memory_revised");
        let revised_memory = service.get(&database, &memory_id).unwrap().unwrap();
        assert_eq!(
            revised_memory.current_authority,
            Some(MemoryRevisionAuthority::UserConfirmed)
        );
        assert!(
            revised_memory
                .revisions
                .iter()
                .all(
                    |revision| revision.authority == MemoryRevisionAuthority::UserConfirmed
                        && revision.confirmed_from_revision_id.is_none()
                )
        );
        service
            .retire(
                &mut database,
                &user_envelope(
                    "retire-memory",
                    RetireMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 2,
                    },
                ),
            )
            .unwrap();
        service
            .reactivate(
                &mut database,
                &user_envelope(
                    "reactivate-memory",
                    ReactivateMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 3,
                    },
                ),
            )
            .unwrap();
        service
            .forget(
                &mut database,
                &user_envelope(
                    "forget-memory",
                    ForgetMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 4,
                    },
                ),
            )
            .unwrap();
        let memory = service.get(&database, &memory_id).unwrap().unwrap();
        assert_eq!(memory.lifecycle, "forgotten");
        assert!(memory.current_body.is_none());
        assert!(memory.scope.is_none());
        assert!(
            memory
                .revisions
                .iter()
                .all(|revision| revision.body.is_none())
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn secret_and_exact_duplicate_are_rejected_without_new_memory() {
        let (mut database, directory) = test_database();
        let service = MemoryService::default();
        let secret = service
            .create(
                &mut database,
                &user_envelope(
                    "secret-memory",
                    hearth("api_key = abcdefghijklmnopqrstuvwxyz", MemoryKind::Lesson),
                ),
            )
            .unwrap();
        assert_eq!(secret.result.code, "memory.secret_rejected");
        service
            .create(
                &mut database,
                &user_envelope(
                    "first-memory",
                    hearth("Use cargo fmt before commit.", MemoryKind::Agreement),
                ),
            )
            .unwrap();
        let duplicate = service
            .create(
                &mut database,
                &user_envelope(
                    "duplicate-memory",
                    hearth("Use cargo fmt before commit.", MemoryKind::Agreement),
                ),
            )
            .unwrap();
        assert_eq!(duplicate.result.code, "memory.already_exists");
        let count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM memory", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn hearth_capacity_never_auto_evicts_and_retire_explicitly_frees_a_slot() {
        let (mut database, directory) = test_database();
        let service = MemoryService::default();
        let mut first_memory_id = String::new();
        for index in 0..HEARTH_MAX_COUNT {
            let execution = service
                .create(
                    &mut database,
                    &user_envelope(
                        &format!("capacity-memory-{index}"),
                        hearth(
                            &format!("Stable preference number {index}."),
                            MemoryKind::Preference,
                        ),
                    ),
                )
                .unwrap();
            assert_eq!(
                execution.result.status,
                crate::command::CommandResultStatus::Applied
            );
            if index == 0 {
                first_memory_id = execution.result.payload["memoryId"]
                    .as_str()
                    .unwrap()
                    .to_string();
            }
        }
        let overflow = service
            .create(
                &mut database,
                &user_envelope(
                    "capacity-overflow",
                    hearth("One preference too many.", MemoryKind::Preference),
                ),
            )
            .unwrap_err();
        assert!(overflow.to_string().contains("memory.capacity_exceeded"));
        assert_eq!(
            service
                .list(&database)
                .unwrap()
                .memories
                .into_iter()
                .filter(|memory| memory.lifecycle == "active")
                .count(),
            HEARTH_MAX_COUNT as usize
        );

        service
            .retire(
                &mut database,
                &user_envelope(
                    "capacity-retire",
                    RetireMemoryCommand {
                        memory_id: first_memory_id,
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();
        let replacement = service
            .create(
                &mut database,
                &user_envelope(
                    "capacity-replacement",
                    hearth(
                        "A replacement added only after explicit retirement.",
                        MemoryKind::Preference,
                    ),
                ),
            )
            .unwrap();
        assert_eq!(
            replacement.result.status,
            crate::command::CommandResultStatus::Applied
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn provisional_companion_capacity_is_eight_and_retire_releases_it() {
        let (mut database, directory) = test_database();
        let service = MemoryService::default();
        let mut created_ids = Vec::new();
        for index in 0..COMPANION_PROVISIONAL_MAX_COUNT {
            let created = service
                .create(
                    &mut database,
                    &user_envelope(
                        &format!("create-provisional-capacity-{index}"),
                        CreateMemoryCommand {
                            scope: MemoryScopeKind::Companion,
                            kind: MemoryKind::Lesson,
                            body: format!("Reusable provisional capacity lesson {index}."),
                            companion_agent_profile_id: Some("agent-luoke".to_string()),
                            relationship_agent_profile_ids: Vec::new(),
                            direction: None,
                            directed_actor_agent_profile_id: None,
                            review_after: None,
                        },
                    ),
                )
                .unwrap();
            created_ids.push(
                created.result.payload["memoryId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        database
            .connection()
            .execute(
                r#"
                UPDATE memory_revision
                SET authority_status = 'provisional'
                WHERE memory_id IN (
                    SELECT id FROM memory
                    WHERE companion_agent_profile_id = 'agent-luoke'
                )
                "#,
                [],
            )
            .unwrap();
        let transaction = database.connection().unchecked_transaction().unwrap();
        assert!(ensure_provisional_companion_capacity(&transaction, "agent-luoke", None).is_err());
        transaction.commit().unwrap();

        service
            .retire(
                &mut database,
                &user_envelope(
                    "retire-provisional-capacity",
                    RetireMemoryCommand {
                        memory_id: created_ids[0].clone(),
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();
        let transaction = database.connection().unchecked_transaction().unwrap();
        assert_eq!(
            active_provisional_companion_count(&transaction, "agent-luoke", None).unwrap(),
            COMPANION_PROVISIONAL_MAX_COUNT - 1
        );
        assert!(ensure_provisional_companion_capacity(&transaction, "agent-luoke", None).is_ok());
        transaction.commit().unwrap();
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn editing_provisional_memory_creates_confirmed_revision_and_resets_lesson_review() {
        let (mut database, directory) = test_database();
        let service = MemoryService::default();
        let created = service
            .create(
                &mut database,
                &user_envelope(
                    "create-editable-provisional",
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Companion,
                        kind: MemoryKind::Lesson,
                        body: "Use the first implementation as a provisional hypothesis."
                            .to_string(),
                        companion_agent_profile_id: Some("agent-luoke".to_string()),
                        relationship_agent_profile_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_profile_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let memory_id = created.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let revision_id = created.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let provisional_review = (Utc::now() + Duration::days(30)).to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE memory_revision
                SET authority_status = 'provisional'
                WHERE id = ?1;
                "#,
                [&revision_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE memory SET review_after = ?2 WHERE id = ?1",
                params![memory_id, provisional_review],
            )
            .unwrap();
        service
            .revise(
                &mut database,
                &user_envelope(
                    "edit-and-confirm-provisional",
                    ReviseMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 1,
                        base_revision_id: revision_id,
                        body: "Use the verified implementation as the durable approach."
                            .to_string(),
                        review_after: Some(provisional_review),
                    },
                ),
            )
            .unwrap();
        let edited = service.get(&database, &memory_id).unwrap().unwrap();
        assert_eq!(
            edited.current_authority,
            Some(MemoryRevisionAuthority::UserConfirmed)
        );
        let review_after =
            chrono::DateTime::parse_from_rfc3339(edited.review_after.as_deref().unwrap())
                .unwrap()
                .to_utc();
        assert!(review_after > Utc::now() + Duration::days(89));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
