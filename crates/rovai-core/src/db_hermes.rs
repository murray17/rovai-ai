//! Add the Hermes catalog entries without changing existing Run/Session data.
use super::*;

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    for (tables, token) in [
        (&DSH_RUNTIME_TABLES[..], "'hermes-cli'"),
        (&DSH_SKILL_TABLES[..], "'hermes'"),
    ] {
        for table in tables {
            let sql: String = c.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |r| r.get(0),
            )?;
            if !sql.contains(token) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

pub(super) fn rewrite(tx: &Transaction<'_>, reverse: bool) -> Result<()> {
    let triggers = {
        let mut query = tx.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name")?;
        query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (name, _) in &triggers {
        tx.execute_batch(&format!("DROP TRIGGER \"{}\"", name.replace('"', "\"\"")))?;
    }
    for (tables, old, new) in [
        (
            &DSH_RUNTIME_TABLES[..],
            "'minimax-code-cli'",
            "'minimax-code-cli', 'hermes-cli'",
        ),
        (&DSH_SKILL_TABLES[..], "'minimax'", "'minimax', 'hermes'"),
    ] {
        for table in tables {
            expand_closed_set(
                tx,
                table,
                if reverse { new } else { old },
                if reverse { old } else { new },
            )?;
        }
    }
    for (_, sql) in triggers {
        tx.execute_batch(&sql)?;
    }
    Ok(())
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
            matches!(classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.contract_version == "v1.72" && marker.projection_schema_version == 163),
            "Hermes catalog migration requires v1.72/schema 163"
        );
        let tables: Vec<_> = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .collect();
        let counts = tables
            .iter()
            .map(|table| {
                tx.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| {
                    r.get::<_, i64>(0)
                })
            })
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rewrite(&tx, false)?;
        for (table, count) in tables.iter().zip(counts) {
            anyhow::ensure!(
                tx.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| r
                    .get::<_, i64>(0))?
                    == count,
                "Hermes catalog migration changed {table} rows"
            );
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(214,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=164,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 164
            ),
            "Hermes catalog migration failed schema admission"
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
pub(super) fn downgrade_for_test(c: &Connection) {
    downgrade_rules_for_test(c);
    let applied: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=214)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    if !applied {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    rewrite(&tx, true).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=214; UPDATE rovai_data_contract SET projection_schema_version=163 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

pub(super) fn rules_schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    for (name, kind) in [
        ("hermes_rules_envelope_version", "INTEGER"),
        ("hermes_rules_digest", "TEXT"),
        ("hermes_rules_delivery_kind", "TEXT"),
        ("hermes_runtime_payload_blob_id", "TEXT"),
    ] {
        let present: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('runtime_input_delivery')
             WHERE name=?1 AND type=?2 AND \"notnull\"=0 AND dflt_value IS NULL)",
            params![name, kind],
            |r| r.get(0),
        )?;
        if !present {
            return Ok(false);
        }
    }
    let foreign_key: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_list('runtime_input_delivery')
         WHERE \"from\"='hermes_runtime_payload_blob_id' AND \"table\"='managed_blob' AND \"to\"='id')",
        [], |r| r.get(0))?;
    let sql: String = c.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='runtime_input_delivery'",
        [],
        |r| r.get(0),
    )?;
    let sql: String = sql
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    Ok(foreign_key
        && sql.contains("check(hermes_rules_envelope_version=1)")
        && sql.contains(
            "check(hermes_rules_delivery_kindin('initial','update','compaction_recovery','none'))",
        ))
}

pub(super) fn migrate_rules(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 164),
        "Hermes rules migration requires schema 164"
    );
    tx.execute_batch("ALTER TABLE runtime_input_delivery ADD COLUMN hermes_rules_envelope_version INTEGER CHECK(hermes_rules_envelope_version = 1);
        ALTER TABLE runtime_input_delivery ADD COLUMN hermes_rules_digest TEXT;
        ALTER TABLE runtime_input_delivery ADD COLUMN hermes_rules_delivery_kind TEXT CHECK(hermes_rules_delivery_kind IN ('initial','update','compaction_recovery','none'));
        ALTER TABLE runtime_input_delivery ADD COLUMN hermes_runtime_payload_blob_id TEXT REFERENCES managed_blob(id);
        INSERT INTO schema_migration VALUES(215,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=165,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
        ),
        "Hermes rules schema failed admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_rules_for_test(c: &Connection) {
    if c.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=215)",
        [],
        |r| r.get::<_, bool>(0),
    )
    .unwrap()
    {
        c.execute_batch(
            "ALTER TABLE runtime_input_delivery DROP COLUMN hermes_rules_envelope_version;
            ALTER TABLE runtime_input_delivery DROP COLUMN hermes_rules_digest;
            ALTER TABLE runtime_input_delivery DROP COLUMN hermes_rules_delivery_kind;
            ALTER TABLE runtime_input_delivery DROP COLUMN hermes_runtime_payload_blob_id;
            DELETE FROM schema_migration WHERE version=215;
            UPDATE rovai_data_contract SET projection_schema_version=164 WHERE singleton=1;",
        )
        .unwrap();
    }
}

#[cfg(test)]
mod rules_tests {
    use super::*;
    #[test]
    fn rules_migration_preserves_data_and_rolls_back_with_receipt() {
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        downgrade_rules_for_test(database.connection());
        let before: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_profile", [], |r| r.get(0))
            .unwrap();
        database.connection().execute_batch("CREATE TEMP TRIGGER fail_rules_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=215 BEGIN SELECT RAISE(ABORT,'rules rollback'); END;").unwrap();
        assert!(
            migrate_rules(&mut database)
                .unwrap_err()
                .to_string()
                .contains("rules rollback")
        );
        assert!(!rules_schema_matches(database.connection()).unwrap());
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::SupportedMigrationSource(_)
        ));
        database
            .connection()
            .execute_batch("DROP TRIGGER fail_rules_receipt")
            .unwrap();
        migrate_rules(&mut database).unwrap();
        assert!(rules_schema_matches(database.connection()).unwrap());
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM agent_profile", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            before
        );
        assert_eq!(database.connection().query_row("SELECT COUNT(*) FROM runtime_input_delivery WHERE hermes_rules_envelope_version IS NOT NULL", [], |r|r.get::<_,i64>(0)).unwrap(), 0);
        drop(database);
        drop(Database::open(&directory).unwrap());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
