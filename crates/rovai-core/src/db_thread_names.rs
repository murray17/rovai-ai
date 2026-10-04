//! Admit the renamed context formats without rewriting any Run, binding or evidence bytes.
use super::*;

fn schema(tx: &Transaction<'_>, kind: &str, name: &str) -> Result<String> {
    Ok(tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |row| row.get(0),
    )?)
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.contract_version == "v1.72" && marker.projection_schema_version == 129),
            "Thread naming migration requires v1.72/schema 129"
        );
        let evidence_digest = public_history_claim_preserved_evidence_digest(&tx)?;
        let already_named: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='context_manifest_v32_only_insert')",
            [], |row| row.get(0))?;
        // A main schema-128 source already has the v32 constraints. The ratio
        // migration installed its missing metrics projection; never rebuild or
        // downgrade its frozen context bytes during convergence.
        if !already_named {
            let manifest = schema(&tx, "table", "context_manifest")?;
            let fact31 = "(context_manifest_version = 31 AND formatter_version = 31 AND run_facts_schema_version = 8 AND ((camp_attachment_view_receipt_version IS NULL AND camp_attachment_view_receipt_json IS NULL AND camp_attachment_view_receipt_digest IS NULL) OR (camp_attachment_view_receipt_version = 2 AND camp_attachment_view_receipt_json IS NOT NULL AND camp_attachment_view_receipt_digest IS NOT NULL)))";
            anyhow::ensure!(
                manifest.contains(fact31),
                "Thread migration cannot identify prior context constraints"
            );
            let fact32 = fact31
                .replace("= 31", "= 32")
                .replace("schema_version = 8", "schema_version = 9");
            let manifest = replacement_table_schema_v171(manifest, "context_manifest")
                .replace("29, 30, 31)", "29, 30, 31, 32)")
                .replace(
                    "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8)",
                    "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9)",
                )
                .replace(fact31, &format!("{fact32}\n OR\n {fact31}"));
            let input = replacement_table_schema_v171(
                schema(&tx, "table", "agent_run_input")?,
                "agent_run_input",
            )
            .replace(
                "context_manifest_version IN (26, 27, 28, 29, 30, 31)",
                "context_manifest_version IN (26, 27, 28, 29, 30, 31, 32)",
            );
            let old_guard = schema(&tx, "trigger", "context_manifest_v31_only_insert")?;
            let first = old_guard
                .find("(NEW.context_manifest_version = 31")
                .context("missing v31 admission branch")?;
            let next = old_guard[first..]
                .find("\n                OR\n")
                .context("missing v31 admission separator")?
                + first;
            let current_branch = old_guard[first..next]
                .replace("= 31", "= 32")
                .replace("IS NOT 31", "IS NOT 32")
                .replace("schema_version = 8", "schema_version = 9");
            let ordinary = "(NEW.context_manifest_version = 28 AND NEW.formatter_version = 28 AND NEW.run_facts_schema_version = 6 AND NEW.context_delivery_profile_version = 7 AND EXISTS(SELECT 1 FROM agent_run AS run WHERE run.id=NEW.agent_run_id AND run.invocation_kind <> 'batch'))";
            let guard = old_guard
                .replacen(
                    "context_manifest_v31_only_insert",
                    "context_manifest_v32_only_insert",
                    1,
                )
                .replacen(
                    "WHEN NOT (",
                    &format!("WHEN NOT ({current_branch}\n OR\n {ordinary}\n OR\n"),
                    1,
                );
            let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")?
                .replacen("WHEN NOT (", "WHEN NOT ((NEW.context_manifest_version = 32 AND NEW.context_delivery_profile_version = 10) OR (NEW.context_manifest_version = 28 AND NEW.context_delivery_profile_version = 7) OR ", 1);
            let attachment = schema(
                &tx,
                "trigger",
                "runtime_input_delivery_attachment_auth_insert",
            )?
            .replace(
                "context_manifest_version IN (26, 27, 29, 30, 31)",
                "context_manifest_version IN (26, 27, 28, 29, 30, 31, 32)",
            );
            rebuild_table_v171(
                &tx,
                "context_manifest",
                &manifest,
                &[],
                &[
                    "context_manifest_v31_only_insert",
                    "context_manifest_quote_profile_insert",
                ],
            )?;
            rebuild_table_v171(
                &tx,
                "agent_run_input",
                &input,
                &[],
                &["agent_run_input_v31_only_insert"],
            )?;
            tx.execute_batch(&guard)?;
            tx.execute_batch(&profile)?;
            tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
            tx.execute_batch(&attachment)?;
            tx.execute_batch("CREATE TRIGGER agent_run_input_v32_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 32 BEGIN SELECT RAISE(ABORT, 'new public Thread AgentRunInput must use ContextManifest v32'); END;")?;
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES (180, datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=130, updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            public_history_claim_preserved_evidence_digest(&tx)? == evidence_digest,
            "Thread migration changed frozen context evidence"
        );
        validate_migration_foreign_keys(&tx, &["context_manifest", "agent_run_input"])?;
        anyhow::ensure!(
            public_history_claim_v174_schema_matches(&tx)?,
            "Thread context schema verification failed"
        );
        let state = load_current_migration_state(&tx)?;
        anyhow::ensure!(
            state.admits("v1.72", 130, V147_CLASSIFIER_VERSION),
            "Thread migration chain verification failed"
        );
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 130
            ),
            "Thread migration failed current schema admission"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Reverse only synthetic test fixtures; no product path downgrades stored evidence.
