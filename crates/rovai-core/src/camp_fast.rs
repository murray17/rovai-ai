//! Camp-local Fast intent. Native authentication/configuration stays in the adapters.
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    agent_profile::{
        AdapterKind, FrozenAgentRuntimeConfig, ResolvedRuntimeBinding,
        resolve_frozen_runtime_binding,
    },
    command::{
        CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, canonical_json_digest, sealed,
    },
    db::Database,
};

pub const CODEX_FAST_TURN_CAPABILITY: &str = "codex.service_tier_for_turn";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedFastState {
    #[default]
    Unknown,
    Standard,
    Fast,
    Cooldown,
}

impl ObservedFastState {
    pub fn from_claude(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "on" => Some(Self::Fast),
            "off" => Some(Self::Standard),
            "cooldown" => Some(Self::Cooldown),
            _ => None,
        }
    }

    pub fn from_tier(tier: &str) -> Option<Self> {
        match tier {
            "priority" | "fast" => Some(Self::Fast),
            "default" | "standard" => Some(Self::Standard),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Standard => "standard",
            Self::Fast => "fast",
            Self::Cooldown => "cooldown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenCampMemberFast {
    pub runtime_binding_revision: String,
    pub fast_override: Option<bool>,
}

impl FrozenCampMemberFast {
    pub fn service_tier_for_turn(&self) -> Option<&'static str> {
        self.fast_override
            .map(|fast| if fast { "priority" } else { "default" })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMemberFastView {
    pub runtime_binding_revision: String,
    pub fast_override: Option<bool>,
    pub runtime_default_fast: Option<bool>,
    pub observed_fast_state: ObservedFastState,
    pub unavailable_reason: Option<String>,
}

/// A probe target is also the fence for an async result. Re-probes never create revisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampMemberFastTarget {
    pub camp_id: String,
    pub agent_id: String,
    pub runtime_binding_revision: String,
    pub cwd: String,
    pub adapter_kind: AdapterKind,
}

#[derive(Debug, Clone, Default)]
pub struct NativeFastEligibility {
    pub eligible: bool,
    pub runtime_default_fast: Option<bool>,
}

pub(crate) fn target_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<CampMemberFastTarget>> {
    let row = connection.query_row(
        "SELECT profile.runtime_binding_revision, camp.project_path, profile.selected_runtime_adapter_kind
         FROM camp_member AS member
         JOIN camp ON camp.id = member.camp_id
         JOIN agent_profile AS profile ON profile.id = member.agent_id
         WHERE member.camp_id = ?1 AND member.agent_id = ?2
           AND member.status = 'active' AND profile.profile_status != 'removed'",
        params![camp_id, agent_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)),
    ).optional()?;
    let Some((revision, cwd, Some(adapter))) = row else {
        return Ok(None);
    };
    let adapter_kind: AdapterKind = adapter.parse()?;
    if !matches!(
        adapter_kind,
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli
    ) {
        return Ok(None);
    }
    Ok(Some(CampMemberFastTarget {
        camp_id: camp_id.into(),
        agent_id: agent_id.into(),
        runtime_binding_revision: revision,
        cwd,
        adapter_kind,
    }))
}

