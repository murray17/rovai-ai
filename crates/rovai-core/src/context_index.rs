use anyhow::{Context, Result};
use rusqlite::{Connection, Transaction, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::Database;

pub const CONTEXT_INDEX_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextIndexRebuild {
    pub index_version: i64,
    pub message_count: usize,
    pub reference_count: usize,
    pub mention_count: usize,
}

pub(crate) fn camp_message_content_digest(body: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(body.as_bytes()))
}

pub(crate) fn extract_context_references(
    connection: &Connection,
    camp_id: &str,
    body: &str,
) -> Result<Vec<(String, String)>> {
    let mut references = Vec::new();
    for token in
        body.split(|character: char| !(character.is_ascii_alphanumeric() || character == '-'))
    {
        if token.is_empty() {
            continue;
        }
        let normalized = token.to_ascii_lowercase();
        for (prefix, kind, canonical_prefix) in [
            ("adr-", "adr", "ADR-"),
            ("pr-", "pr", "PR-"),
            ("issue-", "issue", "issue-"),
        ] {
            if let Some(number) = normalized.strip_prefix(prefix)
                && !number.is_empty()
                && number.bytes().all(|byte| byte.is_ascii_digit())
            {
                references.push((kind.to_string(), format!("{canonical_prefix}{number}")));
            }
        }
        if let Ok(task_id) = Uuid::parse_str(token) {
            let task_id = task_id.to_string();
            let exists = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM task WHERE id = ?1 AND camp_id = ?2)",
                params![task_id, camp_id],
                |row| row.get::<_, bool>(0),
            )?;
            if exists {
                references.push(("task".to_string(), task_id));
            }
        }
    }
    references.sort();
    references.dedup();
    Ok(references)
}

pub(crate) fn index_camp_message(
    transaction: &Transaction<'_>,
    message_id: &str,
    camp_id: &str,
    body: &str,
    addressed_agent_ids_json: &str,
) -> Result<()> {
    for (kind, value) in extract_context_references(transaction, camp_id, body)? {
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO camp_message_reference(
                camp_message_id, kind, value
            ) VALUES (?1, ?2, ?3)
            "#,
            params![message_id, kind, value],
        )?;
    }
    let mentioned_ids: Vec<String> = serde_json::from_str(addressed_agent_ids_json)
        .context("CampMessage addressed Agent IDs are invalid")?;
    for agent_id in mentioned_ids {
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO camp_message_mention(
                camp_message_id, agent_id
            )
            SELECT ?1, agent_profile.id
            FROM agent_profile
            WHERE agent_profile.id = ?2
            "#,
            params![message_id, agent_id],
        )?;
    }
    Ok(())
}

