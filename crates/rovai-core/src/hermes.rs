//! Official Hermes ACP, native Home and native logical Session identity.
use anyhow::{Context, Result};
use serde_json::Value;
use tokio::process::Command;

pub fn supported_version(version: Option<&str>) -> bool {
    version
        .and_then(crate::agent_runtime_adapter::parse_reported_runtime_version)
        .is_some_and(|(version, _)| version >= [0, 22, 4])
}

/// Only this native Session option is supported. Missing catalog metadata is
/// not a reason to discard a saved choice; older ACP entries silently ACK it.
pub fn reasoning_effort<'a>(options: &'a Value, version: Option<&str>) -> Result<Option<&'a str>> {
    let options = options
        .as_object()
        .context("Hermes model options must be an object")?;
    anyhow::ensure!(
        options.keys().all(|key| key == "reasoning_effort"),
        "Hermes ACP only supports the reasoning_effort model option"
    );
    let Some(value) = options.get("reasoning_effort") else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .context("Hermes reasoning_effort must be a string")?;
    anyhow::ensure!(
        !value.is_empty() && value != "runtime_default",
        "Hermes reasoning_effort requires a native value; use default to restore the Hermes configuration"
    );
    anyhow::ensure!(
        !version
            .and_then(crate::agent_runtime_adapter::parse_reported_runtime_version)
            .is_some_and(|(version, _)| version < [0, 22, 6]),
        "Hermes reasoning_effort requires ACP 0.22.6 or newer; the installed ACP entry does not apply this setting"
    );
    Ok(Some(value))
}

/// Compare the native choice without changing the ID sent to session/set_model.
/// A generic custom:<model> report may omit the configured custom provider name.
pub fn model_selection_matches(selected: &str, current: Option<&str>) -> bool {
    let Some(current) = current else {
        return false;
    };
    if selected == current {
        return true;
    }
    fn parts(id: &str) -> (Option<&str>, &str) {
        let Some((provider, model)) = id.split_once(':') else {
            return (None, id);
        };
        if provider == "custom"
            && let Some((name, model)) = model.split_once(':')
        {
            return (Some(&id[.."custom:".len() + name.len()]), model);
        }
        (Some(provider), model)
    }
    let (selected_provider, selected_model) = parts(selected);
    let (current_provider, current_model) = parts(current);
    selected_model == current_model
        && (selected_provider.is_none()
            || selected_provider == current_provider
            || selected_provider == Some("custom") && current.starts_with("custom:")
            || current_provider == Some("custom") && selected.starts_with("custom:"))
}

/// Only launch selection: never copy config, write native instructions, or own
/// the user's Gateway. The native launcher keeps its own bootstrap semantics.
pub fn configure_command(command: &mut Command) -> Result<()> {
    let home = dirs::home_dir().context("Hermes requires the current user's Home")?;
    // Honor explicit changes (including removal), then the effective inherited environment.
    // Hermes resolves and validates the native profile from the explicit CLI argument.
    let profile = command
        .as_std()
        .get_envs()
        .find(|(key, _)| {
            if cfg!(windows) {
                key.to_string_lossy().eq_ignore_ascii_case("HERMES_PROFILE")
            } else {
                *key == "HERMES_PROFILE"
            }
        })
        .map(|(_, value)| value.map(ToOwned::to_owned))
        .unwrap_or_else(|| {
            crate::runtime_discovery::runtime_environment_variable(
                crate::agent_profile::AdapterKind::HermesCli,
                "HERMES_PROFILE",
            )
        })
        .map(|value| {
            value
                .to_str()
                .context("Hermes profile must be valid UTF-8")
                .map(|value| value.trim().to_owned())
        })
        .transpose()?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".into());
    command
        .args(["--profile", profile.as_str(), "acp"])
        .env("HOME", &home)
        .env("HERMES_HOME", home.join(".hermes"))
        .env_remove("HERMES_PROFILE")
        .env_remove("HERMES_DATA_DIR_SUFFIX");
    for key in ["ROVAI_CLI_CONTEXT", "ROVAI_AGENT_CLI", "ROVAI_RUN_TMP"] {
        command.env_remove(key);
    }
    Ok(())
}

/// LOCAL source chat_id is the logical ACP Session. HERMES_SESSION_ID names
/// the physical transcript and is deliberately not a fallback after compaction.
pub fn native_session_id(platform: Option<&str>, chat_id: Option<&str>) -> Option<String> {
    if platform != Some("local") {
        return None;
    }
    chat_id
        .filter(|id| !id.trim().is_empty() && id.len() <= 512 && !id.contains('\0'))
        .map(str::to_owned)
}

