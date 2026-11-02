//! Converge main and Mission 064 without changing any frozen input or receipt.
use super::*;

fn schema(c: &Connection, kind: &str, name: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )?)
}

const MAIN_VERSIONS: &str = "29, 30, 31, 32, 33, 34, 35, 36, 37, 38)";
const VERSIONS: &str = "29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39)";
const MAIN_INPUT: &str = "29, 30, 31, 32, 33, 34, 36, 38)";
const INPUT: &str = "29, 30, 31, 32, 33, 34, 36, 37, 38, 39)";

fn input_columns(c: &Connection) -> bool {
    c.prepare("SELECT source_delivery_id FROM context_manifest LIMIT 0")
        .is_ok()
        && c.prepare("SELECT input_kind,input_sequence FROM runtime_input_delivery LIMIT 0")
            .is_ok()
        && c.prepare(
            "SELECT requested_mode,target_execution_epoch FROM camp_message_delivery LIMIT 0",
        )
        .is_ok()
}

fn has_unique_columns(c: &Connection, table: &str, columns: &str) -> bool {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_index_list(?1) i WHERE i.[unique]=1 AND i.partial=0
        AND (SELECT group_concat(name,',') FROM pragma_index_info(i.name))=?2)",
        params![table, columns],
        |r| r.get(0),
    )
    .unwrap_or(false)
}

fn partial_unique_index(
    c: &Connection,
    table: &str,
    name: &str,
    columns: &str,
    predicate: &str,
) -> bool {
    let valid: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_index_list(?1) i
        WHERE i.name=?2 AND i.[unique]=1 AND i.partial=1
        AND (SELECT group_concat(name,',') FROM pragma_index_info(i.name))=?3)
        AND NOT EXISTS(SELECT 1 FROM pragma_index_list(?1) i WHERE i.name<>?2 AND i.[unique]=1
            AND (SELECT group_concat(name,',') FROM pragma_index_info(i.name))=?3)",
            params![table, name, columns],
            |r| r.get(0),
        )
        .unwrap_or(false);
    valid
        && schema(c, "index", name).is_ok_and(|sql| {
            let normalized = sql
                .chars()
                .filter(|c| !c.is_ascii_whitespace())
                .collect::<String>()
                .to_ascii_lowercase();
            normalized
                .split_once("where")
                .is_some_and(|(_, tail)| tail.trim_end_matches(';') == predicate)
        })
}

fn input_identity_schema_matches(c: &Connection) -> bool {
    input_columns(c)
        && !has_unique_columns(c, "context_manifest", "agent_run_id")
        && has_unique_columns(
            c,
            "runtime_input_delivery",
            "context_manifest_id,execution_epoch",
        )
        && has_unique_columns(
            c,
            "runtime_input_delivery",
            "agent_run_id,execution_epoch,input_sequence",
        )
        && !has_unique_columns(c, "runtime_input_delivery", "agent_run_id,execution_epoch")
        && partial_unique_index(
            c,
            "context_manifest",
            "context_manifest_initial_run",
            "agent_run_id",
            "source_delivery_idisnull",
        )
        && partial_unique_index(
            c,
            "context_manifest",
            "context_manifest_source_delivery",
            "source_delivery_id",
            "source_delivery_idisnotnull",
        )
        && partial_unique_index(
            c,
            "runtime_input_delivery",
            "runtime_input_initial_native_identity",
            "native_binding_id,native_input_id",
            "native_input_idisnotnullandinput_kind='start'",
        )
}

/// Main's pre-Steer shape must contain none of the collided branch's input additions.
pub(super) fn pre_steer_schema_matches(c: &Connection) -> bool {
    message_senders::schema_matches(c)
        && has_unique_columns(c, "context_manifest", "agent_run_id")
        && has_unique_columns(c, "runtime_input_delivery", "agent_run_id,execution_epoch")
        && c.query_row("SELECT NOT EXISTS(SELECT 1 FROM pragma_table_info('context_manifest') WHERE name='source_delivery_id')
            AND NOT EXISTS(SELECT 1 FROM pragma_table_info('runtime_input_delivery') WHERE name IN ('input_kind','input_sequence'))
            AND NOT EXISTS(SELECT 1 FROM pragma_table_info('camp_message_delivery') WHERE name IN ('requested_mode','target_execution_epoch'))
            AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name IN ('context_manifest_initial_run','context_manifest_source_delivery','runtime_input_initial_native_identity',
                'agent_run_input_v37_only_insert','agent_run_input_v39_only_insert','context_manifest_v37_only_insert','context_manifest_v39_only_insert',
                'context_manifest_source_immutable','runtime_input_source_immutable','runtime_input_source_insert'))", [], |r| r.get::<_,bool>(0)).unwrap_or(false)
}

