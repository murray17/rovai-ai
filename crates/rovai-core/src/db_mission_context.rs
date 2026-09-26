//! Reconcile the published attachment-path schema and the deployed Mission preview.
//! Both used migration 156/schema 106. Their frozen evidence stays readable; DSH first
//! advances to schema 107, then all new contexts use v25/Profile 6/RunFacts 4 after the
//! single atomic v158 transition.
use super::*;

const CURRENT_FACT_BRANCH: &str = "(context_manifest_version = 25 AND formatter_version = 25 AND run_facts_schema_version = 4 AND ((camp_attachment_view_receipt_version IS NULL AND camp_attachment_view_receipt_json IS NULL AND camp_attachment_view_receipt_digest IS NULL) OR (camp_attachment_view_receipt_version = 2 AND camp_attachment_view_receipt_json IS NOT NULL AND camp_attachment_view_receipt_digest IS NOT NULL)))";
const PATH_FACT_BRANCH: &str = "(context_manifest_version = 24 AND formatter_version = 24 AND run_facts_schema_version = 3 AND ((camp_attachment_view_receipt_version IS NULL AND camp_attachment_view_receipt_json IS NULL AND camp_attachment_view_receipt_digest IS NULL) OR (camp_attachment_view_receipt_version = 2 AND camp_attachment_view_receipt_json IS NOT NULL AND camp_attachment_view_receipt_digest IS NOT NULL)))";
const GUARDS: &str = r#"
    CREATE TRIGGER context_manifest_v25_only_insert BEFORE INSERT ON context_manifest
    WHEN NEW.context_manifest_version <> 25 AND NOT (
        NEW.context_manifest_version IN (22,23,24) AND NEW.formatter_version=NEW.context_manifest_version
        AND EXISTS(SELECT 1 FROM agent_run r JOIN message_delivery d ON d.id=r.trigger_message_delivery_id
            WHERE r.id=NEW.agent_run_id
            AND json_extract(d.frozen_snapshot_json,'$.frozenContext.manifestSelection.contextManifestVersion')=NEW.context_manifest_version
            AND json_extract(d.frozen_snapshot_json,'$.frozenContext.manifestSelection.contextDeliveryProfileVersion')=NEW.context_delivery_profile_version
            AND (json_extract(d.frozen_snapshot_json,'$.frozenContext.renderedPayloadDigest')=NEW.rendered_payload_digest
                OR (NEW.context_manifest_version=24 AND NEW.context_delivery_profile_version=6
                    AND NEW.workspace_fact_json IS NOT NULL
                    AND json_extract(d.frozen_snapshot_json,'$.frozenContext.manifestSelection.runFactDigest')=NEW.run_fact_digest
                    AND json_extract(d.frozen_snapshot_json,'$.frozenContext.manifestSelection.contextDeliveryProfileDigest')=NEW.context_delivery_profile_digest))))
    BEGIN SELECT RAISE(ABORT,'new ContextManifest must use v25 or frozen delivery evidence'); END;
    CREATE TRIGGER context_manifest_quote_profile_insert BEFORE INSERT ON context_manifest
    WHEN (NEW.context_manifest_version=25 AND NEW.context_delivery_profile_version<>6)
      OR (NEW.context_manifest_version=24 AND (NEW.context_delivery_profile_version NOT IN (5,6)
          OR (NEW.context_delivery_profile_version=6 AND NEW.camp_attachment_view_receipt_version IS NOT 2)))
      OR (NEW.context_manifest_version=23 AND NEW.context_delivery_profile_version<>5)
      OR (NEW.context_manifest_version<23 AND NEW.context_delivery_profile_version<>4)
    BEGIN SELECT RAISE(ABORT,'ContextManifest profile pairing is invalid'); END;
    CREATE TRIGGER runtime_input_delivery_attachment_auth_insert BEFORE INSERT ON runtime_input_delivery
    WHEN NEW.runtime_request_digest IS NULL OR NOT (
        (NEW.runtime_attachment_auth_receipt_version IS 1 AND NEW.runtime_attachment_auth_receipt_json IS NOT NULL AND NEW.runtime_attachment_auth_receipt_digest IS NOT NULL)
        OR (NEW.runtime_attachment_auth_receipt_version IS NULL AND NEW.runtime_attachment_auth_receipt_json IS NULL AND NEW.runtime_attachment_auth_receipt_digest IS NULL
            AND EXISTS(SELECT 1 FROM context_manifest WHERE id=NEW.context_manifest_id AND context_manifest_version IN (24,25) AND camp_attachment_view_receipt_version IS NULL)))
    BEGIN SELECT RAISE(ABORT,'Runtime Input Delivery attachment evidence does not match its manifest'); END;
