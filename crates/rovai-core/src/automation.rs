use std::{collections::BTreeSet, path::Path, str::FromStr};

use anyhow::{Context, Result};
use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime,
    SecondsFormat, TimeZone, Utc,
};
use croner::{
    Cron,
    parser::{CronParser, Seconds, Year},
};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    channel::ClaimedChannelDelivery,
    collaboration::{CollaborationService, ProjectBindingKind, ScheduledAutomationAdmissionInput},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
    runtime::{cancel_automation_camp_turn_in_tx, pump_targets_after_runs_terminal},
};

pub const AUTOMATION_RUNTIME_TIMEOUT_SECONDS: i64 = 60 * 60;
pub const AUTOMATION_LIST_TOOL_NAME: &str = "automation.list";
pub const AUTOMATION_GET_TOOL_NAME: &str = "automation.get";
pub const AUTOMATION_CREATE_TOOL_NAME: &str = "automation.create";
pub const AUTOMATION_RUN_TOOL_NAME: &str = "automation.run";
pub const AUTOMATION_CLOSE_TOOL_NAME: &str = "automation.close";
pub const AUTOMATION_UPDATE_TOOL_NAME: &str = "automation.update";
pub const AUTOMATION_DELETE_TOOL_NAME: &str = "automation.delete";
const MAX_PROMPT_SCALARS: usize = 100_000;
const MAX_NAME_SCALARS: usize = 80;
const MAX_LIST_LIMIT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationNotifyChannel {
    Feishu,
    Dingtalk,
}

impl AutomationNotifyChannel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Feishu => "feishu",
            Self::Dingtalk => "dingtalk",
        }
    }
}

