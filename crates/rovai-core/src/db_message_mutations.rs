use super::*;

const WAITING_INDEX: &str = "CREATE UNIQUE INDEX ordinary_waiting_message_target
    ON camp_message_delivery(message_id,recipient_agent_id)
    WHERE source_kind='message' AND status='waiting'";

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('camp_message') WHERE name='content_revision')
        AND EXISTS(SELECT 1 FROM pragma_table_info('camp_message') WHERE name='ever_bound_as_steer')
        AND EXISTS(SELECT 1 FROM pragma_table_info('agent_run_input') WHERE name='input_snapshot_json')
        AND EXISTS(SELECT 1 FROM pragma_table_info('camp_message_delivery') WHERE name='message_content_revision')
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='ordinary_waiting_message_target')
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='continuation_waiting_authorization')
        AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='camp_run_continuation_input')", [], |row|row.get(0))
}

fn rebuild_delivery(tx: &Transaction<'_>, remove_lifetime_unique: bool) -> Result<()> {
    let source: String = tx.query_row(
        "SELECT sql FROM sqlite_master WHERE name='camp_message_delivery'",
        [],
        |r| r.get(0),
    )?;
    let unique = "UNIQUE(message_id, recipient_agent_id),";
    let mut target = replacement_table_schema_v171(source, "camp_message_delivery");
    if remove_lifetime_unique {
        anyhow::ensure!(
            target.contains(unique),
            "Missing original Delivery uniqueness constraint"
        );
        target = target.replace(unique, "");
    } else {
        target = target.replace(
            "UNIQUE(camp_id, recipient_agent_id, queue_sequence)",
            &format!("{unique} UNIQUE(camp_id, recipient_agent_id, queue_sequence)"),
        );
    }
    rebuild_table_v171(tx, "camp_message_delivery", &target, &[], &[])
}

pub(super) fn migrate(db: &mut Database) -> Result<()> {
    db.connection
        .execute_batch("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;")?;
    let result = (|| -> Result<()> {
        let tx = db
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==176),
            "Message editing requires schema 176"
        );
        rebuild_delivery(&tx, true)?;
        tx.execute_batch("ALTER TABLE camp_message ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1 CHECK(content_revision>0);
            ALTER TABLE camp_message ADD COLUMN ever_bound_as_steer INTEGER NOT NULL DEFAULT 0 CHECK(ever_bound_as_steer IN (0,1));
            ALTER TABLE camp_message_delivery ADD COLUMN message_content_revision INTEGER NOT NULL DEFAULT 1 CHECK(message_content_revision>0);
            ALTER TABLE camp_message_delivery ADD COLUMN continuation_authorization_id TEXT;
            ALTER TABLE agent_run_input ADD COLUMN message_content_revision INTEGER NOT NULL DEFAULT 1 CHECK(message_content_revision>0);
            ALTER TABLE agent_run_input ADD COLUMN input_snapshot_json TEXT;
            CREATE TABLE camp_run_continuation_input(
                delivery_id TEXT NOT NULL REFERENCES camp_run_continuation(delivery_id) ON DELETE CASCADE,
                message_id TEXT NOT NULL REFERENCES camp_message(id), ordinal INTEGER NOT NULL,
                content_revision INTEGER NOT NULL CHECK(content_revision>0),
                PRIMARY KEY(delivery_id,message_id), UNIQUE(delivery_id,ordinal));
            CREATE INDEX continuation_input_message ON camp_run_continuation_input(message_id,delivery_id);
            UPDATE camp_message_delivery SET continuation_authorization_id=id WHERE source_kind='continuation';
            CREATE UNIQUE INDEX continuation_waiting_authorization ON camp_message_delivery(continuation_authorization_id)
                WHERE source_kind='continuation' AND status='waiting';
            INSERT INTO camp_run_continuation_input SELECT c.delivery_id,i.message_id,i.ordinal,i.message_content_revision
              FROM camp_run_continuation c JOIN camp_message_delivery d ON d.id=c.delivery_id AND d.status='waiting'
              JOIN agent_run_input i ON i.agent_run_id=c.source_agent_run_id;
            UPDATE camp_message SET ever_bound_as_steer=1 WHERE id IN (
              SELECT message_id FROM camp_message_delivery WHERE requested_mode='steer' AND claimed_agent_run_id IS NOT NULL
              UNION SELECT json_extract(payload_preview_json,'$.messageId') FROM agent_run_execution_evidence WHERE event_type='agent_run.input'
              UNION SELECT d.message_id FROM context_manifest m JOIN camp_message_delivery d ON d.id=m.source_delivery_id WHERE m.source_delivery_id IS NOT NULL);
            INSERT INTO schema_migration VALUES(227,datetime('now'));
            UPDATE rovai_data_contract SET projection_schema_version=177,updated_at=datetime('now') WHERE singleton=1;")?;
        tx.execute_batch(WAITING_INDEX)?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "camp_message_delivery",
                "camp_run_continuation",
                "camp_run_continuation_input",
                "agent_run_input",
            ],
        )?;
        anyhow::ensure!(
            matches!(
                classify_database_contract(&tx)?,
                DatabaseContractClassification::Current(ref m)
                    | DatabaseContractClassification::SupportedMigrationSource(ref m)
                    if m.projection_schema_version == 177
            ),
            "Message editing schema admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = db
        .connection
        .execute_batch("PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    if !schema_matches(c).unwrap() {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;")
        .unwrap();
    let tx = c.unchecked_transaction().unwrap();
    tx.execute_batch("DROP TABLE camp_run_continuation_input;
        DROP INDEX continuation_waiting_authorization; DROP INDEX ordinary_waiting_message_target;
        ALTER TABLE camp_message DROP COLUMN ever_bound_as_steer; ALTER TABLE camp_message DROP COLUMN content_revision;
        ALTER TABLE agent_run_input DROP COLUMN message_content_revision; ALTER TABLE agent_run_input DROP COLUMN input_snapshot_json;
        ALTER TABLE camp_message_delivery DROP COLUMN message_content_revision;
        ALTER TABLE camp_message_delivery DROP COLUMN continuation_authorization_id;").unwrap();
    rebuild_delivery(&tx, false).unwrap();
    tx.execute_batch("DELETE FROM schema_migration WHERE version IN (227,228); UPDATE rovai_data_contract SET projection_schema_version=176 WHERE singleton=1;").unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;")
        .unwrap();
}
