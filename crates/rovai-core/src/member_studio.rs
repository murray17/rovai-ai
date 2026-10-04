use std::path::Path;

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::{
        AgentProfileService, CreateAgentProfileCommand, validate_member_identity_input,
    },
    command::{ActorRef, CommandEnvelope, CommandExecution, CommandGatewayError},
    current_user::CURRENT_USER_ID,
    db::Database,
    member_avatar::{
        MemberAvatarImportError, MemberAvatarImportErrorKind, import_managed_member_avatar,
    },
    team_tool::AuthenticatedTeamToolRun,
};

pub const MEMBER_CREATE_TOOL_NAME: &str = "member.create";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberCreateInput {
    pub creation_key: String,
    pub display_name: String,
    #[serde(default)]
    pub team_role: String,
    #[serde(default)]
    pub professional_responsibilities: String,
    #[serde(default)]
    pub personality_traits: Vec<String>,
    #[serde(default)]
    pub working_principles: String,
    #[serde(default)]
    pub growth_topic: String,
    #[serde(default)]
    pub avatar_file: Option<String>,
}

#[derive(Debug)]
pub struct MemberCreateOutcome {
    pub execution: CommandExecution,
    pub avatar_ref: Option<String>,
}

#[derive(Debug)]
pub struct MemberCreateError {
    pub code: &'static str,
    pub message: &'static str,
    pub details: Option<Value>,
}

impl std::fmt::Display for MemberCreateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MemberCreateError {}

pub fn member_create_input_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["creationKey", "displayName"],
        "properties": {
            "creationKey": {
                "type": "string",
                "format": "uuid",
                "description": "A new canonical lowercase UUID. Reuse it only when retrying this exact confirmed member creation."
            },
            "displayName": {"type": "string", "minLength": 1, "maxLength": 80},
            "teamRole": {"type": "string", "maxLength": 120, "default": ""},
            "professionalResponsibilities": {"type": "string", "maxLength": 300, "default": ""},
            "personalityTraits": {
                "type": "array", "maxItems": 6, "default": [],
                "items": {"type": "string", "minLength": 1, "maxLength": 16}
            },
            "workingPrinciples": {"type": "string", "maxLength": 300, "default": ""},
            "growthTopic": {"type": "string", "maxLength": 300, "default": ""},
            "avatarFile": {
                "type": "string", "minLength": 1, "maxLength": 4096,
                "description": "Optional run-readable local PNG or JPEG path. Rovai normalizes and imports it; the path is never persisted."
            }
        }
    })
}

pub fn create_member(
    database: &mut Database,
    data_dir: &Path,
    authenticated_run: &AuthenticatedTeamToolRun,
    input: MemberCreateInput,
) -> Result<MemberCreateOutcome> {
    require_direct_user_trigger(database, authenticated_run)?;
    let creation_id = Uuid::parse_str(&input.creation_key)
        .ok()
        .filter(|parsed| parsed.hyphenated().to_string() == input.creation_key)
        .ok_or_else(invalid_creation_key)?;
    validate_member_identity_input(
        &input.display_name,
        &input.team_role,
        &input.professional_responsibilities,
        &input.personality_traits,
        &input.working_principles,
        &input.growth_topic,
    )
    .map_err(|_| MemberCreateError {
        code: "member.invalid_identity",
        message: "One or more member identity fields are invalid; fix the confirmed card and try again",
        details: None,
    })?;

    let avatar_ref = input
        .avatar_file
        .as_deref()
        .map(Path::new)
        .map(|path| import_managed_member_avatar(data_dir, creation_id, path))
        .transpose()
        .map_err(map_avatar_error)?
        .map(|summary| summary.avatar_ref);

    let envelope = CommandEnvelope {
        command_id: format!("member-create:{creation_id}"),
        actor: ActorRef::User {
            user_id: CURRENT_USER_ID.to_string(),
        },
        camp_id: None,
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: CreateAgentProfileCommand {
            display_name: input.display_name,
            avatar_ref: avatar_ref.clone(),
            team_role: input.team_role,
            professional_responsibilities: input.professional_responsibilities,
            personality_traits: input.personality_traits,
            working_principles: input.working_principles,
            growth_topic: input.growth_topic,
        },
    };
    let execution = AgentProfileService::default()
        .create_profile_with_creation_source(database, &envelope, Some(authenticated_run))
        .map_err(|error| {
            if error.downcast_ref::<CommandGatewayError>().is_some() {
                anyhow::Error::new(MemberCreateError {
                    code: "member.creation_key_conflict",
                    message: "creationKey was already used with different member details",
                    details: None,
                })
            } else {
                error
            }
        })?;
    Ok(MemberCreateOutcome {
        execution,
        avatar_ref,
    })
}

