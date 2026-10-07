//! Camp-local Fast intent. Native authentication/configuration stays in the adapters.
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
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
    /// A display baseline, never a transport override or proof of per-turn pricing.
    pub fn fast_default(self) -> Option<bool> {
        match self {
            Self::Fast | Self::Cooldown => Some(true),
            Self::Standard => Some(false),
            Self::Unknown => None,
        }
    }

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
pub struct FrozenThreadMemberFast {
    pub runtime_binding_revision: String,
    pub fast_override: Option<bool>,
}

impl FrozenThreadMemberFast {
    pub fn service_tier_for_turn(&self) -> Option<&'static str> {
        self.fast_override
            .map(|fast| if fast { "priority" } else { "default" })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMemberFastView {
    pub runtime_binding_revision: String,
    pub fast_override: Option<bool>,
    pub runtime_default_fast: Option<bool>,
}

/// The saved member binding fences preference writes; health is not part of the intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadMemberFastTarget {
    pub camp_id: String,
    pub agent_id: String,
    pub runtime_binding_revision: String,
    pub cwd: String,
    pub adapter_kind: AdapterKind,
    pub model_selection_json: Option<String>,
}

pub(crate) fn target_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<ThreadMemberFastTarget>> {
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
    Ok(Some(ThreadMemberFastTarget {
        camp_id: camp_id.into(),
        agent_id: agent_id.into(),
        runtime_binding_revision: revision,
        cwd,
        adapter_kind,
        model_selection_json,
    }))
}