"#;

#[cfg(test)]
pub(super) fn restore_v161_context_guards_for_test(transaction: &Transaction<'_>) {
    transaction.execute_batch(GUARDS).unwrap();
}

fn contains_schema(
    connection: &Connection,
    name: &str,
    fragments: &[&str],
) -> rusqlite::Result<bool> {
    let sql: Option<String> = connection
        .query_row("SELECT sql FROM sqlite_schema WHERE name=?1", [name], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(sql.is_some_and(|sql| fragments.iter().all(|fragment| sql.contains(fragment))))
}

pub(super) fn legacy_preview_context_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(contains_schema(
        connection,
        "context_manifest",
        &[
            "context_manifest_version IN (19, 20, 21, 22, 23, 24)",
            "context_delivery_profile_version IN (4, 5, 6)",
            "context_manifest_version = 24 AND run_facts_schema_version = 3",
            "workspace_fact_json",
            "workspace_fact_digest",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v24_only_insert",
        &[
            "NEW.context_manifest_version <> 24",
            "NEW.rendered_payload_digest",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version=24 AND NEW.context_delivery_profile_version<>6",
            "NEW.context_manifest_version=23 AND NEW.context_delivery_profile_version<>5",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &[
            "NEW.runtime_attachment_auth_receipt_version IS NOT 1",
            "NEW.runtime_request_digest IS NULL",
        ],
    )?)
}

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    if !contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25)",
            "run_facts_schema_version IN (1, 2, 3, 4)",
            "context_delivery_profile_version IN (4, 5, 6)",
            CURRENT_FACT_BRANCH,
            PATH_FACT_BRANCH,
            "workspace_fact_json",
            "workspace_fact_digest",
            "workspace_fact_included",
        ],
    )? {
        return Ok(false);
    }
    // The actual guard bodies, not lookalike names, define current admission.
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(
        "CREATE TABLE context_manifest(id); CREATE TABLE runtime_input_delivery(id);",
    )?;
    expected.execute_batch(GUARDS)?;
    for name in [
        "context_manifest_v25_only_insert",
        "context_manifest_quote_profile_insert",
        "runtime_input_delivery_attachment_auth_insert",
    ] {
        let sql: String =
            expected.query_row("SELECT sql FROM sqlite_schema WHERE name=?1", [name], |r| {
                r.get(0)
            })?;
        if !contains_schema(connection, name, &[&sql])? {
            return Ok(false);
        }
    }
    let workspace_lifecycle: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=162)",
        [],
        |row| row.get(0),
    )?;
    for (name, fragments) in [
        (
            "mission",
            &[
                "camp_id TEXT NOT NULL UNIQUE",
                "status IN ('needs_you','not_started','in_progress','completed')",
            ][..],
        ),
        (
            "mission_activity",
            &[
                "changes_json TEXT NOT NULL",
                "REFERENCES mission(id) ON DELETE CASCADE",
            ][..],
        ),
        (
            "mission_start",
            &[
                "command_id TEXT NOT NULL",
                "camp_turn_id TEXT NOT NULL UNIQUE",
            ][..],
        ),
        ("mission_pr", &["UNIQUE(mission_id,url)"][..]),
        (
            "mission_workspace",
            &[
                "preparation_token TEXT NOT NULL",
                "UNIQUE(mission_id,execution_host_id,git_common_dir)",
            ][..],
        ),
        (
            "mission_execution_host",
            &["singleton INTEGER PRIMARY KEY CHECK(singleton=1)"][..],
        ),
        (
            "mission_workspace_binding_reset",
            &[
                "native_binding_generation",
                "native_workspace_fact_digest=NULL",
            ][..],
        ),
        (
            "mission_camp_delete_cleanup",
            &["state='cleanup_pending'", "WHERE camp_id=OLD.id"][..],
        ),
        ("agent_run", &["workspace_preparing_at TEXT"][..]),
        ("conversation", &["native_workspace_fact_digest TEXT"][..]),
    ] {
        if workspace_lifecycle && name == "mission_camp_delete_cleanup" {
            continue;
        }
        if !contains_schema(connection, name, fragments)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// v163 keeps the Mission schema but replaces the public Camp context guard and
/// lets a Mission start point at either its historical CampTurn or its new
/// Delivery-first admission record.
pub(super) fn schema_matches_v163(connection: &Connection) -> rusqlite::Result<bool> {
    let common_manifest = contains_schema(
        connection,
        "context_manifest",
        &[
            CURRENT_FACT_BRANCH,
            PATH_FACT_BRANCH,
            "workspace_fact_json",
            "workspace_fact_digest",
            "workspace_fact_included",
        ],
    )? && (contains_schema(
        connection,
        "context_manifest",
        &["run_facts_schema_version IN (1, 2, 3, 4, 5)"],
    )? || contains_schema(
        connection,
        "context_manifest",
        &["run_facts_schema_version IN (1, 2, 3, 4, 5, 6)"],
    )? || contains_schema(
        connection,
        "context_manifest",
        &["run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7)"],
    )? || contains_schema(
        connection,
        "context_manifest",
        &["run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8)"],
    )?);
    let context_v26 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v26_only_insert",
        &[
            "NEW.context_manifest_version = 26",
            "invocation_kind = 'batch'",
            "invocation_kind = 'single_chat'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (24, 25, 26)"],
    )?;
    let context_v27 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26, 27)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26, 27)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v27_only_insert",
        &[
            "NEW.context_manifest_version IN (26, 27)",
            "batch_input.context_manifest_version",
            "invocation_kind = 'batch'",
            "invocation_kind = 'single_chat'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (24, 25, 26, 27)"],
    )?;
    let context_v28 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26, 27, 28)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v28_only_insert",
        &[
            "NEW.context_manifest_version = 28",
            "batch_input.context_manifest_version",
            "invocation_kind = 'batch'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (26, 28)"],
    )?;
    let context_v29 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v29_only_insert",
        &[
            "NEW.context_manifest_version = 29",
            "batch_input.context_manifest_version",
            "invocation_kind = 'batch'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (26, 29)"],
    )?;
    let context_v30 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v30_only_insert",
        &[
            "NEW.context_manifest_version = 30",
            "invocation_kind = 'batch'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (26, 27, 29, 30)"],
    )?;
    let context_v31 = contains_schema(
        connection,
        "context_manifest",
        &[
            "formatter_version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31)",
        ],
    )? && contains_schema(
        connection,
        "context_manifest_v31_only_insert",
        &[
            "NEW.context_manifest_version = 31",
            "invocation_kind = 'batch'",
        ],
    )? && contains_schema(
        connection,
        "runtime_input_delivery_attachment_auth_insert",
        &["context_manifest_version IN (26, 27, 29, 30, 31)"],
    )?;
    let profile_pairing = contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version = 26",
            "NEW.context_manifest_version = 25",
        ],
    )? || contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version = 28",
            "NEW.context_manifest_version = 26",
        ],
    )? || contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version = 29",
            "NEW.context_manifest_version = 26",
        ],
    )? || contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version = 30",
            "NEW.context_manifest_version = 27",
        ],
    )? || contains_schema(
        connection,
        "context_manifest_quote_profile_insert",
        &[
            "NEW.context_manifest_version = 31",
            "NEW.context_manifest_version = 30",
            "NEW.context_manifest_version = 27",
        ],
    )?;
    if !common_manifest
        || !(context_v26 || context_v27 || context_v28 || context_v29 || context_v30 || context_v31)
        || !profile_pairing
    {
        return Ok(false);
    }

    let workspace_lifecycle: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=162)",
        [],
        |row| row.get(0),
    )?;
    for (name, fragments) in [
        (
            "mission",
            &[
                "camp_id TEXT NOT NULL UNIQUE",
                "status IN ('needs_you','not_started','in_progress','completed')",
            ][..],
        ),
        (
            "mission_activity",
            &[
                "changes_json TEXT NOT NULL",
                "REFERENCES mission(id) ON DELETE CASCADE",
            ][..],
        ),
        (
            "mission_start",
            &[
                "command_id TEXT NOT NULL",
                "delivery_id TEXT UNIQUE",
                "CHECK((camp_turn_id IS NOT NULL) <> (delivery_id IS NOT NULL))",
            ][..],
        ),
        ("mission_pr", &["UNIQUE(mission_id,url)"][..]),
        (
            "mission_workspace",
            &[
                "preparation_token TEXT NOT NULL",
                "UNIQUE(mission_id,execution_host_id,git_common_dir)",
            ][..],
        ),
        (
            "mission_execution_host",
            &["singleton INTEGER PRIMARY KEY CHECK(singleton=1)"][..],
        ),
        (
            "mission_workspace_binding_reset",
            &[
                "native_binding_generation",
                "native_workspace_fact_digest=NULL",
            ][..],
        ),
        (
            "mission_camp_delete_cleanup",
            &["state='cleanup_pending'", "WHERE camp_id=OLD.id"][..],
        ),
        ("agent_run", &["workspace_preparing_at TEXT"][..]),
        ("conversation", &["native_workspace_fact_digest TEXT"][..]),
    ] {
        if workspace_lifecycle && name == "mission_camp_delete_cleanup" {
            continue;
        }
        if !contains_schema(connection, name, fragments)? {
            return Ok(false);
        }
    }
    Ok(true)
}

