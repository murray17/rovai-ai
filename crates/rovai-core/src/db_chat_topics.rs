use super::*;

const LEGACY_CAMP: &str = "camp_id TEXT NOT NULL REFERENCES camp(id)";
const CHAT_CAMP: &str = "camp_id TEXT REFERENCES camp(id)";
const LEGACY_KINDS: &str = "kind IN ('camp_member', 'single_chat')";
const CHAT_KINDS: &str =
    "kind IN ('camp_member', 'single_chat', 'chat') AND ((kind = 'chat') = (camp_id IS NULL))";
const LEGACY_OPEN: &str = "(kind = 'camp_member'\n                        AND ended_at IS NULL";
const CHAT_OPEN: &str =
    "(kind IN ('camp_member', 'chat')\n                        AND ended_at IS NULL";

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT (SELECT count(*) FROM sqlite_schema WHERE name IN
                    ('chat_topic','chat_topic_recent','chat_topic_kind_insert',
                     'chat_topic_identity_immutable','chat_conversation_identity_immutable',
                     'conversation_agent_reply_sequence'))=6
            AND EXISTS(SELECT 1 FROM pragma_table_info('conversation')
                        WHERE name='camp_id' AND [notnull]=0)",
        [],
        |row| row.get(0),
    )
}

fn rebuild_conversation(tx: &Transaction<'_>, enable_chat: bool) -> Result<()> {
    let mut ddl: String = tx.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='conversation'",
        [],
        |row| row.get(0),
    )?;
    for (before, after) in [
        (LEGACY_CAMP, CHAT_CAMP),
        (LEGACY_KINDS, CHAT_KINDS),
        (LEGACY_OPEN, CHAT_OPEN),
    ] {
        let (from, to) = if enable_chat {
            (before, after)
        } else {
            (after, before)
        };
        anyhow::ensure!(
            ddl.matches(from).count() == 1,
            "Unexpected Conversation schema for chat topics"
        );
        ddl = ddl.replacen(from, to, 1);
    }
    rebuild_table_v171(
        tx,
        "conversation",
        &replacement_table_schema_v171(ddl, "conversation"),
        &[],
        &[],
    )
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
            DatabaseContractClassification::SupportedMigrationSource(m) if m.projection_schema_version == 182),
            "Chat topics require schema 182"
        );
        rebuild_conversation(&tx, true)?;
        tx.execute_batch(include_str!("db_chat_topics.sql"))?;
        validate_migration_foreign_keys(&tx, &["conversation", "chat_topic"])?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(233,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=183,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(schema_matches(&tx)?, "Chat topic schema was not installed");
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
    super::chat_inputs::downgrade_for_test(c);
    if !schema_matches(c).unwrap() {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER chat_conversation_identity_immutable;
        DROP TABLE chat_topic; DROP INDEX conversation_agent_reply_sequence;",
    )
    .unwrap();
    rebuild_conversation(&tx, false).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=233;
        UPDATE rovai_data_contract SET projection_schema_version=182 WHERE singleton=1 AND projection_schema_version=183;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}
