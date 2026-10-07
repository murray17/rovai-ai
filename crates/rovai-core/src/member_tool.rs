//! Agent-facing identity operations. Reads are deliberately separate from the
//! desktop's full runtime-bearing Profile view; writes use the existing gateway.
use std::path::Path;

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::{normalize_member_identity, profile_display_name_exists},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
    member_avatar::{
        MemberAvatarCrop, MemberAvatarImportError, MemberAvatarImportErrorKind,
        materialize_member_avatar, member_avatar_content_matches, prepare_member_avatar,
        recrop_member_avatar,
    },
    member_studio::{MemberOperationError, has_direct_user_input},
    team_tool::AuthenticatedTeamToolRun,
};

pub const MEMBER_LIST_TOOL_NAME: &str = "member.list";
pub const MEMBER_GET_TOOL_NAME: &str = "member.get";
pub const MEMBER_UPDATE_TOOL_NAME: &str = "member.update";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberGetInput {
    pub agent_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberUpdateInput {
    pub request_id: String,
    pub agent_id: String,
    pub expected_version: i64,
    pub display_name: Option<String>,
    pub team_role: Option<String>,
    pub professional_responsibilities: Option<String>,
    pub personality_traits: Option<Vec<String>>,
    pub working_principles: Option<String>,
    pub growth_topic: Option<String>,
    // Never persist a caller's local file path in command.result's request digest.
    #[serde(skip_serializing)]
    pub avatar_file: Option<String>,
    pub avatar_center_x: Option<f64>,
    pub avatar_center_y: Option<f64>,
    pub avatar_size: Option<f64>,
    pub clear_avatar: Option<bool>,
}

impl MemberUpdateInput {
    pub fn validate(&self) -> Result<()> {
        if Uuid::parse_str(&self.request_id)
            .ok()
            .is_none_or(|id| id.to_string() != self.request_id)
            || self.expected_version < 1
            || self.agent_id.is_empty()
        {
            return Err(invalid_patch().into());
        }
        let crop_count = [self.avatar_center_x, self.avatar_center_y, self.avatar_size]
            .iter()
            .filter(|value| value.is_some())
            .count();
        if (crop_count != 0 && crop_count != 3)
            || (self.clear_avatar == Some(true) && (self.avatar_file.is_some() || crop_count != 0))
            || (self.display_name.is_none()
                && self.team_role.is_none()
                && self.professional_responsibilities.is_none()
                && self.personality_traits.is_none()
                && self.working_principles.is_none()
                && self.growth_topic.is_none()
                && self.avatar_file.is_none()
                && crop_count == 0
                && self.clear_avatar != Some(true))
        {
            return Err(invalid_patch().into());
        }
        Ok(())
    }

    fn crop(&self) -> Option<MemberAvatarCrop> {
        Some(MemberAvatarCrop {
            center_x: self.avatar_center_x?,
            center_y: self.avatar_center_y?,
            size: self.avatar_size?,
        })
    }
}

#[derive(Debug, Serialize)]
struct PatchMemberCommand {
    caller_agent_id: String,
    input: MemberUpdateInput,
    prepared_avatar_ref: Option<String>,
    avatar_input_digest: Option<String>,
}
impl sealed::Sealed for PatchMemberCommand {}
impl DomainCommand for PatchMemberCommand {
    const TYPE: &'static str = "member.update";
}

fn denied() -> MemberOperationError {
    MemberOperationError {
        code: "member.access_denied",
        message: "The member is not available in your authorized Thread scope",
        details: None,
    }
}
fn invalid_patch() -> MemberOperationError {
    MemberOperationError {
        code: "member.invalid_patch",
        message: "Provide a valid requestId, version and at least one intended change; supply crop fields together and do not combine clearAvatar with an image change",
        details: None,
    }
}
fn invalid_image() -> MemberOperationError {
    MemberOperationError {
        code: "member.avatar_invalid",
        message: "The image could not be safely prepared; fix the image without dropping the requested image change",
        details: None,
    }
}

/// Called after binding/lease authentication, including before a cached replay.
/// Creation scope is backed by the existing immutable Core receipt, not input.
pub fn authorize_member_target(
    connection: &Connection,
    run: &AuthenticatedTeamToolRun,
    agent_id: &str,
    update: bool,
) -> Result<()> {
    let allowed: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_profile p WHERE p.id=?1 AND p.profile_status != 'removed'
         AND (EXISTS(SELECT 1 FROM camp_member m WHERE m.camp_id=?2 AND m.agent_id=p.id AND m.status='active' AND m.leave_requested_at IS NULL)
          OR EXISTS(SELECT 1 FROM member_creation c WHERE c.camp_id=?2
            AND json_extract(c.snapshot_json,'$.agentId')=p.id
            AND json_extract(c.snapshot_json,'$.creatorAgentId')=?3
            AND json_extract(c.snapshot_json,'$.sourceAgentRunId') IS NOT NULL)))",
        params![agent_id, run.camp_id, run.agent_id], |row| row.get(0))?;
    if !allowed {
        return Err(denied().into());
    }
    if update && !has_direct_user_input(connection, run)? {
        return Err(MemberOperationError { code: "member.user_confirmation_required", message: "Update a global member Profile only at the User's explicit request in a direct user-triggered Run", details: None }.into());
    }
    Ok(())
}