impl FromStr for AutomationNotifyChannel {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "feishu" => Ok(Self::Feishu),
            "dingtalk" => Ok(Self::Dingtalk),
            _ => anyhow::bail!("unsupported Automation notification channel: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationWeekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl AutomationWeekday {
    const fn number_from_monday(self) -> u32 {
        match self {
            Self::Monday => 1,
            Self::Tuesday => 2,
            Self::Wednesday => 3,
            Self::Thursday => 4,
            Self::Friday => 5,
            Self::Saturday => 6,
            Self::Sunday => 7,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationSchedule {
    Daily {
        at: String,
    },
    Weekdays {
        at: String,
    },
    Weekly {
        weekday: AutomationWeekday,
        at: String,
    },
    Once {
        date: String,
        at: String,
    },
    Cron {
        expression: String,
    },
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationProjectRef {
    QuickChat,
    Directory { path: String },
}

impl AutomationProjectRef {
    pub fn binding_kind(&self) -> ProjectBindingKind {
        match self {
            Self::QuickChat => ProjectBindingKind::QuickChat,
            Self::Directory { .. } => ProjectBindingKind::Directory,
        }
    }

    fn execution_path(&self, quick_chat_path: &Path) -> String {
        match self {
            Self::QuickChat => quick_chat_path.to_string_lossy().into_owned(),
            Self::Directory { path } => path.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateAutomationCommand {
    #[serde(default)]
    pub name: Option<String>,
    pub prompt: String,
    pub member_id: String,
    pub project_ref: AutomationProjectRef,
    pub schedule: AutomationSchedule,
    #[serde(default)]
    pub notify_channels: Vec<AutomationNotifyChannel>,
}

impl sealed::Sealed for CreateAutomationCommand {}
impl DomainCommand for CreateAutomationCommand {
    const TYPE: &'static str = "automation.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAutomationCommand {
    pub automation_id: String,
    pub expected_version: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub member_id: Option<String>,
    #[serde(default)]
    pub project_ref: Option<AutomationProjectRef>,
    #[serde(default)]
    pub schedule: Option<AutomationSchedule>,
    #[serde(default)]
    pub notify_channels: Option<Vec<AutomationNotifyChannel>>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

impl sealed::Sealed for UpdateAutomationCommand {}
impl DomainCommand for UpdateAutomationCommand {
    const TYPE: &'static str = "automation.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseAutomationCommand {
    pub automation_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for CloseAutomationCommand {}
impl DomainCommand for CloseAutomationCommand {
    const TYPE: &'static str = "automation.close";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteAutomationCommand {
    pub automation_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for DeleteAutomationCommand {}
impl DomainCommand for DeleteAutomationCommand {
    const TYPE: &'static str = "automation.delete";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunAutomationCommand {
    pub automation_id: String,
}

impl sealed::Sealed for RunAutomationCommand {}
impl DomainCommand for RunAutomationCommand {
    const TYPE: &'static str = "automation.run";
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationListQuery {
    #[serde(default)]
    pub status: AutomationStatusFilter,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub project: Option<AutomationProjectRef>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_list_limit")]
    pub limit: usize,
}

fn default_list_limit() -> usize {
    20
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStatusFilter {
    #[default]
    All,
    Enabled,
    Closed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunSummary {
    pub run_id: String,
    pub status: String,
    pub reason: Option<String>,
    pub scheduled_for: String,
    pub camp_id: Option<String>,
    pub result_message_id: Option<String>,
    pub notification_status: String,
    pub created_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    pub automation_id: String,
    pub version: i64,
    pub name: String,
    pub prompt: String,
    pub enabled: bool,
    pub member_id: String,
    pub project_ref: AutomationProjectRef,
    pub schedule: AutomationSchedule,
    pub notify_channels: Vec<AutomationNotifyChannel>,
    pub next_run_at: Option<String>,
    pub last_run: Option<AutomationRunSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationListPage {
    pub automations: Vec<AutomationView>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationListToolInput {
    #[serde(default)]
    pub status: AutomationStatusFilter,
    pub query: Option<String>,
    pub project: Option<String>,
    pub cursor: Option<String>,
    #[serde(default = "default_list_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationGetToolInput {
    pub automation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationCreateToolInput {
    pub name: Option<String>,
    pub prompt: String,
    pub member: Option<String>,
    pub project: Option<String>,
    pub repeat: String,
    pub at: Option<String>,
    pub weekday: Option<AutomationWeekday>,
    pub date: Option<String>,
    pub cron: Option<String>,
    #[serde(default)]
    pub notify: Vec<AutomationNotifyChannel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationUpdateToolInput {
    pub automation_id: String,
    pub expected_version: i64,
    pub name: Option<String>,
    pub prompt: Option<String>,
    pub member: Option<String>,
    pub project: Option<String>,
    pub repeat: Option<String>,
    pub at: Option<String>,
    pub weekday: Option<AutomationWeekday>,
    pub date: Option<String>,
    pub cron: Option<String>,
    #[serde(default)]
    pub notify: Vec<AutomationNotifyChannel>,
    #[serde(default)]
    pub clear_notify: bool,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationVersionedToolInput {
    pub automation_id: String,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationRunToolInput {
    pub automation_id: String,
}

pub fn schedule_from_tool_fields(
    repeat: &str,
    at: Option<&str>,
    weekday: Option<AutomationWeekday>,
    date: Option<&str>,
    cron: Option<&str>,
) -> Result<AutomationSchedule> {
    let schedule = match repeat {
        "daily" => AutomationSchedule::Daily {
            at: at.context("daily schedule requires --at")?.to_string(),
        },
        "weekdays" => AutomationSchedule::Weekdays {
            at: at.context("weekdays schedule requires --at")?.to_string(),
        },
        "weekly" => AutomationSchedule::Weekly {
            weekday: weekday.context("weekly schedule requires --weekday")?,
            at: at.context("weekly schedule requires --at")?.to_string(),
        },
        "once" => AutomationSchedule::Once {
            date: date.context("once schedule requires --date")?.to_string(),
            at: at.context("once schedule requires --at")?.to_string(),
        },
        "cron" => AutomationSchedule::Cron {
            expression: cron.context("cron schedule requires --cron")?.to_string(),
        },
        "manual" => AutomationSchedule::Manual,
        _ => anyhow::bail!("unsupported Automation repeat value: {repeat}"),
    };
    validate_schedule(&schedule)?;
    let unused = match repeat {
        "daily" | "weekdays" => weekday.is_some() || date.is_some() || cron.is_some(),
        "weekly" => date.is_some() || cron.is_some(),
        "once" => weekday.is_some() || cron.is_some(),
        "cron" => at.is_some() || weekday.is_some() || date.is_some(),
        "manual" => at.is_some() || weekday.is_some() || date.is_some() || cron.is_some(),
        _ => false,
    };
    if unused {
        anyhow::bail!("schedule fields do not match the selected repeat value");
    }
    Ok(schedule)
}

pub fn resolve_tool_automation_id(
    database: &Database,
    camp_id: &str,
    requested: &str,
) -> Result<String> {
    if requested != "current" {
        return Ok(requested.to_string());
    }
    database
        .connection()
        .query_row(
            "SELECT automation_id FROM automation_run WHERE camp_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
            [camp_id],
            |row| row.get(0),
        )
        .optional()?
        .context("The current conversation was not created by an Automation")
}

pub fn resolve_tool_member(
    database: &Database,
    current_agent_id: &str,
    requested: Option<&str>,
) -> Result<String> {
    let Some(requested) = requested.filter(|value| *value != "current") else {
        return Ok(current_agent_id.to_string());
    };
    let mut statement = database.connection().prepare(
        r#"
        SELECT id
        FROM agent_profile
        WHERE profile_status = 'present' AND (id = ?1 OR display_name = ?1)
        ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END, id
        LIMIT 2
        "#,
    )?;
    let matches = statement
        .query_map([requested], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    match matches.as_slice() {
        [member_id] => Ok(member_id.clone()),
        [] => anyhow::bail!("The selected member does not exist or is no longer present"),
        _ => anyhow::bail!("The member name is ambiguous; use the stable member ID"),
    }
}

pub fn resolve_tool_project(
    database: &Database,
    camp_id: &str,
    requested: &str,
) -> Result<AutomationProjectRef> {
    if requested == "quick-chat" {
        return Ok(AutomationProjectRef::QuickChat);
    }
    if requested != "current" {
        if !Path::new(requested).is_absolute() {
            anyhow::bail!("Automation project must be current, quick-chat, or an absolute path");
        }
        return Ok(AutomationProjectRef::Directory {
            path: requested.to_string(),
        });
    }
    let binding = database
        .connection()
        .query_row(
            "SELECT project_binding_kind, project_path FROM camp WHERE id = ?1",
            [camp_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .context("Current Camp project is unavailable")?;
    match binding.0.as_str() {
        "quick_chat" => Ok(AutomationProjectRef::QuickChat),
        "directory" => Ok(AutomationProjectRef::Directory { path: binding.1 }),
        _ => anyhow::bail!("Current Camp has no supported project binding"),
    }
}

#[derive(Debug, Clone)]
struct AutomationRecord {
    id: String,
    version: i64,
    name: String,
    prompt: String,
    enabled: bool,
    member_id: String,
    project_ref: AutomationProjectRef,
    schedule: AutomationSchedule,
    notify_channels: Vec<AutomationNotifyChannel>,
    next_run_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDispatch {
    pub automation_run_id: String,
    pub camp_id: String,
}

#[derive(Debug, Default)]
pub struct AutomationService {
    gateway: DomainCommandGateway,
}

impl AutomationService {
    pub fn create(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateAutomationCommand>,
    ) -> Result<CommandExecution> {
        let command = envelope.payload.clone();
        let automation_id = new_id("rvat");
        self.gateway.execute(database, envelope, |transaction| {
            if !management_actor(&envelope.actor) {
                return Ok(rejected(
                    "automation.actor_forbidden",
                    "Automation management requires the local user or an attested AgentRun",
                ));
            }
            let prompt = normalize_prompt(&command.prompt)?;
            let name = normalized_or_derived_name(command.name.as_deref(), &prompt)?;
            validate_member(transaction, &command.member_id)?;
            let project_ref = normalize_project_ref(&command.project_ref)?;
            let notify_channels = normalize_channels(&command.notify_channels);
            validate_schedule(&command.schedule)?;
            let now = Utc::now();
            let next_run_at = next_occurrence_after(&command.schedule, now)?;
            if matches!(command.schedule, AutomationSchedule::Once { .. }) && next_run_at.is_none()
            {
                return Ok(rejected(
                    "automation.schedule_in_past",
                    "A one-time Automation must be scheduled in the future",
                ));
            }
            let now_text = timestamp(now);
            transaction.execute(
                r#"
                INSERT INTO automation(
                    id, version, name, prompt, enabled, member_id,
                    project_ref_json, schedule_json, notify_channels_json,
                    next_run_at, created_at, updated_at
                ) VALUES (?1, 1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                "#,
                params![
                    automation_id,
                    name,
                    prompt,
                    command.member_id,
                    serde_json::to_string(&project_ref)?,
                    serde_json::to_string(&command.schedule)?,
                    serde_json::to_string(&notify_channels)?,
                    next_run_at.map(timestamp),
                    now_text,
                ],
            )?;
            let view = load_automation_view(transaction, &automation_id)?
                .context("created Automation is unavailable")?;
            Ok(CommandHandlerResult::applied(
                "automation.created",
                serde_json::to_value(view)?,
                Some(entity("automation", &automation_id)),
            ))
        })
    }

    pub fn update(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateAutomationCommand>,
    ) -> Result<CommandExecution> {
        let command = envelope.payload.clone();
        self.gateway.execute(database, envelope, |transaction| {
            if !management_actor(&envelope.actor) {
                return Ok(rejected(
                    "automation.actor_forbidden",
                    "Automation management requires the local user or an attested AgentRun",
                ));
            }
            let Some(current) = load_automation_record(transaction, &command.automation_id)? else {
                return Ok(rejected(
                    "automation.not_found",
                    "Automation does not exist",
                ));
            };
            if current.version != command.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": current.version }),
                ));
            }
            let prompt = match command.prompt.as_deref() {
                Some(value) => normalize_prompt(value)?,
                None => current.prompt.clone(),
            };
            let name = match command.name.as_deref() {
                Some(value) => normalized_or_derived_name(Some(value), &prompt)?,
                None => current.name.clone(),
            };
            let member_id = command
                .member_id
                .clone()
                .unwrap_or(current.member_id.clone());
            validate_member(transaction, &member_id)?;
            let project_ref = match command.project_ref.as_ref() {
                Some(project_ref) => normalize_project_ref(project_ref)?,
                None => current.project_ref.clone(),
            };
            let schedule = command.schedule.clone().unwrap_or(current.schedule.clone());
            validate_schedule(&schedule)?;
            let notify_channels = command
                .notify_channels
                .as_ref()
                .map(|channels| normalize_channels(channels))
                .unwrap_or(current.notify_channels.clone());
            let enabled = command.enabled.unwrap_or(current.enabled);
            let now = Utc::now();
            let schedule_changed = command.schedule.is_some();
            let reopened = !current.enabled && enabled;
            let next_run_at = if !enabled {
                None
            } else if schedule_changed || reopened {
                next_occurrence_after(&schedule, now)?
            } else {
                current
                    .next_run_at
                    .as_deref()
                    .map(parse_timestamp)
                    .transpose()?
            };
            if enabled
                && matches!(schedule, AutomationSchedule::Once { .. })
                && next_run_at.is_none()
            {
                return Ok(rejected(
                    "automation.schedule_in_past",
                    "A one-time Automation must be scheduled in the future",
                ));
            }
            let now_text = timestamp(now);
            transaction.execute(
                r#"
                UPDATE automation
                SET version = version + 1, name = ?2, prompt = ?3, enabled = ?4,
                    member_id = ?5, project_ref_json = ?6, schedule_json = ?7,
                    notify_channels_json = ?8, next_run_at = ?9, updated_at = ?10
                WHERE id = ?1
                "#,
                params![
                    command.automation_id,
                    name,
                    prompt,
                    enabled,
                    member_id,
                    serde_json::to_string(&project_ref)?,
                    serde_json::to_string(&schedule)?,
                    serde_json::to_string(&notify_channels)?,
                    next_run_at.map(timestamp),
                    now_text,
                ],
            )?;
            let view = load_automation_view(transaction, &command.automation_id)?
                .context("updated Automation is unavailable")?;
            Ok(CommandHandlerResult::applied(
                "automation.updated",
                serde_json::to_value(view)?,
                Some(entity("automation", &command.automation_id)),
            ))
        })
    }

    pub fn close(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CloseAutomationCommand>,
    ) -> Result<CommandExecution> {
        let command = envelope.payload.clone();
        self.gateway.execute(database, envelope, |transaction| {
            if !management_actor(&envelope.actor) {
                return Ok(rejected(
                    "automation.actor_forbidden",
                    "Automation management requires the local user or an attested AgentRun",
                ));
            }
            let Some(current) = load_automation_record(transaction, &command.automation_id)? else {
                return Ok(rejected(
                    "automation.not_found",
                    "Automation does not exist",
                ));
            };
            if current.version != command.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": current.version }),
                ));
            }
            let now = timestamp(Utc::now());
            transaction.execute(
                "UPDATE automation SET enabled = 0, next_run_at = NULL, version = version + 1, updated_at = ?2 WHERE id = ?1",
                params![command.automation_id, now],
            )?;
            let view = load_automation_view(transaction, &command.automation_id)?
                .context("closed Automation is unavailable")?;
            Ok(CommandHandlerResult::applied(
                "automation.closed",
                serde_json::to_value(view)?,
                Some(entity("automation", &command.automation_id)),
            ))
        })
    }

    pub fn delete(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteAutomationCommand>,
    ) -> Result<CommandExecution> {
        let command = envelope.payload.clone();
        self.gateway.execute(database, envelope, |transaction| {
            if !management_actor(&envelope.actor) {
                return Ok(rejected(
                    "automation.actor_forbidden",
                    "Automation management requires the local user or an attested AgentRun",
                ));
            }
            let Some(current) = load_automation_record(transaction, &command.automation_id)? else {
                return Ok(rejected(
                    "automation.not_found",
                    "Automation does not exist",
                ));
            };
            if current.version != command.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": current.version }),
                ));
            }
            transaction.execute(
                "DELETE FROM automation WHERE id = ?1",
                [&command.automation_id],
            )?;
            Ok(CommandHandlerResult::applied(
                "automation.deleted",
                json!({ "automationId": command.automation_id, "deleted": true }),
                Some(entity("automation", &command.automation_id)),
            ))
        })
    }

    pub fn run_now(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RunAutomationCommand>,
        user_id: &str,
        quick_chat_path: &Path,
    ) -> Result<CommandExecution> {
        let command = envelope.payload.clone();
        self.gateway.execute(database, envelope, |transaction| {
            if !management_actor(&envelope.actor) {
                return Ok(rejected(
                    "automation.actor_forbidden",
                    "Automation execution requires the local user or an attested AgentRun",
                ));
            }
            let Some(record) = load_automation_record(transaction, &command.automation_id)? else {
                return Ok(rejected(
                    "automation.not_found",
                    "Automation does not exist",
                ));
            };
            if !record.enabled {
                return Ok(rejected("automation.closed", "Automation is closed"));
            }
            let scheduled_for = Utc::now();
            let occurrence = claim_occurrence_in_tx(
                transaction,
                &record,
                scheduled_for,
                "manual",
                false,
                user_id,
                quick_chat_path,
            )?;
            Ok(CommandHandlerResult::accepted(
                "automation.run_requested",
                occurrence.payload(),
                Some(entity("automation_run", &occurrence.run_id)),
            ))
        })
    }

    pub fn get(&self, database: &Database, automation_id: &str) -> Result<Option<AutomationView>> {
        load_automation_view(database.connection(), automation_id)
    }

    pub fn current_for_camp(
        &self,
        database: &Database,
        camp_id: &str,
    ) -> Result<Option<AutomationView>> {
        let automation_id = database.connection().query_row(
            "SELECT automation_id FROM automation_run WHERE camp_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
            [camp_id],
            |row| row.get::<_, String>(0),
        ).optional()?;
        match automation_id {
            Some(id) => load_automation_view(database.connection(), &id),
            None => Ok(None),
        }
    }

    pub fn list(
        &self,
        database: &Database,
        query: &AutomationListQuery,
    ) -> Result<AutomationListPage> {
        if query.limit == 0 || query.limit > MAX_LIST_LIMIT {
            anyhow::bail!("Automation list limit must be between 1 and {MAX_LIST_LIMIT}");
        }
        let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;
        let normalized_query = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let project_json = query
            .project
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let enabled_filter = match query.status {
            AutomationStatusFilter::All => None,
            AutomationStatusFilter::Enabled => Some(true),
            AutomationStatusFilter::Closed => Some(false),
        };
        let mut statement = database.connection().prepare(
            r#"
            SELECT id
            FROM automation
            WHERE (?1 IS NULL OR enabled = ?1)
              AND (?2 IS NULL OR name LIKE '%' || ?2 || '%' OR prompt LIKE '%' || ?2 || '%')
              AND (?3 IS NULL OR project_ref_json = ?3)
              AND (?4 IS NULL OR updated_at < ?4 OR (updated_at = ?4 AND id < ?5))
            ORDER BY updated_at DESC, id DESC
            LIMIT ?6
            "#,
        )?;
        let mut ids = statement
            .query_map(
                params![
                    enabled_filter,
                    normalized_query,
                    project_json,
                    cursor.as_ref().map(|value| value.0.as_str()),
                    cursor.as_ref().map(|value| value.1.as_str()),
                    i64::try_from(query.limit + 1)?,
                ],
                |row| row.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let truncated = ids.len() > query.limit;
        ids.truncate(query.limit);
        let mut automations = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(view) = load_automation_view(database.connection(), &id)? {
                automations.push(view);
            }
        }
        let next_cursor = truncated
            .then(|| {
                automations
                    .last()
                    .map(|view| encode_cursor(&view.updated_at, &view.automation_id))
            })
            .flatten();
        Ok(AutomationListPage {
            automations,
            next_cursor,
            truncated,
        })
    }

    pub fn claim_due(
        &self,
        database: &mut Database,
        now: DateTime<Utc>,
        recovery_boundary: DateTime<Utc>,
        quick_chat_path: &Path,
    ) -> Result<Vec<AutomationDispatch>> {
        let ids = {
            let mut statement = database.connection().prepare(
                "SELECT id FROM automation WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1 ORDER BY next_run_at, id LIMIT 16",
            )?;
            statement
                .query_map([timestamp(now)], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut dispatches = Vec::new();
        for automation_id in ids {
            let transaction = database
                .connection_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let Some(record) = load_automation_record(&transaction, &automation_id)? else {
                transaction.commit()?;
                continue;
            };
            if !record.enabled {
                transaction.commit()?;
                continue;
            }
            let Some(stored_due) = record
                .next_run_at
                .as_deref()
                .map(parse_timestamp)
                .transpose()?
            else {
                transaction.commit()?;
                continue;
            };
            if stored_due > now {
                transaction.commit()?;
                continue;
            }
            let missed = stored_due < recovery_boundary;
            let consumed_at = if missed {
                latest_occurrence_at_or_before(&record.schedule, now)?.unwrap_or(stored_due)
            } else {
                stored_due
            };
            let next =
                next_occurrence_after(&record.schedule, if missed { now } else { consumed_at })?;
            advance_definition_in_tx(&transaction, &record, next, &timestamp(now))?;
            if missed {
                insert_skipped_occurrence_in_tx(
                    &transaction,
                    &record,
                    consumed_at,
                    "missed",
                    "scheduled",
                )?;
            } else if automation_has_active_run(&transaction, &record.id)? {
                insert_skipped_occurrence_in_tx(
                    &transaction,
                    &record,
                    consumed_at,
                    "overlap",
                    "scheduled",
                )?;
            } else {
                let occurrence = claim_occurrence_in_tx(
                    &transaction,
                    &record,
                    consumed_at,
                    "scheduled",
                    true,
                    CURRENT_USER_ID,
                    quick_chat_path,
                )?;
                if let Some(camp_id) = occurrence.camp_id {
                    dispatches.push(AutomationDispatch {
                        automation_run_id: occurrence.run_id,
                        camp_id,
                    });
                }
            }
            transaction.commit()?;
        }
        Ok(dispatches)
    }

    pub fn settle_runs(&self, database: &mut Database, now: DateTime<Utc>) -> Result<bool> {
        let run_ids = {
            let mut statement = database.connection().prepare(
                "SELECT id FROM automation_run WHERE status IN ('running', 'cancelling') ORDER BY created_at, id LIMIT 32",
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut changed = false;
        for run_id in run_ids {
            changed |= settle_one_run(database, &run_id, now)?;
        }
        Ok(changed)
    }

    pub fn has_ready_notification(&self, database: &Database, now: DateTime<Utc>) -> Result<bool> {
        database
            .connection()
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM automation_notification_delivery
                    WHERE status = 'pending' AND available_at <= ?1
                )",
                [timestamp(now)],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Closes a claimed occurrence that could not finish its local, pre-Runtime
    /// preparation. The exact AutomationRun/CampTurn association remains the
    /// cancellation authority, so this cannot stop an unrelated conversation.
    pub fn interrupt_before_runtime(
        &self,
        database: &mut Database,
        automation_run_id: &str,
    ) -> Result<()> {
        let now = Utc::now();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(state) = load_run_state(&transaction, automation_run_id)? else {
            transaction.commit()?;
            return Ok(());
        };
        if !matches!(state.status.as_str(), "running" | "cancelling") {
            transaction.commit()?;
            return Ok(());
        }
        let mut cancelled_agent_runs = Vec::new();
        if let Some(camp_turn_id) = state.camp_turn_id.as_deref() {
            let settlement = cancel_automation_camp_turn_in_tx(
                &transaction,
                &state.id,
                camp_turn_id,
                "interrupted",
                &timestamp(now),
            )?;
            cancelled_agent_runs.extend(settlement.runs.into_iter().map(|run| run.agent_run_id));
        }
        let _ = finalize_run_in_tx(
            &transaction,
            &state,
            "failed",
            Some("interrupted"),
            None,
            now,
        )?;
        transaction.commit()?;
        pump_targets_after_runs_terminal(database, &cancelled_agent_runs)?;
        Ok(())
    }

    pub fn recover_interrupted(&self, database: &mut Database) -> Result<()> {
        let run_ids = {
            let mut statement = database.connection().prepare(
                "SELECT id FROM automation_run WHERE status IN ('running', 'cancelling') ORDER BY created_at, id",
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for run_id in run_ids {
            let now = Utc::now();
            let transaction = database
                .connection_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let state = load_run_state(&transaction, &run_id)?;
            let Some(state) = state else {
                transaction.commit()?;
                continue;
            };
            let mut cancelled_agent_runs = Vec::new();
            match state.camp_turn_id.as_deref() {
                None => {
                    let _ = finalize_run_in_tx(
                        &transaction,
                        &state,
                        "failed",
                        Some("interrupted"),
                        None,
                        now,
                    )?;
                }
                Some(turn_id) => {
                    let turn_status = transaction
                        .query_row(
                            "SELECT status FROM camp_turn WHERE id = ?1",
                            [turn_id],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?;
                    match turn_status.as_deref() {
                        Some("completed" | "failed" | "cancelled") => {
                            let _ = settle_terminal_turn_in_tx(&transaction, &state, now)?;
                        }
                        Some(_) => {
                            let settlement = cancel_automation_camp_turn_in_tx(
                                &transaction,
                                &state.id,
                                turn_id,
                                "interrupted",
                                &timestamp(now),
                            )?;
                            cancelled_agent_runs
                                .extend(settlement.runs.into_iter().map(|run| run.agent_run_id));
                            let _ = finalize_run_in_tx(
                                &transaction,
                                &state,
                                "failed",
                                Some("interrupted"),
                                None,
                                now,
                            )?;
                        }
                        None => {
                            let _ = finalize_run_in_tx(
                                &transaction,
                                &state,
                                "failed",
                                Some("interrupted"),
                                None,
                                now,
                            )?;
                        }
                    }
                }
            }
            transaction.commit()?;
            pump_targets_after_runs_terminal(database, &cancelled_agent_runs)?;
        }
        Ok(())
    }
}

#[derive(Debug)]
struct ClaimedOccurrence {
    run_id: String,
    status: &'static str,
    reason: Option<String>,
    camp_id: Option<String>,
}

impl ClaimedOccurrence {
    fn payload(&self) -> Value {
        json!({
            "status": self.status,
            "runId": self.run_id,
            "campId": self.camp_id,
            "conversationId": self.camp_id,
            "reason": self.reason,
        })
    }
}

fn claim_occurrence_in_tx(
    transaction: &Transaction<'_>,
    record: &AutomationRecord,
    scheduled_for: DateTime<Utc>,
    trigger_kind: &str,
    _scheduled: bool,
    user_id: &str,
    quick_chat_path: &Path,
) -> Result<ClaimedOccurrence> {
    if automation_has_active_run(transaction, &record.id)? {
        let run_id = insert_skipped_occurrence_in_tx(
            transaction,
            record,
            scheduled_for,
            "overlap",
            trigger_kind,
        )?;
        return Ok(ClaimedOccurrence {
            run_id,
            status: "skipped",
            reason: Some("overlap".to_string()),
            camp_id: None,
        });
    }
    let run_id = new_id("rvar");
    let now = Utc::now();
    let now_text = timestamp(now);
    transaction.execute(
        r#"
        INSERT INTO automation_run(
            id, automation_id, automation_version, trigger_kind, scheduled_for,
            status, reason, prompt, member_id, project_ref_json,
            notify_channels_json, timeout_at, camp_id, camp_turn_id,
            root_agent_run_id, result_message_id, created_at, started_at,
            ended_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', NULL, ?6, ?7, ?8, ?9,
                  ?10, NULL, NULL, NULL, NULL, ?11, ?11, NULL, ?11)
        "#,
        params![
            run_id,
            record.id,
            record.version,
            trigger_kind,
            occurrence_timestamp(scheduled_for, trigger_kind),
            record.prompt,
            record.member_id,
            serde_json::to_string(&record.project_ref)?,
            serde_json::to_string(&record.notify_channels)?,
            timestamp(now + Duration::seconds(AUTOMATION_RUNTIME_TIMEOUT_SECONDS)),
            now_text,
        ],
    )?;
    let admission = CollaborationService::default().admit_scheduled_automation(
        transaction,
        ScheduledAutomationAdmissionInput {
            automation_run_id: run_id.clone(),
            automation_name: record.name.clone(),
            prompt: record.prompt.clone(),
            member_id: record.member_id.clone(),
            project_binding_kind: record.project_ref.binding_kind(),
            project_path: record.project_ref.execution_path(quick_chat_path),
            user_id: user_id.to_string(),
            now: now_text.clone(),
        },
    )?;
    match admission {
        Ok(admission) => {
            transaction.execute(
                "UPDATE automation_run SET camp_id = ?2, camp_turn_id = ?3, root_agent_run_id = ?4, updated_at = ?5 WHERE id = ?1",
                params![run_id, admission.camp_id, admission.camp_turn_id, admission.root_agent_run_id, now_text],
            )?;
            Ok(ClaimedOccurrence {
                run_id,
                status: "started",
                reason: None,
                camp_id: Some(admission.camp_id),
            })
        }
        Err(rejection) => {
            let reason = if rejection.code == "agent_run.runtime_not_ready" {
                "runtime_not_ready"
            } else {
                "dispatch_rejected"
            };
            let state = load_run_state(transaction, &run_id)?
                .context("claimed AutomationRun is unavailable")?;
            finalize_run_in_tx(transaction, &state, "failed", Some(reason), None, now)?;
            Ok(ClaimedOccurrence {
                run_id,
                status: "failed",
                reason: Some(reason.to_string()),
                camp_id: None,
            })
        }
    }
}

fn insert_skipped_occurrence_in_tx(
    transaction: &Transaction<'_>,
    record: &AutomationRecord,
    scheduled_for: DateTime<Utc>,
    reason: &str,
    trigger_kind: &str,
) -> Result<String> {
    let run_id = new_id("rvar");
    let now = timestamp(Utc::now());
    let scheduled_for = occurrence_timestamp(scheduled_for, trigger_kind);
    transaction.execute(
        r#"
        INSERT OR IGNORE INTO automation_run(
            id, automation_id, automation_version, trigger_kind, scheduled_for,
            status, reason, prompt, member_id, project_ref_json,
            notify_channels_json, timeout_at, camp_id, camp_turn_id,
            root_agent_run_id, result_message_id, created_at, started_at,
            ended_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'skipped', ?6, ?7, ?8, ?9, ?10,
                  NULL, NULL, NULL, NULL, NULL, ?11, NULL, ?11, ?11)
        "#,
        params![
            run_id,
            record.id,
            record.version,
            trigger_kind,
            scheduled_for,
            reason,
            record.prompt,
            record.member_id,
            serde_json::to_string(&record.project_ref)?,
            serde_json::to_string(&record.notify_channels)?,
            now,
        ],
    )?;
    Ok(transaction.query_row(
        "SELECT id FROM automation_run WHERE automation_id = ?1 AND scheduled_for = ?2",
        params![record.id, scheduled_for],
        |row| row.get(0),
    )?)
}

fn advance_definition_in_tx(
    transaction: &Transaction<'_>,
    record: &AutomationRecord,
    next: Option<DateTime<Utc>>,
    now: &str,
) -> Result<()> {
    let consume_once = matches!(record.schedule, AutomationSchedule::Once { .. });
    transaction.execute(
        "UPDATE automation SET enabled = CASE WHEN ?2 THEN 0 ELSE enabled END, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![record.id, consume_once, next.map(timestamp), now],
    )?;
    Ok(())
}

fn automation_has_active_run(transaction: &Transaction<'_>, automation_id: &str) -> Result<bool> {
    transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_run WHERE automation_id = ?1 AND status IN ('running', 'cancelling'))",
        [automation_id],
        |row| row.get(0),
    ).map_err(Into::into)
}

#[derive(Debug)]
struct RunState {
    id: String,
    status: String,
    member_id: String,
    notify_channels: Vec<AutomationNotifyChannel>,
    camp_turn_id: Option<String>,
    root_agent_run_id: Option<String>,
    timeout_at: Option<DateTime<Utc>>,
}

fn load_run_state(transaction: &Transaction<'_>, run_id: &str) -> Result<Option<RunState>> {
    transaction.query_row(
        "SELECT id, status, member_id, notify_channels_json, camp_turn_id, root_agent_run_id, timeout_at FROM automation_run WHERE id = ?1",
        [run_id],
        |row| {
            let channels: String = row.get(3)?;
            let timeout: Option<String> = row.get(6)?;
            Ok((
                row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, String>(2)?, channels, row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?, timeout,
            ))
        },
    ).optional()?.map(|(id, status, member_id, channels, camp_turn_id, root_agent_run_id, timeout)| {
        Ok(RunState {
            id,
            status,
            member_id,
            notify_channels: serde_json::from_str(&channels)?,
            camp_turn_id,
            root_agent_run_id,
            timeout_at: timeout.as_deref().map(parse_timestamp).transpose()?,
        })
    }).transpose()
}

fn settle_one_run(database: &mut Database, run_id: &str, now: DateTime<Utc>) -> Result<bool> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(state) = load_run_state(&transaction, run_id)? else {
        transaction.commit()?;
        return Ok(false);
    };
    if !matches!(state.status.as_str(), "running" | "cancelling") {
        transaction.commit()?;
        return Ok(false);
    }
    let Some(turn_id) = state.camp_turn_id.as_deref() else {
        let changed = finalize_run_in_tx(
            &transaction,
            &state,
            "failed",
            Some("interrupted"),
            None,
            now,
        )?;
        transaction.commit()?;
        return Ok(changed);
    };
    let turn_status = transaction
        .query_row(
            "SELECT status FROM camp_turn WHERE id = ?1",
            [turn_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(turn_status) = turn_status else {
        let changed = finalize_run_in_tx(
            &transaction,
            &state,
            "failed",
            Some("interrupted"),
            None,
            now,
        )?;
        transaction.commit()?;
        return Ok(changed);
    };
    if matches!(turn_status.as_str(), "completed" | "failed" | "cancelled") {
        let changed = settle_terminal_turn_in_tx(&transaction, &state, now)?;
        transaction.commit()?;
        return Ok(changed);
    }
    let interaction_required = if state.root_agent_run_id.is_some() {
        transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run AS run
                WHERE run.camp_turn_id = ?1
                  AND (
                    (run.status = 'waiting' AND run.wait_reason IN ('approval', 'user_input'))
                    OR EXISTS(
                        SELECT 1
                        FROM action_execution AS action
                        JOIN approval ON approval.action_id = action.id
                        WHERE action.agent_run_id = run.id AND approval.status = 'pending'
                    )
                  )
            )
            "#,
            [turn_id],
            |row| row.get::<_, bool>(0),
        )?
    } else {
        false
    };
    let timeout = state.timeout_at.is_some_and(|deadline| now >= deadline);
    let reason = if interaction_required {
        Some("interaction_required")
    } else if timeout {
        Some("timeout")
    } else {
        None
    };
    let Some(reason) = reason else {
        transaction.commit()?;
        return Ok(false);
    };
    transaction.execute(
        "UPDATE automation_run SET status = 'cancelling', reason = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'running'",
        params![state.id, reason, timestamp(now)],
    )?;
    let settlement = cancel_automation_camp_turn_in_tx(
        &transaction,
        &state.id,
        turn_id,
        reason,
        &timestamp(now),
    )?;
    let changed = finalize_run_in_tx(&transaction, &state, "failed", Some(reason), None, now)?;
    let run_ids = settlement
        .runs
        .into_iter()
        .map(|run| run.agent_run_id)
        .collect::<Vec<_>>();
    transaction.commit()?;
    pump_targets_after_runs_terminal(database, &run_ids)?;
    Ok(changed)
}

fn settle_terminal_turn_in_tx(
    transaction: &Transaction<'_>,
    state: &RunState,
    now: DateTime<Utc>,
) -> Result<bool> {
    let turn_id = state
        .camp_turn_id
        .as_deref()
        .context("AutomationRun has no CampTurn")?;
    let turn_status: String = transaction.query_row(
        "SELECT status FROM camp_turn WHERE id = ?1",
        [turn_id],
        |row| row.get(0),
    )?;
    if turn_status != "completed" {
        return finalize_run_in_tx(
            transaction,
            state,
            "failed",
            Some("execution_failed"),
            None,
            now,
        );
    }
    let Some(root_run_id) = state.root_agent_run_id.as_deref() else {
        return finalize_run_in_tx(transaction, state, "failed", Some("no_result"), None, now);
    };
    let final_message_id = transaction
        .query_row(
            r#"
        SELECT message.id
        FROM agent_run AS run
        JOIN camp_message AS message ON message.id = run.final_camp_message_id
        WHERE run.id = ?1 AND message.source_agent_run_id = run.id
          AND message.author_type = 'agent' AND message.tombstoned_at IS NULL
          AND json_array_length(message.effective_recipient_ids_json) = 0
        "#,
            [root_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let final_message_id = match final_message_id {
        Some(message_id) => Some(message_id),
        None => transaction
            .query_row(
                r#"
            SELECT id FROM camp_message
            WHERE source_agent_run_id = ?1 AND author_type = 'agent'
              AND tombstoned_at IS NULL
              AND json_array_length(effective_recipient_ids_json) = 0
            ORDER BY sequence DESC, id DESC LIMIT 1
            "#,
                [root_run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };
    match final_message_id {
        Some(message_id) => finalize_run_in_tx(
            transaction,
            state,
            "completed",
            None,
            Some(&message_id),
            now,
        ),
        None => finalize_run_in_tx(transaction, state, "failed", Some("no_result"), None, now),
    }
}

fn finalize_run_in_tx(
    transaction: &Transaction<'_>,
    state: &RunState,
    status: &str,
    reason: Option<&str>,
    result_message_id: Option<&str>,
    now: DateTime<Utc>,
) -> Result<bool> {
    if !matches!(status, "completed" | "failed") {
        anyhow::bail!("AutomationRun terminal status is invalid");
    }
    let now_text = timestamp(now);
    let changed = transaction.execute(
        r#"
        UPDATE automation_run
        SET status = ?2, reason = ?3, result_message_id = ?4,
            ended_at = ?5, updated_at = ?5
        WHERE id = ?1 AND status IN ('running', 'cancelling')
        "#,
        params![state.id, status, reason, result_message_id, now_text],
    )?;
    if changed == 0 {
        return Ok(false);
    }
    let body = if let Some(message_id) = result_message_id {
        let body = transaction.query_row(
            "SELECT body FROM camp_message WHERE id = ?1",
            [message_id],
            |row| row.get::<_, String>(0),
        )?;
        if body.trim().is_empty() {
            "Rovai 定时任务已完成，结果文件已发布到运行对话。".to_string()
        } else {
            body
        }
    } else {
        failure_notification_body(reason.unwrap_or("execution_failed"))
    };
    for channel in &state.notify_channels {
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO automation_notification_delivery(
                id, automation_run_id, provider, member_id, payload_json,
                status, attempt_count, available_at, lease_owner,
                lease_expires_at, external_delivery_message_id, failure_code,
                created_at, updated_at, ended_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, NULL, NULL, NULL, NULL, ?6, ?6, NULL)
            "#,
            params![
                new_id("rvand"),
                state.id,
                channel.as_str(),
                state.member_id,
                serde_json::to_string(&json!({ "body": body }))?,
                now_text,
            ],
        )?;
    }
    Ok(true)
}

fn failure_notification_body(reason: &str) -> String {
    let detail = match reason {
        "interaction_required" => "运行需要用户输入或权限审批，已停止",
        "timeout" => "运行超出后台时限，已停止",
        "interrupted" => "应用退出中断了运行",
        "no_result" => "运行结束但没有产生公共结果",
        "runtime_not_ready" => "所选队员的 Runtime 当前不可用",
        _ => "运行失败",
    };
    format!("Rovai 定时任务失败：{detail}。")
}

pub(crate) fn claim_notification_deliveries(
    transaction: &Transaction<'_>,
    provider: &str,
    worker_id: &str,
    limit: usize,
    now: &DateTime<Utc>,
) -> Result<Vec<ClaimedChannelDelivery>> {
    if limit == 0 || !matches!(provider, "feishu" | "dingtalk") {
        return Ok(Vec::new());
    }
    let now_text = timestamp(*now);
    transaction.execute(
        r#"
        UPDATE automation_notification_delivery
        SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,
            lease_owner = NULL, lease_expires_at = NULL,
            failure_code = COALESCE(failure_code, 'lease_expired'),
            available_at = ?1,
            ended_at = CASE WHEN attempt_count >= 3 THEN ?1 ELSE NULL END,
            updated_at = ?1
        WHERE provider = ?2 AND status = 'attempting' AND lease_expires_at <= ?1
        "#,
        params![now_text, provider],
    )?;
    let ids = {
        let mut statement = transaction.prepare(
            "SELECT id FROM automation_notification_delivery WHERE provider = ?1 AND status = 'pending' AND available_at <= ?2 ORDER BY available_at, created_at, id LIMIT ?3",
        )?;
        statement
            .query_map(params![provider, now_text, i64::try_from(limit)?], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let lease_expires_at = timestamp(*now + Duration::seconds(30));
    let mut claims = Vec::new();
    for delivery_id in ids {
        let (member_id, payload_json, attempt_count): (String, String, i64) = transaction.query_row(
            "SELECT member_id, payload_json, attempt_count FROM automation_notification_delivery WHERE id = ?1",
            [&delivery_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let Some(target) = notification_target(transaction, provider, &member_id)? else {
            transaction.execute(
                "UPDATE automation_notification_delivery SET status = 'failed', failure_code = 'target_bot_not_connected', ended_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'pending'",
                params![delivery_id, now_text],
            )?;
            continue;
        };
        let changed = transaction.execute(
            "UPDATE automation_notification_delivery SET status = 'attempting', attempt_count = attempt_count + 1, lease_owner = ?2, lease_expires_at = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'pending'",
            params![delivery_id, worker_id, lease_expires_at, now_text],
        )?;
        if changed == 0 {
            continue;
        }
        let stored: Value = serde_json::from_str(&payload_json)?;
        let body = stored
            .get("body")
            .and_then(Value::as_str)
            .context("Automation notification has no body")?;
        let payload = if provider == "feishu" {
            json!({
                "kind": "agent_output",
                "presentationVersion": 1,
                "agentId": member_id,
                "body": body,
                "mentionPrincipal": false,
                "memberRecipients": [],
                "reply": null,
                "deliveryScope": "automation_owner",
            })
        } else {
            json!({
                "kind": "agent_output",
                "presentationVersion": 2,
                "agentId": member_id,
                "body": body,
                "mentionPrincipal": false,
                "reply": null,
                "deliveryScope": "automation_owner",
            })
        };
        claims.push(ClaimedChannelDelivery {
            delivery_id,
            provider: provider.to_string(),
            request_id: None,
            delivery_kind: "agent_output".to_string(),
            target_app_id: target.app_id,
            credential_ref: target.credential_ref,
            chat_id: target.owner_external_id.clone(),
            topic_key: String::new(),
            conversation_kind: "p2p".to_string(),
            payload,
            attempt_count: attempt_count + 1,
            update_message_id: None,
            recall_message_id: None,
            recipient_open_id: Some(target.owner_external_id),
        });
    }
    Ok(claims)
}

pub(crate) fn notification_provider(
    transaction: &Transaction<'_>,
    delivery_id: &str,
) -> Result<Option<String>> {
    transaction
        .query_row(
            "SELECT provider FROM automation_notification_delivery WHERE id = ?1",
            [delivery_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

pub(crate) fn settle_notification_delivery_in_tx(
    transaction: &Transaction<'_>,
    delivery_id: &str,
    worker_id: &str,
    outcome: &str,
    external_delivery_message_id: Option<&str>,
    failure_code: Option<&str>,
    retryable: bool,
) -> Result<CommandHandlerResult> {
    let state = transaction.query_row(
        "SELECT status, lease_owner, attempt_count FROM automation_notification_delivery WHERE id = ?1",
        [delivery_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?)),
    ).optional()?;
    let Some((status, lease_owner, attempt_count)) = state else {
        return Ok(rejected(
            "channel.delivery.not_found",
            "Channel delivery does not exist",
        ));
    };
    if matches!(status.as_str(), "sent" | "failed") {
        return Ok(CommandHandlerResult::applied(
            "channel.delivery.already_terminal",
            json!({ "deliveryId": delivery_id, "status": status }),
            None,
        ));
    }
    if status != "attempting" || lease_owner.as_deref() != Some(worker_id) {
        return Ok(rejected(
            "channel.delivery.lease_mismatch",
            "Delivery is not owned by this Host worker",
        ));
    }
    let now = Utc::now();
    let now_text = timestamp(now);
    if outcome == "failed" && retryable && attempt_count < 3 {
        let available_at =
            timestamp(now + Duration::seconds(2_i64.pow(u32::try_from(attempt_count.min(5))?)));
        transaction.execute(
            "UPDATE automation_notification_delivery SET status = 'pending', available_at = ?2, lease_owner = NULL, lease_expires_at = NULL, failure_code = ?3, updated_at = ?4 WHERE id = ?1",
            params![delivery_id, available_at, failure_code, now_text],
        )?;
        return Ok(CommandHandlerResult::applied(
            "channel.delivery.retry_scheduled",
            json!({ "deliveryId": delivery_id, "status": "pending", "availableAt": available_at }),
            None,
        ));
    }
    transaction.execute(
        "UPDATE automation_notification_delivery SET status = ?2, external_delivery_message_id = ?3, failure_code = ?4, lease_owner = NULL, lease_expires_at = NULL, ended_at = ?5, updated_at = ?5 WHERE id = ?1",
        params![delivery_id, outcome, external_delivery_message_id, failure_code, now_text],
    )?;
    Ok(CommandHandlerResult::applied(
        "channel.delivery.settled",
        json!({ "deliveryId": delivery_id, "status": outcome }),
        None,
    ))
}

pub(crate) fn has_notification_work(transaction: &Transaction<'_>, provider: &str) -> Result<bool> {
    transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_notification_delivery WHERE provider = ?1 AND status IN ('pending', 'attempting'))",
        [provider],
        |row| row.get(0),
    ).map_err(Into::into)
}

struct NotificationTarget {
    app_id: String,
    credential_ref: String,
    owner_external_id: String,
}

fn notification_target(
    transaction: &Transaction<'_>,
    provider: &str,
    member_id: &str,
) -> Result<Option<NotificationTarget>> {
    let sql = if provider == "feishu" {
        r#"
        SELECT bot.app_id, bot.credential_ref, identity.external_id
        FROM feishu_member_bot AS bot
        JOIN feishu_owner_identity AS owner ON owner.account_id = bot.account_id
        JOIN feishu_owner_app_identity AS app
          ON app.account_id = bot.account_id AND app.app_id = bot.app_id
        JOIN external_principal_app_identity AS identity
          ON identity.principal_id = owner.canonical_owner_principal_id
         AND identity.provider = 'feishu' AND identity.app_id = bot.app_id
         AND identity.identity_kind = 'open_id'
        WHERE bot.agent_id = ?1 AND bot.status = 'published'
        "#
    } else {
        r#"
        SELECT bot.app_key, bot.credential_ref, identity.external_id
        FROM dingtalk_member_bot AS bot
        JOIN dingtalk_owner_identity AS owner ON owner.account_id = bot.account_id
        JOIN dingtalk_owner_app_identity AS app
          ON app.account_id = bot.account_id AND app.app_key = bot.app_key
        JOIN external_principal_app_identity AS identity
          ON identity.principal_id = owner.canonical_owner_principal_id
         AND identity.provider = 'dingtalk' AND identity.app_id = bot.app_key
         AND identity.identity_kind = 'user_id'
        WHERE bot.agent_id = ?1 AND bot.status = 'published'
        "#
    };
    transaction
        .query_row(sql, [member_id], |row| {
            Ok(NotificationTarget {
                app_id: row.get(0)?,
                credential_ref: row.get(1)?,
                owner_external_id: row.get(2)?,
            })
        })
        .optional()
        .map_err(Into::into)
}

fn load_automation_record(
    connection: &rusqlite::Connection,
    automation_id: &str,
) -> Result<Option<AutomationRecord>> {
    connection.query_row(
        "SELECT id, version, name, prompt, enabled, member_id, project_ref_json, schedule_json, notify_channels_json, next_run_at, created_at, updated_at FROM automation WHERE id = ?1",
        [automation_id],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, bool>(4)?, row.get::<_, String>(5)?,
            row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?,
            row.get::<_, Option<String>>(9)?, row.get::<_, String>(10)?, row.get::<_, String>(11)?,
        )),
    ).optional()?.map(|row| Ok(AutomationRecord {
        id: row.0,
        version: row.1,
        name: row.2,
        prompt: row.3,
        enabled: row.4,
        member_id: row.5,
        project_ref: serde_json::from_str(&row.6)?,
        schedule: serde_json::from_str(&row.7)?,
        notify_channels: serde_json::from_str(&row.8)?,
        next_run_at: row.9,
        created_at: row.10,
        updated_at: row.11,
    })).transpose()
}

fn load_automation_view(
    connection: &rusqlite::Connection,
    automation_id: &str,
) -> Result<Option<AutomationView>> {
    let Some(record) = load_automation_record(connection, automation_id)? else {
        return Ok(None);
    };
    let last_run = connection.query_row(
        r#"
        SELECT run.id, run.status, run.reason, run.scheduled_for, run.camp_id,
               run.result_message_id, run.created_at, run.ended_at,
               CASE
                 WHEN COUNT(delivery.id) = 0 THEN 'none'
                 WHEN SUM(CASE WHEN delivery.status = 'failed' THEN 1 ELSE 0 END) > 0
                      AND SUM(CASE WHEN delivery.status = 'sent' THEN 1 ELSE 0 END) > 0 THEN 'partial'
                 WHEN SUM(CASE WHEN delivery.status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
                 WHEN SUM(CASE WHEN delivery.status IN ('pending','attempting') THEN 1 ELSE 0 END) > 0 THEN 'pending'
                 ELSE 'sent'
               END
        FROM automation_run AS run
        LEFT JOIN automation_notification_delivery AS delivery ON delivery.automation_run_id = run.id
        WHERE run.automation_id = ?1
        GROUP BY run.id
        ORDER BY run.created_at DESC, run.id DESC LIMIT 1
        "#,
        [automation_id],
        |row| Ok(AutomationRunSummary {
            run_id: row.get(0)?, status: row.get(1)?, reason: row.get(2)?, scheduled_for: row.get(3)?,
            camp_id: row.get(4)?, result_message_id: row.get(5)?, created_at: row.get(6)?,
            ended_at: row.get(7)?, notification_status: row.get(8)?,
        }),
    ).optional()?;
    Ok(Some(AutomationView {
        automation_id: record.id,
        version: record.version,
        name: record.name,
        prompt: record.prompt,
        enabled: record.enabled,
        member_id: record.member_id,
        project_ref: record.project_ref,
        schedule: record.schedule,
        notify_channels: record.notify_channels,
        next_run_at: record.next_run_at,
        last_run,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }))
}

fn management_actor(actor: &ActorRef) -> bool {
    matches!(actor, ActorRef::User { .. } | ActorRef::Agent { .. })
}

fn validate_member(transaction: &Transaction<'_>, member_id: &str) -> Result<()> {
    let present = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1 AND profile_status = 'present')",
        [member_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !present {
        anyhow::bail!("selected Automation member is unavailable");
    }
    Ok(())
}

fn normalize_project_ref(project_ref: &AutomationProjectRef) -> Result<AutomationProjectRef> {
    if let AutomationProjectRef::Directory { path } = project_ref {
        let project_path = Path::new(path);
        if path.trim().is_empty() || !project_path.is_absolute() {
            anyhow::bail!("Automation project directory must be an absolute path");
        }
        if !project_path.is_dir() {
            anyhow::bail!("Automation project directory is unavailable");
        }
        return Ok(AutomationProjectRef::Directory {
            path: project_path
                .canonicalize()
                .context("Automation project directory could not be resolved")?
                .to_string_lossy()
                .into_owned(),
        });
    }
    Ok(AutomationProjectRef::QuickChat)
}

fn normalize_prompt(value: &str) -> Result<String> {
    let prompt = value.trim().to_string();
    let count = prompt.chars().count();
    if count == 0 {
        anyhow::bail!("Automation prompt must not be empty");
    }
    if count > MAX_PROMPT_SCALARS {
        anyhow::bail!("Automation prompt is too long");
    }
    Ok(prompt)
}

fn normalized_or_derived_name(name: Option<&str>, prompt: &str) -> Result<String> {
    let normalized = name
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let name = if normalized.is_empty() {
        derive_name(prompt)
    } else {
        normalized
    };
    if name.chars().count() > MAX_NAME_SCALARS {
        anyhow::bail!("Automation name is too long");
    }
    Ok(name)
}

pub fn derive_name(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let prefix = chars.by_ref().take(20).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn normalize_channels(channels: &[AutomationNotifyChannel]) -> Vec<AutomationNotifyChannel> {
    channels
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn validate_schedule(schedule: &AutomationSchedule) -> Result<()> {
    match schedule {
        AutomationSchedule::Daily { at }
        | AutomationSchedule::Weekdays { at }
        | AutomationSchedule::Weekly { at, .. } => {
            parse_time(at)?;
        }
        AutomationSchedule::Once { date, at } => {
            parse_date(date)?;
            parse_time(at)?;
        }
        AutomationSchedule::Cron { expression } => {
            parse_cron_expression(expression)?;
        }
        AutomationSchedule::Manual => {}
    }
    Ok(())
}

pub fn next_occurrence_after(
    schedule: &AutomationSchedule,
    after: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>> {
    validate_schedule(schedule)?;
    match schedule {
        AutomationSchedule::Manual => Ok(None),
        AutomationSchedule::Once { date, at } => {
            let candidate = local_datetime(parse_date(date)?, parse_time(at)?)?;
            Ok(candidate.filter(|candidate| *candidate > after))
        }
        AutomationSchedule::Daily { at } => next_matching_day(after, parse_time(at)?, |_| true),
        AutomationSchedule::Weekdays { at } => next_matching_day(after, parse_time(at)?, |date| {
            date.weekday().number_from_monday() <= 5
        }),
        AutomationSchedule::Weekly { weekday, at } => {
            let expected = weekday.number_from_monday();
            next_matching_day(after, parse_time(at)?, |date| {
                date.weekday().number_from_monday() == expected
            })
        }
        AutomationSchedule::Cron { expression } => {
            let cron = parse_cron_expression(expression)?;
            let next = cron
                .find_next_occurrence(&after.with_timezone(&Local), false)
                .context("Cron expression has no future occurrence")?;
            Ok(Some(next.with_timezone(&Utc)))
        }
    }
}

fn latest_occurrence_at_or_before(
    schedule: &AutomationSchedule,
    at: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>> {
    match schedule {
        AutomationSchedule::Manual => Ok(None),
        AutomationSchedule::Once { date, at: time } => {
            let candidate = local_datetime(parse_date(date)?, parse_time(time)?)?;
            Ok(candidate.filter(|candidate| *candidate <= at))
        }
        AutomationSchedule::Cron { expression } => {
            let cron = parse_cron_expression(expression)?;
            let latest = cron
                .find_previous_occurrence(&at.with_timezone(&Local), true)
                .context("Cron expression has no previous occurrence")?;
            Ok(Some(latest.with_timezone(&Utc)))
        }
        _ => {
            let mut cursor = at - Duration::days(8);
            let mut latest = None;
            while let Some(next) = next_occurrence_after(schedule, cursor)? {
                if next > at {
                    break;
                }
                latest = Some(next);
                cursor = next;
            }
            Ok(latest)
        }
    }
}

fn next_matching_day(
    after: DateTime<Utc>,
    time: NaiveTime,
    predicate: impl Fn(NaiveDate) -> bool,
) -> Result<Option<DateTime<Utc>>> {
    let local_after = after.with_timezone(&Local);
    let mut date = local_after.date_naive();
    for _ in 0..370 {
        if predicate(date)
            && let Some(candidate) = local_datetime(date, time)?
            && candidate > after
        {
            return Ok(Some(candidate));
        }
        date = date
            .succ_opt()
            .context("Automation schedule date overflow")?;
    }
    anyhow::bail!("Automation schedule has no occurrence in the supported horizon")
}

fn local_datetime(date: NaiveDate, time: NaiveTime) -> Result<Option<DateTime<Utc>>> {
    let mut naive = NaiveDateTime::new(date, time);
    for _ in 0..=180 {
        match Local.from_local_datetime(&naive) {
            LocalResult::Single(value) => return Ok(Some(value.with_timezone(&Utc))),
            LocalResult::Ambiguous(first, second) => {
                return Ok(Some(first.min(second).with_timezone(&Utc)));
            }
            LocalResult::None => naive += Duration::minutes(1),
        }
    }
    Ok(None)
}

fn parse_cron_expression(expression: &str) -> Result<Cron> {
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 5 {
        anyhow::bail!("Cron expression must contain exactly five fields");
    }
    let normalized = fields
        .into_iter()
        .map(|field| {
            if field
                .strip_prefix("*/")
                .and_then(|step| step.parse::<u32>().ok())
                == Some(1)
            {
                "*"
            } else {
                field
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    CronParser::builder()
        .seconds(Seconds::Disallowed)
        .year(Year::Disallowed)
        .build()
        .parse(&normalized)
        .context("Cron expression is invalid")
}

fn parse_time(value: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M").context("Automation time must use HH:MM")
}

fn parse_date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").context("Automation date must use YYYY-MM-DD")
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn occurrence_timestamp(value: DateTime<Utc>, trigger_kind: &str) -> String {
    if trigger_kind == "manual" {
        value.to_rfc3339_opts(SecondsFormat::Nanos, true)
    } else {
        timestamp(value)
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

fn entity(entity_type: &str, entity_id: &str) -> EntityReference {
    EntityReference {
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
    }
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn encode_cursor(updated_at: &str, id: &str) -> String {
    format!("{updated_at}\n{id}")
}

fn decode_cursor(value: &str) -> Result<(String, String)> {
    let (updated_at, id) = value
        .split_once('\n')
        .context("Automation cursor is invalid")?;
    parse_timestamp(updated_at)?;
    if id.trim().is_empty() {
        anyhow::bail!("Automation cursor is invalid");
    }
    Ok((updated_at.to_string(), id.to_string()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn user_command<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn test_database() -> (Database, PathBuf, PathBuf) {
        let (database, directory) = crate::test_support::seeded_runtime_database_fast();
        let quick_chat_path = directory.join("quick-chat");
        std::fs::create_dir_all(&quick_chat_path).expect("Quick Chat directory should exist");
        (database, directory, quick_chat_path)
    }

    fn remove_test_database(database: Database, directory: PathBuf) {
        drop(database);
        std::fs::remove_dir_all(directory).expect("test database should be removable");
    }

    fn publish_automatic_result(
        database: &mut Database,
        automation_run_id: &str,
        body: &str,
    ) -> String {
        let transaction = database.connection_mut().transaction().unwrap();
        let (camp_id, camp_turn_id, root_agent_run_id, member_id): (
            String,
            String,
            String,
            String,
        ) = transaction
            .query_row(
                "SELECT camp_id, camp_turn_id, root_agent_run_id, member_id FROM automation_run WHERE id = ?1",
                [automation_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let now = timestamp(Utc::now());
        transaction
            .execute(
                "UPDATE camp SET last_message_sequence = last_message_sequence + 1, version = version + 1, updated_at = ?2 WHERE id = ?1",
                params![camp_id, now],
            )
            .unwrap();
        let sequence: i64 = transaction
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let message_id = Uuid::new_v4().to_string();
        let content = vec![crate::camp_content::StructuredCampMessageSegment::Text {
            text: body.to_string(),
        }];
        let content_json = serde_json::to_string(&content).unwrap();
        let content_digest = crate::camp_content::canonical_content_digest(&content).unwrap();
        transaction
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id,
                    source_agent_run_id, body, structured_content_json,
                    content_digest, address_mode, addressed_agent_ids_json,
                    reply_to_camp_message_id, camp_turn_id, agent_run_id,
                    tombstoned_at, version, created_at, updated_at,
                    effective_recipient_ids_json, recipient_set_digest,
                    recipient_presentation_json, source_operation_id
                ) VALUES (
                    ?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8,
                    'default', '[]', NULL, ?9, ?5, NULL, 1, ?10, ?10,
                    '[]', NULL, '{}', NULL
                )
                "#,
                params![
                    message_id,
                    camp_id,
                    sequence,
                    member_id,
                    root_agent_run_id,
                    body,
                    content_json,
                    content_digest,
                    camp_turn_id,
                    now,
                ],
            )
            .unwrap();
        transaction
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'succeeded', wait_reason = NULL,
                    terminal_resolution_source = 'runtime_terminal',
                    final_camp_message_id = ?2,
                    started_at = COALESCE(started_at, ?3), ended_at = ?3,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1
                "#,
                params![root_agent_run_id, message_id, now],
            )
            .unwrap();
        transaction
            .execute(
                "UPDATE camp_turn SET status = 'completed', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![camp_turn_id, now],
            )
            .unwrap();
        transaction.commit().unwrap();
        message_id
    }

    fn create_manual_automation(
        service: &AutomationService,
        database: &mut Database,
        command_id: &str,
        prompt: &str,
    ) -> (String, CommandEnvelope<CreateAutomationCommand>) {
        let envelope = user_command(
            command_id,
            CreateAutomationCommand {
                name: None,
                prompt: prompt.to_string(),
                member_id: "agent_1".to_string(),
                project_ref: AutomationProjectRef::QuickChat,
                schedule: AutomationSchedule::Manual,
                notify_channels: vec![
                    AutomationNotifyChannel::Dingtalk,
                    AutomationNotifyChannel::Feishu,
                    AutomationNotifyChannel::Dingtalk,
                ],
            },
        );
        let execution = service
            .create(database, &envelope)
            .expect("Automation should be created");
        assert!(!execution.replayed);
        let automation_id = execution.result.payload["automationId"]
            .as_str()
            .expect("Automation ID should be returned")
            .to_string();
        (automation_id, envelope)
    }

    #[test]
    fn derived_name_collapses_whitespace_and_limits_unicode_scalars() {
        assert_eq!(derive_name("  alpha\n beta   gamma  "), "alpha beta gamma");
        assert_eq!(
            derive_name("一二三四五六七八九十一二三四五六七八九十一"),
            "一二三四五六七八九十一二三四五六七八九十…"
        );
    }

    #[test]
    fn manual_run_atomically_freezes_snapshot_and_replays_without_a_second_camp() {
        let service = AutomationService::default();
        let (mut database, directory, quick_chat_path) = test_database();
        let original_prompt = "  Review the latest customer feedback and summarize it.  ";
        let (automation_id, create_envelope) = create_manual_automation(
            &service,
            &mut database,
            "automation-create-1",
            original_prompt,
        );

        let replayed_create = service
            .create(&mut database, &create_envelope)
            .expect("create replay should succeed");
        assert!(replayed_create.replayed);
        assert_eq!(
            replayed_create.result.payload["automationId"],
            automation_id
        );

        let run_envelope = user_command(
            "automation-run-1",
            RunAutomationCommand {
                automation_id: automation_id.clone(),
            },
        );
        let first = service
            .run_now(
                &mut database,
                &run_envelope,
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .expect("manual Automation should start");
        assert_eq!(first.result.payload["status"], "started");
        let automation_run_id = first.result.payload["runId"]
            .as_str()
            .expect("AutomationRun ID should be returned")
            .to_string();
        let camp_id = first.result.payload["campId"]
            .as_str()
            .expect("Camp ID should be returned")
            .to_string();

        let replayed_run = service
            .run_now(
                &mut database,
                &run_envelope,
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .expect("run replay should succeed");
        assert!(replayed_run.replayed);
        assert_eq!(replayed_run.result.payload, first.result.payload);

        let normalized_prompt = original_prompt.trim();
        let snapshot: (i64, String, String, String, String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT run.automation_version, run.prompt, run.project_ref_json,
                       camp.project_path, message.body, agent_run.purpose,
                       turn.automation_run_id
                FROM automation_run AS run
                JOIN camp ON camp.id = run.camp_id
                JOIN camp_turn AS turn ON turn.id = run.camp_turn_id
                JOIN agent_run ON agent_run.id = run.root_agent_run_id
                JOIN camp_message AS message
                  ON message.camp_turn_id = run.camp_turn_id
                 AND message.author_type = 'user'
                WHERE run.id = ?1
                "#,
                [&automation_run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("atomic dispatch graph should exist");
        assert_eq!(snapshot.0, 1);
        assert_eq!(snapshot.1, normalized_prompt);
        assert_eq!(snapshot.2, r#"{"kind":"quick_chat"}"#);
        assert_eq!(snapshot.3, quick_chat_path.to_string_lossy());
        assert_eq!(snapshot.4, normalized_prompt);
        assert_eq!(
            snapshot.5,
            "This is a scheduled Rovai run. Execute the saved instruction once and return the final result."
        );
        assert_eq!(snapshot.6, automation_run_id);

        let original_name = service
            .get(&database, &automation_id)
            .expect("Automation should load")
            .expect("Automation should exist")
            .name;
        let updated = service
            .update(
                &mut database,
                &user_command(
                    "automation-update-1",
                    UpdateAutomationCommand {
                        automation_id: automation_id.clone(),
                        expected_version: 1,
                        name: None,
                        prompt: Some("Use the revised instruction for future runs.".to_string()),
                        member_id: None,
                        project_ref: None,
                        schedule: None,
                        notify_channels: None,
                        enabled: None,
                    },
                ),
            )
            .expect("Automation should update");
        assert_eq!(updated.result.payload["name"], original_name);
        assert_eq!(updated.result.payload["version"], 2);

        let overlapping = service
            .run_now(
                &mut database,
                &user_command(
                    "automation-run-overlap",
                    RunAutomationCommand {
                        automation_id: automation_id.clone(),
                    },
                ),
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .expect("overlapping occurrence should be recorded");
        assert_eq!(overlapping.result.payload["status"], "skipped");
        assert_eq!(overlapping.result.payload["reason"], "overlap");
        assert!(overlapping.result.payload["campId"].is_null());
        let counts: (i64, i64) = database
            .connection()
            .query_row(
                "SELECT COUNT(*), COUNT(DISTINCT camp_id) FROM automation_run WHERE automation_id = ?1",
                [&automation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (2, 1));

        service
            .recover_interrupted(&mut database)
            .expect("recovery should settle the claimed run");
        let recovered: (String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT run.status, run.reason, turn.status
                FROM automation_run AS run
                JOIN camp_turn AS turn ON turn.id = run.camp_turn_id
                WHERE run.id = ?1
                "#,
                [&automation_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            recovered,
            ("failed".into(), "interrupted".into(), "cancelled".into())
        );
        assert!(
            database
                .connection()
                .execute(
                    "UPDATE automation_run SET status = 'completed' WHERE id = ?1",
                    [&automation_run_id],
                )
                .is_err()
        );

        let next = service
            .run_now(
                &mut database,
                &user_command(
                    "automation-run-2",
                    RunAutomationCommand {
                        automation_id: automation_id.clone(),
                    },
                ),
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .expect("a new run should start after terminal recovery");
        assert_eq!(next.result.payload["status"], "started");
        let next_run_id = next.result.payload["runId"].as_str().unwrap();
        let next_snapshot: (i64, String) = database
            .connection()
            .query_row(
                "SELECT automation_version, prompt FROM automation_run WHERE id = ?1",
                [next_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            next_snapshot,
            (2, "Use the revised instruction for future runs.".into())
        );
        assert_ne!(next.result.payload["campId"], camp_id);
        service
            .interrupt_before_runtime(&mut database, next_run_id)
            .expect("test run should settle");

        remove_test_database(database, directory);
    }

    #[test]
    fn scheduled_once_overlap_is_skipped_and_consumes_the_definition() {
        let service = AutomationService::default();
        let (mut database, directory, quick_chat_path) = test_database();
        let local_due = Local::now() + Duration::days(1);
        let create = service
            .create(
                &mut database,
                &user_command(
                    "automation-once-create",
                    CreateAutomationCommand {
                        name: Some("Once overlap".to_string()),
                        prompt: "Run exactly once.".to_string(),
                        member_id: "agent_1".to_string(),
                        project_ref: AutomationProjectRef::QuickChat,
                        schedule: AutomationSchedule::Once {
                            date: local_due.format("%Y-%m-%d").to_string(),
                            at: local_due.format("%H:%M").to_string(),
                        },
                        notify_channels: Vec::new(),
                    },
                ),
            )
            .expect("one-time Automation should be created");
        let automation_id = create.result.payload["automationId"]
            .as_str()
            .unwrap()
            .to_string();
        let due = parse_timestamp(create.result.payload["nextRunAt"].as_str().unwrap()).unwrap();

        let manual = service
            .run_now(
                &mut database,
                &user_command(
                    "automation-once-manual-run",
                    RunAutomationCommand {
                        automation_id: automation_id.clone(),
                    },
                ),
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .expect("manual run should start");
        assert_eq!(manual.result.payload["status"], "started");

        let dispatches = service
            .claim_due(
                &mut database,
                due + Duration::seconds(1),
                due - Duration::seconds(1),
                &quick_chat_path,
            )
            .expect("scheduled occurrence should be claimed");
        assert!(dispatches.is_empty());
        let definition = service
            .get(&database, &automation_id)
            .unwrap()
            .expect("Automation should remain readable");
        assert!(!definition.enabled);
        assert!(definition.next_run_at.is_none());
        let skipped: (String, String) = database
            .connection()
            .query_row(
                "SELECT status, reason FROM automation_run WHERE automation_id = ?1 AND trigger_kind = 'scheduled'",
                [&automation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(skipped, ("skipped".into(), "overlap".into()));
        service
            .recover_interrupted(&mut database)
            .expect("manual run should settle for cleanup");

        remove_test_database(database, directory);
    }

    #[test]
    fn delayed_tick_during_the_same_active_session_claims_the_due_occurrence() {
        let service = AutomationService::default();
        let (mut database, directory, quick_chat_path) = test_database();
        let local_due = Local::now() + Duration::days(1);
        let create = service
            .create(
                &mut database,
                &user_command(
                    "automation-delayed-tick-create",
                    CreateAutomationCommand {
                        name: Some("Delayed tick".to_string()),
                        prompt: "Run after an ordinary scheduler delay.".to_string(),
                        member_id: "agent_1".to_string(),
                        project_ref: AutomationProjectRef::QuickChat,
                        schedule: AutomationSchedule::Once {
                            date: local_due.format("%Y-%m-%d").to_string(),
                            at: local_due.format("%H:%M").to_string(),
                        },
                        notify_channels: Vec::new(),
                    },
                ),
            )
            .expect("one-time Automation should be created");
        let automation_id = create.result.payload["automationId"]
            .as_str()
            .unwrap()
            .to_string();
        let due = parse_timestamp(create.result.payload["nextRunAt"].as_str().unwrap()).unwrap();

        let dispatches = service
            .claim_due(
                &mut database,
                due + Duration::seconds(10),
                due - Duration::days(1),
                &quick_chat_path,
            )
            .expect("an ordinary delayed tick should claim the occurrence");

        assert_eq!(dispatches.len(), 1);
        let run: (String, Option<String>, String) = database
            .connection()
            .query_row(
                "SELECT status, reason, scheduled_for FROM automation_run WHERE automation_id = ?1",
                [&automation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(run, ("running".into(), None, timestamp(due)));
        service
            .interrupt_before_runtime(&mut database, &dispatches[0].automation_run_id)
            .expect("test run should settle");

        remove_test_database(database, directory);
    }

    #[test]
    fn cron_wildcard_step_one_has_the_same_weekly_occurrences_as_wildcard() {
        let after = local_datetime(
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
        )
        .unwrap()
        .unwrap();
        let wildcard = AutomationSchedule::Cron {
            expression: "0 9 * * 1".to_string(),
        };
        let wildcard_step = AutomationSchedule::Cron {
            expression: "0 9 */1 * 1".to_string(),
        };

        let next = next_occurrence_after(&wildcard, after).unwrap().unwrap();
        assert_eq!(
            next_occurrence_after(&wildcard_step, after).unwrap(),
            Some(next)
        );
        assert_eq!(next.with_timezone(&Local).weekday(), chrono::Weekday::Mon);
        assert_eq!(
            next.with_timezone(&Local).format("%H:%M").to_string(),
            "09:00"
        );

        let latest_at = next + Duration::days(3);
        assert_eq!(
            latest_occurrence_at_or_before(&wildcard, latest_at).unwrap(),
            Some(next)
        );
        assert_eq!(
            latest_occurrence_at_or_before(&wildcard_step, latest_at).unwrap(),
            Some(next)
        );
        assert!(parse_cron_expression("0 9 1 * * 2027").is_err());
    }

    #[test]
    fn terminal_public_result_and_notification_outcomes_settle_independently() {
        let service = AutomationService::default();
        let (mut database, directory, quick_chat_path) = test_database();
        let (automation_id, _) = create_manual_automation(
            &service,
            &mut database,
            "automation-notification-create",
            "Prepare a concise result.",
        );
        let started = service
            .run_now(
                &mut database,
                &user_command(
                    "automation-notification-run",
                    RunAutomationCommand {
                        automation_id: automation_id.clone(),
                    },
                ),
                CURRENT_USER_ID,
                &quick_chat_path,
            )
            .unwrap();
        let automation_run_id = started.result.payload["runId"].as_str().unwrap();
        let result_message_id =
            publish_automatic_result(&mut database, automation_run_id, "Scheduled result");

        assert!(service.settle_runs(&mut database, Utc::now()).unwrap());
        assert!(!service.settle_runs(&mut database, Utc::now()).unwrap());
        let terminal: (String, Option<String>, String) = database
            .connection()
            .query_row(
                "SELECT status, reason, result_message_id FROM automation_run WHERE id = ?1",
                [automation_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(terminal, ("completed".into(), None, result_message_id));
        assert!(
            service
                .has_ready_notification(&database, Utc::now())
                .unwrap()
        );
        let pending: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM automation_notification_delivery WHERE automation_run_id = ?1 AND status = 'pending'",
                [automation_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 2);

        database
            .connection()
            .execute(
                r#"
                UPDATE automation_notification_delivery
                SET status = 'attempting', attempt_count = 3,
                    lease_owner = 'crashed-notification-host',
                    lease_expires_at = ?2
                WHERE automation_run_id = ?1 AND provider = 'feishu'
                "#,
                params![
                    automation_run_id,
                    timestamp(Utc::now() - Duration::seconds(1))
                ],
            )
            .unwrap();

        for provider in ["feishu", "dingtalk"] {
            let transaction = database.connection_mut().transaction().unwrap();
            let claims = claim_notification_deliveries(
                &transaction,
                provider,
                "notification-test-host",
                10,
                &Utc::now(),
            )
            .unwrap();
            assert!(claims.is_empty());
            transaction.commit().unwrap();
        }
        let exhausted: (String, i64, String, bool) = database
            .connection()
            .query_row(
                r#"
                SELECT status, attempt_count, failure_code, ended_at IS NOT NULL
                FROM automation_notification_delivery
                WHERE automation_run_id = ?1 AND provider = 'feishu'
                "#,
                [automation_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            exhausted,
            ("failed".into(), 3, "lease_expired".into(), true)
        );
        let view = service.get(&database, &automation_id).unwrap().unwrap();
        let last_run = view.last_run.unwrap();
        assert_eq!(last_run.status, "completed");
        assert_eq!(last_run.notification_status, "failed");

        remove_test_database(database, directory);
    }

    #[test]
    fn pre_sleep_tick_cannot_claim_and_resume_records_only_the_missed_once() {
        let service = AutomationService::default();
        let (mut database, directory, quick_chat_path) = test_database();
        let local_due = Local::now() + Duration::days(1);
        let create = service
            .create(
                &mut database,
                &user_command(
                    "automation-missed-create",
                    CreateAutomationCommand {
                        name: Some("Missed once".to_string()),
                        prompt: "Run if the app is awake.".to_string(),
                        member_id: "agent_1".to_string(),
                        project_ref: AutomationProjectRef::QuickChat,
                        schedule: AutomationSchedule::Once {
                            date: local_due.format("%Y-%m-%d").to_string(),
                            at: local_due.format("%H:%M").to_string(),
                        },
                        notify_channels: Vec::new(),
                    },
                ),
            )
            .expect("one-time Automation should be created");
        let automation_id = create.result.payload["automationId"]
            .as_str()
            .unwrap()
            .to_string();
        let due = parse_timestamp(create.result.payload["nextRunAt"].as_str().unwrap()).unwrap();

        let stale_tick = service
            .claim_due(
                &mut database,
                due - Duration::seconds(1),
                due - Duration::days(1),
                &quick_chat_path,
            )
            .expect("a pre-sleep tick should remain safe if processed after wake");
        assert!(stale_tick.is_empty());
        let run_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM automation_run WHERE automation_id = ?1",
                [&automation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(run_count, 0);

        let dispatches = service
            .claim_due(
                &mut database,
                due + Duration::minutes(10),
                due + Duration::minutes(10),
                &quick_chat_path,
            )
            .expect("missed occurrence should settle");
        assert!(dispatches.is_empty());
        let definition = service.get(&database, &automation_id).unwrap().unwrap();
        assert!(!definition.enabled);
        assert!(definition.next_run_at.is_none());
        let occurrence: (i64, String, String, Option<String>) = database
            .connection()
            .query_row(
                "SELECT COUNT(*), status, reason, camp_id FROM automation_run WHERE automation_id = ?1",
                [&automation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(occurrence, (1, "skipped".into(), "missed".into(), None));

        remove_test_database(database, directory);
    }
}