pub fn rebuild_context_index(database: &mut Database) -> Result<ContextIndexRebuild> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = database.connection_mut().transaction()?;
    transaction.execute_batch(
        r#"
        DELETE FROM camp_message_reference;
        DELETE FROM camp_message_mention;
        INSERT INTO camp_message_fts(camp_message_fts) VALUES('rebuild');
        INSERT INTO camp_message_fts(camp_message_fts, rowid, body)
        SELECT 'delete', rowid, body
        FROM camp_message
        WHERE tombstoned_at IS NOT NULL;
        "#,
    )?;
    let messages = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id, camp_id, body, addressed_agent_ids_json
            FROM camp_message
            ORDER BY camp_id, sequence
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (message_id, camp_id, body, addressed_ids) in &messages {
        index_camp_message(&transaction, message_id, camp_id, body, addressed_ids)?;
    }
    transaction.execute(
        r#"
        UPDATE context_index_meta
        SET index_version = ?1, rebuilt_at = ?2
        WHERE singleton = 1
        "#,
        params![CONTEXT_INDEX_VERSION, now],
    )?;
    let reference_count =
        transaction.query_row("SELECT COUNT(*) FROM camp_message_reference", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
    let mention_count =
        transaction.query_row("SELECT COUNT(*) FROM camp_message_mention", [], |row| {
            row.get::<_, i64>(0)
        })? as usize;
    transaction.commit()?;
    Ok(ContextIndexRebuild {
        index_version: CONTEXT_INDEX_VERSION,
        message_count: messages.len(),
        reference_count,
        mention_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, CreateTaskCommand,
            TestCampMessageAddress, TestCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope, CommandResultStatus},
    };
    use serde_json::json;

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "test-user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn rebuilt_index_matches_incremental_references_mentions_and_live_fts() {
        let directory =
            std::env::temp_dir().join(format!("rovai-context-index-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-index-camp",
                    None,
                    CreateCampCommand::for_test(
                        directory.join("workspace").to_string_lossy().to_string(),
                    ),
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "add-index-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        let task = collaboration
            .create_task(
                &mut database,
                &user_envelope(
                    "create-index-task",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "Indexed Task".to_string(),
                        description: String::new(),
                        assignee_agent_id: None,
                    },
                ),
            )
            .unwrap();
        let task_id = task.result.payload["taskId"].as_str().unwrap();
        let message = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "send-index-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: format!("Review adr-49 PR-7 ISSUE-2 {task_id}; task-9 is not an ID."),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_1".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(message.result.status, CommandResultStatus::Applied);
        let message_id = message.result.payload["campMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let incremental: (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM camp_message_reference
                     WHERE camp_message_id = ?1),
                    (SELECT COUNT(*) FROM camp_message_mention
                     WHERE camp_message_id = ?1)
                "#,
                [&message_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(incremental, (4, 1));

        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE camp
                SET last_message_sequence = last_message_sequence + 1,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1
                "#,
                params![camp_id, now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id,
                    source_agent_run_id, body, structured_content_json, content_digest,
                    address_mode, addressed_agent_ids_json,
                    reply_to_camp_message_id, camp_turn_id, agent_run_id,
                    tombstoned_at, version, created_at, updated_at
                )
                SELECT 'tombstoned-index-message', id, last_message_sequence,
                       'system', 'test', NULL, 'secret-index-token',
                       '[{"kind":"text","text":"secret-index-token"}]',
                       ?2, 'broadcast', '[]', NULL, NULL, NULL,
                       ?3, 1, ?3, ?3
                FROM camp WHERE id = ?1
                "#,
                params![
                    camp_id,
                    camp_message_content_digest("secret-index-token"),
                    now
                ],
            )
            .unwrap();
        database
            .connection()
            .execute_batch(
                r#"
                DELETE FROM camp_message_reference;
                DELETE FROM camp_message_mention;
                UPDATE context_index_meta SET index_version = 99 WHERE singleton = 1;
                "#,
            )
            .unwrap();

        let rebuilt = rebuild_context_index(&mut database).unwrap();
        assert_eq!(
            rebuilt,
            ContextIndexRebuild {
                index_version: CONTEXT_INDEX_VERSION,
                message_count: 2,
                reference_count: 4,
                mention_count: 1,
            }
        );
        let rebuilt_references = {
            let mut statement = database
                .connection()
                .prepare(
                    r#"
                    SELECT kind, value FROM camp_message_reference
                    WHERE camp_message_id = ?1
                    ORDER BY kind, value
                    "#,
                )
                .unwrap();
            statement
                .query_map([&message_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            rebuilt_references,
            vec![
                ("adr".to_string(), "ADR-49".to_string()),
                ("issue".to_string(), "issue-2".to_string()),
                ("pr".to_string(), "PR-7".to_string()),
                ("task".to_string(), task_id.to_string()),
            ]
        );
        let active_fts: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM camp_message_fts
                JOIN camp_message
                  ON camp_message.rowid = camp_message_fts.rowid
                WHERE camp_message_fts MATCH '"ADR-49"'
                  AND camp_message.tombstoned_at IS NULL
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_fts, 1);
        let tombstoned_fts: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM camp_message_fts
                WHERE camp_message_fts MATCH '"secret-index-token"'
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tombstoned_fts, 0);
        assert_eq!(json!(rebuilt.index_version), json!(CONTEXT_INDEX_VERSION));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
