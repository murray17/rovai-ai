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
        DomainCommandGateway, sealed,
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
}

/// A probe target is also the fence for an async result. Re-probes never create revisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampMemberFastTarget {
    pub camp_id: String,
    pub agent_id: String,
    pub runtime_binding_revision: String,
    pub cwd: String,
    pub adapter_kind: AdapterKind,
    pub model_selection_json: Option<String>,
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
        "SELECT profile.runtime_binding_revision, camp.project_path, profile.selected_runtime_adapter_kind,
                profile.default_model_selection_json
         FROM camp_member AS member
         JOIN camp ON camp.id = member.camp_id
         JOIN agent_profile AS profile ON profile.id = member.agent_id
         WHERE member.camp_id = ?1 AND member.agent_id = ?2
           AND member.status = 'active' AND profile.profile_status != 'removed'",
        params![camp_id, agent_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?)),
    ).optional()?;
    let Some((revision, cwd, Some(adapter), model_selection_json)) = row else {
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
        model_selection_json,
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
    // Light readiness can freeze an ordinary Run, but has not loaded the native capabilities
    // needed by Fast (including Codex's per-turn tier). Let the check manager resolve them first.
    let configuration: Option<(Option<String>, Option<String>, Option<String>)> = connection.query_row(
        "SELECT profile.default_runtime_installation_id, profile.default_model_selection_json, profile.default_permission_config_json
         FROM agent_profile AS profile
         JOIN adapter_capability_snapshot AS snapshot ON snapshot.installation_id = profile.default_runtime_installation_id
         WHERE profile.id = ?1 AND snapshot.probe_status = 'ready' AND snapshot.stale_at IS NULL",
        [&expected.agent_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    let Some((Some(installation_id), Some(model), Some(permissions))) = configuration else {
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
    // serviceTier is an audit annotation added during Run freeze, not a model selection.
    let model_selection = |runtime: &FrozenAgentRuntimeConfig| {
        let mut model = runtime.model.clone();
        if runtime.adapter_kind == AdapterKind::CodexCli
            && let Some(options) = model.options.as_object_mut()
        {
            options.remove("serviceTier");
        }
        model
    };
    if model_selection(&current) != model_selection(runtime)
        || current.adapter_kind != runtime.adapter_kind
        || current.installation_id != runtime.installation_id
        || current.auth_scope != runtime.auth_scope
        || current.executable_fingerprint != runtime.executable_fingerprint
        || current.installation_generation != runtime.installation_generation
        || current.search_environment_generation != runtime.search_environment_generation
    {
        return Ok(false);
    }
    connection.execute(
        "INSERT INTO camp_member_fast_preference(camp_id, agent_id, runtime_binding_revision, cwd,
             executable_fingerprint, eligible, runtime_default_fast)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(camp_id, agent_id) DO UPDATE SET
             fast_override = CASE WHEN runtime_binding_revision = excluded.runtime_binding_revision THEN fast_override ELSE NULL END,
             runtime_binding_revision = excluded.runtime_binding_revision, cwd = excluded.cwd,
             executable_fingerprint = excluded.executable_fingerprint, eligible = excluded.eligible,
             runtime_default_fast = excluded.runtime_default_fast",
        params![expected.camp_id, expected.agent_id, expected.runtime_binding_revision, expected.cwd,
            runtime.executable_fingerprint, observation.eligible,
            (runtime.adapter_kind == AdapterKind::CodexCli).then_some(observation.runtime_default_fast).flatten()],
    )?;
    Ok(true)
}

pub(crate) fn view_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<CampMemberFastView>> {
    let row = connection.query_row(
        "SELECT fast.runtime_binding_revision, fast.fast_override,
                CASE WHEN profile.selected_runtime_adapter_kind = 'codex-cli' THEN fast.runtime_default_fast ELSE NULL END
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
        |row| Ok(CampMemberFastView {
            runtime_binding_revision: row.get(0)?,
            fast_override: row.get(1)?,
            runtime_default_fast: row.get(2)?,
        }),
    ).optional()?;
    Ok(row)
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
    runtime.refresh_config_digest()?;
    Ok(())
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

/// Native first-party logins can omit plan metadata (including official setup-token logins).
/// Entitlement and usage limits remain the runtime's responsibility; unknown auth stays hidden.
pub fn claude_subscription_auth(status: &Value) -> bool {
    status.get("loggedIn").and_then(Value::as_bool) == Some(true)
        && matches!(
            status.get("authMethod").and_then(Value::as_str),
            Some("claude.ai" | "oauth_token")
        )
        && status.get("apiProvider").and_then(Value::as_str) == Some("firstParty")
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
/// A Run may refresh eligibility only for its unchanged binding and model configuration.
/// Native execution observations never enter the Camp preference table.
pub fn record_runtime_eligibility(
    database: &Database,
    camp_id: &str,
    agent_id: &str,
    runtime: &FrozenAgentRuntimeConfig,
    observation: &NativeFastEligibility,
) -> Result<bool> {
    let Some(fast) = runtime.camp_fast.as_ref() else {
        return Ok(false);
    };
    let Some(expected) = target(database, camp_id, agent_id)? else {
        return Ok(false);
    };
    if fast.runtime_binding_revision != expected.runtime_binding_revision {
        return Ok(false);
    }
    record_eligibility(database, &expected, runtime, observation)
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
        for method in ["claude.ai", "oauth_token"] {
            for plan in [
                Some(json!("max")),
                Some(Value::Null),
                Some(json!("future-plan")),
                None,
            ] {
                let mut status = subscribed.clone();
                status["authMethod"] = json!(method);
                if let Some(plan) = plan {
                    status["subscriptionType"] = plan;
                } else {
                    status.as_object_mut().unwrap().remove("subscriptionType");
                }
                assert!(
                    claude_subscription_auth(&status),
                    "native first-party auth must not require plan metadata"
                );
            }
        }
        for (key, value) in [
            ("loggedIn", json!(false)),
            ("loggedIn", Value::Null),
            ("authMethod", json!("api_key")),
            ("authMethod", json!("console")),
            ("authMethod", json!("unknown")),
            ("authMethod", Value::Null),
            ("apiProvider", json!("bedrock")),
            ("apiProvider", json!("custom")),
            ("apiProvider", Value::Null),
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
        let mut camps = Vec::new();
        for _ in 0..2 {
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &envelope(
                        None,
                        CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            &["agent_1", "agent_2"],
                            "agent_1",
                        ),
                    ),
                )
                .unwrap();
            camps.push(
                created.result.payload["campId"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
            );
        }
        let camp_id = &camps[0];
        assert_ne!(camps[0], camps[1]);
        let initial = target(&database, camp_id, "agent_1").unwrap().unwrap();
        let runtime = runtime_for_target(&database, &initial).unwrap().unwrap();
        let eligible = NativeFastEligibility {
            eligible: true,
            runtime_default_fast: Some(false),
        };
        let set = |camp: &str, revision: &str, value| {
            envelope(
                Some(camp),
                SetCampMemberFastCommand {
                    camp_id: camp.into(),
                    agent_id: "agent_1".into(),
                    expected_runtime_binding_revision: revision.into(),
                    fast_override: value,
                },
            )
        };
        for (camp, choice) in camps.iter().zip([true, false]) {
            let expected = target(&database, camp, "agent_1").unwrap().unwrap();
            assert!(record_eligibility(&database, &expected, &runtime, &eligible).unwrap());
            let command = set(camp, &initial.runtime_binding_revision, Some(choice));
            assert_eq!(
                set_preference(&mut database, &command)
                    .unwrap()
                    .result
                    .status,
                CommandResultStatus::Applied
            );
            // Receipt replay must not create a second mutation.
            assert_eq!(
                set_preference(&mut database, &command)
                    .unwrap()
                    .result
                    .status,
                CommandResultStatus::Applied
            );
        }
        // A light-ready installation must request native capability resolution before Fast
        // metadata can be checked; failed availability/authentication also stays hidden.
        for (probe_status, authentication_status, ready) in [
            ("light_ready", "unknown", false),
            ("light_ready", "authentication_required", false),
            ("light_failed", "unknown", false),
            ("probe_failed", "authenticated", false),
            ("ready", "authenticated", true),
        ] {
            database.connection().execute(
                "UPDATE adapter_capability_snapshot SET probe_status = ?2, authentication_status = ?3 WHERE installation_id = ?1",
                params![runtime.installation_id, probe_status, authentication_status],
            ).unwrap();
            assert_eq!(
                runtime_for_target(&database, &initial).unwrap().is_some(),
                ready,
                "{probe_status}/{authentication_status} must resolve native capabilities first"
            );
            assert_eq!(
                view(&database, camp_id, "agent_1").unwrap().is_some(),
                ready,
                "{probe_status}/{authentication_status}"
            );
        }
        let assert_saved_choices = |database: &Database| {
            for (camp, choice) in camps.iter().zip([true, false]) {
                let stored: Option<bool> = database.connection().query_row(
                    "SELECT fast_override FROM camp_member_fast_preference WHERE camp_id = ?1 AND agent_id = 'agent_1'",
                    [camp], |row| row.get(0),
                ).unwrap();
                assert_eq!(stored, Some(choice));
            }
        };
        assert!(view(&database, camp_id, "agent_2").unwrap().is_none());
        database.connection().execute(
            "INSERT INTO conversation(id, camp_id, agent_id, summary_through_message_sequence, last_message_sequence, version, created_at, updated_at)
             VALUES ('fast-conversation', ?1, 'agent_1', 0, 0, 1, datetime('now'), datetime('now'))", [camp_id],
        ).unwrap();
        let mut frozen = runtime.clone();
        freeze(
            database.connection(),
            "fast-conversation",
            "agent_1",
            &mut frozen,
        )
        .unwrap();
        assert_eq!(
            frozen.camp_fast.as_ref().unwrap().service_tier_for_turn(),
            Some("priority")
        );
        assert_eq!(frozen.model.options["serviceTier"], "priority");
        assert_eq!(
            frozen.binding_compatibility_digest,
            runtime.binding_compatibility_digest
        );
        assert_eq!(frozen.host_config_digest, runtime.host_config_digest);
        let mut unsigned = frozen.clone();
        unsigned.config_digest.clear();
        assert_eq!(
            frozen.config_digest,
            crate::command::canonical_json_digest(&serde_json::to_value(unsigned).unwrap())
                .unwrap()
        );
        // The audit serviceTier added by freeze must not break model eligibility matching.
        assert!(
            record_runtime_eligibility(&database, camp_id, "agent_1", &frozen, &eligible).unwrap()
        );
        let mut stale_environment = runtime.clone();
        stale_environment.search_environment_generation -= 1;
        assert!(!record_eligibility(&database, &initial, &stale_environment, &eligible).unwrap());
        for choice in [Some(false), None, Some(true)] {
            set_preference(
                &mut database,
                &set(camp_id, &initial.runtime_binding_revision, choice),
            )
            .unwrap();
            let mut next = runtime.clone();
            freeze(
                database.connection(),
                "fast-conversation",
                "agent_1",
                &mut next,
            )
            .unwrap();
            assert_eq!(next.camp_fast.as_ref().unwrap().fast_override, choice);
            assert_eq!(
                next.camp_fast.as_ref().unwrap().service_tier_for_turn(),
                choice.map(|fast| if fast { "priority" } else { "default" })
            );
            assert_eq!(frozen.camp_fast.as_ref().unwrap().fast_override, Some(true));
        }
        record_eligibility(
            &database,
            &initial,
            &runtime,
            &NativeFastEligibility::default(),
        )
        .unwrap();
        assert!(view(&database, camp_id, "agent_1").unwrap().is_none());
        assert_saved_choices(&database);
        let mut retry = runtime.clone();
        freeze(
            database.connection(),
            "fast-conversation",
            "agent_1",
            &mut retry,
        )
        .unwrap();
        assert_eq!(retry.camp_fast.as_ref().unwrap().fast_override, Some(true));
        record_eligibility(&database, &initial, &runtime, &eligible).unwrap();

        // Old persisted observation columns are deliberately absent from the Camp read model.
        database.connection().execute(
            "UPDATE camp_member_fast_preference SET observed_fast_state = 'cooldown', unavailable_reason = 'legacy warning' WHERE agent_id = 'agent_1'", [],
        ).unwrap();
        let projected =
            serde_json::to_value(view(&database, camp_id, "agent_1").unwrap().unwrap()).unwrap();
        assert!(projected.get("observedFastState").is_none());
        assert!(projected.get("unavailableReason").is_none());
        assert_eq!(projected["fastOverride"], true);
        assert_eq!(projected["runtimeDefaultFast"], false);
        database.connection().execute("UPDATE agent_profile SET display_name = 'Renamed', version = version + 1 WHERE id = 'agent_1'", []).unwrap();
        crate::agent_profile::configure_test_runtime(&database, &["agent_1"]);
        assert_eq!(
            target(&database, camp_id, "agent_1").unwrap().unwrap(),
            initial
        );
        let old_permissions: String = database
            .connection()
            .query_row(
                "SELECT default_permission_config_json FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database.connection().execute(
            "UPDATE agent_profile SET default_permission_config_json = json_set(default_permission_config_json, '$.values.approval_policy', 'never') WHERE id = 'agent_1'", [],
        ).unwrap();
        assert_eq!(
            target(&database, camp_id, "agent_1").unwrap().unwrap(),
            initial
        );
        assert_eq!(
            view(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            Some(true)
        );
        assert_saved_choices(&database);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_permission_config_json = ?1 WHERE id = 'agent_1'",
                [&old_permissions],
            )
            .unwrap();

        let old_model = initial.model_selection_json.as_ref().unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                [r#"{"mode":"explicit","modelId":"gpt-test","options":{}}"#],
            )
            .unwrap();
        let changed = target(&database, camp_id, "agent_1").unwrap().unwrap();
        assert_eq!(
            changed.runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert_ne!(changed.model_selection_json, initial.model_selection_json);
        assert_saved_choices(&database);
        for camp in &camps {
            assert!(view(&database, camp, "agent_1").unwrap().is_none());
        }
        assert_eq!(
            set_preference(
                &mut database,
                &set(camp_id, &initial.runtime_binding_revision, Some(true))
            )
            .unwrap()
            .result
            .code,
            "camp_member_fast_unavailable"
        );
        assert!(!record_eligibility(&database, &initial, &runtime, &eligible).unwrap());
        assert!(
            !record_runtime_eligibility(&database, camp_id, "agent_1", &frozen, &eligible).unwrap()
        );
        let changed_runtime = runtime_for_target(&database, &changed).unwrap().unwrap();
        record_eligibility(
            &database,
            &changed,
            &changed_runtime,
            &NativeFastEligibility::default(),
        )
        .unwrap();
        assert_saved_choices(&database);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                [old_model],
            )
            .unwrap();
        for camp in &camps {
            assert!(view(&database, camp, "agent_1").unwrap().is_none());
            let expected = target(&database, camp, "agent_1").unwrap().unwrap();
            let selected = runtime_for_target(&database, &expected).unwrap().unwrap();
            record_eligibility(&database, &expected, &selected, &eligible).unwrap();
        }
        assert_saved_choices(&database);
        assert_eq!(
            view(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            Some(true)
        );
        assert_eq!(
            view(&database, &camps[1], "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            Some(false)
        );

        // Switch to another complete installation and back; neither old choice may revive.
        database.connection().execute(
            "INSERT INTO adapter_installation(id, adapter_kind, executable_path, command_name, installation_class,
                source, auth_scope, enabled, version, created_at, updated_at)
             SELECT 'other-fast-installation', adapter_kind, executable_path, command_name, installation_class,
                source, 'other-fast-scope', enabled, version, created_at, updated_at
             FROM adapter_installation WHERE id = ?1", [&runtime.installation_id],
        ).unwrap();
        database.connection().execute("UPDATE agent_profile SET default_runtime_installation_id = 'other-fast-installation' WHERE id = 'agent_1'", []).unwrap();
        let switched = target(&database, camp_id, "agent_1").unwrap().unwrap();
        assert_ne!(
            switched.runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert_eq!(
            set_preference(
                &mut database,
                &set(camp_id, &initial.runtime_binding_revision, Some(true))
            )
            .unwrap()
            .result
            .code,
            "runtime_binding_conflict"
        );
        assert!(
            !record_runtime_eligibility(&database, camp_id, "agent_1", &frozen, &eligible).unwrap()
        );
        database.connection().execute("UPDATE agent_profile SET default_runtime_installation_id = ?1 WHERE id = 'agent_1'", [&runtime.installation_id]).unwrap();
        let rebound = target(&database, camp_id, "agent_1").unwrap().unwrap();
        assert_ne!(
            rebound.runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert_ne!(
            rebound.runtime_binding_revision,
            switched.runtime_binding_revision
        );
        assert!(view(&database, &camps[1], "agent_1").unwrap().is_none());
        let selected = runtime_for_target(&database, &rebound).unwrap().unwrap();
        record_eligibility(&database, &rebound, &selected, &eligible).unwrap();
        assert_eq!(
            view(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            None
        );
        set_preference(
            &mut database,
            &set(camp_id, &rebound.runtime_binding_revision, Some(true)),
        )
        .unwrap();
        database.connection().execute("UPDATE adapter_installation SET auth_scope = 'different-account-scope' WHERE id = ?1", [&runtime.installation_id]).unwrap();
        assert_ne!(
            target(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .runtime_binding_revision,
            rebound.runtime_binding_revision
        );
        assert!(view(&database, camp_id, "agent_1").unwrap().is_none());
    }
}