pub(crate) fn runtime_for_target_on_connection(
    connection: &Connection,
    expected: &CampMemberFastTarget,
) -> Result<Option<FrozenAgentRuntimeConfig>> {
    if target_on_connection(connection, &expected.camp_id, &expected.agent_id)?.as_ref()
        != Some(expected)
    {
        return Ok(None);
    }
    let (installation_id, model, permissions): (Option<String>, Option<String>, Option<String>) = connection.query_row(
        "SELECT default_runtime_installation_id, default_model_selection_json, default_permission_config_json FROM agent_profile WHERE id = ?1",
        [&expected.agent_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let (Some(installation_id), Some(model), Some(permissions)) =
        (installation_id, model, permissions)
    else {
        return Ok(None);
    };
    let binding = ResolvedRuntimeBinding {
        adapter_kind: expected.adapter_kind,
        installation_id,
        model: serde_json::from_str(&model)?,
        permissions: serde_json::from_str(&permissions)?,
    };
    Ok(resolve_frozen_runtime_binding(connection, &binding)?.ok())
}

pub(crate) fn record_eligibility_on_connection(
    connection: &Connection,
    expected: &CampMemberFastTarget,
    runtime: &FrozenAgentRuntimeConfig,
    observation: &NativeFastEligibility,
) -> Result<bool> {
    let Some(current) = runtime_for_target_on_connection(connection, expected)? else {
        return Ok(false);
    };
    if current.executable_fingerprint != runtime.executable_fingerprint
        || current.installation_generation != runtime.installation_generation
    {
        return Ok(false);
    }
    connection.execute(
        "INSERT INTO camp_member_fast_preference(camp_id, agent_id, runtime_binding_revision, cwd,
             executable_fingerprint, eligible, runtime_default_fast)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(camp_id, agent_id) DO UPDATE SET
             fast_override = CASE WHEN runtime_binding_revision = excluded.runtime_binding_revision THEN fast_override ELSE NULL END,
             observed_fast_state = CASE WHEN runtime_binding_revision = excluded.runtime_binding_revision AND cwd = excluded.cwd AND executable_fingerprint = excluded.executable_fingerprint THEN observed_fast_state ELSE 'unknown' END,
             unavailable_reason = CASE WHEN runtime_binding_revision = excluded.runtime_binding_revision AND cwd = excluded.cwd AND executable_fingerprint = excluded.executable_fingerprint THEN unavailable_reason ELSE NULL END,
             runtime_binding_revision = excluded.runtime_binding_revision, cwd = excluded.cwd,
             executable_fingerprint = excluded.executable_fingerprint, eligible = excluded.eligible,
             runtime_default_fast = CASE WHEN ?8 AND runtime_binding_revision = excluded.runtime_binding_revision AND cwd = excluded.cwd AND executable_fingerprint = excluded.executable_fingerprint
                 THEN COALESCE(excluded.runtime_default_fast, runtime_default_fast) ELSE excluded.runtime_default_fast END",
        params![expected.camp_id, expected.agent_id, expected.runtime_binding_revision, expected.cwd,
            runtime.executable_fingerprint, observation.eligible, observation.runtime_default_fast, runtime.adapter_kind == AdapterKind::ClaudeCodeCli],
    )?;
    Ok(true)
}

pub(crate) fn view_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<CampMemberFastView>> {
    let row = connection.query_row(
        "SELECT fast.runtime_binding_revision, fast.fast_override, fast.runtime_default_fast,
                fast.observed_fast_state, fast.unavailable_reason
         FROM camp_member_fast_preference AS fast
         JOIN camp_member AS member ON member.camp_id = fast.camp_id AND member.agent_id = fast.agent_id
         JOIN camp ON camp.id = fast.camp_id
         JOIN agent_profile AS profile ON profile.id = fast.agent_id
         JOIN adapter_installation AS installation ON installation.id = profile.default_runtime_installation_id
         JOIN adapter_capability_snapshot AS snapshot ON snapshot.installation_id = profile.default_runtime_installation_id
         WHERE fast.camp_id = ?1 AND fast.agent_id = ?2 AND fast.eligible = 1
           AND fast.runtime_binding_revision = profile.runtime_binding_revision
           AND fast.cwd = camp.project_path AND member.status = 'active'
           AND profile.profile_status != 'removed' AND snapshot.stale_at IS NULL
           AND installation.enabled = 1 AND snapshot.probe_status = 'ready'
           AND snapshot.authentication_status != 'authentication_required'
           AND fast.executable_fingerprint = snapshot.executable_fingerprint",
        params![camp_id, agent_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<bool>>(1)?, row.get::<_, Option<bool>>(2)?,
            row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?)),
    ).optional()?;
    row.map(
        |(
            runtime_binding_revision,
            fast_override,
            runtime_default_fast,
            state,
            unavailable_reason,
        )| {
            Ok(CampMemberFastView {
                runtime_binding_revision,
                fast_override,
                runtime_default_fast,
                observed_fast_state: serde_json::from_value(json!(state))?,
                unavailable_reason,
            })
        },
    )
    .transpose()
}