impl Database {
    pub(super) fn migrate_mission_context_v158(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version=="v1.59" && marker.projection_schema_version==107),
                "Mission context migration requires an admitted v1.59/schema 107 source"
            );
            let preview = mission_v156_schema_matches(&tx)?;
            let schema: String = tx.query_row(
                "SELECT sql FROM sqlite_schema WHERE name='context_manifest' AND type='table'",
                [],
                |r| r.get(0),
            )?;
            let mut next = schema
                .replace(
                    "CREATE TABLE \"context_manifest\"",
                    "CREATE TABLE context_manifest_v158",
                )
                .replace(
                    "CREATE TABLE context_manifest (",
                    "CREATE TABLE context_manifest_v158 (",
                )
                .replace(
                    "formatter_version IN (20, 21, 22, 23, 24)",
                    "formatter_version IN (20, 21, 22, 23, 24, 25)",
                )
                .replace(
                    "context_manifest_version IN (19, 20, 21, 22, 23, 24)",
                    "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25)",
                )
                .replace(
                    "run_facts_schema_version IN (1, 2, 3)",
                    "run_facts_schema_version IN (1, 2, 3, 4)",
                )
                .replace(
                    "context_delivery_profile_version IN (4, 5)",
                    "context_delivery_profile_version IN (4, 5, 6)",
                );
            if preview {
                next = next.replace("context_manifest_version IN (22, 23, 24)", "context_manifest_version IN (22, 23)")
                    .replace("((context_manifest_version < 24 AND run_facts_schema_version = 2) OR (context_manifest_version = 24 AND run_facts_schema_version = 3))", "run_facts_schema_version = 2")
                    .replace("(context_manifest_version = 19", &format!("{PATH_FACT_BRANCH}\n OR\n (context_manifest_version = 19"));
            }
            next = next.replace(
                "(context_manifest_version = 19",
                &format!("{CURRENT_FACT_BRANCH}\n OR\n (context_manifest_version = 19"),
            );
            anyhow::ensure!(
                next.contains("CREATE TABLE context_manifest_v158")
                    && next.contains(CURRENT_FACT_BRANCH)
                    && next.contains(PATH_FACT_BRANCH),
                "Mission context source schema mismatch"
            );
            let objects = migration_schema_objects(&tx, "context_manifest", true)?;
            tx.execute_batch(&next)?;
            drop_rebuild_triggers(&tx, &objects)?;
            tx.execute_batch("INSERT INTO context_manifest_v158 SELECT * FROM context_manifest; DROP TABLE context_manifest; ALTER TABLE context_manifest_v158 RENAME TO context_manifest;")?;
            restore_rebuild_schema_objects(
                &tx,
                "context_manifest",
                objects
                    .into_iter()
                    .filter(|(_, name, _)| {
                        !matches!(
                            name.as_str(),
                            "context_manifest_v24_only_insert"
                                | "context_manifest_quote_profile_insert"
                                | "runtime_input_delivery_attachment_auth_insert"
                        )
                    })
                    .collect(),
            )?;
            tx.execute_batch(
                "DROP TRIGGER IF EXISTS runtime_input_delivery_attachment_auth_insert;",
            )?;
            if !preview {
                tx.execute_batch(include_str!("mission_schema.sql"))?;
            }
            tx.execute_batch(
                "CREATE TRIGGER IF NOT EXISTS mission_camp_delete_cleanup BEFORE DELETE ON camp
                 BEGIN
                     UPDATE mission_workspace SET state='cleanup_pending',updated_at=datetime('now')
                     WHERE camp_id=OLD.id AND state IN ('ready','preparing');
                 END;",
            )?;
            tx.execute_batch(GUARDS)?;
            mission_details::apply_schema(&tx)?;
            tx.execute_batch("INSERT INTO schema_migration VALUES(158,datetime('now')); INSERT INTO schema_migration VALUES(159,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=109,updated_at=datetime('now') WHERE singleton=1;")?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 109),
                "Mission context migration failed source admission"
            );
            validate_migration_foreign_keys(
                &tx,
                &[
                    "context_manifest",
                    "mission",
                    "mission_activity",
                    "mission_start",
                    "mission_pr",
                    "mission_details_read",
                ],
            )?;
            tx.commit()?;
            Ok(())
        })();
        let restore = self.connection.execute_batch("PRAGMA foreign_keys=ON;");
        result?;
        restore?;
        self.migrate_mission_delivery_v160()?;
        self.migrate_mission_attachments_v161()?;
        self.migrate_mission_workspace_lifecycle_v162()?;
        self.migrate_camp_message_agent_run_v163()?;
        self.migrate_agent_run_notification_v164()?;
        self.migrate_single_chat_operation_policy_v165()?;
        self.migrate_default_recipient_mention_v166()
    }
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    if connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=162)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap()
    {
        downgrade_current_schema_to_v161_source_for_test(connection);
    }
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=158)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    assert_eq!(connection.query_row("SELECT (SELECT count(*) FROM mission)+(SELECT count(*) FROM context_manifest WHERE workspace_fact_json IS NOT NULL)",[],|r|r.get::<_,i64>(0)).unwrap(),0,"historical source cannot represent Mission or workspace evidence");
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TABLE IF EXISTS mission_number_sequence;
        ALTER TABLE conversation DROP COLUMN mission_details_delivered_version;
        ALTER TABLE context_manifest DROP COLUMN mission_details_version;
        DELETE FROM schema_migration WHERE version IN (160,161,162);",
    )
    .unwrap();
    tx.execute_batch("DROP TABLE IF EXISTS mission_details_read; DELETE FROM schema_migration WHERE version=159;")
        .unwrap();
    let guard: String = tx
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='context_manifest_version_immutable'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable;")
        .unwrap();
    let mut profile = crate::context_delivery::CONTEXT_DELIVERY_PROFILE_V5;
    profile.profile_version = 5;
    tx.execute("UPDATE context_manifest SET context_manifest_version=24,formatter_version=24,run_facts_schema_version=3,run_fact_payload_json=json_set(run_fact_payload_json,'$.schemaVersion',3),context_delivery_profile_version=5,context_delivery_profile_json=?1,context_delivery_profile_digest=?2 WHERE context_manifest_version=25",params![serde_json::to_string(&profile).unwrap(),profile.canonical_digest().unwrap()]).unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch("DROP TRIGGER IF EXISTS mission_camp_delete_cleanup; DROP TRIGGER mission_workspace_binding_reset;
        DROP TRIGGER context_manifest_v25_only_insert; DROP TRIGGER context_manifest_quote_profile_insert;
        DROP TRIGGER runtime_input_delivery_attachment_auth_insert;
        DROP TABLE mission_start; DROP TABLE mission_activity; DROP TABLE mission_pr; DROP TABLE mission;
        DROP TABLE mission_workspace; DROP TABLE mission_execution_host;
        ALTER TABLE agent_run DROP COLUMN workspace_preparing_at;
        ALTER TABLE conversation DROP COLUMN native_workspace_fact_digest;
        ALTER TABLE context_manifest DROP COLUMN workspace_fact_json;
        ALTER TABLE context_manifest DROP COLUMN workspace_fact_digest;
        ALTER TABLE context_manifest DROP COLUMN workspace_fact_included;").unwrap();
    let schema: String = tx
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='context_manifest'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let previous = schema
        .replace(
            "CREATE TABLE \"context_manifest\"",
            "CREATE TABLE context_manifest_pre_mission",
        )
        .replace(&format!("{CURRENT_FACT_BRANCH}\n OR\n "), "")
        .replace(
            "formatter_version IN (20, 21, 22, 23, 24, 25)",
            "formatter_version IN (20, 21, 22, 23, 24)",
        )
        .replace(
            "context_manifest_version IN (19, 20, 21, 22, 23, 24, 25)",
            "context_manifest_version IN (19, 20, 21, 22, 23, 24)",
        )
        .replace(
            "run_facts_schema_version IN (1, 2, 3, 4)",
            "run_facts_schema_version IN (1, 2, 3)",
        )
        .replace(
            "context_delivery_profile_version IN (4, 5, 6)",
            "context_delivery_profile_version IN (4, 5)",
        );
    rebuild_table_to_v135_source_for_test(
        &tx,
        "context_manifest",
        "context_manifest_pre_mission",
        &previous,
        &[],
    );
    tx.execute_batch(attachment_paths::GUARDS).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=158; UPDATE rovai_data_contract SET projection_schema_version=107 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}
