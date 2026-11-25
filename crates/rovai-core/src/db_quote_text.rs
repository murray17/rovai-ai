//! Admit new context projections without rewriting frozen inputs.
use super::*;

const OLD_VERSIONS: &str = "38, 39, 40, 41, 42)";
const VERSIONS: &str = "38, 39, 40, 41, 42, 43, 44)";
const EDITED_VERSIONS: &str = "38, 39, 40, 41, 42, 43, 44, 45)";
const INPUT_VERSIONS: &str = "38, 39, 40, 43)";
const EDITED_INPUT_VERSIONS: &str = "38, 39, 40, 43, 45)";
const EDITED_PROFILE: &str =
    "(NEW.context_manifest_version=45 AND NEW.context_delivery_profile_version=15) OR ";
const PROFILE: &str = "(NEW.context_manifest_version=43 AND NEW.context_delivery_profile_version=15) OR (NEW.context_manifest_version=44 AND NEW.context_delivery_profile_version=16) OR ";
const NON_BATCH: &str = "(NEW.source_delivery_id IS NULL AND NEW.context_manifest_version = 44 AND NEW.formatter_version = 44 AND NEW.run_facts_schema_version = 13 AND NEW.context_delivery_profile_version = 16 AND EXISTS(SELECT 1 FROM agent_run r WHERE r.id=NEW.agent_run_id AND r.invocation_kind<>'batch')) OR ";

fn schema(c: &Connection, kind: &str, name: &str) -> rusqlite::Result<String> {
    c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )
}
fn clause(sql: &str, prefix: &str) -> Result<String> {
    let start = sql
        .find(prefix)
        .context("Missing quote format migration clause")?;
    let end = start
        + sql[start..]
            .find("\n OR\n")
            .context("Missing quote format clause boundary")?;
    Ok(sql[start..end].to_owned())
}
fn additions(guard: &str) -> Result<String> {
    let batch = clause(guard, "(NEW.context_manifest_version = 36")?
        .replace("= 36", "= 43")
        .replace("IS NOT 36", "IS NOT 43")
        .replace("profile_version = 13", "profile_version = 15")
        .replace("schema_version = 9", "schema_version = 11");
    let start = guard
        .find("(NEW.source_delivery_id IS NOT NULL AND NEW.context_manifest_version = 40")
        .context("Missing Steer admission")?;
    let end = start
        + guard[start..]
            .find(" OR (NEW.source_delivery_id IS NULL")
            .context("Missing Steer boundary")?;
    let steer = guard[start..end].replace("= 40", "= 43");
    Ok(format!(
        "{NON_BATCH}{steer} OR (NEW.source_delivery_id IS NULL AND {batch}) OR "
    ))
}

pub(super) fn schema_matches(c: &Connection, edited_messages: bool) -> rusqlite::Result<bool> {
    let versions = if edited_messages {
        EDITED_VERSIONS
    } else {
        VERSIONS
    };
    let current_input = if edited_messages {
        "IS NOT 45"
    } else {
        "IS NOT 43"
    };
    Ok(schema(c,"table","context_manifest").is_ok_and(|s|s.contains(versions)
        && s.contains("context_manifest_version = 43 AND formatter_version = 43 AND run_facts_schema_version = 11")
        && s.contains("context_manifest_version = 44 AND formatter_version = 44 AND run_facts_schema_version = 13")
        && (!edited_messages || s.contains("context_manifest_version = 45 AND formatter_version = 45 AND run_facts_schema_version = 14")))
        && schema(c,"trigger","context_manifest_v40_only_insert").is_ok_and(|s|s.contains(NON_BATCH))
        && schema(c,"trigger","context_manifest_quote_profile_insert")
            .is_ok_and(|s|s.contains(PROFILE) && (!edited_messages || s.contains(EDITED_PROFILE)))
        && schema(c,"trigger","agent_run_input_v40_only_insert").is_ok_and(|s|s.contains(current_input))
        && (!edited_messages || schema(c,"table","agent_run_input").is_ok_and(|s|s.contains(EDITED_INPUT_VERSIONS))))
}

