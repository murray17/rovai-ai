use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

pub const MAX_SKILL_FILES: usize = 1_000;
pub const MAX_SKILL_DEPTH: usize = 32;
pub const MAX_SKILL_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_SKILL_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
const STAGING_TTL: Duration = Duration::from_secs(30 * 60);

const GRILLING_RULES: &str = include_str!("../../../resources/skills/grill-me/SKILL.md");
const GRILL_ME_OPENAI: &str = include_str!("../../../resources/skills/grill-me/agents/openai.yaml");
const GRILL_WITH_DOCS_RULES: &str =
    include_str!("../../../resources/skills/grill-with-docs/SKILL.md");
const GRILL_WITH_DOCS_OPENAI: &str =
    include_str!("../../../resources/skills/grill-with-docs/agents/openai.yaml");
const GRILL_WITH_DOCS_GRILLING: &str =
    include_str!("../../../resources/skills/grill-with-docs/references/grilling.md");
const GRILL_WITH_DOCS_DOMAIN_MODELING: &str =
    include_str!("../../../resources/skills/grill-with-docs/references/domain-modeling.md");
const GRILL_WITH_DOCS_CONTEXT_FORMAT: &str =
    include_str!("../../../resources/skills/grill-with-docs/references/CONTEXT-FORMAT.md");
const GRILL_WITH_DOCS_ADR_FORMAT: &str =
    include_str!("../../../resources/skills/grill-with-docs/references/ADR-FORMAT.md");
const MEMORY_STEWARDSHIP_RULES: &str =
    include_str!("../../../resources/skills/memory-stewardship/SKILL.md");
const MEMORY_STEWARDSHIP_OPENAI: &str =
    include_str!("../../../resources/skills/memory-stewardship/agents/openai.yaml");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSourceKind {
    Bundled,
    Imported,
}

impl SkillSourceKind {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "bundled" => Ok(Self::Bundled),
            "imported" => Ok(Self::Imported),
            _ => anyhow::bail!("unknown Skill source kind: {value}"),
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
    pub name: String,
    pub description: String,
    pub content_digest: String,
    pub source_metadata: Value,
    pub risk_summary: SkillRiskSummary,
    pub file_count: i64,
    pub total_bytes: i64,
    pub installed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub source_kind: SkillSourceKind,
    pub enabled: bool,
    pub lifecycle_status: String,
    pub current_revision: SkillRevisionView,
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
    pub existing_source_kind: Option<SkillSourceKind>,
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

#[derive(Debug, Clone)]
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
    source_kind: SkillSourceKind,
    enabled: bool,
    lifecycle_status: String,
    current_revision_id: String,
    current_digest: String,
    version: i64,
}

#[derive(Debug, Clone)]
struct BundledDefinition {
    name: &'static str,
    files: &'static [(&'static str, &'static str, u32)],
}

const GRILL_ME_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", GRILLING_RULES, 0o644),
    ("agents/openai.yaml", GRILL_ME_OPENAI, 0o644),
];
const GRILL_WITH_DOCS_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", GRILL_WITH_DOCS_RULES, 0o644),
    ("agents/openai.yaml", GRILL_WITH_DOCS_OPENAI, 0o644),
    ("references/grilling.md", GRILL_WITH_DOCS_GRILLING, 0o644),
    (
        "references/domain-modeling.md",
        GRILL_WITH_DOCS_DOMAIN_MODELING,
        0o644,
    ),
    (
        "references/CONTEXT-FORMAT.md",
        GRILL_WITH_DOCS_CONTEXT_FORMAT,
        0o644,
    ),
    (
        "references/ADR-FORMAT.md",
        GRILL_WITH_DOCS_ADR_FORMAT,
        0o644,
    ),
];
const MEMORY_STEWARDSHIP_FILES: &[(&str, &str, u32)] = &[
    ("SKILL.md", MEMORY_STEWARDSHIP_RULES, 0o644),
    ("agents/openai.yaml", MEMORY_STEWARDSHIP_OPENAI, 0o644),
];

