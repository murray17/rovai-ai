//! Team templates and immutable Thread startup text; old input evidence stays byte-for-byte.
use super::*;

const CONTRACT5: &str = "contract_version IN ('native_session_bootstrap_v3', 'native_session_bootstrap_v4', 'native_session_bootstrap_v5')";
const CONTRACT6: &str = "(contract_version IN ('native_session_bootstrap_v3', 'native_session_bootstrap_v4', 'native_session_bootstrap_v5') OR contract_version = 'native_session_bootstrap_v6')";
const FORMAT5: &str = "bootstrap_formatter_version IN (3, 4, 5)";
const FORMAT6: &str =
    "(bootstrap_formatter_version IN (3, 4, 5) OR bootstrap_formatter_version = 6)";
const GUARD: &str = "native_session_bootstrap_evidence_v5_only_insert";

fn schema(c: &Connection, kind: &str, name: &str) -> rusqlite::Result<String> {
    c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(single_chat_facts::schema_matches(c)?
        && schema(c, "table", "team").is_ok_and(|s| s.contains("CHECK(version >= 1)") && s.contains("json_valid(roster_json)"))
        && schema(c, "table", "creation_preferences").is_ok_and(|s| s.contains("json_valid(state_json)"))
        && schema(c, "table", "thread_team_bootstrap").is_ok_and(|s| s.contains("REFERENCES camp(id) ON DELETE CASCADE") && s.contains("length(guidance) BETWEEN 1 AND 1000"))
        && schema(c, "trigger", "thread_team_bootstrap_immutable").is_ok_and(|s| s.contains("RAISE(ABORT"))
        && schema(c, "table", "native_session_bootstrap_evidence").is_ok_and(|s| s.contains(CONTRACT6) && s.contains(FORMAT6))
        && schema(c, "trigger", GUARD).is_ok_and(|s| s.contains("NEW.contract_version = 'native_session_bootstrap_v6' AND NEW.bootstrap_formatter_version = 6")))
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
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==162),
            "Teams require schema 162"
        );
        let old = schema(&tx, "table", "native_session_bootstrap_evidence")?;
        anyhow::ensure!(
            old.contains(CONTRACT5) && old.contains(FORMAT5),
            "Unsupported Bootstrap schema"
        );
        let next = replacement_table_schema_v171(old, "native_session_bootstrap_evidence")
            .replace(CONTRACT5, CONTRACT6)
            .replace(FORMAT5, FORMAT6);
        rebuild_table_v171(
            &tx,
            "native_session_bootstrap_evidence",
            &next,
            &[],
            &[GUARD],
        )?;
        tx.execute_batch("CREATE TRIGGER native_session_bootstrap_evidence_v5_only_insert
            BEFORE INSERT ON native_session_bootstrap_evidence
            WHEN (NEW.contract_version IS NOT 'native_session_bootstrap_v5' OR NEW.bootstrap_formatter_version IS NOT 5)
                AND NOT (NEW.contract_version = 'native_session_bootstrap_v6' AND NEW.bootstrap_formatter_version = 6)
            BEGIN SELECT RAISE(ABORT, 'invalid Bootstrap version pair'); END;
            CREATE TABLE team(
                id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
                roster_json TEXT NOT NULL CHECK(json_valid(roster_json)),
                guidance TEXT NOT NULL CHECK(length(guidance)<=1000),
                version INTEGER NOT NULL CHECK(version >= 1), created_at TEXT NOT NULL
            );
            CREATE TABLE creation_preferences(
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                state_json TEXT NOT NULL CHECK(json_valid(state_json))
            );
            CREATE TABLE thread_team_bootstrap(
                camp_id TEXT PRIMARY KEY REFERENCES camp(id) ON DELETE CASCADE,
                guidance TEXT NOT NULL CHECK(length(guidance) BETWEEN 1 AND 1000)
            );
            CREATE TRIGGER thread_team_bootstrap_immutable BEFORE UPDATE ON thread_team_bootstrap
                BEGIN SELECT RAISE(ABORT, 'Thread startup text is immutable'); END;
            INSERT INTO schema_migration VALUES(213,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=163,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &["native_session_bootstrap_evidence", "thread_team_bootstrap"],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version == 163
            ),
            "Team schema admission failed"
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
    super::hermes::downgrade_for_test(c);
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=213)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    // Migration fixtures without Team text can retain the previous Bootstrap pair.
    tx.execute_batch("UPDATE native_session_bootstrap_evidence SET contract_version='native_session_bootstrap_v5',bootstrap_formatter_version=5 WHERE contract_version='native_session_bootstrap_v6';").unwrap();
    let next = replacement_table_schema_v171(
        schema(&tx, "table", "native_session_bootstrap_evidence").unwrap(),
        "native_session_bootstrap_evidence",
    )
    .replace(CONTRACT6, CONTRACT5)
    .replace(FORMAT6, FORMAT5);
    rebuild_table_v171(
        &tx,
        "native_session_bootstrap_evidence",
        &next,
        &[],
        &[GUARD],
    )
    .unwrap();
    tx.execute_batch("CREATE TRIGGER native_session_bootstrap_evidence_v5_only_insert BEFORE INSERT ON native_session_bootstrap_evidence
        WHEN NEW.contract_version IS NOT 'native_session_bootstrap_v5' OR NEW.bootstrap_formatter_version IS NOT 5
        BEGIN SELECT RAISE(ABORT, 'new Bootstrap evidence must use v5'); END;
        DROP TABLE thread_team_bootstrap; DROP TABLE creation_preferences; DROP TABLE team;
        DELETE FROM schema_migration WHERE version=213;
        UPDATE rovai_data_contract SET projection_schema_version=162 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}