fn rewrite(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    let mut manifest = schema(tx, "table", "context_manifest")?;
    for (old, new) in [(40, 43), (42, 44)] {
        let base = clause(&manifest, &format!("(context_manifest_version = {old} AND"))?;
        let next = base.replace(&format!("= {old}"), &format!("= {new}"));
        manifest = if reverse {
            manifest.replace(&format!("{next}\n OR\n "), "")
        } else {
            manifest.replace(&base, &format!("{next}\n OR\n {base}"))
        };
    }
    let (from, to) = if reverse {
        (VERSIONS, OLD_VERSIONS)
    } else {
        (OLD_VERSIONS, VERSIONS)
    };
    manifest = manifest.replace(from, to);
    let mut guard = schema(tx, "trigger", "context_manifest_v40_only_insert")?;
    let added = additions(&guard)?;
    guard = if reverse {
        guard.replace(&added, "")
    } else {
        guard.replacen("WHEN NOT (", &format!("WHEN NOT ({added}"), 1)
    };
    let profile = schema(tx, "trigger", "context_manifest_quote_profile_insert")?;
    let profile = if reverse {
        profile.replace(PROFILE, "")
    } else {
        profile.replacen("WHEN NOT (", &format!("WHEN NOT ({PROFILE}"), 1)
    };
    let input = schema(tx, "table", "agent_run_input")?.replace(
        if reverse {
            INPUT_VERSIONS
        } else {
            "38, 39, 40)"
        },
        if reverse {
            "38, 39, 40)"
        } else {
            INPUT_VERSIONS
        },
    );
    let input_guard = schema(tx, "trigger", "agent_run_input_v40_only_insert")?
        .replace(
            if reverse { "IS NOT 43" } else { "IS NOT 40" },
            if reverse { "IS NOT 40" } else { "IS NOT 43" },
        )
        .replace(
            if reverse {
                "use ContextManifest v43"
            } else {
                "use ContextManifest v40"
            },
            if reverse {
                "use ContextManifest v40"
            } else {
                "use ContextManifest v43"
            },
        );
    let attachment = schema(
        tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )?
    .replace(from, to);
    install_context_constraints(
        tx,
        manifest,
        input,
        [guard, profile, input_guard, attachment],
    )
}

fn install_context_constraints(
    tx: &Transaction<'_>,
    manifest: String,
    input: String,
    [guard, profile, input_guard, attachment]: [String; 4],
) -> Result<()> {
    rebuild_table_v171(
        tx,
        "context_manifest",
        &replacement_table_schema_v171(manifest, "context_manifest"),
        &[],
        &[
            "context_manifest_v40_only_insert",
            "context_manifest_quote_profile_insert",
        ],
    )?;
    rebuild_table_v171(
        tx,
        "agent_run_input",
        &replacement_table_schema_v171(input, "agent_run_input"),
        &[],
        &["agent_run_input_v40_only_insert"],
    )?;
    tx.execute_batch(&guard)?;
    tx.execute_batch(&profile)?;
    tx.execute_batch(&input_guard)?;
    tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
    tx.execute_batch(&attachment)?;
    Ok(())
}

fn rewrite_edited_messages(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    let replace = |sql: String, old: &str, new: &str| {
        if reverse {
            sql.replace(new, old)
        } else {
            sql.replace(old, new)
        }
    };
    let mut manifest = schema(tx, "table", "context_manifest")?;
    let previous = clause(&manifest, "(context_manifest_version = 43 AND")?;
    let edited = previous
        .replace("= 43", "= 45")
        .replace("schema_version = 11", "schema_version = 14");
    manifest = replace(manifest, &previous, &format!("{edited}\n OR\n {previous}"));
    manifest = replace(manifest, VERSIONS, EDITED_VERSIONS);
    manifest = replace(manifest, "10, 11, 12, 13)", "10, 11, 12, 13, 14)");
    let guard = schema(tx, "trigger", "context_manifest_v40_only_insert")?;
    // Clone the existing public batch and Steer admission clauses as a pair.
    let v43 = additions(&guard)?;
    let public = v43
        .strip_prefix(NON_BATCH)
        .context("Missing public admission")?;
    let public = public
        .replace("= 43", "= 45")
        .replace("IS NOT 43", "IS NOT 45")
        .replace("schema_version = 11", "schema_version = 14")
        .replace("schema_version=11", "schema_version=14");
    let guard = replace(guard, "WHEN NOT (", &format!("WHEN NOT ({public}"));
    let profile = replace(
        schema(tx, "trigger", "context_manifest_quote_profile_insert")?,
        "WHEN NOT (",
        &format!("WHEN NOT ({EDITED_PROFILE}"),
    );
    let input = replace(
        schema(tx, "table", "agent_run_input")?,
        INPUT_VERSIONS,
        EDITED_INPUT_VERSIONS,
    );
    let input_guard = replace(
        schema(tx, "trigger", "agent_run_input_v40_only_insert")?,
        "IS NOT 43",
        "IS NOT 45",
    );
    let input_guard = replace(
        input_guard,
        "use ContextManifest v43",
        "use ContextManifest v45",
    );
    let attachment = replace(
        schema(
            tx,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )?,
        VERSIONS,
        EDITED_VERSIONS,
    );
    install_context_constraints(
        tx,
        manifest,
        input,
        [guard, profile, input_guard, attachment],
    )
}

