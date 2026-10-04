//! Retention of client-local unsent input. Core stores presence, never draft content.
use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;

use crate::{camp_id::ThreadId, db::Database, draft_client::DraftClient};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetPendingDraftPresence {
    pub thread_id: ThreadId,
    pub present: bool,
}

/// Called only by the authenticated User transport, with its verified editor identity.
/// Callers save their local snapshot before setting presence and serialize edits.
pub fn set_presence(
    database: &mut Database,
    client: &DraftClient,
    input: &SetPendingDraftPresence,
) -> Result<bool> {
    let tx = database.connection_mut().transaction()?;
    let state: Option<String> = tx
        .query_row(
            "SELECT activation_state FROM camp WHERE id=?1 AND deletion_operation_id IS NULL",
            [&input.thread_id],
            |row| row.get(0),
        )
        .optional()?;
    ensure!(
        state.as_deref() == Some("pending"),
        "camp.pending_draft_unavailable"
    );
    let changed = if input.present {
        tx.execute(
            "INSERT OR IGNORE INTO pending_camp_draft_presence(camp_id, client_id) VALUES (?1, ?2)",
            params![input.thread_id, client.id()],
        )?
    } else {
        tx.execute(
            "DELETE FROM pending_camp_draft_presence WHERE camp_id=?1 AND client_id=?2",
            params![input.thread_id, client.id()],
        )?
    };
    tx.commit()?;
    Ok(changed != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{
            CollaborationService, CreateThreadCommand, DiscardPendingThreadCommand,
            ThreadActivationState,
        },
        command::{ActorRef, CommandEnvelope},
        read_model::ReadModelService,
    };

    fn envelope<T>(id: &str, camp: Option<&str>, payload: T) -> CommandEnvelope<T> {
        CommandEnvelope {
            command_id: id.into(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: camp.map(str::to_owned),
            expected_versions: vec![],
            execution_epoch: None,
            payload,
        }
    }

    // Regression owner: client-local drafts retain identity across database reopen,
    // remain private in navigation, and prevent both cleanup paths. Legacy Core
    // Composer tests cannot cover this marker because they write draft content to SQL.
    #[test]
    fn pending_draft_presence_survives_restart_and_fences_cleanup_until_clear_or_activation() {
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        let service = CollaborationService::default();
        let desktop = DraftClient::default();
        let web = DraftClient::verified_web(&"a".repeat(64)).unwrap();
        let mut ids = vec![];
        for index in 0..3 {
            let mut command = CreateThreadCommand::for_test(
                directory.join("workspace").to_string_lossy().into_owned(),
            );
            command.activation_state = ThreadActivationState::Pending;
            let created = service
                .create_camp(
                    &mut database,
                    &envelope(&format!("create-{index}"), None, command),
                )
                .unwrap();
            ids.push(
                ThreadId::parse(created.result.payload["threadId"].as_str().unwrap()).unwrap(),
            );
        }
        let presence = |index: usize, present| SetPendingDraftPresence {
            thread_id: ids[index].clone(),
            present,
        };
        assert!(
            ReadModelService
                .navigation_snapshot(&mut database)
                .unwrap()
                .projects
                .is_empty()
        );
        for index in 0..2 {
            assert!(set_presence(&mut database, &desktop, &presence(index, true)).unwrap());
            assert!(!set_presence(&mut database, &desktop, &presence(index, true)).unwrap());
        }
        // Two drafts in one project are independent. Another editor sees neither.
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut database)
                .unwrap()
                .projects[0]
                .total_count,
            2
        );
        assert!(
            ReadModelService
                .navigation_snapshot_with_group_limits(&mut database, &Default::default(), &web)
                .unwrap()
                .projects
                .is_empty()
        );
        let rejected = service
            .discard_pending_camp(
                &mut database,
                &envelope(
                    "discard-saved",
                    Some(ids[0].as_str()),
                    DiscardPendingThreadCommand {
                        camp_id: ids[0].to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.code, "camp.pending_not_empty");
        drop(database);
        let mut database = Database::open(&directory).unwrap();
        let candidates = service
            .snapshot_pending_camps_for_startup_cleanup(&database)
            .unwrap();
        assert_eq!(
            service
                .discard_empty_pending_camps_on_startup(&mut database, &candidates)
                .unwrap(),
            vec![ids[2].to_string()]
        );
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut database)
                .unwrap()
                .projects[0]
                .total_count,
            2
        );
        // Failed/rolled-back activation must not consume retention.
        let tx = database.connection_mut().transaction().unwrap();
        tx.execute(
            "UPDATE camp SET activation_state='active' WHERE id=?1",
            [&ids[0]],
        )
        .unwrap();
        tx.rollback().unwrap();
        assert!(!set_presence(&mut database, &desktop, &presence(0, true)).unwrap());
        database
            .connection()
            .execute(
                "UPDATE camp SET activation_state='active' WHERE id=?1",
                [&ids[0]],
            )
            .unwrap();
        assert!(set_presence(&mut database, &desktop, &presence(0, true)).is_err());
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT count(*) FROM pending_camp_draft_presence WHERE camp_id=?1",
                    [&ids[0]],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        // Clearing one editor never discards another editor's retained input.
        set_presence(&mut database, &web, &presence(1, true)).unwrap();
        set_presence(&mut database, &desktop, &presence(1, false)).unwrap();
        assert!(
            service
                .discard_empty_pending_camps_on_startup(&mut database, &candidates)
                .unwrap()
                .is_empty()
        );
        set_presence(&mut database, &web, &presence(1, false)).unwrap();
        assert_eq!(
            service
                .discard_empty_pending_camps_on_startup(&mut database, &candidates)
                .unwrap(),
            vec![ids[1].to_string()]
        );
        assert!(set_presence(&mut database, &desktop, &presence(1, true)).is_err());
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
