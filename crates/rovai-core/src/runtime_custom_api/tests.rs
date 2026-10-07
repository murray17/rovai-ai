use super::*;
#[cfg(feature = "extended-tests")]
use crate::runtime_startup::{self, RuntimeStartupConfiguration};
use std::collections::BTreeMap;

// The retired write matrix is replaced by the surviving read-only boundary:
// preserve native bytes, credential provenance, redaction and connection fencing.
#[test]
fn native_sources_are_read_only_and_keep_secrets_out_of_snapshots() {
    let root = std::env::temp_dir().join(format!("rovai-native-read-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        let context = native::NativeContext {
            kind,
            directory: root.join(kind.as_str()),
            artifact_root: root.join("unused-artifacts"),
            launcher: None,
            codex_source: None,
            environment: BTreeMap::from([("RELAY_KEY".into(), "fixture-env-key".into())]),
        };
        std::fs::create_dir_all(&context.directory).unwrap();
        let cases: Vec<(&str, Option<&str>)> = if kind == AdapterKind::ClaudeCodeCli {
            vec![
                (
                    r#"{"env":{"ANTHROPIC_BASE_URL":"https://native.example/prefix","ANTHROPIC_AUTH_TOKEN":"fixture-file-key","ANTHROPIC_MODEL":"native-model"},"unknown":true}"#,
                    Some("fixture-file-key"),
                ),
                (
                    r#"{"apiKeyHelper":"never-execute-this-helper","unknown":true}"#,
                    None,
                ),
                (
                    r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"},"unknown":true}"#,
                    None,
                ),
            ]
        } else {
            vec![
                (
                    "model_provider='relay'\nmodel='native-model'\n[model_providers.relay]\nbase_url='https://native.example/prefix'\nexperimental_bearer_token='fixture-file-key'\n",
                    Some("fixture-file-key"),
                ),
                (
                    "model_provider='relay'\n[model_providers.relay]\nenv_key='RELAY_KEY'\n",
                    Some("fixture-env-key"),
                ),
                (
                    "model_provider='relay'\n[model_providers.relay.auth]\ncommand='never-execute-this-helper'\n",
                    None,
                ),
                (
                    "model_provider='relay'\n[model_providers.relay.aws]\nregion='fixture-region'\n",
                    None,
                ),
                ("cli_auth_credentials_store='keyring'\n", None),
            ]
        };
        for (contents, key) in cases {
            std::fs::write(context.path(), contents).unwrap();
            let read = native::read(&context, None).unwrap();
            let snapshot = read.snapshot(&context, false);
            assert_eq!(snapshot.key().unwrap().as_deref(), key);
            snapshot.assert_current().unwrap();
            assert_eq!(std::fs::read(context.path()).unwrap(), contents.as_bytes());
            let encoded = serde_json::to_string(&snapshot).unwrap();
            for secret in ["fixture-file-key", "fixture-env-key"] {
                assert!(!encoded.contains(secret));
                assert!(!format!("{snapshot:?}").contains(secret));
            }
            let restored: CustomApiSnapshot = serde_json::from_str(&encoded).unwrap();
            assert_eq!(snapshot.identity().unwrap(), restored.identity().unwrap());
            if let Some(key) = key {
                let mut echo = json!({key:[format!("prefix {key} suffix")]});
                snapshot.redactor().unwrap().value(&mut echo);
                assert!(!echo.to_string().contains(key));
                assert!(echo.to_string().contains("[redacted]"));
                let changed = if contents.contains(key) {
                    contents.replace(key, "rotated-key")
                } else {
                    contents.replace("RELAY_KEY", "MISSING_KEY")
                };
                std::fs::write(context.path(), changed).unwrap();
                assert!(snapshot.assert_current().is_err());
                if contents.contains(key) {
                    assert!(snapshot.key().is_err());
                }
            }
        }
        #[cfg(unix)]
        {
            let target = context.directory.join("native-target");
            let alternate = context.directory.join("native-alternate");
            std::fs::rename(context.path(), &target).unwrap();
            std::fs::copy(&target, &alternate).unwrap();
            std::os::unix::fs::symlink(&target, context.path()).unwrap();
            let snapshot = native::read(&context, None)
                .unwrap()
                .snapshot(&context, false);
            std::fs::remove_file(context.path()).unwrap();
            std::os::unix::fs::symlink(&alternate, context.path()).unwrap();
            assert!(
                snapshot.assert_current().is_err(),
                "retargeting identical bytes still changes the native source"
            );
            assert!(
                std::fs::symlink_metadata(context.path())
                    .unwrap()
                    .is_symlink()
            );
        }
        std::fs::write(context.path(), "broken fixture-secret = {").unwrap();
        let error = native::read(&context, None).err().unwrap();
        assert!(!error.to_string().contains("fixture-secret"));
    }
    assert!(!root.join("unused-artifacts").exists());
    std::fs::remove_dir_all(root).unwrap();
}