/// The old branch's 199 is NOT main's 199. Identify the known structure too.
pub(super) fn legacy_schema_matches(c: &Connection) -> bool {
    input_identity_schema_matches(c) && c.query_row("SELECT count(*)=6 FROM sqlite_master WHERE type='trigger' AND name IN
        ('agent_run_input_v37_only_insert','context_manifest_v37_only_insert','context_manifest_source_immutable',
         'runtime_input_source_immutable','runtime_input_source_insert','agent_run_claim_context_immutable')", [], |r|r.get::<_,bool>(0)).unwrap_or(false)
        && schema(c,"table","context_manifest").is_ok_and(|s|s.contains("context_manifest_version = 37 AND formatter_version = 37 AND run_facts_schema_version = 10") && !s.contains("agent_run_id TEXT NOT NULL UNIQUE"))
}

pub(super) fn retained_schema_matches(c: &Connection) -> bool {
    input_identity_schema_matches(c) && c.query_row("SELECT count(*)=4 FROM sqlite_master WHERE type='trigger' AND name IN
        ('context_manifest_source_immutable',
         'runtime_input_source_immutable','runtime_input_source_insert','agent_run_claim_context_immutable')", [], |r|r.get::<_,bool>(0)).unwrap_or(false)
        && schema(c,"table","context_manifest").is_ok_and(|s|s.contains("context_manifest_version = 39 AND formatter_version = 39 AND run_facts_schema_version = 10")
            && s.contains("context_manifest_version = 37 AND formatter_version = 37 AND run_facts_schema_version = 6")
            && s.contains("context_manifest_version = 37 AND formatter_version = 37 AND run_facts_schema_version = 10"))
}

pub(super) fn schema_matches(c: &Connection) -> bool {
    retained_schema_matches(c)
        && c.query_row(
            "SELECT count(*)=2 FROM sqlite_master WHERE type='trigger' AND name IN
            ('agent_run_input_v39_only_insert','context_manifest_v39_only_insert')",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false)
}

fn clause(sql: &str, prefix: &str) -> Result<String> {
    let start = sql
        .find(prefix)
        .with_context(|| format!("Missing migration clause: {prefix}"))?;
    let end = start
        + sql[start..]
            .find("\n OR\n")
            .context("Missing migration clause boundary")?;
    Ok(sql[start..end].to_owned())
}

fn facts(base: &str, version: i64, facts: i64) -> String {
    base.replace("= 36", &format!("= {version}"))
        .replace("schema_version = 9", &format!("schema_version = {facts}"))
}

fn public_admission(base: &str, version: i64, profile: i64, facts: i64) -> String {
    base.replace("= 36", &format!("= {version}"))
        .replace("IS NOT 36", &format!("IS NOT {version}"))
        .replace(
            "profile_version = 13",
            &format!("profile_version = {profile}"),
        )
        .replace("schema_version = 9", &format!("schema_version = {facts}"))
}

const NON_BATCH: &str = "(NEW.context_manifest_version = 37 AND NEW.formatter_version = 37 AND NEW.run_facts_schema_version = 6 AND NEW.context_delivery_profile_version = 12 AND EXISTS(SELECT 1 FROM agent_run AS run WHERE run.id=NEW.agent_run_id AND run.invocation_kind <> 'batch'))";
const STEER_ADMISSION: &str = "(NEW.source_delivery_id IS NOT NULL AND NEW.context_manifest_version IN (37,39)
    AND NEW.formatter_version=NEW.context_manifest_version AND NEW.run_facts_schema_version=10 AND NEW.context_delivery_profile_version=14
    AND EXISTS(SELECT 1 FROM camp_message_delivery d JOIN camp_message m ON m.id=d.message_id
        JOIN agent_run r ON r.id=d.claimed_agent_run_id WHERE d.id=NEW.source_delivery_id
        AND d.status='claimed' AND d.requested_mode='steer' AND m.author_type='user'
        AND r.id=NEW.agent_run_id AND r.invocation_kind='batch' AND r.execution_epoch=d.target_execution_epoch
        AND r.status IN ('running','waiting') AND r.cancel_requested_at IS NULL
        AND json_array_length(NEW.raw_message_refs_json)=1 AND json_extract(NEW.raw_message_refs_json,'$[0].entityId')=m.id))";

fn guard_tail(sql: &str, legacy: bool) -> Result<String> {
    let start = sql
        .find("(NEW.context_manifest_version = 36")
        .context("Missing v36 guard")?;
    let tail = sql[start..].to_owned();
    Ok(if legacy {
        tail.replacen(")) BEGIN SELECT", "BEGIN SELECT", 1)
    } else {
        tail
    })
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
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==153),
            "Steer convergence requires a recognized schema 153 source"
        );
        if schema_matches(&tx) {
            // Mission 064 already has Steer under 203; add main's compact format only.
            if !compact_execution::schema_matches(&tx)? {
                compact_execution::apply_schema(&tx)?;
            }
        } else {
            let legacy = legacy_schema_matches(&tx);
            anyhow::ensure!(
                legacy || message_senders::schema_matches(&tx),
                "Unrecognized migration 199 source"
            );
            if !legacy {
                tx.execute_batch("ALTER TABLE context_manifest ADD COLUMN source_delivery_id TEXT REFERENCES camp_message_delivery(id);
                ALTER TABLE runtime_input_delivery ADD COLUMN input_kind TEXT NOT NULL DEFAULT 'start' CHECK(input_kind IN ('start','steer'));
                ALTER TABLE runtime_input_delivery ADD COLUMN input_sequence INTEGER NOT NULL DEFAULT 0 CHECK(input_sequence>=0);
                ALTER TABLE camp_message_delivery ADD COLUMN requested_mode TEXT NOT NULL DEFAULT 'start' CHECK(requested_mode IN ('start','steer'));
                ALTER TABLE camp_message_delivery ADD COLUMN target_execution_epoch INTEGER CHECK(target_execution_epoch>0);")?;
            }
            let old = schema(&tx, "table", "context_manifest")?;
            let base = clause(
                &old,
                "(context_manifest_version = 36 AND formatter_version = 36 AND run_facts_schema_version = 9 AND",
            )?;
            let extra = if legacy {
                vec![
                    facts(&base, 37, 6),
                    facts(&base, 38, 9),
                    facts(&base, 39, 10),
                ]
            } else {
                vec![facts(&base, 37, 10), facts(&base, 39, 10)]
            };
            let old_versions = if legacy {
                "29, 30, 31, 32, 33, 34, 35, 36, 37)"
            } else {
                MAIN_VERSIONS
            };
            anyhow::ensure!(
                old.contains(old_versions),
                "Unexpected Manifest source versions"
            );
            let manifest = replacement_table_schema_v171(old, "context_manifest")
                .replace(
                    "agent_run_id TEXT NOT NULL UNIQUE",
                    "agent_run_id TEXT NOT NULL",
                )
                .replace(old_versions, VERSIONS)
                .replace(
                    "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9)",
                    "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
                )
                .replace(
                    "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13)",
                    "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)",
                )
                .replace(&base, &format!("{}\n OR\n {base}", extra.join("\n OR\n ")));
            let old_guard_name = if legacy {
                "context_manifest_v37_only_insert"
            } else {
                "context_manifest_v38_only_insert"
            };
            let old_guard = schema(&tx, "trigger", old_guard_name)?;
            let admission = clause(&old_guard, "(NEW.context_manifest_version = 36")?;
            let additions = [
                public_admission(&admission, 37, 14, 10),
                public_admission(&admission, 38, 13, 9),
                public_admission(&admission, 39, 14, 10),
                NON_BATCH.to_owned(),
            ]
            .join("\n OR\n ");
            let tail =
                guard_tail(&old_guard, legacy)?.replacen("BEGIN SELECT", ")) BEGIN SELECT", 1);
            let guard = format!(
                "CREATE TRIGGER context_manifest_v39_only_insert BEFORE INSERT ON context_manifest WHEN NOT ({STEER_ADMISSION} OR (NEW.source_delivery_id IS NULL AND ({additions} OR {tail}"
            );
            let profile=schema(&tx,"trigger","context_manifest_quote_profile_insert")?
            .replacen("WHEN NOT (","WHEN NOT ((NEW.context_manifest_version IN (37,39) AND NEW.context_delivery_profile_version=14) OR (NEW.context_manifest_version=37 AND NEW.context_delivery_profile_version=12) OR (NEW.context_manifest_version=38 AND NEW.context_delivery_profile_version=13) OR ",1);
            rebuild_table_v171(
                &tx,
                "context_manifest",
                &manifest,
                &[],
                &[old_guard_name, "context_manifest_quote_profile_insert"],
            )?;
            tx.execute_batch(&guard)?;
            tx.execute_batch(&profile)?;
            if !legacy {
                tx.execute_batch("CREATE UNIQUE INDEX context_manifest_initial_run ON context_manifest(agent_run_id) WHERE source_delivery_id IS NULL;
                CREATE UNIQUE INDEX context_manifest_source_delivery ON context_manifest(source_delivery_id) WHERE source_delivery_id IS NOT NULL;
                CREATE TRIGGER context_manifest_source_immutable BEFORE UPDATE OF source_delivery_id ON context_manifest BEGIN SELECT RAISE(ABORT,'Manifest source is immutable'); END;")?;
            }
            let old_input = if legacy {
                "29, 30, 31, 32, 33, 34, 36, 37)"
            } else {
                MAIN_INPUT
            };
            let input = replacement_table_schema_v171(
                schema(&tx, "table", "agent_run_input")?,
                "agent_run_input",
            )
            .replace(old_input, INPUT);
            rebuild_table_v171(
                &tx,
                "agent_run_input",
                &input,
                &[],
                &[if legacy {
                    "agent_run_input_v37_only_insert"
                } else {
                    "agent_run_input_v38_only_insert"
                }],
            )?;
            tx.execute_batch("CREATE TRIGGER agent_run_input_v39_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 39 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v39'); END;")?;
            let attachment = schema(
                &tx,
                "trigger",
                "runtime_input_delivery_attachment_auth_insert",
            )?
            .replace(old_versions, VERSIONS);
            if legacy {
                tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
            } else {
                let old = schema(&tx, "table", "runtime_input_delivery")?;
                anyhow::ensure!(
                    old.contains("UNIQUE(agent_run_id, execution_epoch)"),
                    "Missing initial input uniqueness"
                );
                let input=replacement_table_schema_v171(old,"runtime_input_delivery").replace("UNIQUE(agent_run_id, execution_epoch)","UNIQUE(context_manifest_id, execution_epoch), UNIQUE(agent_run_id, execution_epoch, input_sequence)");
                let index:String=tx.query_row("SELECT il.name FROM pragma_index_list('runtime_input_delivery') il WHERE il.[unique]=1 AND (SELECT group_concat(name,',') FROM pragma_index_info(il.name))='native_binding_id,native_input_id' LIMIT 1",[],|r|r.get(0))?;
                rebuild_table_v171(
                    &tx,
                    "runtime_input_delivery",
                    &input,
                    &[],
                    &["runtime_input_delivery_attachment_auth_insert", &index],
                )?;
                tx.execute_batch("CREATE UNIQUE INDEX runtime_input_initial_native_identity ON runtime_input_delivery(native_binding_id,native_input_id) WHERE native_input_id IS NOT NULL AND input_kind='start';
                CREATE TRIGGER runtime_input_source_insert BEFORE INSERT ON runtime_input_delivery
                WHEN NOT EXISTS(SELECT 1 FROM context_manifest m WHERE m.id=NEW.context_manifest_id AND m.agent_run_id=NEW.agent_run_id
                    AND ((m.source_delivery_id IS NULL AND NEW.input_kind='start' AND NEW.input_sequence=0)
                    OR (m.source_delivery_id IS NOT NULL AND NEW.input_kind='steer' AND NEW.input_sequence>0
                        AND EXISTS(SELECT 1 FROM camp_message_delivery d WHERE d.id=m.source_delivery_id AND d.claimed_agent_run_id=NEW.agent_run_id AND d.target_execution_epoch=NEW.execution_epoch AND d.status='claimed'))))
                BEGIN SELECT RAISE(ABORT,'Runtime input source does not match its Manifest'); END;
                CREATE TRIGGER runtime_input_source_immutable BEFORE UPDATE OF input_kind,input_sequence,context_manifest_id ON runtime_input_delivery BEGIN SELECT RAISE(ABORT,'Runtime input source is immutable'); END;")?;
            }
            tx.execute_batch(&attachment)?;
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(204,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=154,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
                "camp_message_delivery",
            ],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(_)
                    | DatabaseContractClassification::SupportedMigrationSource(_)
            ),
            "Steer convergence admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Only synthetic fixtures downgrade. Product migrations never change historical versions or bytes.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    super::minimax::downgrade_for_test(c);
    if !schema_matches(c) {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    assert_eq!(
        tx.query_row(
            "SELECT count(*) FROM context_manifest WHERE source_delivery_id IS NOT NULL",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let immutable = schema(&tx, "trigger", "context_manifest_version_immutable").unwrap();
    let input_immutable = schema(
        &tx,
        "trigger",
        "agent_run_input_context_projection_immutable",
    )
    .unwrap();
    let old_guard = schema(&tx, "trigger", "context_manifest_v39_only_insert").unwrap();
    let base = clause(&old_guard, "(NEW.context_manifest_version = 36").unwrap();
    let guard = format!(
        "CREATE TRIGGER context_manifest_v38_only_insert BEFORE INSERT ON context_manifest WHEN NOT ({}\n OR\n {NON_BATCH}\n OR\n {}",
        public_admission(&base, 38, 13, 9),
        guard_tail(&old_guard, true).unwrap()
    );
    let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert").unwrap();
    let tail = &profile[profile.find("(NEW.context_manifest_version = 36").unwrap()..];
    let profile = format!(
        "CREATE TRIGGER context_manifest_quote_profile_insert BEFORE INSERT ON context_manifest WHEN NOT ((NEW.context_manifest_version = 37 AND NEW.context_delivery_profile_version = 12) OR (NEW.context_manifest_version = 38 AND NEW.context_delivery_profile_version = 13) OR {tail}"
    );
    let attachment = schema(
        &tx,
        "trigger",
        "runtime_input_delivery_attachment_auth_insert",
    )
    .unwrap()
    .replace(VERSIONS, MAIN_VERSIONS);
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;
        DROP TRIGGER context_manifest_source_immutable; DROP TRIGGER runtime_input_source_immutable; DROP TRIGGER runtime_input_source_insert;
        DROP TRIGGER context_manifest_v39_only_insert; DROP TRIGGER context_manifest_quote_profile_insert;
        DROP INDEX context_manifest_initial_run; DROP INDEX context_manifest_source_delivery;
        DROP INDEX runtime_input_initial_native_identity; DROP TRIGGER runtime_input_delivery_attachment_auth_insert;
        UPDATE context_manifest SET context_manifest_version=38,formatter_version=38,context_delivery_profile_version=13,run_facts_schema_version=9 WHERE context_manifest_version=39;
        UPDATE agent_run_input SET context_manifest_version=38 WHERE context_manifest_version=39;
        ALTER TABLE context_manifest DROP COLUMN source_delivery_id; ALTER TABLE camp_message_delivery DROP COLUMN requested_mode; ALTER TABLE camp_message_delivery DROP COLUMN target_execution_epoch;
    ").unwrap();
    tx.execute_batch(&immutable).unwrap();
    tx.execute_batch(&input_immutable).unwrap();
    let old = schema(&tx, "table", "context_manifest").unwrap();
    let base=clause(&old,"(context_manifest_version = 36 AND formatter_version = 36 AND run_facts_schema_version = 9 AND").unwrap();
    let manifest = replacement_table_schema_v171(old, "context_manifest")
        .replace(&format!("{}\n OR\n ", facts(&base, 37, 10)), "")
        .replace(&format!("{}\n OR\n ", facts(&base, 39, 10)), "")
        .replace(
            "agent_run_id TEXT NOT NULL",
            "agent_run_id TEXT NOT NULL UNIQUE",
        )
        .replace(VERSIONS, MAIN_VERSIONS)
        .replace(
            "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
            "run_facts_schema_version IN (1, 2, 3, 4, 5, 6, 7, 8, 9)",
        )
        .replace(
            "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)",
            "profile_version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13)",
        );
    rebuild_table_v171(&tx, "context_manifest", &manifest, &[], &[]).unwrap();
    tx.execute_batch(&guard).unwrap();
    tx.execute_batch(&profile).unwrap();
    let input = replacement_table_schema_v171(
        schema(&tx, "table", "agent_run_input").unwrap(),
        "agent_run_input",
    )
    .replace(INPUT, MAIN_INPUT);
    rebuild_table_v171(
        &tx,
        "agent_run_input",
        &input,
        &[],
        &["agent_run_input_v39_only_insert"],
    )
    .unwrap();
    let input=replacement_table_schema_v171(schema(&tx,"table","runtime_input_delivery").unwrap(),"runtime_input_delivery")
        .replace("UNIQUE(context_manifest_id, execution_epoch), UNIQUE(agent_run_id, execution_epoch, input_sequence)","UNIQUE(agent_run_id, execution_epoch)")
        .replace(", input_kind TEXT NOT NULL DEFAULT 'start' CHECK(input_kind IN ('start','steer'))","")
        .replace(", input_sequence INTEGER NOT NULL DEFAULT 0 CHECK(input_sequence>=0)","");
    rebuild_table_v171(
        &tx,
        "runtime_input_delivery",
        &input,
        &["input_kind", "input_sequence"],
        &[],
    )
    .unwrap();
    tx.execute_batch(&attachment).unwrap();
    tx.execute_batch("CREATE UNIQUE INDEX runtime_input_native_identity ON runtime_input_delivery(native_binding_id, native_input_id) WHERE native_input_id IS NOT NULL;
        CREATE TRIGGER agent_run_input_v38_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 38 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v38'); END;
        DELETE FROM schema_migration WHERE version=204; UPDATE rovai_data_contract SET projection_schema_version=153 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
pub(super) fn assert_upgrade(database: &mut Database) {
    let before = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
    let old_schema = schema(database.connection(), "table", "context_manifest").unwrap();
    database.connection().execute_batch("CREATE TEMP TRIGGER reject_steer_migration BEFORE INSERT ON schema_migration WHEN NEW.version=204 BEGIN SELECT RAISE(ABORT,'steer rollback fixture'); END;").unwrap();
    assert!(
        migrate(database)
            .unwrap_err()
            .to_string()
            .contains("steer rollback fixture")
    );
    assert_eq!(
        schema(database.connection(), "table", "context_manifest").unwrap(),
        old_schema
    );
    assert!(!database.schema_migration_applied(204).unwrap());
    database
        .connection()
        .execute_batch("DROP TRIGGER reject_steer_migration;")
        .unwrap();
    migrate(database).unwrap();
    database.migrate(false).unwrap();
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
            | DatabaseContractClassification::SupportedMigrationSource(_)
    ));
}

#[cfg(all(test, feature = "extended-tests"))]
pub(crate) fn assert_legacy_upgrade(database: &mut Database) {
    // Recreate the deployed branch 203 layout with populated input/receipt rows.
    // Only the fixture removes the compact columns; production converges forward.
    super::minimax::downgrade_for_test(database.connection());
    // Later additive migrations (for example the Hermes rules columns) append
    // nullable columns. The branch-203 contract is that every column of the
    // branch layout keeps its value, so compare exactly those columns.
    let branch_tables = [
        "context_manifest",
        "agent_run_input",
        "runtime_input_delivery",
        "camp_message_delivery",
        "agent_run_claim_context",
    ];
    let branch_columns = branch_tables
        .iter()
        .map(|table| {
            database
                .connection()
                .prepare(&format!("SELECT * FROM {table} LIMIT 0"))
                .unwrap()
                .column_names()
                .iter()
                .map(|name| format!("\"{name}\""))
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>();
    let branch_rows = |c: &Connection| -> Vec<Vec<Vec<rusqlite::types::Value>>> {
        branch_tables
            .iter()
            .zip(&branch_columns)
            .map(|(table, select)| {
                let mut q = c
                    .prepare(&format!("SELECT {select} FROM {table} ORDER BY 1"))
                    .unwrap();
                let count = q.column_count();
                q.query_map([], |r| {
                    (0..count)
                        .map(|i| r.get(i))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
            })
            .collect()
    };
    compact_execution::remove_compact_for_test(database.connection());
    database
        .connection()
        .execute_batch(
            "DELETE FROM schema_migration WHERE version=204;
        INSERT INTO schema_migration VALUES(203,'branch-203-preserved');
        UPDATE rovai_data_contract SET projection_schema_version=153 WHERE singleton=1;",
        )
        .unwrap();
    let branch_before = branch_rows(database.connection());
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==153)
    );
    assert_upgrade(database);
    assert_eq!(branch_rows(database.connection()), branch_before);
    assert_eq!(
        database
            .connection()
            .query_row(
                "SELECT applied_at FROM schema_migration WHERE version=203",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "branch-203-preserved"
    );
    database.migrate(false).unwrap();
    assert_eq!(branch_rows(database.connection()), branch_before);
    super::minimax::downgrade_for_test(database.connection());

    // Build the source schema with the actual old migration, not by assuming
    // that a marker number or a handful of columns implies the old contract.
    let directory = std::env::temp_dir().join(format!("rovai-steer-source-{}", Uuid::new_v4()));
    let mut template = crate::test_support::fresh_schema_database_fast_at(&directory);
    message_senders::downgrade_for_test(template.connection());
    super::steer_legacy_test::migrate(&mut template).unwrap();
    assert!(super::steer_legacy_test::schema_matches(
        template.connection()
    ));
    let tables = [
        "context_manifest",
        "agent_run_input",
        "runtime_input_delivery",
        "camp_message_delivery",
    ];
    let objects = |c: &Connection, table: &str| -> Vec<(String, String)> {
        c.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name=?1 AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").unwrap()
            .query_map([table],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = database.connection.unchecked_transaction().unwrap();
    tx.execute_batch("DROP TRIGGER context_manifest_version_immutable; DROP TRIGGER agent_run_input_context_projection_immutable;
        UPDATE context_manifest SET context_manifest_version=37,formatter_version=37 WHERE context_manifest_version=39;
        UPDATE agent_run_input SET context_manifest_version=37 WHERE context_manifest_version=39;
        DROP TRIGGER context_manifest_v39_only_insert;
        DELETE FROM schema_migration WHERE version>=203;").unwrap();
    tx.commit().unwrap();
    execution_storage::downgrade_for_test(database.connection());
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = database.connection.unchecked_transaction().unwrap();
    for table in tables {
        let old_objects = objects(&tx, table);
        let names = old_objects
            .iter()
            .map(|(n, _)| n.as_str())
            .collect::<Vec<_>>();
        let source = replacement_table_schema_v171(
            schema(template.connection(), "table", table).unwrap(),
            table,
        );
        rebuild_table_v171(&tx, table, &source, &[], &names).unwrap();
        for (_, sql) in objects(template.connection(), table) {
            tx.execute_batch(&sql).unwrap();
        }
    }
    tx.execute_batch("DELETE FROM schema_migration WHERE version>=203;")
        .unwrap();
    tx.commit().unwrap();
    execution_storage::downgrade_for_test(database.connection());
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .unwrap();
    assert!(legacy_schema_matches(database.connection()));
    assert!(
        matches!(classify_database_contract(database.connection()).unwrap(),DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==149)
    );
    let columns = tables
        .iter()
        .map(|table| {
            database
                .connection()
                .prepare(&format!("SELECT * FROM {table} LIMIT 0"))
                .unwrap()
                .column_names()
                .iter()
                .map(|n| format!("\"{n}\""))
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>();
    let snapshot = |c: &Connection| -> Vec<Vec<Vec<rusqlite::types::Value>>> {
        tables
            .iter()
            .zip(&columns)
            .map(|(table, select)| {
                let mut stmt = c
                    .prepare(&format!("SELECT {select} FROM {table} ORDER BY 1"))
                    .unwrap();
                let columns = stmt.column_count();
                stmt.query_map([], |row| {
                    (0..columns)
                        .map(|i| row.get(i))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
            })
            .collect()
    };
    let before = snapshot(database.connection());
    let claims: Vec<String> = database
        .connection()
        .prepare("SELECT context_json FROM agent_run_claim_context ORDER BY agent_run_id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    database.migrate(false).unwrap();
    assert_eq!(
        snapshot(database.connection()),
        before,
        "migration must preserve all legacy source, payload and receipt columns"
    );
    assert_eq!(
        database
            .connection()
            .prepare("SELECT context_json FROM agent_run_claim_context ORDER BY agent_run_id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap(),
        claims
    );
    assert!(matches!(
        classify_database_contract(database.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
    // An idempotent reopen does not acquire or replay any source.
    database.migrate(false).unwrap();
    assert_eq!(snapshot(database.connection()), before);
    drop(template);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    // Owns the two independently deployed 199 identities and partial-upgrade restart path.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn migration_sources_converge_without_reinterpreting_migration_199() {
        for source in [148, 149, 150, 151, 152, 153, 154] {
            let directory = std::env::temp_dir()
                .join(format!("rovai-steer-migration-{source}-{}", Uuid::new_v4()));
            let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
            super::minimax::downgrade_for_test(database.connection());
            match source {
                148 => message_senders::downgrade_for_test(database.connection()),
                149 => execution_storage::downgrade_for_test(database.connection()),
                150 => live_directory::downgrade_for_test(database.connection()),
                151 => unified_activity::downgrade_for_test(database.connection()),
                152 => compact_execution::downgrade_for_test(database.connection()),
                153 => downgrade_for_test(database.connection()),
                154 => super::minimax::downgrade_for_test(database.connection()),
                _ => {}
            }
            assert_eq!(
                database
                    .connection()
                    .query_row(
                        "SELECT projection_schema_version FROM rovai_data_contract",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                source
            );
            if source == 153 {
                let tx = database.connection_mut().transaction().unwrap();
                tx.execute_batch(
                    "ALTER TABLE context_manifest ADD COLUMN source_delivery_id TEXT;",
                )
                .unwrap();
                assert!(
                    matches!(
                        classify_database_contract(&tx).unwrap(),
                        DatabaseContractClassification::Unknown(_)
                    ),
                    "partial Steer columns must not become a main 203 source"
                );
                tx.rollback().unwrap();
            }
            database.migrate(false).unwrap();
            assert!(matches!(
                classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            assert!(database.schema_migration_applied(199).unwrap());
            assert!(database.schema_migration_applied(203).unwrap());
            assert!(database.schema_migration_applied(204).unwrap());
            drop(database);
            std::fs::remove_dir_all(directory).unwrap();
        }

        // One fixture owns partial-shape admission; repeating these deterministic
        // mutations for every source above would not cover an additional boundary.
        let directory =
            std::env::temp_dir().join(format!("rovai-steer-partial-migration-{}", Uuid::new_v4()));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        // These faults own the deployed Steer shape. Current Task-capability
        // admission reuses the same retained identity checks.
        super::minimax::downgrade_for_test(database.connection());
        for fault in [
            "compact_view",
            "compact_guard",
            "compact_no_copy",
            "compact_column",
            "steer_initial_index",
            "steer_source_index",
            "steer_native_index",
            "steer_source_nonunique",
            "steer_source_predicate",
            "steer_manifest_unique",
            "steer_sequence_unique",
            "combined_without_204",
            "branch_partial_compact_column",
        ] {
            let tx = database.connection_mut().transaction().unwrap();
            match fault {
                "compact_view" | "compact_guard" | "compact_no_copy" => {
                    let (kind, name, from, to) = match fault {
                        "compact_view" => (
                            "view",
                            "execution_activity",
                            "storage_version IN (3,4)",
                            "storage_version=3",
                        ),
                        "compact_guard" => (
                            "trigger",
                            "execution_evidence_storage_version_insert",
                            "1,2,3,4",
                            "1,2,3",
                        ),
                        _ => (
                            "trigger",
                            "execution_activity_no_copy",
                            "storage_version IN (3,4)",
                            "storage_version=3",
                        ),
                    };
                    let original = schema(&tx, kind, name).unwrap();
                    assert!(original.contains(from));
                    tx.execute_batch(&format!("DROP {kind} {name};")).unwrap();
                    tx.execute_batch(&original.replace(from, to)).unwrap();
                }
                "compact_column" => {
                    tx.execute_batch(
                        "ALTER TABLE agent_run_execution_evidence DROP COLUMN result_digest;",
                    )
                    .unwrap();
                }
                "steer_initial_index" => {
                    tx.execute_batch("DROP INDEX context_manifest_initial_run;")
                        .unwrap();
                }
                "steer_source_index" => {
                    tx.execute_batch("DROP INDEX context_manifest_source_delivery;")
                        .unwrap();
                }
                "steer_native_index" => {
                    tx.execute_batch("DROP INDEX runtime_input_initial_native_identity;")
                        .unwrap();
                }
                "steer_source_nonunique" | "steer_source_predicate" => {
                    let original =
                        schema(&tx, "index", "context_manifest_source_delivery").unwrap();
                    let replacement = if fault == "steer_source_nonunique" {
                        original.replace("UNIQUE INDEX", "INDEX")
                    } else {
                        original.replace("IS NOT NULL", "IS NULL")
                    };
                    assert_ne!(replacement, original);
                    tx.execute_batch("DROP INDEX context_manifest_source_delivery;")
                        .unwrap();
                    tx.execute_batch(&replacement).unwrap();
                }
                "steer_manifest_unique" | "steer_sequence_unique" => {
                    let original = schema(&tx, "table", "runtime_input_delivery").unwrap();
                    let clause = if fault == "steer_manifest_unique" {
                        "UNIQUE(context_manifest_id, execution_epoch), "
                    } else {
                        ", UNIQUE(agent_run_id, execution_epoch, input_sequence)"
                    };
                    assert!(original.contains(clause));
                    let replacement =
                        replacement_table_schema_v171(original, "runtime_input_delivery")
                            .replace(clause, "");
                    rebuild_table_v171(&tx, "runtime_input_delivery", &replacement, &[], &[])
                        .unwrap();
                }
                "combined_without_204" => {
                    tx.execute_batch("DELETE FROM schema_migration WHERE version=204; UPDATE rovai_data_contract SET projection_schema_version=153 WHERE singleton=1;").unwrap();
                }
                "branch_partial_compact_column" => {
                    compact_execution::remove_compact_for_test(&tx);
                    tx.execute_batch("INSERT INTO schema_migration VALUES(203,datetime('now')); DELETE FROM schema_migration WHERE version=204; UPDATE rovai_data_contract SET projection_schema_version=153 WHERE singleton=1;").unwrap();
                    assert!(
                        matches!(classify_database_contract(&tx).unwrap(), DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 153)
                    );
                    tx.execute_batch(
                        "ALTER TABLE agent_run_execution_evidence ADD COLUMN result_digest TEXT;",
                    )
                    .unwrap();
                }
                _ => unreachable!(),
            }
            assert!(
                matches!(
                    classify_database_contract(&tx).unwrap(),
                    DatabaseContractClassification::Unknown(_)
                ),
                "{fault} must fail closed"
            );
            tx.rollback().unwrap();
        }
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