#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    user_projection::downgrade_for_test(connection);
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=180)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    let fact32 = "(context_manifest_version = 32 AND formatter_version = 32 AND run_facts_schema_version = 9 AND ((camp_attachment_view_receipt_version IS NULL AND camp_attachment_view_receipt_json IS NULL AND camp_attachment_view_receipt_digest IS NULL) OR (camp_attachment_view_receipt_version = 2 AND camp_attachment_view_receipt_json IS NOT NULL AND camp_attachment_view_receipt_digest IS NOT NULL)))";
    let manifest = replacement_table_schema_v171(
        schema(&tx, "table", "context_manifest").unwrap(),
        "context_manifest",
    )
    .replace("29, 30, 31, 32)", "29, 30, 31)")
    .replace(
        "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9)",
        "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8)",
    )
    .replace(&format!("{fact32}\n OR\n "), "");
    let input = replacement_table_schema_v171(
        schema(&tx, "table", "agent_run_input").unwrap(),
        "agent_run_input",
    )
    .replace(
        "context_manifest_version IN (26, 27, 28, 29, 30, 31, 32)",
        "context_manifest_version IN (26, 27, 28, 29, 30, 31)",
    );
    let version_guard = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let input_guard = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;").unwrap();
    tx.execute_batch("UPDATE context_manifest SET context_manifest_version=31, formatter_version=31, run_facts_schema_version=8 WHERE context_manifest_version=32; UPDATE agent_run_input SET context_manifest_version=31 WHERE context_manifest_version=32;").unwrap();
    tx.execute_batch(&version_guard).unwrap();
    tx.execute_batch(&input_guard).unwrap();
    let guard = schema(&tx, "trigger", "context_manifest_v32_only_insert").unwrap();
    let start = guard.find("(NEW.context_manifest_version = 31").unwrap();
    let guard = format!(
        "CREATE TRIGGER context_manifest_v31_only_insert BEFORE INSERT ON context_manifest WHEN NOT ({}",
        &guard[start..]
    );
    let profile = schema(&tx,"trigger","context_manifest_quote_profile_insert").unwrap()
        .replace("(NEW.context_manifest_version = 32 AND NEW.context_delivery_profile_version = 10) OR (NEW.context_manifest_version = 28 AND NEW.context_delivery_profile_version = 7) OR ", "");
    let attachment = schema(
        &tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )
    .unwrap()
    .replace(
        "context_manifest_version IN (26, 27, 28, 29, 30, 31, 32)",
        "context_manifest_version IN (26, 27, 29, 30, 31)",
    );
    rebuild_table_v171(
        &tx,
        "context_manifest",
        &manifest,
        &[],
        &[
            "context_manifest_v32_only_insert",
            "context_manifest_quote_profile_insert",
        ],
    )
    .unwrap();
    rebuild_table_v171(
        &tx,
        "agent_run_input",
        &input,
        &[],
        &["agent_run_input_v32_only_insert"],
    )
    .unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch(&profile).unwrap();
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")
        .unwrap();
    tx.execute_batch(&attachment).unwrap();
    tx.execute_batch("CREATE TRIGGER agent_run_input_v31_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 31 BEGIN SELECT RAISE(ABORT,'new public AgentRunInput must use ContextManifest v31'); END; DELETE FROM schema_migration WHERE version=180; UPDATE rovai_data_contract SET projection_schema_version=129 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    #[test]
    fn thread_upgrade_preserves_existing_tables_and_rolls_back_on_receipt_failure() {
        let directory =
            std::env::temp_dir().join(format!("rovai-thread-migration-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
        downgrade_for_test(database.connection());
        let before = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
        database.connection().execute_batch("CREATE TEMP TRIGGER reject_thread_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=180 BEGIN SELECT RAISE(ABORT,'thread receipt failure'); END;").unwrap();
        assert!(
            migrate(&mut database)
                .unwrap_err()
                .to_string()
                .contains("thread receipt failure")
        );
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
        );
        assert!(
            matches!(classify_database_contract(database.connection()).unwrap(),DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version==129)
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_thread_receipt;")
            .unwrap();
        migrate(&mut database).unwrap();
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
        );
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 130
        ));
        // Reproduce main's deployed schema 128 independently of the metrics
        // preview: v32 constraints and receipt 178, but no context projection.
        database
            .connection()
            .execute_batch(
                "DROP TABLE runtime_session_context_latest;
            DELETE FROM schema_migration WHERE version IN (179,180);
            UPDATE rovai_data_contract SET projection_schema_version=128 WHERE singleton=1;
            CREATE TEMP TRIGGER reject_main_metrics_receipt BEFORE INSERT ON schema_migration
            WHEN NEW.version=179 BEGIN SELECT RAISE(ABORT,'main metrics receipt failure'); END;",
            )
            .unwrap();
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.projection_schema_version == 128
        ));
        assert!(
            database
                .migrate_runtime_session_context_ratio_v179()
                .unwrap_err()
                .to_string()
                .contains("main metrics receipt failure")
        );
        assert!(!runtime_session_context_schema_matches(database.connection()).unwrap());
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_main_metrics_receipt;")
            .unwrap();
        drop(database);
        let reopened = Database::open(&directory).unwrap();
        assert!(matches!(
            classify_database_contract(reopened.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        assert!(runtime_session_context_ratio_schema_matches(reopened.connection()).unwrap());
        assert_eq!(
            before,
            public_history_claim_preserved_evidence_digest(reopened.connection()).unwrap()
        );
        assert_eq!(
            reopened
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM schema_migration WHERE version IN (178,179,180)",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            3
        );
        drop(reopened);
        std::fs::remove_dir_all(&directory).unwrap();

        // The same convergence owner covers main's later User/member lineages.
        // Each has distinct receipt collisions, and must preserve old receipts,
        // application rows and frozen evidence through rollback and reopen.
        for source_schema in [129, 130] {
            let mut database = crate::test_support::fresh_schema_database_at(&directory);
            if source_schema == 129 {
                member_creation::downgrade_for_test(database.connection());
            }
            database.connection().execute_batch("INSERT INTO camp(id,title,project_binding_kind,project_path,created_at,updated_at)
                VALUES ('main-camp','preserve main data','quick_chat','','2026-01-01','2026-01-01');").unwrap();
            if source_schema == 130 {
                database.connection().execute_batch("INSERT INTO member_creation VALUES('creation','main-camp','{}','2026-01-01');
                    INSERT INTO member_creation_preference VALUES(1,'agent_1');").unwrap();
            }
            database.connection().execute_batch(&format!("DROP TABLE runtime_session_context_latest;
                DELETE FROM schema_migration WHERE version>{};
                UPDATE rovai_data_contract SET projection_schema_version={source_schema} WHERE singleton=1;
                UPDATE schema_migration SET applied_at='preserved-main-receipt' WHERE version>=178;", source_schema+50)).unwrap();
            let before =
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
            assert!(
                matches!(classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == source_schema)
            );
            // A known marker alone cannot admit a damaged source.
            let tx = database.connection().unchecked_transaction().unwrap();
            tx.execute_batch("DROP TRIGGER context_manifest_v32_only_insert;")
                .unwrap();
            assert!(matches!(
                classify_database_contract(&tx).unwrap(),
                DatabaseContractClassification::Unknown(_)
            ));
            tx.rollback().unwrap();
            database
                .connection()
                .execute_batch(
                    "CREATE TEMP TRIGGER reject_main_convergence BEFORE INSERT ON schema_migration
                WHEN NEW.version=181 BEGIN SELECT RAISE(ABORT,'main convergence failure'); END;",
                )
                .unwrap();
            assert!(
                database
                    .reconcile_main_metrics_lineage()
                    .unwrap_err()
                    .to_string()
                    .contains("main convergence failure")
            );
            assert!(!runtime_session_context_schema_matches(database.connection()).unwrap());
            assert!(
                matches!(classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == source_schema)
            );
            database
                .connection()
                .execute_batch("DROP TRIGGER reject_main_convergence;")
                .unwrap();
            drop(database);
            let reopened = Database::open(&directory).unwrap();
            assert!(matches!(
                classify_database_contract(reopened.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            assert!(runtime_session_context_ratio_schema_matches(reopened.connection()).unwrap());
            assert_eq!(
                before,
                public_history_claim_preserved_evidence_digest(reopened.connection()).unwrap()
            );
            assert_eq!(
                reopened
                    .connection()
                    .query_row("SELECT title FROM camp WHERE id='main-camp'", [], |row| row
                        .get::<_, String>(0))
                    .unwrap(),
                "preserve main data"
            );
            assert_eq!(reopened.connection().query_row("SELECT count(*) FROM schema_migration WHERE applied_at='preserved-main-receipt'", [], |row| row.get::<_,i64>(0)).unwrap(), source_schema-127);
            if source_schema == 130 {
                assert_eq!(reopened.connection().query_row("SELECT snapshot_json FROM member_creation WHERE creation_id='creation'", [], |row| row.get::<_,String>(0)).unwrap(), "{}");
                assert_eq!(
                    reopened
                        .connection()
                        .query_row(
                            "SELECT helper_agent_id FROM member_creation_preference",
                            [],
                            |row| row.get::<_, String>(0)
                        )
                        .unwrap(),
                    "agent_1"
                );
            }
            drop(reopened);
            let reopened_again = Database::open(&directory).unwrap();
            assert!(matches!(
                classify_database_contract(reopened_again.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            drop(reopened_again);
            std::fs::remove_dir_all(&directory).unwrap();
        }
    }
}
