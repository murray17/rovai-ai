//! Add stable inline member references without changing model context or existing text.
use super::*;

const TABLE: &str = "CREATE TABLE mission_description (
    mission_id TEXT PRIMARY KEY NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_type(content_json)='array')
)";

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    let actual: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='mission_description'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let normalize = |sql: &str| sql.split_whitespace().collect::<String>();
    Ok(actual.as_deref().map(normalize) == Some(normalize(TABLE)))
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    let tx = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    anyhow::ensure!(
        matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker) if marker.contract_version=="v1.72" && marker.projection_schema_version==136),
        "Mission descriptions require v1.72/schema 136"
    );
    // Main's receipt 185 already owns this exact table and its structured atoms.
    // Preserve those rows; only Preview sources need the text-only backfill.
    if !schema_matches(&tx)? {
        tx.execute_batch(TABLE)?;
        tx.execute_batch("INSERT INTO mission_description SELECT id, CASE WHEN description='' THEN '[]' ELSE json_array(json_object('kind','text','text',description)) END FROM mission;")?;
    }
    tx.execute_batch("INSERT INTO schema_migration VALUES(187,datetime('now'));
        UPDATE rovai_data_contract SET projection_schema_version=137,updated_at=datetime('now') WHERE singleton=1;")?;
    validate_migration_foreign_keys(&tx, &["mission_description"])?;
    anyhow::ensure!(
        matches!(
            classify_database_contract(&tx)?,
            DatabaseContractClassification::SupportedMigrationSource(ref marker)
                if marker.projection_schema_version == 137
        ),
        "Mission description schema admission failed"
    );
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn downgrade_for_test(connection: &Connection) {
    user_anchors::downgrade_for_test(connection);
    if !connection
        .table_exists(None, "mission_description")
        .unwrap()
    {
        return;
    }
    connection
        .execute_batch(
            "DROP TABLE mission_description; DELETE FROM schema_migration WHERE version=187;
        UPDATE rovai_data_contract SET projection_schema_version=136 WHERE singleton=1;",
        )
        .unwrap();
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_literal_text_and_rolls_back_schema_receipt_and_evidence() {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let created = crate::mission::MissionService::default().create(&mut database, &crate::command::CommandEnvelope {
            command_id: "description-migration".into(), actor: crate::command::ActorRef::User{user_id:"local_user".into()}, camp_id:None, expected_versions:vec![],execution_epoch:None,
            payload: serde_json::from_value(serde_json::json!({"title":"Legacy", "description":"literal @名字\nline", "projectPath":"/tmp", "projectBindingKind":"directory", "memberAgentIds":["agent_1"], "defaultLeadAgentId":"agent_1"})).unwrap(),
        }).unwrap();
        let id = created.result.payload["missionId"].as_str().unwrap();
        downgrade_for_test(database.connection());
        let evidence =
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap();
        database.connection().execute_batch("CREATE TEMP TRIGGER reject_description_migration BEFORE INSERT ON schema_migration WHEN NEW.version=187 BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END;").unwrap();
        assert!(migrate(&mut database).is_err());
        assert!(!schema_matches(database.connection()).unwrap());
        assert!(!database.schema_migration_applied(187).unwrap());
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT projection_schema_version FROM rovai_data_contract",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            136
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER reject_description_migration")
            .unwrap();
        migrate(&mut database).unwrap();
        let record = crate::mission::MissionService::default()
            .get(&database, id)
            .unwrap()
            .unwrap();
        assert_eq!(
            record.description_content,
            crate::mission_description::text_content("literal @名字\nline")
        );
        assert_eq!(
            public_history_claim_preserved_evidence_digest(database.connection()).unwrap(),
            evidence
        );
    }
}