/// A cancellation can precede submit; a transport error can follow admission.
/// Neither proves that an otherwise unobserved input was accepted or rejected.
/// The shared ACP client matches the response and keeps its terminal outcome.
pub fn input_acceptance_uncertain(message: &Value) -> bool {
    message
        .pointer("/result/stopReason")
        .and_then(Value::as_str)
        == Some("cancelled")
        || message.get("error").is_some()
            && !matches!(message["error"]["code"].as_i64(), Some(-32600 | -32602))
            && message
                .pointer("/error/data/details")
                .and_then(Value::as_str)
                != Some("admitted_turn_failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_selection_matches_native_provider_forms_without_suffix_matching() {
        for (selected, current, matches) in [
            ("custom:sub2api:A", "custom:A", true),
            ("custom:sub2api:A", "custom:sub2api:A", true),
            ("A", "custom:A", true),
            ("custom:sub2api:A", "custom:other:A", false),
            ("custom:sub2api:B", "custom:A", false),
            ("A", "custom:sub2api:A", true),
            ("A", "openai:A", true),
            ("openai:A", "openai:A", true),
            ("openai:A", "anthropic:A", false),
            ("openai:A", "custom:A", false),
            ("custom:A", "custom:sub2api:A", true),
            ("custom:sub2api:A", "A", false),
            ("custom:sub2api:org/A", "custom:org/A", true),
            ("org/A", "custom:sub2api:org/A", true),
            ("A", "custom:org/A", false),
            ("custom:sub2api:A", "custom:other:prefix:A", false),
            ("custom:sub2api:A:v1", "custom:sub2api:A:v2", false),
            ("custom:sub2api:A", "custom:sub2api:a", false),
        ] {
            assert_eq!(
                model_selection_matches(selected, Some(current)),
                matches,
                "{selected} / {current}"
            );
        }
        assert!(!model_selection_matches("A", None));
        for version in [Some("0.22.4"), Some("0.22.5")] {
            assert_eq!(reasoning_effort(&json!({}), version).unwrap(), None);
            assert!(reasoning_effort(&json!({"reasoning_effort":"high"}), version).is_err());
        }
        for version in [None, Some("0.22.6"), Some("0.23.0")] {
            for effort in ["high", "low", "none", "default", "future-native-value"] {
                assert_eq!(
                    reasoning_effort(&json!({"reasoning_effort":effort}), version).unwrap(),
                    Some(effort)
                );
            }
        }
        for options in [
            json!({"reasoning_effort":7}),
            json!({"reasoning_effort":"runtime_default"}),
            json!({"reasoning_effort":""}),
            json!({"other":"value"}),
        ] {
            assert!(reasoning_effort(&options, Some("0.23.0")).is_err());
        }
    }

    #[tokio::test]
    async fn native_entry_preserves_the_launcher_and_uses_logical_session_identity() {
        for (profile, expected) in [
            (None, "default"),
            (Some(""), "default"),
            (Some("  "), "default"),
            (Some("default"), "default"),
            (Some("writer"), "writer"),
            (Some("reviewer"), "reviewer"),
            (Some(" writer "), "writer"),
        ] {
            let mut values = std::collections::BTreeMap::from([(
                "HERMES_EPHEMERAL_SYSTEM_PROMPT".into(),
                "native instruction".into(),
            )]);
            if let Some(profile) = profile {
                values.insert("HERMES_PROFILE".into(), profile.into());
            }
            let mut command = Command::new("/native/hermes");
            command.env_remove("HERMES_PROFILE");
            crate::member_environment::LaunchEnvironment {
                values: Some(values),
                overlay: None,
            }
            .apply(&mut command)
            .unwrap();
            configure_command(&mut command).unwrap();
            assert_eq!(command.as_std().get_program(), "/native/hermes");
            assert_eq!(
                command.as_std().get_args().collect::<Vec<_>>(),
                ["--profile", expected, "acp"],
                "configured profile: {profile:?}"
            );
            assert!(command.as_std().get_envs().any(|(k, v)| {
                k == "HERMES_EPHEMERAL_SYSTEM_PROMPT"
                    && v == Some(std::ffi::OsStr::new("native instruction"))
            }));
            assert!(
                command
                    .as_std()
                    .get_envs()
                    .any(|(k, v)| k == "HERMES_PROFILE" && v.is_none())
            );
        }
        let inherited = crate::member_environment::LaunchEnvironment {
            values: Some(std::collections::BTreeMap::from([(
                "HERMES_PROFILE".into(),
                "writer".into(),
            )])),
            overlay: None,
        };
        crate::runtime_discovery::with_launch_environment(Some(inherited), async {
            // Probe commands can inherit a selector without setting it explicitly.
            // Explicit removals and blank values must still suppress that selector.
            for (explicit, expected) in [
                (None, "writer"),
                (Some(None), "default"),
                (Some(Some("")), "default"),
                (Some(Some("  ")), "default"),
                (Some(Some("reviewer")), "reviewer"),
                (Some(Some(" reviewer ")), "reviewer"),
            ] {
                let mut command = Command::new("/native/hermes");
                match explicit {
                    Some(Some(value)) => {
                        command.env("HERMES_PROFILE", value);
                    }
                    Some(None) => {
                        command.env_remove("HERMES_PROFILE");
                    }
                    None => {}
                }
                configure_command(&mut command).unwrap();
                assert_eq!(
                    command.as_std().get_args().collect::<Vec<_>>(),
                    ["--profile", expected, "acp"],
                    "inherited writer, explicit selector: {explicit:?}"
                );
            }
        })
        .await;
        assert_eq!(
            native_session_id(Some("local"), Some("local-session")),
            Some("local-session".into())
        );
        for (platform, id) in [
            (None, Some("session")),
            (Some("telegram"), Some("session")),
            (Some("local"), Some("")),
            (Some("local"), None),
        ] {
            assert_eq!(native_session_id(platform, id), None);
        }
        assert!(!supported_version(Some("0.22.2")));
        for version in [
            "0.22.4",
            "Hermes Agent v0.22.5 (new source)",
            "0.23.0",
            "1.0.0",
        ] {
            assert!(supported_version(Some(version)));
        }
        assert!(!supported_version(None));
        assert!(!input_acceptance_uncertain(
            &json!({"result":{"stopReason":"end_turn"}})
        ));
        assert!(input_acceptance_uncertain(
            &json!({"result":{"stopReason":"cancelled"}})
        ));
        assert!(!input_acceptance_uncertain(
            &json!({"error":{"code":-32602}})
        ));
        assert!(!input_acceptance_uncertain(
            &json!({"error":{"code":-32603,"data":{"details":"admitted_turn_failed"}}})
        ));
        assert!(input_acceptance_uncertain(
            &json!({"error":{"code":-32603,"data":{"details":"connection_lost"}}})
        ));
    }
}