pub(super) fn migrate_edited_messages(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version == 181),
            "Edited message context requires schema 181"
        );
        rewrite_edited_messages(&tx, false)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(232,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=182,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
            ],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(ref marker)
                    | DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.projection_schema_version == 182
            ),
            "Edited message context schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_edited_messages_for_test(c: &Connection) {
    super::chat_topics::downgrade_for_test(c);
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=232)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    let manifest_immutable = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let input_immutable = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;
        UPDATE context_manifest SET context_manifest_version=43,formatter_version=43,run_facts_schema_version=11 WHERE context_manifest_version=45;
        UPDATE agent_run_input SET context_manifest_version=43 WHERE context_manifest_version=45;").unwrap();
    tx.execute_batch(&manifest_immutable).unwrap();
    tx.execute_batch(&input_immutable).unwrap();
    rewrite_edited_messages(&tx, true).unwrap();
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version=232;
        UPDATE rovai_data_contract SET projection_schema_version=181 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "slow-tests"))]
pub(crate) fn assert_edited_message_upgrade(db: &mut Database) {
    downgrade_edited_messages_for_test(db.connection());
    let evidence = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_edit_context_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=232 BEGIN SELECT RAISE(ABORT,'edited context rollback'); END;").unwrap();
    assert!(
        migrate_edited_messages(db)
            .unwrap_err()
            .to_string()
            .contains("edited context rollback")
    );
    assert!(schema_matches(db.connection(), false).unwrap());
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_edit_context_receipt")
        .unwrap();
    migrate_edited_messages(db).unwrap();
    assert!(schema_matches(db.connection(), true).unwrap());
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
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
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==167),
            "Quote text format requires schema 167"
        );
        rewrite(&tx, false)?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(218,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=168,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
            ],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(_)
                    | DatabaseContractClassification::SupportedMigrationSource(_)
            ),
            "Quote text schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Existing migration owners use synthetic data; product rows never downgrade.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    super::subagent::downgrade_for_test(c);
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=218)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    let immutable = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let input_immutable = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;
        UPDATE context_manifest SET context_manifest_version=40,formatter_version=40 WHERE context_manifest_version=43;
        UPDATE context_manifest SET context_manifest_version=42,formatter_version=42 WHERE context_manifest_version=44;
        UPDATE agent_run_input SET context_manifest_version=40 WHERE context_manifest_version=43;").unwrap();
    tx.execute_batch(&immutable).unwrap();
    tx.execute_batch(&input_immutable).unwrap();
    rewrite(&tx, true).unwrap();
    tx.execute_batch(
        "DELETE FROM schema_migration WHERE version=218;
        UPDATE rovai_data_contract SET projection_schema_version=167 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(db: &mut Database) {
    // The existing Single Chat context owner supplies real frozen Manifest/Blob data.
    downgrade_for_test(db.connection());
    let evidence = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_quote_text_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=218 BEGIN SELECT RAISE(ABORT,'quote text rollback'); END;").unwrap();
    assert!(
        migrate(db)
            .unwrap_err()
            .to_string()
            .contains("quote text rollback")
    );
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(
        matches!(classify_database_contract(db.connection()).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==167)
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_quote_text_receipt")
        .unwrap();
    migrate(db).unwrap();
    assert!(schema_matches(db.connection(), false).unwrap());
    assert_eq!(
        evidence,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
}