const BUNDLED_SKILLS: &[BundledDefinition] = &[
    BundledDefinition {
        name: "grill-me",
        files: GRILL_ME_FILES,
    },
    BundledDefinition {
        name: "grill-with-docs",
        files: GRILL_WITH_DOCS_FILES,
    },
    BundledDefinition {
        name: "memory-stewardship",
        files: MEMORY_STEWARDSHIP_FILES,
    },
];

pub struct SkillLibraryService {
    root: PathBuf,
    gateway: DomainCommandGateway,
}

impl SkillLibraryService {
    pub fn default_root() -> Result<PathBuf> {
        #[cfg(debug_assertions)]
        if let Some(root) = std::env::var_os("LUMEN_SKILL_LIBRARY_ROOT") {
            return Ok(PathBuf::from(root));
        }
        dirs::home_dir()
            .map(|path| path.join(".lumen").join("skills"))
            .context("could not determine the home directory for ~/.lumen/skills")
    }

    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join(".staging"))
            .with_context(|| format!("failed to create Skill Library at {}", root.display()))?;
        restrict_private_directory(&root)?;
        restrict_private_directory(&root.join(".staging"))?;
        Ok(Self {
            root,
            gateway: DomainCommandGateway,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&self, database: &Database) -> Result<Vec<SkillView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT skill.id, skill.name, skill.source_kind, skill.enabled,
                   skill.lifecycle_status, skill.version, skill.created_at,
                   skill.updated_at, skill.deletion_requested_at,
                   revision.id, revision.name, revision.description,
                   revision.content_digest, revision.source_metadata_json,
                   revision.risk_summary_json, revision.file_count,
                   revision.total_bytes, revision.installed_at
            FROM skill
            JOIN skill_revision AS revision
              ON revision.id = skill.current_revision_id
            ORDER BY CASE skill.source_kind WHEN 'bundled' THEN 0 ELSE 1 END,
                     skill.name
            "#,
        )?;
        statement
            .query_map([], skill_view_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get(&self, database: &Database, skill_id: &str) -> Result<Option<SkillView>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT skill.id, skill.name, skill.source_kind, skill.enabled,
                       skill.lifecycle_status, skill.version, skill.created_at,
                       skill.updated_at, skill.deletion_requested_at,
                       revision.id, revision.name, revision.description,
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
            .map_err(Into::into)
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
        fs::create_dir_all(staging_root.join("candidates"))?;
        restrict_private_directory(&staging_root)?;
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
            candidates,
            rejected_candidates,
        };
        write_json_atomically(&staging_root.join("inspection.json"), &manifest)?;
        self.inspection_view(database, manifest)
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
            if existing.source_kind == SkillSourceKind::Bundled {
                let result = self.gateway.execute(database, envelope, |_| {
                    Ok(CommandHandlerResult::rejected(
                        "bundled_skill_name_conflict",
                        json!({
                            "message": "用户导入不能覆盖 Lumen Bundled Skill。",
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
            "sourcePath": staged.source_path,
            "inspectionSourcePath": manifest.source_path,
            "importedAt": Utc::now().to_rfc3339(),
        });
        let now = Utc::now().to_rfc3339();
        let existing_id = existing.as_ref().map(|value| value.id.clone());
        let existing_version = existing.as_ref().map(|value| value.version);
        let skill_id_for_handler = skill_id.clone();
        let revision_id_for_handler = revision_id.clone();
        let staged_for_handler = staged.clone();
        let execution = self.gateway.execute(database, envelope, |transaction| {
            if let Some(existing_id) = &existing_id {
                let changed = transaction.execute(
                    r#"
                    UPDATE skill
                    SET current_revision_id = ?1, version = version + 1,
                        updated_at = ?2
                    WHERE id = ?3 AND version = ?4
                      AND source_kind = 'imported'
                      AND lifecycle_status = 'active'
                    "#,
                    params![revision_id_for_handler, now, existing_id, existing_version,],
                )?;
                if changed != 1 {
                    anyhow::bail!("Skill changed while publishing its Revision");
                }
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    existing_id,
                    &staged_for_handler,
                    &source_metadata,
                    &now,
                )?;
            } else {
                transaction.execute(
                    r#"
                    INSERT INTO skill(
                        id, name, source_kind, enabled, lifecycle_status,
                        current_revision_id, version, created_at, updated_at
                    ) VALUES (?1, ?2, 'imported', 0, 'active', NULL, 1, ?3, ?3)
                    "#,
                    params![skill_id_for_handler, staged_for_handler.name, now],
                )?;
                insert_revision(
                    transaction,
                    &revision_id_for_handler,
                    &skill_id_for_handler,
                    &staged_for_handler,
                    &source_metadata,
                    &now,
                )?;
                transaction.execute(
                    "UPDATE skill SET current_revision_id = ?1 WHERE id = ?2",
                    params![revision_id_for_handler, skill_id_for_handler],
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
                    "sourceKind": "imported",
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
                    "enabled": existing.as_ref().map(|value| value.enabled).unwrap_or(false),
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
                    "SELECT source_kind, enabled, lifecycle_status, version FROM skill WHERE id = ?1",
                    [&envelope.payload.skill_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, bool>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((_source_kind, current_enabled, lifecycle_status, version)) = current else {
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
                    "unchanged": current_enabled == envelope.payload.enabled,
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
                    "SELECT source_kind, lifecycle_status, version FROM skill WHERE id = ?1",
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
            let Some((source_kind, lifecycle_status, version)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "skill_missing",
                    json!({"message": "Skill 不存在。"}),
                ));
            };
            if source_kind == "bundled" {
                return Ok(CommandHandlerResult::rejected(
                    "bundled_skill_delete_forbidden",
                    json!({"message": "Lumen Bundled Skill 不能删除。"}),
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

    pub fn install_bundled_skills(&self, database: &mut Database) -> Result<()> {
        for definition in BUNDLED_SKILLS {
            let token = format!("bundled-{}-{}", definition.name, Uuid::new_v4());
            let staging_root = self.root.join(".staging").join(token);
            let source = staging_root.join(definition.name);
            materialize_bundled_definition(&source, definition)?;
            let verified = stage_candidate(
                &source,
                definition.name,
                &staging_root.join(format!(".verify-{}", definition.name)),
            )?;
            let existing = load_existing_skill_by_name(database, definition.name)?;
            if let Some(existing) = &existing
                && existing.source_kind != SkillSourceKind::Bundled
            {
                anyhow::bail!(
                    "Imported Skill {} conflicts with a required Bundled Skill",
                    definition.name
                );
            }
            if existing
                .as_ref()
                .is_some_and(|value| value.current_digest == verified.content_digest)
            {
                let existing = existing
                    .as_ref()
                    .context("Bundled Skill disappeared during verification")?;
                let current_content =
                    self.revision_content_path(&existing.id, &existing.current_revision_id);
                if self
                    .verify_revision_identity(
                        &existing.id,
                        &existing.current_revision_id,
                        definition.name,
                        &existing.current_digest,
                    )
                    .is_err()
                {
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
                }
                remove_directory_if_present(&staging_root)?;
                continue;
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
            let source_metadata = json!({
                "bundled": true,
                "appVersion": env!("CARGO_PKG_VERSION"),
            });
            let existing_id = existing.as_ref().map(|value| value.id.clone());
            let existing_version = existing.as_ref().map(|value| value.version);
            let verified_for_handler = StagedCandidate {
                name: verified.name,
                description: verified.description,
                content_digest: verified.content_digest,
                risk_summary: verified.risk_summary,
                file_count: verified.file_count,
                total_bytes: verified.total_bytes,
                source_path: "lumen://bundled".to_string(),
                relative_content_path: String::new(),
            };
            let skill_id_for_handler = skill_id.clone();
            let revision_id_for_handler = revision_id.clone();
            let result = self.gateway.execute(database, &envelope, |transaction| {
                if let Some(existing_id) = &existing_id {
                    transaction.execute(
                        r#"
                        UPDATE skill
                        SET current_revision_id = ?1, version = version + 1,
                            updated_at = ?2
                        WHERE id = ?3 AND version = ?4 AND source_kind = 'bundled'
                        "#,
                        params![revision_id_for_handler, now, existing_id, existing_version],
                    )?;
                    insert_revision(
                        transaction,
                        &revision_id_for_handler,
                        existing_id,
                        &verified_for_handler,
                        &source_metadata,
                        &now,
                    )?;
                } else {
                    transaction.execute(
                        r#"
                        INSERT INTO skill(
                            id, name, source_kind, enabled, lifecycle_status,
                            current_revision_id, version, created_at, updated_at
                        ) VALUES (?1, ?2, 'bundled', 1, 'active', NULL, 1, ?3, ?3)
                        "#,
                        params![skill_id_for_handler, verified_for_handler.name, now],
                    )?;
                    insert_revision(
                        transaction,
                        &revision_id_for_handler,
                        &skill_id_for_handler,
                        &verified_for_handler,
                        &source_metadata,
                        &now,
                    )?;
                    transaction.execute(
                        "UPDATE skill SET current_revision_id = ?1 WHERE id = ?2",
                        params![revision_id_for_handler, skill_id_for_handler],
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
                        "sourceKind": "bundled",
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
                let _ =
                    remove_directory_if_present(final_content.parent().unwrap_or(&final_content));
            }
            result?;
            remove_directory_if_present(&staging_root)?;
        }
        Ok(())
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
        for skill_entry in fs::read_dir(&self.root)? {
            let skill_entry = skill_entry?;
            let skill_metadata = fs::symlink_metadata(skill_entry.path())?;
            if !skill_metadata.file_type().is_dir() {
                continue;
            }
            let skill_id = skill_entry.file_name().to_string_lossy().to_string();
            if Uuid::parse_str(&skill_id).is_err() {
                continue;
            }
            let revisions_root = skill_entry.path().join("revisions");
            let revisions_metadata = match fs::symlink_metadata(&revisions_root) {
                Ok(metadata) if metadata.file_type().is_dir() => metadata,
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let _ = revisions_metadata;
            for revision_entry in fs::read_dir(&revisions_root)? {
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
            let _ = fs::remove_dir(&revisions_root);
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

    pub(crate) fn remove_skill_content(&self, skill_id: &str) -> Result<()> {
        validate_stable_id(skill_id, "Skill ID")?;
        remove_directory_if_present(&self.root.join(skill_id))
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
                    Some(value) if value.source_kind == SkillSourceKind::Bundled => {
                        "bundled_conflict"
                    }
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
                    existing_source_kind: existing.map(|value| value.source_kind),
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
        self.root
            .join(skill_id)
            .join("revisions")
            .join(revision_id)
            .join("content")
    }
}

fn skill_view_from_row(row: &Row<'_>) -> rusqlite::Result<SkillView> {
    let skill_id = row.get::<_, String>(0)?;
    let source_kind_value = row.get::<_, String>(2)?;
    let source_metadata_json = row.get::<_, String>(13)?;
    let risk_summary_json = row.get::<_, String>(14)?;
    Ok(SkillView {
        id: skill_id.clone(),
        name: row.get(1)?,
        source_kind: SkillSourceKind::parse(&source_kind_value).map_err(anyhow_to_sql_error)?,
        enabled: row.get(3)?,
        lifecycle_status: row.get(4)?,
        version: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deletion_requested_at: row.get(8)?,
        current_revision: SkillRevisionView {
            id: row.get(9)?,
            skill_id,
            name: row.get(10)?,
            description: row.get(11)?,
            content_digest: row.get(12)?,
            source_metadata: serde_json::from_str(&source_metadata_json).map_err(to_sql_error)?,
            risk_summary: serde_json::from_str(&risk_summary_json).map_err(to_sql_error)?,
            file_count: row.get(15)?,
            total_bytes: row.get(16)?,
            installed_at: row.get(17)?,
        },
    })
}

fn load_existing_skill_by_name(database: &Database, name: &str) -> Result<Option<ExistingSkill>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT skill.id, skill.source_kind, skill.enabled, skill.lifecycle_status,
                   skill.current_revision_id, revision.content_digest, skill.version
            FROM skill
            JOIN skill_revision AS revision ON revision.id = skill.current_revision_id
            WHERE skill.name = ?1
            "#,
            [name],
            |row| {
                let source_kind = row.get::<_, String>(1)?;
                Ok(ExistingSkill {
                    id: row.get(0)?,
                    source_kind: SkillSourceKind::parse(&source_kind)
                        .map_err(anyhow_to_sql_error)?,
                    enabled: row.get(2)?,
                    lifecycle_status: row.get(3)?,
                    current_revision_id: row.get(4)?,
                    current_digest: row.get(5)?,
                    version: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn insert_revision(
    transaction: &Transaction<'_>,
    revision_id: &str,
    skill_id: &str,
    candidate: &StagedCandidate,
    source_metadata: &Value,
    installed_at: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO skill_revision(
            id, skill_id, name, description, content_digest,
            source_metadata_json, risk_summary_json, file_count,
            total_bytes, installed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            revision_id,
            skill_id,
            candidate.name,
            candidate.description,
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
            agent_profile_id,
            source_agent_run_id,
        } => (
            "agent",
            agent_profile_id.as_str(),
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

fn discover_source_candidates(selected_path: &Path) -> Result<Vec<PathBuf>> {
    if fs::symlink_metadata(selected_path.join("SKILL.md"))
        .is_ok_and(|metadata| metadata.file_type().is_file())
    {
        return Ok(vec![selected_path.to_path_buf()]);
    }
    let mut candidates = Vec::new();
    for entry in fs::read_dir(selected_path)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_dir()
            && fs::symlink_metadata(entry.path().join("SKILL.md"))
                .is_ok_and(|skill| skill.file_type().is_file())
        {
            candidates.push(entry.path());
        }
    }
    candidates.sort();
    if candidates.is_empty() {
        anyhow::bail!(
            "Selected directory is neither a Skill nor a collection with first-level Skills"
        );
    }
    Ok(candidates)
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
    fs::create_dir_all(destination)?;
    restrict_private_directory(destination)?;
    let mut collector = CandidateCollector::default();
    copy_candidate_tree(source, destination, Path::new(""), 0, &mut collector)?;
    candidate_snapshot(destination, expected_name, collector)
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
    mut collector: CandidateCollector,
) -> Result<CandidateSnapshot> {
    let skill_md = content_root.join("SKILL.md");
    if !skill_md.is_file() {
        anyhow::bail!("Skill directory must contain a regular SKILL.md");
    }
    let skill_text = fs::read_to_string(&skill_md).context("SKILL.md must be valid UTF-8 text")?;
    let frontmatter = parse_skill_frontmatter(&skill_text)?;
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

fn digest_records(records: &[FileDigestRecord]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"lumen-skill-revision-v1\0");
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

fn validate_skill_name(name: &str) -> Result<()> {
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

fn publish_directory(source: &Path, final_content: &Path) -> Result<()> {
    if final_content.exists() {
        anyhow::bail!("Skill Revision destination already exists");
    }
    let revision_dir = final_content
        .parent()
        .context("Skill Revision destination has no parent")?;
    fs::create_dir_all(revision_dir)?;
    fs::rename(source, final_content).with_context(|| {
        format!(
            "failed to publish Skill Revision from {} to {}",
            source.display(),
            final_content.display()
        )
    })?;
    Ok(())
}

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

fn validate_staging_token(token: &str) -> Result<()> {
    Uuid::parse_str(token).context("Skill import staging token is invalid")?;
    Ok(())
}

fn validate_stable_id(value: &str, label: &str) -> Result<()> {
    Uuid::parse_str(value).with_context(|| format!("{label} is invalid"))?;
    Ok(())
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().context("JSON path has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(value)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn restrict_private_directory(path: &Path) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("failed to restrict {}", path.display()))
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

#[cfg(test)]
mod tests {
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

    #[test]
    fn imports_are_staged_disabled_and_updates_create_revisions() {
        let root = temporary_directory("lumen-skill-library");
        let source = temporary_directory("lumen-skill-source");
        let data = temporary_directory("lumen-skill-db");
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
        assert!(!first.enabled);

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
                        expected_skill_version: Some(first.version),
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
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn collection_import_rejects_symlinks_without_losing_valid_candidates() {
        let root = temporary_directory("lumen-skill-library");
        let source = temporary_directory("lumen-skill-source");
        let data = temporary_directory("lumen-skill-db");
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
    fn bundled_skills_are_self_contained_and_preserve_user_disable() {
        let root = temporary_directory("lumen-skill-library");
        let data = temporary_directory("lumen-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let skills = service.list(&database).unwrap();
        assert_eq!(
            skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            ["grill-me", "grill-with-docs", "memory-stewardship"]
        );
        assert!(skills.iter().all(|skill| skill.enabled));
        let grill_with_docs = skills
            .iter()
            .find(|skill| skill.name == "grill-with-docs")
            .unwrap();
        let content = service
            .revision_content_path(&grill_with_docs.id, &grill_with_docs.current_revision.id);
        assert!(content.join("references/domain-modeling.md").is_file());
        fs::write(content.join("SKILL.md"), "corrupted by local edit").unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        assert!(
            fs::read_to_string(content.join("SKILL.md"))
                .unwrap()
                .contains("name: grill-with-docs")
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
        let disable = user_envelope(
            "disable-bundled",
            SetSkillEnabledCommand {
                skill_id: grill_with_docs.id.clone(),
                expected_version: grill_with_docs.version,
                enabled: false,
            },
        );
        service.set_enabled(&mut database, &disable).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        let refreshed = service
            .get(&database, &grill_with_docs.id)
            .unwrap()
            .unwrap();
        assert!(!refreshed.enabled);
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn reveal_location_resolves_only_the_verified_managed_revision() {
        let root = temporary_directory("lumen-skill-library");
        let data = temporary_directory("lumen-skill-db");
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
    fn imports_cannot_claim_a_bundled_name_even_with_identical_content() {
        let root = temporary_directory("lumen-skill-library");
        let source = temporary_directory("lumen-skill-source");
        let data = temporary_directory("lumen-skill-db");
        let mut database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        service.install_bundled_skills(&mut database).unwrap();
        materialize_bundled_definition(&source.join("grill-me"), &BUNDLED_SKILLS[0]).unwrap();

        let inspection = service
            .inspect_import(&database, &source.join("grill-me"))
            .unwrap();
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.import_action, "bundled_conflict");
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
        assert_eq!(result.result.code, "bundled_skill_name_conflict");
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&source).unwrap();
        remove_directory_if_present(&data).unwrap();
    }

    #[test]
    fn startup_gc_removes_only_uuid_shaped_orphan_revision_directories() {
        let root = temporary_directory("lumen-skill-library");
        let data = temporary_directory("lumen-skill-db");
        let database = Database::open(&data).unwrap();
        let service = SkillLibraryService::new(root.clone()).unwrap();
        let orphan_skill_id = Uuid::new_v4().to_string();
        let orphan_revision_id = Uuid::new_v4().to_string();
        let orphan = root
            .join(&orphan_skill_id)
            .join("revisions")
            .join(&orphan_revision_id);
        fs::create_dir_all(orphan.join("content")).unwrap();
        fs::write(orphan.join("content/SKILL.md"), "orphan").unwrap();
        let unmanaged = root.join("notes").join("revisions").join("keep-me");
        fs::create_dir_all(&unmanaged).unwrap();

        assert_eq!(service.cleanup_orphan_revisions(&database).unwrap(), 1);
        assert!(!orphan.exists());
        assert!(unmanaged.exists());
        remove_directory_if_present(&root).unwrap();
        remove_directory_if_present(&data).unwrap();
    }
}