// SQLite publication owns field CAS and rollback. Native editing and its write
// failure tests retire with the production writer; local preferences retain CAS.
#[cfg(feature = "extended-tests")]
#[test]
fn startup_saves_preserve_native_files_and_merge_only_local_preferences() {
    use crate::runtime_startup::{FieldEdit, RuntimeEnvironmentVariable};
    let mut db = crate::test_support::seeded_runtime_database_owned();
    for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
        let context = native::NativeContext::resolve(
            kind,
            &RuntimeStartupConfiguration::default(),
            db.path(),
        )
        .unwrap();
        std::fs::create_dir_all(&context.directory).unwrap();
        let contents = if kind == AdapterKind::CodexCli {
            "# preserve all native content\nmodel_provider='relay'\n[model_providers.relay]\nexperimental_bearer_token='fixture-private-key'\n"
        } else {
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"fixture-private-key"},"unknown":42}"#
        };
        std::fs::write(context.path(), contents).unwrap();
        let saved = runtime_startup::load(&db, kind).unwrap();
        let public = serde_json::to_value(runtime_startup::public(saved.clone())).unwrap();
        assert!(public.get("credential").is_none());
        assert!(public.get("connectionObservation").is_none());
        assert!(public["configuration"].get("customApi").is_none());
        assert!(!public.to_string().contains("fixture-private-key"));
        let snapshot = saved.configuration.custom_api_snapshot.unwrap();
        let edit = |name: &str, before: Value, after: &str| FieldEdit {
            path: vec!["environment".into(), name.into()],
            before,
            after: json!(after),
            label: name.into(),
        };
        let prepared =
            runtime_startup::prepare_save(&db, kind, vec![edit("FIRST", Value::Null, "one")])
                .unwrap();
        let first = runtime_startup::commit_save(&mut db, kind, prepared, 1).unwrap();
        assert!(first.reconnect_required);
        let prepared =
            runtime_startup::prepare_save(&db, kind, vec![edit("SECOND", Value::Null, "two")])
                .unwrap();
        let second = runtime_startup::commit_save(&mut db, kind, prepared, 2).unwrap();
        assert_eq!(second.configuration.environment.len(), 2);
        let conflict =
            runtime_startup::prepare_save(&db, kind, vec![edit("FIRST", Value::Null, "different")])
                .unwrap();
        assert_eq!(conflict.conflicts.len(), 1);
        assert_eq!(conflict.conflicts[0].current, "one");
        let prepared =
            runtime_startup::prepare_save(&db, kind, vec![edit("FIRST", json!("one"), "new")])
                .unwrap();
        db.connection().execute_batch("CREATE TEMP TRIGGER fail_startup BEFORE UPDATE ON runtime_startup_setting BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;").unwrap();
        assert!(runtime_startup::commit_save(&mut db, kind, prepared, 3).is_err());
        db.connection()
            .execute_batch("DROP TRIGGER fail_startup;")
            .unwrap();
        assert_eq!(
            runtime_startup::load(&db, kind).unwrap().revision,
            second.revision
        );
        assert_eq!(std::fs::read(context.path()).unwrap(), contents.as_bytes());
        snapshot.assert_current().unwrap();
        let stored: String = db
            .connection()
            .query_row(
                "SELECT configuration_json FROM runtime_startup_setting WHERE runtime_kind=?1",
                [kind.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!stored.contains("fixture-private-key"));
        assert!(!stored.contains("customApi"));
        // Legacy secret rows continue to work at launch, but stay absent from editor responses.
        let mut configuration = second.configuration;
        configuration.environment.push(RuntimeEnvironmentVariable {
            name: if kind == AdapterKind::CodexCli {
                "OPENAI_API_KEY"
            } else {
                "ANTHROPIC_API_KEY"
            }
            .into(),
            value: "legacy-secret".into(),
        });
        let saved =
            runtime_startup::save(&mut db, kind, second.revision, configuration, 3).unwrap();
        assert!(
            !serde_json::to_string(&runtime_startup::public(saved))
                .unwrap()
                .contains("legacy-secret")
        );
    }
}