pub fn freeze(
    connection: &Connection,
    conversation_id: &str,
    agent_id: &str,
    runtime: &mut FrozenAgentRuntimeConfig,
) -> Result<()> {
    let camp_id: Option<String> = connection
        .query_row(
            "SELECT camp_id FROM conversation WHERE id = ?1",
            [conversation_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(camp_id) = camp_id else {
        return Ok(());
    };
    let Some(target) = target_on_connection(connection, &camp_id, agent_id)? else {
        return Ok(());
    };
    let preference = view_on_connection(connection, &camp_id, agent_id)?;
    let saved_override = connection.query_row(
        "SELECT fast_override FROM camp_member_fast_preference WHERE camp_id = ?1 AND agent_id = ?2 AND runtime_binding_revision = ?3",
        params![camp_id, agent_id, target.runtime_binding_revision], |row| row.get::<_, Option<bool>>(0),
    ).optional()?.flatten();
    let fast = FrozenCampMemberFast {
        runtime_binding_revision: target.runtime_binding_revision,
        fast_override: saved_override,
    };
    // Requested pricing is an audit value; adapters still use only fast_override for transport.
    if runtime.adapter_kind == AdapterKind::CodexCli {
        let requested = fast.service_tier_for_turn().or_else(|| {
            preference
                .as_ref()
                .and_then(|value| value.runtime_default_fast)
                .map(|fast| if fast { "priority" } else { "default" })
        });
        if let Some(tier) = requested {
            if !runtime.model.options.is_object() {
                runtime.model.options = json!({});
            }
            runtime.model.options["serviceTier"] = json!(tier);
        }
    }
    runtime.camp_fast = Some(fast);
    runtime.config_digest = canonical_json_digest(&json!({
        "runtimeConfigDigest": runtime.config_digest, "campFast": runtime.camp_fast,
    }))?;
    Ok(())
}

pub(crate) fn record_observation_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
    revision: &str,
    state: ObservedFastState,
    inherited: bool,
) -> Result<bool> {
    // A late result from an old binding cannot alter the new binding, or the user's intent.
    Ok(connection.execute(
        "UPDATE camp_member_fast_preference SET observed_fast_state = ?4, unavailable_reason = ?5,
             runtime_default_fast = CASE WHEN ?6 THEN ?7 ELSE runtime_default_fast END
         WHERE camp_id = ?1 AND agent_id = ?2 AND runtime_binding_revision = ?3
           AND EXISTS(SELECT 1 FROM agent_profile WHERE id = ?2 AND runtime_binding_revision = ?3)",
        params![
            camp_id,
            agent_id,
            revision,
            state.as_str(),
            (state == ObservedFastState::Cooldown).then_some("Fast 暂时不可用，本次按标准速度执行"),
            inherited,
            match state {
                ObservedFastState::Fast | ObservedFastState::Cooldown => Some(true),
                ObservedFastState::Standard => Some(false),
                ObservedFastState::Unknown => None,
            }
        ],
    )? > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCampMemberFastCommand {
    pub camp_id: String,
    pub agent_id: String,
    pub expected_runtime_binding_revision: String,
    pub fast_override: Option<bool>,
}

impl sealed::Sealed for SetCampMemberFastCommand {}
impl DomainCommand for SetCampMemberFastCommand {
    const TYPE: &'static str = "camp.member.fast.set";
}

pub fn set_preference(
    database: &mut Database,
    envelope: &CommandEnvelope<SetCampMemberFastCommand>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |transaction| {
        let command = &envelope.payload;
        if envelope.camp_id.as_deref() != Some(command.camp_id.as_str()) {
            return Ok(CommandHandlerResult::rejected(
                "camp_scope_mismatch",
                json!({}),
            ));
        }
        let Some(target) = target_on_connection(transaction, &command.camp_id, &command.agent_id)?
        else {
            return Ok(CommandHandlerResult::rejected(
                "camp_member_fast_unavailable",
                json!({}),
            ));
        };
        if target.runtime_binding_revision != command.expected_runtime_binding_revision {
            return Ok(CommandHandlerResult::rejected(
                "runtime_binding_conflict",
                json!({}),
            ));
        }
        if command.fast_override.is_some()
            && view_on_connection(transaction, &command.camp_id, &command.agent_id)?.is_none()
        {
            return Ok(CommandHandlerResult::rejected(
                "camp_member_fast_unavailable",
                json!({}),
            ));
        }
        transaction.execute(
            "UPDATE camp_member_fast_preference SET fast_override = ?4
             WHERE camp_id = ?1 AND agent_id = ?2 AND runtime_binding_revision = ?3",
            params![
                command.camp_id,
                command.agent_id,
                command.expected_runtime_binding_revision,
                command.fast_override
            ],
        )?;
        Ok(CommandHandlerResult::applied(
            "camp.member.fast.updated",
            json!({
                "campId": command.camp_id, "agentId": command.agent_id,
                "fast": view_on_connection(transaction, &command.camp_id, &command.agent_id)?,
            }),
            None,
        ))
    })
}

/// Only native, non-secret account classifications are accepted. Unknown shapes stay hidden.
pub fn claude_subscription_auth(status: &Value) -> bool {
    status.get("loggedIn").and_then(Value::as_bool) == Some(true)
        && status.get("authMethod").and_then(Value::as_str) == Some("claude.ai")
        && status.get("apiProvider").and_then(Value::as_str) == Some("firstParty")
        && matches!(
            status.get("subscriptionType").and_then(Value::as_str),
            Some("pro" | "max" | "team" | "enterprise")
        )
}

pub fn claude_fast_version_supported(version: Option<&str>) -> bool {
    let Some(version) = version.and_then(|value| {
        value
            .split_whitespace()
            .find(|part| part.starts_with(|c: char| c.is_ascii_digit()))
    }) else {
        return false;
    };
    let values = version
        .split('.')
        .take(3)
        .map(str::parse::<u32>)
        .collect::<std::result::Result<Vec<_>, _>>();
    values.is_ok_and(|values| values.len() == 3 && (values[0], values[1], values[2]) >= (2, 1, 219))
}

pub fn codex_eligibility(
    account: &Value,
    config_response: &Value,
    catalog: &Value,
    explicit_model: Option<&str>,
) -> NativeFastEligibility {
    let unavailable = NativeFastEligibility::default();
    if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
        return unavailable;
    }
    let Some(config) = config_response.get("config").and_then(Value::as_object) else {
        return unavailable;
    };
    let provider = config
        .get("model_provider")
        .and_then(Value::as_str)
        .unwrap_or("openai");
    if provider != "openai"
        || config
            .get("model_providers")
            .and_then(|providers| providers.get(provider))
            .and_then(|provider| provider.get("base_url"))
            .is_some_and(|url| !url.is_null())
    {
        return unavailable;
    }
    let Some(models) = catalog.get("data").and_then(Value::as_array) else {
        return unavailable;
    };
    let selected = explicit_model.or_else(|| config.get("model").and_then(Value::as_str));
    let model = models.iter().find(|model| match selected {
        Some(id) => {
            model.get("id").and_then(Value::as_str) == Some(id)
                || model.get("model").and_then(Value::as_str) == Some(id)
        }
        None => model.get("isDefault").and_then(Value::as_bool) == Some(true),
    });
    let Some(model) = model else {
        return unavailable;
    };
    let supported = model
        .get("serviceTiers")
        .or_else(|| model.get("service_tiers"))
        .and_then(Value::as_array)
        .is_some_and(|tiers| {
            tiers.iter().any(|tier| {
                matches!(
                    tier.as_str()
                        .or_else(|| tier.get("id").and_then(Value::as_str)),
                    Some("priority" | "fast")
                )
            })
        });
    if !supported {
        return unavailable;
    }
    let tier = config
        .get("service_tier")
        .and_then(Value::as_str)
        .or_else(|| {
            model
                .get("defaultServiceTier")
                .or_else(|| model.get("default_service_tier"))
                .and_then(Value::as_str)
        });
    let default = match tier {
        Some("priority" | "fast") => Some(true),
        None | Some("default" | "standard") => Some(false),
        _ => None,
    };
    NativeFastEligibility {
        eligible: true,
        runtime_default_fast: default,
    }
}

pub fn merge_claude_inline_settings(
    settings: &mut Value,
    fast_override: Option<bool>,
) -> Result<()> {
    let settings = settings
        .as_object_mut()
        .context("Claude inline settings must be an object")?;
    if let Some(fast) = fast_override {
        settings.insert("fastMode".into(), json!(fast));
    }
    Ok(())
}

// Public service boundary: the binary never receives the database connection.
pub fn target(
    database: &Database,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<CampMemberFastTarget>> {
    target_on_connection(database.connection(), camp_id, agent_id)
}
pub fn view(
    database: &Database,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<CampMemberFastView>> {
    view_on_connection(database.connection(), camp_id, agent_id)
}
pub fn runtime_for_target(
    database: &Database,
    target: &CampMemberFastTarget,
) -> Result<Option<FrozenAgentRuntimeConfig>> {
    runtime_for_target_on_connection(database.connection(), target)
}
pub fn record_eligibility(
    database: &Database,
    target: &CampMemberFastTarget,
    runtime: &FrozenAgentRuntimeConfig,
    observation: &NativeFastEligibility,
) -> Result<bool> {
    record_eligibility_on_connection(database.connection(), target, runtime, observation)
}
pub fn record_observation(
    database: &Database,
    camp_id: &str,
    agent_id: &str,
    revision: &str,
    state: ObservedFastState,
    inherited: bool,
) -> Result<bool> {
    record_observation_on_connection(
        database.connection(),
        camp_id,
        agent_id,
        revision,
        state,
        inherited,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{ActorRef, CommandResultStatus};

    fn envelope<T>(camp_id: Option<&str>, payload: T) -> CommandEnvelope<T> {
        CommandEnvelope {
            command_id: uuid::Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: camp_id.map(str::to_owned),
            expected_versions: vec![],
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn native_claude_auth_and_inline_settings_fail_closed() {
        let subscribed = json!({"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"});
        assert!(claude_subscription_auth(&subscribed));
        for (key, value) in [
            ("loggedIn", json!(false)),
            ("authMethod", json!("api_key")),
            ("authMethod", json!("oauth_token")),
            ("apiProvider", json!("bedrock")),
            ("subscriptionType", Value::Null),
        ] {
            let mut status = subscribed.clone();
            status[key] = value;
            assert!(!claude_subscription_auth(&status));
        }
        assert!(!claude_subscription_auth(&json!({"loggedIn": true})));
        for (version, supported) in [
            (None, false),
            (Some("2.1.218 (Claude Code)"), false),
            (Some("2.1.219 (Claude Code)"), true),
            (Some("2.1.220 (Claude Code)"), true),
            (Some("unknown"), false),
        ] {
            assert_eq!(claude_fast_version_supported(version), supported);
        }
        for value in [None, Some(true), Some(false)] {
            let mut settings = json!({"language": "中文"});
            merge_claude_inline_settings(&mut settings, value).unwrap();
            assert_eq!(settings["language"], "中文");
            assert_eq!(settings.get("fastMode").and_then(Value::as_bool), value);
        }
    }

    #[test]
    fn codex_uses_native_account_effective_config_and_model_tiers() {
        let account = json!({"account": {"type": "chatgpt"}});
        let catalog = json!({"data": [{"id": "unhardcoded-model", "isDefault": true,
            "serviceTiers": [{"id": "priority"}], "defaultServiceTier": "priority"}]});
        for (configured, expected) in [
            (Value::Null, Some(true)),
            (json!("default"), Some(false)),
            (json!("fast"), Some(true)),
            (json!("priority"), Some(true)),
            (json!("future-tier"), None),
        ] {
            // config/read already resolved profile and project layers; raw layer values cannot override it.
            let result = codex_eligibility(
                &account,
                &json!({"config": {"service_tier": configured},
                "layers": [{"config": {"service_tier": "default"}}]}),
                &catalog,
                None,
            );
            assert!(result.eligible);
            assert_eq!(result.runtime_default_fast, expected);
        }
        let legacy = json!({"data": [{"id": "another-model", "isDefault": true, "service_tiers": ["fast"]}]});
        assert_eq!(
            codex_eligibility(&account, &json!({"config": {}}), &legacy, None).runtime_default_fast,
            Some(false)
        );
        for bad_account in [
            json!({}),
            json!({"account": null}),
            json!({"account": {"type": "apiKey"}}),
        ] {
            assert!(
                !codex_eligibility(&bad_account, &json!({"config": {}}), &catalog, None).eligible
            );
        }
        for config in [
            json!({}),
            json!({"config": {"model_provider": "gateway"}}),
            json!({"config": {"model_providers": {"openai": {"base_url": "https://custom.invalid"}}}}),
        ] {
            assert!(!codex_eligibility(&account, &config, &catalog, None).eligible);
        }
        assert!(
            !codex_eligibility(
                &account,
                &json!({"config": {}}),
                &catalog,
                Some("missing-model")
            )
            .eligible
        );
        assert!(
            !codex_eligibility(
                &account,
                &json!({"config": {}}),
                &json!({"data": [{"id": "no-tier", "isDefault": true}]}),
                None
            )
            .eligible
        );
    }

    #[test]
    fn camp_preference_survives_probes_but_not_rebinding_and_frozen_runs_do_not_change() {
        use crate::collaboration::{CollaborationService, CreateCampCommand};
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let create = envelope(
            None,
            CreateCampCommand::for_test_with_members(
                workspace.to_string_lossy().into_owned(),
                &["agent_1", "agent_2"],
                "agent_1",
            ),
        );
        let created = CollaborationService::default()
            .create_camp(&mut database, &create)
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_owned();
        let initial = target(&database, &camp_id, "agent_1").unwrap().unwrap();
        let runtime = runtime_for_target(&database, &initial).unwrap().unwrap();
        let observed = NativeFastEligibility {
            eligible: true,
            runtime_default_fast: Some(false),
        };
        assert!(record_eligibility(&database, &initial, &runtime, &observed).unwrap());
        let set = |value| {
            envelope(
                Some(&camp_id),
                SetCampMemberFastCommand {
                    camp_id: camp_id.clone(),
                    agent_id: "agent_1".into(),
                    expected_runtime_binding_revision: initial.runtime_binding_revision.clone(),
                    fast_override: value,
                },
            )
        };
        let command = set(Some(true));
        assert_eq!(
            set_preference(&mut database, &command)
                .unwrap()
                .result
                .status,
            CommandResultStatus::Applied
        );
        // Receipt replay does not create a second mutation.
        assert_eq!(
            set_preference(&mut database, &command)
                .unwrap()
                .result
                .status,
            CommandResultStatus::Applied
        );
        database.connection().execute(
            "INSERT INTO conversation(id, camp_id, agent_id, summary_through_message_sequence, last_message_sequence, version, created_at, updated_at)
             VALUES ('fast-conversation', ?1, 'agent_1', 0, 0, 1, datetime('now'), datetime('now'))", [&camp_id]).unwrap();
        let conversation: String = database
            .connection()
            .query_row(
                "SELECT id FROM conversation WHERE camp_id = ?1 AND agent_id = 'agent_1'",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut frozen = runtime.clone();
        freeze(database.connection(), &conversation, "agent_1", &mut frozen).unwrap();
        assert_eq!(frozen.model.options["serviceTier"], "priority");
        assert_eq!(
            frozen.binding_compatibility_digest,
            runtime.binding_compatibility_digest
        );
        assert_eq!(frozen.host_config_digest, runtime.host_config_digest);
        record_eligibility(&database, &initial, &runtime, &observed).unwrap();
        record_observation(
            &database,
            &camp_id,
            "agent_1",
            &initial.runtime_binding_revision,
            ObservedFastState::Cooldown,
            false,
        )
        .unwrap();
        let preference = view(&database, &camp_id, "agent_1").unwrap().unwrap();
        assert_eq!(preference.fast_override, Some(true));
        assert_eq!(preference.observed_fast_state, ObservedFastState::Cooldown);
        assert!(view(&database, &camp_id, "agent_2").unwrap().is_none());
        record_eligibility(
            &database,
            &initial,
            &runtime,
            &NativeFastEligibility::default(),
        )
        .unwrap();
        let mut retry = runtime.clone();
        freeze(database.connection(), &conversation, "agent_1", &mut retry).unwrap();
        assert_eq!(retry.camp_fast.unwrap().fast_override, Some(true));
        record_eligibility(&database, &initial, &runtime, &observed).unwrap();
        set_preference(&mut database, &set(Some(false))).unwrap();
        assert_eq!(frozen.camp_fast.as_ref().unwrap().fast_override, Some(true));
        let mut next = runtime.clone();
        freeze(database.connection(), &conversation, "agent_1", &mut next).unwrap();
        assert_eq!(next.model.options["serviceTier"], "default");
        set_preference(&mut database, &set(None)).unwrap();
        assert_eq!(
            view(&database, &camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            None
        );
        set_preference(&mut database, &set(Some(true))).unwrap();
        // Metadata/health and unrelated member edits cannot rotate the binding revision.
        database.connection().execute("UPDATE agent_profile SET display_name = 'Renamed', version = version + 1 WHERE id = 'agent_1'", []).unwrap();
        crate::agent_profile::configure_test_runtime(&database, &["agent_1"]);
        assert_eq!(
            target(&database, &camp_id, "agent_1").unwrap().unwrap(),
            initial
        );
        assert_eq!(
            view(&database, &camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            Some(true)
        );
        let old_model: String = database
            .connection()
            .query_row(
                "SELECT default_model_selection_json FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                ["{\"mode\":\"explicit\",\"modelId\":\"gpt-test\",\"options\":{}}"],
            )
            .unwrap();
        let changed = target(&database, &camp_id, "agent_1").unwrap().unwrap();
        assert_ne!(
            changed.runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert_eq!(
            set_preference(&mut database, &set(Some(true)))
                .unwrap()
                .result
                .code,
            "runtime_binding_conflict"
        );
        assert!(!record_eligibility(&database, &initial, &runtime, &observed).unwrap());
        assert!(
            !record_observation(
                &database,
                &camp_id,
                "agent_1",
                &initial.runtime_binding_revision,
                ObservedFastState::Fast,
                false
            )
            .unwrap()
        );
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                [&old_model],
            )
            .unwrap();
        assert_ne!(
            target(&database, &camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert!(view(&database, &camp_id, "agent_1").unwrap().is_none());
    }
}
