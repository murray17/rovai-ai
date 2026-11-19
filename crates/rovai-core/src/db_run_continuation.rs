//! A continuation is an authorized input source on the existing Delivery, not a second queue.
use super::*;

const MESSAGE_REFERENCE: &str =
    "message_id TEXT NOT NULL REFERENCES camp_message(id) ON DELETE CASCADE,";
const REQUEST_REFERENCE: &str = "message_id TEXT REFERENCES camp_message(id) ON DELETE CASCADE,
                    source_kind TEXT NOT NULL DEFAULT 'message' CHECK(
                        (source_kind = 'message' AND message_id IS NOT NULL)
                        OR (source_kind = 'continuation' AND message_id IS NULL)),";
const REQUEST_GUARDS: &[(&str, &str)] = &[
    (
        "camp_delivery_source_immutable",
        "CREATE TRIGGER camp_delivery_source_immutable
        BEFORE UPDATE OF source_kind,message_id ON camp_message_delivery
        WHEN NEW.source_kind IS NOT OLD.source_kind OR NEW.message_id IS NOT OLD.message_id
        BEGIN SELECT RAISE(ABORT, 'Delivery source is immutable'); END",
    ),
    (
        "camp_continuation_source_kind",
        "CREATE TRIGGER camp_continuation_source_kind
        BEFORE INSERT ON camp_run_continuation
        WHEN NOT EXISTS(SELECT 1 FROM camp_message_delivery WHERE id=NEW.delivery_id
            AND source_kind='continuation' AND message_id IS NULL)
        BEGIN SELECT RAISE(ABORT, 'Continuation requires an internal Delivery'); END",
    ),
];

pub(super) fn request_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    let shape: bool = connection.query_row("SELECT
        EXISTS(SELECT 1 FROM pragma_table_info('camp') WHERE name='last_delivery_sequence'
            AND type='INTEGER' AND [notnull]=1 AND dflt_value='0')
        AND EXISTS(SELECT 1 FROM pragma_table_info('camp_message_delivery') WHERE name='message_id' AND [notnull]=0)
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='camp_message_delivery' AND instr(sql,?1)>0)",
        [REQUEST_REFERENCE], |row| row.get(0))?;
    if !shape {
        return Ok(false);
    }
    for (name, sql) in REQUEST_GUARDS {
        let actual: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        let normalize = |value: &str| value.split_whitespace().collect::<String>();
        if actual.as_deref().map(normalize) != Some(normalize(sql)) {
            return Ok(false);
        }
    }
    Ok(true)
}

// Main's receipt 188 introduced internal requests; Preview's same receipt owns
// the direct-reply index/catalog. Reject partial request shapes in either lineage.
pub(super) fn request_source_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    if request_schema_matches(connection)? {
        return Ok(true);
    }
    connection.query_row("SELECT
        NOT EXISTS(SELECT 1 FROM pragma_table_info('camp') WHERE name='last_delivery_sequence')
        AND NOT EXISTS(SELECT 1 FROM pragma_table_info('camp_message_delivery') WHERE name='source_kind')
        AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name IN ('camp_delivery_source_immutable','camp_continuation_source_kind'))
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='camp_message_delivery' AND instr(sql,?1)>0)",
        [MESSAGE_REFERENCE], |row| row.get(0))
}