pub(crate) fn view_on_connection(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<ThreadMemberFastView>> {
    let row = connection
        .query_row(
            "SELECT profile.runtime_binding_revision, fast.fast_override,
                    CASE WHEN fast.executable_fingerprint = '' THEN fast.runtime_default_fast END
         FROM camp_member AS member
         JOIN agent_profile AS profile ON profile.id = member.agent_id
         LEFT JOIN camp_member_fast_preference AS fast
           ON fast.camp_id = member.camp_id AND fast.agent_id = member.agent_id
          AND fast.runtime_binding_revision = profile.runtime_binding_revision
         WHERE member.camp_id = ?1 AND member.agent_id = ?2
           AND member.status = 'active' AND profile.profile_status != 'removed'
           AND profile.selected_runtime_adapter_kind IN ('claude-code-cli', 'codex-cli')",
            params![camp_id, agent_id],
            |row| {
                Ok(ThreadMemberFastView {
                    runtime_binding_revision: row.get(0)?,
                    fast_override: row.get(1)?,
                    runtime_default_fast: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

/// Store only the real Host's initialization baseline in the existing member row.
/// Legacy diagnostic rows carry a fingerprint and are not a baseline source.
/// Callers fence the Run/epoch and exclude launches with a frozen Fast override.
pub fn record_runtime_default(
    connection: &Connection,
    camp_id: &str,
    agent_id: &str,
    runtime_binding_revision: &str,
    native_default: Option<bool>,
) -> Result<bool> {
    let changed = connection.execute(
        "INSERT INTO camp_member_fast_preference(
            camp_id, agent_id, runtime_binding_revision, cwd, executable_fingerprint, runtime_default_fast)
         SELECT member.camp_id, member.agent_id, profile.runtime_binding_revision, camp.project_path, '', ?4
         FROM camp_member AS member
         JOIN camp ON camp.id = member.camp_id
         JOIN agent_profile AS profile ON profile.id = member.agent_id
         WHERE member.camp_id = ?1 AND member.agent_id = ?2
           AND member.status = 'active' AND profile.profile_status != 'removed'
           AND profile.runtime_binding_revision = ?3
           AND profile.selected_runtime_adapter_kind IN ('claude-code-cli', 'codex-cli')
         ON CONFLICT(camp_id, agent_id) DO UPDATE SET
            runtime_default_fast = excluded.runtime_default_fast, executable_fingerprint = ''
         WHERE camp_member_fast_preference.runtime_binding_revision = excluded.runtime_binding_revision
           AND camp_member_fast_preference.fast_override IS NULL
           AND (camp_member_fast_preference.runtime_default_fast IS NOT excluded.runtime_default_fast
                OR camp_member_fast_preference.executable_fingerprint != '')",
        params![camp_id, agent_id, runtime_binding_revision, native_default],
    )?;
    Ok(changed != 0)
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
    let Some(preference) = view_on_connection(connection, &camp_id, agent_id)? else {
        return Ok(());
    };
    let fast = FrozenThreadMemberFast {
        runtime_binding_revision: preference.runtime_binding_revision,
        fast_override: preference.fast_override,
    };
    // Requested pricing is an audit value; adapters still use only fast_override for transport.
    if runtime.adapter_kind == AdapterKind::CodexCli {
        let requested = fast.service_tier_for_turn();
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
pub struct SetThreadMemberFastCommand {
    #[serde(rename = "threadId", alias = "campId")]
    pub camp_id: String,
    pub agent_id: String,
    pub expected_runtime_binding_revision: String,
    pub fast_override: Option<bool>,
}

impl sealed::Sealed for SetThreadMemberFastCommand {}
impl DomainCommand for SetThreadMemberFastCommand {
    const TYPE: &'static str = "camp.member.fast.set";
}

pub fn set_preference(
    database: &mut Database,
    envelope: &CommandEnvelope<SetThreadMemberFastCommand>,
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
        // First save uses the same transaction and receipt as updates. Legacy qualification
        // columns stay inert; no probe or file access is needed to persist user intent.
        transaction.execute(
            "INSERT INTO camp_member_fast_preference(camp_id, agent_id, runtime_binding_revision,
                 cwd, executable_fingerprint, fast_override)
             VALUES (?1, ?2, ?3, ?4, '', ?5)
             ON CONFLICT(camp_id, agent_id) DO UPDATE SET
                 runtime_binding_revision = excluded.runtime_binding_revision,
                 cwd = excluded.cwd, fast_override = excluded.fast_override",
            params![
                command.camp_id,
                command.agent_id,
                command.expected_runtime_binding_revision,
                target.cwd,
                command.fast_override
            ],
        )?;
        Ok(CommandHandlerResult::applied(
            "camp.member.fast.updated",
            json!({
                "threadId": command.camp_id, "agentId": command.agent_id,
                "fast": view_on_connection(transaction, &command.camp_id, &command.agent_id)?,
            }),
            None,
        ))
    })
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
) -> Result<Option<ThreadMemberFastTarget>> {
    target_on_connection(database.connection(), camp_id, agent_id)
}
pub fn view(
    database: &Database,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<ThreadMemberFastView>> {
    view_on_connection(database.connection(), camp_id, agent_id)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "extended-tests")]
    use crate::command::{ActorRef, CommandResultStatus};

    #[cfg(feature = "extended-tests")]
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
    fn native_overrides_preserve_three_states_without_qualification() {
        for value in [None, Some(true), Some(false)] {
            let mut settings = json!({"language": "中文"});
            merge_claude_inline_settings(&mut settings, value).unwrap();
            assert_eq!(settings["language"], "中文");
            assert_eq!(settings.get("fastMode").and_then(Value::as_bool), value);
            let frozen = FrozenThreadMemberFast {
                runtime_binding_revision: "binding".into(),
                fast_override: value,
            };
            assert_eq!(
                frozen.service_tier_for_turn(),
                value.map(|fast| if fast { "priority" } else { "default" })
            );
        }
        let mut native_default = json!({"fastMode": true});
        merge_claude_inline_settings(&mut native_default, Some(false)).unwrap();
        assert_eq!(native_default["fastMode"], false);
        assert!(merge_claude_inline_settings(&mut json!(null), Some(false)).is_err());
        for (native, expected) in [
            ("on", Some(true)),
            ("cooldown", Some(true)),
            ("off", Some(false)),
            ("future", None),
        ] {
            assert_eq!(
                ObservedFastState::from_claude(&json!(native))
                    .and_then(ObservedFastState::fast_default),
                expected
            );
        }
        for (tier, expected) in [
            ("fast", Some(true)),
            ("priority", Some(true)),
            ("default", Some(false)),
            ("standard", Some(false)),
            ("future", None),
        ] {
            assert_eq!(
                ObservedFastState::from_tier(tier).and_then(ObservedFastState::fast_default),
                expected
            );
        }
    }

    #[cfg(feature = "extended-tests")]
    #[test]
    fn camp_preference_survives_probes_but_not_rebinding_and_frozen_runs_do_not_change() {
        use crate::agent_profile::{ResolvedRuntimeBinding, resolve_frozen_runtime_binding};
        use crate::collaboration::{CollaborationService, CreateThreadCommand};
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let camps: Vec<String> = (0..2)
            .map(|_| {
                CollaborationService::default()
                    .create_camp(
                        &mut database,
                        &envelope(
                            None,
                            CreateThreadCommand::for_test_with_members(
                                workspace.to_string_lossy().into_owned(),
                                &["agent_1", "agent_2"],
                                "agent_1",
                            ),
                        ),
                    )
                    .unwrap()
                    .result
                    .payload["threadId"]
                    .as_str()
                    .unwrap()
                    .into()
            })
            .collect();
        let camp_id = &camps[0];
        let initial = target(&database, camp_id, "agent_1").unwrap().unwrap();
        let (installation_id, model, permissions): (String, String, String) = database.connection().query_row(
            "SELECT default_runtime_installation_id, default_model_selection_json, default_permission_config_json FROM agent_profile WHERE id = 'agent_1'", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        let runtime = resolve_frozen_runtime_binding(
            database.connection(),
            &ResolvedRuntimeBinding {
                adapter_kind: initial.adapter_kind,
                installation_id,
                model: serde_json::from_str(&model).unwrap(),
                permissions: serde_json::from_str(&permissions).unwrap(),
            },
        )
        .unwrap()
        .unwrap();
        // No prior Fast row, health snapshot, or executable identity is required.
        database
            .connection()
            .execute_batch(
                "DELETE FROM adapter_capability_snapshot; DELETE FROM runtime_executable_identity;",
            )
            .unwrap();
        let set = |camp: &str, revision: &str, value| {
            envelope(
                Some(camp),
                SetThreadMemberFastCommand {
                    camp_id: camp.into(),
                    agent_id: "agent_1".into(),
                    expected_runtime_binding_revision: revision.into(),
                    fast_override: value,
                },
            )
        };
        for (camp, choice) in camps.iter().zip([true, false]) {
            let before = view(&database, camp, "agent_1").unwrap().unwrap();
            assert_eq!(before.fast_override, None);
            assert_eq!(before.runtime_default_fast, None);
            let command = set(camp, &initial.runtime_binding_revision, Some(choice));
            let result = set_preference(&mut database, &command).unwrap().result;
            assert_eq!(result.status, CommandResultStatus::Applied);
            assert_eq!(result.payload["fast"]["fastOverride"], choice);
            assert_eq!(
                view(&database, camp, "agent_1")
                    .unwrap()
                    .unwrap()
                    .fast_override,
                Some(choice)
            );
            // Replaying the old receipt after a newer choice cannot overwrite the new preference.
            set_preference(
                &mut database,
                &set(camp, &initial.runtime_binding_revision, None),
            )
            .unwrap();
            assert_eq!(
                set_preference(&mut database, &command)
                    .unwrap()
                    .result
                    .status,
                CommandResultStatus::Applied
            );
            assert_eq!(
                view(&database, camp, "agent_1")
                    .unwrap()
                    .unwrap()
                    .fast_override,
                None
            );
            set_preference(
                &mut database,
                &set(camp, &initial.runtime_binding_revision, Some(choice)),
            )
            .unwrap();
        }
        let assert_choices = |database: &Database| {
            for (camp, choice) in camps.iter().zip([true, false]) {
                assert_eq!(
                    view(database, camp, "agent_1")
                        .unwrap()
                        .unwrap()
                        .fast_override,
                    Some(choice)
                );
            }
        };
        assert_choices(&database);
        let reopened = Connection::open(database.path()).unwrap();
        for (camp, choice) in camps.iter().zip([true, false]) {
            assert_eq!(
                view_on_connection(&reopened, camp, "agent_1")
                    .unwrap()
                    .unwrap()
                    .fast_override,
                Some(choice),
                "saved intent survives a new connection without qualification evidence"
            );
        }
        assert_eq!(
            view(&database, camp_id, "agent_2")
                .unwrap()
                .unwrap()
                .fast_override,
            None
        );
        let mut first_default = set(
            camp_id,
            &target(&database, camp_id, "agent_2")
                .unwrap()
                .unwrap()
                .runtime_binding_revision,
            None,
        );
        first_default.payload.agent_id = "agent_2".into();
        assert_eq!(
            set_preference(&mut database, &first_default)
                .unwrap()
                .result
                .status,
            CommandResultStatus::Applied
        );
        assert_eq!(
            database.connection().query_row(
                "SELECT count(*) FROM camp_member_fast_preference WHERE camp_id = ?1 AND agent_id = 'agent_2' AND fast_override IS NULL",
                [camp_id], |row| row.get::<_, i64>(0),
            ).unwrap(),
            1,
            "the first save also persists the explicit follow-default choice"
        );
        database.connection().execute(
            "INSERT INTO conversation(id, camp_id, agent_id, summary_through_message_sequence, last_message_sequence, version, created_at, updated_at)
             VALUES ('fast-conversation', ?1, 'agent_1', 0, 0, 1, datetime('now'), datetime('now'))", [camp_id]).unwrap();
        let mut frozen = runtime.clone();
        freeze(
            database.connection(),
            "fast-conversation",
            "agent_1",
            &mut frozen,
        )
        .unwrap();
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
            assert_eq!(next.camp_fast.unwrap().fast_override, choice);
            assert_eq!(
                next.model
                    .options
                    .get("serviceTier")
                    .and_then(Value::as_str),
                choice.map(|fast| if fast { "priority" } else { "default" })
            );
            assert_eq!(frozen.camp_fast.as_ref().unwrap().fast_override, Some(true));
        }
        database.connection().execute_batch("UPDATE camp_member_fast_preference SET eligible = 0, runtime_default_fast = 1,
            executable_fingerprint = 'stale', observed_fast_state = 'cooldown', unavailable_reason = 'legacy warning';").unwrap();
        let projected =
            serde_json::to_value(view(&database, camp_id, "agent_1").unwrap().unwrap()).unwrap();
        assert!(projected.get("observedFastState").is_none());
        assert!(projected.get("unavailableReason").is_none());
        assert_eq!(projected["fastOverride"], true);
        assert!(
            projected["runtimeDefaultFast"].is_null(),
            "stale qualification defaults are not native evidence"
        );
        assert!(
            !record_runtime_default(
                database.connection(),
                camp_id,
                "agent_1",
                &initial.runtime_binding_revision,
                Some(false),
            )
            .unwrap(),
            "a late initialization cannot replace a saved choice"
        );
        set_preference(
            &mut database,
            &set(camp_id, &initial.runtime_binding_revision, None),
        )
        .unwrap();
        for baseline in [Some(true), Some(false), None] {
            assert!(
                record_runtime_default(
                    database.connection(),
                    camp_id,
                    "agent_1",
                    &initial.runtime_binding_revision,
                    baseline,
                )
                .unwrap()
            );
            let current = view(&database, camp_id, "agent_1").unwrap().unwrap();
            assert_eq!(
                current.fast_override, None,
                "initialization never writes user intent"
            );
            assert_eq!(current.runtime_default_fast, baseline);
            assert!(
                !record_runtime_default(
                    database.connection(),
                    camp_id,
                    "agent_1",
                    &initial.runtime_binding_revision,
                    baseline,
                )
                .unwrap(),
                "duplicate initialization does not invalidate the projection"
            );
            let reopened = Connection::open(database.path()).unwrap();
            assert_eq!(
                view_on_connection(&reopened, camp_id, "agent_1")
                    .unwrap()
                    .unwrap()
                    .runtime_default_fast,
                baseline
            );
        }
        assert!(
            !record_runtime_default(
                database.connection(),
                camp_id,
                "agent_1",
                "old-binding",
                Some(true),
            )
            .unwrap()
        );
        assert_eq!(
            view(&database, &camps[1], "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            Some(false)
        );
        set_preference(
            &mut database,
            &set(camp_id, &initial.runtime_binding_revision, Some(false)),
        )
        .unwrap();
        assert!(
            !record_runtime_default(
                database.connection(),
                camp_id,
                "agent_1",
                &initial.runtime_binding_revision,
                Some(true),
            )
            .unwrap(),
            "explicit Off is never replaced by native On"
        );
        set_preference(
            &mut database,
            &set(camp_id, &initial.runtime_binding_revision, Some(true)),
        )
        .unwrap();
        database.connection().execute("UPDATE agent_profile SET display_name = 'Renamed', version = version + 1 WHERE id = 'agent_1'", []).unwrap();
        crate::agent_profile::configure_test_runtime(&database, &["agent_1"]);
        assert_eq!(
            target(&database, camp_id, "agent_1").unwrap().unwrap(),
            initial
        );
        database.connection().execute("UPDATE agent_profile SET default_permission_config_json = json_set(default_permission_config_json, '$.values.approval_policy', 'never') WHERE id = 'agent_1'", []).unwrap();
        assert_choices(&database);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_permission_config_json = ?1 WHERE id = 'agent_1'",
                [&permissions],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                [r#"{"mode":"explicit","modelId":"gpt-test","options":{}}"#],
            )
            .unwrap();
        assert_eq!(
            target(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .runtime_binding_revision,
            initial.runtime_binding_revision
        );
        assert_choices(&database);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET default_model_selection_json = ?1 WHERE id = 'agent_1'",
                [&model],
            )
            .unwrap();
        assert_choices(&database);
        let mut wrong_scope = set(camp_id, &initial.runtime_binding_revision, Some(false));
        wrong_scope.camp_id = Some(camps[1].clone());
        assert_eq!(
            set_preference(&mut database, &wrong_scope)
                .unwrap()
                .result
                .code,
            "camp_scope_mismatch"
        );
        // Switch installations and back: old intent must never revive across binding generations.
        database.connection().execute("INSERT INTO adapter_installation(id, adapter_kind, executable_path, command_name, installation_class,
            source, auth_scope, enabled, version, created_at, updated_at)
            SELECT 'other-fast-installation', adapter_kind, executable_path, command_name, installation_class,
                source, 'other-fast-scope', enabled, version, created_at, updated_at FROM adapter_installation WHERE id = ?1", [&runtime.installation_id]).unwrap();
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
        for camp in &camps {
            assert_eq!(
                view(&database, camp, "agent_1")
                    .unwrap()
                    .unwrap()
                    .fast_override,
                None
            );
        }
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
        assert_eq!(
            view(&database, camp_id, "agent_1")
                .unwrap()
                .unwrap()
                .fast_override,
            None
        );
        let current = target(&database, camp_id, "agent_1").unwrap().unwrap();
        database.connection().execute("UPDATE camp_member SET status = 'left' WHERE camp_id = ?1 AND agent_id = 'agent_1'", [camp_id]).unwrap();
        assert!(view(&database, camp_id, "agent_1").unwrap().is_none());
        assert_eq!(
            set_preference(
                &mut database,
                &set(camp_id, &current.runtime_binding_revision, Some(false))
            )
            .unwrap()
            .result
            .code,
            "camp_member_fast_unavailable"
        );
    }
}