pub fn list_members(connection: &Connection, run: &AuthenticatedTeamToolRun) -> Result<Value> {
    let mut statement = connection.prepare(
        "SELECT p.id,p.display_name,p.team_role,p.professional_responsibilities,COALESCE(p.id=c.default_lead_agent_id,0)
         FROM camp_member m JOIN agent_profile p ON p.id=m.agent_id JOIN camp c ON c.id=m.camp_id
         WHERE m.camp_id=?1 AND m.status='active' AND m.leave_requested_at IS NULL AND p.profile_status!='removed'
         ORDER BY p.member_order,p.id")?;
    let items = statement.query_map([&run.camp_id], |row| Ok(json!({
        "agentId": row.get::<_,String>(0)?, "displayName": row.get::<_,String>(1)?,
        "teamRole": row.get::<_,String>(2)?, "professionalResponsibilities": row.get::<_,String>(3)?,
        "isDefaultLead": row.get::<_,bool>(4)?,
    })))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({"threadId": run.camp_id, "items": items}))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberIdentitySnapshot {
    agent_id: String,
    display_name: String,
    team_role: String,
    professional_responsibilities: String,
    personality_traits: Vec<String>,
    working_principles: String,
    growth_topic: String,
    version: i64,
    #[serde(skip)]
    avatar_ref: Option<String>,
}

fn identity_snapshot(connection: &Connection, agent_id: &str) -> Result<MemberIdentitySnapshot> {
    connection.query_row(
        "SELECT display_name,team_role,professional_responsibilities,personality_traits_json,working_principles,growth_topic,version,avatar_ref FROM agent_profile WHERE id=?1 AND profile_status!='removed'",
        [agent_id], |row| {
            let traits: String = row.get(3)?;
            Ok(MemberIdentitySnapshot {
                agent_id: agent_id.to_string(), display_name: row.get(0)?, team_role: row.get(1)?,
                professional_responsibilities: row.get(2)?,
                personality_traits: serde_json::from_str(&traits).map_err(|error| rusqlite::Error::FromSqlConversionFailure(3,rusqlite::types::Type::Text,Box::new(error)))?,
                working_principles: row.get(4)?,growth_topic: row.get(5)?,version: row.get(6)?,avatar_ref: row.get(7)?,
            })
        }).optional()?.ok_or_else(|| denied().into())
}

pub fn get_member(
    connection: &Connection,
    data_dir: &Path,
    run_tmp: &Path,
    run: &AuthenticatedTeamToolRun,
    input: &MemberGetInput,
) -> Result<Value> {
    authorize_member_target(connection, run, &input.agent_id, false)?;
    let snapshot = identity_snapshot(connection, &input.agent_id)?;
    let mut result = serde_json::to_value(&snapshot)?;
    let mut paths = json!({"icon": null, "portrait": null});
    let mut statuses = json!({"icon": "absent", "portrait": "absent"});
    if let Some(avatar_ref) = snapshot.avatar_ref.as_deref() {
        for (variant, portrait) in [("icon", false), ("portrait", true)] {
            match materialize_member_avatar(data_dir, run_tmp, avatar_ref, portrait) {
                Ok(path) => {
                    paths[variant] = json!(path);
                    statuses[variant] = json!("available");
                }
                Err(_) => {
                    statuses[variant] = json!("unavailable");
                }
            }
        }
    }
    result["images"] = paths;
    result["imageStatus"] = statuses;
    Ok(result)
}

pub fn update_member(
    database: &mut Database,
    data_dir: &Path,
    run: &AuthenticatedTeamToolRun,
    input: MemberUpdateInput,
) -> Result<CommandExecution> {
    input.validate()?;
    authorize_member_target(database.connection(), run, &input.agent_id, true)?;
    // Bind an upload to the existing immutable asset format using this same
    // request identity, just as create binds its source to creationKey. This
    // lets durable replay survive cleanup of the original Run-readable file.
    let prepared_avatar_ref = input
        .avatar_file
        .as_ref()
        .map(|_| format!("rovai://member-avatar/managed/{}", input.request_id));
    let avatar_input_digest = input
        .avatar_file
        .as_ref()
        .map(|path| canonical_json_digest(&json!(path)))
        .transpose()?;
    let envelope = CommandEnvelope {
        command_id: format!("member-update:{}", input.request_id),
        actor: ActorRef::User {
            user_id: CURRENT_USER_ID.to_string(),
        },
        camp_id: Some(run.camp_id.clone()),
        expected_versions: vec![],
        execution_epoch: None,
        payload: PatchMemberCommand {
            caller_agent_id: run.agent_id.clone(),
            input,
            prepared_avatar_ref,
            avatar_input_digest,
        },
    };
    let gateway = DomainCommandGateway::default();
    let recorded = gateway.replay_if_recorded(database, &envelope)?;
    if let Some(path) = envelope.payload.input.avatar_file.as_deref() {
        let path = Path::new(path);
        if !path.try_exists().map_err(|_| invalid_image())? {
            if let Some(recorded) = recorded {
                return Ok(recorded);
            }
            return Err(invalid_image().into());
        }
        prepare_member_avatar(
            data_dir,
            Uuid::parse_str(&envelope.payload.input.request_id)?,
            path,
            envelope.payload.input.crop(),
            recorded.is_some(),
        )
        .map_err(|error| {
            if error
                .downcast_ref::<MemberAvatarImportError>()
                .is_some_and(|error| error.kind == MemberAvatarImportErrorKind::CreationKeyConflict)
            {
                MemberOperationError {
                    code: "builtin_tool.idempotency_conflict",
                    message: "requestId is already bound to a different image",
                    details: None,
                }
            } else {
                invalid_image()
            }
        })?;
    }
    if let Some(recorded) = recorded {
        return Ok(recorded);
    }
    // Prepare against a versioned snapshot before opening the write transaction.
    // The transaction checks that version again before using this reference.
    let input = &envelope.payload.input;
    let snapshot = identity_snapshot(database.connection(), &input.agent_id)?;
    let mut next_avatar_ref = snapshot.avatar_ref.clone();
    if snapshot.version == input.expected_version {
        next_avatar_ref = if input.clear_avatar == Some(true) {
            None
        } else if let Some(prepared) = envelope.payload.prepared_avatar_ref.as_ref() {
            Some(prepared.clone())
        } else if let Some(crop) = input.crop() {
            let source = snapshot.avatar_ref.as_deref().ok_or_else(invalid_image)?;
            Some(
                recrop_member_avatar(data_dir, source, crop)
                    .map_err(|_| invalid_image())?
                    .avatar_ref,
            )
        } else {
            snapshot.avatar_ref.clone()
        };
        if let (Some(current), Some(next)) =
            (snapshot.avatar_ref.as_deref(), next_avatar_ref.as_deref())
        {
            if member_avatar_content_matches(data_dir, current, next).unwrap_or(false) {
                next_avatar_ref = snapshot.avatar_ref.clone();
            }
        }
    }
    gateway.execute(database, &envelope, |transaction| {
        let input = &envelope.payload.input;
        authorize_member_target(transaction, run, &input.agent_id, true)?;
        let current = identity_snapshot(transaction, &input.agent_id)?;
        if current.version != input.expected_version {
            return Ok(CommandHandlerResult::rejected(
                "version_conflict",
                json!({ "currentVersion": current.version }),
            ));
        }
        let next = normalize_member_identity(
            input.display_name.as_deref().unwrap_or(&current.display_name),
            input.team_role.as_deref().unwrap_or(&current.team_role),
            input.professional_responsibilities.as_deref()
                .unwrap_or(&current.professional_responsibilities),
            input.personality_traits.as_deref().unwrap_or(&current.personality_traits),
            input.working_principles.as_deref().unwrap_or(&current.working_principles),
            input.growth_topic.as_deref().unwrap_or(&current.growth_topic),
        ).map_err(|_| MemberOperationError {
            code: "member.invalid_identity",
            message: "One or more member identity fields are invalid",
            details: None,
        })?;
        if profile_display_name_exists(transaction, &next.display_name, Some(&input.agent_id))? {
            return Ok(CommandHandlerResult::rejected(
                "agent_profile.display_name_conflict",
                json!({ "displayName": next.display_name }),
            ));
        }
        let avatar_ref = &next_avatar_ref;
        let changed = next.display_name != current.display_name
            || next.team_role != current.team_role
            || next.professional_responsibilities != current.professional_responsibilities
            || next.personality_traits != current.personality_traits
            || next.working_principles != current.working_principles
            || next.growth_topic != current.growth_topic
            || avatar_ref != &current.avatar_ref;
        if changed {
            transaction.execute(
                "UPDATE agent_profile
                 SET display_name=?2, team_role=?3, professional_responsibilities=?4,
                     personality_traits_json=?5, working_principles=?6, growth_topic=?7,
                     avatar_ref=?8, version=version+1, updated_at=?9
                 WHERE id=?1 AND version=?10",
                params![
                    input.agent_id, next.display_name, next.team_role,
                    next.professional_responsibilities, serde_json::to_string(&next.personality_traits)?,
                    next.working_principles, next.growth_topic, avatar_ref,
                    chrono::Utc::now().to_rfc3339(), input.expected_version,
                ],
            )?;
        }
        Ok(CommandHandlerResult::applied(
            "member.updated",
            json!({"agentId": input.agent_id, "version": current.version + i64::from(changed), "changed": changed}),
            Some(EntityReference {
                entity_type: "agent_profile".into(),
                entity_id: input.agent_id.clone(),
            }),
        ))
    })
}

pub fn member_list_input_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"properties":{}})
}
pub fn member_get_input_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["agentId"],"properties":{"agentId":{"type":"string","minLength":1}}})
}
pub fn member_update_input_schema() -> Value {
    let mut schema = crate::member_studio::member_create_input_schema();
    schema["required"] = json!(["requestId", "agentId", "expectedVersion"]);
    let fields = schema["properties"]
        .as_object_mut()
        .expect("identity schema properties");
    fields.remove("creationKey");
    for field in fields.values_mut() {
        field
            .as_object_mut()
            .expect("field schema")
            .remove("default");
    }
    fields.insert("requestId".into(), json!({"type":"string","format":"uuid"}));
    fields.insert("agentId".into(), json!({"type":"string","minLength":1}));
    fields.insert(
        "expectedVersion".into(),
        json!({"type":"integer","minimum":1}),
    );
    for field in ["avatarCenterX", "avatarCenterY"] {
        fields.insert(
            field.into(),
            json!({"type":"number","minimum":0,"maximum":1}),
        );
    }
    fields.insert(
        "avatarSize".into(),
        json!({"type":"number","minimum":0.12,"maximum":1}),
    );
    fields.insert("clearAvatar".into(), json!({"type":"boolean"}));
    schema
}