/// Changes only the queue's source model. Published messages and frozen evidence
/// are retained, including the old operation records from development builds.
pub(super) fn migrate_requests(database: &mut Database) -> Result<()> {
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
                if marker.contract_version=="v1.72" && marker.projection_schema_version==139),
            "Continuation requests require v1.72/schema 139"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        // Main/138 already has internal requests but lacks both deferred ACP
        // identities. Converge the catalog without replacing its receipt 188.
        if !cline_runtime_v184_schema_matches(&tx)? {
            rewrite_cline_runtime_closed_sets(&tx, false)?;
        }
        if !command_code_runtime_v185_schema_matches(&tx)? {
            rewrite_command_code_runtime_closed_sets(&tx, false)?;
        }
        if !request_schema_matches(&tx)? {
            let source: String = tx.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='camp_message_delivery'",
                [],
                |r| r.get(0),
            )?;
            anyhow::ensure!(
                source.contains(MESSAGE_REFERENCE),
                "Missing message Delivery source constraint"
            );
            let target = replacement_table_schema_v171(source, "camp_message_delivery")
                .replace(MESSAGE_REFERENCE, REQUEST_REFERENCE);
            rebuild_table_v171(&tx, "camp_message_delivery", &target, &[], &[])?;
            tx.execute_batch("ALTER TABLE camp ADD COLUMN last_delivery_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_delivery_sequence>=0);
            UPDATE camp SET last_delivery_sequence=COALESCE((SELECT MAX(queue_sequence) FROM camp_message_delivery WHERE camp_id=camp.id),0);
            UPDATE camp_message_delivery SET message_id=NULL,source_kind='continuation'
                WHERE EXISTS(SELECT 1 FROM camp_run_continuation WHERE delivery_id=camp_message_delivery.id);")?;
            for (_, sql) in REQUEST_GUARDS {
                tx.execute_batch(sql)?;
            }
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(190,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=140,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            public_history_claim_preserved_evidence_digest(&tx)? == before,
            "Continuation request migration changed frozen evidence"
        );
        let tables = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .chain([
                "camp_message_delivery",
                "camp_run_continuation",
                "agent_run_input",
            ])
            .collect::<Vec<_>>();
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(_)
            ),
            "Continuation request schema admission failed"
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
pub(super) fn downgrade_requests_for_test(connection: &Connection) {
    member_environment::downgrade_for_test(connection);
    if !connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=190)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER camp_delivery_source_immutable; DROP TRIGGER camp_continuation_source_kind;",
    )
    .unwrap();
    let source: String = tx
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='camp_message_delivery'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let target = replacement_table_schema_v171(source, "camp_message_delivery")
        .replace(REQUEST_REFERENCE, MESSAGE_REFERENCE);
    rebuild_table_v171(&tx, "camp_message_delivery", &target, &["source_kind"], &[]).unwrap();
    tx.execute_batch(
        "ALTER TABLE camp DROP COLUMN last_delivery_sequence;
        DELETE FROM schema_migration WHERE version=190;
        UPDATE rovai_data_contract SET projection_schema_version=139 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

const OBJECTS: &[(&str, &str)] = &[
    ("camp_run_continuation", "CREATE TABLE camp_run_continuation (
        delivery_id TEXT PRIMARY KEY REFERENCES camp_message_delivery(id) ON DELETE CASCADE,
        source_agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
        use_new_session INTEGER NOT NULL CHECK(use_new_session IN (0,1))
    )"),
    ("camp_run_continuation_immutable", "CREATE TRIGGER camp_run_continuation_immutable
        BEFORE UPDATE ON camp_run_continuation BEGIN SELECT RAISE(ABORT, 'continuation authorization is immutable'); END"),
    ("agent_run_input_delivery_idx", "CREATE INDEX agent_run_input_delivery_idx ON agent_run_input(delivery_id)"),
    ("agent_run_input_delivery_owner", "CREATE TRIGGER agent_run_input_delivery_owner
        BEFORE INSERT ON agent_run_input WHEN EXISTS (
            SELECT 1 FROM agent_run_input AS prior WHERE prior.delivery_id=NEW.delivery_id
              AND (prior.agent_run_id<>NEW.agent_run_id OR NOT EXISTS (
                  SELECT 1 FROM camp_run_continuation WHERE delivery_id=NEW.delivery_id))
        ) BEGIN SELECT RAISE(ABORT, 'Delivery input belongs to one authorized Run'); END"),
];

const ORDINARY_INPUT_OWNER: &str = "CREATE TRIGGER agent_run_input_delivery_owner
    BEFORE INSERT ON agent_run_input WHEN EXISTS (
        SELECT 1 FROM agent_run_input WHERE delivery_id=NEW.delivery_id
    ) BEGIN SELECT RAISE(ABORT, 'Delivery already has a frozen input'); END";

pub(super) fn retired_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row("SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema
        WHERE name IN ('camp_run_continuation','camp_run_continuation_input','continuation_waiting_authorization'))
        AND NOT EXISTS(SELECT 1 FROM pragma_table_info('camp_message_delivery') WHERE name='continuation_authorization_id')
        AND EXISTS(SELECT 1 FROM sqlite_schema WHERE name='agent_run_input_delivery_owner' AND sql=?1)",
        [ORDINARY_INPUT_OWNER], |row| row.get(0))
}

pub(super) fn retire(db: &mut Database) -> Result<()> {
    let tx = db
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?,
        DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==180),
        "Ordinary redelivery requires schema 180"
    );
    let now = chrono::Utc::now().to_rfc3339();
    {
        let mut waiting = tx.prepare("SELECT d.camp_id, i.message_id, d.recipient_agent_id
            FROM camp_run_continuation_input i
            JOIN camp_message_delivery d ON d.id=i.delivery_id
            JOIN camp t ON t.id=d.camp_id AND t.deletion_operation_id IS NULL AND t.archived_at IS NULL
            JOIN camp_message m ON m.id=i.message_id AND m.camp_id=d.camp_id
            JOIN camp_member member ON member.camp_id=d.camp_id AND member.agent_id=d.recipient_agent_id
            JOIN agent_profile p ON p.id=member.agent_id
            WHERE d.status='waiting' AND d.source_kind='continuation'
              AND m.tombstoned_at IS NULL AND m.recall_state<>'withdrawn' AND m.content_revision=i.content_revision
              AND member.status='active' AND member.leave_requested_at IS NULL AND p.profile_status='present'
              AND NOT EXISTS(SELECT 1 FROM mission WHERE camp_id=d.camp_id AND status='completed')
            ORDER BY d.camp_id,d.queue_sequence,d.id,i.ordinal")?;
        let inputs = waiting
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (thread, message, recipient) in inputs {
            crate::delivery_queue::enqueue_message_if_absent(
                &tx, &thread, &message, &recipient, &now,
            )?;
        }
    }
    tx.execute("UPDATE camp_message_delivery SET status='cancelled',failure_code='continuation_converted',
        ended_at=?1,updated_at=?1,version=version+1 WHERE source_kind='continuation' AND status='waiting'",[&now])?;
    tx.execute_batch(
        "DROP TRIGGER agent_run_input_delivery_owner;
        DROP TRIGGER camp_run_continuation_immutable;
        DROP TABLE camp_run_continuation_input;
        DROP TABLE camp_run_continuation;
        DROP INDEX continuation_waiting_authorization;
        ALTER TABLE camp_message_delivery DROP COLUMN continuation_authorization_id;",
    )?;
    tx.execute_batch(ORDINARY_INPUT_OWNER)?;
    tx.execute_batch("INSERT INTO schema_migration VALUES(231,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=181,updated_at=datetime('now') WHERE singleton=1;")?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::Current(_)
        ),
        "Ordinary redelivery failed schema admission"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn restore_requests_for_test(c: &Connection) {
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=231)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    let tx = c.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER agent_run_input_delivery_owner;
        ALTER TABLE camp_message_delivery ADD COLUMN continuation_authorization_id TEXT;",
    )
    .unwrap();
    for (name, sql) in OBJECTS {
        if *name != "agent_run_input_delivery_idx" {
            tx.execute_batch(sql).unwrap();
        }
    }
    tx.execute_batch(REQUEST_GUARDS[1].1).unwrap();
    tx.execute_batch(message_mutations::CONTINUATION_INPUT_SCHEMA)
        .unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=231;
        UPDATE rovai_data_contract SET projection_schema_version=180 WHERE singleton=1 AND projection_schema_version=181;").unwrap();
    tx.commit().unwrap();
}

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    for (name, expected) in OBJECTS {
        let actual: Option<String> = connection
            .query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| {
                r.get(0)
            })
            .optional()?;
        let normalize = |sql: &str| sql.split_whitespace().collect::<String>();
        if actual.as_deref().map(normalize) != Some(normalize(expected)) {
            return Ok(false);
        }
    }
    let input: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
        [],
        |r| r.get(0),
    )?;
    Ok(!input.contains("delivery_id TEXT NOT NULL UNIQUE"))
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
            matches!(classify_database_contract(&tx)?,DatabaseContractClassification::SupportedMigrationSource(ref marker)
            if marker.contract_version=="v1.72" && marker.projection_schema_version==135),
            "Run continuation requires v1.72/schema 135"
        );
        let before = public_history_claim_preserved_evidence_digest(&tx)?;
        // Main/135 owns structured Mission descriptions instead of the Preview
        // catalog. Converge both catalog entries without touching those rows.
        if !cline_runtime_v184_schema_matches(&tx)? {
            rewrite_cline_runtime_closed_sets(&tx, false)?;
        }
        if !command_code_runtime_v185_schema_matches(&tx)? {
            rewrite_command_code_runtime_closed_sets(&tx, false)?;
        }
        // The main/134 branch already owns this exact schema. Preserve it;
        // Preview/135 adds it here. Both advance with one transactional receipt.
        if !schema_matches(&tx)? {
            let source: String = tx.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
                [],
                |r| r.get(0),
            )?;
            anyhow::ensure!(
                source.contains("delivery_id TEXT NOT NULL UNIQUE"),
                "Missing original Delivery uniqueness constraint"
            );
            let target = replacement_table_schema_v171(source, "agent_run_input").replace(
                "delivery_id TEXT NOT NULL UNIQUE",
                "delivery_id TEXT NOT NULL",
            );
            rebuild_table_v171(&tx, "agent_run_input", &target, &[], &[])?;
            for (_, sql) in OBJECTS {
                tx.execute_batch(sql)?;
            }
        }
        tx.execute_batch("INSERT INTO schema_migration VALUES(186,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=136,updated_at=datetime('now') WHERE singleton=1;")?;
        anyhow::ensure!(
            before == public_history_claim_preserved_evidence_digest(&tx)?,
            "Continuation migration changed existing model evidence"
        );
        let tables = DSH_RUNTIME_TABLES
            .iter()
            .chain(DSH_SKILL_TABLES.iter())
            .copied()
            .chain(["agent_run_input", "camp_run_continuation"])
            .collect::<Vec<_>>();
        validate_migration_foreign_keys(&tx, &tables)?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.projection_schema_version==136
            ),
            "Continuation schema admission failed"
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
pub(super) fn downgrade_for_test(connection: &Connection) {
    mission_description::downgrade_for_test(connection);
    if !connection
        .table_exists(None, "camp_run_continuation")
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    tx.execute_batch(
        "DROP TRIGGER camp_run_continuation_immutable; DROP TRIGGER agent_run_input_delivery_owner;
        DROP INDEX agent_run_input_delivery_idx; DROP TABLE camp_run_continuation;",
    )
    .unwrap();
    let source: String = tx
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_run_input'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let target = replacement_table_schema_v171(source, "agent_run_input").replace(
        "delivery_id TEXT NOT NULL",
        "delivery_id TEXT NOT NULL UNIQUE",
    );
    rebuild_table_v171(&tx, "agent_run_input", &target, &[], &[]).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version=186; UPDATE rovai_data_contract SET projection_schema_version=135 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