/// Immutable product receipt. This is not a CampMessage or model input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCreationView {
    pub creation_id: String,
    #[serde(default)]
    pub source_agent_run_id: Option<String>,
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub team_role: String,
    pub professional_responsibilities: String,
    pub personality_traits: Vec<String>,
    pub creator_agent_id: String,
    pub creator_display_name: String,
    pub created_at: String,
}

pub(crate) fn record_member_creation(
    transaction: &Transaction<'_>,
    source: &AuthenticatedTeamToolRun,
    receipt: &MemberCreationView,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO member_creation(creation_id, camp_id, snapshot_json, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![receipt.creation_id, source.camp_id, serde_json::to_string(receipt)?, receipt.created_at],
    )?;
    transaction.execute(
        "INSERT INTO member_creation_preference(singleton, helper_agent_id) VALUES (1, ?1)
         ON CONFLICT(singleton) DO UPDATE SET helper_agent_id=excluded.helper_agent_id",
        [&source.agent_id],
    )?;
    Ok(())
}

pub(crate) fn last_creation_helper(connection: &Connection) -> Result<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT helper_agent_id FROM member_creation_preference WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .optional()?)
}

pub(crate) fn list_member_creations(
    connection: &Connection,
    camp_id: &str,
) -> Result<Vec<MemberCreationView>> {
    let mut statement = connection.prepare("SELECT snapshot_json FROM member_creation WHERE camp_id=?1 ORDER BY created_at, creation_id")?;
    let rows = statement
        .query_map([camp_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| Ok(serde_json::from_str(&row)?))
        .collect()
}

fn require_direct_user_trigger(
    database: &Database,
    authenticated_run: &AuthenticatedTeamToolRun,
) -> Result<()> {
    let trigger = database
        .connection()
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run_input
                JOIN camp_message ON camp_message.id = agent_run_input.message_id
                WHERE agent_run_input.agent_run_id = agent_run.id
                  AND camp_message.author_type = 'user'
                  AND camp_message.camp_id = ?3
            )
            FROM agent_run
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
            "#,
            params![
                authenticated_run.agent_run_id,
                authenticated_run.execution_epoch,
                authenticated_run.camp_id,
            ],
            |row| row.get::<_, bool>(0),
        )
        .optional()?;
    if trigger == Some(true) {
        return Ok(());
    }
    Err(MemberCreateError {
        code: "member.user_confirmation_required",
        message: "Create a member only from a direct user-triggered run after showing the final member card and receiving confirmation",
        details: None,
    }
    .into())
}

fn invalid_creation_key() -> MemberCreateError {
    MemberCreateError {
        code: "member.invalid_creation_key",
        message: "creationKey must be a canonical lowercase UUID",
        details: None,
    }
}

fn map_avatar_error(error: MemberAvatarImportError) -> MemberCreateError {
    match error.kind {
        MemberAvatarImportErrorKind::Invalid => MemberCreateError {
            code: "member.avatar_invalid",
            message: "The avatar file could not be safely imported; fix the image or retry without --avatar-file",
            details: None,
        },
        MemberAvatarImportErrorKind::CreationKeyConflict => MemberCreateError {
            code: "member.creation_key_conflict",
            message: "creationKey is already bound to a different avatar",
            details: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_create_schema_keeps_avatar_file_optional() {
        let schema = member_create_input_schema();
        assert_eq!(schema["required"], json!(["creationKey", "displayName"]));
        assert_eq!(schema["properties"]["avatarFile"]["type"], "string");
    }
}