pub fn member_list_output_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["threadId","items"],"properties":{
        "threadId":{"type":"string"},"items":{"type":"array","items":{
            "type":"object","additionalProperties":false,
            "required":["agentId","displayName","teamRole","professionalResponsibilities","isDefaultLead"],
            "properties":{"agentId":{"type":"string"},"displayName":{"type":"string"},"teamRole":{"type":"string"},"professionalResponsibilities":{"type":"string"},"isDefaultLead":{"type":"boolean"}}
        }}
    }})
}
pub fn member_get_output_schema() -> Value {
    let image_status = json!({"type":"string","enum":["available","absent","unavailable"]});
    json!({"type":"object","additionalProperties":false,
        "required":["agentId","displayName","teamRole","professionalResponsibilities","personalityTraits","workingPrinciples","growthTopic","version","images","imageStatus"],
        "properties":{
            "agentId":{"type":"string"},"displayName":{"type":"string"},"teamRole":{"type":"string"},"professionalResponsibilities":{"type":"string"},
            "personalityTraits":{"type":"array","items":{"type":"string"}},"workingPrinciples":{"type":"string"},"growthTopic":{"type":"string"},"version":{"type":"integer","minimum":1},
            "images":{"type":"object","additionalProperties":false,"required":["icon","portrait"],"properties":{"icon":{"type":["string","null"]},"portrait":{"type":["string","null"]}}},
            "imageStatus":{"type":"object","additionalProperties":false,"required":["icon","portrait"],"properties":{"icon":image_status,"portrait":image_status}}
        }
    })
}
pub fn member_update_output_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["agentId","version","changed"],"properties":{"agentId":{"type":"string"},"version":{"type":"integer","minimum":1},"changed":{"type":"boolean"}}})
}