// Reuse the populated queue owner to exercise the legacy source conversion.
#[cfg(all(test, feature = "extended-tests"))]
pub(crate) fn assert_request_upgrade(
    database: &mut Database,
    thread: &str,
    run: &str,
    legacy: bool,
) {
    let sources = [
        ("request-1", "legacy-operation-1"),
        ("request-2", "legacy-operation-2"),
    ];
    let c = database.connection();
    restore_requests_for_test(c);
    for (id, _) in sources {
        let seq: i64=c.query_row("UPDATE camp SET last_delivery_sequence=last_delivery_sequence+1 WHERE id=?1 RETURNING last_delivery_sequence",[thread],|r|r.get(0)).unwrap();
        c.execute("INSERT INTO camp_message_delivery(id,camp_id,source_kind,recipient_agent_id,
                recipient_membership_version_at_admission,queue_sequence,status,version,created_at,updated_at,continuation_authorization_id)
                VALUES(?1,?2,'continuation','agent_1',1,?3,'waiting',1,datetime('now'),datetime('now'),?1)",params![id,thread,seq]).unwrap();
        c.execute(
            "INSERT INTO camp_run_continuation VALUES(?1,?2,0)",
            params![id, run],
        )
        .unwrap();
        c.execute("INSERT INTO camp_run_continuation_input SELECT ?1,message_id,ordinal,message_content_revision
            FROM agent_run_input WHERE agent_run_id=?2",params![id,run]).unwrap();
    }
    if !legacy {
        c.execute(
            "DELETE FROM camp_run_continuation_input WHERE message_id='a'",
            [],
        )
        .unwrap();
        // Before retirement a claimed request could own several frozen inputs.
        c.execute("INSERT INTO camp_message_delivery(
            id,camp_id,source_kind,recipient_agent_id,recipient_membership_version_at_admission,
            queue_sequence,status,version,claimed_agent_run_id,created_at,updated_at,claimed_at,ended_at)
            SELECT 'historical-retry',camp_id,'continuation',recipient_agent_id,recipient_membership_version_at_admission,
                queue_sequence+1,'cancelled',1,?1,created_at,updated_at,created_at,updated_at FROM camp_message_delivery WHERE id='request-2'",[run]).unwrap();
        c.execute(
            "UPDATE camp SET last_delivery_sequence=last_delivery_sequence+1 WHERE id=?1",
            [thread],
        )
        .unwrap();
        c.execute(
            "INSERT INTO camp_run_continuation VALUES('historical-retry',?1,0)",
            [run],
        )
        .unwrap();
        c.execute(
            "UPDATE agent_run_input SET delivery_id='historical-retry' WHERE agent_run_id=?1",
            [run],
        )
        .unwrap();
        // The effective lists of the two requests overlap an existing ordinary wait.
        let tx = c.unchecked_transaction().unwrap();
        let reused = crate::delivery_queue::enqueue_message_if_absent(
            &tx,
            thread,
            "b",
            "agent_1",
            "2026-11-19T00:00:00Z",
        )
        .unwrap()
        .unwrap();
        tx.commit().unwrap();
        c.execute_batch(
            "CREATE TEMP TRIGGER fail_retire BEFORE INSERT ON schema_migration WHEN NEW.version=231
            BEGIN SELECT RAISE(ABORT,'fixture'); END;",
        )
        .unwrap();
        assert!(retire(database).is_err());
        let c = database.connection();
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM camp_run_continuation_input",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            4
        );
        c.execute_batch("DROP TRIGGER fail_retire").unwrap();
        retire(database).unwrap();
        let c = database.connection();
        assert!(retired_schema_matches(c).unwrap());
        let rows=c.prepare("SELECT id,message_id FROM camp_message_delivery WHERE status='waiting' ORDER BY queue_sequence").unwrap()
            .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
        assert_eq!(c.query_row("SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id=?1 AND delivery_id='historical-retry'",[run],|r|r.get::<_,i64>(0)).unwrap(),3);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (reused, "b".into()));
        assert_eq!(rows[1].1, "c");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM camp_message_delivery WHERE status='cancelled' AND failure_code='continuation_converted'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        return;
    }
    let connection = database.connection();
    connection
        .execute_batch("DROP TRIGGER camp_delivery_source_immutable")
        .unwrap();
    for (delivery, message) in sources {
        connection
            .execute(
                "UPDATE camp_message_delivery SET source_kind='message',message_id=?2 WHERE id=?1",
                params![delivery, message],
            )
            .unwrap();
    }
    connection.execute_batch(REQUEST_GUARDS[0].1).unwrap();
    downgrade_requests_for_test(connection);
    let before = public_history_claim_preserved_evidence_digest(connection).unwrap();
    let messages = |connection: &Connection| -> Vec<String> {
        connection.prepare("SELECT json_object('id',id,'body',body,'content',structured_content_json,'sequence',sequence,'tombstone',tombstoned_at,'version',version) FROM camp_message ORDER BY id")
            .unwrap().query_map([],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    let old_messages = messages(connection);
    let public_tail: i64 = connection
        .query_row("SELECT SUM(last_message_sequence) FROM camp", [], |r| {
            r.get(0)
        })
        .unwrap();
    migrate_requests(database).unwrap();
    let connection = database.connection();
    assert_eq!(messages(connection), old_messages);
    assert_eq!(
        public_history_claim_preserved_evidence_digest(connection).unwrap(),
        before
    );
    assert_eq!(
        connection
            .query_row("SELECT SUM(last_message_sequence) FROM camp", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        public_tail
    );
    for (delivery, _) in sources {
        assert!(connection.query_row("SELECT source_kind='continuation' AND message_id IS NULL FROM camp_message_delivery WHERE id=?1",[delivery],|r|r.get::<_,bool>(0)).unwrap());
    }
    assert!(connection.query_row("SELECT NOT EXISTS(SELECT 1 FROM camp WHERE last_delivery_sequence<>COALESCE((SELECT MAX(queue_sequence) FROM camp_message_delivery WHERE camp_id=camp.id),0))",[],|r|r.get::<_,bool>(0)).unwrap());
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns schema 135 -> 136 and 139 -> 140: a failure after
    // rebuilding the table must restore both evidence and schema atomically.
    #[test]
    fn continuation_migration_rolls_back_and_preserves_frozen_evidence() {
        for main_source in [false, true] {
            let (mut database, directory) = crate::test_support::seeded_runtime_database();
            database.connection().execute_batch(
                "UPDATE schema_migration SET applied_at='2026-10-01T00:00:00Z' WHERE version=188;").unwrap();
            if main_source {
                member_environment::downgrade_for_test(database.connection());
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=OFF")
                    .unwrap();
                let tx = database.connection().unchecked_transaction().unwrap();
                rewrite_command_code_runtime_closed_sets(&tx, true).unwrap();
                rewrite_cline_runtime_closed_sets(&tx, true).unwrap();
                tx.execute_batch("DELETE FROM schema_migration WHERE version IN (189,190);
                    UPDATE rovai_data_contract SET projection_schema_version=138 WHERE singleton=1;").unwrap();
                tx.commit().unwrap();
                database
                    .connection()
                    .execute_batch("PRAGMA foreign_keys=ON")
                    .unwrap();
                assert!(
                    matches!(classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(ref marker)
                        if marker.projection_schema_version == 138)
                );
                database
                    .connection()
                    .execute_batch(
                        "SAVEPOINT partial_request;
                    DROP TRIGGER camp_continuation_source_kind;",
                    )
                    .unwrap();
                assert!(!matches!(
                    classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(_)
                ));
                database
                    .connection()
                    .execute_batch("ROLLBACK TO partial_request; RELEASE partial_request")
                    .unwrap();
                let before =
                    public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
                message_mentions::migrate(&mut database).unwrap();
                assert_eq!(
                    before,
                    public_history_claim_preserved_evidence_digest(database.connection()).unwrap()
                );
            } else {
                downgrade_requests_for_test(database.connection());
                database
                    .connection()
                    .execute_batch(
                        "SAVEPOINT partial_request;
                    ALTER TABLE camp ADD COLUMN last_delivery_sequence INTEGER NOT NULL DEFAULT 0;",
                    )
                    .unwrap();
                assert!(!matches!(
                    classify_database_contract(database.connection()).unwrap(),
                    DatabaseContractClassification::SupportedMigrationSource(_)
                ));
                database
                    .connection()
                    .execute_batch("ROLLBACK TO partial_request; RELEASE partial_request")
                    .unwrap();
            }
            let before =
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
            let request_schema: String = database
                .connection()
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name='camp_message_delivery'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            database.connection().execute_batch("CREATE TRIGGER reject_request_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=190 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
            assert!(migrate_requests(&mut database).is_err());
            assert!(!database.schema_migration_applied(190).unwrap());
            assert_eq!(
                request_schema_matches(database.connection()).unwrap(),
                main_source
            );
            assert_eq!(
                command_code_runtime_v185_schema_matches(database.connection()).unwrap(),
                !main_source
            );
            assert_eq!(
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
                before
            );
            assert_eq!(
                database
                    .connection()
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE name='camp_message_delivery'",
                        [],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                request_schema
            );
            assert_eq!(
                database
                    .connection()
                    .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            database
                .connection()
                .execute_batch("DROP TRIGGER reject_request_receipt")
                .unwrap();
            migrate_requests(&mut database).unwrap();
            assert!(request_schema_matches(database.connection()).unwrap());
            assert!(command_code_runtime_v185_schema_matches(database.connection()).unwrap());
            assert_eq!(
                public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
                before
            );
            let receipt: String = database
                .connection()
                .query_row(
                    "SELECT applied_at FROM schema_migration WHERE version=188",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(receipt, "2026-10-01T00:00:00Z");
            drop(database);
            let database = Database::open(&directory).unwrap();
            assert!(matches!(
                classify_database_contract(database.connection()).unwrap(),
                DatabaseContractClassification::Current(_)
            ));
            drop(database);
            std::fs::remove_dir_all(directory).unwrap();
        }
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        downgrade_for_test(database.connection());
        let before = public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
        let schema: String = database
            .connection()
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='agent_run_input'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        database.connection().execute_batch("CREATE TRIGGER reject_continuation_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=186 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        assert!(migrate(&mut database).is_err());
        assert!(!database.schema_migration_applied(186).unwrap());
        assert!(
            !database
                .connection()
                .table_exists(None, "camp_run_continuation")
                .unwrap()
        );
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name='agent_run_input'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            schema
        );
        assert_eq!(
            database
                .connection()
                .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
            before
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_continuation_receipt")
            .unwrap();
        migrate(&mut database).unwrap();
        assert!(schema_matches(database.connection()).unwrap());
        drop(database);
        let database = Database::open(&directory).unwrap();
        assert_eq!(
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
            before
        );
        assert!(matches!(
            classify_database_contract(database.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
