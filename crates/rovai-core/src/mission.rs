//! Mission definition authority. Execution, membership and messages remain owned by Camp.
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    camp_id::CampId,
    collaboration::{
        CampActivationState, CampCollaborationMode, CreateCampCommand, ProjectBindingKind,
        actor_can_write_camp, admit_mission_start, append_domain_event, create_camp_in_tx,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, CommandResultStatus,
        DomainCommand, DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    local_attachment_snapshot::DIRECTORY_MEDIA_TYPE,
    local_attachment_source::{
        LocalAttachmentAvailability, LocalAttachmentSourceRef, LocalAttachmentSourceView,
        parse_source_attachments, serialize_source_attachments,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionStatus {
    NeedsYou,
    NotStarted,
    InProgress,
    Completed,
}

pub const MISSION_LIST_DEFAULT_LIMIT: usize = 20;
pub const MISSION_LIST_MAX_LIMIT: usize = 50;

#[derive(Debug)]
pub struct MissionAgentInputError {
    code: &'static str,
    message: &'static str,
}

impl MissionAgentInputError {
    fn invalid_query() -> Self {
        Self {
            code: "mission.invalid_input",
            message: "Mission list query is invalid",
        }
    }

    fn invalid_limit() -> Self {
        Self {
            code: "mission.invalid_input",
            message: "Mission list limit must be between 1 and 50",
        }
    }

    fn invalid_cursor() -> Self {
        Self {
            code: "mission.invalid_cursor",
            message: "Mission list cursor is invalid or does not match the filters",
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn message(&self) -> &'static str {
        self.message
    }
}

impl std::fmt::Display for MissionAgentInputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MissionAgentInputError {}
impl MissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NeedsYou => "needs_you",
            Self::NotStarted => "not_started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionFacts {
    pub mission_id: String,
    pub title: String,
    pub status: MissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_notice: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionInfo {
    pub mission_id: String,
    pub title: String,
    pub description: String,
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionAgentInfo {
    pub mission_id: String,
    pub title: String,
    pub description: String,
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
    pub attachments: Vec<MissionAgentAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionAgentAttachment {
    pub attachment_id: String,
    pub name: String,
    pub kind: String,
    pub file_count: Option<u64>,
    pub media_type: Option<String>,
    pub byte_size: Option<u64>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionListItem {
    pub mission_id: String,
    pub camp_id: String,
    pub title: String,
    pub status: MissionStatus,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionListPage {
    pub missions: Vec<MissionListItem>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionRecord {
    #[serde(flatten)]
    pub info: MissionInfo,
    pub number: i64,
    pub camp_id: String,
    pub project_path: String,
    pub project_binding_kind: ProjectBindingKind,
    pub details_version: i64,
    pub tags: Vec<String>,
    pub attachments: Vec<LocalAttachmentSourceView>,
    #[serde(skip)]
    pub source_attachments: Vec<LocalAttachmentSourceRef>,
    pub created_at: String,
    pub updated_at: String,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: Option<String>,
    pub running_agent_ids: Vec<String>,
    pub start_available: bool,
    pub has_unread: bool,
    pub workspace_ever_created: bool,
    pub workspace_resources_present: bool,
    pub cleanup_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_cleanup: Option<crate::mission_workspace::MissionWorkspaceCleanupProjection>,
}

impl MissionRecord {
    pub fn agent_info(&self) -> MissionAgentInfo {
        MissionAgentInfo {
            mission_id: self.info.mission_id.clone(),
            title: self.info.title.clone(),
            description: self.info.description.clone(),
            status: self.info.status,
            source_message_id: self.info.source_message_id.clone(),
            attachments: self
                .source_attachments
                .iter()
                .map(|source| MissionAgentAttachment {
                    attachment_id: source.id.clone(),
                    name: source.display_name.clone(),
                    kind: source.kind.as_str().to_string(),
                    file_count: (source.kind
                        == crate::local_attachment_source::LocalAttachmentKind::File)
                        .then_some(1),
                    media_type: source.media_type.clone(),
                    byte_size: source.observed_byte_size,
                    path: source.source_path.clone(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMissionCommand {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub project_path: String,
    pub project_binding_kind: ProjectBindingKind,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_deserializing, skip_serializing_if = "Vec::is_empty")]
    pub source_attachments: Vec<LocalAttachmentSourceRef>,
}
impl sealed::Sealed for CreateMissionCommand {}
impl DomainCommand for CreateMissionCommand {
    const TYPE: &'static str = "mission.create";
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionGetInput {
    pub mission_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionListInput {
    pub query: Option<String>,
    pub status: Option<MissionStatus>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissionListCursor {
    schema_version: u8,
    query: Option<String>,
    status: Option<MissionStatus>,
    before_number: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionUpdateInput {
    pub title: Option<String>,
    pub description: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMissionCommand {
    pub mission_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub expected_details_version: Option<i64>,
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub source_attachment_update: Option<MissionAttachmentUpdate>,
}
impl sealed::Sealed for UpdateMissionCommand {}
impl DomainCommand for UpdateMissionCommand {
    const TYPE: &'static str = "mission.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionAttachmentUpdate {
    pub keep_attachment_ids: Vec<String>,
    pub new_source_attachments: Vec<LocalAttachmentSourceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionStatusInput {
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusMissionCommand {
    pub mission_id: String,
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}
impl sealed::Sealed for StatusMissionCommand {}
impl DomainCommand for StatusMissionCommand {
    const TYPE: &'static str = "mission.status";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartMissionCommand {
    pub mission_id: String,
}
impl sealed::Sealed for StartMissionCommand {}
impl DomainCommand for StartMissionCommand {
    const TYPE: &'static str = "mission.start";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupMissionWorkspaceCommand {
    pub mission_id: String,
}
impl sealed::Sealed for CleanupMissionWorkspaceCommand {}
impl DomainCommand for CleanupMissionWorkspaceCommand {
    const TYPE: &'static str = "mission.workspace.cleanup";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionActivity {
    pub id: i64,
    pub kind: String,
    pub actor_type: String,
    pub actor_id: String,
    pub changes: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionDeliveryFile {
    pub attachment_id: String,
    pub display_name: String,
    pub media_type: String,
    pub byte_size: i64,
    pub preview_kind: String,
    pub message_id: String,
    pub agent_id: String,
    pub created_at: String,
    pub kind: String,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkMissionPrCommand {
    pub mission_id: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub remove: bool,
}
impl sealed::Sealed for LinkMissionPrCommand {}
impl DomainCommand for LinkMissionPrCommand {
    const TYPE: &'static str = "mission.link_pr";
}

#[derive(Default)]
pub struct MissionService {
    gateway: DomainCommandGateway,
}
impl MissionService {
    pub fn link_pr(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<LinkMissionPrCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        let url = url::Url::parse(&input.url).context("mission.invalid_pr_url")?;
        ensure!(
            matches!(url.scheme(), "https" | "http")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && input.url.len() <= 4096
                && input.title.chars().count() <= 200,
            "mission.invalid_pr_url"
        );
        self.gateway.execute(database,envelope,|tx|{
            if !matches!(envelope.actor,ActorRef::User{..}) {return Ok(reject("mission.user_required"));}
            if load_record(tx,&input.mission_id)?.is_none() {return Ok(reject("mission.not_found"));}
            let changed=if input.remove {tx.execute("DELETE FROM mission_pr WHERE mission_id=?1 AND url=?2",params![input.mission_id,url.as_str()])?} else {
                tx.execute("INSERT INTO mission_pr(id,mission_id,url,title,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(mission_id,url) DO UPDATE SET title=excluded.title WHERE title<>excluded.title",params![Uuid::new_v4().to_string(),input.mission_id,url.as_str(),input.title.trim(),chrono::Utc::now().to_rfc3339()])?
            };
            if changed>0 {record_activity(tx,&input.mission_id,"pull_request",&envelope.actor,None,json!({"url":url.as_str(),"title":input.title,"removed":input.remove}))?;}
            Ok(mutation(&input.mission_id,changed>0))
        })
    }
    pub fn start(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<StartMissionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database,envelope,|tx| {
            if !matches!(envelope.actor,ActorRef::User{..}) { return Ok(reject("mission.user_required")); }
            let Some(mission)=load_record(tx,&envelope.payload.mission_id)? else { return Ok(reject("mission.not_found")); };
            let start_available=mission_start_available(
                tx,
                &mission.info.mission_id,
                &mission.camp_id,
            )?;
            let result=if !start_available {
                CommandHandlerResult::applied("mission.already_running",json!({"missionId":mission.info.mission_id,"campId":mission.camp_id,"alreadyRunning":true}),None)
            } else { admit_mission_start(tx,&envelope.actor,&envelope.command_id,&mission)? };
            if result.status==CommandResultStatus::Rejected { return Ok(result); }
            if start_available {
                tx.execute("UPDATE mission SET updated_at=?2 WHERE id=?1",params![mission.info.mission_id,chrono::Utc::now().to_rfc3339()])?;
                record_activity(tx,&mission.info.mission_id,"started",&envelope.actor,None,json!({}))?;
            }
            Ok(result)
        })
    }
    pub fn create(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateMissionCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        validate_content(Some(&input.title), Some(&input.description))?;
        let tags = normalize_tags(&input.tags)?;
        validate_mission_source_attachments(&input.source_attachments)?;
        let source_attachments_json = serialize_source_attachments(&input.source_attachments)?;
        self.gateway.execute(database, envelope, |tx| {
            let mission_id = format!("rvm_{}", Uuid::now_v7().simple());
            tx.execute("INSERT INTO mission_number_sequence DEFAULT VALUES", [])?;
            let number = tx.last_insert_rowid();
            let camp_id = CampId::new();
            let created = create_camp_in_tx(tx, &envelope.actor, envelope.execution_epoch, &CreateCampCommand {
                name: Some(input.title.trim().chars().take(80).collect()),
                project_binding_kind: input.project_binding_kind, project_path: input.project_path.clone(),
                member_agent_ids: input.member_agent_ids.clone(), default_lead_agent_id: input.default_lead_agent_id.clone(),
                collaboration_mode: CampCollaborationMode::Peer, activation_state: CampActivationState::Active,
            }, &camp_id)?;
            if created.status == CommandResultStatus::Rejected { return Ok(created); }
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute("INSERT INTO mission(id,number,camp_id,title,description,status,tags_json,source_attachments_json,details_version,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'not_started',?6,?7,1,?8,?8)",
                params![mission_id,number,camp_id,input.title.trim(),input.description,serde_json::to_string(&tags)?,source_attachments_json,now])?;
            let mut changes = serde_json::Map::from_iter([
                ("status".into(), json!("not_started")),
                ("tagsChanged".into(), json!(!tags.is_empty())),
            ]);
            if !input.source_attachments.is_empty() {
                changes.insert("attachmentsChanged".into(), json!(true));
            }
            record_activity(tx, &mission_id, "created", &envelope.actor, envelope.execution_epoch,
                Value::Object(changes))?;
            Ok(CommandHandlerResult::applied("mission.created", json!({"missionId":mission_id,"missionNumber":number,"campId":camp_id}),
                Some(EntityReference { entity_type: "mission".into(), entity_id: mission_id })))
        })
    }

    pub fn update(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateMissionCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        ensure!(
            input.title.is_some()
                || input.description.is_some()
                || input.tags.is_some()
                || input.source_attachment_update.is_some(),
            "mission.content_required"
        );
        validate_content(input.title.as_deref(), input.description.as_deref())?;
        let tags = input.tags.as_deref().map(normalize_tags).transpose()?;
        self.gateway.execute(database, envelope, |tx| {
            let Some(current) = load_record(tx, &input.mission_id)? else { return Ok(reject("mission.not_found")); };
            if !can_edit(tx, envelope, &current)? || ((tags.is_some() || input.source_attachment_update.is_some()) && !matches!(envelope.actor, ActorRef::User { .. })) {
                return Ok(reject("mission.forbidden"));
            }
            let edits_details = input.title.is_some() || input.description.is_some() || input.source_attachment_update.is_some();
            if edits_details && matches!(envelope.actor, ActorRef::User { .. }) {
                let Some(expected) = input.expected_details_version else {
                    return Ok(reject("mission.details_version_required"));
                };
                if expected != current.details_version {
                    return Ok(CommandHandlerResult::rejected(
                        "mission.details_version_conflict",
                        json!({"missionId": current.info.mission_id}),
                    ));
                }
            }
            let title = input.title.as_deref().map(str::trim).unwrap_or(&current.info.title);
            let description = input.description.as_deref().unwrap_or(&current.info.description);
            let next_tags = tags.as_ref().unwrap_or(&current.tags);
            let next_source_attachments = match &input.source_attachment_update {
                Some(update) => apply_attachment_update(&current.source_attachments, update)?,
                None => current.source_attachments.clone(),
            };
            let mut changes = serde_json::Map::new();
            if title != current.info.title { changes.insert("titleChanged".into(), json!(true)); }
            if description != current.info.description { changes.insert("descriptionChanged".into(), json!(true)); }
            if next_tags != &current.tags { changes.insert("tagsChanged".into(), json!(true)); }
            if next_source_attachments != current.source_attachments { changes.insert("attachmentsChanged".into(), json!(true)); }
            if changes.is_empty() { return Ok(mutation(&input.mission_id, false)); }
            let details_changed = title != current.info.title || description != current.info.description || next_source_attachments != current.source_attachments;
            tx.execute("UPDATE mission SET title=?2,description=?3,tags_json=?4,source_attachments_json=?5,details_version=details_version+?6,updated_at=?7 WHERE id=?1",
                params![input.mission_id,title,description,serde_json::to_string(next_tags)?,serialize_source_attachments(&next_source_attachments)?,i64::from(details_changed),chrono::Utc::now().to_rfc3339()])?;
            if changes.contains_key("titleChanged") {
            tx.execute("UPDATE camp SET title=?2,name_origin='user',version=version+1,updated_at=?3 WHERE id=?1",
                params![current.camp_id,title.chars().take(80).collect::<String>(),chrono::Utc::now().to_rfc3339()])?;
            }
            record_activity(tx, &input.mission_id, "updated", &envelope.actor, envelope.execution_epoch, Value::Object(changes))?;
            Ok(mutation(&input.mission_id, true))
        })
    }

    pub fn status(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<StatusMissionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |tx| {
            let input = &envelope.payload;
            let Some(current) = load_record(tx, &input.mission_id)? else { return Ok(reject("mission.not_found")); };
            if !can_edit(tx, envelope, &current)? { return Ok(reject("mission.forbidden")); }
            if let Some(source) = &input.source_message_id {
                let sql = format!("WITH {} SELECT EXISTS(SELECT 1 FROM camp_message m JOIN public_camp_message_publication p ON p.message_id=m.id WHERE m.id=?1 AND m.camp_id=?2 AND m.tombstoned_at IS NULL)", crate::camp_message_publication::public_camp_message_publication_cte());
                let valid: bool = tx.query_row(&sql, params![source,current.camp_id], |row| row.get(0))?;
                if !valid { return Ok(reject("mission.invalid_source_message")); }
            }
            if current.info.status == input.status && current.info.source_message_id == input.source_message_id { return Ok(mutation(&input.mission_id, false)); }
            tx.execute("UPDATE mission SET status=?2,source_message_id=?3,updated_at=?4 WHERE id=?1",
                params![input.mission_id,input.status.as_str(),input.source_message_id,chrono::Utc::now().to_rfc3339()])?;
            record_activity(tx, &input.mission_id, "status", &envelope.actor, envelope.execution_epoch, json!({"status":input.status,"sourceMessageId":input.source_message_id}))?;
            if current.info.status != input.status {
                crate::notification::record_status_transition(tx, &envelope.actor, crate::notification::StatusTransition {
                    kind: "mission", id: &input.mission_id, camp_id: &current.camp_id,
                    status: input.status.as_str(), source_message_id: input.source_message_id.as_deref(),
                })?;
            }
            Ok(mutation(&input.mission_id, true))
        })
    }

    pub fn get(&self, database: &Database, mission_id: &str) -> Result<Option<MissionRecord>> {
        load_record(database.connection(), mission_id)
    }

    pub fn list_for_agent(
        &self,
        database: &Database,
        input: &MissionListInput,
    ) -> Result<MissionListPage> {
        let limit = input.limit.unwrap_or(MISSION_LIST_DEFAULT_LIMIT);
        if !(1..=MISSION_LIST_MAX_LIMIT).contains(&limit) {
            return Err(MissionAgentInputError::invalid_limit().into());
        }
        if input
            .query
            .as_ref()
            .is_some_and(|query| query.trim().is_empty() || query.chars().count() > 200)
        {
            return Err(MissionAgentInputError::invalid_query().into());
        }
        let cursor = input
            .cursor
            .as_deref()
            .map(decode_mission_list_cursor)
            .transpose()?;
        if cursor.as_ref().is_some_and(|cursor| {
            cursor.query.as_deref() != input.query.as_deref() || cursor.status != input.status
        }) {
            return Err(MissionAgentInputError::invalid_cursor().into());
        }
        let before_number = cursor.as_ref().map(|cursor| cursor.before_number);
        let status = input.status.map(MissionStatus::as_str);
        let row_limit = i64::try_from(limit + 1).context("Mission list limit overflowed")?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT mission.id, mission.number, mission.camp_id, mission.title,
                   mission.status, mission.updated_at
            FROM mission
            JOIN camp ON camp.id = mission.camp_id
            WHERE (?1 IS NULL OR mission.number < ?1)
              AND camp.deletion_operation_id IS NULL
              AND (?2 IS NULL OR mission.status = ?2)
              AND (
                    ?3 IS NULL
                    OR instr(lower(mission.title), lower(?3)) > 0
                    OR mission.id = ?3
                  )
            ORDER BY mission.number DESC
            LIMIT ?4
            "#,
        )?;
        let mut missions = statement
            .query_map(
                params![before_number, status, input.query.as_deref(), row_limit],
                |row| {
                    let number = row.get::<_, i64>(1)?;
                    let status = row.get::<_, String>(4)?;
                    Ok((
                        number,
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        status,
                        row.get::<_, String>(5)?,
                    ))
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|(number, mission_id, camp_id, title, status, updated_at)| {
                Ok((
                    number,
                    MissionListItem {
                        mission_id,
                        camp_id,
                        title,
                        status: serde_json::from_value(json!(status))?,
                        updated_at,
                    },
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        let has_more = missions.len() > limit;
        if has_more {
            missions.truncate(limit);
        }
        let next_cursor = if has_more {
            missions
                .last()
                .map(|(number, _)| {
                    encode_mission_list_cursor(&MissionListCursor {
                        schema_version: 1,
                        query: input.query.clone(),
                        status: input.status,
                        before_number: *number,
                    })
                })
                .transpose()?
        } else {
            None
        };
        Ok(MissionListPage {
            missions: missions.into_iter().map(|(_, mission)| mission).collect(),
            next_cursor,
            has_more,
        })
    }

    pub fn list(&self, database: &Database) -> Result<Vec<MissionRecord>> {
        let mut statement = database
            .connection()
            .prepare("SELECT mission.id FROM mission JOIN camp ON camp.id=mission.camp_id WHERE camp.deletion_operation_id IS NULL ORDER BY mission.updated_at DESC,mission.id DESC")?;
        let ids = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.iter()
            .map(|id| {
                load_record(database.connection(), id)?
                    .context("Mission disappeared during locked read")
            })
            .collect()
    }
    pub fn activity(
        &self,
        database: &Database,
        mission_id: &str,
        before: Option<i64>,
    ) -> Result<Vec<MissionActivity>> {
        let mut statement = database.connection().prepare("SELECT id,kind,actor_type,actor_id,changes_json,created_at FROM mission_activity WHERE mission_id=?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT 100")?;
        let rows = statement
            .query_map(params![mission_id, before], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, String>(4)?,
                    r.get(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(id, kind, actor_type, actor_id, changes, created_at)| {
                Ok(MissionActivity {
                    id,
                    kind,
                    actor_type,
                    actor_id,
                    changes: serde_json::from_str(&changes)?,
                    created_at,
                })
            })
            .collect()
    }

    pub(crate) fn delivery_files(
        &self,
        database: &Database,
        camp_id: &str,
    ) -> Result<Vec<MissionDeliveryFile>> {
        let mut statement = database.connection().prepare(
            r#"
            WITH delivery_file AS (
                SELECT m.sequence AS message_sequence,
                       r.ordinal AS attachment_ordinal,
                       a.id AS attachment_id,
                       r.display_name_snapshot AS display_name,
                       a.media_type,
                       a.byte_size,
                       a.preview_kind,
                       m.id AS message_id,
                       m.author_id AS agent_id,
                       m.created_at,
                       a.kind,
                       a.file_count
                FROM camp_message AS m
                JOIN camp_message_attachment_ref AS r
                  ON r.camp_id = m.camp_id
                 AND r.camp_message_id = m.id
                JOIN managed_attachment AS a
                  ON a.camp_id = r.camp_id
                 AND a.id = r.attachment_id
                WHERE m.camp_id = ?1
                  AND m.author_type = 'agent'
                  AND m.tombstoned_at IS NULL
                  AND a.state = 'available'

                UNION ALL

                SELECT m.sequence AS message_sequence,
                       CAST(source.key AS INTEGER) AS attachment_ordinal,
                       CAST(json_extract(source.value, '$.id') AS TEXT) AS attachment_id,
                       CAST(json_extract(source.value, '$.displayName') AS TEXT) AS display_name,
                       COALESCE(
                           NULLIF(CAST(json_extract(source.value, '$.mediaType') AS TEXT), ''),
                           CASE CAST(json_extract(source.value, '$.kind') AS TEXT)
                               WHEN 'directory' THEN ?2
                               ELSE 'application/octet-stream'
                           END
                       ) AS media_type,
                       COALESCE(
                           CAST(json_extract(source.value, '$.observedByteSize') AS INTEGER),
                           0
                       ) AS byte_size,
                       CASE
                           WHEN CAST(json_extract(source.value, '$.mediaType') AS TEXT) LIKE 'image/%'
                               THEN 'image'
                           ELSE 'none'
                       END AS preview_kind,
                       m.id AS message_id,
                       m.author_id AS agent_id,
                       m.created_at,
                       CAST(json_extract(source.value, '$.kind') AS TEXT) AS kind,
                       CASE CAST(json_extract(source.value, '$.kind') AS TEXT)
                           WHEN 'file' THEN 1
                           ELSE 0
                       END AS file_count
                FROM camp_message AS m,
                     json_each(m.source_attachments_json) AS source
                WHERE m.camp_id = ?1
                  AND m.author_type = 'agent'
                  AND m.tombstoned_at IS NULL
                  AND m.source_attachments_json <> '[]'
            )
            SELECT attachment_id, display_name, media_type, byte_size,
                   preview_kind, message_id, agent_id, created_at, kind, file_count
            FROM delivery_file
            ORDER BY message_sequence DESC, attachment_ordinal, attachment_id
            "#,
        )?;
        statement
            .query_map(params![camp_id, DIRECTORY_MEDIA_TYPE], |row| {
                Ok(MissionDeliveryFile {
                    attachment_id: row.get(0)?,
                    display_name: row.get(1)?,
                    media_type: row.get(2)?,
                    byte_size: row.get(3)?,
                    preview_kind: row.get(4)?,
                    message_id: row.get(5)?,
                    agent_id: row.get(6)?,
                    created_at: row.get(7)?,
                    kind: row.get(8)?,
                    file_count: row.get(9)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
}

fn encode_mission_list_cursor(cursor: &MissionListCursor) -> Result<String> {
    let bytes = serde_json::to_vec(cursor).context("Mission list cursor could not be encoded")?;
    Ok(bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

fn decode_mission_list_cursor(value: &str) -> Result<MissionListCursor> {
    if value.is_empty() || value.len() > 2048 || !value.len().is_multiple_of(2) {
        return Err(MissionAgentInputError::invalid_cursor().into());
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| MissionAgentInputError::invalid_cursor())?;
    let cursor = serde_json::from_slice::<MissionListCursor>(&bytes)
        .map_err(|_| MissionAgentInputError::invalid_cursor())?;
    if cursor.schema_version != 1
        || cursor.before_number < 1
        || cursor
            .query
            .as_ref()
            .is_some_and(|query| query.trim().is_empty() || query.chars().count() > 200)
        || encode_mission_list_cursor(&cursor)? != value
    {
        return Err(MissionAgentInputError::invalid_cursor().into());
    }
    Ok(cursor)
}

pub(crate) fn mission_for_camp(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<MissionRecord>> {
    let id = connection
        .query_row("SELECT id FROM mission WHERE camp_id=?1", [camp_id], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    id.map(|id| load_record(connection, &id)?.context("Mission association missing"))
        .transpose()
}

fn load_record(connection: &Connection, id: &str) -> Result<Option<MissionRecord>> {
    let row = connection.query_row("SELECT m.id,m.number,m.camp_id,m.title,m.description,m.status,m.source_message_id,m.tags_json,m.source_attachments_json,m.details_version,m.created_at,m.updated_at,c.project_path,c.project_binding_kind,c.default_lead_agent_id FROM mission m JOIN camp c ON c.id=m.camp_id WHERE m.id=?1 AND c.deletion_operation_id IS NULL", [id], |r| Ok((
        r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?,r.get::<_,i64>(9)?,r.get::<_,String>(10)?,r.get::<_,String>(11)?,r.get::<_,String>(12)?,r.get::<_,String>(13)?,r.get::<_,Option<String>>(14)?))).optional()?;
    let Some((
        mission_id,
        number,
        camp_id,
        title,
        description,
        status,
        source_message_id,
        tags,
        source_attachments_json,
        details_version,
        created_at,
        updated_at,
        project_path,
        binding,
        default_lead_agent_id,
    )) = row
    else {
        return Ok(None);
    };
    let source_attachments = parse_source_attachments(&source_attachments_json)?;
    let attachments = source_attachments
        .iter()
        .map(|source| source.view(LocalAttachmentAvailability::Unknown))
        .collect();
    let strings = |sql: &str| -> Result<Vec<String>> {
        Ok(connection
            .prepare(sql)?
            .query_map([&camp_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    };
    let unread_sql = format!(
        "WITH {} SELECT EXISTS(SELECT 1 FROM camp_message m JOIN public_camp_message_publication p ON p.message_id=m.id WHERE m.camp_id=?1 AND m.author_type='agent' AND m.tombstoned_at IS NULL AND p.global_sequence>COALESCE((SELECT last_seen_global_sequence FROM camp_view_state WHERE camp_id=?1),0))",
        crate::camp_message_publication::public_camp_message_publication_cte()
    );
    let has_unread = connection.query_row(&unread_sql, [&camp_id], |r| r.get(0))?;
    let start_available = mission_start_available(connection, &mission_id, &camp_id)?;
    let (workspace_ever_created, workspace_resources_present, cleanup_available, workspace_cleanup) =
        crate::mission_workspace::cleanup_projection(connection, &mission_id, &camp_id)?;
    Ok(Some(MissionRecord {
        has_unread,
        number,
        info: MissionInfo {
            mission_id,
            title,
            description,
            status: serde_json::from_value(json!(status))?,
            source_message_id,
        },
        member_agent_ids: strings(
            "SELECT agent_id FROM camp_member WHERE camp_id=?1 AND status='active' ORDER BY joined_at,agent_id",
        )?,
        running_agent_ids: strings(
            "SELECT DISTINCT c.agent_id FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE c.camp_id=?1 AND r.status IN ('queued','running','waiting') ORDER BY c.agent_id",
        )?,
        start_available,
        camp_id,
        project_path,
        project_binding_kind: serde_json::from_value(json!(binding))?,
        details_version,
        tags: serde_json::from_str(&tags)?,
        attachments,
        source_attachments,
        created_at,
        updated_at,
        default_lead_agent_id,
        workspace_ever_created,
        workspace_resources_present,
        cleanup_available,
        workspace_cleanup,
    }))
}

fn mission_start_available(
    connection: &Connection,
    mission_id: &str,
    camp_id: &str,
) -> Result<bool> {
    connection
        .query_row(
            "SELECT
                NOT EXISTS(
                    SELECT 1
                    FROM mission_start AS start
                    JOIN camp_message_delivery AS delivery ON delivery.id=start.delivery_id
                    WHERE start.mission_id=?1 AND delivery.status IN ('waiting','claimed')
                )
                AND NOT EXISTS(
                    SELECT 1
                    FROM agent_run
                    WHERE camp_id=?2 AND status IN ('queued','running','waiting')
                )",
            params![mission_id, camp_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}
fn validate_content(title: Option<&str>, description: Option<&str>) -> Result<()> {
    if let Some(title) = title {
        ensure!(
            !title.trim().is_empty() && title.trim().chars().count() <= 200,
            "mission.invalid_title"
        );
    }
    if let Some(description) = description {
        ensure!(
            description.chars().count() <= 12_000,
            "mission.description_too_long"
        );
    }
    Ok(())
}
fn normalize_tags(tags: &[String]) -> Result<Vec<String>> {
    ensure!(tags.len() <= 30, "mission.too_many_tags");
    let mut values = Vec::new();
    let mut keys = std::collections::HashSet::new();
    for tag in tags {
        let value = tag.trim();
        ensure!(
            !value.is_empty() && value.chars().count() <= 24,
            "mission.invalid_tag"
        );
        if keys.insert(value.to_lowercase()) {
            values.push(value.to_string());
        }
    }
    Ok(values)
}

fn validate_mission_source_attachments(refs: &[LocalAttachmentSourceRef]) -> Result<()> {
    ensure!(
        refs.len() <= crate::camp_attachment::MAX_PREPARED_ATTACHMENTS,
        "mission.too_many_attachments"
    );
    serialize_source_attachments(refs)?;
    let mut paths = std::collections::HashSet::new();
    ensure!(
        refs.iter().all(|source| paths.insert(&source.source_path)),
        "mission.duplicate_attachment"
    );
    Ok(())
}

fn apply_attachment_update(
    current: &[LocalAttachmentSourceRef],
    update: &MissionAttachmentUpdate,
) -> Result<Vec<LocalAttachmentSourceRef>> {
    let keep = update
        .keep_attachment_ids
        .iter()
        .collect::<std::collections::HashSet<_>>();
    ensure!(
        keep.len() == update.keep_attachment_ids.len(),
        "mission.duplicate_attachment"
    );
    ensure!(
        keep.iter()
            .all(|id| current.iter().any(|source| &source.id == *id)),
        "mission.attachment_not_found"
    );
    let mut next = current
        .iter()
        .filter(|source| keep.contains(&source.id))
        .cloned()
        .collect::<Vec<_>>();
    next.extend(update.new_source_attachments.iter().cloned());
    validate_mission_source_attachments(&next)?;
    Ok(next)
}
fn can_edit<T>(
    tx: &Transaction<'_>,
    envelope: &CommandEnvelope<T>,
    current: &MissionRecord,
) -> Result<bool> {
    if matches!(envelope.actor, ActorRef::System { .. }) {
        return Ok(false);
    }
    if matches!(envelope.actor, ActorRef::Agent { .. })
        && envelope.camp_id.as_deref() != Some(&current.camp_id)
    {
        return Ok(false);
    }
    actor_can_write_camp(
        tx,
        &envelope.actor,
        envelope.execution_epoch,
        &current.camp_id,
    )
}
fn reject(code: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message":code}))
}
fn mutation(id: &str, changed: bool) -> CommandHandlerResult {
    CommandHandlerResult::applied(
        "mission.updated",
        json!({"missionId":id,"changed":changed}),
        Some(EntityReference {
            entity_type: "mission".into(),
            entity_id: id.into(),
        }),
    )
}
pub(crate) fn record_activity(
    tx: &Transaction<'_>,
    mission_id: &str,
    kind: &str,
    actor: &ActorRef,
    epoch: Option<i64>,
    changes: Value,
) -> Result<()> {
    let (actor_type, actor_id) = match actor {
        ActorRef::User { user_id } => ("user", user_id),
        ActorRef::Agent { agent_id, .. } => ("agent", agent_id),
        ActorRef::System { component_id } => ("system", component_id),
    };
    tx.execute("INSERT INTO mission_activity(mission_id,kind,actor_type,actor_id,changes_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![mission_id,kind,actor_type,actor_id,serde_json::to_string(&changes)?,chrono::Utc::now().to_rfc3339()])?;
    let camp_id: String = tx.query_row(
        "SELECT camp_id FROM mission WHERE id=?1",
        [mission_id],
        |r| r.get(0),
    )?;
    append_domain_event(
        tx,
        "mission.updated",
        Some(&camp_id),
        Some(("mission", mission_id)),
        actor,
        epoch,
        &json!({"missionId":mission_id,"kind":kind,"changes":changes}),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command<P>(payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: None,
            expected_versions: vec![],
            execution_epoch: None,
            payload,
        }
    }
    #[test]
    fn mission_commands_keep_definition_atomic_patch_only_and_start_status_independent() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let directory = db.directory().join("workspace");
        std::fs::create_dir_all(&directory).unwrap();
        let service = MissionService::default();
        let create = command(CreateMissionCommand {
            title: "使命".repeat(65),
            description: "original".into(),
            project_path: directory.to_str().unwrap().into(),
            project_binding_kind: ProjectBindingKind::Directory,
            member_agent_ids: vec!["agent_1".into(), "agent_2".into()],
            default_lead_agent_id: "agent_1".into(),
            tags: vec![" UI ".into(), "ui".into()],
            source_attachments: vec![],
        });
        let created = service.create(&mut db, &create).unwrap();
        assert_eq!(created.result.code, "mission.created");
        let id = created.result.payload["missionId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            service.create(&mut db, &create).unwrap().result.payload,
            created.result.payload
        );
        let record = service.get(&db, &id).unwrap().unwrap();
        assert!(record.agent_info().attachments.is_empty());
        let number: i64 = db
            .connection()
            .query_row("SELECT number FROM mission WHERE id=?1", [&id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(number, 1);
        assert_eq!(record.info.title.chars().count(), 130);
        assert_eq!(record.tags, vec!["UI"]);
        assert_eq!(record.info.status, MissionStatus::NotStarted);
        assert_eq!(
            service
                .activity(&db, &id, None)
                .unwrap()
                .into_iter()
                .find(|activity| activity.kind == "created")
                .unwrap()
                .changes,
            json!({"status":"not_started","tagsChanged":true})
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM agent_run", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_workspace", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        for (title, description, expected_details_version) in [
            (Some("new".into()), None, 1),
            (None, Some("next".into()), 2),
        ] {
            service
                .update(
                    &mut db,
                    &command(UpdateMissionCommand {
                        mission_id: id.clone(),
                        title,
                        description,
                        tags: None,
                        expected_details_version: Some(expected_details_version),
                        source_attachment_update: None,
                    }),
                )
                .unwrap();
        }
        let record = service.get(&db, &id).unwrap().unwrap();
        assert_eq!(record.info.title, "new");
        assert_eq!(record.info.description, "next");
        assert_eq!(record.details_version, 3);
        let updated = service
            .activity(&db, &id, None)
            .unwrap()
            .into_iter()
            .filter(|activity| activity.kind == "updated")
            .map(|activity| activity.changes)
            .collect::<Vec<_>>();
        assert_eq!(
            updated,
            vec![
                json!({"descriptionChanged": true}),
                json!({"titleChanged": true}),
            ]
        );
        let before = service.activity(&db, &id, None).unwrap().len();
        assert_eq!(
            service
                .update(
                    &mut db,
                    &command(UpdateMissionCommand {
                        mission_id: id.clone(),
                        title: Some("new".into()),
                        description: None,
                        tags: None,
                        expected_details_version: Some(3),
                        source_attachment_update: None,
                    })
                )
                .unwrap()
                .result
                .payload["changed"],
            false
        );
        assert_eq!(service.get(&db, &id).unwrap().unwrap().details_version, 3);
        let stale = service
            .update(
                &mut db,
                &command(UpdateMissionCommand {
                    mission_id: id.clone(),
                    title: Some("stale".into()),
                    description: Some("stale".into()),
                    tags: None,
                    expected_details_version: Some(2),
                    source_attachment_update: None,
                }),
            )
            .unwrap();
        assert_eq!(stale.result.code, "mission.details_version_conflict");
        assert_eq!(stale.result.payload, json!({"missionId": id}));
        assert_eq!(service.activity(&db, &id, None).unwrap().len(), before);
        let mut invalid = create.clone();
        invalid.command_id = Uuid::new_v4().to_string();
        invalid.payload.default_lead_agent_id = "missing".into();
        assert_eq!(
            service.create(&mut db, &invalid).unwrap().result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(service.list(&db).unwrap().len(), 1);
        let ordinary_created = service
            .create(
                &mut db,
                &command(CreateMissionCommand {
                    title: "普通消息执行使命".into(),
                    description: String::new(),
                    project_path: directory.to_str().unwrap().into(),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec![],
                    source_attachments: vec![],
                }),
            )
            .unwrap();
        let ordinary_id = ordinary_created.result.payload["missionId"]
            .as_str()
            .unwrap()
            .to_string();
        let ordinary = service.get(&db, &ordinary_id).unwrap().unwrap();
        assert!(ordinary.start_available);
        let ordinary_message = CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: Some(ordinary.camp_id.clone()),
            expected_versions: vec![],
            execution_epoch: None,
            payload: crate::collaboration::TestCampMessageCommand {
                camp_id: ordinary.camp_id.clone(),
                draft_revision: None,
                body: "通过普通消息开始执行".into(),
                prepared_attachment_ids: vec![],
                address: crate::collaboration::TestCampMessageAddress::Default,
                reply_to_camp_message_id: None,
                execution: Some(crate::collaboration::ExecutionRequest {
                    task_id: None,
                    purpose: "验证普通消息 claim 后的使命投影".into(),
                    completion_role: "required".into(),
                    budget: None,
                }),
            },
        };
        let ordinary_sent = crate::collaboration::CollaborationService::default()
            .send_test_camp_message(&mut db, &ordinary_message)
            .unwrap();
        assert_eq!(ordinary_sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            ordinary_sent.result.payload["agentRunIds"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let ordinary_claimed = service.get(&db, &ordinary_id).unwrap().unwrap();
        assert!(!ordinary_claimed.start_available);
        assert_eq!(ordinary_claimed.running_agent_ids, vec!["agent_1"]);
        assert_eq!(
            service
                .start(
                    &mut db,
                    &command(StartMissionCommand {
                        mission_id: ordinary_id.clone(),
                    }),
                )
                .unwrap()
                .result
                .payload["alreadyRunning"],
            true
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_start", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let start = command(StartMissionCommand {
            mission_id: id.clone(),
        });
        let started = service.start(&mut db, &start).unwrap();
        assert_eq!(
            started.result.status,
            CommandResultStatus::Accepted,
            "{:?}",
            started.result
        );
        let waiting_projection = service.get(&db, &id).unwrap().unwrap();
        assert!(!waiting_projection.start_available);
        assert!(waiting_projection.running_agent_ids.is_empty());
        assert_eq!(
            service.start(&mut db, &start).unwrap().result.payload,
            started.result.payload
        );
        assert_eq!(
            service
                .start(
                    &mut db,
                    &command(StartMissionCommand {
                        mission_id: id.clone()
                    })
                )
                .unwrap()
                .result
                .payload["alreadyRunning"],
            true
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_start", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_workspace", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            service.get(&db, &id).unwrap().unwrap().info.status,
            MissionStatus::NotStarted
        );
        let started_activities = service
            .activity(&db, &id, None)
            .unwrap()
            .into_iter()
            .filter(|activity| activity.kind == "started")
            .collect::<Vec<_>>();
        assert_eq!(started_activities.len(), 1);
        assert_eq!(started_activities[0].changes, json!({}));
        service
            .status(
                &mut db,
                &command(StatusMissionCommand {
                    mission_id: id.clone(),
                    status: MissionStatus::Completed,
                    source_message_id: None,
                }),
            )
            .unwrap();
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE status='queued' AND camp_id=?1",
                    [&record.camp_id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_message_delivery WHERE status='waiting'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        let info = serde_json::to_value(service.get(&db, &id).unwrap().unwrap().info).unwrap();
        assert_eq!(info.as_object().unwrap().len(), 5);
        assert!(info.get("workspace").is_none());
        assert!(info.get("version").is_none());
        let result = service
            .status(
                &mut db,
                &command(StatusMissionCommand {
                    mission_id: id.clone(),
                    status: MissionStatus::NeedsYou,
                    source_message_id: Some("outside".into()),
                }),
            )
            .unwrap();
        assert_eq!(result.result.code, "mission.invalid_source_message");

        // The running member remains allowed after another member becomes lead.
        let claimed_runs =
            crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 100).unwrap();
        assert_eq!(claimed_runs.len(), 1);
        let queued_projection = service.get(&db, &id).unwrap().unwrap();
        assert!(!queued_projection.start_available);
        assert_eq!(queued_projection.running_agent_ids, vec!["agent_1"]);
        let runtime = crate::runtime::ExecutionRuntimeService::default();
        let candidate = runtime
            .list_dispatchable_agent_runs(&db, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.camp_id == record.camp_id)
            .unwrap();
        let mut claim = command(crate::runtime::ClaimAgentRunCommand {
            agent_run_id: candidate.agent_run_id.clone(),
            expected_version: candidate.version,
            lease_owner: "mission-test".into(),
            lease_seconds: 60,
            workspace: Some(candidate.execution_workspace()),
            starting_git_observation: None,
        });
        claim.actor = ActorRef::System {
            component_id: "agent-run-scheduler".into(),
        };
        claim.camp_id = Some(record.camp_id.clone());
        let claimed = runtime.claim_agent_run(&mut db, &claim).unwrap();
        assert_eq!(claimed.result.code, "agent_run.claimed");
        let epoch = claimed.result.payload["executionEpoch"].as_i64().unwrap();
        db.connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id='agent_2' WHERE id=?1",
                [&record.camp_id],
            )
            .unwrap();
        let mut edit = command(UpdateMissionCommand {
            mission_id: id.clone(),
            title: Some("member edit".into()),
            description: None,
            tags: None,
            expected_details_version: None,
            source_attachment_update: None,
        });
        edit.actor = ActorRef::Agent {
            agent_id: "agent_1".into(),
            source_agent_run_id: candidate.agent_run_id.clone(),
        };
        edit.camp_id = Some(record.camp_id.clone());
        edit.execution_epoch = Some(epoch);
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(
            service.get(&db, &id).unwrap().unwrap().info.description,
            "next"
        );
        assert_eq!(service.get(&db, &id).unwrap().unwrap().details_version, 4);
        let retained_body_columns: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('mission_start') WHERE name IN ('title','description')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(retained_body_columns, 0);
        let mut state = CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: edit.actor.clone(),
            camp_id: edit.camp_id.clone(),
            expected_versions: vec![],
            execution_epoch: edit.execution_epoch,
            payload: StatusMissionCommand {
                mission_id: id.clone(),
                status: MissionStatus::NeedsYou,
                source_message_id: None,
            },
        };
        let messages_before_statuses: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row.get(0))
            .unwrap();
        let starts_before_statuses: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM mission_start", [], |row| row.get(0))
            .unwrap();
        let runs_before_statuses: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_run", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT count(*) FROM notification_occurrence WHERE source_type='mission'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0,
            "user status edits and titles do not notify"
        );
        for next_status in [
            MissionStatus::NotStarted,
            MissionStatus::InProgress,
            MissionStatus::NeedsYou,
            MissionStatus::Completed,
        ] {
            state.command_id = Uuid::new_v4().to_string();
            state.payload.status = next_status;
            let result = service.status(&mut db, &state).unwrap();
            assert_eq!(result.result.status, CommandResultStatus::Applied);
            assert_eq!(result.result.payload["changed"], true);
            let current = service.get(&db, &id).unwrap().unwrap().info;
            assert_eq!(current.status, next_status);
            assert_eq!(current.source_message_id, None);
        }
        let notifications = crate::notification::NotificationEpisodeService::default();
        let changes = notifications
            .changes_since(&mut db, "local_user", 0, 100)
            .unwrap();
        let needs = changes
            .changes
            .iter()
            .filter_map(|c| c.heads_up_signal.as_ref())
            .find(|s| s.semantic == crate::notification::NotificationSemantic::MissionNeedsYou);
        assert!(
            needs.is_none(),
            "leaving needs_you resolves the old transient source"
        );
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT count(*) FROM notification_occurrence WHERE source_type='mission'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            4
        );
        let source: String = db
            .connection()
            .query_row(
                "SELECT message_id FROM mission_start WHERE mission_id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        let start_body: String = db
            .connection()
            .query_row(
                "SELECT body FROM camp_message WHERE id=?1",
                [&source],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(start_body, "开始使命");
        state.command_id = Uuid::new_v4().to_string();
        state.payload.status = MissionStatus::NeedsYou;
        state.payload.source_message_id = Some(source.clone());
        let status = service.status(&mut db, &state).unwrap();
        assert_eq!(status.result.payload["changed"], true);
        let changes = notifications
            .changes_since(&mut db, "local_user", 0, 100)
            .unwrap();
        let signal = changes
            .changes
            .iter()
            .filter_map(|c| c.heads_up_signal.as_ref())
            .find(|s| s.semantic == crate::notification::NotificationSemantic::MissionNeedsYou)
            .unwrap();
        assert_eq!(
            signal.mention.as_ref().unwrap().summary.as_deref(),
            Some("开始使命")
        );
        assert_eq!(signal.action.subject.as_ref().unwrap().id, id);
        assert_eq!(
            signal.action.kind,
            crate::notification::NotificationActionKind::OpenMission
        );
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT count(*) FROM notification_occurrence WHERE source_type='mission'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            5
        );
        let status_activity_count = service
            .activity(&db, &id, None)
            .unwrap()
            .into_iter()
            .filter(|activity| activity.kind == "status")
            .count();
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.payload,
            status.result.payload
        );
        assert_eq!(
            service
                .activity(&db, &id, None)
                .unwrap()
                .into_iter()
                .filter(|activity| activity.kind == "status")
                .count(),
            status_activity_count
        );
        state.command_id = Uuid::new_v4().to_string();
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.payload["changed"],
            false
        );
        assert_eq!(
            service
                .activity(&db, &id, None)
                .unwrap()
                .into_iter()
                .filter(|activity| activity.kind == "status")
                .count(),
            status_activity_count
        );
        state.command_id = Uuid::new_v4().to_string();
        state.payload.source_message_id = None;
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(
            service
                .get(&db, &id)
                .unwrap()
                .unwrap()
                .info
                .source_message_id,
            None
        );
        assert!(
            service
                .activity(&db, &id, None)
                .unwrap()
                .into_iter()
                .any(|activity| activity.kind == "status"
                    && activity.changes["sourceMessageId"].as_str() == Some(source.as_str()))
        );
        state.command_id = Uuid::new_v4().to_string();
        state.payload.source_message_id = Some(source.clone());
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.payload["changed"],
            true
        );
        db.connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at=?2 WHERE id=?1",
                params![source, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        let activities_before_invalid = service.activity(&db, &id, None).unwrap().len();
        state.command_id = Uuid::new_v4().to_string();
        state.payload.status = MissionStatus::Completed;
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.code,
            "mission.invalid_source_message"
        );
        let current = service.get(&db, &id).unwrap().unwrap().info;
        assert_eq!(current.status, MissionStatus::NeedsYou);
        assert_eq!(current.source_message_id, Some(source));
        assert_eq!(
            service.activity(&db, &id, None).unwrap().len(),
            activities_before_invalid
        );
        for (query, expected) in [
            (
                "SELECT COUNT(*) FROM camp_message",
                messages_before_statuses,
            ),
            ("SELECT COUNT(*) FROM mission_start", starts_before_statuses),
            ("SELECT COUNT(*) FROM agent_run", runs_before_statuses),
        ] {
            assert_eq!(
                db.connection()
                    .query_row(query, [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                expected
            );
        }
        state.command_id = Uuid::new_v4().to_string();
        state.execution_epoch = Some(epoch + 1);
        state.payload.source_message_id = None;
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.code,
            "mission.forbidden"
        );
        state.execution_epoch = Some(epoch);
        // Cross-Camp and removed-member callers cannot keep editing with a live Run.
        edit.command_id = Uuid::new_v4().to_string();
        edit.camp_id = None;
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.code,
            "mission.forbidden"
        );
        edit.command_id = Uuid::new_v4().to_string();
        edit.camp_id = Some(record.camp_id.clone());
        db.connection().execute("UPDATE camp_member SET leave_requested_at=?2,leave_request_command_id='fixture-leave' WHERE camp_id=?1 AND agent_id='agent_1'",params![record.camp_id,chrono::Utc::now().to_rfc3339()]).unwrap();
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.code,
            "mission.forbidden"
        );
        state.command_id = Uuid::new_v4().to_string();
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.code,
            "mission.forbidden"
        );
    }

    #[test]
    fn mission_cleanup_capability_comes_from_workspace_records_and_execution_occupancy() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let service = MissionService::default();
        let project_path = db.directory().to_string_lossy().into_owned();
        let created = service
            .create(
                &mut db,
                &command(CreateMissionCommand {
                    title: "cleanup projection".into(),
                    description: String::new(),
                    project_path,
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec![],
                    source_attachments: vec![],
                }),
            )
            .unwrap();
        let mission_id = created.result.payload["missionId"]
            .as_str()
            .unwrap()
            .to_string();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let initial = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(!initial.workspace_ever_created);
        assert!(!initial.workspace_resources_present);
        assert!(!initial.cleanup_available);
        assert!(initial.workspace_cleanup.is_none());

        let host: String = db
            .connection()
            .query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        db.connection().execute(
            "INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,state,created_at,updated_at) VALUES('projection-workspace',?1,?2,?3,?4,?4,?5,?6,?6,'main','rovai/mission/001','base','owner','ready','created','updated')",
            params![mission_id, camp_id, host, crate::test_support::absolute_test_path("/repo"), crate::test_support::absolute_test_path("/repo/.git"), crate::test_support::absolute_test_path("/worktree")],
        ).unwrap();
        let idle = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(idle.workspace_ever_created);
        assert!(idle.workspace_resources_present);
        assert!(idle.cleanup_available);
        assert!(idle.workspace_cleanup.is_none());

        service
            .start(
                &mut db,
                &command(StartMissionCommand {
                    mission_id: mission_id.clone(),
                }),
            )
            .unwrap();
        assert!(
            !service
                .get(&db, &mission_id)
                .unwrap()
                .unwrap()
                .cleanup_available
        );
        assert_eq!(
            crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 100)
                .unwrap()
                .len(),
            1
        );
        db.connection()
            .execute(
                "UPDATE agent_run SET status='succeeded',ended_at='ended',updated_at='ended' WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?1)",
                [&camp_id],
            )
            .unwrap();
        assert!(
            service
                .get(&db, &mission_id)
                .unwrap()
                .unwrap()
                .cleanup_available
        );

        let other = service
            .create(
                &mut db,
                &command(CreateMissionCommand {
                    title: "same execution root".into(),
                    description: String::new(),
                    project_path: crate::test_support::absolute_test_path("/other/repo"),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec![],
                    source_attachments: vec![],
                }),
            )
            .unwrap();
        let other_mission_id = other.result.payload["missionId"].as_str().unwrap();
        let other_camp_id = other.result.payload["campId"].as_str().unwrap();
        db.connection().execute(
            "INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,base_branch,branch,base_sha,preparation_token,state,created_at,updated_at) VALUES('projection-workspace-other',?1,?2,?3,?4,?4,?5,?6,?6,'main','rovai/mission/002','base','owner','ready','created','updated')",
            params![other_mission_id, other_camp_id, host, crate::test_support::absolute_test_path("/other/repo"), crate::test_support::absolute_test_path("/other/repo/.git"), crate::test_support::absolute_test_path("/other-worktree")],
        ).unwrap();
        service
            .start(
                &mut db,
                &command(StartMissionCommand {
                    mission_id: other_mission_id.into(),
                }),
            )
            .unwrap();
        assert_eq!(
            crate::delivery_queue::claim_waiting_delivery_batches(&mut db, 100)
                .unwrap()
                .len(),
            1
        );
        db.connection()
            .execute(
                "UPDATE agent_run SET workspace_json=json_object('executionRoot',?2) WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?1)",
                params![other_camp_id, crate::test_support::absolute_test_path("/worktree")],
            )
            .unwrap();
        assert!(
            !service
                .get(&db, &mission_id)
                .unwrap()
                .unwrap()
                .cleanup_available
        );
        db.connection()
            .execute(
                "UPDATE agent_run SET status='succeeded',ended_at='ended',updated_at='ended' WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?1)",
                [other_camp_id],
            )
            .unwrap();
        db.connection().execute(
            "UPDATE mission_workspace SET state='ready',cleanup_worktree_removed=0,cleanup_branch_removed=0,diagnostic='mission.workspace_dirty' WHERE mission_id=?1",
            [&mission_id],
        ).unwrap();
        let refused = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(refused.cleanup_available);
        assert!(refused.workspace_resources_present);
        let refused_cleanup = refused.workspace_cleanup.unwrap();
        assert_eq!(refused_cleanup.state, "failed");
        assert!(!refused_cleanup.worktree_removed);
        assert!(!refused_cleanup.branch_removed);
        assert_eq!(
            refused_cleanup.diagnostic.as_deref(),
            Some("mission.workspace_dirty")
        );

        db.connection()
            .execute(
                "UPDATE mission_workspace SET state='cleanup_pending',diagnostic=NULL WHERE mission_id=?1",
                [&mission_id],
            )
            .unwrap();
        let cleaning = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(!cleaning.cleanup_available);
        assert!(cleaning.workspace_resources_present);
        assert_eq!(cleaning.workspace_cleanup.unwrap().state, "cleaning");

        db.connection().execute(
            "UPDATE mission_workspace SET state='cleanup_failed',cleanup_worktree_removed=1,diagnostic='mission.branch_changed' WHERE mission_id=?1",
            [&mission_id],
        ).unwrap();
        let failed = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(!failed.cleanup_available);
        let failed_cleanup = failed.workspace_cleanup.unwrap();
        assert_eq!(failed_cleanup.state, "failed");
        assert!(failed_cleanup.worktree_removed);
        assert!(!failed_cleanup.branch_removed);
        assert_eq!(
            failed_cleanup.diagnostic.as_deref(),
            Some("mission.branch_changed")
        );

        db.connection().execute(
            "UPDATE mission_workspace SET state='cleanup_pending',cleanup_worktree_removed=1,cleanup_branch_removed=1,diagnostic=NULL WHERE mission_id=?1",
            [&mission_id],
        ).unwrap();
        let cleaned = service.get(&db, &mission_id).unwrap().unwrap();
        assert!(cleaned.workspace_ever_created);
        assert!(!cleaned.workspace_resources_present);
        assert!(!cleaned.cleanup_available);
        assert_eq!(cleaned.workspace_cleanup.unwrap().state, "cleaned");
    }

    #[test]
    fn mission_attachments_are_editable_agent_readable_private_and_published_when_started() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let workspace = db.directory().join("mission-attachment-workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let first_path = workspace.join("first brief.md");
        let directory_path = workspace.join("reference material");
        let second_path = workspace.join("replacement.png");
        std::fs::write(&first_path, "first brief").unwrap();
        std::fs::create_dir(&directory_path).unwrap();
        std::fs::write(&second_path, b"replacement image").unwrap();
        let first = crate::local_attachment_source::observe_source_attachment(
            &first_path,
            "first brief.md",
            Some("text/markdown"),
        )
        .unwrap();
        let directory = crate::local_attachment_source::observe_source_attachment(
            &directory_path,
            "reference material",
            None,
        )
        .unwrap();
        let second = crate::local_attachment_source::observe_source_attachment(
            &second_path,
            "replacement.png",
            Some("image/png"),
        )
        .unwrap();
        let service = MissionService::default();
        let created = service
            .create(
                &mut db,
                &command(CreateMissionCommand {
                    title: "带附件的使命".into(),
                    description: "附件应随使命定义保存，并在开始时交付。".into(),
                    project_path: workspace.to_string_lossy().into_owned(),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec!["附件".into()],
                    source_attachments: vec![first.clone(), directory.clone()],
                }),
            )
            .unwrap();
        let mission_id = created.result.payload["missionId"]
            .as_str()
            .unwrap()
            .to_string();
        let initial = service.get(&db, &mission_id).unwrap().unwrap();
        assert_eq!(initial.attachments.len(), 2);
        assert_eq!(initial.attachments[0].id, first.id);
        assert_eq!(initial.attachments[1].id, directory.id);
        assert_eq!(initial.details_version, 1);
        let initial_agent = initial.agent_info();
        assert_eq!(initial_agent.mission_id, mission_id);
        assert_eq!(initial_agent.attachments[0].attachment_id, first.id);
        assert_eq!(initial_agent.attachments[0].file_count, Some(1));
        assert_eq!(
            initial_agent.attachments[0].path,
            first_path.to_string_lossy()
        );
        assert_eq!(initial_agent.attachments[1].attachment_id, directory.id);
        assert_eq!(initial_agent.attachments[1].file_count, None);
        assert_eq!(
            initial_agent.attachments[1].path,
            directory_path.to_string_lossy()
        );
        let public_record = serde_json::to_string(&initial).unwrap();
        assert!(public_record.contains("first brief.md"));
        assert!(!public_record.contains(first_path.to_str().unwrap()));
        assert!(!public_record.contains(directory_path.to_str().unwrap()));

        let updated = service
            .update(
                &mut db,
                &command(UpdateMissionCommand {
                    mission_id: mission_id.clone(),
                    title: None,
                    description: None,
                    tags: None,
                    expected_details_version: Some(1),
                    source_attachment_update: Some(MissionAttachmentUpdate {
                        keep_attachment_ids: vec![directory.id.clone()],
                        new_source_attachments: vec![second.clone()],
                    }),
                }),
            )
            .unwrap();
        assert_eq!(updated.result.payload["changed"], true);
        std::fs::remove_dir(&directory_path).unwrap();
        std::fs::remove_file(&second_path).unwrap();
        let current = service.get(&db, &mission_id).unwrap().unwrap();
        assert_eq!(current.details_version, 2);
        assert_eq!(current.attachments.len(), 2);
        assert_eq!(current.attachments[0].id, directory.id);
        assert_eq!(current.attachments[1].id, second.id);
        let current_agent = current.agent_info();
        assert_eq!(current_agent.attachments[0].attachment_id, directory.id);
        assert_eq!(current_agent.attachments[0].file_count, None);
        assert_eq!(
            current_agent.attachments[0].path,
            directory_path.to_string_lossy()
        );
        assert_eq!(current_agent.attachments[1].attachment_id, second.id);
        assert_eq!(current_agent.attachments[1].file_count, Some(1));
        assert_eq!(
            current_agent.attachments[1].path,
            second_path.to_string_lossy()
        );
        assert_eq!(
            service
                .activity(&db, &mission_id, None)
                .unwrap()
                .into_iter()
                .find(|activity| activity.kind == "updated")
                .unwrap()
                .changes,
            json!({"attachmentsChanged": true})
        );

        let started = service
            .start(
                &mut db,
                &command(StartMissionCommand {
                    mission_id: mission_id.clone(),
                }),
            )
            .unwrap();
        let message_id = started.result.payload["campMessageId"].as_str().unwrap();
        let published_json: String = db
            .connection()
            .query_row(
                "SELECT source_attachments_json FROM camp_message WHERE id=?1",
                [message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            crate::local_attachment_source::parse_source_attachments(&published_json).unwrap(),
            vec![directory, second]
        );
    }

    #[test]
    fn mission_delivery_collects_agent_source_attachments_without_reading_the_source() {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("mission-delivery-workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let service = MissionService::default();
        let created = service
            .create(
                &mut database,
                &command(CreateMissionCommand {
                    title: "非 Git 交付".into(),
                    description: String::new(),
                    project_path: workspace.to_string_lossy().into_owned(),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec![],
                    source_attachments: vec![],
                }),
            )
            .unwrap();
        let mission_id = created.result.payload["missionId"].as_str().unwrap();
        let mission = service.get(&database, mission_id).unwrap().unwrap();
        let missing_source = workspace.join("historical-delivery.html");
        assert!(!missing_source.exists());
        let source = LocalAttachmentSourceRef {
            id: Uuid::new_v4().to_string(),
            source_path: missing_source.to_string_lossy().into_owned(),
            display_name: "historical-delivery.html".into(),
            kind: crate::local_attachment_source::LocalAttachmentKind::File,
            media_type: Some("text/html".into()),
            observed_byte_size: Some(19_823),
        };
        let message_id = Uuid::new_v4().to_string();
        let created_at = "2026-09-20T07:38:20Z";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, source_attachments_json,
                    address_mode, addressed_agent_ids_json, created_at, updated_at
                ) VALUES (?1, ?2, 1, 'agent', 'agent_1', '附件', '[]', ?3,
                          'broadcast', '[]', ?4, ?4)
                "#,
                params![
                    message_id,
                    mission.camp_id,
                    serialize_source_attachments(std::slice::from_ref(&source)).unwrap(),
                    created_at,
                ],
            )
            .unwrap();

        assert_eq!(
            service.delivery_files(&database, &mission.camp_id).unwrap(),
            vec![MissionDeliveryFile {
                attachment_id: source.id,
                display_name: source.display_name,
                media_type: "text/html".into(),
                byte_size: 19_823,
                preview_kind: "none".into(),
                message_id,
                agent_id: "agent_1".into(),
                created_at: created_at.into(),
                kind: "file".into(),
                file_count: 1,
            }]
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM managed_attachment), \
                            (SELECT COUNT(*) FROM camp_message_attachment_ref)",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap(),
            (0, 0)
        );
        assert!(!missing_source.exists());
    }

    #[test]
    fn agent_mission_ids_and_list_pagination_are_opaque_and_filter_bound() {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("mission-list-workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let service = MissionService::default();
        let mut internal_ids = Vec::new();
        for title in ["Alpha", "Beta 附件", "Gamma", "Delta"] {
            let created = service
                .create(
                    &mut database,
                    &command(CreateMissionCommand {
                        title: title.into(),
                        description: format!("{title} details"),
                        project_path: workspace.to_string_lossy().into_owned(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        member_agent_ids: vec!["agent_1".into()],
                        default_lead_agent_id: "agent_1".into(),
                        tags: vec![],
                        source_attachments: vec![],
                    }),
                )
                .unwrap();
            internal_ids.push(
                created.result.payload["missionId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        service
            .status(
                &mut database,
                &command(StatusMissionCommand {
                    mission_id: internal_ids[2].clone(),
                    status: MissionStatus::Completed,
                    source_message_id: None,
                }),
            )
            .unwrap();

        let first = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    limit: Some(2),
                    ..MissionListInput::default()
                },
            )
            .unwrap();
        assert_eq!(
            first
                .missions
                .iter()
                .map(|mission| mission.mission_id.as_str())
                .collect::<Vec<_>>(),
            vec![internal_ids[3].as_str(), internal_ids[2].as_str()]
        );
        assert!(first.has_more);
        service
            .create(
                &mut database,
                &command(CreateMissionCommand {
                    title: "Epsilon".into(),
                    description: "Created between keyset pages".into(),
                    project_path: workspace.to_string_lossy().into_owned(),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: vec!["agent_1".into()],
                    default_lead_agent_id: "agent_1".into(),
                    tags: vec![],
                    source_attachments: vec![],
                }),
            )
            .unwrap();
        let second = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    limit: Some(2),
                    cursor: first.next_cursor.clone(),
                    ..MissionListInput::default()
                },
            )
            .unwrap();
        assert_eq!(
            second
                .missions
                .iter()
                .map(|mission| mission.mission_id.as_str())
                .collect::<Vec<_>>(),
            vec![internal_ids[1].as_str(), internal_ids[0].as_str()]
        );
        assert!(!second.has_more);
        assert!(second.next_cursor.is_none());

        for invalid in [
            MissionListInput {
                limit: Some(0),
                ..MissionListInput::default()
            },
            MissionListInput {
                cursor: Some("not-a-cursor".into()),
                ..MissionListInput::default()
            },
        ] {
            assert!(service.list_for_agent(&database, &invalid).is_err());
        }

        let by_title = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    query: Some("附件".into()),
                    ..MissionListInput::default()
                },
            )
            .unwrap();
        assert_eq!(by_title.missions[0].mission_id, internal_ids[1]);
        let by_id = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    query: Some(internal_ids[2].clone()),
                    ..MissionListInput::default()
                },
            )
            .unwrap();
        assert_eq!(by_id.missions[0].title, "Gamma");
        let completed = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    status: Some(MissionStatus::Completed),
                    ..MissionListInput::default()
                },
            )
            .unwrap();
        assert_eq!(completed.missions[0].mission_id, internal_ids[2]);

        let mismatched_cursor = service
            .list_for_agent(
                &database,
                &MissionListInput {
                    status: Some(MissionStatus::Completed),
                    limit: Some(2),
                    cursor: first.next_cursor,
                    ..MissionListInput::default()
                },
            )
            .unwrap_err();
        assert_eq!(
            mismatched_cursor
                .downcast_ref::<MissionAgentInputError>()
                .unwrap()
                .code(),
            "mission.invalid_cursor"
        );

        let selected = service.get(&database, &internal_ids[3]).unwrap().unwrap();
        assert_eq!(selected.info.mission_id, internal_ids[3]);
        assert_eq!(selected.agent_info().mission_id, internal_ids[3]);
        assert!(service.get(&database, "rvm_missing").unwrap().is_none());
    }
}
