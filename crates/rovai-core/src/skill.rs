use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    time::Duration,
};

#[cfg(any(unix, windows))]
use std::{
    fs::File,
    io::{Read, Write},
};

#[cfg(unix)]
use std::{
    fs::OpenOptions,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::brand::preferred_or_existing_legacy_paths;

use crate::{
    agent_profile::{AdapterKind, AgentProfileService},
    agent_runtime_adapter::{
        AgentRuntimeAdapterRegistry, SkillDeliveryGroupKey, SkillDiscoveryVerification,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    platform::private_storage::{atomic_write_private_json, prepare_private_directory},
};

#[cfg(windows)]
use crate::platform::private_storage::{
    admit_private_directory, create_private_directory, create_private_new_file,
};

pub const MAX_SKILL_FILES: usize = 1_000;
pub const MAX_SKILL_DEPTH: usize = 32;
pub const MAX_SKILL_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_SKILL_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
#[cfg(windows)]
const WINDOWS_SKILL_LOGICAL_FILE_MODE: u32 = 0o644;
const MAX_SKILL_DISCOVERY_DEPTH: usize = 8;
const STAGING_TTL: Duration = Duration::from_secs(30 * 60);

const SKILL_DISCOVERY_IGNORED_DIRECTORIES: &[&str] = &[
    ".cache",
    ".git",
    ".gradle",
    ".hg",
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".output",
    ".parcel-cache",
    ".pytest_cache",
    ".ruff_cache",
    ".svn",
    ".tox",
    ".turbo",
    ".venv",
    "__pycache__",
    "__tests__",
    "asset",
    "assets",
    "build",
    "coverage",
    "dist",
    "doc",
    "docs",
    "documentation",
    "example",
    "examples",
    "fixture",
    "fixtures",
    "node_modules",
    "out",
    "reference",
    "references",
    "resource",
    "resources",
    "sample",
    "samples",
    "target",
    "temp",
    "test",
    "testdata",
    "testing",
    "tests",
    "tmp",
    "vendor",
    "venv",
];

const ANALYZE_AGENT_CODEBASE_RULES: &str =
    include_str!("../../../skills/analyze-agent-codebase/SKILL.md");
const ANALYZE_AGENT_CODEBASE_NOTICE: &str =
    include_str!("../../../skills/analyze-agent-codebase/NOTICE");
const ANALYZE_AGENT_CODEBASE_OPENAI: &str =
    include_str!("../../../skills/analyze-agent-codebase/agents/openai.yaml");
const ANALYZE_AGENT_CODEBASE_DOSSIER_REFERENCE: &str =
    include_str!("../../../skills/analyze-agent-codebase/references/dossier-structure.md");
const CAMPFIRE_RULES: &str = include_str!("../../../skills/campfire/SKILL.md");
const CAMPFIRE_NOTICE: &str = include_str!("../../../skills/campfire/NOTICE");
const CAMPFIRE_OPENAI: &str = include_str!("../../../skills/campfire/agents/openai.yaml");
const CAMPFIRE_LEAD_REFERENCE: &str = include_str!("../../../skills/campfire/references/lead.md");
const CAMPFIRE_MEMBER_REFERENCE: &str =
    include_str!("../../../skills/campfire/references/member.md");
const CAMPFIRE_NOTES_REFERENCE: &str = include_str!("../../../skills/campfire/references/notes.md");
const CLI_OPERATIONS_RULES: &str = include_str!("../../../skills/cli-operations/SKILL.md");
const CLI_OPERATIONS_NOTICE: &str = include_str!("../../../skills/cli-operations/NOTICE");
const CLI_OPERATIONS_OPENAI: &str =
    include_str!("../../../skills/cli-operations/agents/openai.yaml");
const CLI_OPERATIONS_SEND_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/send.md");
const CLI_OPERATIONS_GATHER_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/gather.md");
const CLI_OPERATIONS_TASK_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/task.md");
const CLI_OPERATIONS_CAMP_HISTORY_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/camp-history.md");
const CLI_OPERATIONS_MEMORY_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/memory.md");
const CLI_OPERATIONS_RECOVERY_REFERENCE: &str =
    include_str!("../../../skills/cli-operations/references/recovery.md");
const MEMORY_STEWARDSHIP_RULES: &str = include_str!("../../../skills/memory-stewardship/SKILL.md");
const MEMORY_STEWARDSHIP_NOTICE: &str = include_str!("../../../skills/memory-stewardship/NOTICE");
const MEMORY_STEWARDSHIP_OPENAI: &str =
    include_str!("../../../skills/memory-stewardship/agents/openai.yaml");
const MEMORY_STEWARDSHIP_AUTHORITY_REFERENCE: &str =
    include_str!("../../../skills/memory-stewardship/references/authority-and-safety.md");
const MEMORY_STEWARDSHIP_SCOPES_REFERENCE: &str =
    include_str!("../../../skills/memory-stewardship/references/scopes.md");
const MEMORY_STEWARDSHIP_WORKFLOW_REFERENCE: &str =
    include_str!("../../../skills/memory-stewardship/references/read-write-workflow.md");
const MEMORY_STEWARDSHIP_CONTENT_REFERENCE: &str =
    include_str!("../../../skills/memory-stewardship/references/content-and-keys.md");
const MEMBER_STUDIO_RULES: &str = include_str!("../../../skills/member-studio/SKILL.md");
const MEMBER_STUDIO_NOTICE: &str = include_str!("../../../skills/member-studio/NOTICE");
const MEMBER_STUDIO_OPENAI: &str = include_str!("../../../skills/member-studio/agents/openai.yaml");
const MEMBER_STUDIO_IDENTITY_REFERENCE: &str =
    include_str!("../../../skills/member-studio/references/identity-generation.md");
const MEMBER_STUDIO_AVATAR_REFERENCE: &str =
    include_str!("../../../skills/member-studio/references/avatar-sourcing.md");
const WORKTREE_RULES: &str = include_str!("../../../skills/worktree/SKILL.md");
const WORKTREE_NOTICE: &str = include_str!("../../../skills/worktree/NOTICE");
const WORKTREE_OPENAI: &str = include_str!("../../../skills/worktree/agents/openai.yaml");
const GRILL_DUO_RULES: &str = include_str!("../../../skills/grill-duo/SKILL.md");
const GRILL_DUO_NOTICE: &str = include_str!("../../../skills/grill-duo/NOTICE");
const GRILL_DUO_LICENSE: &str = include_str!("../../../skills/grill-duo/LICENSE");
const GRILL_DUO_OPENAI: &str = include_str!("../../../skills/grill-duo/agents/openai.yaml");
const GRILL_DUO_WITH_DOCS_RULES: &str =
    include_str!("../../../skills/grill-duo-with-docs/SKILL.md");
const GRILL_DUO_WITH_DOCS_NOTICE: &str = include_str!("../../../skills/grill-duo-with-docs/NOTICE");
const GRILL_DUO_WITH_DOCS_LICENSE: &str =
    include_str!("../../../skills/grill-duo-with-docs/LICENSE");
const GRILL_DUO_WITH_DOCS_OPENAI: &str =
    include_str!("../../../skills/grill-duo-with-docs/agents/openai.yaml");
const DOMAIN_MODELING_REFERENCE: &str =
    include_str!("../../../skills/grill-duo-with-docs/references/domain-modeling.md");
const CONTEXT_FORMAT_REFERENCE: &str =
    include_str!("../../../skills/grill-duo-with-docs/references/context-format.md");
const DECISION_ROUTING_REFERENCE: &str =
    include_str!("../../../skills/grill-duo-with-docs/references/decision-routing.md");
const REVIEW_DUO_RULES: &str = include_str!("../../../skills/review-duo/SKILL.md");
const REVIEW_DUO_NOTICE: &str = include_str!("../../../skills/review-duo/NOTICE");
const REVIEW_DUO_OPENAI: &str = include_str!("../../../skills/review-duo/agents/openai.yaml");
const REVIEW_DUO_FINDINGS_REFERENCE: &str =
    include_str!("../../../skills/review-duo/references/findings.md");
const REVIEW_DUO_SNAPSHOT_REFERENCE: &str =
    include_str!("../../../skills/review-duo/references/snapshot.md");
include!(concat!(env!("OUT_DIR"), "/third_party_bundled_files.rs"));

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillOrigin {
    Official,
    Imported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillManagementPolicy {
    UserManaged,
    SystemRequired,
}

impl SkillOrigin {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "official" => Ok(Self::Official),
            "imported" => Ok(Self::Imported),
            _ => anyhow::bail!("unknown Skill origin: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillRevisionSourceType {
    Bundled,
    LocalFolder,
    Github,
}

impl SkillRevisionSourceType {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "bundled" => Ok(Self::Bundled),
            "local_folder" => Ok(Self::LocalFolder),
            "github" => Ok(Self::Github),
            _ => anyhow::bail!("unknown Skill Revision source type: {value}"),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::LocalFolder => "local_folder",
            Self::Github => "github",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRiskSummary {
    pub executable_file_count: usize,
    pub script_file_count: usize,
    pub binary_candidate_count: usize,
    pub declared_tools: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRevisionView {
    pub id: String,
    pub skill_id: String,
    pub revision: i64,
    pub name: String,
    pub description: String,
    pub source_type: SkillRevisionSourceType,
    pub content_digest: String,
    pub source_metadata: Value,
    pub risk_summary: SkillRiskSummary,
    pub file_count: i64,
    pub total_bytes: i64,
    pub installed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroupAssignmentView {
    pub group_key: SkillDeliveryGroupKey,
    pub revision_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDeliveryGroupMemberView {
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub accent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDeliveryGroupView {
    pub key: SkillDeliveryGroupKey,
    pub label: String,
    pub relative_path: String,
    pub adapter_kinds: Vec<AdapterKind>,
    pub verification: SkillDiscoveryVerification,
    pub members: Vec<SkillDeliveryGroupMemberView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub origin: SkillOrigin,
    pub management_policy: SkillManagementPolicy,
    pub enabled: bool,
    pub lifecycle_status: String,
    pub current_revision: SkillRevisionView,
    pub group_assignments: Vec<SkillGroupAssignmentView>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deletion_requested_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportCandidate {
    pub name: String,
    pub description: String,
    pub content_digest: String,
    pub risk_summary: SkillRiskSummary,
    pub file_count: usize,
    pub total_bytes: u64,
    pub source_path: String,
    pub existing_skill_id: Option<String>,
    pub existing_skill_version: Option<i64>,
    pub existing_origin: Option<SkillOrigin>,
    pub import_action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSkillImportCandidate {
    pub source_path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportInspection {
    pub staging_token: String,
    pub source_path: String,
    pub candidates: Vec<SkillImportCandidate>,
    pub rejected_candidates: Vec<RejectedSkillImportCandidate>,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSkillImportCommand {
    pub staging_token: String,
    pub candidate_name: String,
    pub expected_digest: String,
    pub expected_skill_version: Option<i64>,
    #[serde(default)]
    pub confirm_update: bool,
}

impl sealed::Sealed for CommitSkillImportCommand {}
impl DomainCommand for CommitSkillImportCommand {
    const TYPE: &'static str = "skill.import.commit";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSkillEnabledCommand {
    pub skill_id: String,
    pub expected_version: i64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSkillGroupAssignmentsCommand {
    pub skill_id: String,
    pub expected_version: i64,
    pub group_keys: Vec<SkillDeliveryGroupKey>,
}

impl sealed::Sealed for SetSkillGroupAssignmentsCommand {}
impl DomainCommand for SetSkillGroupAssignmentsCommand {
    const TYPE: &'static str = "skill.group_assignments.set";
}

impl sealed::Sealed for SetSkillEnabledCommand {}
impl DomainCommand for SetSkillEnabledCommand {
    const TYPE: &'static str = "skill.enabled.set";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSkillCommand {
    pub skill_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for DeleteSkillCommand {}
impl DomainCommand for DeleteSkillCommand {
    const TYPE: &'static str = "skill.delete.request";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishBundledSkillCommand {
    name: String,
    content_digest: String,
}

impl sealed::Sealed for PublishBundledSkillCommand {}
impl DomainCommand for PublishBundledSkillCommand {
    const TYPE: &'static str = "skill.bundled.publish";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagingManifest {
    token: String,
    source_path: String,
    created_at: String,
    expires_at: String,
    source_type: SkillRevisionSourceType,
    source_metadata: Value,
    candidates: Vec<StagedCandidate>,
    rejected_candidates: Vec<RejectedSkillImportCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedCandidate {
    name: String,
    description: String,
    content_digest: String,
    risk_summary: SkillRiskSummary,
    file_count: usize,
    total_bytes: u64,
    source_path: String,
    relative_content_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CandidateSnapshot {
    name: String,
    description: String,
    content_digest: String,
    risk_summary: SkillRiskSummary,
    file_count: usize,
    total_bytes: u64,
}

#[derive(Debug, Clone)]
struct ExistingSkill {
    id: String,
    origin: SkillOrigin,
    enabled: bool,
    lifecycle_status: String,
    current_revision_id: String,
    current_digest: String,
    current_source_type: SkillRevisionSourceType,
    version: i64,
}

#[derive(Debug, Clone)]
struct BundledDefinition {
    name: &'static str,
    files: &'static [(&'static str, &'static str, u32)],
    upstream_repository: Option<&'static str>,
    upstream_revision: Option<&'static str>,
    management_policy: SkillManagementPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BundledSkillBootstrapReport {
    pub changed: bool,
    pub fast_path_count: usize,
    pub materialized_count: usize,
    pub repaired_count: usize,
}

const MATTPOCOCK_SKILLS_REPOSITORY: &str = "https://github.com/mattpocock/skills";
const MATTPOCOCK_SKILLS_REVISION: &str = "84fdeffd12f2ee307994d1eb6feb48173b6e0502";

const ANALYZE_AGENT_CODEBASE_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", ANALYZE_AGENT_CODEBASE_RULES, 0o644),
    ("NOTICE", ANALYZE_AGENT_CODEBASE_NOTICE, 0o644),
    ("agents/openai.yaml", ANALYZE_AGENT_CODEBASE_OPENAI, 0o644),
    (
        "references/dossier-structure.md",
        ANALYZE_AGENT_CODEBASE_DOSSIER_REFERENCE,
        0o644,
    ),
];

const CAMPFIRE_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", CAMPFIRE_RULES, 0o644),
    ("NOTICE", CAMPFIRE_NOTICE, 0o644),
    ("agents/openai.yaml", CAMPFIRE_OPENAI, 0o644),
    ("references/lead.md", CAMPFIRE_LEAD_REFERENCE, 0o644),
    ("references/member.md", CAMPFIRE_MEMBER_REFERENCE, 0o644),
    ("references/notes.md", CAMPFIRE_NOTES_REFERENCE, 0o644),
];

const CLI_OPERATIONS_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", CLI_OPERATIONS_RULES, 0o644),
    ("NOTICE", CLI_OPERATIONS_NOTICE, 0o644),
    ("agents/openai.yaml", CLI_OPERATIONS_OPENAI, 0o644),
    ("references/send.md", CLI_OPERATIONS_SEND_REFERENCE, 0o644),
    (
        "references/gather.md",
        CLI_OPERATIONS_GATHER_REFERENCE,
        0o644,
    ),
    ("references/task.md", CLI_OPERATIONS_TASK_REFERENCE, 0o644),
    (
        "references/camp-history.md",
        CLI_OPERATIONS_CAMP_HISTORY_REFERENCE,
        0o644,
    ),
    (
        "references/memory.md",
        CLI_OPERATIONS_MEMORY_REFERENCE,
        0o644,
    ),
    (
        "references/recovery.md",
        CLI_OPERATIONS_RECOVERY_REFERENCE,
        0o644,
    ),
];

const MEMORY_STEWARDSHIP_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", MEMORY_STEWARDSHIP_RULES, 0o644),
    ("NOTICE", MEMORY_STEWARDSHIP_NOTICE, 0o644),
    ("agents/openai.yaml", MEMORY_STEWARDSHIP_OPENAI, 0o644),
    (
        "references/authority-and-safety.md",
        MEMORY_STEWARDSHIP_AUTHORITY_REFERENCE,
        0o644,
    ),
    (
        "references/scopes.md",
        MEMORY_STEWARDSHIP_SCOPES_REFERENCE,
        0o644,
    ),
    (
        "references/read-write-workflow.md",
        MEMORY_STEWARDSHIP_WORKFLOW_REFERENCE,
        0o644,
    ),
    (
        "references/content-and-keys.md",
        MEMORY_STEWARDSHIP_CONTENT_REFERENCE,
        0o644,
    ),
];

const MEMBER_STUDIO_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", MEMBER_STUDIO_RULES, 0o644),
    ("NOTICE", MEMBER_STUDIO_NOTICE, 0o644),
    ("agents/openai.yaml", MEMBER_STUDIO_OPENAI, 0o644),
    (
        "references/identity-generation.md",
        MEMBER_STUDIO_IDENTITY_REFERENCE,
        0o644,
    ),
    (
        "references/avatar-sourcing.md",
        MEMBER_STUDIO_AVATAR_REFERENCE,
        0o644,
    ),
];

const WORKTREE_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", WORKTREE_RULES, 0o644),
    ("NOTICE", WORKTREE_NOTICE, 0o644),
    ("agents/openai.yaml", WORKTREE_OPENAI, 0o644),
];

const GRILL_DUO_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", GRILL_DUO_RULES, 0o644),
    ("NOTICE", GRILL_DUO_NOTICE, 0o644),
    ("LICENSE", GRILL_DUO_LICENSE, 0o644),
    ("agents/openai.yaml", GRILL_DUO_OPENAI, 0o644),
];

const GRILL_DUO_WITH_DOCS_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", GRILL_DUO_WITH_DOCS_RULES, 0o644),
    ("NOTICE", GRILL_DUO_WITH_DOCS_NOTICE, 0o644),
    ("LICENSE", GRILL_DUO_WITH_DOCS_LICENSE, 0o644),
    ("agents/openai.yaml", GRILL_DUO_WITH_DOCS_OPENAI, 0o644),
    (
        "references/domain-modeling.md",
        DOMAIN_MODELING_REFERENCE,
        0o644,
    ),
    (
        "references/context-format.md",
        CONTEXT_FORMAT_REFERENCE,
        0o644,
    ),
    (
        "references/decision-routing.md",
        DECISION_ROUTING_REFERENCE,
        0o644,
    ),
];

const REVIEW_DUO_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", REVIEW_DUO_RULES, 0o644),
    ("NOTICE", REVIEW_DUO_NOTICE, 0o644),
    ("agents/openai.yaml", REVIEW_DUO_OPENAI, 0o644),
    (
        "references/findings.md",
        REVIEW_DUO_FINDINGS_REFERENCE,
        0o644,
    ),
    (
        "references/snapshot.md",
        REVIEW_DUO_SNAPSHOT_REFERENCE,
        0o644,
    ),
];

const BUNDLED_SKILLS: &[BundledDefinition] = &[
    BundledDefinition {
        name: "analyze-agent-codebase",
        files: ANALYZE_AGENT_CODEBASE_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "campfire",
        files: CAMPFIRE_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "cli-operations",
        files: CLI_OPERATIONS_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::SystemRequired,
    },
    BundledDefinition {
        name: "diagnosing-bugs",
        files: DIAGNOSING_BUGS_FILES,
        upstream_repository: Some(MATTPOCOCK_SKILLS_REPOSITORY),
        upstream_revision: Some(MATTPOCOCK_SKILLS_REVISION),
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "memory-stewardship",
        files: MEMORY_STEWARDSHIP_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::SystemRequired,
    },
    BundledDefinition {
        name: "member-studio",
        files: MEMBER_STUDIO_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "worktree",
        files: WORKTREE_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "grill-duo",
        files: GRILL_DUO_FILES,
        upstream_repository: Some(MATTPOCOCK_SKILLS_REPOSITORY),
        upstream_revision: Some(MATTPOCOCK_SKILLS_REVISION),
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "grill-duo-with-docs",
        files: GRILL_DUO_WITH_DOCS_FILES,
        upstream_repository: Some(MATTPOCOCK_SKILLS_REPOSITORY),
        upstream_revision: Some(MATTPOCOCK_SKILLS_REVISION),
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "review-duo",
        files: REVIEW_DUO_FILES,
        upstream_repository: None,
        upstream_revision: None,
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "tasteful-ui",
        files: TASTEFUL_UI_FILES,
        upstream_repository: Some("https://github.com/DonkeyKing01/tasteful-ui-skill"),
        upstream_revision: Some("159ccd47a320f3a7bd0289d07366d422211895a1"),
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "tdd",
        files: TDD_FILES,
        upstream_repository: Some(MATTPOCOCK_SKILLS_REPOSITORY),
        upstream_revision: Some(MATTPOCOCK_SKILLS_REVISION),
        management_policy: SkillManagementPolicy::UserManaged,
    },
    BundledDefinition {
        name: "writing-for-agents",
        files: WRITING_FOR_AGENTS_FILES,
        upstream_repository: Some(MATTPOCOCK_SKILLS_REPOSITORY),
        upstream_revision: Some(MATTPOCOCK_SKILLS_REVISION),
        management_policy: SkillManagementPolicy::UserManaged,
    },
];

fn bundled_definition(name: &str) -> Option<&'static BundledDefinition> {
    BUNDLED_SKILLS
        .iter()
        .find(|definition| definition.name == name)
}

fn skill_management_policy(origin: &SkillOrigin, name: &str) -> SkillManagementPolicy {
    if *origin != SkillOrigin::Official {
        return SkillManagementPolicy::UserManaged;
    }
    bundled_definition(name)
        .map(|definition| definition.management_policy)
        .unwrap_or(SkillManagementPolicy::UserManaged)
}

fn is_system_required_official_skill(origin: &str, name: &str) -> bool {
    origin == "official"
        && bundled_definition(name).is_some_and(|definition| {
            definition.management_policy == SkillManagementPolicy::SystemRequired
        })
}

pub struct SkillLibraryService {
    root: PathBuf,
    gateway: DomainCommandGateway,
}

impl SkillLibraryService {
    pub fn default_root() -> Result<PathBuf> {
        #[cfg(debug_assertions)]
        if let Some(root) = std::env::var_os("ROVAI_SKILL_LIBRARY_ROOT")
            .or_else(|| std::env::var_os("HORIZONWARD_SKILL_LIBRARY_ROOT"))
            .or_else(|| std::env::var_os("LUMEN_SKILL_LIBRARY_ROOT"))
        {
            return Ok(PathBuf::from(root));
        }
        let home = dirs::home_dir()
            .context("could not determine the home directory for ~/.rovai/skills")?;
        Ok(preferred_or_existing_legacy_paths(
            home.join(".rovai").join("skills"),
            [
                home.join(".horizonward").join("skills"),
                home.join(".lumen").join("skills"),
            ],
        ))
    }

    pub fn new(root: PathBuf) -> Result<Self> {
        prepare_private_directory(&root)
            .with_context(|| format!("failed to create Skill Library at {}", root.display()))?;
        prepare_private_directory(&root.join(".staging"))?;
        prepare_private_directory(&root.join("revisions"))?;
        Ok(Self {
            root,
            gateway: DomainCommandGateway,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list_delivery_groups(&self, database: &Database) -> Result<Vec<SkillDeliveryGroupView>> {
        let registry = AgentRuntimeAdapterRegistry::default();
        let profiles = AgentProfileService::default().list_profiles(database)?;
        let adapter_kinds = AdapterKind::ALL;
        Ok(SkillDeliveryGroupKey::ALL
            .into_iter()
            .map(|key| {
                let matching_adapters = adapter_kinds
                    .into_iter()
                    .filter(|adapter_kind| {
                        registry
                            .skill_discovery(*adapter_kind)
                            .delivery_groups
                            .contains(&key)
                    })
                    .collect::<Vec<_>>();
                let verification = if matching_adapters.iter().any(|adapter_kind| {
                    registry.skill_discovery(*adapter_kind).verification
                        == SkillDiscoveryVerification::Verified
                }) {
                    SkillDiscoveryVerification::Verified
                } else {
                    SkillDiscoveryVerification::DocumentationOnly
                };
                let members = profiles
                    .iter()
                    .filter(|profile| profile.presence != "removed")
                    .filter(|profile| {
                        profile
                            .runtime_configuration
                            .as_ref()
                            .is_some_and(|configuration| {
                                matching_adapters.contains(&configuration.adapter_kind)
                            })
                    })
                    .map(|profile| SkillDeliveryGroupMemberView {
                        agent_id: profile.agent_id.clone(),
                        display_name: profile.display_name.clone(),
                        avatar_ref: profile.avatar_ref.clone(),
                        accent: profile.accent.clone(),
                    })
                    .collect();
                SkillDeliveryGroupView {
                    key,
                    label: delivery_group_label(key).to_string(),
                    relative_path: key.relative_path().to_string_lossy().to_string(),
                    adapter_kinds: matching_adapters,
                    verification,
                    members,
                }
            })
            .collect())
    }

    pub fn list(&self, database: &Database) -> Result<Vec<SkillView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT skill.id, skill.name, skill.origin, skill.enabled,
                   skill.lifecycle_status, skill.version, skill.created_at,
                   skill.updated_at, skill.deletion_requested_at,
                   revision.id, revision.revision, revision.name,
                   revision.description, revision.source_type,
                   revision.content_digest, revision.source_metadata_json,
                   revision.risk_summary_json, revision.file_count,
                   revision.total_bytes, revision.installed_at
            FROM skill
            JOIN skill_revision AS revision
              ON revision.id = skill.current_revision_id
            ORDER BY CASE skill.origin WHEN 'official' THEN 0 ELSE 1 END,
                     skill.name
            "#,
        )?;
        let mut skills = statement
            .query_map([], skill_view_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(anyhow::Error::from)?;
        for skill in &mut skills {
            skill.group_assignments = load_group_assignments(database, &skill.id)?;
        }
        Ok(skills)
    }

    pub fn get(&self, database: &Database, skill_id: &str) -> Result<Option<SkillView>> {
        let mut skill = database
            .connection()
            .query_row(
                r#"
                SELECT skill.id, skill.name, skill.origin, skill.enabled,
                       skill.lifecycle_status, skill.version, skill.created_at,
                       skill.updated_at, skill.deletion_requested_at,
                       revision.id, revision.revision, revision.name,
                       revision.description, revision.source_type,
                       revision.content_digest, revision.source_metadata_json,
                       revision.risk_summary_json, revision.file_count,
                       revision.total_bytes, revision.installed_at
                FROM skill
                JOIN skill_revision AS revision
                  ON revision.id = skill.current_revision_id
                WHERE skill.id = ?1
                "#,
                [skill_id],
                skill_view_from_row,
            )
            .optional()
            .map_err(anyhow::Error::from)?;
        if let Some(skill) = &mut skill {
            skill.group_assignments = load_group_assignments(database, &skill.id)?;
        }
        Ok(skill)
    }

    pub fn reveal_location(&self, database: &Database, skill_id: &str) -> Result<PathBuf> {
        let skill = self
            .get(database, skill_id)?
            .context("Skill does not exist")?;
        self.verify_revision_content(&skill.current_revision)?;
        let root = self
            .root
            .canonicalize()
            .context("Skill Library root is unavailable")?;
        let content = self
            .revision_content_path(&skill.id, &skill.current_revision.id)
            .canonicalize()
            .context("Skill revision content is unavailable")?;
        if !content.starts_with(&root) {
            anyhow::bail!("Skill revision is outside the managed Skill Library");
        }
        Ok(content)
    }

    pub fn inspect_import(
        &self,
        database: &Database,
        selected_path: &Path,
    ) -> Result<SkillImportInspection> {
        self.cleanup_expired_staging()?;
        let selected_path = selected_path.canonicalize().with_context(|| {
            format!(
                "Skill import path does not exist: {}",
                selected_path.display()
            )
        })?;
        if !selected_path.is_dir() {
            anyhow::bail!("Skill import path must be a directory");
        }
        let token = Uuid::new_v4().to_string();
        let staging_root = self.root.join(".staging").join(&token);
        prepare_private_directory(&staging_root)?;
        prepare_private_directory(&staging_root.join("candidates"))?;
        let created_at = Utc::now();
        let expires_at = created_at
            + chrono::Duration::from_std(STAGING_TTL).context("invalid Skill staging duration")?;
        let source_candidates = discover_source_candidates(&selected_path)?;
        let mut candidates = Vec::new();
        let mut rejected_candidates = Vec::new();
        for source in source_candidates {
            let source_string = source.to_string_lossy().to_string();
            let expected_name = source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            let destination = staging_root.join("candidates").join(&expected_name);
            match stage_candidate(&source, &expected_name, &destination) {
                Ok(snapshot) => {
                    candidates.push(StagedCandidate {
                        name: snapshot.name,
                        description: snapshot.description,
                        content_digest: snapshot.content_digest,
                        risk_summary: snapshot.risk_summary,
                        file_count: snapshot.file_count,
                        total_bytes: snapshot.total_bytes,
                        source_path: source_string,
                        relative_content_path: format!("candidates/{expected_name}"),
                    });
                }
                Err(error) => {
                    let _ = remove_directory_if_present(&destination);
                    rejected_candidates.push(RejectedSkillImportCandidate {
                        source_path: source_string,
                        code: import_error_code(&error).to_string(),
                        message: format!("{error:#}"),
                    });
                }
            }
        }
        let manifest = StagingManifest {
            token: token.clone(),
            source_path: selected_path.to_string_lossy().to_string(),
            created_at: created_at.to_rfc3339(),
            expires_at: expires_at.to_rfc3339(),
            source_type: SkillRevisionSourceType::LocalFolder,
            source_metadata: json!({
                "sourcePath": selected_path.to_string_lossy(),
            }),
            candidates,
            rejected_candidates,
        };
        atomic_write_private_json(&staging_root.join("inspection.json"), &manifest)?;
        self.inspection_view(database, manifest)
    }

    pub fn inspect_github_import(
        &self,
        database: &Database,
        repository_url: &str,
        subdirectory: Option<&str>,
        git_ref: Option<&str>,
    ) -> Result<SkillImportInspection> {
        validate_github_repository_url(repository_url)?;
        if let Some(git_ref) = git_ref {
            validate_git_ref(git_ref)?;
        }
        let checkout_root = self
            .root
            .join(".staging")
            .join(format!("github-checkout-{}", Uuid::new_v4()));
        prepare_private_directory(&checkout_root)?;
        let clone_result = (|| -> Result<(SkillImportInspection, String)> {
            run_git_import(repository_url, git_ref, &checkout_root)?;
            let resolved_commit = git_import_output(&checkout_root, &["rev-parse", "HEAD"])?;
            let selected = match subdirectory.filter(|value| !value.trim().is_empty()) {
                Some(value) => {
                    let relative = Path::new(value);
                    ensure_relative_path(relative)?;
                    checkout_root.join(relative)
                }
                None => checkout_root.clone(),
            };
            let canonical_checkout = checkout_root.canonicalize()?;
            let canonical_selected = selected
                .canonicalize()
                .with_context(|| format!("GitHub Skill 子目录不存在：{}", selected.display()))?;
            if !canonical_selected.starts_with(&canonical_checkout) {
                anyhow::bail!("GitHub Skill 子目录超出仓库范围");
            }
            let inspection = self.inspect_import(database, &canonical_selected)?;
            Ok((inspection, resolved_commit))
        })();
        let result = match clone_result {
            Ok((inspection, resolved_commit)) => {
                let manifest_path = self
                    .root
                    .join(".staging")
                    .join(&inspection.staging_token)
                    .join("inspection.json");
                let mut manifest: StagingManifest =
                    serde_json::from_slice(&fs::read(&manifest_path)?)?;
                manifest.source_path = repository_url.to_string();
                manifest.source_type = SkillRevisionSourceType::Github;
                manifest.source_metadata = json!({
                    "repositoryUrl": repository_url,
                    "subdirectory": subdirectory,
                    "gitRef": git_ref,
                    "resolvedCommit": resolved_commit,
                });
                for candidate in &mut manifest.candidates {
                    candidate.source_path = format!(
                        "{}{}",
                        repository_url,
                        subdirectory
                            .filter(|value| !value.trim().is_empty())
                            .map(|value| format!("#{}", value.trim_matches('/')))
                            .unwrap_or_default()
                    );
                }
                atomic_write_private_json(&manifest_path, &manifest)?;
                self.inspection_view(database, manifest)
            }
            Err(error) => Err(error),
        };
        let _ = remove_directory_if_present(&checkout_root);
        result
    }

    pub fn commit_import(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CommitSkillImportCommand>,
    ) -> Result<CommandExecution> {
        if let Some(replay) = self.gateway.replay_if_recorded(database, envelope)? {
            return Ok(replay);
        }
        let manifest = self.load_staging_manifest(&envelope.payload.staging_token)?;
        let staged = manifest
            .candidates
            .iter()
            .find(|candidate| candidate.name == envelope.payload.candidate_name)
            .cloned()
            .context("Skill import candidate does not exist in this inspection")?;
        if staged.content_digest != envelope.payload.expected_digest {
            anyhow::bail!("Skill import candidate digest does not match the inspected digest");
        }
        let staged_path = self
            .root
            .join(".staging")
            .join(&manifest.token)
            .join(&staged.relative_content_path);
        let verification_path = self
            .root
            .join(".staging")
            .join(&manifest.token)
            .join(format!(".verify-{}", Uuid::new_v4()));
        let verified = stage_candidate(&staged_path, &staged.name, &verification_path)?;
        if verified.content_digest != staged.content_digest {
            let _ = remove_directory_if_present(&verification_path);
            anyhow::bail!("Skill import candidate changed after inspection");
        }

        let existing = load_existing_skill_by_name(database, &staged.name)?;
        if let Some(existing) = &existing {
            if existing.origin == SkillOrigin::Official {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::rejected(
                        "official_skill_name_conflict",
                        json!({
                            "message": "用户导入不能覆盖 Rovai 内置 Skill。",
                            "skillId": existing.id,
                        }),
                    ))
                });
                let _ = remove_directory_if_present(&verification_path);
                return result;
            }
            if existing.current_digest == staged.content_digest {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::applied(
                        "skill_import_unchanged",
                        json!({
                            "skillId": existing.id,
                            "revisionId": existing.current_revision_id,
                            "unchanged": true,
                        }),
                        Some(EntityReference {
                            entity_type: "skill".to_string(),
                            entity_id: existing.id.clone(),
                        }),
                    ))
                });
                let _ = remove_directory_if_present(&verification_path);
                return result;
            }
            if existing.lifecycle_status != "active" {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::rejected(
                        "skill_deleting",
                        json!({"message": "正在删除的 Skill 不能更新。"}),
                    ))
                });
                let _ = remove_directory_if_present(&verification_path);
                return result;
            }
            if envelope.payload.expected_skill_version != Some(existing.version) {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::rejected(
                        "version_conflict",
                        json!({
                            "message": "Skill 已发生变化，请重新检查后再更新。",
                            "currentVersion": existing.version,
                        }),
                    ))
                });
                let _ = remove_directory_if_present(&verification_path);
                return result;
            }
            if !envelope.payload.confirm_update {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::rejected(
                        "skill_update_confirmation_required",
                        json!({
                            "message": "同名 Skill 内容不同，需要明确确认更新。",
                            "skillId": existing.id,
                            "currentVersion": existing.version,
                        }),
                    ))
                });
                let _ = remove_directory_if_present(&verification_path);
                return result;
            }
        } else if envelope.payload.expected_skill_version.is_some() {
            let result = self.gateway.execute(database, envelope, |_| {
                Ok(CommandHandlerResult::rejected(
                    "skill_missing",
                    json!({"message": "待更新的 Skill 已不存在。"}),
                ))
            });
            let _ = remove_directory_if_present(&verification_path);
            return result;
        }

        let skill_id = existing
            .as_ref()
            .map(|value| value.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let revision_id = Uuid::new_v4().to_string();
        let final_content = self.revision_content_path(&skill_id, &revision_id);
        publish_directory(&verification_path, &final_content)?;
        let source_metadata = json!({
            "source": manifest.source_metadata,
            "candidateSourcePath": staged.source_path,
            "importedAt": Utc::now().to_rfc3339(),
        });
        let source_type = manifest.source_type;
        let now = Utc::now().to_rfc3339();
        let existing_id = existing.as_ref().map(|value| value.id.clone());
        let existing_version = existing.as_ref().map(|value| value.version);
        let skill_id_for_handler = skill_id.clone();
        let revision_id_for_handler = revision_id.clone();
        let staged_for_handler = staged.clone();
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if let Some(existing_id) = &existing_id {
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    existing_id,
                    &staged_for_handler,
                    source_type,
                    &source_metadata,
                    &now,
                )?;
                let changed = transaction.execute(
                    r#"
                    UPDATE skill
                    SET current_revision_id = ?1, version = version + 1,
                        updated_at = ?2
                    WHERE id = ?3 AND version = ?4
                      AND origin = 'imported'
                      AND lifecycle_status = 'active'
                    "#,
                    params![revision_id_for_handler, now, existing_id, existing_version,],
                )?;
                if changed != 1 {
                    anyhow::bail!("Skill changed while publishing its Revision");
                }
                transaction.execute(
                    r#"
                    UPDATE skill_group_assignment
                    SET revision_id = ?1, updated_at = ?2
                    WHERE skill_id = ?3
                    "#,
                    params![revision_id_for_handler, now, existing_id],
                )?;
            } else {
                transaction.execute(
                    r#"
                    INSERT INTO skill(
                        id, name, origin, enabled, lifecycle_status,
                        current_revision_id, version, created_at, updated_at
                    ) VALUES (?1, ?2, 'imported', 1, 'active', NULL, 1, ?3, ?3)
                    "#,
                    params![skill_id_for_handler, staged_for_handler.name, now],
                )?;
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    &skill_id_for_handler,
                    &staged_for_handler,
                    source_type,
                    &source_metadata,
                    &now,
                )?;
                transaction.execute(
                    "UPDATE skill SET current_revision_id = ?1 WHERE id = ?2",
                    params![revision_id_for_handler, skill_id_for_handler],
                )?;
                insert_default_group_assignments(
                    transaction,
                    &skill_id_for_handler,
                    &revision_id_for_handler,
                    &now,
                )?;
            }
            append_skill_event(
                transaction,
                "skill.revision_published",
                &skill_id_for_handler,
                &envelope.actor,
                json!({
                    "skillId": skill_id_for_handler,
                    "revisionId": revision_id_for_handler,
                    "contentDigest": staged_for_handler.content_digest,
                    "origin": "imported",
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                if existing_id.is_some() {
                    "skill_updated"
                } else {
                    "skill_imported"
                },
                json!({
                    "skillId": skill_id_for_handler,
                    "revisionId": revision_id_for_handler,
                    "enabled": existing.as_ref().map(|value| value.enabled).unwrap_or(true),
                    "unchanged": false,
                }),
                Some(EntityReference {
                    entity_type: "skill".to_string(),
                    entity_id: skill_id_for_handler.clone(),
                }),
            ))
        });
        if execution.is_err() {
            let _ = remove_directory_if_present(final_content.parent().unwrap_or(&final_content));
        }
        execution
    }

    pub fn set_enabled(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetSkillEnabledCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let current = transaction
                .query_row(
                    "SELECT name, origin, enabled, lifecycle_status, version FROM skill WHERE id = ?1",
                    [&envelope.payload.skill_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, bool>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((name, origin, current_enabled, lifecycle_status, version)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "skill_missing",
                    json!({"message": "Skill 不存在。"}),
                ));
            };
            if lifecycle_status != "active" {
                return Ok(CommandHandlerResult::rejected(
                    "skill_deleting",
                    json!({"message": "正在删除的 Skill 不能改变启用状态。"}),
                ));
            }
            if is_system_required_official_skill(&origin, &name) {
                return Ok(CommandHandlerResult::rejected(
                    "skill_configuration_locked",
                    json!({
                        "message": "系统必需 Skill 始终启用，不能改变启用状态。",
                        "skillId": envelope.payload.skill_id,
                    }),
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "version_conflict",
                    json!({"message": "Skill 已发生变化。", "currentVersion": version}),
                ));
            }
            if current_enabled != envelope.payload.enabled {
                let now = Utc::now().to_rfc3339();
                transaction.execute(
                    "UPDATE skill SET enabled = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
                    params![envelope.payload.enabled, now, envelope.payload.skill_id],
                )?;
                append_skill_event(
                    transaction,
                    if envelope.payload.enabled {
                        "skill.enabled"
                    } else {
                        "skill.disabled"
                    },
                    &envelope.payload.skill_id,
                    &envelope.actor,
                    json!({
                        "skillId": envelope.payload.skill_id,
                        "enabled": envelope.payload.enabled,
                    }),
                )?;
            }
            Ok(CommandHandlerResult::applied(
                if envelope.payload.enabled {
                    "skill_enabled"
                } else {
                    "skill_disabled"
                },
                json!({
                    "skillId": envelope.payload.skill_id,
                    "enabled": envelope.payload.enabled,
                    "version": if current_enabled == envelope.payload.enabled {
                        version
                    } else {
                        version + 1
                    },
                    "unchanged": current_enabled == envelope.payload.enabled,
                }),
                Some(EntityReference {
                    entity_type: "skill".to_string(),
                    entity_id: envelope.payload.skill_id.clone(),
                }),
            ))
        })
    }

    pub fn set_group_assignments(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetSkillGroupAssignmentsCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let current = transaction
                .query_row(
                    r#"
                    SELECT name, origin, current_revision_id, lifecycle_status, version
                    FROM skill
                    WHERE id = ?1
                    "#,
                    [&envelope.payload.skill_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((name, origin, revision_id, lifecycle_status, version)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "skill_missing",
                    json!({"message": "Skill 不存在。"}),
                ));
            };
            if lifecycle_status != "active" {
                return Ok(CommandHandlerResult::rejected(
                    "skill_deleting",
                    json!({"message": "正在删除的 Skill 不能改变生效组。"}),
                ));
            }
            if is_system_required_official_skill(&origin, &name) {
                return Ok(CommandHandlerResult::rejected(
                    "skill_configuration_locked",
                    json!({
                        "message": "系统必需 Skill 始终投递至全部 Runtime Group，不能改变生效组。",
                        "skillId": envelope.payload.skill_id,
                    }),
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "version_conflict",
                    json!({"message": "Skill 已发生变化。", "currentVersion": version}),
                ));
            }

            let desired = envelope
                .payload
                .group_keys
                .iter()
                .copied()
                .collect::<BTreeSet<_>>();
            if desired.len() != envelope.payload.group_keys.len() {
                return Ok(CommandHandlerResult::rejected(
                    "duplicate_skill_group_assignment",
                    json!({"message": "同一 Skill 不能重复选择同一个生效组。"}),
                ));
            }
            let existing = {
                let mut statement = transaction
                    .prepare("SELECT group_key FROM skill_group_assignment WHERE skill_id = ?1")?;
                statement
                    .query_map([&envelope.payload.skill_id], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
                    .into_iter()
                    .map(|value| value.parse::<SkillDeliveryGroupKey>())
                    .collect::<Result<BTreeSet<_>>>()?
            };
            if existing == desired {
                return Ok(CommandHandlerResult::applied(
                    "skill_group_assignments_unchanged",
                    json!({
                        "skillId": envelope.payload.skill_id,
                        "groupKeys": desired.iter().map(|value| value.as_str()).collect::<Vec<_>>(),
                        "unchanged": true,
                    }),
                    Some(EntityReference {
                        entity_type: "skill".to_string(),
                        entity_id: envelope.payload.skill_id.clone(),
                    }),
                ));
            }

            let now = Utc::now().to_rfc3339();
            for group_key in existing.difference(&desired) {
                transaction.execute(
                    "DELETE FROM skill_group_assignment WHERE skill_id = ?1 AND group_key = ?2",
                    params![envelope.payload.skill_id, group_key.as_str()],
                )?;
            }
            for group_key in &desired {
                transaction.execute(
                    r#"
                    INSERT INTO skill_group_assignment(
                        group_key, skill_id, revision_id, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?4)
                    ON CONFLICT(group_key, skill_id) DO UPDATE SET
                        revision_id = excluded.revision_id,
                        updated_at = excluded.updated_at
                    "#,
                    params![
                        group_key.as_str(),
                        envelope.payload.skill_id,
                        revision_id,
                        now,
                    ],
                )?;
            }
            transaction.execute(
                "UPDATE skill SET version = version + 1, updated_at = ?1 WHERE id = ?2",
                params![now, envelope.payload.skill_id],
            )?;
            append_skill_event(
                transaction,
                "skill.group_assignments_changed",
                &envelope.payload.skill_id,
                &envelope.actor,
                json!({
                    "skillId": envelope.payload.skill_id,
                    "groupKeys": desired.iter().map(|value| value.as_str()).collect::<Vec<_>>(),
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "skill_group_assignments_changed",
                json!({
                    "skillId": envelope.payload.skill_id,
                    "groupKeys": desired.iter().map(|value| value.as_str()).collect::<Vec<_>>(),
                    "unchanged": false,
                }),
                Some(EntityReference {
                    entity_type: "skill".to_string(),
                    entity_id: envelope.payload.skill_id.clone(),
                }),
            ))
        })
    }

    pub fn request_delete(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteSkillCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let current = transaction
                .query_row(
                    "SELECT origin, lifecycle_status, version FROM skill WHERE id = ?1",
                    [&envelope.payload.skill_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((origin, lifecycle_status, version)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "skill_missing",
                    json!({"message": "Skill 不存在。"}),
                ));
            };
            if origin == "official" {
                return Ok(CommandHandlerResult::rejected(
                    "official_skill_delete_forbidden",
                    json!({"message": "Rovai 内置 Skill 不能删除。"}),
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "version_conflict",
                    json!({"message": "Skill 已发生变化。", "currentVersion": version}),
                ));
            }
            if lifecycle_status == "deleting" {
                return Ok(CommandHandlerResult::applied(
                    "skill_delete_already_requested",
                    json!({"skillId": envelope.payload.skill_id}),
                    Some(EntityReference {
                        entity_type: "skill".to_string(),
                        entity_id: envelope.payload.skill_id.clone(),
                    }),
                ));
            }
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE skill
                SET enabled = 0, lifecycle_status = 'deleting',
                    deletion_requested_at = ?1, version = version + 1,
                    updated_at = ?1
                WHERE id = ?2
                "#,
                params![now, envelope.payload.skill_id],
            )?;
            append_skill_event(
                transaction,
                "skill.delete_requested",
                &envelope.payload.skill_id,
                &envelope.actor,
                json!({"skillId": envelope.payload.skill_id}),
            )?;
            Ok(CommandHandlerResult::accepted(
                "skill_delete_requested",
                json!({"skillId": envelope.payload.skill_id}),
                Some(EntityReference {
                    entity_type: "skill".to_string(),
                    entity_id: envelope.payload.skill_id.clone(),
                }),
            ))
        })
    }

    pub fn install_bundled_skills(
        &self,
        database: &mut Database,
    ) -> Result<BundledSkillBootstrapReport> {
        let mut report = BundledSkillBootstrapReport {
            changed: strip_official_skill_name_prefixes(database)?,
            fast_path_count: 0,
            materialized_count: 0,
            repaired_count: 0,
        };
        for definition in BUNDLED_SKILLS {
            self.install_bundled_definition(database, definition, &mut report)?;
        }
        Ok(report)
    }

    fn install_bundled_definition(
        &self,
        database: &mut Database,
        definition: &BundledDefinition,
        report: &mut BundledSkillBootstrapReport,
    ) -> Result<()> {
        if definition.name.starts_with("rovai-") {
            anyhow::bail!("official Skill names must not use the rovai- prefix");
        }
        let expected = bundled_candidate_snapshot(definition)?;
        let promoted = promote_imported_skill_to_official(database, definition.name)?;
        if promoted {
            report.changed = true;
        }
        let existing = load_existing_skill_by_name(database, definition.name)?;
        if !promoted
            && let Some(existing) = existing.as_ref().filter(|value| {
                value.current_digest == expected.content_digest
                    && value.current_source_type == SkillRevisionSourceType::Bundled
            })
            && bundled_revision_tree_matches(
                &self.revision_content_path(&existing.id, &existing.current_revision_id),
                definition,
            )?
        {
            report.fast_path_count += 1;
            if restore_system_required_skill_configuration(database, definition.name)? {
                report.changed = true;
            }
            return Ok(());
        }

        let token = format!("bundled-{}-{}", definition.name, Uuid::new_v4());
        let staging_root = self.root.join(".staging").join(token);
        let source = staging_root.join(definition.name);
        materialize_bundled_definition(&source, definition)?;
        let verified = stage_candidate(
            &source,
            definition.name,
            &staging_root.join(format!(".verify-{}", definition.name)),
        )?;
        report.materialized_count += 1;
        if verified.content_digest != expected.content_digest
            || verified.file_count != expected.file_count
            || verified.total_bytes != expected.total_bytes
        {
            anyhow::bail!(
                "materialized bundled Skill {} does not match its embedded definition",
                definition.name
            );
        }
        if existing.as_ref().is_some_and(|value| {
            value.current_digest == verified.content_digest
                && value.current_source_type == SkillRevisionSourceType::Bundled
        }) {
            let existing = existing
                .as_ref()
                .context("Bundled Skill disappeared during verification")?;
            let current_content =
                self.revision_content_path(&existing.id, &existing.current_revision_id);
            remove_directory_if_present(&current_content)?;
            publish_directory(
                &staging_root.join(format!(".verify-{}", definition.name)),
                &current_content,
            )?;
            database.connection().execute(
                r#"
                        INSERT INTO event_log(
                            event_id, event_type, payload_json,
                            entity_type, entity_id, actor_type, actor_id, created_at
                        ) VALUES (
                            ?1, 'skill.bundled_repaired', ?2,
                            'skill', ?3, 'system', 'skill-library-bootstrap', ?4
                        )
                        "#,
                params![
                    Uuid::new_v4().to_string(),
                    serde_json::to_string(&json!({
                        "skillId": existing.id,
                        "revisionId": existing.current_revision_id,
                        "contentDigest": existing.current_digest,
                    }))?,
                    existing.id,
                    Utc::now().to_rfc3339(),
                ],
            )?;
            report.repaired_count += 1;
            report.changed = true;
            if restore_system_required_skill_configuration(database, definition.name)? {
                report.changed = true;
            }
            remove_directory_if_present(&staging_root)?;
            return Ok(());
        }
        let skill_id = existing
            .as_ref()
            .map(|value| value.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let revision_id = Uuid::new_v4().to_string();
        let final_content = self.revision_content_path(&skill_id, &revision_id);
        publish_directory(
            &staging_root.join(format!(".verify-{}", definition.name)),
            &final_content,
        )?;
        let command = PublishBundledSkillCommand {
            name: definition.name.to_string(),
            content_digest: verified.content_digest.clone(),
        };
        let envelope = CommandEnvelope {
            command_id: format!(
                "bundled-skill:{}:{}",
                definition.name, verified.content_digest
            ),
            actor: ActorRef::System {
                component_id: "skill-library-bootstrap".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: command,
        };
        let now = Utc::now().to_rfc3339();
        let mut source_metadata = json!({
            "bundled": true,
            "appVersion": env!("CARGO_PKG_VERSION"),
        });
        if let (Some(repository), Some(revision)) =
            (definition.upstream_repository, definition.upstream_revision)
        {
            source_metadata["upstream"] = json!({
                "repository": repository,
                "revision": revision,
            });
        }
        let existing_id = existing.as_ref().map(|value| value.id.clone());
        let existing_version = existing.as_ref().map(|value| value.version);
        let verified_for_handler = StagedCandidate {
            name: verified.name,
            description: verified.description,
            content_digest: verified.content_digest,
            risk_summary: verified.risk_summary,
            file_count: verified.file_count,
            total_bytes: verified.total_bytes,
            source_path: "rovai://bundled".to_string(),
            relative_content_path: String::new(),
        };
        let skill_id_for_handler = skill_id.clone();
        let revision_id_for_handler = revision_id.clone();
        let result = self.gateway.execute(database, &envelope, |transaction| {
            if let Some(existing_id) = &existing_id {
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    existing_id,
                    &verified_for_handler,
                    SkillRevisionSourceType::Bundled,
                    &source_metadata,
                    &now,
                )?;
                transaction.execute(
                    r#"
                        UPDATE skill
                        SET current_revision_id = ?1, version = version + 1,
                            updated_at = ?2
                        WHERE id = ?3 AND version = ?4 AND origin = 'official'
                        "#,
                    params![revision_id_for_handler, now, existing_id, existing_version],
                )?;
                transaction.execute(
                    r#"
                        UPDATE skill_group_assignment
                        SET revision_id = ?1, updated_at = ?2
                        WHERE skill_id = ?3
                        "#,
                    params![revision_id_for_handler, now, existing_id],
                )?;
            } else {
                transaction.execute(
                    r#"
                        INSERT INTO skill(
                            id, name, origin, enabled, lifecycle_status,
                            current_revision_id, version, created_at, updated_at
                        ) VALUES (?1, ?2, 'official', 1, 'active', NULL, 1, ?3, ?3)
                        "#,
                    params![skill_id_for_handler, verified_for_handler.name, now],
                )?;
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    &skill_id_for_handler,
                    &verified_for_handler,
                    SkillRevisionSourceType::Bundled,
                    &source_metadata,
                    &now,
                )?;
                transaction.execute(
                    "UPDATE skill SET current_revision_id = ?1 WHERE id = ?2",
                    params![revision_id_for_handler, skill_id_for_handler],
                )?;
                insert_default_group_assignments(
                    transaction,
                    &skill_id_for_handler,
                    &revision_id_for_handler,
                    &now,
                )?;
            }
            append_skill_event(
                transaction,
                "skill.revision_published",
                &skill_id_for_handler,
                &envelope.actor,
                json!({
                    "skillId": skill_id_for_handler,
                    "revisionId": revision_id_for_handler,
                    "contentDigest": verified_for_handler.content_digest,
                    "origin": "official",
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                if existing_id.is_some() {
                    "bundled_skill_updated"
                } else {
                    "bundled_skill_installed"
                },
                json!({
                    "skillId": skill_id_for_handler,
                    "revisionId": revision_id_for_handler,
                }),
                Some(EntityReference {
                    entity_type: "skill".to_string(),
                    entity_id: skill_id_for_handler.clone(),
                }),
            ))
        });
        if result.is_err() {
            let _ = remove_directory_if_present(final_content.parent().unwrap_or(&final_content));
        }
        result?;
        restore_system_required_skill_configuration(database, definition.name)?;
        report.changed = true;
        remove_directory_if_present(&staging_root)?;
        Ok(())
    }

    #[cfg(all(test, feature = "slow-tests"))]
    #[allow(dead_code)]
    pub(crate) fn install_bundled_skill_for_test(
        &self,
        database: &mut Database,
        name: &str,
    ) -> Result<SkillView> {
        let definition = BUNDLED_SKILLS
            .iter()
            .find(|definition| definition.name == name)
            .with_context(|| format!("unknown bundled Skill {name}"))?;
        let mut report = BundledSkillBootstrapReport {
            changed: strip_official_skill_name_prefixes(database)?,
            fast_path_count: 0,
            materialized_count: 0,
            repaired_count: 0,
        };
        self.install_bundled_definition(database, definition, &mut report)?;
        self.list(database)?
            .into_iter()
            .find(|skill| skill.name == name)
            .with_context(|| format!("bundled Skill {name} was not installed"))
    }

    pub fn cleanup_expired_staging(&self) -> Result<()> {
        let staging_root = self.root.join(".staging");
        if !staging_root.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(&staging_root)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if !metadata.file_type().is_dir() {
                continue;
            }
            let manifest_path = entry.path().join("inspection.json");
            let expired = if manifest_path.is_file() {
                fs::read(&manifest_path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<StagingManifest>(&bytes).ok())
                    .and_then(|manifest| {
                        DateTime::parse_from_rfc3339(&manifest.expires_at)
                            .ok()
                            .map(|value| value.with_timezone(&Utc) <= Utc::now())
                    })
                    .unwrap_or(true)
            } else {
                metadata
                    .modified()
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .is_none_or(|age| age >= STAGING_TTL)
            };
            if expired {
                remove_directory_if_present(&entry.path())?;
            }
        }
        Ok(())
    }

    pub fn cleanup_orphan_revisions(&self, database: &Database) -> Result<usize> {
        let managed_revisions = {
            let mut statement = database
                .connection()
                .prepare("SELECT skill_id, id FROM skill_revision")?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<HashSet<_>>>()?
        };
        let mut removed = 0;
        let revisions_root = self.root.join("revisions");
        for skill_entry in fs::read_dir(&revisions_root)? {
            let skill_entry = skill_entry?;
            let skill_metadata = fs::symlink_metadata(skill_entry.path())?;
            if !skill_metadata.file_type().is_dir() {
                continue;
            }
            let skill_id = skill_entry.file_name().to_string_lossy().to_string();
            if Uuid::parse_str(&skill_id).is_err() {
                continue;
            }
            for revision_entry in fs::read_dir(skill_entry.path())? {
                let revision_entry = revision_entry?;
                let revision_metadata = fs::symlink_metadata(revision_entry.path())?;
                if !revision_metadata.file_type().is_dir() {
                    continue;
                }
                let revision_id = revision_entry.file_name().to_string_lossy().to_string();
                if Uuid::parse_str(&revision_id).is_err()
                    || managed_revisions.contains(&(skill_id.clone(), revision_id))
                {
                    continue;
                }
                remove_directory_if_present(&revision_entry.path())?;
                removed += 1;
            }
            let _ = fs::remove_dir(skill_entry.path());
        }
        Ok(removed)
    }

    pub(crate) fn verify_revision_content(&self, revision: &SkillRevisionView) -> Result<()> {
        self.verify_revision_identity(
            &revision.skill_id,
            &revision.id,
            &revision.name,
            &revision.content_digest,
        )
    }

    pub(crate) fn verify_revision_identity(
        &self,
        skill_id: &str,
        revision_id: &str,
        name: &str,
        expected_digest: &str,
    ) -> Result<()> {
        validate_stable_id(skill_id, "Skill ID")?;
        validate_stable_id(revision_id, "Skill Revision ID")?;
        let content = self.revision_content_path(skill_id, revision_id);
        let snapshot = inspect_candidate_tree(&content, name)?;
        if snapshot.content_digest != expected_digest {
            anyhow::bail!(
                "Skill Revision {} content digest does not match its immutable record",
                revision_id
            );
        }
        Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn copy_revision_to_projection_staging(
        &self,
        revision: &SkillRevisionView,
        destination: &Path,
    ) -> Result<()> {
        self.verify_revision_content(revision)?;
        if destination.exists() {
            anyhow::bail!(
                "Windows Skill projection staging destination already exists: {}",
                destination.display()
            );
        }
        let source = self.revision_content_path(&revision.skill_id, &revision.id);
        create_private_directory(destination)?;
        let copied = (|| -> Result<CandidateSnapshot> {
            let mut collector = CandidateCollector::default();
            copy_candidate_tree(&source, destination, Path::new(""), 0, &mut collector)?;
            candidate_snapshot(destination, &revision.name, collector)
        })();
        let copied = match copied {
            Ok(copied) => copied,
            Err(error) => {
                let _ = remove_directory_if_present(destination);
                return Err(error);
            }
        };
        if copied.content_digest != revision.content_digest {
            let _ = remove_directory_if_present(destination);
            anyhow::bail!(
                "Windows Skill projection staging digest does not match Revision {}",
                revision.id
            );
        }
        let reopened = inspect_candidate_tree(destination, &revision.name)?;
        if reopened.content_digest != revision.content_digest || reopened != copied {
            let _ = remove_directory_if_present(destination);
            anyhow::bail!("Windows Skill projection staging changed before durable verification");
        }
        Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn verify_projected_revision(
        &self,
        path: &Path,
        name: &str,
        expected_digest: &str,
    ) -> Result<()> {
        admit_private_directory(path)
            .context("Windows Skill projection root failed private-storage admission")?;
        let snapshot = inspect_candidate_tree(path, name)?;
        if snapshot.content_digest != expected_digest {
            anyhow::bail!("Windows Skill projection content digest does not match its observation");
        }
        Ok(())
    }

    pub(crate) fn remove_skill_content(&self, skill_id: &str) -> Result<()> {
        validate_stable_id(skill_id, "Skill ID")?;
        remove_directory_if_present(&self.root.join("revisions").join(skill_id))
    }

    fn inspection_view(
        &self,
        database: &Database,
        manifest: StagingManifest,
    ) -> Result<SkillImportInspection> {
        let candidates = manifest
            .candidates
            .iter()
            .map(|candidate| {
                let existing = load_existing_skill_by_name(database, &candidate.name)?;
                let import_action = match &existing {
                    None => "create",
                    Some(value) if value.origin == SkillOrigin::Official => "official_conflict",
                    Some(value) if value.current_digest == candidate.content_digest => "unchanged",
                    Some(_) => "update",
                };
                Ok(SkillImportCandidate {
                    name: candidate.name.clone(),
                    description: candidate.description.clone(),
                    content_digest: candidate.content_digest.clone(),
                    risk_summary: candidate.risk_summary.clone(),
                    file_count: candidate.file_count,
                    total_bytes: candidate.total_bytes,
                    source_path: candidate.source_path.clone(),
                    existing_skill_id: existing.as_ref().map(|value| value.id.clone()),
                    existing_skill_version: existing.as_ref().map(|value| value.version),
                    existing_origin: existing.map(|value| value.origin),
                    import_action: import_action.to_string(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(SkillImportInspection {
            staging_token: manifest.token,
            source_path: manifest.source_path,
            candidates,
            rejected_candidates: manifest.rejected_candidates,
            expires_at: manifest.expires_at,
        })
    }

    fn load_staging_manifest(&self, token: &str) -> Result<StagingManifest> {
        validate_staging_token(token)?;
        let path = self
            .root
            .join(".staging")
            .join(token)
            .join("inspection.json");
        let manifest: StagingManifest =
            serde_json::from_slice(&fs::read(&path).with_context(|| {
                format!("Skill import inspection is unavailable: {}", path.display())
            })?)?;
        if manifest.token != token {
            anyhow::bail!("Skill import inspection token is invalid");
        }
        let expires_at = DateTime::parse_from_rfc3339(&manifest.expires_at)?.with_timezone(&Utc);
        if expires_at <= Utc::now() {
            anyhow::bail!("Skill import inspection has expired");
        }
        Ok(manifest)
    }

    pub(crate) fn revision_content_path(&self, skill_id: &str, revision_id: &str) -> PathBuf {
        self.root.join("revisions").join(skill_id).join(revision_id)
    }
}

fn skill_view_from_row(row: &Row<'_>) -> rusqlite::Result<SkillView> {
    let skill_id = row.get::<_, String>(0)?;
    let name = row.get::<_, String>(1)?;
    let origin_value = row.get::<_, String>(2)?;
    let origin = SkillOrigin::parse(&origin_value).map_err(anyhow_to_sql_error)?;
    let source_type_value = row.get::<_, String>(13)?;
    let source_metadata_json = row.get::<_, String>(15)?;
    let risk_summary_json = row.get::<_, String>(16)?;
    Ok(SkillView {
        id: skill_id.clone(),
        name: name.clone(),
        management_policy: skill_management_policy(&origin, &name),
        origin,
        enabled: row.get(3)?,
        lifecycle_status: row.get(4)?,
        version: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deletion_requested_at: row.get(8)?,
        current_revision: SkillRevisionView {
            id: row.get(9)?,
            skill_id,
            revision: row.get(10)?,
            name: row.get(11)?,
            description: row.get(12)?,
            source_type: SkillRevisionSourceType::parse(&source_type_value)
                .map_err(anyhow_to_sql_error)?,
            content_digest: row.get(14)?,
            source_metadata: serde_json::from_str(&source_metadata_json).map_err(to_sql_error)?,
            risk_summary: serde_json::from_str(&risk_summary_json).map_err(to_sql_error)?,
            file_count: row.get(17)?,
            total_bytes: row.get(18)?,
            installed_at: row.get(19)?,
        },
        group_assignments: Vec::new(),
    })
}

fn load_group_assignments(
    database: &Database,
    skill_id: &str,
) -> Result<Vec<SkillGroupAssignmentView>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT group_key, revision_id, created_at, updated_at
        FROM skill_group_assignment
        WHERE skill_id = ?1
        ORDER BY group_key
        "#,
    )?;
    Ok(statement
        .query_map([skill_id], |row| {
            let group_key = row.get::<_, String>(0)?;
            Ok(SkillGroupAssignmentView {
                group_key: group_key.parse().map_err(anyhow_to_sql_error)?,
                revision_id: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn insert_default_group_assignments(
    transaction: &Transaction<'_>,
    skill_id: &str,
    revision_id: &str,
    now: &str,
) -> Result<()> {
    for group_key in SkillDeliveryGroupKey::ALL {
        transaction.execute(
            r#"
            INSERT INTO skill_group_assignment(
                group_key, skill_id, revision_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?4)
            "#,
            params![group_key.as_str(), skill_id, revision_id, now],
        )?;
    }
    Ok(())
}

fn load_existing_skill_by_name(database: &Database, name: &str) -> Result<Option<ExistingSkill>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT skill.id, skill.origin, skill.enabled, skill.lifecycle_status,
                   skill.current_revision_id, revision.content_digest, skill.version,
                   revision.source_type
            FROM skill
            JOIN skill_revision AS revision ON revision.id = skill.current_revision_id
            WHERE skill.name = ?1
            "#,
            [name],
            |row| {
                let origin = row.get::<_, String>(1)?;
                Ok(ExistingSkill {
                    id: row.get(0)?,
                    origin: SkillOrigin::parse(&origin).map_err(anyhow_to_sql_error)?,
                    enabled: row.get(2)?,
                    lifecycle_status: row.get(3)?,
                    current_revision_id: row.get(4)?,
                    current_digest: row.get(5)?,
                    version: row.get(6)?,
                    current_source_type: SkillRevisionSourceType::parse(&row.get::<_, String>(7)?)
                        .map_err(anyhow_to_sql_error)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn promote_imported_skill_to_official(database: &mut Database, name: &str) -> Result<bool> {
    let existing = load_existing_skill_by_name(database, name)?;
    let Some(existing) = existing.filter(|skill| skill.origin == SkillOrigin::Imported) else {
        return Ok(false);
    };
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = Utc::now().to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE skill
        SET origin = 'official', lifecycle_status = 'active',
            deletion_requested_at = NULL, version = version + 1, updated_at = ?1
        WHERE id = ?2 AND version = ?3 AND origin = 'imported'
        "#,
        params![now, existing.id, existing.version],
    )?;
    if changed != 1 {
        anyhow::bail!("Imported Skill changed while being promoted to official inventory");
    }
    append_skill_event(
        &transaction,
        "skill.import_promoted_to_official",
        &existing.id,
        &ActorRef::System {
            component_id: "skill-library-bootstrap".to_string(),
        },
        json!({
            "skillId": existing.id,
            "name": name,
            "previousOrigin": "imported",
            "origin": "official",
        }),
    )?;
    transaction.commit()?;
    Ok(true)
}

fn insert_revision(
    transaction: &Transaction<'_>,
    revision_id: &str,
    skill_id: &str,
    candidate: &StagedCandidate,
    source_type: SkillRevisionSourceType,
    source_metadata: &Value,
    installed_at: &str,
) -> Result<()> {
    let revision = transaction.query_row(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM skill_revision WHERE skill_id = ?1",
        [skill_id],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.execute(
        r#"
        INSERT INTO skill_revision(
            id, skill_id, revision, name, description, source_type, content_digest,
            source_metadata_json, risk_summary_json, file_count,
            total_bytes, installed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        "#,
        params![
            revision_id,
            skill_id,
            revision,
            candidate.name,
            candidate.description,
            source_type.as_str(),
            candidate.content_digest,
            serde_json::to_string(source_metadata)?,
            serde_json::to_string(&candidate.risk_summary)?,
            candidate.file_count as i64,
            candidate.total_bytes as i64,
            installed_at,
        ],
    )?;
    Ok(())
}

fn append_skill_event(
    transaction: &Transaction<'_>,
    event_type: &str,
    skill_id: &str,
    actor: &ActorRef,
    payload: Value,
) -> Result<()> {
    let (actor_type, actor_id, source_agent_run_id) = match actor {
        ActorRef::User { user_id } => ("user", user_id.as_str(), None),
        ActorRef::Agent {
            agent_id,
            source_agent_run_id,
        } => (
            "agent",
            agent_id.as_str(),
            Some(source_agent_run_id.as_str()),
        ),
        ActorRef::System { component_id } => ("system", component_id.as_str(), None),
    };
    transaction.execute(
        r#"
        INSERT INTO event_log(
            event_id, event_type, payload_json,
            entity_type, entity_id, actor_type, actor_id,
            source_agent_run_id, created_at
        ) VALUES (?1, ?2, ?3, 'skill', ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            Uuid::new_v4().to_string(),
            event_type,
            serde_json::to_string(&payload)?,
            skill_id,
            actor_type,
            actor_id,
            source_agent_run_id,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn delivery_group_label(key: SkillDeliveryGroupKey) -> &'static str {
    match key {
        SkillDeliveryGroupKey::Codex => "Codex",
        SkillDeliveryGroupKey::Pi => "Pi Coding Agent",
        SkillDeliveryGroupKey::Opencode => "OpenCode",
        SkillDeliveryGroupKey::Copilot => "Copilot",
        SkillDeliveryGroupKey::ClaudeCompatible => "Claude 兼容",
        SkillDeliveryGroupKey::Antigravity => "Antigravity",
        SkillDeliveryGroupKey::Kiro => "Kiro",
        SkillDeliveryGroupKey::Qoder => "Qoder",
        SkillDeliveryGroupKey::Codebuddy => "CodeBuddy",
        SkillDeliveryGroupKey::Qwen => "Qwen",
        SkillDeliveryGroupKey::Trae => "TRAE",
        SkillDeliveryGroupKey::Cursor => "Cursor",
        SkillDeliveryGroupKey::Kimi => "Kimi Code",
    }
}

fn discover_source_candidates(selected_path: &Path) -> Result<Vec<PathBuf>> {
    if has_regular_skill_manifest(selected_path)? {
        return Ok(vec![selected_path.to_path_buf()]);
    }

    let entries = sorted_directory_entries(selected_path)?;
    let mut candidates = Vec::new();
    let mut nested_roots = Vec::new();
    for entry in &entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.file_type().is_dir() || should_skip_skill_discovery_directory(&path) {
            continue;
        }
        if has_regular_skill_manifest(&path)? {
            candidates.push(path);
        } else {
            nested_roots.push(path);
        }
    }

    for nested_root in nested_roots {
        discover_nested_skill_candidates(
            &nested_root,
            1,
            MAX_SKILL_DISCOVERY_DEPTH,
            &mut candidates,
        )?;
    }
    candidates.sort();
    if candidates.is_empty() {
        anyhow::bail!("未发现可导入的 Skill。请确认目录中包含 SKILL.md，或提供更具体的目录链接。");
    }
    Ok(candidates)
}

fn discover_nested_skill_candidates(
    directory: &Path,
    depth: usize,
    maximum_depth: usize,
    candidates: &mut Vec<PathBuf>,
) -> Result<()> {
    if depth > maximum_depth || should_skip_skill_discovery_directory(directory) {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.file_type().is_dir() {
        return Ok(());
    }
    if has_regular_skill_manifest(directory)? {
        candidates.push(directory.to_path_buf());
        return Ok(());
    }
    if depth == maximum_depth {
        return Ok(());
    }
    for entry in sorted_directory_entries(directory)? {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_dir() && !should_skip_skill_discovery_directory(&path) {
            discover_nested_skill_candidates(&path, depth + 1, maximum_depth, candidates)?;
        }
    }
    Ok(())
}

fn has_regular_skill_manifest(directory: &Path) -> Result<bool> {
    match fs::symlink_metadata(directory.join("SKILL.md")) {
        Ok(metadata) => Ok(metadata.file_type().is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn sorted_directory_entries(directory: &Path) -> Result<Vec<fs::DirEntry>> {
    let mut entries = fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries)
}

fn should_skip_skill_discovery_directory(directory: &Path) -> bool {
    let Some(name) = directory.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let normalized = name.to_ascii_lowercase();
    normalized.starts_with("cmake-build-")
        || SKILL_DISCOVERY_IGNORED_DIRECTORIES.contains(&normalized.as_str())
}

fn stage_candidate(
    source: &Path,
    expected_name: &str,
    destination: &Path,
) -> Result<CandidateSnapshot> {
    validate_skill_name(expected_name)?;
    if destination.exists() {
        remove_directory_if_present(destination)?;
    }
    prepare_private_directory(destination)?;
    let mut collector = CandidateCollector::default();
    copy_candidate_tree(source, destination, Path::new(""), 0, &mut collector)?;
    let copied = candidate_snapshot(destination, expected_name, collector)?;
    #[cfg(windows)]
    {
        let reopened = inspect_candidate_tree(destination, expected_name)?;
        if reopened != copied {
            anyhow::bail!("Windows Skill copy changed before it could be reopened and verified");
        }
        Ok(reopened)
    }
    #[cfg(not(windows))]
    {
        Ok(copied)
    }
}

fn inspect_candidate_tree(source: &Path, expected_name: &str) -> Result<CandidateSnapshot> {
    validate_skill_name(expected_name)?;
    let mut collector = CandidateCollector::default();
    inspect_candidate_node(source, Path::new(""), 0, &mut collector)?;
    candidate_snapshot(source, expected_name, collector)
}

fn candidate_snapshot(
    content_root: &Path,
    expected_name: &str,
    collector: CandidateCollector,
) -> Result<CandidateSnapshot> {
    let skill_md = content_root.join("SKILL.md");
    if !skill_md.is_file() {
        anyhow::bail!("Skill directory must contain a regular SKILL.md");
    }
    let skill_text = fs::read_to_string(&skill_md).context("SKILL.md must be valid UTF-8 text")?;
    candidate_snapshot_from_text(&skill_text, expected_name, collector)
}

fn candidate_snapshot_from_text(
    skill_text: &str,
    expected_name: &str,
    mut collector: CandidateCollector,
) -> Result<CandidateSnapshot> {
    let frontmatter = parse_skill_frontmatter(skill_text)?;
    if frontmatter.name != expected_name {
        anyhow::bail!(
            "SKILL.md name '{}' must match directory name '{}'",
            frontmatter.name,
            expected_name
        );
    }
    validate_skill_name(&frontmatter.name)?;
    if frontmatter.description.trim().is_empty() {
        anyhow::bail!("SKILL.md description must not be empty");
    }
    collector
        .records
        .sort_by(|left, right| left.path.cmp(&right.path));
    let content_digest = digest_records(&collector.records);
    Ok(CandidateSnapshot {
        name: frontmatter.name,
        description: frontmatter.description,
        content_digest,
        risk_summary: SkillRiskSummary {
            executable_file_count: collector.executable_file_count,
            script_file_count: collector.script_file_count,
            binary_candidate_count: collector.binary_candidate_count,
            declared_tools: frontmatter.declared_tools,
        },
        file_count: collector.records.len(),
        total_bytes: collector.total_bytes,
    })
}

fn bundled_candidate_snapshot(definition: &BundledDefinition) -> Result<CandidateSnapshot> {
    validate_skill_name(definition.name)?;
    let mut collector = CandidateCollector::default();
    let mut skill_text = None;
    let mut paths = BTreeSet::new();
    for (relative, content, mode) in definition.files {
        let relative = Path::new(relative);
        ensure_relative_path(relative)?;
        let normalized_path = relative.to_string_lossy().replace('\\', "/");
        if !paths.insert(normalized_path.clone()) {
            anyhow::bail!(
                "bundled Skill {} contains duplicate file path {}",
                definition.name,
                normalized_path
            );
        }
        let bytes = content.as_bytes();
        let size = bytes.len() as u64;
        if size > MAX_SKILL_FILE_BYTES {
            anyhow::bail!("Skill file exceeds maximum file size");
        }
        collector.total_bytes = collector
            .total_bytes
            .checked_add(size)
            .context("Skill total size overflowed")?;
        if collector.total_bytes > MAX_SKILL_TOTAL_BYTES {
            anyhow::bail!("Skill package exceeds maximum total size");
        }
        let normalized_mode = *mode & 0o777;
        let executable = normalized_mode & 0o111 != 0;
        if executable {
            collector.executable_file_count += 1;
        }
        if executable || looks_like_script(relative, &bytes[..bytes.len().min(8 * 1024)]) {
            collector.script_file_count += 1;
        }
        if bytes[..bytes.len().min(8 * 1024)].contains(&0) {
            collector.binary_candidate_count += 1;
        }
        let mut digest = Sha256::new();
        digest.update(bytes);
        collector.records.push(FileDigestRecord {
            path: normalized_path,
            mode: normalized_mode,
            size,
            digest: digest.finalize().into(),
        });
        if relative == Path::new("SKILL.md") {
            skill_text = Some(*content);
        }
    }
    if collector.records.len() > MAX_SKILL_FILES {
        anyhow::bail!("Skill package exceeds maximum file count");
    }
    candidate_snapshot_from_text(
        skill_text.context("Skill directory must contain a regular SKILL.md")?,
        definition.name,
        collector,
    )
}

fn bundled_revision_tree_matches(
    content_root: &Path,
    definition: &BundledDefinition,
) -> Result<bool> {
    let mut expected = BTreeMap::new();
    for (relative, content, mode) in definition.files {
        let relative = Path::new(relative);
        ensure_relative_path(relative)?;
        expected.insert(
            relative.to_string_lossy().replace('\\', "/"),
            (*mode & 0o777, content.len() as u64),
        );
    }
    let Ok(root_metadata) = fs::symlink_metadata(content_root) else {
        return Ok(false);
    };
    if !root_metadata.file_type().is_dir() {
        return Ok(false);
    }
    let mut actual = BTreeMap::new();
    if !collect_revision_tree_metadata(content_root, Path::new(""), 0, &mut actual)? {
        return Ok(false);
    }
    Ok(actual == expected)
}

#[cfg(unix)]
fn collect_revision_tree_metadata(
    content_root: &Path,
    relative: &Path,
    depth: usize,
    files: &mut BTreeMap<String, (u32, u64)>,
) -> Result<bool> {
    if depth > MAX_SKILL_DEPTH {
        return Ok(false);
    }
    let path = content_root.join(relative);
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() {
        return Ok(false);
    }
    if metadata.file_type().is_dir() {
        for entry in sorted_directory_entries(&path)? {
            let child = relative.join(entry.file_name());
            if ensure_relative_path(&child).is_err()
                || !collect_revision_tree_metadata(content_root, &child, depth + 1, files)?
            {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    if !metadata.file_type().is_file() {
        return Ok(false);
    }
    files.insert(
        relative.to_string_lossy().replace('\\', "/"),
        (metadata.permissions().mode() & 0o777, metadata.len()),
    );
    Ok(files.len() <= MAX_SKILL_FILES)
}

#[cfg(windows)]
fn collect_revision_tree_metadata(
    content_root: &Path,
    relative: &Path,
    depth: usize,
    files: &mut BTreeMap<String, (u32, u64)>,
) -> Result<bool> {
    if !relative.as_os_str().is_empty() {
        anyhow::bail!("Windows Skill tree collection must begin at its retained root handle");
    }
    let root = crate::platform::windows_file_tree::open_path_without_following(content_root)
        .context("failed to open Windows Skill Revision root")?;
    collect_revision_tree_metadata_windows(root, relative, depth, files)
}

#[cfg(windows)]
fn collect_revision_tree_metadata_windows(
    node: File,
    relative: &Path,
    depth: usize,
    files: &mut BTreeMap<String, (u32, u64)>,
) -> Result<bool> {
    use crate::platform::windows_file_tree::NodeKind;

    if depth > MAX_SKILL_DEPTH {
        return Ok(false);
    }
    let before = crate::platform::windows_file_tree::inspect_node(&node)
        .context("failed to inspect Windows Skill Revision node")?;
    match before.kind {
        NodeKind::Directory => {
            let names = crate::platform::windows_file_tree::read_directory_names(
                &node,
                MAX_SKILL_FILES + 1,
            )
            .context("failed to enumerate Windows Skill Revision directory")?;
            for name in names {
                let child_relative = relative.join(&name);
                ensure_relative_path(&child_relative)?;
                let child =
                    crate::platform::windows_file_tree::open_child_without_following(&node, &name)
                        .context("failed to open Windows Skill Revision child")?;
                if !collect_revision_tree_metadata_windows(
                    child,
                    &child_relative,
                    depth + 1,
                    files,
                )? {
                    return Ok(false);
                }
            }
        }
        NodeKind::RegularFile => {
            files.insert(
                canonical_skill_relative_path(relative)?,
                (WINDOWS_SKILL_LOGICAL_FILE_MODE, before.fingerprint.size),
            );
            if files.len() > MAX_SKILL_FILES {
                return Ok(false);
            }
        }
    }
    let after = crate::platform::windows_file_tree::inspect_node(&node)
        .context("failed to re-inspect Windows Skill Revision node")?;
    Ok(before == after)
}

#[cfg(not(any(unix, windows)))]
fn collect_revision_tree_metadata(
    _content_root: &Path,
    _relative: &Path,
    _depth: usize,
    _files: &mut BTreeMap<String, (u32, u64)>,
) -> Result<bool> {
    anyhow::bail!("windows_private_storage_not_implemented")
}

#[derive(Debug, Default)]
struct CandidateCollector {
    records: Vec<FileDigestRecord>,
    total_bytes: u64,
    executable_file_count: usize,
    script_file_count: usize,
    binary_candidate_count: usize,
}

#[derive(Debug)]
struct FileDigestRecord {
    path: String,
    mode: u32,
    size: u64,
    digest: [u8; 32],
}

#[cfg(unix)]
fn copy_candidate_tree(
    source_root: &Path,
    destination_root: &Path,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    if depth > MAX_SKILL_DEPTH {
        anyhow::bail!("Skill directory exceeds maximum recursion depth");
    }
    let source = source_root.join(relative);
    let metadata = fs::symlink_metadata(&source)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Skill packages cannot contain symbolic links");
    }
    if metadata.file_type().is_dir() {
        if depth > 0 {
            fs::create_dir_all(destination_root.join(relative))?;
        }
        let mut entries = fs::read_dir(&source)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child = relative.join(entry.file_name());
            ensure_relative_path(&child)?;
            copy_candidate_tree(source_root, destination_root, &child, depth + 1, collector)?;
        }
        return Ok(());
    }
    if !metadata.file_type().is_file() {
        anyhow::bail!("Skill packages can contain only regular files and directories");
    }
    if collector.records.len() >= MAX_SKILL_FILES {
        anyhow::bail!("Skill package exceeds maximum file count");
    }
    if metadata.len() > MAX_SKILL_FILE_BYTES {
        anyhow::bail!("Skill file exceeds maximum file size");
    }
    collector.total_bytes = collector
        .total_bytes
        .checked_add(metadata.len())
        .context("Skill total size overflowed")?;
    if collector.total_bytes > MAX_SKILL_TOTAL_BYTES {
        anyhow::bail!("Skill package exceeds maximum total size");
    }
    let destination = destination_root.join(relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut input = File::open(&source)?;
    let mode = metadata.permissions().mode() & 0o777;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(mode)
        .open(&destination)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut first_bytes = Vec::new();
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        if first_bytes.len() < 8 * 1024 {
            let remaining = 8 * 1024 - first_bytes.len();
            first_bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        digest.update(&buffer[..read]);
        output.write_all(&buffer[..read])?;
    }
    output.sync_all()?;
    fs::set_permissions(&destination, fs::Permissions::from_mode(mode))?;
    let executable = mode & 0o111 != 0;
    if executable {
        collector.executable_file_count += 1;
    }
    if executable || looks_like_script(relative, &first_bytes) {
        collector.script_file_count += 1;
    }
    if first_bytes.contains(&0) {
        collector.binary_candidate_count += 1;
    }
    collector.records.push(FileDigestRecord {
        path: relative.to_string_lossy().replace('\\', "/"),
        mode,
        size: metadata.len(),
        digest: digest.finalize().into(),
    });
    Ok(())
}

#[cfg(windows)]
fn copy_candidate_tree(
    source_root: &Path,
    destination_root: &Path,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    if !relative.as_os_str().is_empty() {
        anyhow::bail!("Windows Skill copy must begin at its retained root handle");
    }
    let root = crate::platform::windows_file_tree::open_path_without_following(source_root)
        .context("failed to open Windows Skill source root")?;
    copy_candidate_node_windows(root, destination_root, relative, depth, collector)
}

#[cfg(windows)]
fn copy_candidate_node_windows(
    mut source: File,
    destination_root: &Path,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    use crate::platform::windows_file_tree::NodeKind;

    if depth > MAX_SKILL_DEPTH {
        anyhow::bail!("Skill directory exceeds maximum recursion depth");
    }
    let before = crate::platform::windows_file_tree::inspect_node(&source)
        .context("failed to inspect Windows Skill source node")?;
    match before.kind {
        NodeKind::Directory => {
            if depth > 0 {
                create_private_directory(&destination_root.join(relative))?;
            }
            let names = crate::platform::windows_file_tree::read_directory_names(
                &source,
                MAX_SKILL_FILES + 1,
            )
            .context("failed to enumerate Windows Skill source directory")?;
            for name in names {
                let child_relative = relative.join(&name);
                ensure_relative_path(&child_relative)?;
                let child = crate::platform::windows_file_tree::open_child_without_following(
                    &source, &name,
                )
                .context("failed to open Windows Skill source child")?;
                copy_candidate_node_windows(
                    child,
                    destination_root,
                    &child_relative,
                    depth + 1,
                    collector,
                )?;
            }
        }
        NodeKind::RegularFile => {
            if collector.records.len() >= MAX_SKILL_FILES {
                anyhow::bail!("Skill package exceeds maximum file count");
            }
            if before.fingerprint.size > MAX_SKILL_FILE_BYTES {
                anyhow::bail!("Skill file exceeds maximum file size");
            }
            collector.total_bytes = collector
                .total_bytes
                .checked_add(before.fingerprint.size)
                .context("Skill total size overflowed")?;
            if collector.total_bytes > MAX_SKILL_TOTAL_BYTES {
                anyhow::bail!("Skill package exceeds maximum total size");
            }

            let destination = destination_root.join(relative);
            let mut output = create_private_new_file(&destination)?;
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            let mut first_bytes = Vec::new();
            let mut copied = 0_u64;
            loop {
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                copied = copied
                    .checked_add(read as u64)
                    .context("Skill file size overflowed while copying")?;
                if copied > before.fingerprint.size {
                    anyhow::bail!("Skill file changed while it was being copied");
                }
                if first_bytes.len() < 8 * 1024 {
                    let remaining = 8 * 1024 - first_bytes.len();
                    first_bytes.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                digest.update(&buffer[..read]);
                output.write_all(&buffer[..read])?;
            }
            if copied != before.fingerprint.size {
                anyhow::bail!("Skill file changed while it was being copied");
            }
            output.sync_all()?;
            if looks_like_script(relative, &first_bytes) {
                collector.script_file_count += 1;
            }
            if first_bytes.contains(&0) {
                collector.binary_candidate_count += 1;
            }
            collector.records.push(FileDigestRecord {
                path: canonical_skill_relative_path(relative)?,
                mode: WINDOWS_SKILL_LOGICAL_FILE_MODE,
                size: before.fingerprint.size,
                digest: digest.finalize().into(),
            });
        }
    }
    let after = crate::platform::windows_file_tree::inspect_node(&source)
        .context("failed to re-inspect Windows Skill source node")?;
    if before != after {
        anyhow::bail!("Skill source changed while it was being copied");
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn copy_candidate_tree(
    _source_root: &Path,
    _destination_root: &Path,
    _relative: &Path,
    _depth: usize,
    _collector: &mut CandidateCollector,
) -> Result<()> {
    anyhow::bail!("windows_private_storage_not_implemented")
}

#[cfg(unix)]
fn inspect_candidate_node(
    source_root: &Path,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    if depth > MAX_SKILL_DEPTH {
        anyhow::bail!("Skill directory exceeds maximum recursion depth");
    }
    let source = source_root.join(relative);
    let metadata = fs::symlink_metadata(&source)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("Skill packages cannot contain symbolic links");
    }
    if metadata.file_type().is_dir() {
        let mut entries = fs::read_dir(&source)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child = relative.join(entry.file_name());
            ensure_relative_path(&child)?;
            inspect_candidate_node(source_root, &child, depth + 1, collector)?;
        }
        return Ok(());
    }
    if !metadata.file_type().is_file() {
        anyhow::bail!("Skill packages can contain only regular files and directories");
    }
    if collector.records.len() >= MAX_SKILL_FILES {
        anyhow::bail!("Skill package exceeds maximum file count");
    }
    if metadata.len() > MAX_SKILL_FILE_BYTES {
        anyhow::bail!("Skill file exceeds maximum file size");
    }
    collector.total_bytes = collector
        .total_bytes
        .checked_add(metadata.len())
        .context("Skill total size overflowed")?;
    if collector.total_bytes > MAX_SKILL_TOTAL_BYTES {
        anyhow::bail!("Skill package exceeds maximum total size");
    }
    let mut input = File::open(&source)?;
    let mode = metadata.permissions().mode() & 0o777;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut first_bytes = Vec::new();
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        if first_bytes.len() < 8 * 1024 {
            let remaining = 8 * 1024 - first_bytes.len();
            first_bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        digest.update(&buffer[..read]);
    }
    let executable = mode & 0o111 != 0;
    if executable {
        collector.executable_file_count += 1;
    }
    if executable || looks_like_script(relative, &first_bytes) {
        collector.script_file_count += 1;
    }
    if first_bytes.contains(&0) {
        collector.binary_candidate_count += 1;
    }
    collector.records.push(FileDigestRecord {
        path: relative.to_string_lossy().replace('\\', "/"),
        mode,
        size: metadata.len(),
        digest: digest.finalize().into(),
    });
    Ok(())
}

#[cfg(windows)]
fn inspect_candidate_node(
    source_root: &Path,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    if !relative.as_os_str().is_empty() {
        anyhow::bail!("Windows Skill inspection must begin at its retained root handle");
    }
    let root = crate::platform::windows_file_tree::open_path_without_following(source_root)
        .context("failed to open Windows Skill inspection root")?;
    inspect_candidate_node_windows(root, relative, depth, collector)
}

#[cfg(windows)]
fn inspect_candidate_node_windows(
    mut source: File,
    relative: &Path,
    depth: usize,
    collector: &mut CandidateCollector,
) -> Result<()> {
    use crate::platform::windows_file_tree::NodeKind;

    if depth > MAX_SKILL_DEPTH {
        anyhow::bail!("Skill directory exceeds maximum recursion depth");
    }
    let before = crate::platform::windows_file_tree::inspect_node(&source)
        .context("failed to inspect Windows Skill node")?;
    match before.kind {
        NodeKind::Directory => {
            let names = crate::platform::windows_file_tree::read_directory_names(
                &source,
                MAX_SKILL_FILES + 1,
            )
            .context("failed to enumerate Windows Skill directory")?;
            for name in names {
                let child_relative = relative.join(&name);
                ensure_relative_path(&child_relative)?;
                let child = crate::platform::windows_file_tree::open_child_without_following(
                    &source, &name,
                )
                .context("failed to open Windows Skill child")?;
                inspect_candidate_node_windows(child, &child_relative, depth + 1, collector)?;
            }
        }
        NodeKind::RegularFile => {
            if collector.records.len() >= MAX_SKILL_FILES {
                anyhow::bail!("Skill package exceeds maximum file count");
            }
            if before.fingerprint.size > MAX_SKILL_FILE_BYTES {
                anyhow::bail!("Skill file exceeds maximum file size");
            }
            collector.total_bytes = collector
                .total_bytes
                .checked_add(before.fingerprint.size)
                .context("Skill total size overflowed")?;
            if collector.total_bytes > MAX_SKILL_TOTAL_BYTES {
                anyhow::bail!("Skill package exceeds maximum total size");
            }
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            let mut first_bytes = Vec::new();
            let mut inspected = 0_u64;
            loop {
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                inspected = inspected
                    .checked_add(read as u64)
                    .context("Skill file size overflowed while inspecting")?;
                if inspected > before.fingerprint.size {
                    anyhow::bail!("Skill file changed while it was being inspected");
                }
                if first_bytes.len() < 8 * 1024 {
                    let remaining = 8 * 1024 - first_bytes.len();
                    first_bytes.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                digest.update(&buffer[..read]);
            }
            if inspected != before.fingerprint.size {
                anyhow::bail!("Skill file changed while it was being inspected");
            }
            if looks_like_script(relative, &first_bytes) {
                collector.script_file_count += 1;
            }
            if first_bytes.contains(&0) {
                collector.binary_candidate_count += 1;
            }
            collector.records.push(FileDigestRecord {
                path: canonical_skill_relative_path(relative)?,
                mode: WINDOWS_SKILL_LOGICAL_FILE_MODE,
                size: before.fingerprint.size,
                digest: digest.finalize().into(),
            });
        }
    }
    let after = crate::platform::windows_file_tree::inspect_node(&source)
        .context("failed to re-inspect Windows Skill node")?;
    if before != after {
        anyhow::bail!("Skill source changed while it was being inspected");
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn inspect_candidate_node(
    _source_root: &Path,
    _relative: &Path,
    _depth: usize,
    _collector: &mut CandidateCollector,
) -> Result<()> {
    anyhow::bail!("windows_private_storage_not_implemented")
}

fn digest_records(records: &[FileDigestRecord]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"rovai-skill-revision-v1\0");
    for record in records {
        digest.update((record.path.len() as u64).to_be_bytes());
        digest.update(record.path.as_bytes());
        digest.update(record.mode.to_be_bytes());
        digest.update(record.size.to_be_bytes());
        digest.update(record.digest);
    }
    format!("sha256:{:x}", digest.finalize())
}

fn looks_like_script(relative: &Path, first_bytes: &[u8]) -> bool {
    if first_bytes.starts_with(b"#!") {
        return true;
    }
    matches!(
        relative.extension().and_then(|value| value.to_str()),
        Some(
            "sh" | "bash"
                | "zsh"
                | "fish"
                | "py"
                | "rb"
                | "pl"
                | "js"
                | "mjs"
                | "cjs"
                | "ts"
                | "ps1"
        )
    )
}

struct SkillFrontmatter {
    name: String,
    description: String,
    declared_tools: Vec<String>,
}

fn parse_skill_frontmatter(text: &str) -> Result<SkillFrontmatter> {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        anyhow::bail!("SKILL.md must start with YAML frontmatter");
    }
    let mut values = BTreeMap::<String, String>::new();
    let mut found_end = false;
    for line in lines {
        if line.trim() == "---" {
            found_end = true;
            break;
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values.insert(
            key.trim().to_string(),
            unquote_yaml_scalar(value.trim()).to_string(),
        );
    }
    if !found_end {
        anyhow::bail!("SKILL.md frontmatter is missing its closing delimiter");
    }
    let name = values
        .remove("name")
        .filter(|value| !value.trim().is_empty())
        .context("SKILL.md frontmatter must contain name")?;
    let description = values
        .remove("description")
        .filter(|value| !value.trim().is_empty())
        .context("SKILL.md frontmatter must contain description")?;
    let declared_tools = values
        .remove("allowed-tools")
        .map(|value| {
            value
                .trim_matches(['[', ']'])
                .split([',', ' '])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(SkillFrontmatter {
        name,
        description,
        declared_tools,
    })
}

fn unquote_yaml_scalar(value: &str) -> &str {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return &value[1..value.len() - 1];
        }
    }
    value
}

pub(crate) fn validate_skill_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        anyhow::bail!("Skill name must contain between 1 and 64 characters");
    }
    let mut previous_hyphen = false;
    for (index, character) in name.chars().enumerate() {
        let valid = character.is_ascii_lowercase() || character.is_ascii_digit();
        if valid {
            previous_hyphen = false;
            continue;
        }
        if character == '-'
            && index > 0
            && !previous_hyphen
            && index + character.len_utf8() < name.len()
        {
            previous_hyphen = true;
            continue;
        }
        anyhow::bail!("Skill name must use lowercase ASCII letters, digits, and single hyphens");
    }
    Ok(())
}

fn validate_github_repository_url(value: &str) -> Result<()> {
    let Some(path) = value.strip_prefix("https://github.com/") else {
        anyhow::bail!("仅支持 https://github.com/ 仓库地址");
    };
    if value.contains('@') || value.contains('?') || value.contains('#') {
        anyhow::bail!("GitHub 仓库地址不能包含凭据、查询参数或片段");
    }
    let segments = path
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_end_matches('/'))
        .split('/')
        .collect::<Vec<_>>();
    if segments.len() != 2
        || segments.iter().any(|segment| {
            segment.is_empty()
                || !segment
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
    {
        anyhow::bail!("GitHub 仓库地址必须是 https://github.com/<owner>/<repo>");
    }
    Ok(())
}

fn validate_git_ref(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || value.contains("..")
        || value.contains("@{")
        || value.ends_with('.')
        || value.ends_with('/')
        || value.chars().any(|character| {
            character.is_control()
                || character.is_whitespace()
                || matches!(character, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
    {
        anyhow::bail!("GitHub branch、tag 或 commit ref 无效");
    }
    Ok(())
}

fn run_git_import(repository_url: &str, git_ref: Option<&str>, checkout_root: &Path) -> Result<()> {
    let output = if let Some(git_ref) = git_ref {
        let init = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["init", "--quiet"])
            .arg(checkout_root)
            .output()
            .context("无法启动 git")?;
        if !init.status.success() {
            anyhow::bail!("无法初始化 GitHub Skill 临时仓库");
        }
        let remote = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .arg("-C")
            .arg(checkout_root)
            .args(["remote", "add", "origin", repository_url])
            .output()?;
        if !remote.status.success() {
            anyhow::bail!("无法配置 GitHub Skill 仓库地址");
        }
        let fetch = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .arg("-C")
            .arg(checkout_root)
            .args(["fetch", "--depth", "1", "--no-tags", "origin", git_ref])
            .output()?;
        if !fetch.status.success() {
            anyhow::bail!(
                "无法获取 GitHub Skill ref：{}",
                String::from_utf8_lossy(&fetch.stderr).trim()
            );
        }
        Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .arg("-C")
            .arg(checkout_root)
            .args(["checkout", "--quiet", "--detach", "FETCH_HEAD"])
            .output()?
    } else {
        Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .args([
                "clone",
                "--quiet",
                "--depth",
                "1",
                "--no-tags",
                repository_url,
            ])
            .arg(checkout_root)
            .output()
            .context("无法启动 git")?
    };
    if !output.status.success() {
        anyhow::bail!(
            "无法检出 GitHub Skill：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn git_import_output(checkout_root: &Path, arguments: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(checkout_root)
        .args(arguments)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("无法读取 GitHub Skill checkout 元数据");
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

fn ensure_relative_path(path: &Path) -> Result<()> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        anyhow::bail!("Skill contains an invalid relative path");
    }
    Ok(())
}

#[cfg(windows)]
fn canonical_skill_relative_path(path: &Path) -> Result<String> {
    path.to_str()
        .context("Windows Skill paths must have a lossless Unicode representation")
        .map(|value| value.replace('\\', "/"))
}

#[cfg(windows)]
fn ensure_private_parent_directories(root: &Path, path: &Path) -> Result<()> {
    let parent = path.parent().context("Skill file has no parent")?;
    let relative = parent
        .strip_prefix(root)
        .context("Skill file escaped its materialization root")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            anyhow::bail!("Skill contains an invalid relative path");
        };
        current.push(name);
        if current.exists() {
            prepare_private_directory(&current)?;
        } else {
            create_private_directory(&current)?;
        }
    }
    Ok(())
}

fn publish_directory(source: &Path, final_content: &Path) -> Result<()> {
    if final_content.exists() {
        anyhow::bail!("Skill Revision destination already exists");
    }
    let revision_dir = final_content
        .parent()
        .context("Skill Revision destination has no parent")?;
    prepare_private_directory(revision_dir)?;
    fs::rename(source, final_content).with_context(|| {
        format!(
            "failed to publish Skill Revision from {} to {}",
            source.display(),
            final_content.display()
        )
    })?;
    Ok(())
}

fn strip_official_skill_name_prefixes(database: &mut Database) -> Result<bool> {
    let now = Utc::now().to_rfc3339();
    let transaction = database.connection_mut().transaction()?;
    let mut changed = false;
    let actor = ActorRef::System {
        component_id: "skill-library-bootstrap".to_string(),
    };
    for definition in BUNDLED_SKILLS {
        let prefixed_name = format!("rovai-{}", definition.name);
        let existing_id = transaction
            .query_row(
                "SELECT id FROM skill WHERE name = ?1 AND origin = 'official'",
                [&prefixed_name],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(existing_id) = existing_id else {
            continue;
        };
        let target_exists = transaction
            .query_row(
                "SELECT 1 FROM skill WHERE name = ?1",
                [definition.name],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if target_exists {
            anyhow::bail!(
                "cannot remove the official Skill prefix because {} already exists",
                definition.name
            );
        }
        transaction.execute(
            r#"
            UPDATE skill
            SET name = ?1, version = version + 1, updated_at = ?2
            WHERE id = ?3 AND name = ?4 AND origin = 'official'
            "#,
            params![definition.name, now, existing_id, prefixed_name],
        )?;
        append_skill_event(
            &transaction,
            "skill.official_name_changed",
            &existing_id,
            &actor,
            json!({
                "skillId": existing_id.clone(),
                "previousName": prefixed_name.clone(),
                "name": definition.name,
            }),
        )?;
        changed = true;
    }
    transaction.commit()?;
    Ok(changed)
}

fn restore_system_required_skill_configuration(
    database: &mut Database,
    name: &str,
) -> Result<bool> {
    if bundled_definition(name).is_none_or(|definition| {
        definition.management_policy != SkillManagementPolicy::SystemRequired
    }) {
        return Ok(false);
    }

    let now = Utc::now().to_rfc3339();
    let transaction = database.connection_mut().transaction()?;
    let current = transaction
        .query_row(
            r#"
            SELECT id, current_revision_id
            FROM skill
            WHERE name = ?1 AND origin = 'official'
            "#,
            [name],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((skill_id, revision_id)) = current else {
        transaction.commit()?;
        return Ok(false);
    };

    let mut changed = transaction.execute(
        "UPDATE skill SET enabled = 1 WHERE id = ?1 AND enabled = 0",
        [&skill_id],
    )? > 0;
    for group_key in SkillDeliveryGroupKey::ALL {
        changed |= transaction.execute(
            r#"
            INSERT INTO skill_group_assignment(
                group_key, skill_id, revision_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT(group_key, skill_id) DO UPDATE SET
                revision_id = excluded.revision_id,
                updated_at = excluded.updated_at
            WHERE skill_group_assignment.revision_id <> excluded.revision_id
            "#,
            params![group_key.as_str(), skill_id, revision_id, now],
        )? > 0;
    }

    if changed {
        transaction.execute(
            "UPDATE skill SET version = version + 1, updated_at = ?1 WHERE id = ?2",
            params![now, skill_id],
        )?;
        append_skill_event(
            &transaction,
            "skill.system_configuration_restored",
            &skill_id,
            &ActorRef::System {
                component_id: "skill-library-bootstrap".to_string(),
            },
            json!({
                "skillId": skill_id,
                "enabled": true,
                "groupKeys": SkillDeliveryGroupKey::ALL
                    .into_iter()
                    .map(|group_key| group_key.as_str())
                    .collect::<Vec<_>>(),
            }),
        )?;
    }
    transaction.commit()?;
    Ok(changed)
}

#[cfg(unix)]
fn materialize_bundled_definition(
    destination: &Path,
    definition: &BundledDefinition,
) -> Result<()> {
    fs::create_dir_all(destination)?;
    for (relative, content, mode) in definition.files {
        let relative = Path::new(relative);
        ensure_relative_path(relative)?;
        let path = destination.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(*mode)
            .open(path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    Ok(())
}

#[cfg(windows)]
fn materialize_bundled_definition(
    destination: &Path,
    definition: &BundledDefinition,
) -> Result<()> {
    prepare_private_directory(destination)?;
    for (relative, content, mode) in definition.files {
        let relative = Path::new(relative);
        ensure_relative_path(relative)?;
        if *mode & 0o777 != WINDOWS_SKILL_LOGICAL_FILE_MODE {
            anyhow::bail!(
                "bundled Skill {} uses a file mode that Windows Skill Revision v1 cannot preserve",
                definition.name
            );
        }
        let path = destination.join(relative);
        ensure_private_parent_directories(destination, &path)?;
        let mut file = create_private_new_file(&path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    Ok(())
}

fn validate_staging_token(token: &str) -> Result<()> {
    Uuid::parse_str(token).context("Skill import staging token is invalid")?;
    Ok(())
}

fn validate_stable_id(value: &str, label: &str) -> Result<()> {
    Uuid::parse_str(value).with_context(|| format!("{label} is invalid"))?;
    Ok(())
}

fn remove_directory_if_present(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn import_error_code(error: &anyhow::Error) -> &'static str {
    let message = error.to_string();
    if message.contains("symbolic links") || message.contains("regular files and directories") {
        "unsafe_node"
    } else if message.contains("maximum") {
        "size_limit_exceeded"
    } else if message.contains("frontmatter")
        || message.contains("name")
        || message.contains("description")
    {
        "invalid_manifest"
    } else {
        "invalid_skill"
    }
}

fn to_sql_error(error: impl std::error::Error + Send + Sync + 'static) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn anyhow_to_sql_error(error: anyhow::Error) -> rusqlite::Error {
    to_sql_error(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error.to_string(),
    ))
}

#[cfg(all(test, windows))]
mod windows_skill_library_tests {
    use super::*;

    const WINDOWS_FIXTURE_FILES: &[(&str, &str, u32)] = &[
        (
            "SKILL.md",
            "---\nname: windows-tree\ndescription: Windows tree fixture\n---\n\nFixture.\n",
            0o644,
        ),
        ("references/说明.md", "Unicode child.\n", 0o644),
        ("references/nested/.hidden", "hidden\n", 0o644),
    ];

    fn temporary_directory(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_fixture(root: &Path) -> PathBuf {
        let source = root.join("windows-tree");
        for (relative, content, _) in WINDOWS_FIXTURE_FILES {
            let path = source.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content.as_bytes()).unwrap();
        }
        source
    }

    #[test]
    fn windows_skill_library_copies_and_reverifies_a_unicode_tree() {
        let sandbox = temporary_directory("rovai-windows-skill-tree");
        let source = write_fixture(&sandbox);
        let destination = sandbox.join("private-staging");
        let staged = stage_candidate(&source, "windows-tree", &destination).unwrap();
        let expected = bundled_candidate_snapshot(&BundledDefinition {
            name: "windows-tree",
            files: WINDOWS_FIXTURE_FILES,
            upstream_repository: None,
            upstream_revision: None,
            management_policy: SkillManagementPolicy::UserManaged,
        })
        .unwrap();

        assert_eq!(staged.content_digest, expected.content_digest);
        assert_eq!(staged.file_count, WINDOWS_FIXTURE_FILES.len());
        assert_eq!(
            inspect_candidate_tree(&destination, "windows-tree")
                .unwrap()
                .content_digest,
            expected.content_digest
        );
        for (relative, content, _) in WINDOWS_FIXTURE_FILES {
            assert_eq!(
                fs::read(destination.join(relative)).unwrap(),
                content.as_bytes()
            );
        }

        remove_directory_if_present(&sandbox).unwrap();
    }

    #[test]
    fn windows_skill_library_rejects_a_junction_inside_the_source() {
        let sandbox = temporary_directory("rovai-windows-skill-reparse");
        let source = write_fixture(&sandbox);
        let outside = sandbox.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), b"outside").unwrap();
        let junction = source.join("linked-outside");
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create the junction fixture");

        let error = format!(
            "{:#}",
            stage_candidate(&source, "windows-tree", &sandbox.join("staging")).unwrap_err()
        );
        assert!(error.contains("reparse point"), "unexpected error: {error}");

        fs::remove_dir(&junction).unwrap();
        remove_directory_if_present(&sandbox).unwrap();
    }

    #[test]
    fn windows_skill_library_bootstraps_and_fast_paths_all_bundled_revisions() {
        let sandbox = temporary_directory("rovai-windows-skill-bootstrap");
        let mut database = Database::open(&sandbox.join("database")).unwrap();
        let service = SkillLibraryService::new(sandbox.join("library")).unwrap();

        let first = service.install_bundled_skills(&mut database).unwrap();
        assert_eq!(first.materialized_count, BUNDLED_SKILLS.len());
        let second = service.install_bundled_skills(&mut database).unwrap();
        assert_eq!(second.fast_path_count, BUNDLED_SKILLS.len());
        assert_eq!(second.materialized_count, 0);
        let skills = service.list(&database).unwrap();
        assert_eq!(skills.len(), BUNDLED_SKILLS.len());
        for skill in &skills {
            service
                .verify_revision_content(&skill.current_revision)
                .unwrap();
        }

        drop(database);
        remove_directory_if_present(&sandbox).unwrap();
    }
}

#[cfg(all(test, feature = "slow-tests", unix))]
mod slow_tests {
    use super::*;
    use crate::command::ActorRef;

    fn temporary_directory(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn user_envelope<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "test-user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn write_skill(root: &Path, name: &str, body: &str) -> PathBuf {
        let path = root.join(name);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Test {name}\n---\n\n{body}\n"),
        )
        .unwrap();
        path
    }

    fn collect_relative_files(root: &Path) -> BTreeSet<String> {
        let mut files = BTreeSet::new();
        let mut directories = vec![root.to_path_buf()];
        while let Some(directory) = directories.pop() {
            let mut entries = fs::read_dir(&directory)
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let file_type = entry.file_type().unwrap();
                let path = entry.path();
                if file_type.is_dir() {
                    directories.push(path);
                    continue;
                }
                assert!(
                    file_type.is_file(),
                    "bundled Skill materialized a non-regular node: {}",
                    path.display()
                );
                let relative = path.strip_prefix(root).unwrap();
                files.insert(
                    relative
                        .to_string_lossy()
                        .replace(std::path::MAIN_SEPARATOR, "/"),
                );
            }
        }
        files
    }

    fn assert_bundled_skill_materialized(
        service: &SkillLibraryService,
        skill: &SkillView,
        definition: &BundledDefinition,
    ) {
        assert_eq!(skill.name, definition.name);
        assert_eq!(skill.origin, SkillOrigin::Official);
        assert_eq!(
            skill.current_revision.source_type,
            SkillRevisionSourceType::Bundled
        );
        assert_eq!(skill.management_policy, definition.management_policy);
        assert_eq!(
            skill.current_revision.file_count as usize,
            definition.files.len()
        );
        assert_eq!(
            skill.current_revision.source_metadata.get("bundled"),
            Some(&Value::Bool(true))
        );
        match (definition.upstream_repository, definition.upstream_revision) {
            (Some(repository), Some(revision)) => assert_eq!(
                skill.current_revision.source_metadata.get("upstream"),
                Some(&json!({
                    "repository": repository,
                    "revision": revision,
                }))
            ),
            (None, None) => assert!(
                skill
                    .current_revision
                    .source_metadata
                    .get("upstream")
                    .is_none()
            ),
            _ => panic!(
                "bundled Skill {} has incomplete upstream metadata",
                definition.name
            ),
        }

        let content = service.revision_content_path(&skill.id, &skill.current_revision.id);
        assert_eq!(
            collect_relative_files(&content),
            definition
                .files
                .iter()
                .map(|(relative, _, _)| (*relative).to_string())
                .collect::<BTreeSet<_>>()
        );
        for (relative, expected_content, expected_mode) in definition.files {
            let path = content.join(relative);
            assert_eq!(
                fs::read(&path).unwrap(),
                expected_content.as_bytes(),
                "bundled Skill {} content differs at {relative}",
                definition.name
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                *expected_mode,
                "bundled Skill {} mode differs at {relative}",
                definition.name
            );
        }
    }

    #[test]
    fn imports_default_to_all_groups_and_updates_preserve_user_changes() {
        let root = temporary_directory("rovai-skill-library");
        let source = temporary_directory("rovai-skill-source");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let skill_path = write_skill(&source, "test-skill", "first");
        let inspection = service.inspect_import(&database, &skill_path).unwrap();
        let candidate = &inspection.candidates[0];
        let result = service
            .commit_import(
                &mut database,
                &user_envelope(
                    "import-1",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token.clone(),
                        candidate_name: candidate.name.clone(),
                        expected_digest: candidate.content_digest.clone(),
                        expected_skill_version: None,
                        confirm_update: false,
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.code, "skill_imported");
        let first = service.list(&database).unwrap().pop().unwrap();
        assert!(first.enabled);
        assert_eq!(
            first.group_assignments.len(),
            SkillDeliveryGroupKey::ALL.len()
        );
        assert!(SkillDeliveryGroupKey::ALL.into_iter().all(|group_key| {
            first
                .group_assignments
                .iter()
                .any(|assignment| assignment.group_key == group_key)
        }));
        let assignment_result = service
            .set_group_assignments(
                &mut database,
                &user_envelope(
                    "assign-1",
                    SetSkillGroupAssignmentsCommand {
                        skill_id: first.id.clone(),
                        expected_version: first.version,
                        group_keys: vec![
                            SkillDeliveryGroupKey::Codex,
                            SkillDeliveryGroupKey::ClaudeCompatible,
                        ],
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            assignment_result.result.code,
            "skill_group_assignments_changed"
        );
        let assigned = service.get(&database, &first.id).unwrap().unwrap();

        fs::write(
            skill_path.join("SKILL.md"),
            "---\nname: test-skill\ndescription: Updated\n---\n\nsecond\n",
        )
        .unwrap();
        let inspection = service.inspect_import(&database, &skill_path).unwrap();
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.import_action, "update");
        let result = service
            .commit_import(
                &mut database,
                &user_envelope(
                    "import-2",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token.clone(),
                        candidate_name: candidate.name.clone(),
                        expected_digest: candidate.content_digest.clone(),
                        expected_skill_version: Some(assigned.version),
                        confirm_update: true,
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.code, "skill_updated");
        let revision_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM skill_revision", [], |row| row.get(0))
            .unwrap();
        assert_eq!(revision_count, 2);
        let updated = service.get(&database, &first.id).unwrap().unwrap();
        assert_eq!(updated.current_revision.revision, 2);
        assert_eq!(updated.group_assignments.len(), 2);
        assert!(
            updated
                .group_assignments
                .iter()
                .all(|assignment| assignment.revision_id == updated.current_revision.id)
        );
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn collection_import_rejects_symlinks_without_losing_valid_candidates() {
        let root = temporary_directory("rovai-skill-library");
        let source = temporary_directory("rovai-skill-source");
        let data = temporary_directory("rovai-skill-db");
        let database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        write_skill(&source, "valid-skill", "valid");
        let unsafe_skill = write_skill(&source, "unsafe-skill", "unsafe");
        std::os::unix::fs::symlink("/tmp", unsafe_skill.join("outside")).unwrap();
        let inspection = service.inspect_import(&database, &source).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].name, "valid-skill");
        assert_eq!(inspection.rejected_candidates.len(), 1);
        assert_eq!(inspection.rejected_candidates[0].code, "unsafe_node");
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn nested_discovery_stages_skill_from_repository_root() {
        let root = temporary_directory("rovai-skill-library");
        let source = temporary_directory("rovai-skill-source");
        let data = temporary_directory("rovai-skill-db");
        let database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let skill_path = write_skill(
            &source.join("skills").join(".curated"),
            "deep-skill",
            "deep",
        );

        let inspection = service.inspect_import(&database, &source).unwrap();

        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].name, "deep-skill");
        assert_eq!(
            inspection.candidates[0].source_path,
            skill_path.canonicalize().unwrap().display().to_string()
        );
        assert!(inspection.rejected_candidates.is_empty());
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn nested_discovery_combines_shallow_and_deep_candidates() {
        let source = temporary_directory("rovai-skill-source");
        let shallow = write_skill(&source, "shallow-skill", "shallow");
        let deep = write_skill(&source.join("category"), "deep-skill", "deep");

        let candidates = discover_source_candidates(&source)
            .unwrap()
            .into_iter()
            .collect::<BTreeSet<_>>();

        assert_eq!(candidates, BTreeSet::from([shallow, deep]));
        remove_directory_if_present(&source).unwrap();
    }

    #[test]
    fn nested_discovery_stops_below_discovered_skill_root() {
        let source = temporary_directory("rovai-skill-source");
        let outer = write_skill(&source.join("category"), "outer-skill", "outer");
        write_skill(&outer, "inner-skill", "inner");

        let candidates = discover_source_candidates(&source).unwrap();

        assert_eq!(candidates, vec![outer]);
        remove_directory_if_present(&source).unwrap();
    }

    #[test]
    fn nested_discovery_skips_ignored_directories() {
        let source = temporary_directory("rovai-skill-source");
        let valid = write_skill(
            &source.join("skills").join(".curated"),
            "valid-skill",
            "valid",
        );
        for (index, ignored) in SKILL_DISCOVERY_IGNORED_DIRECTORIES.iter().enumerate() {
            write_skill(
                &source.join(ignored).join("category"),
                &format!("ignored-skill-{index}"),
                "ignored",
            );
        }
        write_skill(
            &source.join("cmake-build-debug").join("category"),
            "ignored-cmake-skill",
            "ignored",
        );

        let candidates = discover_source_candidates(&source).unwrap();

        assert_eq!(candidates, vec![valid]);
        remove_directory_if_present(&source).unwrap();
    }

    #[test]
    fn nested_discovery_enforces_maximum_depth() {
        let source = temporary_directory("rovai-skill-source");
        let mut allowed_parent = source.clone();
        for level in 1..MAX_SKILL_DISCOVERY_DEPTH {
            allowed_parent = allowed_parent.join(format!("allowed-group-{level}"));
        }
        let allowed = write_skill(&allowed_parent, "allowed-skill", "allowed");
        let mut too_deep_parent = source.clone();
        for level in 1..=MAX_SKILL_DISCOVERY_DEPTH {
            too_deep_parent = too_deep_parent.join(format!("deep-group-{level}"));
        }
        write_skill(&too_deep_parent, "too-deep-skill", "too deep");

        let candidates = discover_source_candidates(&source).unwrap();

        assert_eq!(candidates, vec![allowed]);
        remove_directory_if_present(&source).unwrap();
    }

    #[test]
    fn nested_discovery_reports_not_found_after_bounded_scan() {
        let source = temporary_directory("rovai-skill-source");
        fs::create_dir_all(source.join("skills").join("category")).unwrap();

        let error = discover_source_candidates(&source).unwrap_err();

        assert!(error.to_string().contains("未发现可导入的 Skill"));
        assert!(error.to_string().contains("更具体的目录链接"));
        remove_directory_if_present(&source).unwrap();
    }

    #[test]
    fn official_skills_apply_management_policy_and_preserve_user_managed_changes() {
        let root = temporary_directory("rovai-skill-library");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let initial_bootstrap = service.install_bundled_skills(&mut database).unwrap();
        assert!(initial_bootstrap.changed);
        assert_eq!(initial_bootstrap.fast_path_count, 0);
        assert_eq!(initial_bootstrap.materialized_count, BUNDLED_SKILLS.len());
        assert_eq!(initial_bootstrap.repaired_count, 0);
        let unchanged_bootstrap = service.install_bundled_skills(&mut database).unwrap();
        assert!(!unchanged_bootstrap.changed);
        assert_eq!(unchanged_bootstrap.fast_path_count, BUNDLED_SKILLS.len());
        assert_eq!(unchanged_bootstrap.materialized_count, 0);
        assert_eq!(unchanged_bootstrap.repaired_count, 0);
        let skills = service.list(&database).unwrap();
        let initial_order = skills
            .iter()
            .map(|skill| skill.name.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            initial_order.iter().map(String::as_str).collect::<Vec<_>>(),
            [
                "analyze-agent-codebase",
                "campfire",
                "cli-operations",
                "diagnosing-bugs",
                "grill-duo",
                "grill-duo-with-docs",
                "member-studio",
                "memory-stewardship",
                "review-duo",
                "tasteful-ui",
                "tdd",
                "worktree",
                "writing-for-agents"
            ]
        );
        assert!(skills.iter().all(|skill| skill.enabled));
        assert!(skills.iter().all(|skill| {
            skill.management_policy
                == if matches!(skill.name.as_str(), "cli-operations" | "memory-stewardship") {
                    SkillManagementPolicy::SystemRequired
                } else {
                    SkillManagementPolicy::UserManaged
                }
        }));
        let all_groups = SkillDeliveryGroupKey::ALL
            .into_iter()
            .collect::<BTreeSet<_>>();
        assert!(skills.iter().all(|skill| {
            skill
                .group_assignments
                .iter()
                .map(|assignment| assignment.group_key)
                .collect::<BTreeSet<_>>()
                == all_groups
        }));
        for definition in BUNDLED_SKILLS {
            let skill = skills
                .iter()
                .find(|skill| skill.name == definition.name)
                .unwrap();
            assert_bundled_skill_materialized(&service, skill, definition);
        }
        let diagnosing_bugs = skills
            .iter()
            .find(|skill| skill.name == "diagnosing-bugs")
            .unwrap();
        assert_eq!(
            diagnosing_bugs
                .current_revision
                .risk_summary
                .script_file_count,
            1
        );
        assert_eq!(
            diagnosing_bugs
                .current_revision
                .risk_summary
                .executable_file_count,
            0
        );
        let memory_stewardship = skills
            .iter()
            .find(|skill| skill.name == "memory-stewardship")
            .unwrap();
        let content = service.revision_content_path(
            &memory_stewardship.id,
            &memory_stewardship.current_revision.id,
        );
        fs::write(content.join("SKILL.md"), "corrupted by local edit").unwrap();
        let repair_bootstrap = service.install_bundled_skills(&mut database).unwrap();
        assert!(repair_bootstrap.changed);
        assert_eq!(repair_bootstrap.fast_path_count, BUNDLED_SKILLS.len() - 1);
        assert_eq!(repair_bootstrap.materialized_count, 1);
        assert_eq!(repair_bootstrap.repaired_count, 1);
        assert_eq!(
            fs::read(content.join("SKILL.md")).unwrap(),
            MEMORY_STEWARDSHIP_RULES.as_bytes()
        );
        let repair_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE event_type = 'skill.bundled_repaired'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(repair_count, 1);
        let worktree = service
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "worktree")
            .unwrap();
        let disable = user_envelope(
            "disable-user-managed-official",
            SetSkillEnabledCommand {
                skill_id: worktree.id.clone(),
                expected_version: worktree.version,
                enabled: false,
            },
        );
        let disable_result = service.set_enabled(&mut database, &disable).unwrap();
        assert_eq!(
            disable_result.result.payload["version"],
            worktree.version + 1
        );
        let disabled = service.get(&database, &worktree.id).unwrap().unwrap();
        service
            .set_group_assignments(
                &mut database,
                &user_envelope(
                    "remove-one-user-managed-official-group",
                    SetSkillGroupAssignmentsCommand {
                        skill_id: worktree.id.clone(),
                        expected_version: disabled.version,
                        group_keys: SkillDeliveryGroupKey::ALL
                            .into_iter()
                            .filter(|group| *group != SkillDeliveryGroupKey::Qwen)
                            .collect(),
                    },
                ),
            )
            .unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let refreshed = service.get(&database, &worktree.id).unwrap().unwrap();
        assert!(!refreshed.enabled);
        assert_eq!(
            refreshed.group_assignments.len(),
            SkillDeliveryGroupKey::ALL.len() - 1
        );
        assert!(
            refreshed
                .group_assignments
                .iter()
                .all(|assignment| assignment.group_key != SkillDeliveryGroupKey::Qwen)
        );

        for required_name in ["cli-operations", "memory-stewardship"] {
            let required = service
                .list(&database)
                .unwrap()
                .into_iter()
                .find(|skill| skill.name == required_name)
                .unwrap();
            let disable_required = service
                .set_enabled(
                    &mut database,
                    &user_envelope(
                        &format!("disable-{required_name}"),
                        SetSkillEnabledCommand {
                            skill_id: required.id.clone(),
                            expected_version: required.version,
                            enabled: false,
                        },
                    ),
                )
                .unwrap();
            assert_eq!(disable_required.result.code, "skill_configuration_locked");
            let reassign_required = service
                .set_group_assignments(
                    &mut database,
                    &user_envelope(
                        &format!("reassign-{required_name}"),
                        SetSkillGroupAssignmentsCommand {
                            skill_id: required.id.clone(),
                            expected_version: required.version,
                            group_keys: vec![],
                        },
                    ),
                )
                .unwrap();
            assert_eq!(reassign_required.result.code, "skill_configuration_locked");
            database
                .connection()
                .execute("UPDATE skill SET enabled = 0 WHERE id = ?1", [&required.id])
                .unwrap();
            database
                .connection()
                .execute(
                    "DELETE FROM skill_group_assignment WHERE skill_id = ?1 AND group_key = 'qwen'",
                    [&required.id],
                )
                .unwrap();
        }
        service.install_bundled_skills(&mut database).unwrap();
        for required_name in ["cli-operations", "memory-stewardship"] {
            let required = service
                .list(&database)
                .unwrap()
                .into_iter()
                .find(|skill| skill.name == required_name)
                .unwrap();
            assert!(required.enabled);
            assert_eq!(
                required.management_policy,
                SkillManagementPolicy::SystemRequired
            );
            assert_eq!(
                required
                    .group_assignments
                    .iter()
                    .map(|assignment| assignment.group_key)
                    .collect::<BTreeSet<_>>(),
                all_groups
            );
        }
        let restore_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE event_type = 'skill.system_configuration_restored'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restore_count, 2);
        assert_eq!(
            service
                .list(&database)
                .unwrap()
                .into_iter()
                .map(|skill| skill.name)
                .collect::<Vec<_>>(),
            initial_order
        );
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn prefixed_official_skill_names_are_stripped_in_place() {
        let root = temporary_directory("rovai-skill-library");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let original = service
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "memory-stewardship")
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE skill SET name = 'rovai-memory-stewardship' WHERE id = ?1",
                [&original.id],
            )
            .unwrap();

        service.install_bundled_skills(&mut database).unwrap();

        let skills = service.list(&database).unwrap();
        assert_eq!(skills.len(), 13);
        assert!(skills.iter().all(|skill| !skill.name.starts_with("rovai-")));
        let restored = skills
            .iter()
            .find(|skill| skill.name == "memory-stewardship")
            .unwrap();
        assert_eq!(restored.id, original.id);
        assert_eq!(restored.current_revision.id, original.current_revision.id);
        let rename_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE event_type = 'skill.official_name_changed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rename_count, 1);
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn reveal_location_resolves_only_the_verified_managed_revision() {
        let root = temporary_directory("rovai-skill-library");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let skill = service.list(&database).unwrap().remove(0);

        let location = service.reveal_location(&database, &skill.id).unwrap();

        assert!(location.starts_with(root.canonicalize().unwrap()));
        assert!(location.join("SKILL.md").is_file());
        fs::write(location.join("SKILL.md"), "tampered").unwrap();
        assert!(service.reveal_location(&database, &skill.id).is_err());
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn bootstrap_promotes_a_preexisting_import_when_inventory_claims_its_name() {
        let root = temporary_directory("rovai-skill-library");
        let source = temporary_directory("rovai-skill-source");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let definition = BUNDLED_SKILLS
            .iter()
            .find(|definition| definition.name == "member-studio")
            .unwrap();
        let imported_path = source.join("member-studio");
        materialize_bundled_definition(&imported_path, definition).unwrap();
        let inspection = service.inspect_import(&database, &imported_path).unwrap();
        let candidate = &inspection.candidates[0];
        service
            .commit_import(
                &mut database,
                &user_envelope(
                    "import-member-studio-before-bundle",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token.clone(),
                        candidate_name: candidate.name.clone(),
                        expected_digest: candidate.content_digest.clone(),
                        expected_skill_version: candidate.existing_skill_version,
                        confirm_update: false,
                    },
                ),
            )
            .unwrap();
        let imported = service
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "member-studio")
            .unwrap();
        assert_eq!(imported.origin, SkillOrigin::Imported);

        service.install_bundled_skills(&mut database).unwrap();

        let promoted = service
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "member-studio")
            .unwrap();
        assert_eq!(promoted.id, imported.id);
        assert_eq!(promoted.origin, SkillOrigin::Official);
        assert_ne!(promoted.current_revision.id, imported.current_revision.id);
        assert_eq!(
            promoted.current_revision.source_type,
            SkillRevisionSourceType::Bundled
        );
        let promotion_events: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE event_type = 'skill.import_promoted_to_official'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(promotion_events, 1);
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn imports_cannot_claim_an_official_name_even_with_identical_content() {
        let root = temporary_directory("rovai-skill-library");
        let source = temporary_directory("rovai-skill-source");
        let data = temporary_directory("rovai-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let memory_stewardship_definition = BUNDLED_SKILLS
            .iter()
            .find(|definition| definition.name == "memory-stewardship")
            .unwrap();
        materialize_bundled_definition(
            &source.join("memory-stewardship"),
            memory_stewardship_definition,
        )
        .unwrap();

        let inspection = service
            .inspect_import(&database, &source.join("memory-stewardship"))
            .unwrap();
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.import_action, "official_conflict");
        let result = service
            .commit_import(
                &mut database,
                &user_envelope(
                    "import-bundled-name",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token.clone(),
                        candidate_name: candidate.name.clone(),
                        expected_digest: candidate.content_digest.clone(),
                        expected_skill_version: candidate.existing_skill_version,
                        confirm_update: true,
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.code, "official_skill_name_conflict");
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn startup_gc_removes_only_uuid_shaped_orphan_revision_directories() {
        let root = temporary_directory("rovai-skill-library");
        let data = temporary_directory("rovai-skill-db");
        let database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let orphan_skill_id = Uuid::new_v4().to_string();
        let orphan_revision_id = Uuid::new_v4().to_string();
        let orphan = root
            .join("revisions")
            .join(&orphan_skill_id)
            .join(&orphan_revision_id);
        fs::create_dir_all(&orphan).unwrap();
        fs::write(orphan.join("SKILL.md"), "orphan").unwrap();
        let unmanaged = root.join("revisions").join("notes").join("keep-me");
        fs::create_dir_all(&unmanaged).unwrap();

        assert_eq!(service.cleanup_orphan_revisions(&database).unwrap(), 1);
        assert!(!orphan.exists());
        assert!(unmanaged.exists());
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }
}
